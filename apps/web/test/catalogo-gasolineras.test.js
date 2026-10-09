import { test } from "node:test";
import assert from "node:assert/strict";
import { consultarCatalogoGasolineras } from "../src/catalogo-gasolineras.js";

const respuesta = (data, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => data,
});

test("el mapa interno obtiene el catálogo dinámico desde /api/gasolineras", async () => {
  const llamadas = [];
  const data = [{ id: 7, nombre: "Nueva desde PostgreSQL", ubicacion: { latitud: 14.6, longitud: -89.9 } }];
  const resultado = await consultarCatalogoGasolineras({
    publico: false,
    signal: "señal",
    api: async (...argumentos) => {
      llamadas.push(argumentos);
      return respuesta({ data });
    },
  });

  assert.deepEqual(resultado.data, data);
  assert.deepEqual(llamadas, [["/gasolineras", { signal: "señal" }]]);
});

test("el mapa público consulta la API y conserva filtros y política de caché", async () => {
  const llamadas = [];
  await consultarCatalogoGasolineras({
    publico: true,
    parametros: new URLSearchParams({ departamento: "Jalapa" }),
    forzar: true,
    signal: "señal",
    urlApi: "/api",
    fetcher: async (...argumentos) => {
      llamadas.push(argumentos);
      return respuesta({ data: [] });
    },
  });

  assert.equal(llamadas[0][0], "/api/publico/gasolineras?departamento=Jalapa");
  assert.deepEqual(llamadas[0][1], { credentials: "omit", cache: "no-cache", signal: "señal" });
});

test("rechaza respuestas caídas o catálogos inválidos con errores controlados", async () => {
  await assert.rejects(consultarCatalogoGasolineras({
    publico: false,
    api: async () => respuesta({}, { ok: false, status: 503 }),
  }), /estado 503/);
  await assert.rejects(consultarCatalogoGasolineras({
    publico: false,
    api: async () => respuesta({ data: "catálogo fijo" }),
  }), /lista de gasolineras/);
});
