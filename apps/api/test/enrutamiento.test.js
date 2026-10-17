import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analizarElevacion, decodificarPolyline6, interpretarRuta, crearEnrutador } from '../src/services/enrutamiento.service.js';
import { crearServicioRutas, validarViaje, calcularEstimacion, elegirPrecios } from '../src/services/rutas.service.js';

const a = { latitud: 14.6, longitud: -90.5 }, b = { latitud: 14.6, longitud: -90.49 };
function codificar(puntos) {
  let lat = 0, lon = 0, resultado = '';
  const numero = n => { let v = n < 0 ? -n * 2 - 1 : n * 2, s = ''; while (v >= 32) { s += String.fromCharCode((v % 32) + 95); v = Math.floor(v / 32); } return s + String.fromCharCode(v + 63); };
  for (const p of puntos) { const la = Math.round(p.latitud * 1e6), lo = Math.round(p.longitud * 1e6); resultado += numero(la - lat) + numero(lo - lon); lat = la; lon = lo; }
  return resultado;
}
const leg = (puntos = [a, b], length = 1.077) => ({ shape: codificar(puntos), summary: { length, time: 150 },
  elevation: Array.from({ length: Math.ceil(length * 1000 / 30) + 1 }, (_, i) => 1000 + i * 2), elevation_interval: 30, maneuvers: [] });
const json = (legs = [leg()]) => ({ trip: { status: 0, units: 'kilometers', legs } });
const respuesta = data => new Response(JSON.stringify(data), { status: 200 });
const datos = { origen: a, destino: b, viaje: 'ida', distanciaModo: 'api', consumoManual: 8, combustible: 'regular', modalidad: 'autoservicio' };

test('polyline6: precisión, coordenadas negativas y rechazo de geometrías truncadas', () => {
  const puntos = [a, { latitud: 14.612345, longitud: -90.498765 }, b];
  assert.deepEqual(decodificarPolyline6(codificar(puntos)), puntos);
  for (const s of ['', '_', '??', '\nabc', '~~~~~~~']) assert.throws(() => decodificarPolyline6(s), { statusCode: 503 });
});
test('relieve: ruido reducido, ascenso acumulado distinto del desnivel, sin conectar datos ausentes', () => {
  const r = analizarElevacion([100, 110, 120, 130, 140, 130, 120, 110, 100], 30, .24);
  assert.equal(r.disponible, true); assert.equal(r.ascensoM, 30); assert.equal(r.descensoM, 30);
  assert.equal(analizarElevacion([100, 101, 100, 101, 100], 30, .12).ascensoM, 0);
  const incompleto = analizarElevacion([100, 110, null, 400, 410], 30, .12);
  assert.equal(incompleto.disponible, false); assert.equal(incompleto.ascensoM, 20); assert.equal(incompleto.cobertura, .8);
  assert.equal(analizarElevacion([100, -32768, 120], 30, .06).disponible, false);
  assert.equal(analizarElevacion([100, 110], 30, 10).ascensoM, null);
  const extremo=analizarElevacion(Array.from({length:3362},()=>1500),30,100.8);
  assert.equal(extremo.disponible,true);assert.equal(extremo.perfilMotor.at(-1).km,100.8);
  assert.ok(extremo.perfilMotor.every((p,i)=>!i || p.km>extremo.perfilMotor[i-1].km));
});
test('proveedor: ida y vuelta independientes, avisos de superficie/peajes y rechazo de ferries', () => {
  const salida = leg(), regreso = leg([b, a], 1.1);
  regreso.maneuvers = [{ rough: true }]; regreso.summary.has_toll = true;
  const r = interpretarRuta(json([salida, regreso]), [a, b, a], 'ida_vuelta');
  assert.equal(r.tramos[1].sentido, 'vuelta'); assert.equal(r.kilometros, 2.177);
  assert.equal(r.tramos[1].superficieIrregular, true); assert.ok(r.avisos.some(x => x.includes('peajes')));
  regreso.summary.has_ferry = true;
  assert.throws(() => interpretarRuta(json([salida, regreso]), [a, b, a], 'ida_vuelta'), { statusCode: 422 });
});
test('proveedor: unidades y cantidades validadas; no acepta ruta ajustada a una carretera lejana', () => {
  const v = json(); v.trip.units = 'miles'; assert.throws(() => interpretarRuta(v, [a, b], 'ida'));
  for (const valor of [0, -1, '1.1', 3001, null]) { const l = leg(); l.summary.length = valor; assert.throws(() => interpretarRuta(json([l]), [a, b], 'ida')); }
  assert.throws(() => interpretarRuta(json(), [a, b, a], 'ida_vuelta'));
  const incoherente = leg(); incoherente.summary.length = 500;
  assert.throws(() => interpretarRuta(json([incoherente]), [a, b], 'ida'), { statusCode: 503 });
  const lejano = leg([{ latitud: 16, longitud: -91 }, { latitud: 16, longitud: -90 }], 120);
  assert.throws(() => interpretarRuta(json([lejano]), [a, b], 'ida'), { statusCode: 422 });
});
test('caché distingue sentido del viaje aunque las coordenadas del recorrido coincidan', async () => {
  const p = crearEnrutador({ intervaloMs: 0, fetchFn: async () => respuesta(json()) });
  const ida = await p.consultar({ origen: a, destino: b, viaje: 'ida', tipo: 'auto' });
  const vuelta = await p.consultar({ origen: b, destino: a, viaje: 'vuelta', tipo: 'auto' });
  assert.equal(ida.tramos[0].sentido, 'ida'); assert.equal(vuelta.tramos[0].sentido, 'vuelta');
});
test('peticiones compartidas, caché sin datos del usuario y pausa entre salidas; perfiles auto/moto', async () => {
  let tiempo = 0, llamadas = [];
  const proveedor = crearEnrutador({ ahora: () => tiempo, esperar: async ms => { tiempo += ms; }, fetchFn: async (_url, opts) => {
    llamadas.push({ tiempo, body: JSON.parse(opts.body) }); return respuesta(json());
  } });
  const consulta = { origen: a, destino: b, viaje: 'ida', tipo: 'auto', alias: 'privado', consumo: 9 };
  const [uno, dos] = await Promise.all([proveedor.consultar(consulta), proveedor.consultar(consulta)]);
  assert.equal(llamadas.length, 1); uno.tramos[0].kilometros = 99; assert.notEqual(dos.tramos[0].kilometros, 99);
  assert.notEqual((await proveedor.consultar(consulta)).tramos[0].kilometros, 99);
  await proveedor.consultar({ ...consulta, tipo: 'moto' });
  assert.equal(llamadas.length, 2); assert.ok(llamadas[1].tiempo - llamadas[0].tiempo >= 1100);
  assert.equal(llamadas[1].body.costing, 'motorcycle'); assert.ok(!JSON.stringify(llamadas).includes('privado'));
  assert.deepEqual(llamadas[1].body.costing_options.motorcycle.speed_types, ['freeflow', 'constrained']);
  tiempo += 600_001; await proveedor.consultar(consulta); assert.equal(llamadas.length, 3);
});
test('regreso invierte puntos; ida y vuelta usa tres paradas en una petición', async () => {
  let body;
  const p = crearEnrutador({ intervaloMs: 0, fetchFn: async (_url, opts) => { body = JSON.parse(opts.body); return respuesta(json(body.locations.slice(1).map((_, i) => leg(body.locations.slice(i, i + 2).map(p => ({ latitud: p.lat, longitud: p.lon })))))); } });
  await p.consultar({ origen: a, destino: b, viaje: 'vuelta', tipo: 'auto' }); assert.equal(body.locations[0].lon, b.longitud);
  await p.consultar({ origen: a, destino: b, viaje: 'ida_vuelta', tipo: 'auto' }); assert.equal(body.locations.length, 3); assert.ok(body.locations.every(p => p.type === 'break'));
});
test('fallos no se cachean: desconexión, HTTP, JSON inválido y límite del proveedor', async () => {
  let intentos = 0;
  const p = crearEnrutador({ intervaloMs: 0, fetchFn: async () => { if (++intentos === 1) throw new TypeError('offline'); return respuesta(json()); } });
  const q = { origen: a, destino: b, viaje: 'ida', tipo: 'auto' };
  await assert.rejects(p.consultar(q), { statusCode: 503 }); assert.ok(await p.consultar(q)); assert.equal(intentos, 2);
  for (const r of [new Response('oops', { status: 500 }), new Response('no es JSON'), new Response('{}')]) {
    const fallido = crearEnrutador({ fetchFn: async () => r }); await assert.rejects(fallido.consultar(q), { statusCode: 503 });
  }
  let llamadas = 0;
  const limitado = crearEnrutador({ fetchFn: async () => { llamadas++; return new Response('', { status: 429 }); } });
  await assert.rejects(limitado.consultar(q), { statusCode: 429 }); await assert.rejects(limitado.consultar(q), { statusCode: 429 }); assert.equal(llamadas, 1);
});
test('colas acotadas y timeout de red; URL de proveedor no acepta HTTP remoto', async () => {
  assert.throws(() => crearEnrutador({ url: 'http://example.com' }));
  let terminar;
  const p = crearEnrutador({ intervaloMs: 0, fetchFn: async () => { await new Promise(r => { terminar = r; }); return respuesta(json()); } });
  const q = { origen: a, destino: b, viaje: 'ida', tipo: 'auto' };
  const consultas = [p.consultar(q), p.consultar({ ...q, tipo: 'moto' }), p.consultar({ ...q, viaje: 'vuelta' })];
  // Observa todos los rechazos antes de liberar la petición en curso.
  const completas = Promise.allSettled(consultas);
  await assert.rejects(p.consultar({ ...q, viaje: 'ida_vuelta' }), { statusCode: 429 });
  await new Promise(r => setImmediate(r)); terminar();
  // Las dos restantes también se liberan, devolviendo rutas inválidas para vuelta.
  await new Promise(r => setImmediate(r)); terminar(); await new Promise(r => setImmediate(r)); terminar(); await completas;
  const lento = crearEnrutador({ timeoutMs: 20, fetchFn: async (_u, opts) => new Promise((_r, rechazar) => {
    const timer = setTimeout(() => {}, 100); opts.signal.addEventListener('abort', () => { clearTimeout(timer); rechazar(opts.signal.reason); }, { once: true });
  }) });
  await assert.rejects(lento.consultar(q), { statusCode: 503 });
});
test('distancia automática ignora kilómetros/elevaciones manipulados; precios junto a carretera, no a cuerda A–B', async () => {
  const c = { latitud: 15, longitud: -90.25 }, destino = { latitud: 14.6, longitud: -90 };
  const tramos = [{ sentido: 'ida', kilometros: 110, segundos: 8000, puntos: [a, c, destino], relieve: { disponible: false, ascensoM: null } }];
  const e = (codigo, p) => ({ codigo, nombre: codigo, ubicacion: p, combustibles: [{ tipo: { codigo: 'regular' }, precios: { autoservicio: { precio: 30, moneda: 'GTQ', unidadMedida: 'galon', vigenteDesde: '2026-01-01' } } }] });
  let consulta, listado;
  const servicio = crearServicioRutas({ proveedor: { consultar: async p => { consulta = p; return { tramos }; } }, listar: async opts => { listado = opts; return [e('en-carretera', c), e('en-linea-recta', { latitud: 14.6, longitud: -90.25 })]; } });
  const r = await servicio.estimar({ ...datos, destino, kmIda: 1, ruta: { tramos: [] } });
  assert.equal(r.kilometros, 110); assert.equal(r.litrosBase, 8.8); assert.equal(r.distanciaFuente, 'valhalla'); assert.equal(r.precio.fuente, 'promedio_recorrido');
  assert.deepEqual(r.estaciones.map(e => e.codigo), ['en-carretera']); assert.ok(listado.bbox[3] > 15); assert.equal(consulta.tipo, 'auto');
});
test('energía de subida con peso/eficiencia explícitos; nunca añade relieve al consumo medido ni inventa elevaciones', () => {
  const v = validarViaje({ ...datos, ajustarSubidas: true, masaKg: 1500, eficienciaPct: 25 });
  const viaje = { ...v, kilometros: 100, ruta: { tramos: [{ relieve: { disponible: true, ascensoM: 1000 } }] } };
  const r = calcularEstimacion(viaje, { l100km: 8, fuente: 'manual' }, []);
  assert.ok(Math.abs(r.litrosSubidas - 1.838746875) < 1e-9); assert.equal(r.litrosBase, 8);
  assert.throws(() => calcularEstimacion(viaje, { l100km: 8, fuente: 'bitacora' }, []), { statusCode: 400 });
  viaje.ruta.tramos[0].relieve.disponible = false;
  assert.equal(calcularEstimacion(viaje, { l100km: 8 }, []).litrosSubidas, 0);
  for (const extra of [{ masaKg: null }, { masaKg: true }, { eficienciaPct: 0 }, { eficienciaPct: 46 }, { ajustarSubidas: 'true' }, { distanciaModo: 'GPS' }]) assert.throws(() => validarViaje({ ...datos, ajustarSubidas: true, masaKg: 1500, eficienciaPct: 25, ...extra }), { statusCode: 400 });
});
test('garaje se autoriza antes de consultar carreteras y tipo de moto proviene de ficha del propietario', async () => {
  let llamadas = 0, tipo;
  const servicio = crearServicioRutas({ proveedor: { consultar: async p => { llamadas++; tipo = p.tipo; return { tramos: [{ sentido: 'ida', kilometros: 10, puntos: [a, b], relieve: { disponible: false } }] }; } },
    listar: async () => [], garaje: { listar: async u => u.id === '1' ? [{ id: '7', alias: 'Moto', ficha: { tipo: 'moto', combustible: 'Regular Gasoline', consumo: { combinado: 3 } } }] : [] },
    bitacora: { historial: async () => ({ resumen: { consumoReal: null } }) } });
  await assert.rejects(servicio.estimar({ ...datos, vehiculoId: '7' }, { id: '2', rol: 'conductor' }), { statusCode: 404 }); assert.equal(llamadas, 0);
  const r = await servicio.estimar({ ...datos, vehiculoId: '7', tipoVehiculo: 'auto' }, { id: '1', rol: 'conductor' }); assert.equal(tipo, 'moto'); assert.equal(r.consumo.l100km, 3);
});
