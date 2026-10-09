import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { crearPublicoRouter } from "../src/routes/publico.routes.js";
import { leerCoordenadas, encontrarGasolineraCercana } from "../src/services/gasolinera-cercana.service.js";

test("valida coordenadas incluyendo cero y rechaza entradas inválidas", () => {
  assert.deepEqual(leerCoordenadas({ latitud: "0", longitud: "-180" }), { latitud: 0, longitud: -180 });
  for (const query of [{}, { latitud: "", longitud: "0" }, { latitud: "91", longitud: "0" },
    { latitud: "0", longitud: "181" }, { latitud: ["14"], longitud: "0" }, { latitud: "NaN", longitud: "0" }]) {
    assert.throws(() => leerCoordenadas(query), { statusCode: 400 });
  }
});

test("consulta toda la base y devuelve la menor distancia con parámetros", async () => {
  const db = { query: async (sql, params) => {
    assert.deepEqual(params, [14.6, -89.9]);
    assert.match(sql, /ST_DistanceSphere/);
    assert.match(sql, /g.activo = TRUE AND g.visible_publico = TRUE/);
    assert.match(sql, /m.activo = TRUE/);
    assert.match(sql, /ORDER BY distancia_km, g.codigo/);
    assert.match(sql, /LIMIT 1/);
    assert.doesNotMatch(sql, /bbox|departamento|municipio/);
    return { rows: [{ codigo: "cercana", distancia_km: 0.2 }] };
  } };
  assert.equal((await encontrarGasolineraCercana({ latitud: 14.6, longitud: -89.9 }, db)).codigo, "cercana");
  assert.equal(await encontrarGasolineraCercana({ latitud: 0, longitud: 0 }, { query: async () => ({ rows: [] }) }), null);
});

test("endpoint público devuelve la estación más cercana, catálogo vacío y errores sin consultar DB", async (t) => {
  let rows = [{ codigo: "cercana", distancia_km: "0.25" }], consultas = 0;
  const estacion = { codigo: "cercana", nombre: "Estación", ubicacion: { latitud: 14, longitud: -90 },
    marca: { nombre: "Marca", colorPrincipal: "red" }, combustibles: [] };
  const app = express();
  app.use("/api/publico", crearPublicoRouter(async (opciones) => {
    assert.deepEqual(opciones, { soloVisibles: true, codigo: "cercana", limite: 1 });
    return [estacion];
  }, { query: async () => { consultas++; return { rows }; } }));
  app.use((error, _req, res, _next) => res.status(error.statusCode ?? 500).json({ message: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = "http://127.0.0.1:" + server.address().port + "/api/publico/gasolineras/cercana";
  const respuesta = await fetch(url + "?latitud=14&longitud=-90");
  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.headers.get("cache-control"), "no-store");
  const resultado = await respuesta.json();
  assert.equal(resultado.data.codigo, "cercana");
  assert.equal(resultado.data.distanciaKm, 0.25);
  rows = [];
  const vacio = await (await fetch(url + "?latitud=14&longitud=-90")).json();
  assert.equal(vacio.data, null);
  assert.match(vacio.message, /No existen/);
  const antes = consultas;
  assert.equal((await fetch(url + "?latitud=999&longitud=-90")).status, 400);
  assert.equal(consultas, antes);
});
