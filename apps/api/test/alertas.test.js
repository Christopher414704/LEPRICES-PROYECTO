import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { configurarRutasAlertas, validarSuscripcion } from "../src/services/alertas.service.js";
import { env } from "../src/config/env.js";

const suscripcion={endpoint:"https://fcm.googleapis.com/fcm/send/prueba",keys:{p256dh:"a".repeat(65),auth:"b".repeat(22)}};
test("suscripciones rechazan endpoints inseguros, locales y claves inválidas",()=>{
 assert.equal(validarSuscripcion(suscripcion).endpoint,suscripcion.endpoint);
 for(const endpoint of ["http://fcm.googleapis.com/x","https://localhost/x","https://fcm.googleapis.com.ejemplo.com/x","https://user@fcm.googleapis.com/x"]) assert.throws(()=>validarSuscripcion({...suscripcion,endpoint}),{statusCode:400});
 assert.throws(()=>validarSuscripcion({...suscripcion,keys:{}}),{statusCode:400});
});
test("HTTP exige sesión, filtra favoritos por propietario y restringe eliminación",async t=>{
 const consultas=[];
 const db={query:async(sql,params)=>{consultas.push({sql,params});return {rows:[],rowCount:0};}};
 const app=express();app.use(express.json());
 app.use((req,res,next)=>{if(req.headers["x-test-user"])req.usuario={id:7};next();});
 const router=express.Router();configurarRutasAlertas(router,db);app.use(router);
 app.use((e,req,res,next)=>res.status(e.statusCode??500).json({message:e.message}));
 const server=app.listen(0,"127.0.0.1");await once(server,"listening");t.after(()=>new Promise(r=>server.close(r)));
 const url="http://127.0.0.1:"+server.address().port;
 assert.equal((await fetch(url+"/alertas/favoritos")).status,401);
 assert.equal(consultas.length,0);
 const headers={"x-test-user":"7","Content-Type":"application/json",origin:env.frontendUrl};
 assert.equal((await fetch(url+"/alertas/favoritos",{headers})).status,200);
 assert.ok(consultas[0].sql.includes("s.id_usuario="));assert.deepEqual(consultas[0].params,[7]);
 assert.equal((await fetch(url+"/alertas/suscripcion",{method:"DELETE",headers,body:JSON.stringify({suscripcion})})).status,200);
 assert.ok(consultas[1].sql.includes("AND id_usuario="));assert.deepEqual(consultas[1].params,[suscripcion.endpoint,7]);
 assert.equal((await fetch(url+"/alertas/suscripcion",{method:"DELETE",headers:{...headers,origin:"https://ajeno.test"},body:JSON.stringify({suscripcion})})).status,403);
 assert.equal(consultas.length,2);
});


import { iniciarTrabajadorAlertas } from '../src/services/alertas.service.js';
test('trabajador reserva entrega antes de enviar, aplica favoritos y objetivo y evita duplicados', async () => {
 let reservado=false, envios=0;
 const evento={id:1,fecha_creacion:new Date(),precio:28,unidad_medida:'galon',codigo_gasolinera:'estacion',nombre_gasolinera:'Estación',codigo_combustible:'regular',nombre_combustible:'Regular',codigo_modalidad:'autoservicio',publicado:true};
 const db={connect:async()=>({query:async sql=>({rows:[{obtenido:true}]}),release(){}}),query:async(sql,params)=>{
 if(sql.includes('FROM push_eventos'))return {rows:[evento]};
 if(sql.includes('FROM push_favoritos')){
  assert.ok(sql.includes('f.precio_objetivo IS NULL OR $5::NUMERIC <= f.precio_objetivo'));
  assert.ok(sql.includes('s.fecha_actualizacion <= $6'));
  assert.ok(sql.includes('u.activo=TRUE'));
  assert.deepEqual(params.slice(0,5),[1,'estacion','regular','autoservicio',28]);
  return {rows:[{id:9,endpoint:'https://fcm.googleapis.com/test',p256dh:'x',auth:'x'}]};
 }
 if(sql.includes('RETURNING id_evento')){const rowCount=reservado?0:1;reservado=true;return {rowCount};}
 return {rows:[],rowCount:1};
 }};
 const ejecutar=iniciarTrabajadorAlertas(db,{habilitado:true,automatico:false,enviar:async(_suscripcion,payload)=>{
  assert.equal(reservado,true);envios++;const datos=JSON.parse(payload);assert.match(datos.titulo,/Regular.*Estación/);
 }});
 await ejecutar();await ejecutar();assert.equal(envios,1);
});

import pg from 'pg';
import { up } from '../../../database/migrations/0018_alertas_favoritos.mjs';
test('PostgreSQL: solo las reducciones crean eventos únicos', {skip:process.env.RUN_DB_TESTS!=='1'}, async()=>{
 const cliente=new pg.Client({host:env.database.host,port:env.database.port,database:env.database.name,user:env.database.user,password:env.database.password,ssl:env.database.ssl});
 await cliente.connect();
 try {
 await cliente.query('BEGIN');
 await cliente.query(`CREATE TEMP TABLE precios_combustible(id BIGINT PRIMARY KEY,id_combustible_gasolinera BIGINT,id_modalidad_servicio BIGINT,precio NUMERIC,fecha_vigencia_inicio TIMESTAMPTZ,fecha_vigencia_fin TIMESTAMPTZ); CREATE TEMP TABLE push_eventos(id_precio BIGINT UNIQUE,precio_anterior NUMERIC);`);
 let sql;up({sql:s=>{sql=s;}});
 const funcion=sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION registrar_rebaja_push()'),sql.indexOf('CREATE TRIGGER trg_registrar_rebaja_push')).replace('FUNCTION registrar_rebaja_push()', 'FUNCTION pg_temp.registrar_rebaja_push()');
 await cliente.query(funcion);
 await cliente.query('CREATE TRIGGER prueba_rebaja AFTER INSERT ON precios_combustible FOR EACH ROW EXECUTE FUNCTION pg_temp.registrar_rebaja_push()');
 for(const [i,precio] of [30,30,32,28].entries()){
 const inicio=new Date(1700000000000+i*1000);
 await cliente.query('UPDATE precios_combustible SET fecha_vigencia_fin=$1 WHERE fecha_vigencia_fin IS NULL',[inicio]);
 await cliente.query('INSERT INTO precios_combustible VALUES($1,1,1,$2,$3,NULL)',[i+1,precio,inicio]);
 }
 const {rows}=await cliente.query('SELECT * FROM push_eventos');
 assert.equal(rows.length,1);assert.equal(Number(rows[0].precio_anterior),32);assert.equal(Number(rows[0].id_precio),4);
 }finally{await cliente.query('ROLLBACK');await cliente.end();}
});

import { crearApiRouter } from '../src/routes/index.routes.js';
test('la API integrada permite al conductor consultar configuración de avisos',async t=>{
 const app=express();app.use('/api',crearApiRouter({obtenerSesion:async()=>({id:7,rol:'conductor'})}));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
 const respuesta=await fetch('http://127.0.0.1:'+server.address().port+'/api/avisos/alertas/configuracion');
 assert.equal(respuesta.status,200);assert.equal(typeof(await respuesta.json()).disponible,'boolean');
});
