import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { crearServicioRegistroGasolineras, validarEdicionGasolinera } from "../src/services/registro-gasolineras.service.js";
import { crearGasolinerasRouter } from "../src/routes/gasolineras.routes.js";
import { crearAuth } from "../src/routes/auth.routes.js";

const admin = { id: "1", rol: "administrador" };
const datos = { nombre: "Estación actualizada", direccion: "Nueva avenida", municipio: "Monjas",
  departamento: "Jalapa", latitud: "14.50", longitud: "-89.90" };
const original = { id: "12", id_marca: "3", codigo: "estacion-original", nombre: "Estación anterior",
  direccion: "Calle anterior", municipio: "Jalapa", departamento: "Jalapa", pais: "Guatemala",
  latitud: "14.630000", longitud: "-89.980000" };

function baseSimulada({ existe = true, administrador = true, errorActualizacion, errorAuditoria } = {}) {
  const consultas = [];
  let liberada = false;
  const cliente = {
    async query(sql, valores) {
      consultas.push({ sql, valores });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
      if (sql.includes("SELECT u.id")) return { rows: administrador ? [{ id: admin.id }] : [] };
      if (sql.includes("FROM gasolineras")) return { rows: existe ? [original] : [] };
      if (sql.includes("UPDATE gasolineras")) {
        if (errorActualizacion) throw errorActualizacion;
        const [, nombre, direccion, municipio, departamento, latitud, longitud] = valores;
        return { rows: [{ ...original, nombre, direccion, municipio, departamento, latitud, longitud }] };
      }
      if (sql.includes("INSERT INTO auditoria_gasolineras")) {
        if (errorAuditoria) throw errorAuditoria;
        return { rows: [] };
      }
      throw new Error("Consulta inesperada");
    },
    release() { liberada = true; },
  };
  return { connect: async () => cliente, consultas, get liberada() { return liberada; } };
}

test("edición valida los seis campos y coordenadas sin requerir cambiar la marca", () => {
  assert.equal(validarEdicionGasolinera({ ...datos, nombre: "  Nombre   nuevo " }).nombre, "Nombre nuevo");
  assert.equal(validarEdicionGasolinera({ ...datos, latitud: -90, longitud: 180 }).latitud, "-90.000000");
  for (const cambio of [{ nombre: "" }, { direccion: "" }, { municipio: "" }, { departamento: "" },
    { latitud: null }, { longitud: "" }, { latitud: 91 }, { longitud: -181 }, { latitud: "NaN" }]) {
    assert.throws(() => validarEdicionGasolinera({ ...datos, ...cambio }), { statusCode: 400 });
  }
});

test("rechaza roles no autorizados e identificadores inválidos antes de escribir", async () => {
  const servicio = crearServicioRegistroGasolineras({});
  for (const rol of ["consulta", "gestor_gasolinera", undefined]) {
    await assert.rejects(servicio.editar({ rol }, "12", datos), { statusCode: 403 });
  }
  for (const id of ["0", "-1", "abc", "1;DELETE", "9999999999999999999"]) {
    await assert.rejects(servicio.editar(admin, id, datos), { statusCode: 400 });
  }
  await assert.rejects(servicio.editar(admin, "12", { ...datos, latitud: "" }), { statusCode: 400 });
});

test("confirma edición y auditoría con antes, después y el administrador autenticado", async () => {
  const db = baseSimulada();
  const resultado = await crearServicioRegistroGasolineras(db).editar(admin, "12", datos);
  assert.equal(resultado.nombre, datos.nombre);
  assert.equal(resultado.codigo, original.codigo);
  assert.equal(resultado.idMarca, original.id_marca);
  assert.deepEqual(resultado.ubicacion, { latitud: 14.5, longitud: -89.9 });
  const auditoria = db.consultas.find(({ sql }) => sql.includes("INSERT INTO auditoria"));
  assert.deepEqual(auditoria.valores.slice(0, 2), ["12", admin.id]);
  const registro = JSON.parse(auditoria.valores[2]);
  assert.equal(registro.antes.nombre, original.nombre);
  assert.deepEqual(registro.antes.ubicacion, { latitud: 14.63, longitud: -89.98 });
  assert.deepEqual(registro.despues, resultado);
  assert.equal(db.consultas.at(-1).sql, "COMMIT");
  assert.equal(db.liberada, true);
});

test("revierte la edición si no puede guardar la auditoría", async () => {
  const db = baseSimulada({ errorAuditoria: new Error("Auditoría no disponible") });
  await assert.rejects(crearServicioRegistroGasolineras(db).editar(admin, "12", datos), /Auditoría no disponible/);
  assert.equal(db.consultas.at(-1).sql, "ROLLBACK");
  assert.equal(db.consultas.some(({ sql }) => sql === "COMMIT"), false);
  assert.equal(db.liberada, true);
});

test("un duplicado devuelve conflicto y no registra una edición exitosa", async () => {
  const db = baseSimulada({ errorActualizacion: Object.assign(new Error("duplicado"), { code: "23505" }) });
  await assert.rejects(crearServicioRegistroGasolineras(db).editar(admin, "12", datos), { statusCode: 409 });
  assert.equal(db.consultas.at(-1).sql, "ROLLBACK");
  assert.equal(db.consultas.some(({ sql }) => sql.includes("INSERT INTO auditoria")), false);
});

test("una estación ausente o un administrador desactivado no producen cambios", async () => {
  for (const [config, statusCode] of [[{ existe: false }, 404], [{ administrador: false }, 403]]) {
    const db = baseSimulada(config);
    await assert.rejects(crearServicioRegistroGasolineras(db).editar(admin, "12", datos), { statusCode });
    assert.equal(db.consultas.some(({ sql }) => sql.includes("UPDATE gasolineras")), false);
    assert.equal(db.consultas.at(-1).sql, "ROLLBACK");
    assert.equal(db.liberada, true);
  }
});

test("PUT exige sesión, administrador y origen autorizado; devuelve confirmación y los datos editados", async (t) => {
  const origen = "http://localhost:5173";
  let ediciones = 0;
  const seguridad = crearAuth({ obtenerSesion: async (token) => token === "admin" ? admin : token === "gestor" ? { id: "2", rol: "gestor_gasolinera" } : null },
    { frontendUrl: origen, nodeEnv: "test" });
  const app = express();
  app.use(express.json());
  app.use("/api/gasolineras", seguridad.exigirSesion, seguridad.validarOrigen, crearGasolinerasRouter({
    editar: async (usuario, id, cuerpo) => {
      ediciones++;
      assert.equal(usuario.id, admin.id);
      assert.equal(id, "12");
      assert.deepEqual(cuerpo, datos);
      return { ...datos, codigo: original.codigo };
    },
  }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/gasolineras/12`;
  const solicitar = (cookie, origin = origen) => fetch(url, { method: "PUT", headers: {
    origin, cookie, "content-type": "application/json",
  }, body: JSON.stringify(datos) });
  assert.equal((await solicitar("")).status, 401);
  assert.equal((await solicitar("jalapa_sesion=gestor")).status, 403);
  assert.equal((await solicitar("jalapa_sesion=admin", "https://otro.example")).status, 403);
  assert.equal(ediciones, 0);
  const respuesta = await solicitar("jalapa_sesion=admin");
  assert.equal(respuesta.status, 200);
  const cuerpo = await respuesta.json();
  assert.equal(cuerpo.message, "Gasolinera modificada correctamente.");
  assert.equal(cuerpo.data.nombre, datos.nombre);
  assert.equal(ediciones, 1);
});
