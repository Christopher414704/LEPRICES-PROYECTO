import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compararPrecios,
  municipiosDisponibles,
  opcionesComparacion,
  precioVigente,
} from "../src/comparador-precios.js";

const gasolineras = [
  { codigo: "b", nombre: "Estación Montaña", municipio: "Jalapa", departamento: "Jalapa",
    combustibles: [{ codigo: "regular", nombre: "Regular", precios: { autoservicio: {
      modalidad: "Autoservicio", precio: 31.5, moneda: "GTQ", vigenteDesde: "2026-10-01T10:00:00Z",
    } } }] },
  { codigo: "a", nombre: "Gasolinera Central", municipio: "Monjas", departamento: "Jalapa",
    combustibles: [{ codigo: "regular", nombre: "Regular", precios: { autoservicio: {
      modalidad: "Autoservicio", precio: "29.90", moneda: "GTQ", vigenteDesde: "2026-10-02T10:00:00Z",
    }, servicio_completo: { modalidad: "Servicio completo", precio: 30.5 } } }] },
  { codigo: "c", nombre: "Sin precio", municipio: "Guatemala", departamento: "Guatemala",
    combustibles: [{ codigo: "regular", nombre: "Regular", precios: {} }] },
];

test("ordena precios vigentes de menor a mayor y marca el más barato", () => {
  const resultado = compararPrecios(gasolineras, { combustible: "regular", modalidad: "autoservicio" });
  assert.deepEqual(resultado.map(({ gasolinera }) => gasolinera.codigo), ["a", "b"]);
  assert.equal(resultado[0].precio.precio, 29.9);
  assert.equal(resultado[0].esMasBarata, true);
  assert.equal(resultado[1].esMasBarata, false);
});

test("filtra por nombre sin distinguir mayúsculas ni tildes y por región", () => {
  assert.equal(compararPrecios(gasolineras, { combustible: "regular", modalidad: "autoservicio", buscar: "MONTAÑA" }).length, 1);
  assert.equal(compararPrecios(gasolineras, { combustible: "regular", modalidad: "autoservicio", municipio: "Monjas" })[0].gasolinera.codigo, "a");
  assert.equal(compararPrecios(gasolineras, { combustible: "regular", modalidad: "autoservicio", departamento: "Guatemala" }).length, 0);
});

test("omite precios ausentes, no numéricos, cero o negativos", () => {
  assert.equal(precioVigente(gasolineras[2], "regular", "autoservicio"), null);
  for (const valor of [null, "gratis", 0, -1, Infinity]) {
    const estacion = { combustibles: [{ codigo: "regular", precios: { autoservicio: { precio: valor } } }] };
    assert.equal(precioVigente(estacion, "regular", "autoservicio"), null);
  }
});

test("construye filtros únicos y municipios dependientes del departamento", () => {
  const opciones = opcionesComparacion(gasolineras);
  assert.deepEqual(opciones.combustibles, [{ codigo: "regular", nombre: "Regular" }]);
  assert.deepEqual(opciones.modalidades.map(({ codigo }) => codigo), ["autoservicio", "servicio_completo"]);
  assert.deepEqual(municipiosDisponibles(gasolineras, "Jalapa"), ["Jalapa", "Monjas"]);
});
