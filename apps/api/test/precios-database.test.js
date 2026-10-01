import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { env } from "../src/config/env.js";
import { crearServicioPrecios } from "../src/services/precios.service.js";

test("migración y permisos de precios en PostgreSQL real", { skip: process.env.RUN_DB_TESTS !== "1" }, async (t) => {
  const schema = `precios_test_${randomUUID().replaceAll("-", "")}`;
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
  await db.query(`
    CREATE TABLE roles (id BIGINT PRIMARY KEY, codigo VARCHAR(50), activo BOOLEAN DEFAULT TRUE);
    CREATE TABLE gasolineras (id BIGINT PRIMARY KEY, nombre TEXT, activo BOOLEAN DEFAULT TRUE);
    CREATE TABLE usuarios (id BIGINT PRIMARY KEY, id_rol BIGINT, id_gasolinera BIGINT,
      nombre_completo TEXT, nombre_usuario TEXT, activo BOOLEAN DEFAULT TRUE);
    CREATE TABLE tipos_combustible (id BIGINT PRIMARY KEY, nombre TEXT, codigo TEXT,
      orden_visual SMALLINT DEFAULT 0, activo BOOLEAN DEFAULT TRUE);
    CREATE TABLE modalidades_servicio (id BIGINT PRIMARY KEY, nombre TEXT, codigo TEXT,
      orden_visual SMALLINT DEFAULT 0, activo BOOLEAN DEFAULT TRUE);
    CREATE TABLE combustibles_gasolinera (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      id_gasolinera BIGINT, id_tipo_combustible BIGINT, nombre_comercial TEXT,
      codigo TEXT, orden_visual SMALLINT DEFAULT 0, activo BOOLEAN DEFAULT TRUE,
      UNIQUE (id_gasolinera, codigo));
    CREATE TABLE precios_combustible (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      id_combustible_gasolinera BIGINT, id_modalidad_servicio BIGINT, id_usuario_registro BIGINT,
      precio NUMERIC(10,2), fecha_vigencia_inicio TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      fecha_vigencia_fin TIMESTAMPTZ);
    CREATE UNIQUE INDEX uq_precio_vigente_prueba ON precios_combustible
      (id_combustible_gasolinera, id_modalidad_servicio) WHERE fecha_vigencia_fin IS NULL;
    INSERT INTO roles VALUES (1,'administrador',TRUE),(2,'gestor_gasolinera',TRUE);
    INSERT INTO gasolineras VALUES (1,'Uno',TRUE),(2,'Dos',TRUE);
    INSERT INTO usuarios (id,id_rol,id_gasolinera,nombre_completo,nombre_usuario) VALUES
      (1,1,NULL,'Admin','admin'),(2,2,1,'Gestor','gestor');
    INSERT INTO tipos_combustible VALUES (1,'Regular','regular',1,TRUE);
    INSERT INTO modalidades_servicio VALUES (1,'Autoservicio','autoservicio',1,TRUE);
    INSERT INTO combustibles_gasolinera (id_gasolinera,id_tipo_combustible,nombre_comercial,codigo)
      VALUES (1,1,'Regular','regular'),(2,1,'Regular','regular');
  `);
  const migracion = await import("../../../database/migrations/0009_restringir_actualizacion_precios_por_horario.mjs");
  const consultas = [];
  migracion.up({ sql: (sql) => consultas.push(sql) });
  for (const sql of consultas) await db.query(sql);
  await db.query(`CREATE TRIGGER preparar_precio BEFORE INSERT ON precios_combustible
    FOR EACH ROW EXECUTE FUNCTION preparar_nuevo_precio()`);
  const servicio = crearServicioPrecios(db);
  const adminUsuario = { id: "1", rol: "administrador" };
  const gestorUsuario = { id: "2", rol: "gestor_gasolinera" };

  await t.test("horario cerrado impide agregar combustibles y precios", async () => {
    await assert.rejects(servicio.agregarCombustible(gestorUsuario, {
      idGasolinera: "1", idTipo: "1",
    }), { statusCode: 403 });
    await assert.rejects(servicio.registrar(gestorUsuario, { idGasolinera: "1", cambios: [
      { idCombustible: "1", idModalidad: "1", precio: "31.50" },
    ] }), { statusCode: 403 });
    assert.equal((await db.query("SELECT count(*)::int AS n FROM precios_combustible")).rows[0].n, 0);
  });

  await t.test("el administrador asigna horario, pero el gestor no puede modificar otra estación", async () => {
    const { rows: [reloj] } = await db.query(`
      SELECT to_char(clock_timestamp() AT TIME ZONE 'America/Guatemala' - INTERVAL '1 minute', 'HH24:MI') AS inicio
    `);
    await servicio.asignar(adminUsuario, "2", { idGasolinera: "1", horaInicio: reloj.inicio, duracion: 30 });
    await assert.rejects(servicio.registrar(gestorUsuario, { idGasolinera: "2", cambios: [
      { idCombustible: "2", idModalidad: "1", precio: "32.50" },
    ] }), { statusCode: 403 });
    assert.equal((await servicio.estado(gestorUsuario)).idGasolinera, "1");
  });

  await t.test("el trigger impide eludir la API y conserva el precio anterior", async () => {
    await assert.rejects(db.query(`
      INSERT INTO precios_combustible (id_combustible_gasolinera,id_modalidad_servicio,id_usuario_registro,precio)
      VALUES (2,1,2,33.50)
    `));
    await servicio.registrar(gestorUsuario, { idGasolinera: "1", cambios: [
      { idCombustible: "1", idModalidad: "1", precio: "31.50" },
    ] });
    await servicio.registrar(adminUsuario, { idGasolinera: "1", cambios: [
      { idCombustible: "1", idModalidad: "1", precio: "32.25" },
    ] });
    const { rows } = await db.query(`
      SELECT precio::text, fecha_vigencia_fin IS NULL AS vigente, id_usuario_registro
      FROM precios_combustible ORDER BY id
    `);
    assert.deepEqual(rows.map((r) => ({ precio: r.precio, vigente: r.vigente,
      usuario: String(r.id_usuario_registro) })), [
      { precio: "31.50", vigente: false, usuario: "2" },
      { precio: "32.25", vigente: true, usuario: "1" },
    ]);
    await servicio.revocar(adminUsuario, "2");
    await assert.rejects(servicio.registrar(gestorUsuario, { idGasolinera: "1", cambios: [
      { idCombustible: "1", idModalidad: "1", precio: "33.00" },
    ] }), { statusCode: 403 });
  });

  await t.test("la migración puede revertirse sin dejar la función dependiente de las columnas nuevas", async () => {
    const reversas = [];
    migracion.down({ sql: (sql) => reversas.push(sql) });
    for (const sql of reversas) await db.query(sql);
    const { rows: [fila] } = await db.query(`
      SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'usuarios' AND column_name = 'precio_hora_inicio'
    `, [schema]);
    assert.equal(fila.n, 0);
  });
});
