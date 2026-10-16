import { test } from "node:test";
import assert from "node:assert/strict";
import { textoRendimiento } from "../src/bitacora-combustible.js";

test("HU-25 presenta el rendimiento medido o explica que aún está pendiente", () => {
  assert.match(textoRendimiento(12.345), /12[.,]35 km\/L/);
  assert.match(textoRendimiento(null), /Pendiente/);
  assert.match(textoRendimiento(0), /Pendiente/);
});
