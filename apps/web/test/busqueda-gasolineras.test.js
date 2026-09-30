import { test } from "node:test";
import assert from "node:assert/strict";
import { coincideNombreGasolinera, normalizarNombreGasolinera } from "../src/busqueda-gasolineras.js";

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
