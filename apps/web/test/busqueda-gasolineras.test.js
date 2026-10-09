import { test } from "node:test";
import assert from "node:assert/strict";
import { coincideFiltrosGasolinera, coincideNombreGasolinera, normalizarNombreGasolinera } from "../src/busqueda-gasolineras.js";

test("encuentra una parte del nombre sin distinguir mayusculas ni tildes", () => {
  assert.equal(coincideNombreGasolinera("Gasolinera La Montaña", "MONTA"), true);
  assert.equal(coincideNombreGasolinera("Estación PUMA Central", "puma"), true);
  assert.equal(coincideNombreGasolinera("Gasolinera Uno", "Texaco"), false);
});

test("admite una o varias partes del nombre aunque no sean contiguas", () => {
  assert.equal(coincideNombreGasolinera("Gasolinera Shell Jalapa Centro", "s"), true);
  assert.equal(coincideNombreGasolinera("Gasolinera Shell Jalapa Centro", "shell centro"), true);
  assert.equal(coincideNombreGasolinera("Gasolinera Shell Jalapa Centro", "shell norte"), false);
  assert.equal(coincideNombreGasolinera("Gasolinera Shell Jalapa Centro", ""), true);
});

test("normaliza la busqueda antes de enviarla al API", () => {
  assert.equal(normalizarNombreGasolinera("  MONTAÑA  "), "montana");
});

test("combina nombre, departamento y municipio sin mostrar estaciones de otra región", () => {
  const central = { nombre: "Gasolinera Montaña Central", departamento: "Jalapa", municipio: "Jalapa" };
  const norte = { nombre: "Gasolinera Montaña Norte", departamento: "Jalapa", municipio: "San Pedro Pinula" };
  const otra = { nombre: "Gasolinera Montaña", departamento: "Guatemala", municipio: "Guatemala" };
  const filtros = { busqueda: "MONTA", departamento: "Jalapa", municipio: "San Pedro Pinula" };
  assert.equal(coincideFiltrosGasolinera(norte, filtros), true);
  assert.equal(coincideFiltrosGasolinera(central, filtros), false);
  assert.equal(coincideFiltrosGasolinera(otra, filtros), false);
  assert.equal(coincideFiltrosGasolinera(norte, { departamento: "Jalapa" }), true);
  assert.equal(coincideFiltrosGasolinera(norte, { municipio: "Jalapa" }), false);
});
