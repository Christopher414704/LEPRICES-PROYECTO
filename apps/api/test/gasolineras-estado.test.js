import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { crearServicioRegistroGasolineras } from "../src/services/registro-gasolineras.service.js";
import { crearGasolinerasRouter } from "../src/routes/gasolineras.routes.js";
import { crearAuth } from "../src/routes/auth.routes.js";

const admin = { id: "1", rol: "administrador" };
const estacion = { id: "12", codigo: "estacion-historica", nombre: "Estación histórica", activo: true, visible_publico: true };

function baseSimulada({ fila = estacion, administrador = true, errorAuditoria } = {}) {
  const consultas = [];
  let liberada = false;
  const cliente = {
    async query(sql, valores) {
      consultas.push({ sql, valores });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
      if (sql.includes("SELECT u.id")) return { rows: administrador ? [{ id: admin.id }] : [] };
      if (sql.includes("FROM gasolineras")) return { rows: fila ? [fila] : [] };
      if (sql.includes("UPDATE gasolineras")) return { rows: [{ ...fila, activo: valores[1] }] };
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

test("cambiar estado exige administrador, identificador válido y un booleano explícito", async () => {
  const servicio = crearServicioRegistroGasolineras({});
  for (const rol of ["gestor_gasolinera", "consulta", undefined]) {
    await assert.rejects(servicio.cambiarEstado({ rol }, "12", { activo: false }), { statusCode: 403 });
    await assert.rejects(servicio.listarAdministracion({ rol }), { statusCode: 403 });
  }
  for (const activo of [undefined, null, "false", "true", 0, 1, [], {}]) {
    await assert.rejects(servicio.cambiarEstado(admin, "12", { activo }), { statusCode: 400 });
  }
  for (const id of [undefined, "0", "-1", "abc", "12;DELETE", "9999999999999999999"]) {
    await assert.rejects(servicio.cambiarEstado(admin, id, { activo: false }), { statusCode: 400 });
  }
});

test("desactivación y auditoría se confirman juntas con estado anterior y posterior", async () => {
  const db = baseSimulada();
  const resultado = await crearServicioRegistroGasolineras(db).cambiarEstado(admin, "12", { activo: false });
  assert.equal(resultado.cambiado, true);
  assert.equal(resultado.gasolinera.activo, false);
  assert.equal(resultado.gasolinera.codigo, estacion.codigo);
  assert.equal(resultado.gasolinera.visiblePublico, true);
  const auditoria = db.consultas.find(({ sql }) => sql.includes("INSERT INTO auditoria"));
  assert.deepEqual(auditoria.valores.slice(0, 3), ["12", admin.id, "desactivacion"]);
  const registro = JSON.parse(auditoria.valores[3]);
  assert.equal(registro.antes.activo, true);
  assert.deepEqual(registro.despues, resultado.gasolinera);
  assert.equal(db.consultas.at(-1).sql, "COMMIT");
  assert.equal(db.liberada, true);
});

test("reactiva una estación preservando su configuración privada de publicación", async () => {
  const db = baseSimulada({ fila: { ...estacion, activo: false, visible_publico: false } });
  const resultado = await crearServicioRegistroGasolineras(db).cambiarEstado(admin, "12", { activo: true });
  assert.equal(resultado.gasolinera.activo, true);
  assert.equal(resultado.gasolinera.visiblePublico, false);
  const auditoria = db.consultas.find(({ sql }) => sql.includes("INSERT INTO auditoria"));
  assert.equal(auditoria.valores[2], "reactivacion");
  assert.equal(JSON.parse(auditoria.valores[3]).antes.activo, false);
});

test("repetir el estado actual no escribe ni duplica auditorías", async () => {
  for (const activo of [true, false]) {
    const db = baseSimulada({ fila: { ...estacion, activo } });
    const resultado = await crearServicioRegistroGasolineras(db).cambiarEstado(admin, "12", { activo });
    assert.equal(resultado.cambiado, false);
    assert.equal(resultado.gasolinera.activo, activo);
    assert.equal(db.consultas.some(({ sql }) => /^\s*(UPDATE|INSERT)\b/.test(sql)), false);
    assert.equal(db.consultas.at(-1).sql, "COMMIT");
    assert.equal(db.liberada, true);
  }
});

test("una auditoría fallida revierte tanto desactivación como reactivación", async () => {
  for (const activo of [true, false]) {
    const db = baseSimulada({ fila: { ...estacion, activo }, errorAuditoria: new Error("Auditoría no disponible") });
    await assert.rejects(crearServicioRegistroGasolineras(db).cambiarEstado(admin, "12", { activo: !activo }), /Auditoría no disponible/);
    assert.equal(db.consultas.at(-1).sql, "ROLLBACK");
    assert.equal(db.consultas.some(({ sql }) => sql === "COMMIT"), false);
    assert.equal(db.liberada, true);
  }
});

test("una estación ausente o un administrador desactivado no pueden cambiar estado", async () => {
  for (const [config, statusCode] of [[{ fila: null }, 404], [{ administrador: false }, 403]]) {
    const db = baseSimulada(config);
    await assert.rejects(crearServicioRegistroGasolineras(db).cambiarEstado(admin, "12", { activo: false }), { statusCode });
    assert.equal(db.consultas.some(({ sql }) => /^\s*(UPDATE|INSERT)\b/.test(sql)), false);
    assert.equal(db.consultas.at(-1).sql, "ROLLBACK");
  }
});

test("el catálogo administrativo incluye estaciones inactivas sin exponer historiales de precios", async () => {
  const filas = [estacion, { ...estacion, id: "13", activo: false, latitud: "14.63", longitud: "-89.98" }];
  const servicio = crearServicioRegistroGasolineras({ query: async () => ({ rows: filas }) });
  const listado = await servicio.listarAdministracion(admin);
  assert.equal(listado.length, 2);
  assert.equal(listado[1].id, "13");
  assert.equal(listado[1].activo, false);
  assert.deepEqual(listado[1].ubicacion, { latitud: 14.63, longitud: -89.98 });
  assert.equal(listado[1].combustibles, undefined);
});

test("HTTP protege catálogo y PATCH; confirma desactivación, reactivación y solicitudes repetidas", async (t) => {
  const origen = "http://localhost:5173";
  let activo = true;
  let cambios = 0;
  const seguridad = crearAuth({ obtenerSesion: async (token) => token === "admin" ? admin : token === "gestor" ? { id: "2", rol: "gestor_gasolinera" } : null },
    { frontendUrl: origen, nodeEnv: "test" });
  const app = express();
  app.use(express.json());
  app.use("/api/gasolineras", seguridad.exigirSesion,
    (req, res, next) => req.method === "GET" ? next() : seguridad.validarOrigen(req, res, next),
    crearGasolinerasRouter({
      listarAdministracion: async () => [{ id: "12", activo }],
      cambiarEstado: async (usuario, id, cuerpo) => {
        assert.equal(usuario.id, admin.id);
        assert.equal(id, "12");
        const cambiado = activo !== cuerpo.activo;
        if (cambiado) cambios++;
        activo = cuerpo.activo;
        return { gasolinera: { id, activo }, cambiado };
      },
    }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/gasolineras`;
  const solicitar = (cookie, nuevo = false, origin = origen) => fetch(`${url}/12/estado`, {
    method: "PATCH", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify({ activo: nuevo }),
  });
  assert.equal((await solicitar("")).status, 401);
  assert.equal((await solicitar("jalapa_sesion=gestor")).status, 403);
  assert.equal((await solicitar("jalapa_sesion=admin", false, "https://otro.example")).status, 403);
  assert.equal((await solicitar("jalapa_sesion=admin", false, "")).status, 403);
  assert.equal(cambios, 0);
  assert.equal((await fetch(`${url}/administracion`)).status, 401);
  assert.equal((await fetch(`${url}/administracion`, { headers: { cookie: "jalapa_sesion=gestor" } })).status, 403);
  let respuesta = await solicitar("jalapa_sesion=admin");
  assert.equal(respuesta.status, 200);
  assert.equal((await respuesta.json()).message, "Gasolinera desactivada correctamente.");
  respuesta = await fetch(`${url}/administracion`, { headers: { cookie: "jalapa_sesion=admin" } });
  assert.equal(respuesta.headers.get("cache-control"), "no-store");
  assert.equal((await respuesta.json()).data[0].activo, false);
  assert.equal((await (await solicitar("jalapa_sesion=admin")).json()).message, "La gasolinera ya está inactiva.");
  assert.equal(cambios, 1);
  assert.equal((await (await solicitar("jalapa_sesion=admin", true)).json()).message, "Gasolinera reactivada correctamente.");
  assert.equal(cambios, 2);
});
