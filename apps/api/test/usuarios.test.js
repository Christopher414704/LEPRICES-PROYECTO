import { test } from "node:test";
import assert from "node:assert/strict";
import * as argon2 from "argon2";
import { crearServicioUsuarios, validarNuevoUsuario } from "../src/services/usuarios.service.js";

const admin = { id: "1", rol: "administrador" };

function baseTransaccional(responder) {
  const consultas = [];
  const cliente = {
    async query(sql, valores = []) {
      consultas.push({ sql, valores });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
      return responder(sql, valores);
    },
    release() {},
  };
  return { consultas, connect: async () => cliente };
}

test("solo un administrador puede consultar o modificar usuarios", async () => {
  const servicio = crearServicioUsuarios({});
  await assert.rejects(servicio.listar({ id: "2", rol: "gestor_gasolinera" }), { statusCode: 403 });
  await assert.rejects(servicio.cambiarEstado({ id: "2", rol: "consulta" }, "3", { activo: false }),
    { statusCode: 403 });
});

test("valida rol, usuario, correo y contraseña antes de escribir", () => {
  assert.equal(validarNuevoUsuario({ nombre: "Ana Pérez", usuario: "ana.perez", correo: "ANA@EXAMPLE.COM",
    password: "una-clave-segura", idRol: "1" }).correo, "ana@example.com");
  for (const datos of [
    { nombre: "Ana", usuario: "ana", correo: "ana@example.com", password: "una-clave-segura", idRol: "1" },
    { nombre: "Ana", usuario: "ana.perez", correo: "incorrecto", password: "una-clave-segura", idRol: "1" },
    { nombre: "Ana", usuario: "ana.perez", correo: "ana@example.com", password: "corta", idRol: "1" },
  ]) assert.throws(() => validarNuevoUsuario(datos), { statusCode: 400 });
});

test("crea la cuenta con Argon2 y audita datos sin contraseña", async () => {
  const db = baseTransaccional((sql, valores) => {
    if (sql.includes("r.codigo='administrador'")) return { rows: [{ id: 1 }] };
    if (sql.startsWith("SELECT id,codigo,nombre FROM roles")) {
      return { rows: [{ id: 3, codigo: "consulta", nombre: "Consulta" }] };
    }
    if (sql.includes("INSERT INTO usuarios")) return { rows: [{
      id: 8, nombre_completo: "Ana Pérez", nombre_usuario: "ana.perez",
      correo_electronico: "ana@example.com", activo: true, id_rol: 3,
      id_gasolinera: null, ultimo_acceso: null,
    }] };
    if (sql.includes("INSERT INTO auditoria_usuarios")) return { rows: [], rowCount: 1 };
    throw new Error(`Consulta inesperada: ${sql.slice(0, 90)} ${valores}`);
  });
  const password = "una-clave-segura";
  const resultado = await crearServicioUsuarios(db).registrar(admin, {
    nombre: "Ana Pérez", usuario: "ana.perez", correo: "ana@example.com", password, idRol: "3",
  });

  const insercion = db.consultas.find(({ sql }) => sql.includes("INSERT INTO usuarios"));
  assert.notEqual(insercion.valores[5], password);
  assert.equal(await argon2.verify(insercion.valores[5], password), true);
  assert.equal(resultado.password, undefined);
  const auditoria = db.consultas.find(({ sql }) => sql.includes("INSERT INTO auditoria_usuarios"));
  assert.equal(auditoria.valores[2].includes(password), false);
  assert.equal(auditoria.valores[2].includes("contrasena_hash"), false);
  assert.equal(db.consultas.at(-1).sql, "COMMIT");
});

test("un usuario o correo duplicado se rechaza y revierte la operación", async () => {
  const db = baseTransaccional((sql) => {
    if (sql.includes("r.codigo='administrador'")) return { rows: [{ id: 1 }] };
    if (sql.startsWith("SELECT id,codigo,nombre FROM roles")) {
      return { rows: [{ id: 3, codigo: "consulta", nombre: "Consulta" }] };
    }
    if (sql.includes("INSERT INTO usuarios")) throw Object.assign(new Error("duplicado"), { code: "23505" });
    throw new Error(`Consulta inesperada: ${sql.slice(0, 90)}`);
  });
  await assert.rejects(crearServicioUsuarios(db).registrar(admin, {
    nombre: "Ana Pérez", usuario: "ana.perez", correo: "ana@example.com",
    password: "una-clave-segura", idRol: "3",
  }), { statusCode: 409 });
  assert.equal(db.consultas.at(-1).sql, "ROLLBACK");
});

test("desactivar una cuenta elimina sus sesiones y registra auditoría", async () => {
  const fila = {
    id: 7, nombre_completo: "Gestor", nombre_usuario: "gestor_7", correo_electronico: "g7@example.com",
    activo: true, id_rol: 2, codigo_rol: "gestor_gasolinera", nombre_rol: "Gestor",
    id_gasolinera: 4, nombre_gasolinera: "Estación 4", ultimo_acceso: null,
  };
  const db = baseTransaccional((sql) => {
    if (sql.includes("r.codigo='administrador'")) return { rows: [{ id: 1 }] };
    if (sql.includes("WHERE u.id=$1 FOR UPDATE")) return { rows: [fila] };
    if (sql.startsWith("UPDATE usuarios SET activo")) return { rows: [{ ...fila, activo: false }] };
    if (sql.startsWith("DELETE FROM sesiones_usuario")) return { rows: [], rowCount: 1 };
    if (sql.includes("INSERT INTO auditoria_usuarios")) return { rows: [], rowCount: 1 };
    throw new Error(`Consulta inesperada: ${sql.slice(0, 90)}`);
  });
  const resultado = await crearServicioUsuarios(db).cambiarEstado(admin, "7", { activo: false });

  assert.equal(resultado.usuario.activo, false);
  assert.equal(db.consultas.some(({ sql }) => sql.startsWith("DELETE FROM sesiones_usuario")), true);
  const auditoria = db.consultas.find(({ sql }) => sql.includes("INSERT INTO auditoria_usuarios"));
  assert.deepEqual(auditoria.valores.slice(0, 3), ["7", "1", "desactivacion"]);
});
