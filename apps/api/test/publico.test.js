import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { crearPublicoRouter, prepararGasolineraPublica, leerFiltrosPublicos } from "../src/routes/publico.routes.js";

const ejemplo = {
  id: 3, codigo: "jalapa-texaco-centro", nombre: "Texaco Centro",
  direccion: "Jalapa, Guatemala", municipio: "Jalapa", departamento: "Jalapa",
  ubicacion: { latitud: 14.63705, longitud: -89.99001 },
  marca: { id: 1, nombre: "Texaco", colorPrincipal: "#D71920", urlLogo: null },
  combustibles: [{ id: 8, nombreComercial: "Regular", tipo: { id: 2, nombre: "Regular", codigo: "regular" },
    precios: { autoservicio: { modalidad: "Autoservicio", precio: 31.5, moneda: "GTQ", unidadMedida: "galon",
      vigenteDesde: "2026-09-22T14:00:00.000Z" } } }],
};

test("la respuesta pública solo contiene datos de consulta y fecha del último precio", () => {
  const publica = prepararGasolineraPublica(ejemplo);
  assert.equal(publica.id, undefined);
  assert.equal(publica.marca.id, undefined);
  assert.equal(publica.combustibles[0].id, undefined);
  assert.equal(publica.combustibles[0].precios.autoservicio.precio, 31.5);
  assert.equal(publica.combustibles[0].precios.autoservicio.modalidad, "Autoservicio");
  assert.equal(publica.ultimaActualizacion, "2026-09-22T14:00:00.000Z");
  assert.equal(prepararGasolineraPublica({ ...ejemplo, combustibles: [] }).ultimaActualizacion, null);
});

test("GET público funciona sin cookie y no ofrece mutaciones", async (t) => {
  const consultas = [];
  const app = express();
  app.use("/api/publico", crearPublicoRouter(async (opciones) => {
    consultas.push(opciones);
    return [ejemplo];
  }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolver) => server.close(resolver)));
  const url = `http://127.0.0.1:${server.address().port}/api/publico/gasolineras`;
  const respuesta = await fetch(url);
  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.headers.get("cache-control"), "no-cache");
  assert.deepEqual(consultas[0], { soloVisibles: true, bbox: null, departamento: null, municipio: null, codigo: null, buscar: null, limite: 301 });
  assert.equal((await respuesta.json()).data[0].codigo, ejemplo.codigo);
  const precios = await fetch(`${url}/${ejemplo.codigo}/precios`);
  assert.equal(precios.status, 200);
  assert.equal(precios.headers.get("cache-control"), "no-cache");
  assert.equal((await precios.json()).data.combustibles[0].precios.autoservicio.precio, 31.5);
  assert.deepEqual(consultas[1], { soloVisibles: true, codigo: ejemplo.codigo, limite: 1 });
  assert.equal((await fetch(url, { method: "POST" })).status, 404);
});

test("GET de precios indica cuando la gasolinera no existe", async (t) => {
  const app = express();
  app.use("/api/publico", crearPublicoRouter(async () => []));
  app.use((error, _req, res, _next) => res.status(error.statusCode ?? 500).json({ message: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolver) => server.close(resolver)));

  const respuesta = await fetch(`http://127.0.0.1:${server.address().port}/api/publico/gasolineras/inexistente/precios`);
  assert.equal(respuesta.status, 404);
  assert.equal(respuesta.headers.get("cache-control"), "no-cache");
  assert.match((await respuesta.json()).message, /no existe/i);
});

test("filtros de región y área rechazan coordenadas inválidas", () => {
  assert.deepEqual(leerFiltrosPublicos({ bbox: "-90,14,-89,15", departamento: "Jalapa" }),
    { bbox: [-90, 14, -89, 15], departamento: "Jalapa", municipio: null, codigo: null, buscar: null });
  assert.throws(() => leerFiltrosPublicos({ bbox: "-90,14,-91,15" }), { statusCode: 400 });
  assert.throws(() => leerFiltrosPublicos({ bbox: "NaN,14,-89,15" }), { statusCode: 400 });
  assert.throws(() => leerFiltrosPublicos({ codigo: "<script>" }), { statusCode: 400 });
  assert.equal(leerFiltrosPublicos({ buscar: "Montaña" }).buscar, "montana");
  assert.equal(leerFiltrosPublicos({ buscar: "m" }).buscar, "m");
  assert.equal(leerFiltrosPublicos({ buscar: "Shell Centro" }).buscar, "shell centro");
});
