import { test } from "node:test";
import assert from "node:assert/strict";
import { prepararRegistroConductor } from "../src/registro-conductor.js";

function formulario(datos) {
  return { [Symbol.iterator]: function* iterar() { yield* Object.entries(datos); } };
}

test("el formulario público solo prepara campos propios del conductor", () => {
  const original = globalThis.FormData;
  globalThis.FormData = class { constructor(f) { return new Map(f); } };
  try {
    const resultado = prepararRegistroConductor(formulario({
      nombre: " Ana Conductora ", usuario: " ana.conductora ", correo: " ana@example.com ",
      password: "Clave-segura-2026", confirmarPassword: "Clave-segura-2026", idRol: "1",
    }));
    assert.deepEqual(Object.keys(resultado), ["nombre", "usuario", "correo", "password", "confirmarPassword"]);
    assert.equal(resultado.nombre, "Ana Conductora");
    assert.equal(resultado.usuario, "ana.conductora");
  } finally {
    globalThis.FormData = original;
  }
});

test("el formulario rechaza contraseñas distintas antes de llamar a la API", () => {
  const original = globalThis.FormData;
  globalThis.FormData = class { constructor(f) { return new Map(f); } };
  try {
    assert.throws(() => prepararRegistroConductor(formulario({
      password: "Clave-segura-2026", confirmarPassword: "Clave-segura-distinta",
    })), /no coinciden/i);
  } finally {
    globalThis.FormData = original;
  }
});
