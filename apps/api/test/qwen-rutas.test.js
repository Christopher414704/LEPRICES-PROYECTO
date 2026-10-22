import {test} from 'node:test';
import assert from 'node:assert/strict';
import {crearAsistenteRutas} from '../src/services/qwen-rutas.js';
import {crearServicioRutas} from '../src/services/rutas.service.js';
const variables={RUTAS_QWEN_HABILITADO:'true',VEHICULOS_LLM_URL:'http://localhost:1235/v1',VEHICULOS_LLM_MODELO:'qwen3-4b-instruct-2507'};
const resultado={kilometros:100,litros:3,costo:30,consumo:{fuente:'bitacora',l100km:3,medicion:{kilometros:300,tramos:2}},vehiculo:{alias:'Privado'},origen:{latitud:14}};
const respuesta=m=>({ok:true,json:async()=>({choices:[{message:m}]})});
test('Qwen consulta herramientas; recibe solo agregados y no altera cifras medidas',async()=>{
  let llamadas=0;
  const a=crearAsistenteRutas({variables,solicitar:async(url,op)=>{
    const b=JSON.parse(op.body);assert.ok(!JSON.stringify(b).includes('Privado'));assert.ok(!JSON.stringify(b).includes('latitud'));
    return ++llamadas===1?respuesta({role:'assistant',content:null,tool_calls:[{id:'1',type:'function',function:{name:'consultar_simulacion',arguments:'{"escenario":"actual"}'}}]}):respuesta({content:'{"hallazgos":["mediciones"]}'});
  }});
  const copia=structuredClone(resultado),r=await a.analizar(resultado,null);
  assert.equal(r.estado,'disponible');assert.equal(llamadas,2);assert.deepEqual(resultado,copia);assert.equal(r.modificaConsumo,false);
});
test('escenarios solo calculados por herramienta; respuestas inventadas o caídas no alteran presupuesto',async()=>{
  for(const m of [{tool_calls:[{id:'1',function:{name:'consultar_simulacion',arguments:'{"escenario":"intenso"}'}}]}, {tool_calls:[{id:'1',function:{name:'modificar_consumo',arguments:'{}'}}]}]) {
    const r=await crearAsistenteRutas({variables,solicitar:async()=>respuesta(m)}).analizar(resultado,null);assert.equal(r.estado,'no_disponible');
  }
  const offline=await crearAsistenteRutas({variables,solicitar:async()=>{throw Error('offline');}}).analizar(resultado,null);assert.equal(offline.estado,'no_disponible');
  let n=0,escenario;
  const a=crearAsistenteRutas({variables,solicitar:async()=>++n===1?respuesta({role:'assistant',tool_calls:[{id:'1',type:'function',function:{name:'consultar_simulacion',arguments:'{"escenario":"moderado"}'}}]}):respuesta({content:'{"hallazgos":["trafico_simulado"]}'})});
  const r=await a.analizar({...resultado,consumo:{fuente:'modelo_teorico'}},async e=>{escenario=e;return {litros:4,hipotetico:true};});
  assert.equal(escenario,'moderado');assert.equal(r.escenarios[0].litros,4);
});

test('el análisis recibe copias y no cambia consumo ni parámetros de HU-38',async()=>{
 const datos={origen:{latitud:14.63,longitud:-90.5},destino:{latitud:14.63,longitud:-89.99},viaje:'ida',distanciaModo:'manual',kmIda:100,combustible:'super',modalidad:'autoservicio',modeloConsumo:'teorico',precioManual:35,escenariosConsumo:{moderado:{paradasKm:.8}},estimacionTeorica:{masaKg:280,velocidadKmh:75,cda:.45,rodadura:.01,eficienciaPct:25,auxiliaresKw:.1,motorEnMarchaLitrosHora:.15,ralentiLitrosHora:.15}};
 const entrada=structuredClone(datos);
 const a=await crearServicioRutas({listar:async()=>[],asistente:{analizar:async()=>({estado:'desactivado'})}}).estimar(datos);
 const b=await crearServicioRutas({listar:async()=>[],asistente:{analizar:async(resultado,consultar)=>{
  resultado.litros=999;
  const escenario=await consultar('moderado');assert.equal(escenario.parametros.paradasKm,.8);escenario.parametros.paradasKm=99;escenario.litros=999;
  return {estado:'disponible',hallazgos:[],modificaConsumo:false};
 }}}).estimar(datos);
 assert.equal(b.litros,a.litros);assert.equal(b.costo,a.costo);assert.deepEqual(b.escenariosConsumo,a.escenariosConsumo);assert.deepEqual(datos,entrada);
});
