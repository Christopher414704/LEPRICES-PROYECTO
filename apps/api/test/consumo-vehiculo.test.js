import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { estimarConsumo, validarMedicionConsumo, crearServicioConsumoVehiculo } from "../src/services/consumo-vehiculo.service.js";
import { crearMiAutomovilRouter } from "../src/routes/mi-automovil.routes.js";
import { crearApiRouter } from "../src/routes/index.routes.js";
import { env } from "../src/config/env.js";

const usuario = { id: "1", rol: "conductor" };
const ficha = { proveedor: "fueleconomy", combustible: "Regular Gasoline", consumo: { combinado: 7.5, unidad: "L/100 km" } };

test("estima desde el vehículo y conserva precisión para el módulo de rutas", () => {
  const estimacion = estimarConsumo(ficha);
  assert.equal(estimacion.fuente, "catalogo");
  assert.equal(estimacion.consumoL100Km, 7.5);
  assert.ok(Math.abs(estimacion.rendimientoKmLitro - 13.333333333333334) < 1e-12);
  assert.equal(estimacion.litrosPorKm * 200, 15);
  assert.equal(estimacion.unidad, "L/100 km");
  assert.equal(estimacion.referencia.ciclo, "combinado");
});

test("prioriza datos medidos del usuario sin confundir el odómetro con distancia recorrida", () => {
  const estimacion = estimarConsumo({ ...ficha, kilometrajeInicial: 150000 }, { distanciaKm: 400, litros: 32 });
  assert.equal(estimacion.fuente, "usuario");
  assert.equal(estimacion.consumoL100Km, 8);
  assert.equal(estimacion.rendimientoKmLitro, 12.5);
  assert.equal(estimacion.litrosPorKm * 250, 20);
  assert.equal(estimacion.referencia, null);
});

test("informa datos insuficientes sin deducir consumo de motor, marca ni ciclos parciales", () => {
  for (const consumo of [undefined, { ciudad: 8, carretera: 5, unidad: "L/100 km" },
    { combinado: 33, unidad: "MPG" }, { combinado: 100, unidad: "MPGe" },
    ...[0, -1, NaN, Infinity, "7.5", true, null].map((combinado) => ({ combinado, unidad: "L/100 km" }))]) {
    const estimacion = estimarConsumo({ marca: "Toyota", motorLitros: 1.8, consumo });
    assert.equal(estimacion.disponible, false);
    assert.equal(estimacion.motivo, "informacion_insuficiente");
    assert.equal(estimacion.litrosPorKm, null);
    assert.match(estimacion.mensaje, /No hay información suficiente/);
  }
});

test("no interpreta electricidad ni MPGe como litros de combustible", () => {
  const estimacion = estimarConsumo({ ...ficha, combustible: "Electricity" }, { distanciaKm: 100, litros: 10 });
  assert.equal(estimacion.disponible, false);
  assert.equal(estimacion.motivo, "vehiculo_electrico");
  assert.equal(estimacion.consumoL100Km, null);
});

test("valida medidas positivas y unidades explícitas antes de consultar", () => {
  assert.deepEqual(validarMedicionConsumo({ distanciaKm: "400.50", litros: "32" }), { distanciaKm: 400.5, litros: 32 });
  for (const valor of [null, undefined, "", " ", 0, -1, true, false, [], {}, NaN, Infinity, "1e3", "1,5", "1.001", 1000001]) {
    assert.throws(() => validarMedicionConsumo({ distanciaKm: valor, litros: 30 }), { statusCode: 400 });
  }
  for (const litros of ["", 0, -1, true, [], 100001, "0.001"]) {
    assert.throws(() => validarMedicionConsumo({ distanciaKm: 400, litros }), { statusCode: 400 });
  }
});

test("exige conductor y valida ID y datos antes de consultar la base", async () => {
  const servicio = crearServicioConsumoVehiculo({ query: () => assert.fail("No debe consultar") });
  await assert.rejects(servicio.obtener(null, "1"), { statusCode: 401 });
  await assert.rejects(servicio.guardar({ id: "1", rol: "administrador" }, "1", {}), { statusCode: 403 });
  for (const id of ["0", "-1", "1.5", "1;DELETE", "9".repeat(19)]) {
    await assert.rejects(servicio.obtener(usuario, id), { statusCode: 400 });
  }
  await assert.rejects(servicio.guardar(usuario, "1", { distanciaKm: 0, litros: 10 }), { statusCode: 400 });
});

test("lectura y escritura usan propietario de sesión e ignoran una ficha o dueño enviados por el cliente", async () => {
  const consultas = [];
  const servicio = crearServicioConsumoVehiculo({ query: async (sql, valores) => {
    consultas.push({ sql, valores });
    if (sql.includes("INSERT INTO")) return { rows: [{ fecha_actualizacion: "2026-10-16T02:00:00Z" }] };
    return { rows: [{ id: "4", ficha }] };
  } });
  const estimacion = await servicio.guardar(usuario, "4", { distanciaKm: 400, litros: 32, idUsuario: "99", ficha: { consumo: { combinado: 1 } } });
  assert.equal(estimacion.consumoL100Km, 8);
  assert.deepEqual(consultas[0].valores, ["4", usuario.id]);
  assert.deepEqual(consultas[1].valores, ["4", usuario.id, 400, 32]);
  assert.equal(estimacion.datosUsuario.actualizadoEn, "2026-10-16T02:00:00Z");
});

test("un vehículo ajeno o eliminado devuelve 404 sin escribir", async () => {
  let consultas = 0;
  const servicio = crearServicioConsumoVehiculo({ query: async () => { consultas++; return { rows: [] }; } });
  await assert.rejects(servicio.obtener(usuario, "4"), { statusCode: 404 });
  await assert.rejects(servicio.guardar(usuario, "4", { distanciaKm: 400, litros: 32 }), { statusCode: 404 });
  await assert.rejects(servicio.eliminar(usuario, "4"), { statusCode: 404 });
  assert.equal(consultas, 3);
});

test("rechaza registrar litros para un vehículo eléctrico", async () => {
  const servicio = crearServicioConsumoVehiculo({ query: async (sql) => {
    assert.ok(!sql.includes("INSERT INTO"));
    return { rows: [{ id: "4", ficha: { ...ficha, combustible: "Electricity" } }] };
  } });
  await assert.rejects(servicio.guardar(usuario, "4", { distanciaKm: 400, litros: 32 }), { statusCode: 400 });
});

test("eliminar la medición vuelve al catálogo sin modificar la ficha compartida", async () => {
  const consultas = [];
  let eliminada = false;
  const servicio = crearServicioConsumoVehiculo({ query: async (sql, valores) => {
    consultas.push({ sql, valores });
    if (sql.includes("DELETE FROM")) { eliminada = true; return { rowCount: 1 }; }
    return { rows: [{ id: "4", ficha, ...(eliminada ? {} : { distancia_km: "400", litros: "32" }) }] };
  } });
  assert.equal((await servicio.eliminar(usuario, "4")).fuente, "catalogo");
  assert.equal(consultas.filter((q) => q.sql.includes("DELETE FROM")).length, 1);
  assert.ok(consultas.every((q) => q.valores[1] === usuario.id));
});

test("HTTP integrado protege sesión, rol y origen para el consumo y acepta datos de un conductor", async (t) => {
  const llamadas = [];
  const consumo = {
    obtener: async (u, id) => { llamadas.push(["GET", u.id, id]); return estimarConsumo(ficha); },
    guardar: async (u, id, datos) => { llamadas.push(["PUT", u.id, id]); return estimarConsumo(ficha, validarMedicionConsumo(datos)); },
    eliminar: async (u, id) => { llamadas.push(["DELETE", u.id, id]); return estimarConsumo(ficha); },
  };
  const app = express();
  app.use(express.json());
  const auth = { obtenerSesion: async (token) => token === "conductor" ? usuario : token === "admin" ? { id: "2", rol: "administrador" } : null };
  app.use("/api", crearApiRouter(auth, undefined, crearMiAutomovilRouter({}, {}, consumo)));
  app.use((e, _req, res, _next) => res.status(e.statusCode ?? 500).json({ message: e.message }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/mi-automovil/vehiculos/4/consumo`;
  const headers = { cookie: "jalapa_sesion=conductor", origin: new URL(env.frontendUrl).origin, "Content-Type": "application/json" };
  for (const method of ["GET", "PUT", "DELETE"]) {
    assert.equal((await fetch(url, { method })).status, 401);
    assert.equal((await fetch(url, { method, headers: { ...headers, cookie: "jalapa_sesion=admin" } })).status, 403);
  }
  for (const method of ["PUT", "DELETE"]) {
    for (const origin of [undefined, "https://otro.example"]) {
      const opciones = { ...headers }; if (origin) opciones.origin = origin; else delete opciones.origin;
      assert.equal((await fetch(url, { method, headers: opciones })).status, 403);
    }
  }
  const lectura = await fetch(url, { headers });
  assert.equal(lectura.status, 200);
  assert.equal(lectura.headers.get("cache-control"), "no-store");
  assert.equal((await lectura.json()).data.fuente, "catalogo");
  const escritura = await fetch(url, { method: "PUT", headers, body: JSON.stringify({ distanciaKm: 400, litros: 32 }) });
  assert.equal(escritura.status, 200);
  assert.equal((await escritura.json()).data.consumoL100Km, 8);
  assert.equal((await fetch(url, { method: "DELETE", headers })).status, 200);
  assert.deepEqual(llamadas, [["GET", "1", "4"], ["PUT", "1", "4"], ["DELETE", "1", "4"]]);
});
