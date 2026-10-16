import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { calcularRendimientos, crearServicioBitacoraCombustible, validarCargaCombustible } from "../src/services/bitacora-combustible.service.js";
import { crearMiAutomovilRouter } from "../src/routes/mi-automovil.routes.js";
import { crearApiRouter } from "../src/routes/index.routes.js";
import { env } from "../src/config/env.js";

const conductor = { id: "7", rol: "conductor" };
const fila = (id, kilometraje, litros, tanqueLleno, fechaCarga) => ({ id, id_vehiculo: "4",
  fecha_carga: fechaCarga, kilometraje, litros, costo_total: "250.50", tanque_lleno: tanqueLleno,
  notas: null, fecha_registro: fechaCarga });

test("HU-25 valida fecha, cantidades y datos opcionales de una carga", () => {
  const datos = validarCargaCombustible({ fechaCarga: "2026-10-15T18:30:00.000Z", kilometraje: "45000.5",
    litros: "32.125", costoTotal: "250.50", tanqueLleno: true, notas: "Viaje" }, new Date("2026-10-15T19:00:00Z"));
  assert.equal(datos.kilometraje, 45000.5);
  assert.equal(datos.litros, 32.125);
  assert.equal(datos.costoTotal, 250.5);
  for (const cambio of [{ litros: 0 }, { kilometraje: -1 }, { costoTotal: "1.001" },
    { fechaCarga: "2026-02-30T12:00:00.000Z" }, { tanqueLleno: "sí" }]) {
    assert.throws(() => validarCargaCombustible({ ...datos, ...cambio }, new Date("2026-10-15T19:00:00Z")), { statusCode: 400 });
  }
});

test("HU-25 calcula rendimiento entre tanques llenos incluyendo cargas parciales", () => {
  const resumen = calcularRendimientos([
    fila("1", "1000", "40", true, "2026-09-01T12:00:00Z"),
    fila("2", "1200", "20", false, "2026-09-10T12:00:00Z"),
    fila("3", "1400", "20", true, "2026-09-20T12:00:00Z"),
  ]);
  assert.equal(resumen.cargas[0].id, "3");
  assert.equal(resumen.cargas[0].rendimientoKmLitro, 10);
  assert.equal(resumen.rendimientoPromedioKmLitro, 10);
});

test("HU-25 agrega restricciones numéricas y de propietario en PostgreSQL", async () => {
  const migracion = await import("../../../database/migrations/0021_registrar_bitacora_combustible.mjs");
  const consultas = [];
  migracion.up({ sql: (consulta) => consultas.push(consulta) });
  const sql = consultas.join("\n");
  assert.match(sql, /FOREIGN KEY \(id_vehiculo, id_usuario\)/);
  assert.match(sql, /REFERENCES vehiculos_usuario \(id, id_usuario\)/);
  assert.match(sql, /CHECK \(litros > 0 AND litros <= 10000\)/);
  assert.match(sql, /ON DELETE CASCADE/);
});

test("HU-25 relaciona lectura y escritura con vehículo y propietario autenticado", async () => {
  const consultas = [];
  const db = { query: async (sql, valores) => {
    consultas.push({ sql, valores });
    if (sql.startsWith("SELECT id FROM")) return { rows: [{ id: "4" }] };
    if (sql.includes("FROM cargas_combustible")) return { rows: [] };
    return { rows: [fila("9", "45000", "30", true, "2026-10-15T18:00:00Z")] };
  } };
  const servicio = crearServicioBitacoraCombustible(db);
  assert.deepEqual((await servicio.listar(conductor, "4")).cargas, []);
  const creada = await servicio.registrar(conductor, "4", { fechaCarga: "2026-10-15T18:00:00.000Z",
    kilometraje: 45000, litros: 30, tanqueLleno: true });
  assert.equal(creada.idVehiculo, "4");
  assert.ok(consultas.every((consulta) => consulta.valores[1] === conductor.id));
  await assert.rejects(servicio.listar({ id: "1", rol: "administrador" }, "4"), { statusCode: 403 });
  await assert.rejects(servicio.listar(conductor, "otro"), { statusCode: 400 });
});

test("HU-25 expone historial y registro con sesión, rol y protección de origen", async (t) => {
  const llamadas = [];
  const bitacora = {
    listar: async (usuario, id) => { llamadas.push(["GET", usuario.id, id]); return { idVehiculo: id, cargas: [], rendimientoPromedioKmLitro: null }; },
    registrar: async (usuario, id) => { llamadas.push(["POST", usuario.id, id]); return { id: "1", idVehiculo: id }; },
  };
  const app = express();
  app.use(express.json());
  const auth = { obtenerSesion: async (token) => token === "conductor" ? conductor : token === "admin" ? { id: "1", rol: "administrador" } : null };
  app.use("/api", crearApiRouter(auth, undefined, crearMiAutomovilRouter({}, {}, {}, bitacora)));
  app.use((error, _req, res, _next) => res.status(error.statusCode ?? 500).json({ message: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/mi-automovil/vehiculos/4/cargas`;
  const headers = { cookie: "jalapa_sesion=conductor", origin: new URL(env.frontendUrl).origin, "Content-Type": "application/json" };
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { ...headers, cookie: "jalapa_sesion=admin" } })).status, 403);
  assert.equal((await fetch(url, { headers })).status, 200);
  assert.equal((await fetch(url, { method: "POST", headers: { ...headers, origin: "https://otro.example" }, body: "{}" })).status, 403);
  assert.equal((await fetch(url, { method: "POST", headers, body: "{}" })).status, 201);
  assert.deepEqual(llamadas, [["GET", "7", "4"], ["POST", "7", "4"]]);
});
