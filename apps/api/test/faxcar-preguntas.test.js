import {test} from 'node:test';
import assert from 'node:assert/strict';
import {crearPreguntasFaxcar,fuentesDeFicha,validarCitasFaxcar,materialPregunta} from '../src/services/faxcar-preguntas.service.js';
const cita='El aceite del motor se sustituye cada 5000 km.',url='https://fabricante.example/manual.pdf';
const ficha={complemento:{datos:[{cita,urlFuente:url}]}};
const variables={VEHICULOS_LLM_URL:'http://127.0.0.1:1234/v1',VEHICULOS_LLM_MODELO:'qwen3-4b-instruct-2507'};
const usuario={id:'7',rol:'conductor'};
function servicio({documentos=true,propio=true,solicitar=async()=>Response.json({choices:[{message:{content:JSON.stringify({citas:[{fuenteId:'0',cita}]})}}]})}={}){return crearPreguntasFaxcar({query:async(sql,p)=>{assert.match(sql,/v.id_usuario=\$2/);assert.deepEqual(p,['5','7']);assert.match(sql,/complemento_personal/);return {rows:propio?[{ficha:documentos?ficha:{}}]:[]};}},{variables,solicitar});}
test('preguntas FAXCAR leen el complemento separado de un vehículo del catálogo', async () => {
 const db={query:async()=>({rows:[{ficha:{marca:'Demo',modelo:'Auto'},ficha_personal:null,complemento_personal:ficha.complemento}]})};
 const r=await crearPreguntasFaxcar(db,{variables,solicitar:async()=>Response.json({choices:[{message:{content:JSON.stringify({citas:[{fuenteId:'0',cita}]})}}]})}).preguntar(usuario,'5','¿Qué aceite indica el documento?');
 assert.equal(r.estado,'con_fuentes');assert.equal(r.citas[0].url,url);
});
test('HU32 respuestas literales enlazan la fuente sin publicar diagnóstico libre',async()=>{
 const r=await servicio().preguntar(usuario,'5','¿Qué aceite indica el documento?');assert.equal(r.estado,'con_fuentes');assert.equal(r.citas[0].url,url);assert.equal(r.citas[0].cita,cita);assert.match(r.aviso,/no es un diagnóstico/);
});
test('HU32 sin evidencia no inventa respuesta ni llama a IA',async()=>{
 const r=await servicio({documentos:false,solicitar:()=>{throw Error('No debe llamar');}}).preguntar(usuario,'5','¿Qué aceite usa?');assert.equal(r.estado,'sin_documentos');
 const vacio=await servicio({solicitar:async()=>Response.json({choices:[{message:{content:'{"citas":[]}'}}]})}).preguntar(usuario,'5','¿Qué aceite usa?');assert.equal(vacio.estado,'sin_evidencia');
});
test('HU32 sesión, vehículo ajeno y pregunta inválida no consultan el proveedor',async()=>{
 const s=servicio({propio:false,solicitar:()=>{throw Error('No debe llamar');}});await assert.rejects(s.preguntar(null,'5','Pregunta válida'),{statusCode:401});await assert.rejects(s.preguntar(usuario,'5','Pregunta válida'),{statusCode:404});for(const pregunta of ['',null,'x','x'.repeat(401)])await assert.rejects(s.preguntar(usuario,'5',pregunta),{statusCode:400});
});
test('HU32 rechaza citas inventadas, fuentes falsas, JSON malformado y texto libre',async()=>{
 for(const content of ['mal','{"respuesta":"Motor averiado"}','{"citas":[{"fuenteId":"9","cita":"texto inventado"}]}','{"citas":[{"fuenteId":"0","cita":"Cambiar cada 10000 km"}]}'])await assert.rejects(servicio({solicitar:async()=>Response.json({choices:[{message:{content}}]})}).preguntar(usuario,'5','¿Qué aceite usa?'),{statusCode:502});
});
test('HU32 errores de red y proveedor se controlan y liberan la inferencia',async()=>{
 for(const solicitar of [async()=>{throw new TypeError('red');},async()=>{throw new DOMException('','TimeoutError');},async()=>new Response(null,{status:429})])await assert.rejects(servicio({solicitar}).preguntar(usuario,'5','¿Qué aceite usa?'),{statusCode:503});
 let n=0;const s=servicio({solicitar:async()=>{if(++n===1)throw Error('red');return Response.json({choices:[{message:{content:'{"citas":[]}'}}]});}});await assert.rejects(s.preguntar(usuario,'5','¿Qué aceite usa?'));assert.equal((await s.preguntar(usuario,'5','¿Qué aceite usa?')).estado,'sin_evidencia');
});
test('HU32 no admite inferencias simultáneas',async()=>{
 let resolver;const s=servicio({solicitar:()=>new Promise(r=>resolver=r)}),primera=s.preguntar(usuario,'5','¿Qué aceite usa?');await new Promise(r=>setImmediate(r));await assert.rejects(s.preguntar(usuario,'5','¿Qué aceite usa?'),{statusCode:429});resolver(Response.json({choices:[{message:{content:'{"citas":[]}'}}]}));await primera;
});
test('HU32 solo conserva fuentes HTTPS, elimina duplicados y recupera fragmentos relevantes',()=>{
 const f=fuentesDeFicha({complemento:{datos:[{cita,urlFuente:url},{cita,urlFuente:url},{cita,urlFuente:'javascript:alert(1)'},{cita:'breve',urlFuente:url}]}});assert.equal(f.length,1);assert.equal(materialPregunta('mantenimiento aceite',f)[0].relevancia>0,true);assert.throws(()=>validarCitasFaxcar({citas:Array(6).fill({})},f),{statusCode:502});
});

test('HU32 HTTP protege sesión, origen y contraseña inicial, y no cachea respuestas',async t=>{
 const {default:express}=await import('express');const {once}=await import('node:events');const {crearAuth}=await import('../src/routes/auth.routes.js');const {crearPreguntasFaxcarRouter}=await import('../src/routes/faxcar-preguntas.routes.js');
 const app=express();app.use(express.json());const seguridad=crearAuth({obtenerSesion:async token=>token==='valido'?usuario:token==='inicial'?{...usuario,debeCambiarContrasena:true}:null},{frontendUrl:'http://localhost:5173',nodeEnv:'test'});
 app.use(seguridad.exigirSesion,seguridad.validarOrigen,crearPreguntasFaxcarRouter(servicio()));app.use((e,_req,res,_next)=>res.status(e.statusCode??500).json({message:e.message}));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));const url='http://127.0.0.1:'+server.address().port+'/vehiculos/5/preguntar';
 const llamar=(token,origin='http://localhost:5173')=>fetch(url,{method:'POST',headers:{origin,cookie:'jalapa_sesion='+token,'Content-Type':'application/json'},body:JSON.stringify({pregunta:'¿Qué aceite usa?'})});
 assert.equal((await llamar('ausente')).status,401);assert.equal((await llamar('valido','https://ajeno.test')).status,403);assert.equal((await llamar('inicial')).status,403);const r=await llamar('valido');assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal((await r.json()).data.estado,'con_fuentes');
});
