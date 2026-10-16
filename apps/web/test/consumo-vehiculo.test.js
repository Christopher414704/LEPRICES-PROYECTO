import { test } from "node:test";
import assert from "node:assert/strict";
import { resumenConsumo } from "../src/consumo-vehiculo.js";

test("presenta la estimación en L/100 km y km/L con redondeo solo visual", () => {
  const consumo = { disponible: true, consumoL100Km: 7.5, rendimientoKmLitro: 13.333333333 };
  assert.equal(resumenConsumo(consumo), "7.5 L/100 km · 13.33 km/L");
  assert.equal(consumo.rendimientoKmLitro, 13.333333333);
  assert.match(resumenConsumo({ ...consumo, consumoL100Km: 0.0001 }), /menos de 0.01 L\/100 km/);
});

test("informa datos insuficientes y vehículos eléctricos sin mostrar un consumo cero", () => {
  assert.match(resumenConsumo(null), /No hay información suficiente/);
  assert.equal(resumenConsumo({ disponible: false, mensaje: "El consumo en litros no aplica." }), "El consumo en litros no aplica.");
});
