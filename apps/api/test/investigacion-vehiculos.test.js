import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { combinarEvidencias } from '../src/services/evidencias-vehiculos.js';
import { configurarInvestigacion, parametrosInferencia, validarConsultaInvestigacion, comprobarEvidencias, completarCamposLiterales, crearInvestigacionVehiculos, crearFuentesVehiculos } from '../src/services/investigacion-vehiculos.service.js';
import { crearMiAutomovilRouter } from '../src/routes/mi-automovil.routes.js';

const entrada = { tipo: 'auto', marca: 'Ejemplo', modelo: 'Prueba', anio: 2015 };
const fuente = { id: 'wiki_es', texto: 'Ejemplo Prueba 2015. Engine displacement: 1.8 L. Engine power: 100 kW.', url: 'https://es.wikipedia.org/?curid=1', origen: 'Wikipedia' };
const hecho = { campo: 'motorLitros', valor: '1.8', unidad: 'L', fuente: 'wiki_es', cita: 'Engine displacement: 1.8 L.', version: '2015' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const cfg = configurarInvestigacion({});
test('Gemma usa Thinking solo para planificar y limita ambos tipos de inferencia',()=>{
  assert.deepEqual(parametrosInferencia(cfg,true),{reasoning_effort:'low',chat_template_kwargs:{enable_thinking:true},max_tokens:1024});
  assert.equal(parametrosInferencia(cfg).reasoning_effort,'none');
  assert.equal(parametrosInferencia(configurarInvestigacion({VEHICULOS_LLM_THINKING:'apagado'}),true).reasoning_effort,'none');
  assert.throws(()=>configurarInvestigacion({VEHICULOS_LLM_THINKING:'invalido'}));
});

test('una ficha completa no requiere modelo; campos pendientes se validan y separan la caché',async()=>{
  const {servicio,llamadas}=motor();
  assert.equal((await servicio.investigar({...entrada,camposPendientes:[]},'1')).estado,'completa');
  assert.equal(llamadas.length,0);
  assert.throws(()=>validarConsultaInvestigacion({...entrada,camposPendientes:['potencia']}),{statusCode:400});
  const parcial=await servicio.investigar({...entrada,camposPendientes:['motorLitros']},'1');
  assert.deepEqual(parcial.faltantes,[]);
  assert.equal((await servicio.investigar({...entrada,camposPendientes:['motorLitros']},'2')).cache,true);
  assert.equal((await servicio.investigar({...entrada,camposPendientes:['transmision']},'2')).cache,false);
});
function motor(opciones = {}) {
  const llamadas = [];
  const servicio = crearInvestigacionVehiculos({ configuracion: cfg, fuentes: { buscar: async () => [fuente] }, solicitar: async (url, opciones) => {
    llamadas.push({ url, ...opciones });
    if (url.endsWith('/models')) return json({ data: [{ id: cfg.modelo }] });
    return json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ datos: [hecho] }) } }], usage: { prompt_tokens: 900, completion_tokens: 600 } });
  }, ...opciones });
  return { servicio, llamadas };
}

test('Qwen limita tokens y destino a LM Studio local; valida identidad antes de consultar', () => {
  assert.equal(cfg.tokens, 2048);
  for (const valor of ['https://example.com/v1', 'http://localhost:1234/otra', 'http://usuario@localhost/v1', 'http://localhost/v1?x=1']) assert.throws(() => configurarInvestigacion({ VEHICULOS_LLM_URL: valor }));
  for (const tokens of ['2049', '0', 'NaN']) assert.throws(() => configurarInvestigacion({ VEHICULOS_LLM_MAX_TOKENS: tokens }));
  assert.equal(validarConsultaInvestigacion(entrada).consulta.anio, 2015);assert.equal(validarConsultaInvestigacion({...entrada,anio:null}).consulta.anio,null);
  for (const dato of [{ tipo: 'avion' }, { anio: [2015] }, { marca: {} }, { documento: 'a'.repeat(3001) }, { version: 'a'.repeat(121) }]) assert.throws(() => validarConsultaInvestigacion({ ...entrada, ...dato }), { statusCode: 400 });
  assert.throws(() => validarConsultaInvestigacion(null), { statusCode: 400 });
});

test('rechaza citas inventadas, unidades convertidas, campos extra y números que solo son subcadenas', () => {
  const r = comprobarEvidencias({ datos: [hecho] }, [fuente]);
  assert.equal(r.datos[0].valor, 1.8); assert.equal(r.datos[0].estado, 'pendiente_revision');
  for (const extra of [{ cita: 'La cilindrada es 1.8 L.' }, { valor: '5.0' }, { fuente: 'inventada' }, { campo: 'velocidad' }, { unidad: 'cc' }, { url: 'https://evil.test' }]) assert.equal(comprobarEvidencias({ datos: [{ ...hecho, ...extra }] }, [fuente]).datos.length, 0);
  const cilindrada = { ...hecho, campo: 'motorCc', valor: '100', unidad: 'cc', cita: 'Engine displacement: 1000 cc.' };
  assert.equal(comprobarEvidencias({ datos: [cilindrada] }, [{ ...fuente, texto: cilindrada.cita }]).datos.length, 0);
  for (const campo of ['potenciaKw','masaKg','torque','velocidad']) assert.equal(comprobarEvidencias({ datos: [{...hecho,campo}] }, [fuente]).datos.length, 0);
  const tecnica={...fuente,texto:'Fuel type: Diesel. Drive system: 4x4. Alimentación: Carburada. Transmisión final: Cadena.'};
  for(const [campo,valor,cita,aceptados] of [['combustible','Diesel','Fuel type: Diesel.',1],['traccion','4x4','Drive system: 4x4.',1],['combustible','Carburada','Alimentación: Carburada.',0],['traccion','Cadena','Transmisión final: Cadena.',0]]) {
    assert.equal(comprobarEvidencias({datos:[{...hecho,campo,valor,unidad:'',cita}]},[tecnica]).datos.length,aceptados);
  }
  assert.equal(comprobarEvidencias({ datos: [{ ...hecho, valor: '18', cita: 'Engine: 18 cc; fuel tank: 5 L.' }] }, [{ ...fuente, texto: 'Engine: 18 cc; fuel tank: 5 L.' }]).datos.length, 0);
  assert.throws(() => comprobarEvidencias({ datos: [], ficha: {} }, [fuente]), { statusCode: 502 });
});

test('respaldo literal completa combustible y tracción explícitos; omite versiones ambiguas y fuentes generales',()=>{
  const tecnica={...fuente,identidad:entrada,texto:'Motor 2.8L Turbo Diésel con intercooler.\nSistema 4x4 con bloqueo de diferencial.'};
  const vacia={datos:[],descartados:[]};
  assert.deepEqual(completarCamposLiterales(vacia,[tecnica]).datos.map(d=>[d.campo,d.valor]),[['motorLitros',2.8],['combustible','Diésel'],['traccion','4x4']]);
  assert.equal(completarCamposLiterales(vacia,[{...tecnica,identidad:undefined}]).datos.length,0);
  assert.equal(completarCamposLiterales(vacia,[{...tecnica,texto:'Motor a gasolina o Diésel según versión.\nSistema 4x4 o 4x2 según versión.'}]).datos.length,0);
  const existente={...vacia,datos:[{campo:'combustible',valor:'Diesel'}]};
  assert.equal(completarCamposLiterales(existente,[tecnica]).datos.filter(d=>d.campo==='combustible').length,1);
  assert.equal(completarCamposLiterales(vacia,[{...tecnica,texto:'Capacidad del tanque: 50 L. Transmisión final: Cadena. Alimentación: Carburada.'}]).datos.length,0);
  assert.equal(completarCamposLiterales(vacia,[{...tecnica,texto:'Tipo de Motor 4 tiempos SOHC, 1 cilindro, refrigerado por aire.'}]).datos[0].valor,1);
});
test('consulta con máximo 2048, material acotado, fuente del servidor y caché de investigaciones web', async () => {
  const { servicio, llamadas } = motor();
  const r = await servicio.investigar({ ...entrada, model: 'otro', max_tokens: 100000 }, '1');
  assert.equal(r.datos.length, 1); assert.ok(r.faltantes.includes('consumoCombinadoL100'));
  const body = JSON.parse(llamadas[1].body);
  assert.equal(body.model, 'google/gemma-4-e4b'); assert.equal(body.max_tokens, 2048); assert.equal(body.stream, false);
  assert.equal(body.reasoning_effort, 'none'); assert.equal(body.chat_template_kwargs.enable_thinking, false); assert.equal(body.temperature, 0);
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(body.messages.some(m => m.content.includes('otro')), false);
  assert.equal((await servicio.investigar(entrada, '2')).cache, true); assert.equal(llamadas.length, 2);
});

test('no inventa respuesta cuando faltan fuentes, LM Studio se apaga, JSON falla o termina por límite', async () => {
  const sin = motor({ fuentes: { buscar: async () => [] } });
  assert.equal((await sin.servicio.investigar(entrada, '1')).estado, 'sin_fuentes'); assert.equal(sin.llamadas.length, 1);
  const apagado = motor({ solicitar: async () => { throw new Error('ECONNREFUSED'); } });
  await assert.rejects(apagado.servicio.investigar(entrada, '1'), { statusCode: 503 });
  for (const salida of [{ finish_reason: 'length', message: { content: '{' } }, { finish_reason: 'stop', message: { content: 'no JSON' } }, { finish_reason: 'stop', message: { content: '', reasoning_content: '{"datos":[]}' } }]) {
    const { servicio } = motor({ solicitar: async url => url.endsWith('/models') ? json({ data: [{ id: cfg.modelo }] }) : json({ choices: [salida] }) });
    await assert.rejects(servicio.investigar(entrada, '1'), { statusCode: 502 });
  }
});

test('una sola inferencia, liberación tras error y límite por cuenta; textos aportados no se comparten', async () => {
  let resolver;
  let busquedas=0;
  const { servicio } = motor({ fuentes: { buscar: () => busquedas++ ? Promise.resolve([]) : new Promise(r => { resolver = r; }) } });
  const primera = servicio.investigar(entrada, '1');
  while (!resolver) await new Promise(r => setImmediate(r));
  await assert.rejects(servicio.investigar(entrada, '2'), { statusCode: 429 });
  resolver([]); await primera;
  const fallo = motor({ fuentes: { buscar: async () => { throw new Error('fallo'); } } });
  for (let i = 0; i < 3; i++) await assert.rejects(fallo.servicio.investigar(entrada, '1'), { statusCode: 503 });
  await assert.rejects(fallo.servicio.investigar(entrada, '1'), { statusCode: 429 });
  let consultasPrivadas = 0;
  const privado = motor({ solicitar: async url => { consultasPrivadas++; return url.endsWith('/models') ? json({ data: [{ id: cfg.modelo }] }) : json({ choices: [{ finish_reason: 'stop', message: { content: '{"datos":[]}' } }] }); } });
  await privado.servicio.investigar({ ...entrada, documento: fuente.texto }, '1');
  await privado.servicio.investigar({ ...entrada, documento: fuente.texto }, '2');
  assert.equal(consultasPrivadas, 4);
});

test('búsqueda web exige nombre exacto y excluye desambiguación; URL remota elegida por servidor', async () => {
  let llamadas = 0;
  const fuentes = crearFuentesVehiculos({ solicitar: async url => {
    assert.ok(['es.wikipedia.org', 'en.wikipedia.org'].includes(url.hostname)); llamadas++;
    if (url.searchParams.get('list')) return json({ query: { search: [{ title: 'Ejemplo Prueba extra', pageid: 1 }] } });
    throw new Error('No debe leer otro modelo');
  } });
  assert.deepEqual(await fuentes.buscar(entrada), []); assert.equal(llamadas, 3);
});

test('conserva una fuente disponible si el otro idioma falla y rechaza desambiguaciones', async () => {
  const fuentes = crearFuentesVehiculos({ solicitar: async url => {
    if (url.hostname === 'en.wikipedia.org') throw new Error('No disponible');
    if (url.searchParams.get('list')) return json({ query: { search: [{ title: 'Ejemplo Prueba', pageid: 1 }] } });
    return json({ query: { pages: { 1: { title: 'Ejemplo Prueba', extract: fuente.texto } } } });
  } });
  assert.equal((await fuentes.buscar(entrada)).length, 1);
  const ambiguas = crearFuentesVehiculos({ solicitar: async url => url.searchParams.get('list') ? json({ query: { search: [{ title: 'Ejemplo Prueba', pageid: 1 }] } }) : json({ query: { pages: { 1: { title: 'Ejemplo Prueba', extract: fuente.texto, pageprops: { disambiguation: '' } } } } }) });
  assert.deepEqual(await ambiguas.buscar(entrada), []);
});

test('endpoints de investigación limitados a conductores y usan identidad de sesión', async () => {
  let recibida;
  const investigacion = { iniciar: async (usuario, id) => { recibida = { usuario, id }; return { estado: 'investigando' }; } };
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.usuario = { rol: req.headers['x-rol'] || 'conductor', id: 'sesion' }; next(); });
  app.use(crearMiAutomovilRouter({}, {}, {}, {}, investigacion));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${base}/vehiculos/7/investigacion/progreso`, { headers: { 'x-rol': 'consulta' } })).status, 403);
    const r = await fetch(`${base}/vehiculos/7/investigacion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...entrada, usuarioId: 'otro' }) });
    assert.equal(r.status, 202); assert.equal(recibida.usuario.id, 'sesion'); assert.equal(recibida.id, '7');
  } finally { await new Promise(r => server.close(r)); }
});

test('HU-35 evidencia de tracción fusiona sinónimos, conserva AWD/4WD y no acepta negaciones', () => {
  const dato = valor => ({ campo:'traccion', valor, cita:'Drive system: '+valor+'.', urlFuente:'https://fabricante.example/ficha' });
  const iguales = combinarEvidencias([dato('FWD'), dato('Front-Wheel Drive'), dato('Tracción delantera')]);
  assert.equal(iguales.conflictos.length, 0);
  assert.equal(iguales.datos[0].evidencias.length, 3);
  assert.equal(combinarEvidencias([dato('4x4'), dato('4WD')]).conflictos.length, 0);
  assert.equal(combinarEvidencias([dato('AWD'), dato('4WD')]).conflictos.length, 1);
  assert.equal(combinarEvidencias([dato('FWD'), dato('RWD')]).datos.length, 0);
  for (const cita of ['No tiene tracción FWD.', 'Drive system: AWD optional.', 'Tracción RWD según versión.']) {
    const f = { ...fuente, texto:cita };
    const valor = cita.match(/FWD|AWD|RWD/)[0];
    const resultado = comprobarEvidencias({datos:[{campo:'traccion',valor,unidad:'',fuente:f.id,cita,version:'unspecified'}]},[f]);
    assert.equal(resultado.datos.length,0,cita);
    assert.equal(resultado.descartados.length,1,cita);
  }
});
