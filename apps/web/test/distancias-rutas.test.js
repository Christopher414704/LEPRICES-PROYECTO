import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanciaKm, urlGoogleMaps } from '../src/publico.js';
test('distancia es cero en el mismo punto y ordena las estaciones por proximidad', () => {
 const origen = { latitud: 0, longitud: 0 };
 assert.equal(distanciaKm(origen, origen), 0);
 const distancias = [2, 0.001, 1].map(longitud => distanciaKm(origen, { latitud: 0, longitud })).sort((a,b) => a-b);
 assert.ok(distancias[0] < 1);
 assert.ok(Math.abs(distancias[1] - 111.195) < 0.01);
});
test('ruta utiliza las coordenadas de destino y rechaza coordenadas inválidas', () => {
 const url = new URL(urlGoogleMaps({ latitud: 14.6, longitud: -90 }));
 assert.equal(url.searchParams.get('destination'), '14.6,-90');
 assert.equal(url.searchParams.get('travelmode'), 'driving');
 assert.equal(urlGoogleMaps({ latitud: 91, longitud: 0 }), null);
});
