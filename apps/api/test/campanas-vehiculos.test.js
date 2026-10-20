import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { crearCampanasVehiculos, interpretarCampanas } from '../src/services/campanas-vehiculos.service.js';
import { crearCampanasFaxcarRouter } from '../src/routes/faxcar-campanas.routes.js';
import { crearApiRouter } from '../src/routes/index.routes.js';

const usuario = { id: '1', rol: 'conductor' }, identidad = { marca: 'Honda', modelo: 'Accord', anio: 2020 };
const registro = { Make: 'HONDA', Model: 'ACCORD', ModelYear: '2020', NHTSACampaignNumber: '20V771000',
  Manufacturer: 'Honda', Summary: 'Official summary', Component: 'BODY CONTROL MODULE', ReportReceivedDate: '10/12/2020',
  Consequence: 'Official consequence', Remedy: 'Official remedy', Notes: 'Official notes', parkIt: true, parkOutSide: true };
const respuesta = (results = [registro]) => new Response(JSON.stringify({ Count: results.length, results }));
function base(ficha = identidad) {
  return { async query(sql, parametros) {
    assert.match(sql, /v.id=\$1 AND v.id_usuario=\$2/);
    return { rows: parametros[0] === '7' && parametros[1] === '1' ? [{ ficha }] : [] };
  } };
}

test('identidad del propietario, mercado y fuentes oficiales; conserva avisos sin afirmar defecto de la unidad', async () => {
  let llamadas = 0;
  const servicio = crearCampanasVehiculos(base(), { solicitar: async (url, opciones) => {
    llamadas++; assert.equal(url.origin, 'https://api.nhtsa.gov');
    assert.equal(url.searchParams.get('make'), 'Honda'); assert.equal(url.searchParams.get('model'), 'Accord');
    assert.equal(url.searchParams.get('modelYear'), '2020'); assert.equal(opciones.redirect, 'error');
    assert.ok(opciones.signal instanceof AbortSignal); return respuesta();
  } });
  await assert.rejects(servicio.consultar(null, '7'), { statusCode: 401 });
  await assert.rejects(servicio.consultar({ ...usuario, debeCambiarContrasena: true }, '7'), { statusCode: 403 });
  await assert.rejects(servicio.consultar(usuario, '../7'), { statusCode: 400 });
  await assert.rejects(servicio.consultar({ ...usuario, id: '2' }, '7'), { statusCode: 404 });
  assert.equal(llamadas, 0);
  const data = await servicio.consultar(usuario, '7');
  assert.deepEqual(data.identidad, identidad); assert.match(data.mercado, /Estados Unidos/);
  assert.match(data.aviso, /No confirman/); assert.match(data.aviso, /Guatemala/);
  assert.equal(data.campanas[0].numero, registro.NHTSACampaignNumber);
  assert.equal(data.campanas[0].solucion, registro.Remedy);
  assert.equal(data.campanas[0].noConducir, true); assert.equal(data.campanas[0].estacionarAfuera, true);
  assert.equal(new URL(data.campanas[0].fuente).hostname, 'api.nhtsa.gov');
  data.campanas.pop(); assert.equal((await servicio.consultar(usuario, '7')).campanas.length, 1);
  assert.equal(llamadas, 1);
  await assert.rejects(servicio.consultar({ ...usuario, id: '2' }, '7'), { statusCode: 404 });
});

test('rechaza identidad incompleta antes de usar red y relaciona estrictamente marca, modelo y año', async () => {
  for (const ficha of [{}, { ...identidad, anio: null }, { ...identidad, anio: 1800 }, { ...identidad, marca: '<script>' }]) {
    const servicio = crearCampanasVehiculos(base(ficha), { solicitar: () => { throw new Error('No llamar'); } });
    await assert.rejects(servicio.consultar(usuario, '7'), { statusCode: 400 });
  }
  const r = interpretarCampanas({ Count: 5, results: [registro, registro, { ...registro, Make: 'FORD' },
    { ...registro, Model: 'CIVIC' }, { ...registro, ModelYear: '2019' }] }, identidad);
  assert.equal(r.campanas.length, 1); assert.equal(r.descartadas, 3);
  assert.equal(interpretarCampanas({ Count: 1, results: [{ ...registro, Model: 'CIVIC' }] }, identidad).estado, 'sin_coincidencias');
});

test('ausencia es 200 sin coincidencias; errores HTTP, JSON y registros incompletos nunca son ausencia', async () => {
  assert.equal((await crearCampanasVehiculos(base(), { solicitar: async () => respuesta([]) }).consultar(usuario, '7')).estado, 'sin_coincidencias');
  for (const [solicitar, statusCode] of [
    [async () => { throw new Error('Desconectado'); }, 503],
    [async () => new Response('', { status: 429 }), 503],
    [async () => new Response('', { status: 500 }), 503],
    [async () => new Response('<html>error</html>'), 502],
    [async () => new Response(JSON.stringify({ Count: 1, results: [] })), 502],
    [async () => respuesta([{ ...registro, NHTSACampaignNumber: 'javascript:1' }]), 502],
    [async () => respuesta([{ ...registro, Make: undefined }]), 502],
    [async () => new Response('x'.repeat(2000001)), 502],
  ]) await assert.rejects(crearCampanasVehiculos(base(), { solicitar }).consultar(usuario, '7'), { statusCode });
});

test('timeout, reintento tras fallo, consultas compartidas, caducidad y límite por cuenta', async () => {
  const bloqueado = crearCampanasVehiculos(base(), { timeoutMs: 5, solicitar: (_url, { signal }) =>
    new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason)); }) });
  // Mantener el event loop activo mientras vence AbortSignal.timeout.
  const vivo = setInterval(() => {}, 20);
  try { await assert.rejects(bloqueado.consultar(usuario, '7'), { statusCode: 503 }); } finally { clearInterval(vivo); }
  let llamadas = 0, fecha = 1000000, resolver;
  const servicio = crearCampanasVehiculos(base(), { ahora: () => fecha, solicitar: async () => {
    llamadas++; if (llamadas === 1) throw new Error('fallo temporal');
    if (llamadas === 2) return new Promise(resolve => { resolver = () => resolve(respuesta()); });
    return respuesta();
  } });
  await assert.rejects(servicio.consultar(usuario, '7'), { statusCode: 503 });
  const a = servicio.consultar(usuario, '7'), b = servicio.consultar(usuario, '7');
  await new Promise(resolve => setImmediate(resolve)); resolver(); await Promise.all([a, b]);
  assert.equal(llamadas, 2); fecha += 900001;
  await servicio.consultar(usuario, '7'); assert.equal(llamadas, 3);
  for (let i = 0; i < 19; i++) await servicio.consultar(usuario, '7');
  await assert.rejects(servicio.consultar(usuario, '7'), { statusCode: 429 });
});

test('HTTP mantiene sesión y no-store; ignorar query de identidad y distinguir 200 vacío de 503', async t => {
  const app = express(); let error = false;
  app.use((req, _res, next) => { req.usuario = usuario; next(); });
  app.use('/faxcar', crearCampanasFaxcarRouter({ consultar: async (u, id) => {
    assert.equal(u.id, '1'); assert.equal(id, '7');
    if (error) throw Object.assign(new Error('NHTSA no disponible'), { statusCode: 503 });
    return { estado: 'sin_coincidencias', campanas: [] };
  } }));
  app.use((e, _req, res, _next) => res.status(e.statusCode ?? 500).json({ message: e.message }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/faxcar/vehiculos/7/campanas?marca=Ford`;
  const r = await fetch(url); assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal((await r.json()).data.estado, 'sin_coincidencias'); error = true;
  assert.equal((await fetch(url)).status, 503);
  const protegida = express(); protegida.use('/api', crearApiRouter({ obtenerSesion: async () => null }));
  const s = protegida.listen(0, '127.0.0.1'); await once(s, 'listening');
  t.after(() => new Promise(resolve => s.close(resolve)));
  assert.equal((await fetch(`http://127.0.0.1:${s.address().port}/api/faxcar/vehiculos/7/campanas`)).status, 401);
});
