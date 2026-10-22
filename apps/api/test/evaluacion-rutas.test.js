import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluarRespaldo} from '../src/services/evaluacion-rutas.js';
import {crearServicioRutas} from '../src/services/rutas.service.js';
test('historial observado se distingue de precisión y calibración',()=>{
  const r=evaluarRespaldo({consumo:{fuente:'bitacora',historialConsumo:[3,5,4]}});
  assert.equal(r.estado,'medido');assert.equal(r.precisionValidada,false);
  assert.equal(r.variacionHistorica.minimoL100,3);assert.equal(r.variacionHistorica.maximoL100,5);
  const c=evaluarRespaldo({consumo:{fuente:'modelo_teorico',calibracion:{estado:'referencia_usuario'},modeloTeorico:{tramos:[{relieveAplicado:false}]}}});
  assert.equal(c.estado,'calibrado');assert.equal(c.pendientesSimuladas,false);assert.equal(c.precisionValidada,false);
});
test('referencia conserva presupuesto y avisa sin forzar una corrección artificial',()=>{
  const original={kilometros:100,margen:10,consumo:{fuente:'modelo_teorico',l100km:1,modeloTeorico:{tramos:[{relieveAplicado:true}]}}};
  const r=evaluarRespaldo(original,{l100km:3,fuente:'catalogo'});
  assert.ok(Math.abs(r.comparacionReferencia.litros-3.3)<1e-10);
  assert.equal(r.comparacionReferencia.comparable,false);assert.equal(original.consumo.l100km,1);
});
test('tres escenarios físicos funcionan sin IA y conservan el presupuesto principal',async()=>{
  const s=crearServicioRutas({listar:async()=>[],asistente:{analizar:async()=>{throw Error('offline');}}});
  const r=await s.estimar({origen:{latitud:14.63,longitud:-90.5},destino:{latitud:14.63,longitud:-89.99},viaje:'ida',distanciaModo:'manual',kmIda:100,combustible:'super',modalidad:'autoservicio',modeloConsumo:'teorico',precioManual:35,estimacionTeorica:{masaKg:280,velocidadKmh:75,cda:.45,rodadura:.01,eficienciaPct:25,auxiliaresKw:.1,motorEnMarchaLitrosHora:.15,ralentiLitrosHora:.15}});
  assert.deepEqual(r.escenariosConsumo.map(e=>e.escenario),['fluido','moderado','intenso']);
  assert.ok(r.escenariosConsumo.every(e=>e.litros>0&&e.hipotetico&&e.costo===e.litros/3.785411784*35));
  assert.ok(r.escenariosConsumo[2].minutos>r.escenariosConsumo[0].minutos);
  assert.equal(r.analisisIA.estado,'no_disponible');assert.equal(r.respaldo.estado,'supuestos');assert.ok(r.litros>0);
});
