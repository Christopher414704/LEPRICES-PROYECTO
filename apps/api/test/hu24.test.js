import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import express from 'express';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {env} from '../src/config/env.js';
import {crearServicioMiAutomovil,fichaManual} from '../src/services/mi-automovil.service.js';
import {crearApiRouter} from '../src/routes/index.routes.js';
import {errorHandler} from '../src/middlewares/error.middleware.js';
test('HU24 valida datos manuales sin inventar consumo',()=>{
 const f=fichaManual({tipo:'auto',marca:' Toyota ',modelo:'Corolla',anio:2020,motorCc:1800});
 assert.equal(f.marca,'Toyota');assert.equal(f.motorLitros,1.8);assert.equal(f.consumo.combinado,null);
 for(const d of [{anio:0},{motorCc:-1},{tipo:'camion'},{transmision:'inventada'},{combustible:'agua'}])assert.throws(()=>fichaManual({tipo:'auto',marca:'Toyota',modelo:'Corolla',anio:2020,...d}),{statusCode:400});
});
test('HU24 requiere conductor y valida antes de consultar datos',async()=>{
 const s=crearServicioMiAutomovil({query(){throw new Error('No debe consultar');}},{ficha(){throw new Error('No debe consultar');}});
 await assert.rejects(s.listar({id:'1',rol:'administrador'}),{statusCode:403});
 await assert.rejects(s.agregar({id:'1',rol:'conductor'},{proveedor:'manual',alias:'',kilometrajeInicial:-1}),{statusCode:400});
});
test('el garaje conserva el catálogo vigente y superpone solo la investigación personal', async () => {
 const fila={id:'7',alias:'Auto',kilometraje_inicial:100,fecha_creacion:'2026-10-20',ficha_personal:null,
  ficha:{marca:'Demo',modelo:'X',traccion:null},complemento_personal:{datos:[{campo:'transmision',valor:'Manual'}]}};
 const s=crearServicioMiAutomovil({query:async()=>({rows:[fila]})},{});
 fila.ficha={...fila.ficha,traccion:'AWD'};
 const [vehiculo]=await s.listar({id:'1',rol:'conductor'});
 assert.equal(vehiculo.ficha.traccion,'AWD');
 assert.deepEqual(vehiculo.ficha.complemento,fila.complemento_personal);
 assert.equal(fila.ficha.complemento,undefined);
});
test('HU24 protege HTTP con sesión, rol y origen',async t=>{
 const app=express();app.use(express.json());app.use('/api',crearApiRouter({obtenerSesion:async token=>token==='a'.repeat(64)?{id:'1',rol:'conductor'}:token==='b'.repeat(64)?{id:'2',rol:'administrador'}:null}));
 app.use(errorHandler);
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
 const url=`http://127.0.0.1:${server.address().port}/api`;
 assert.equal((await fetch(url+'/mi-automovil/vehiculos')).status,401);
 // El nombre de cookie es el mismo que utiliza el login existente.
 const NOMBRE_COOKIE='jalapa_sesion';
 const headers={Cookie:`${NOMBRE_COOKIE}=${'a'.repeat(64)}`};
 assert.equal((await fetch(url+'/mi-automovil/vehiculos',{method:'POST',headers})).status,403);
 assert.equal((await fetch(url+'/mi-automovil/catalogo?nivel=invalido',{headers})).status,400);
 assert.equal((await fetch(url+'/gasolineras',{headers})).status,403);
 assert.equal((await fetch(url+'/mi-automovil/vehiculos',{headers:{Cookie:`${NOMBRE_COOKIE}=${'b'.repeat(64)}`}})).status,403);
});
test('HU24 persiste en PostgreSQL y aísla propietarios',{skip:process.env.RUN_HU24_DB!=='1'},async t=>{
 const schema='hu24_'+randomUUID().replaceAll('-','');
 const config={host:env.database.host,port:env.database.port,database:env.database.name,user:env.database.user,password:env.database.password,ssl:env.database.ssl};
 const admin=new pg.Pool(config);const db=new pg.Pool({...config,options:`-c search_path=${schema},public`});
 await admin.query(`CREATE SCHEMA ${schema}`);t.after(async()=>{await db.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
 await db.query('CREATE TABLE roles(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,nombre text,codigo text UNIQUE,descripcion text);CREATE TABLE usuarios(id bigint PRIMARY KEY);INSERT INTO usuarios VALUES(1),(2)');
 const m=await import('../../../database/migrations/0016_registrar_mi_automovil.mjs');let sql='';m.up({sql:v=>{sql+=v;}});await db.query(sql);
 const complementoMigracion=await import('../../../database/migrations/0022_separar_complemento_vehicular.mjs');
 sql='';complementoMigracion.up({sql:v=>{sql+=v;}});await db.query(sql);
 const ficha={proveedor:'fueleconomy',idExterno:'41217',anio:2020,marca:'Toyota',modelo:'Corolla',consumo:{combinado:7.13,unidad:'L/100 km'}};
 const s=crearServicioMiAutomovil(db,{ficha:async()=>ficha}),a={id:'1',rol:'conductor'},b={id:'2',rol:'conductor'};
 const v=await s.agregar(a,{id_usuario:'2',proveedor:'manual',alias:'Mi auto',kilometrajeInicial:800,datosManuales:{tipo:'auto',marca:'Toyota',modelo:'Corolla',anio:2020}});
 assert.equal((await s.listar(a)).length,1);assert.equal((await s.listar(b)).length,0);
 await assert.rejects(s.eliminar(b,v.id),{statusCode:404});assert.equal((await s.listar(a)).length,1);
 const c=await s.agregar(a,{idExterno:'41217',alias:'Catálogo',kilometrajeInicial:900,ficha:{marca:'Falsa'}});assert.equal(c.ficha.marca,'Toyota');assert.equal(c.ficha.consumo.combinado,7.13);
 const complemento={fuentes:[{url:'https://fabricante.example/ficha'}],datos:[]};
 await db.query('UPDATE vehiculos_usuario SET complemento_personal=$2::jsonb WHERE id=$1',[c.id,JSON.stringify(complemento)]);
 const {rows:[guardado]}=await db.query('SELECT ficha_personal,complemento_personal FROM vehiculos_usuario WHERE id=$1',[c.id]);
 assert.equal(guardado.ficha_personal,null);assert.deepEqual(guardado.complemento_personal,complemento);
 assert.deepEqual((await s.listar(a)).find(v=>v.id===c.id).ficha.complemento,complemento);
 await s.eliminar(a,v.id);assert.equal((await s.listar(a)).length,1);
});
