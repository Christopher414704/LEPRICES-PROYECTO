import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import express from "express";
import pg from "pg";
import { env } from "../src/config/env.js";
import { crearServicioRegistroGasolineras } from "../src/services/registro-gasolineras.service.js";
import { listarGasolinerasConPrecios } from "../src/services/gasolineras.service.js";
import { crearPublicoRouter } from "../src/routes/publico.routes.js";

test("HU-11: registro, duplicados, auditoría y API pública en PostgreSQL real", {
  skip: process.env.RUN_DB_TESTS !== "1",
}, async (t) => {
  const schema = `gasolineras_test_${randomUUID().replaceAll("-", "")}`;
  const config = { host: env.database.host, port: env.database.port, database: env.database.name,
    user: env.database.user, password: env.database.password, ssl: env.database.ssl };
  const adminPool = new pg.Pool(config);
  const db = new pg.Pool({ ...config, options: `-c search_path=${schema},public` });
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  t.after(async () => {
    await db.end();
    await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
    await adminPool.end();
  });
  for (const archivo of [
    "0001_crear_marcas_y_gasolineras", "0002_crear_roles_y_usuarios", "0003_crear_combustibles_y_precios",
    "0007_publicar_gasolineras", "0008_crear_sesiones_usuario", "0009_restringir_actualizacion_precios_por_horario",
    "0010_limitar_gestores_a_gasolinera", "0011_registrar_gasolineras_y_auditoria",
  ]) {
    const migracion = await import(`../../../database/migrations/${archivo}.mjs`);
    const consultas = [];
    migracion.up({ sql: (sql) => consultas.push(sql) });
    for (const sql of consultas) await db.query(sql);
  }
  const { rows: [marca] } = await db.query("INSERT INTO marcas (nombre,codigo) VALUES ('Marca de prueba','marca-prueba') RETURNING id");
  const { rows: [usuario] } = await db.query(`
    INSERT INTO usuarios (id_rol,nombre_completo,nombre_usuario,correo_electronico,contrasena_hash)
    SELECT id,'Administrador de prueba','admin_prueba','admin@example.test','hash-prueba'
    FROM roles WHERE codigo='administrador' RETURNING id
  `);
  const administrador = { id: usuario.id, rol: "administrador" };
  const servicio = crearServicioRegistroGasolineras(db);
  const datos = { nombre: "Estación Montaña", direccion: "Calle 1", municipio: "Jalapa", departamento: "Jalapa",
    idMarca: marca.id, latitud: "14.630001", longitud: "-89.980001" };
  let creada;

  await t.test("persiste coordenadas PostGIS, publicación y auditoría del administrador", async () => {
    creada = await servicio.registrar(administrador, datos);
    const { rows: [fila] } = await db.query(`
      SELECT g.visible_publico, ST_X(g.ubicacion::geometry) AS longitud,
        ST_Y(g.ubicacion::geometry) AS latitud, a.id_usuario, a.datos, a.operacion
      FROM gasolineras g JOIN auditoria_gasolineras a ON a.id_gasolinera=g.id WHERE g.codigo=$1
    `, [creada.codigo]);
    assert.equal(fila.visible_publico, true);
    assert.equal(fila.longitud, -89.980001);
    assert.equal(fila.latitud, 14.630001);
    assert.equal(fila.id_usuario, usuario.id);
    assert.equal(fila.datos.nombre, datos.nombre);
    assert.equal(fila.operacion, "registro");
  });

  await t.test("aparece inmediatamente en el listado y API públicos sin precios inventados", async (st) => {
    const listado = await listarGasolinerasConPrecios({ soloVisibles: true }, db);
    assert.equal(listado[0].codigo, creada.codigo);
    assert.deepEqual(listado[0].combustibles, []);
    const app = express();
    app.use("/api/publico", crearPublicoRouter((opciones) => listarGasolinerasConPrecios(opciones, db), db));
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    st.after(() => new Promise((resolve) => server.close(resolve)));
    const respuesta = await fetch(`http://127.0.0.1:${server.address().port}/api/publico/gasolineras?codigo=${creada.codigo}`);
    assert.equal(respuesta.status, 200);
    assert.equal((await respuesta.json()).data[0].codigo, creada.codigo);
  });

  await t.test("rechaza nombres normalizados y coordenadas duplicadas incluso en solicitudes concurrentes", async () => {
    await assert.rejects(servicio.registrar(administrador, { ...datos, nombre: "  ESTACION   MONTANA  ", latitud: 15, longitud: -90 }), { statusCode: 409 });
    await assert.rejects(servicio.registrar(administrador, { ...datos, nombre: "Otro nombre" }), { statusCode: 409 });
    const simultaneas = await Promise.allSettled([
      servicio.registrar(administrador, { ...datos, nombre: "Concurrente A", latitud: 15, longitud: -90 }),
      servicio.registrar(administrador, { ...datos, nombre: "Concurrente B", latitud: 15, longitud: -90 }),
    ]);
    assert.equal(simultaneas.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(simultaneas.find((r) => r.status === "rejected").reason.statusCode, 409);
    const { rows: [conteo] } = await db.query("SELECT (SELECT count(*)::int FROM gasolineras) AS estaciones,(SELECT count(*)::int FROM auditoria_gasolineras) AS auditorias");
    assert.equal(conteo.estaciones, 2);
    assert.equal(conteo.auditorias, 2);
  });

  await t.test("si la auditoría falla PostgreSQL revierte también la estación", async () => {
    await db.query("ALTER TABLE auditoria_gasolineras ADD CONSTRAINT simular_fallo_auditoria CHECK (datos->>'nombre' <> 'Fallo auditoría')");
    await assert.rejects(servicio.registrar(administrador, { ...datos, nombre: "Fallo auditoría", latitud: 16, longitud: -91 }));
    assert.equal((await db.query("SELECT count(*)::int AS n FROM gasolineras WHERE nombre='Fallo auditoría'")).rows[0].n, 0);
  });
});
