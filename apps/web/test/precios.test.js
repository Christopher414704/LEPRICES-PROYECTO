import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularPosicionTarjeta, formatearPrecio } from "../src/precios.js";

test("precios ausentes o inválidos nunca aparecen como gasolina gratis", () => {
  for (const valor of [null, undefined, "", " ", NaN, Infinity, false, true, 0, -1, "sin dato"]) {
    assert.equal(formatearPrecio(valor), "--.--");
  }
  assert.equal(formatearPrecio(29.19), "29.19");
  assert.equal(formatearPrecio("30.5"), "30.50");
});

test("tarjeta anclada cabe junto a los bordes tanto en móvil como escritorio", () => {
  for (const ventanaAncho of [320, 390, 1280]) {
    const ancho = Math.min(410, ventanaAncho - 20);
    for (const x of [5, ventanaAncho / 2, ventanaAncho - 5]) {
      for (const y of [90, 350, 690]) {
        const p = calcularPosicionTarjeta({ x, y, ancho, alto: 270,
          ventanaAncho, ventanaAlto: 720, techo: 84 });
        assert.ok(p.izquierda >= 10 && p.izquierda + ancho <= ventanaAncho - 10);
        assert.ok(p.superior >= 84 && p.superior + 270 <= 710);
        assert.ok(p.flecha >= 22 && p.flecha <= ancho - 22);
      }
    }
  }
});

test("tarjeta prefiere estar encima del marcador y se invierte si falta espacio", () => {
  const base = { x: 500, ancho: 410, alto: 230, ventanaAncho: 1280, ventanaAlto: 720 };
  assert.equal(calcularPosicionTarjeta({ ...base, y: 500 }).colocacion, "arriba");
  assert.equal(calcularPosicionTarjeta({ ...base, y: 150 }).colocacion, "abajo");
});
