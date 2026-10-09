import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { crearListarGasolineras } from "../src/controllers/gasolineras.controller.js";

test("GET /api/gasolineras entrega el catálogo obtenido por el servicio", async (t) => {
  let consultas = 0;
  const catalogo = [{
    id: 41,
    nombre: "Estación PostgreSQL",
    codigo: "estacion-postgresql",
    ubicacion: { latitud: 14.63, longitud: -89.98 },
    combustibles: [],
  }];
  const app = express();
  app.get("/api/gasolineras", crearListarGasolineras(async () => {
    consultas += 1;
    return catalogo;
  }));
  app.use((error, _req, res, _next) => res.status(500).json({ message: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const respuesta = await fetch(`http://127.0.0.1:${server.address().port}/api/gasolineras`);
  const cuerpo = await respuesta.json();
  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.headers.get("cache-control"), "no-cache");
  assert.equal(consultas, 1);
  assert.equal(cuerpo.total, 1);
  assert.deepEqual(cuerpo.data[0], catalogo[0]);
});

test("los errores de PostgreSQL se delegan al manejador HTTP", async (t) => {
  const app = express();
  app.get("/api/gasolineras", crearListarGasolineras(async () => {
    throw new Error("PostgreSQL no disponible");
  }));
  app.use((error, _req, res, _next) => res.status(503).json({ message: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const respuesta = await fetch(`http://127.0.0.1:${server.address().port}/api/gasolineras`);
  assert.equal(respuesta.status, 503);
  assert.match((await respuesta.json()).message, /PostgreSQL/);
});
