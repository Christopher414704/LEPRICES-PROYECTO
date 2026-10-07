import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { crearServicioRegistroGasolineras, validarNuevaGasolinera } from "../src/services/registro-gasolineras.service.js";
import { crearGasolinerasRouter } from "../src/routes/gasolineras.routes.js";
import { crearAuth } from "../src/routes/auth.routes.js";

const admin = { id: "1", rol: "administrador" };
const datos = { nombre: "Estación Nueva", direccion: "Calle 1", municipio: "Jalapa", departamento: "Jalapa",
  idMarca: "1", latitud: "14.63", longitud: "-89.98" };

test("valida nombre, ubicación, marca y coordenadas sin convertir vacíos en cero", () => {
  assert.equal(validarNuevaGasolinera({ ...datos, nombre: "  Estación   Nueva  " }).nombre, "Estación Nueva");
  assert.equal(validarNuevaGasolinera({ ...datos, latitud: 0, longitud: 180 }).longitud, "180.000000");
  for (const cambio of [
    { nombre: " " }, { nombre: "x".repeat(151) }, { direccion: "" }, { municipio: null },
    { departamento: "" }, { idMarca: "-1" }, { latitud: "" }, { latitud: null },
    { latitud: true }, { latitud: [] }, { latitud: "0x20" }, { latitud: "NaN" },
    { latitud: 90.001 }, { latitud: -90.001 }, { longitud: 180.001 }, { longitud: Infinity },
  ]) assert.throws(() => validarNuevaGasolinera({ ...datos, ...cambio }), { statusCode: 400 });
});

test("los roles de gestor y consulta no pueden registrar ni consultar marcas administrativas", async () => {
  const servicio = crearServicioRegistroGasolineras({});
  for (const rol of ["gestor_gasolinera", "consulta"]) {
    await assert.rejects(servicio.registrar({ rol }, datos), { statusCode: 403 });
    await assert.rejects(servicio.marcas({ rol }), { statusCode: 403 });
  }
});

function baseSimulada({ errorAuditoria, errorInsercion, administrador = true } = {}) {
  const consultas = [];
  let liberada = false;
  const cliente = {
    async query(sql, valores) {
      consultas.push({ sql, valores });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
      if (sql.includes("SELECT u.id")) return { rows: administrador ? [{ id: "1" }] : [] };
      if (sql.includes("SELECT id, nombre")) return { rows: [{ id: "1", nombre: "Marca", codigo: "marca" }] };
      if (sql.includes("INSERT INTO gasolineras")) {
        if (errorInsercion) throw errorInsercion;
        return { rows: [{ id: "12", codigo: "estacion-nueva" }] };
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

test("registro y auditoría se confirman juntos con el usuario autenticado", async () => {
  const db = baseSimulada();
  const resultado = await crearServicioRegistroGasolineras(db).registrar(admin, datos);
  assert.equal(resultado.codigo, "estacion-nueva");
  assert.equal(resultado.ubicacion.longitud, -89.98);
  const auditoria = db.consultas.find(({ sql }) => sql.includes("INSERT INTO auditoria"));
  assert.deepEqual(auditoria.valores.slice(0, 2), ["12", "1"]);
  assert.equal(JSON.parse(auditoria.valores[2]).nombre, datos.nombre);
  assert.equal(db.consultas.at(-1).sql, "COMMIT");
  assert.equal(db.liberada, true);
});

test("un error de auditoría revierte el registro y libera la conexión", async () => {
  const db = baseSimulada({ errorAuditoria: new Error("Auditoría no disponible") });
  await assert.rejects(crearServicioRegistroGasolineras(db).registrar(admin, datos), /Auditoría no disponible/);
  assert.equal(db.consultas.at(-1).sql, "ROLLBACK");
  assert.equal(db.consultas.some(({ sql }) => sql === "COMMIT"), false);
  assert.equal(db.liberada, true);
});

test("los duplicados responden 409 y una cuenta desactivada pierde sus permisos", async () => {
  const duplicado = baseSimulada({ errorInsercion: Object.assign(new Error("duplicado"), { code: "23505" }) });
  await assert.rejects(crearServicioRegistroGasolineras(duplicado).registrar(admin, datos), { statusCode: 409 });
  const desactivado = baseSimulada({ administrador: false });
  await assert.rejects(crearServicioRegistroGasolineras(desactivado).registrar(admin, datos), { statusCode: 403 });
  assert.equal(desactivado.consultas.some(({ sql }) => sql.includes("INSERT")), false);
});

test("HTTP exige sesión, administrador y origen autorizado para registrar", async (t) => {
  let registros = 0;
  const origen = "http://localhost:5173";
  const app = express();
  app.use(express.json());
  const seguridad = crearAuth({ obtenerSesion: async (token) => token === "admin" ? admin : token === "gestor" ? { id: "2", rol: "gestor_gasolinera" } : null },
    { frontendUrl: origen, nodeEnv: "test" });
  app.use("/api/gasolineras", seguridad.exigirSesion, (req, res, next) => req.method === "GET" ? next() : seguridad.validarOrigen(req, res, next),
    crearGasolinerasRouter({ registrar: async () => { registros++; return { codigo: "estacion-nueva" }; }, marcas: async () => [{ id: "1", nombre: "Marca" }] }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/gasolineras`;
  assert.equal((await fetch(url, { method: "POST", headers: { origin: origen } })).status, 401);
  assert.equal((await fetch(url, { method: "POST", headers: { origin: origen, cookie: "jalapa_sesion=gestor" } })).status, 403);
  assert.equal((await fetch(url, { method: "POST", headers: { origin: "https://otro.example", cookie: "jalapa_sesion=admin" } })).status, 403);
  assert.equal(registros, 0);
  const respuesta = await fetch(url, { method: "POST", headers: { origin: origen, cookie: "jalapa_sesion=admin", "content-type": "application/json" }, body: JSON.stringify(datos) });
  assert.equal(respuesta.status, 201);
  assert.equal((await respuesta.json()).data.codigo, "estacion-nueva");
  assert.equal(registros, 1);
  assert.equal((await fetch(url + "/marcas", { headers: { cookie: "jalapa_sesion=gestor" } })).status, 403);
});
