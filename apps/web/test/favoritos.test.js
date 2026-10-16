import { test } from "node:test";
import assert from "node:assert/strict";
import { opcionesCombustible, describirPrecio } from "../src/favoritos.js";

test("deshabilita solo los combustibles guardados en la estación seleccionada", () => {
  const estacion = { codigo: "estacion-a", combustibles: [{ codigo: "regular", nombre: "Regular" }, { codigo: "diesel", nombre: "Diésel" }] };
  const favoritos = [
    { gasolinera: { codigo: "estacion-a" }, combustible: { codigo: "regular" } },
    { gasolinera: { codigo: "estacion-b" }, combustible: { codigo: "diesel" } },
  ];
  assert.deepEqual(opcionesCombustible(estacion, favoritos).map((c) => c.guardado), [true, false]);
  assert.deepEqual(opcionesCombustible(null, favoritos), []);
  assert.equal(opcionesCombustible(estacion, []).every((c) => !c.guardado), true);
});

test("muestra precios con moneda y unidad sin confundir precios ausentes con cero", () => {
  assert.equal(describirPrecio({ precio: "30.5", moneda: "GTQ", unidadMedida: "galon" }), "Q30.50 por galón");
  assert.equal(describirPrecio({ precio: 8, moneda: "USD", unidadMedida: "litro" }), "USD 8.00 por litro");
  for (const precio of [null, undefined, "", "inválido", 0, -1, true, false]) {
    assert.equal(describirPrecio({ precio }), "Precio no registrado");
  }
});
