import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { validarViaje, calcularEstimacion, elegirPrecios, crearServicioRutas, distanciaRecta } from '../src/services/rutas.service.js';
import { crearRutasRouter } from '../src/routes/rutas.routes.js';
import { crearAuth } from '../src/routes/auth.routes.js';

const origen = { latitud: 14.6349, longitud: -90.5069 }, destino = { latitud: 14.6345, longitud: -89.9889 };
const viaje = { origen, destino, viaje: 'ida_vuelta', kmIda: 100, kmVuelta: 120, combustible: 'regular', modalidad: 'autoservicio', consumoManual: 8, margen: 10 };
const estacion = (codigo, precio, extras = {}) => ({ codigo, nombre: codigo, ubicacion: destino, municipio: 'Jalapa', departamento: 'Jalapa',
  combustibles: [{ tipo: { codigo: 'regular' }, precios: { autoservicio: { precio, moneda: 'GTQ', unidadMedida: 'galon', vigenteDesde: '2026-01-01T00:00:00Z', ...extras } } }] });

test('ida, regreso e ida y vuelta tienen distancias independientes, margen explícito y galón estadounidense', () => {
  const p = validarViaje(viaje);
  assert.equal(p.kilometros, 220);
  assert.equal(validarViaje({ ...viaje, viaje: 'vuelta', kmIda: '' }).kilometros, 120);
  assert.equal(validarViaje({ ...viaje, viaje: 'ida', kmVuelta: '' }).kilometros, 100);
  const resultado = calcularEstimacion(p, { l100km: 8, fuente: 'manual' }, [{ precioGalon: 30 }, { precioGalon: 34 }]);
  assert.ok(Math.abs(resultado.litros - 19.36) < 1e-9);
  assert.ok(Math.abs(resultado.galones - 19.36 / 3.785411784) < 1e-9);
  assert.equal(resultado.precio.promedio, 32);
  assert.equal(resultado.costo, resultado.galones * 32);
  assert.equal(resultado.distanciaFuente, 'manual');
});
test('coordenadas, kilómetros, consumo, precio y margen se validan en servidor', () => {
  for (const extra of [{ origen: null }, { origen: { ...origen, latitud: '' } }, { destino: origen }, { kmIda: 1 }, { kmVuelta: '' },
    { viaje: 'teleport' }, { kmIda: false }, { kmIda: Infinity }, { kmIda: 3001 }, { margen: -1 }, { margen: 51 },
    { precioManual: 0 }, { precioManual: ' ' }, { combustible: 'hidrogeno' }, { modalidad: 'manual' }, { codigoGasolinera: '<x>' }]) {
    assert.throws(() => validarViaje({ ...viaje, ...extra }), { statusCode: 400 });
  }
  const p = validarViaje(viaje);
  for (const l100km of [undefined, null, true, '', 0, -1, 101]) assert.throws(() => calcularEstimacion(p, { l100km }, []), { statusCode: 400 });
  assert.ok(distanciaRecta(origen, destino) > 50);
});
test('precios: deduplicación, distancia a extremos, unidad, moneda, futuro y modalidad', () => {
  const lista = [estacion('a', 30), estacion('a', 30), estacion('b', 8, { unidadMedida: 'litro' }),
    estacion('dolares', 3, { moneda: 'USD' }), estacion('futuro', 1, { vigenteDesde: '2099-01-01' }),
    estacion('invalido', -1), estacion('unidad', 2, { unidadMedida: 'barril' }), { ...estacion('lejos', 25), ubicacion: { latitud: 17, longitud: -91 } }];
  const precios = elegirPrecios(lista, validarViaje(viaje));
  assert.equal(precios.length, 2);
  assert.equal(precios[1].precioGalon, 8 * 3.785411784);
  assert.equal(elegirPrecios(lista, validarViaje({ ...viaje, modalidad: 'servicio_manual' })).length, 0);
});
test('sin precios no inventa costo y permite indicar precio propio sin alterar las estaciones', () => {
  const p = validarViaje(viaje);
  assert.equal(calcularEstimacion(p, { l100km: 8 }, []).costo, null);
  const resultado = calcularEstimacion({ ...p, precioManual: 31 }, { l100km: 8 }, []);
  assert.equal(resultado.precio.fuente, 'manual'); assert.equal(resultado.costo, resultado.galones * 31);
  assert.throws(() => calcularEstimacion({ ...p, codigoGasolinera: 'ausente' }, { l100km: 8 }, []), { statusCode: 400 });
});
test('consumo privado: prioridad de bitácora, referencia y ausencia; propietario y ficha del servidor', async () => {
  let real = 6, fuel = 'Regular Gasoline', referencia = 8;
  const garaje = { listar: async u => u.id === '1' ? [{ id: '7', alias: 'Mi vehículo', ficha: { combustible: fuel, consumo: { combinado: referencia } } }] : [] };
  const servicio = crearServicioRutas({ garaje, bitacora: { historial: async () => ({ resumen: { consumoReal: real == null ? null : { l100km: real } } }) }, listar: async () => [estacion('a', 30)] });
  const u = { id: '1', rol: 'conductor' };
  let resultado = await servicio.estimar({ ...viaje, vehiculoId: '7', consumoManual: 1, idUsuario: 'otro', precio: 1 }, u);
  assert.equal(resultado.consumo.l100km, 6); assert.equal(resultado.consumo.fuente, 'bitacora'); assert.equal(resultado.precio.precioGalon, 30);
  real = null; assert.equal((await servicio.consumoVehiculo(u, '7')).fuente, 'catalogo');
  referencia = null; assert.equal((await servicio.consumoVehiculo(u, '7')).fuente, 'sin_datos');
  await assert.rejects(servicio.estimar({ ...viaje, vehiculoId: '7' }, u), { statusCode: 400 });
  await assert.rejects(servicio.consumoVehiculo({ id: '2', rol: 'conductor' }, '7'), { statusCode: 404 });
  await assert.rejects(servicio.consumoVehiculo({ ...u, rol: 'administrador' }, '7'), { statusCode: 403 });
  await assert.rejects(servicio.consumoVehiculo(u, '0'), { statusCode: 400 });
  fuel = 'Electricity';assert.equal((await servicio.consumoVehiculo(u, '7')).l100km,null);
  await assert.rejects(servicio.estimar({...viaje,vehiculoId:'7'},u),{statusCode:400});
  fuel = 'Diesel'; referencia = 8; await assert.rejects(servicio.estimar({ ...viaje, vehiculoId: '7' }, u), { statusCode: 400 });
});
test('consulta de estaciones solo visibles, acotada y con límite explícito de muestra', async () => {
  const llamadas = [];
  const servicio = crearServicioRutas({ listar: async opciones => { llamadas.push(opciones); return Array.from({ length: 301 }, (_, i) => estacion(`s${i}`, 30)); } });
  const r = await servicio.estimar(viaje);
  assert.equal(llamadas.length, 2); assert.ok(llamadas.every(o => o.soloVisibles && o.limite === 301 && o.bbox.length === 4));
  assert.equal(r.estaciones.length, 300); assert.equal(r.precio.hayMas, true);
});

test('HTTP: público sin login; vehículo privado exige sesión, conductor y origen; respuestas no se cachean', async t => {
  const app = express(); app.use(express.json());
  const auth = crearAuth({ obtenerSesion: async token => token ? { id: '1', rol: token === 'personal' ? 'administrador' : 'conductor' } : null }, { frontendUrl: 'http://localhost:5173', nodeEnv: 'test' });
  const servicio = crearServicioRutas({ listar: async () => [] });
  app.use('/publico/rutas', crearRutasRouter(servicio, true));
  app.use('/rutas', auth.exigirSesion, (req, res, next) => req.method === 'GET' ? next() : auth.validarOrigen(req, res, next), crearRutasRouter(servicio));
  app.use((e, _req, res, _next) => res.status(e.statusCode ?? 500).json({ message: e.message }));
  const s = app.listen(0, '127.0.0.1'); await once(s, 'listening'); t.after(() => new Promise(r => s.close(r)));
  const url = `http://127.0.0.1:${s.address().port}`, headers = { 'Content-Type': 'application/json' };
  const r = await fetch(`${url}/publico/rutas/estimar`, { method: 'POST', headers, body: JSON.stringify(viaje) });
  assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store'); assert.equal((await r.json()).data.costo, null);
  assert.equal((await fetch(`${url}/publico/rutas/estimar`, { method: 'POST', headers, body: JSON.stringify({ ...viaje, vehiculoId: '7' }) })).status, 401);
  assert.equal((await fetch(`${url}/rutas/vehiculos/7/consumo`)).status, 401);
  assert.equal((await fetch(`${url}/rutas/vehiculos/7/consumo`, { headers: { cookie: 'jalapa_sesion=personal' } })).status, 403);
  assert.equal((await fetch(`${url}/rutas/estimar`, { method: 'POST', headers: { ...headers, cookie: 'jalapa_sesion=conductor' }, body: JSON.stringify(viaje) })).status, 403);
  assert.equal((await fetch(`${url}/rutas/estimar`, { method: 'POST', headers: { ...headers, cookie: 'jalapa_sesion=conductor', origin: 'http://localhost:5173' }, body: JSON.stringify(viaje) })).status, 200);
  let limitada;
  for (let i = 0; i < 21; i++) limitada = await fetch(`${url}/publico/rutas/estimar`, { method: 'POST', headers, body: JSON.stringify(viaje) });
  assert.equal(limitada.status, 429); assert.ok(Number(limitada.headers.get('retry-after')) > 0);
});
