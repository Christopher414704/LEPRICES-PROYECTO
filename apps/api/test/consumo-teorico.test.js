import {test} from 'node:test';
import assert from 'node:assert/strict';
import {estimarConsumoTeorico} from '../src/services/consumo-teorico.js';
import {crearServicioRutas} from '../src/services/rutas.service.js';
const parametros={masaKg:1500,velocidadKmh:60,cda:.7,rodadura:.01,eficienciaPct:25,auxiliaresKw:.5};
test('balance de energía conserva unidades y responde a masa, velocidad, rodadura y eficiencia',()=>{
  const r=estimarConsumoTeorico(parametros,'regular');
  const rho=101325/(287.05*(15+273.15));
  const esperado=((1500*9.80665*.01+.5*rho*.7*(60/3.6)**2)*100000/1e6+.5*(100/60)*3.6+.5*1500*(60/3.6)**2/1e6)/(.25*32);
  assert.ok(Math.abs(r.l100km-esperado)<1e-10);assert.equal(r.fuente,'modelo_teorico');assert.equal(r.estimado,true);
  for(const extra of [{masaKg:2000},{velocidadKmh:100},{rodadura:.02},{cda:1}])assert.ok(estimarConsumoTeorico({...parametros,...extra},'regular').l100km>r.l100km);
  assert.ok(estimarConsumoTeorico({...parametros,eficienciaPct:35},'regular').l100km<r.l100km);
  for(const extra of [null,[],{...parametros,masaKg:''},{...parametros,eficienciaPct:0},{...parametros,velocidadKmh:Infinity},{...parametros,cda:-1}])assert.throws(()=>estimarConsumoTeorico(extra,'regular'),{statusCode:400});
  assert.throws(()=>estimarConsumoTeorico(parametros,'electricidad'),{statusCode:400}); // Eficiencia de combustión inválida para batería.
});

const tramo=(sentido='ida',alturas=[1000,1000])=>({sentido,kilometros:100,segundos:6000,
  puntos:[{latitud:14.63,longitud:-90.5},{latitud:14.63,longitud:-89.99}],
  velocidades:[{inicioKm:0,finKm:40,kmh:60},{inicioKm:40,finKm:100,kmh:80}],
  relieve:{disponible:true,perfilMotor:alturas.map((alturaM,i)=>({km:i*100/(alturas.length-1),alturaM}))}});
test('recorrido usa velocidades y pendiente por sentido; no duplica subidas ni descuenta combustible negativo',()=>{
  const llano=estimarConsumoTeorico(parametros,'regular',{ruta:{tramos:[tramo()]}});
  const arriba=tramo('ida',[1000,2000]),abajo=tramo('vuelta',[2000,1000]);
  const subida=estimarConsumoTeorico(parametros,'regular',{ruta:{tramos:[arriba]}});
  const bajada=estimarConsumoTeorico(parametros,'regular',{ruta:{tramos:[abajo]}});
  assert.ok(subida.l100km>llano.l100km);assert.ok(bajada.l100km<llano.l100km);assert.ok(bajada.l100km>0);
  const ambos=estimarConsumoTeorico({...parametros,condiciones:{ascensoIdaM:30000,ascensoVueltaM:30000,minutosRalenti:20}},'regular',{ruta:{tramos:[arriba,abajo]}});
  assert.deepEqual(ambos.modeloTeorico.tramos.map(t=>t.ascensoM),[1000,0]);
  assert.deepEqual(ambos.modeloTeorico.tramos.map(t=>t.minutosDetenido),[10,10]);
  assert.ok(ambos.modeloTeorico.tramos.every(t=>t.velocidadesMapa && t.relieveAplicado));
  assert.ok(ambos.modeloTeorico.tramos[0].cantidad>ambos.modeloTeorico.tramos[1].cantidad);
  assert.equal(llano.modeloTeorico.tramos[0].segundosEnMovimiento,6000); // techo 60, no 80 del segundo segmento
  const rapido=estimarConsumoTeorico({...parametros,velocidadKmh:90},'regular',{ruta:{tramos:[tramo()]}});
  assert.ok(rapido.modeloTeorico.tramos[0].segundosEnMovimiento<6000);
  assert.ok(rapido.l100km>llano.l100km);
});

test('tráfico previsto, rodadura y ascenso manual incrementan la energía; cobertura incompleta avisa',()=>{
  const base=estimarConsumoTeorico(parametros,'regular',{kmIda:100});
  for(const extra of [{condiciones:{paradasKm:1}},{condiciones:{minutosRalenti:30},ralentiLitrosHora:.6},{condiciones:{ascensoIdaM:1000}},{rodadura:.025}]) {
    assert.ok(estimarConsumoTeorico({...parametros,...extra},'regular',{kmIda:100}).l100km>base.l100km);
  }
  const parcial=tramo();parcial.relieve.disponible=false;parcial.relieve.perfilMotor[1].alturaM=null;
  parcial.velocidades=[{inicioKm:0,finKm:10,kmh:30}];parcial.superficieIrregular=true;
  const r=estimarConsumoTeorico({...parametros,condiciones:{ascensoIdaM:500}},'diesel',{ruta:{tramos:[parcial]}});
  assert.equal(r.modeloTeorico.tramos[0].relieveAplicado,false);assert.equal(r.modeloTeorico.tramos[0].velocidadesMapa,false);
  assert.equal(r.modeloTeorico.tramos[0].ascensoM,500);assert.equal(r.modeloTeorico.avisos.length,3);
  for(const condiciones of [{paradasKm:-1},{minutosRalenti:181},{altitudM:5001},{temperaturaC:''},{ascensoVueltaM:Infinity}])assert.throws(()=>estimarConsumoTeorico({...parametros,condiciones},'regular'),{statusCode:400});
});

test('calibración con referencia pareada reproduce la medición y transfiere condiciones sin afirmar precisión nacional',()=>{
  const referencia={kilometros:100,cantidad:8,velocidadKmh:60,condiciones:{paradasKm:.5,minutosRalenti:10,altitudM:1500,ascensoIdaM:300,temperaturaC:25}};
  const p={...parametros,ralentiLitrosHora:.6,condiciones:referencia.condiciones,calibracion:referencia};
  const r=estimarConsumoTeorico(p,'regular',{kmIda:100});
  assert.ok(Math.abs(r.l100km-8)<1e-10);assert.equal(r.calibracion.estado,'referencia_usuario');assert.match(r.aviso,/no es validación independiente/);
  assert.ok(estimarConsumoTeorico({...p,condiciones:{...p.condiciones,ascensoIdaM:1500}},'regular',{kmIda:100}).l100km>8);
  assert.equal(estimarConsumoTeorico(parametros,'regular').calibracion.estado,'sin_mediciones');
  for(const extra of [{cantidad:0},{kilometros:''},{cantidad:3000},{velocidadKmh:0},{condiciones:{paradasKm:6}}])assert.throws(()=>estimarConsumoTeorico({...p,calibracion:{...referencia,...extra}},'regular'),{statusCode:400});
});

test('carros y motos de cualquier marca: gasolina, diésel, híbridos y batería sin mezclar unidades ni precios',async()=>{
  for(const tipo of ['auto','moto'])for(const fuel of ['regular','super','premium','diesel','electricidad']) {
    let consultasPrecio=0;
    const ficha={tipo,marca:'Cualquier marca fuera de API',modelo:'Modelo regional',anio:2025,
      combustible:fuel==='electricidad'?'Electricity':fuel==='diesel'?'Diesel':'Gasolina',tecnologia:fuel==='super'?'Hybrid':undefined,consumo:{}};
    const servicio=crearServicioRutas({garaje:{listar:async()=>[{id:'7',alias:'Prueba',ficha}]},bitacora:{historial:async()=>({resumen:{}})},
      listar:async()=>{consultasPrecio++;return[];},proveedor:{consultar:async()=>({tramos:[tramo()],kilometros:100,segundos:6000,avisos:[]})}});
    const elect=fuel==='electricidad';
    const datos={origen:{latitud:14.6349,longitud:-90.5069},destino:{latitud:14.6345,longitud:-89.9889},viaje:'ida',distanciaModo:'api',combustible:fuel,modalidad:'autoservicio',modeloConsumo:'teorico',
      estimacionTeorica:{...parametros,masaKg:tipo==='moto'?220:1500,cda:tipo==='moto'?.45:.7,eficienciaPct:elect?85:25,condiciones:{paradasKm:.5,minutosRalenti:10}},precioManual:elect?2:30};
    const r=await servicio.estimar({...datos,vehiculoId:'7'},{id:'1',rol:'conductor'});
    const publico=await servicio.estimar({...datos,tipoVehiculo:tipo});
    assert.equal(r.consumo.vehiculo.tipo,tipo);assert.equal(r.consumo.fuente,'modelo_teorico');assert.equal(r.consumo.calibracion.estado,'sin_mediciones');
    if(elect){assert.equal(r.litros,null);assert.equal(r.galones,null);assert.ok(r.kwh>0);assert.equal(r.costo,r.kwh*2);assert.equal(r.precio.precioGalon,null);assert.equal(consultasPrecio,0);assert.equal(r.kwh,publico.kwh);}
    else {assert.ok(r.litros>0);assert.equal(r.kwh,undefined);assert.equal(r.litros,publico.litros);assert.equal(r.costo,r.galones*30);}
    if(fuel==='super')assert.equal(r.consumo.parametrosTeoricos.propulsion,'hibrido');
    if(elect)await assert.rejects(servicio.estimar({...datos,vehiculoId:'7',combustible:'regular'},{id:'1',rol:'conductor'}),/combustible seleccionado/);
  }
});

test('recuperación solo híbrida/eléctrica, tarifa opcional y presupuesto eléctrico manual sin gasolina ficticia',async()=>{
  const condiciones={paradasKm:1,minutosRalenti:10};
  const p={...parametros,propulsion:'electrico',eficienciaPct:85,condiciones};
  const sin=estimarConsumoTeorico(p,'electricidad'),con=estimarConsumoTeorico({...p,regeneracionPct:50},'electricidad');
  assert.ok(con.kwh100km<sin.kwh100km && con.kwh100km>0);assert.equal(con.l100km,null);
  assert.throws(()=>estimarConsumoTeorico({...parametros,regeneracionPct:50},'regular'),{statusCode:400});
  assert.throws(()=>estimarConsumoTeorico({...p,ralentiLitrosHora:.1},'electricidad'),{statusCode:400});
  const servicio=crearServicioRutas({listar:async()=>{throw new Error('No debe consultar gasolina');}});
  const datos={origen:{latitud:14.6349,longitud:-90.5069},destino:{latitud:14.6345,longitud:-89.9889},viaje:'ida',distanciaModo:'manual',kmIda:100,combustible:'electricidad',modalidad:'autoservicio',modeloConsumo:'consumo',consumoManual:15,margen:10};
  const r=await servicio.estimar(datos);assert.equal(r.costo,null);assert.equal(r.kwh,16.5);assert.equal(r.litros,null);
  assert.equal((await servicio.estimar({...datos,precioManual:2})).costo,33);
  await assert.rejects(servicio.estimar({...datos,codigoGasolinera:'a'}),{statusCode:400});
  await assert.rejects(servicio.estimar({...datos,modeloConsumo:'fastsim'}),{statusCode:400});
});
test('Rutas ofrece escenario teórico con y sin garaje, sin guardar un consumo inventado',async()=>{
  let escrituras=0;
  const ficha={tipo:'moto',marca:'Prueba',modelo:'Sin consumo',anio:2025,combustible:'Gasolina',consumo:{}};
  const servicio=crearServicioRutas({garaje:{listar:async()=>[{id:'7',alias:'Prueba',ficha}],agregar:()=>{escrituras++;}},bitacora:{historial:async()=>({resumen:{}})},listar:async()=>[]});
  const viaje={origen:{latitud:14.6349,longitud:-90.5069},destino:{latitud:14.6345,longitud:-89.9889},viaje:'ida',kmIda:100,distanciaModo:'manual',combustible:'regular',modalidad:'autoservicio',modeloConsumo:'teorico',estimacionTeorica:parametros,precioManual:30};
  const anonimo=await servicio.estimar(viaje);
  const privado=await servicio.estimar({...viaje,vehiculoId:'7'},{id:'1',rol:'conductor'});
  assert.equal(anonimo.litros,privado.litros);assert.equal(privado.consumo.vehiculo.alias,'Prueba');assert.equal(privado.consumo.fuente,'modelo_teorico');
  assert.equal(privado.consumo.referenciaGeneral,undefined);assert.equal(escrituras,0);assert.deepEqual(ficha.consumo,{});
  await assert.rejects(servicio.estimar({...viaje,estimacionTeorica:null}),{statusCode:400});
  await assert.rejects(servicio.estimar({...viaje,distanciaModo:'api',ajustarSubidas:true,masaKg:1500,eficienciaPct:25}),/ya incluye pendientes/);
  await assert.rejects(servicio.estimar({...viaje,vehiculoId:'7',combustible:'diesel'},{id:'1',rol:'conductor'}),/combustible seleccionado/);
  ficha.tecnologia='Hybrid';assert.equal((await servicio.estimar({...viaje,vehiculoId:'7'},{id:'1',rol:'conductor'})).consumo.parametrosTeoricos.propulsion,'hibrido');
});
