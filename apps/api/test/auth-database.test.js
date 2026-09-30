import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import * as argon2 from "argon2";
import { env } from "../src/config/env.js";
import { crearServicioAuth } from "../src/services/auth.service.js";

test("autenticación con PostgreSQL y Argon2 reales", {
  skip: process.env.RUN_DB_TESTS !== "1",
}, async (t) => {
  const schema = `auth_test_${randomUUID().replaceAll("-", "")}`;
  const config = {
    host: env.database.host,
    port: env.database.port,
    database: env.database.name,
    user: env.database.user,
    password: env.database.password,
    ssl: env.database.ssl,
  };
  const admin = new pg.Pool(config);
  const db = new pg.Pool({ ...config, options: `-c search_path=${schema},public` });
  await admin.query(`CREATE SCHEMA ${schema}`);
  t.after(async () => {
    await db.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  for (const archivo of [
    "0001_crear_marcas_y_gasolineras",
    "0002_crear_roles_y_usuarios",
    "0008_crear_sesiones_usuario",
  ]) {
    const migracion = await import(`../../../database/migrations/${archivo}.mjs`);
    const consultas = [];
    migracion.up({ sql: (sql) => consultas.push(sql) });
    for (const sql of consultas) await db.query(sql);
  }

  const auth = crearServicioAuth(db);
  const clave = "Prueba_inicial_2026!";
  const hash = await argon2.hash(clave, { type: argon2.argon2id });
  let contador = 0;

  async function crearUsuario() {
    const nombre = `usuario_${++contador}`;
    const { rows: [fila] } = await db.query(`
      INSERT INTO usuarios
        (id_rol, nombre_completo, nombre_usuario, correo_electronico, contrasena_hash)
      SELECT id, $1::TEXT, $1::TEXT, $1::TEXT || '@example.test', $2::TEXT
      FROM roles WHERE codigo = 'administrador' RETURNING id;
    `, [nombre, hash]);
    return { nombre, id: fila.id };
  }

  await t.test("login persiste solo el hash del token y la sesión sobrevive a otra instancia", async () => {
    const usuario = await crearUsuario();
    const sesion = await auth.iniciarSesion(` ${usuario.nombre.toUpperCase()} `, clave);
    assert.equal(sesion.usuario.id, usuario.id);
    assert.equal(sesion.usuario.contrasena_hash, undefined);
    const { rows: [fila] } = await db.query(
      "SELECT * FROM sesiones_usuario WHERE id_usuario = $1",
      [usuario.id],
    );
    assert.equal(fila.token_hash, createHash("sha256").update(sesion.token).digest("hex"));
    assert.notEqual(fila.token_hash, sesion.token);
    assert.equal((await crearServicioAuth(db).obtenerSesion(sesion.token)).id, usuario.id);
  });

  await t.test("credenciales inválidas no crean sesiones", async () => {
    const usuario = await crearUsuario();
    await assert.rejects(auth.iniciarSesion(usuario.nombre, "incorrecta"), { statusCode: 401 });
    await assert.rejects(auth.iniciarSesion("inexistente", clave), { statusCode: 401 });
    await assert.rejects(auth.iniciarSesion({}, clave), { statusCode: 400 });
    const resultado = await db.query(
      "SELECT * FROM sesiones_usuario WHERE id_usuario = $1",
      [usuario.id],
    );
    assert.equal(resultado.rowCount, 0);
  });

  await t.test("cinco fallos bloquean la cuenta durante 15 minutos", async () => {
    const usuario = await crearUsuario();
    for (let i = 0; i < 5; i += 1) {
      await assert.rejects(auth.iniciarSesion(usuario.nombre, "incorrecta"), { statusCode: 401 });
    }
    await assert.rejects(auth.iniciarSesion(usuario.nombre, clave), { statusCode: 429 });
    await db.query(
      "UPDATE usuarios SET bloqueado_hasta = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = $1",
      [usuario.id],
    );
    assert.ok((await auth.iniciarSesion(usuario.nombre, clave)).token);
  });

  await t.test("la expiración o desactivación invalida la sesión", async () => {
    const usuario = await crearUsuario();
    const sesion = await auth.iniciarSesion(usuario.nombre, clave);
    await db.query(
      "UPDATE sesiones_usuario SET fecha_expiracion = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id_usuario = $1",
      [usuario.id],
    );
    assert.equal(await auth.obtenerSesion(sesion.token), null);

    const vigente = await auth.iniciarSesion(usuario.nombre, clave);
    await db.query("UPDATE usuarios SET activo = FALSE WHERE id = $1", [usuario.id]);
    assert.equal(await auth.obtenerSesion(vigente.token), null);
  });
});
