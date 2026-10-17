import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { crearSimulador } from '../src/services/simulacion-consumo.service.js';
import { validarViaje, crearServicioRutas } from '../src/services/rutas.service.js';
import { interpretarVelocidades } from '../src/services/enrutamiento.service.js';

const s = { masaKg: 1500, potenciaKw: 100, cda: .7, rodadura: .01, referencia: 'combinado', velocidadMaxima: 80, incluirRelieve: true };
const q = { origen: {latitud:14.6,longitud:-90.5}, destino: {latitud:14.6,longitud:-90}, viaje:'ida', distanciaModo:'api', combustible:'regular',modalidad:'autoservicio', modeloConsumo:'fastsim',consumoManual:8,simulacion:s };

test('servidor valida escenario físico, velocidad y referencias, rechaza doble ajuste y modo manual', () => {
  assert.equal(validarViaje(q).simulacion.potenciaKw, 100);
  for (const extra of [{modeloConsumo:'otro'}, {distanciaModo:'manual',kmIda:100}, {ajustarSubidas:true,masaKg:1500,eficienciaPct:25},
    ...[{masaKg:true},{masaKg:10001},{cargaExtraKg:-1},{cargaExtraKg:2001},{masaKg:9500,cargaExtraKg:1000},{cda:0},{potenciaKw:1501},{rodadura:.5},{velocidadMaxima:111},{incluirRelieve:'true'},
      {referencia:'constante',velocidadReferencia:null},{referencia:'magia'},{minutosMotorEncendido:181}].map(e=>({simulacion:{...s,...e}}))]) {
    assert.throws(()=>validarViaje({...q,...extra}), {statusCode:400});
  }
});

test('velocidades por maniobra: unidades y cobertura; no acepta velocidades inventadas o huecos', () => {
  assert.deepEqual(interpretarVelocidades([{length:10,time:600},{length:20,time:1200},{length:0,time:0}],30),
    [{inicioKm:0,finKm:10,kmh:60},{inicioKm:10,finKm:30,kmh:60}]);
  assert.deepEqual(interpretarVelocidades([{length:10,time:0}],10),[]);
  assert.deepEqual(interpretarVelocidades([{length:10,time:10}],10),[]);
  assert.deepEqual(interpretarVelocidades([{length:10,time:600}],30),[]);
  const redondeadas=interpretarVelocidades([{length:10,time:600},{length:19.994,time:1200}],30);
  assert.equal(redondeadas.at(-1).finKm,30);assert.equal(redondeadas[1].inicioKm,redondeadas[0].finKm);
  assert.equal(redondeadas[1].kmh,19.994*3600/1200);
});

test('consume ficha privada, rechaza bitácora/híbridos antes de red y no transmite identidad al motor', async () => {
  let real=null, tecnologia=null, consultadas=0, entrada;
  const servicio = crearServicioRutas({garaje:{listar:async()=>[{id:'7',alias:'Privado',ficha:{tipo:'moto',combustible:'Gasoline',tecnologia,consumo:{combinado:3,carretera:2.5}}}]},
    bitacora:{historial:async()=>({resumen:{consumoReal:real}})}, listar:async()=>[],
    proveedor:{consultar:async()=>{consultadas++;return {tramos:[{sentido:'ida',kilometros:100,puntos:[q.origen,q.destino],velocidades:[{inicioKm:0,finKm:100,kmh:60}],relieve:{disponible:false}}]};}},
    simulador:{simular:async p=>{entrada=p;return {litros:4};}}});
  const u={id:'1',rol:'conductor'};
  const r=await servicio.estimar({...q,vehiculoId:'7',tipoVehiculo:'auto',consumoManual:99,simulacion:{...s,referencia:'carretera'},margen:10},u);
  assert.equal(entrada.parametros.tipo,'moto');assert.equal(entrada.l100km,2.5);assert.equal(r.litros,4.4);assert.equal(r.litrosBase,2.5);
  assert.ok(!JSON.stringify(entrada).includes('Privado'));assert.equal(entrada.usuario,undefined);
  real={l100km:4}; await assert.rejects(servicio.estimar({...q,vehiculoId:'7'},u),{statusCode:400});
  real=null;tecnologia='Hybrid';await assert.rejects(servicio.estimar({...q,vehiculoId:'7'},u),{statusCode:400});assert.equal(consultadas,1);
});

function proceso() { const p=new EventEmitter();p.stdin=new PassThrough();p.stdout=new PassThrough();p.stderr=new PassThrough();p.kill=()=>{queueMicrotask(()=>p.emit('close',1));return true;};return p; }
test('proceso aislado sin shell, entrada JSON y respuesta validada; error de instalación no se sustituye', async () => {
  let p, args, opts;
  const motor=crearSimulador({spawnFn:(_exe,a,o)=>{args=a;opts=o;p=proceso();p.stdin.on('finish',()=>{p.stdout.write(JSON.stringify({data:{motor:'FASTSim 3.1.0',litros:8,tramos:[]}}));p.emit('close',0);});return p;}});
  assert.equal((await motor.simular({parametros:s})).litros,8);assert.equal(opts.shell,undefined);assert.equal(opts.windowsHide,true);assert.equal(args[0],'-I');assert.equal(args.length,2);
  const roto=crearSimulador({spawnFn:()=>{const c=proceso();queueMicrotask(()=>c.emit('error',new Error('ruta privada')));return c;}});
  await assert.rejects(roto.simular({}),e=>e.statusCode===503&&!e.message.includes('ruta privada'));
});
test('cola simultánea acotada, timeout mata procesos y libera cupos', async () => {
  let muertos=0;
  const motor=crearSimulador({timeoutMs:20,spawnFn:()=>{const c=proceso();const kill=c.kill;c.kill=()=>{muertos++;return kill();};return c;}});
  const a=motor.simular({}), b=motor.simular({});const todas=Promise.allSettled([a,b]);
  await assert.rejects(motor.simular({}),{statusCode:429});
  const r=await todas;assert.ok(r.every(x=>x.status==='rejected'&&x.reason.statusCode===503));assert.equal(muertos,2);
  await assert.rejects(motor.simular({}),{statusCode:503});assert.equal(muertos,3);
});
test('sin velocidades completas no llama a FASTSim ni reemplaza por velocidad media global', async () => {
  let llamadas=0;
  const servicio=crearServicioRutas({listar:async()=>[],proveedor:{consultar:async()=>({tramos:[{sentido:'ida',kilometros:100,puntos:[q.origen,q.destino],relieve:{disponible:false}}]})},simulador:{simular:async()=>{llamadas++;}}});
  await assert.rejects(servicio.estimar(q),{statusCode:422});assert.equal(llamadas,0);
});
