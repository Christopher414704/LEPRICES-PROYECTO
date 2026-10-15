import { test } from "node:test";
import assert from "node:assert/strict";
import * as argon2 from "argon2";
import { crearServicioAuth, validarRegistroConductor } from "../src/services/auth.service.js";

const datos = {
  nombre: "Ana Conductora",
  usuario: "ana.conductora",
  correo: "ANA@EXAMPLE.COM",
  password: "Clave-segura-2026",
  confirmarPassword: "Clave-segura-2026",
};

function baseSimulada(responder) {
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

test("valida el registro público y rechaza cualquier intento de elegir permisos", () => {
  assert.equal(validarRegistroConductor(datos).correo, "ana@example.com");
  for (const campo of ["rol", "idRol", "idGasolinera", "activo", "permisos"]) {
    assert.throws(() => validarRegistroConductor({ ...datos, [campo]: "administrador" }), {
      statusCode: 400,
    });
  }
  assert.throws(() => validarRegistroConductor({ ...datos, confirmarPassword: "otra-clave-segura" }), {
    statusCode: 400,
  });
});

test("crea exclusivamente un conductor con Argon2 y sin gasolinera asignada", async () => {
  const db = baseSimulada((sql) => {
    if (sql.includes("codigo = 'conductor'")) return { rows: [{ id: "4" }] };
    if (sql.includes("INSERT INTO usuarios")) return { rows: [{
      id: "9", nombre_completo: datos.nombre, nombre_usuario: datos.usuario, id_gasolinera: null,
    }] };
    throw new Error(`Consulta inesperada: ${sql.slice(0, 80)}`);
  });
  const usuario = await crearServicioAuth(db).registrarConductor(datos);
  const insercion = db.consultas.find(({ sql }) => sql.includes("INSERT INTO usuarios"));

  assert.equal(db.consultas.find(({ sql }) => sql.includes("FROM roles")).sql.includes("'conductor'"), true);
  assert.equal(insercion.valores[0], "4");
  assert.equal(await argon2.verify(insercion.valores[4], datos.password), true);
  assert.deepEqual(usuario, {
    id: "9", nombre: datos.nombre, usuario: datos.usuario, rol: "conductor", idGasolinera: null,
  });
  assert.equal(db.consultas.at(-1).sql, "COMMIT");
});

test("un usuario o correo duplicado responde conflicto y revierte", async () => {
  const db = baseSimulada((sql) => {
    if (sql.includes("codigo = 'conductor'")) return { rows: [{ id: "4" }] };
    if (sql.includes("INSERT INTO usuarios")) {
      throw Object.assign(new Error("duplicado"), { code: "23505" });
    }
    throw new Error(`Consulta inesperada: ${sql.slice(0, 80)}`);
  });
  await assert.rejects(crearServicioAuth(db).registrarConductor(datos), { statusCode: 409 });
  assert.equal(db.consultas.at(-1).sql, "ROLLBACK");
});

test("la migración activa Conductor y retira el rol heredado Consulta", async () => {
  const migracion = await import("../../../database/migrations/0017_habilitar_registro_conductores.mjs");
  let sql = "";
  migracion.up({ sql: (fragmento) => { sql += fragmento; } });
  assert.match(sql, /'conductor'/);
  assert.match(sql, /activo = TRUE/i);
  assert.match(sql, /activo = FALSE WHERE codigo = 'consulta'/i);
});
