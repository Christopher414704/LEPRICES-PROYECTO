import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enlaceNavegacion, nombreConsumo } from '../src/rutas-utils.js';
const a = { latitud: 14.6, longitud: -90.5 }, b = { latitud: 14.63, longitud: -89.99 };
test('navegación distingue ida y regreso sin invertir silenciosamente los puntos', () => {
  const ida = new URL(enlaceNavegacion(a, b)), vuelta = new URL(enlaceNavegacion(b, a));
  assert.equal(ida.origin, 'https://www.google.com'); assert.equal(ida.searchParams.get('origin'), '14.6,-90.5');
  assert.equal(ida.searchParams.get('destination'), '14.63,-89.99');
  assert.equal(vuelta.searchParams.get('destination'), ida.searchParams.get('origin'));
  assert.equal(ida.searchParams.get('travelmode'), 'driving'); assert.equal(ida.searchParams.get('dir_action'), 'navigate');
});
test('no genera enlaces para coordenadas vacías o inválidas', () => {
  for (const p of [null, {}, { ...a, latitud: '' }, { ...a, latitud: 91 }, { ...a, longitud: Infinity }]) assert.equal(enlaceNavegacion(p, b), null);
});
test('las fuentes del consumo se distinguen sin presentar una referencia como medición', () => {
  assert.match(nombreConsumo('bitacora'), /medido/); assert.match(nombreConsumo('catalogo'), /referencia/); assert.match(nombreConsumo('manual'), /ingresado/);
});
