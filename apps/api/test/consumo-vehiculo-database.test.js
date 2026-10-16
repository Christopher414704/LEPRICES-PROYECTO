import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { env } from "../src/config/env.js";
import { crearServicioMiAutomovil } from "../src/services/mi-automovil.service.js";
import { crearServicioConsumoVehiculo } from "../src/services/consumo-vehiculo.service.js";

test("HU-27: persiste consumo por vehículo y propietario en PostgreSQL real", {
  skip: process.env.RUN_DB_TESTS !== "1" && process.env.RUN_HU27_DB !== "1",
}, async (t) => {
  const schema = `consumo_test_${randomUUID().replaceAll("-", "")}`;
  const config = { host: env.database.host, port: env.database.port, database: env.database.name,
    user: env.database.user, password: env.database.password, ssl: env.database.ssl };
  const admin = new pg.Pool(config);
  const db = new pg.Pool({ ...config, options: `-c search_path=${schema},public` });
  await admin.query(`CREATE SCHEMA ${schema}`);
  t.after(async () => {
    await db.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  await db.query(`CREATE TABLE roles(id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre TEXT,codigo TEXT UNIQUE,descripcion TEXT);
    CREATE TABLE usuarios(id BIGINT PRIMARY KEY);
    INSERT INTO usuarios VALUES (1),(2);`);
  for (const archivo of ["0016_registrar_mi_automovil", "0020_estimar_consumo_vehiculo"]) {
    const migracion = await import(`../../../database/migrations/${archivo}.mjs`);
    const consultas = [];
    migracion.up({ sql: (sql) => consultas.push(sql) });
    for (const sql of consultas) await db.query(sql);
  }
  const a = { id: "1", rol: "conductor" }, b = { id: "2", rol: "conductor" };
  const ficha = { proveedor: "fueleconomy", idExterno: "41217", marca: "Toyota", modelo: "Corolla", anio: 2020,
    combustible: "Regular Gasoline", consumo: { combinado: 7.5, unidad: "L/100 km" } };
  const garaje = crearServicioMiAutomovil(db, { ficha: async () => ficha });
  const vehiculo = await garaje.agregar(a, { idExterno: "41217", alias: "Mi automóvil", kilometrajeInicial: 50000 });
  const ajeno = await garaje.agregar(b, { idExterno: "41217", alias: "Otro automóvil", kilometrajeInicial: 10000 });
  const manual = await garaje.agregar(a, { proveedor: "manual", alias: "Registro manual", kilometrajeInicial: 0,
    datosManuales: { tipo: "auto", marca: "Toyota", modelo: "Corolla", anio: 2020 } });
  const servicio = crearServicioConsumoVehiculo(db);

  await t.test("parte del catálogo o informa datos insuficientes y persiste la medición personal", async () => {
    assert.equal((await servicio.obtener(a, vehiculo.id)).fuente, "catalogo");
    assert.equal((await servicio.obtener(a, manual.id)).motivo, "informacion_insuficiente");
    await servicio.guardar(a, vehiculo.id, { distanciaKm: "400", litros: "32" });
    const consumo = await crearServicioConsumoVehiculo(db).obtener(a, vehiculo.id);
    assert.equal(consumo.fuente, "usuario");
    assert.equal(consumo.consumoL100Km, 8);
    assert.equal(consumo.litrosPorKm * 250, 20);
    assert.equal((await servicio.obtener(b, ajeno.id)).consumoL100Km, 7.5);
  });

  await t.test("aísla lectura, escritura y eliminación por propietario", async () => {
    await assert.rejects(servicio.obtener(b, vehiculo.id), { statusCode: 404 });
    await assert.rejects(servicio.guardar(b, vehiculo.id, { distanciaKm: 100, litros: 1 }), { statusCode: 404 });
    await assert.rejects(servicio.eliminar(b, vehiculo.id), { statusCode: 404 });
    assert.equal((await servicio.obtener(a, vehiculo.id)).consumoL100Km, 8);
  });

  await t.test("actualiza una sola medición y restaura el catálogo al eliminarla", async () => {
    await servicio.guardar(a, vehiculo.id, { distanciaKm: 500, litros: 30 });
    assert.equal((await servicio.obtener(a, vehiculo.id)).consumoL100Km, 6);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM consumo_personal_vehiculo WHERE id_vehiculo=$1", [vehiculo.id])).rows[0].n, 1);
    const restaurada = await servicio.eliminar(a, vehiculo.id);
    assert.equal(restaurada.fuente, "catalogo");
    assert.equal(restaurada.consumoL100Km, 7.5);
    assert.equal((await servicio.obtener(b, ajeno.id)).consumoL100Km, 7.5);
  });

  await t.test("protege valores en SQL, elimina mediciones con el vehículo y permite revertir la migración", async () => {
    await assert.rejects(db.query("INSERT INTO consumo_personal_vehiculo(id_vehiculo,distancia_km,litros) VALUES($1,0,30)", [vehiculo.id]), { code: "23514" });
    await servicio.guardar(a, manual.id, { distanciaKm: 400, litros: 32 });
    await garaje.eliminar(a, manual.id);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM consumo_personal_vehiculo")).rows[0].n, 0);
    const migracion = await import("../../../database/migrations/0020_estimar_consumo_vehiculo.mjs");
    const sql = [];
    migracion.down({ sql: (consulta) => sql.push(consulta) });
    migracion.up({ sql: (consulta) => sql.push(consulta) });
    for (const consulta of sql) await db.query(consulta);
    assert.equal((await servicio.obtener(a, vehiculo.id)).fuente, "catalogo");
  });
});
