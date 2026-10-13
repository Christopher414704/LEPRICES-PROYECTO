import { test } from "node:test";
import assert from "node:assert/strict";
import { distanciaEnLineaRecta, enlaceNavegacion, formatearDistancia } from "../src/ubicacion-gasolinera.js";

test("abre indicaciones externas hacia las coordenadas de la gasolinera", () => {
  const enlace = new URL(enlaceNavegacion({ latitud: 14.6333, longitud: -89.9894 }));
  assert.equal(enlace.origin, "https://www.google.com");
  assert.equal(enlace.pathname, "/maps/dir/");
  assert.equal(enlace.searchParams.get("api"), "1");
  assert.equal(enlace.searchParams.get("destination"), "14.6333,-89.9894");
  assert.equal(enlace.searchParams.get("travelmode"), "driving");
  assert.equal(enlaceNavegacion({ latitud: null, longitud: -89.9894 }), null);
  assert.equal(enlaceNavegacion({ latitud: "", longitud: -89.9894 }), null);
});

test("calcula la distancia en línea recta solo con ambas ubicaciones válidas", () => {
  const origen = { latitud: 0, longitud: 0 };
  assert.equal(distanciaEnLineaRecta(origen, origen), 0);
  assert.ok(Math.abs(distanciaEnLineaRecta(origen, { latitud: 1, longitud: 0 }) - 111.2) < .1);
  assert.equal(distanciaEnLineaRecta(null, origen), null);
  assert.equal(distanciaEnLineaRecta(origen, { latitud: 91, longitud: 0 }), null);
  assert.equal(formatearDistancia(.45), "450 m");
});
