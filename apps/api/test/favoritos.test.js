import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { crearServicioFavoritos } from "../src/services/favoritos.service.js";
import { crearFavoritosRouter } from "../src/routes/favoritos.routes.js";
import { crearApiRouter } from "../src/routes/index.routes.js";

const usuario = { id: "7", rol: "conductor" };
const seleccion = { codigoGasolinera: "estacion-jalapa", codigoCombustible: "regular" };

test("favoritos exige sesión y valida selección e identificador antes de consultar", async () => {
  const servicio = crearServicioFavoritos({ query: () => assert.fail("No debe consultar") });
  for (const operacion of [() => servicio.catalogo(null), () => servicio.listar(null),
    () => servicio.guardar(null, seleccion), () => servicio.eliminar(null, "1")]) {
    await assert.rejects(operacion, { statusCode: 401 });
  }
  for (const valor of [null, "", [], {}, 4, "x' OR 1=1", "x".repeat(101)]) {
    await assert.rejects(servicio.guardar(usuario, { ...seleccion, codigoGasolinera: valor }), { statusCode: 400 });
  }
  for (const valor of [null, "", [], {}, 4, "regular;", "x".repeat(51)]) {
    await assert.rejects(servicio.guardar(usuario, { ...seleccion, codigoCombustible: valor }), { statusCode: 400 });
  }
  for (const id of ["0", "-1", "1.1", "1;DELETE", "9223372036854775808", "9".repeat(100)]) {
    await assert.rejects(servicio.eliminar(usuario, id), { statusCode: 400 });
  }
});

test("guarda con la identidad de sesión e informa selección no disponible o duplicada", async () => {
  let resultado = { id: "19", disponible: true };
  const servicio = crearServicioFavoritos({ query: async (_sql, valores) => {
    assert.deepEqual(valores, [usuario.id, seleccion.codigoGasolinera, seleccion.codigoCombustible]);
    return { rows: [resultado] };
  } });
  assert.deepEqual(await servicio.guardar(usuario, { ...seleccion, idUsuario: "otra-cuenta" }), { id: "19", ...seleccion });
  resultado = { id: null, disponible: true };
  await assert.rejects(servicio.guardar(usuario, seleccion), { statusCode: 409 });
  resultado = { id: null, disponible: false };
  await assert.rejects(servicio.guardar(usuario, seleccion), { statusCode: 404 });
});

test("consulta por propietario y conserva favoritos no disponibles sin inventar precios", async () => {
  const servicio = crearServicioFavoritos({ query: async (_sql, valores) => {
    assert.deepEqual(valores, [usuario.id]);
    return { rows: [{ id: "19", codigo: "estacion-jalapa", nombre: "Estación Jalapa", disponible: false,
      codigo_combustible: "regular", nombre_combustible: "Regular", precios: [] }] };
  } });
  const [favorito] = await servicio.listar(usuario);
  assert.equal(favorito.disponible, false);
  assert.deepEqual(favorito.precios, []);
  assert.equal(favorito.combustible.codigo, "regular");
});

test("eliminar incluye el propietario y no revela favoritos de otra cuenta", async () => {
  let cantidad = 1;
  const servicio = crearServicioFavoritos({ query: async (_sql, valores) => {
    assert.deepEqual(valores, ["19", usuario.id]);
    return { rowCount: cantidad };
  } });
  await servicio.eliminar(usuario, "19");
  cantidad = 0;
  await assert.rejects(servicio.eliminar(usuario, "19"), { statusCode: 404 });
});

test("HTTP real permite conductores, exige sesión y origen y usa exclusivamente la cuenta autenticada", async (t) => {
  const llamadas = [];
  const servicio = {
    catalogo: async (u) => { llamadas.push(u.id); return []; },
    listar: async (u) => { llamadas.push(u.id); return []; },
    guardar: async (u) => { llamadas.push(u.id); return { id: "19" }; },
    eliminar: async (u, id) => { llamadas.push([u.id, id]); },
  };
  const auth = { obtenerSesion: async (token) => token === "sesion-valida" ? usuario : null };
  const app = express();
  app.use(express.json());
  app.use("/api", crearApiRouter(auth, crearFavoritosRouter(servicio)));
  app.use((error, _req, res, _next) => res.status(error.statusCode ?? 500).json({ message: error.message }));
  const servidor = app.listen(0, "127.0.0.1");
  await once(servidor, "listening");
  t.after(() => new Promise((resolve) => servidor.close(resolve)));
  const url = `http://127.0.0.1:${servidor.address().port}/api/favoritos`;
  for (const [ruta, method] of [["", "GET"], ["/catalogo", "GET"], ["", "POST"], ["/19", "DELETE"]]) {
    assert.equal((await fetch(url + ruta, { method })).status, 401);
  }
  const cookie = "jalapa_sesion=sesion-valida";
  for (const ruta of ["", "/catalogo"]) {
    const r = await fetch(url + ruta, { headers: { cookie } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
  }
  for (const method of ["POST", "DELETE"]) {
    for (const origin of [undefined, "https://ajeno.example"]) {
      const headers = origin ? { cookie, origin } : { cookie };
      assert.equal((await fetch(url + (method === "DELETE" ? "/19" : ""), { method, headers })).status, 403);
    }
  }
  const origin = process.env.FRONTEND_URL ?? "http://localhost:5173";
  const creada = await fetch(url, { method: "POST", headers: { cookie, origin, "Content-Type": "application/json" }, body: JSON.stringify({ ...seleccion, idUsuario: "99" }) });
  assert.equal(creada.status, 201);
  assert.equal((await creada.json()).data.id, "19");
  assert.equal((await fetch(url + "/19", { method: "DELETE", headers: { cookie, origin } })).status, 204);
  assert.deepEqual(llamadas, ["7", "7", "7", ["7", "19"]]);
});
