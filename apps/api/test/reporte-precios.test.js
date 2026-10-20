import {test} from 'node:test';
import assert from 'node:assert/strict';
import {crearReportePrecios} from '../src/services/reporte-precios.service.js';
import {crearPreciosRouter} from '../src/routes/precios.routes.js';
import {crearAuth} from '../src/routes/auth.routes.js';
import {errorHandler} from '../src/middlewares/error.middleware.js';
import express from 'express';
import {once} from 'node:events';

const fila={id:'5',nombre:'Estación de prueba',codigo:'prueba',municipio:'Jalapa',departamento:'Jalapa',id_combustible:'7',nombre_comercial:'Súper',tipo:'Gasolina súper',modalidad:'autoservicio',precio:'32.50',moneda:'GTQ',unidad_medida:'galon',fecha_vigencia_inicio:'2026-10-15T13:00:00Z'};
test('reporte conserva precios vigentes y ausencia, sin depender del horario de edición',async()=>{
  const reporte=crearReportePrecios({query:async(sql,params)=>{
    assert.deepEqual(params,['2','5']);assert.match(sql,/u.id_gasolinera=g.id/);assert.match(sql,/fecha_vigencia_fin IS NULL/);assert.doesNotMatch(sql,/precio_horario/);
    return {rows:[fila,{...fila,modalidad:'servicio_manual',precio:null,moneda:null,unidad_medida:null,fecha_vigencia_inicio:null}]};
  }});
  const r=await reporte({id:'2',rol:'gestor_gasolinera'},'5');
  assert.equal(r.categorias[0].precios[0].precio,32.5);assert.equal(r.categorias[1].precios[0].precio,null);assert.equal(r.categorias[1].nombre,'Servicio completo');
  assert.equal(r.gasolinera.nombre,'Estación de prueba');
});
test('reporte deniega roles ajenos, ID inválido y estación fuera de asignación',async()=>{
  let llamadas=0;const reporte=crearReportePrecios({query:async()=>{llamadas++;return {rows:[]};}});
  for(const rol of ['conductor','consulta',undefined])await assert.rejects(reporte({id:'2',rol},'5'),{statusCode:403});
  await assert.rejects(reporte({id:'2',rol:'administrador'},'5 OR true'),{statusCode:400});assert.equal(llamadas,0);
  await assert.rejects(reporte({id:'2',rol:'gestor_gasolinera'},'99'),{statusCode:404});
});
test('administrador obtiene la estación elegida; una estación sin combustibles no fabrica precios',async()=>{
  const reporte=crearReportePrecios({query:async(sql,p)=>{assert.deepEqual(p,['1','5']);return {rows:[{...fila,id_combustible:null}]};}});
  const r=await reporte({id:'1',rol:'administrador'},'5');assert.equal(r.categorias.length,2);assert.equal(r.categorias[0].precios.length,0);
});
test('endpoint de reporte exige sesión y responde sin caché',async t=>{
  const app=express(),auth=crearAuth({obtenerSesion:async token=>token==='a'.repeat(64)?{id:'2',rol:'gestor_gasolinera'}:null},{frontendUrl:'http://localhost:5173',nodeEnv:'test'});
  let llamadas=0;app.use(auth.exigirSesion);app.use('/precios',crearPreciosRouter({},async(u,id)=>{llamadas++;assert.equal(u.id,'2');assert.equal(id,'5');return {gasolinera:{id}};}));app.use(errorHandler);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
  const url=`http://127.0.0.1:${server.address().port}/precios/reporte/5`;
  assert.equal((await fetch(url)).status,401);assert.equal(llamadas,0);
  const r=await fetch(url,{headers:{Cookie:'jalapa_sesion='+'a'.repeat(64)}});assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);assert.equal((await r.json()).data.gasolinera.id,'5');
});
