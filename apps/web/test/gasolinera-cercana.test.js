import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const codigo = main.slice(main.indexOf("// La ubicación se solicita"), main.indexOf("await Promise.allSettled([cargarMapaSatelital()"));

function preparar(geolocation) {
  let click;
  const boton = { disabled: false, addEventListener: (_evento, callback) => { click = callback; } };
  const estado = { textContent: "" };
  vm.runInNewContext(codigo, { document: { querySelector: () => boton }, navigator: { geolocation }, estado });
  return { boton, estado, click };
}

test("no solicita ubicación al abrir el mapa y permite continuar si se deniega", () => {
  let solicitudes = 0;
  const ui = preparar({ getCurrentPosition: (_ok, fallo) => { solicitudes++; fallo({ code: 1 }); } });
  assert.equal(solicitudes, 0);
  ui.click();
  assert.equal(solicitudes, 1);
  assert.equal(ui.boton.disabled, false);
  assert.match(ui.estado.textContent, /No autorizaste.*seguir usando el mapa/);
});

test("navegador sin geolocalización y timeout dejan el botón disponible", () => {
  const sinSoporte = preparar(undefined);
  sinSoporte.click();
  assert.equal(sinSoporte.boton.disabled, false);
  assert.match(sinSoporte.estado.textContent, /seguir buscando/);
  const timeout = preparar({ getCurrentPosition: (_ok, fallo) => fallo({ code: 3 }) });
  timeout.click();
  assert.equal(timeout.boton.disabled, false);
  assert.match(timeout.estado.textContent, /seguir usando el mapa/);
});

test("ubicación autorizada consulta la API, muestra la estación y encuadra ambos puntos", async () => {
  let click, success, consultas = 0, seleccion, vuelo, datos;
  const boton = { addEventListener: (_e, callback) => { click = callback; } };
  const estacion = { codigo: "cerca", nombre: "Estación cercana", distanciaKm: 0.125 };
  const elemento = { estacion, indicacion: {}, nodo: {} };
  const entidad = {};
  const estado = { classList: { remove() {}, add() {} } };
  const context = {
    document: { querySelector: () => boton },
    navigator: { geolocation: { getCurrentPosition: (ok) => { success = ok; } } },
    estado, urlApi: "/api", URLSearchParams, AbortSignal,
    fetch: async (url) => { consultas++; assert.match(url, /latitud=14&longitud=-90/); return { ok: true, json: async () => ({ data: estacion }) }; },
    gasolineraCercana: null, buscador: { value: "otra" }, seleccionDepartamento: null, seleccionMunicipio: null,
    actualizarMunicipios() {}, fichas: new Map(), agregarEstaciones: (value) => { datos = value; },
    estaciones: { entities: { getById: () => entidad } },
    visor: { entities: { add: (value) => value }, flyTo: (value) => { vuelo = value; }, scene: { requestRender() {} } },
    Cartesian3: { fromDegrees: (lon, lat) => [lon, lat] }, Color: { WHITE: "white", fromCssColorString: (v) => v },
    elementosLista: [elemento], lista: { prepend() {} }, mostrarTablero: (value) => { seleccion = value; },
    window: { matchMedia: () => ({ matches: true }) }, console,
  };
  vm.runInNewContext(codigo, context);
  assert.equal(consultas, 0);
  click();
  await success({ coords: { latitude: 14, longitude: -90 } });
  assert.equal(consultas, 1);
  assert.equal(datos[0], estacion);
  assert.equal(seleccion, entidad);
  assert.equal(vuelo[1], entidad);
  assert.match(estado.textContent, /125 m en línea recta/);
  assert.equal(boton.disabled, false);
  context.fetch = async () => ({ ok: true, json: async () => ({ data: null, message: "No existen gasolineras disponibles registradas." }) });
  click();
  await success({ coords: { latitude: 14, longitude: -90 } });
  assert.match(estado.textContent, /No existen/);
  assert.equal(boton.disabled, false);
});
