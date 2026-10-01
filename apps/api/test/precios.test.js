import { test } from "node:test";
import assert from "node:assert/strict";
import { crearServicioPrecios } from "../src/services/precios.service.js";

function baseFicticia(permiso) {
  const consultas = [];
  const cliente = {
    async query(sql) {
      consultas.push(sql);
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
      if (sql.includes("SELECT u.id_gasolinera, r.codigo AS rol")) return { rows: [permiso] };
      throw new Error(`Consulta inesperada: ${sql.slice(0, 80)}`);
    },
    release() {},
  };
  return { consultas, connect: async () => cliente };
}

test("el gestor no puede asignarse permisos ni fijar un horario", async () => {
  const servicio = crearServicioPrecios({});
  await assert.rejects(servicio.asignar({ rol: "gestor_gasolinera" }, "1", {
    idGasolinera: "2", horaInicio: "08:00", duracion: 30,
  }), { statusCode: 403 });
});

test("el administrador no puede configurar horarios fuera del día ni duraciones ajenas al catálogo", async () => {
  const servicio = crearServicioPrecios({});
  for (const datos of [
    { idGasolinera: "2", horaInicio: "23:45", duracion: 30 },
    { idGasolinera: "2", horaInicio: "23:45", duracion: 15 },
    { idGasolinera: "2", horaInicio: "08:00", duracion: 90 },
    { idGasolinera: "2", horaInicio: "08:00", duracion: 30.5 },
  ]) {
    await assert.rejects(servicio.asignar({ rol: "administrador" }, "1", datos), { statusCode: 400 });
  }
});

test("precios inválidos o repetidos se rechazan antes de abrir una transacción", async () => {
  const servicio = crearServicioPrecios({});
  for (const precio of ["0", "0.00", "34.567", "-2", "999999999.99", "12.3.4"]) {
    await assert.rejects(servicio.registrar({ id: "1" }, { idGasolinera: "2",
      cambios: [{ idCombustible: "3", idModalidad: "4", precio }] }), { statusCode: 400 });
  }
  await assert.rejects(servicio.registrar({ id: "1" }, { idGasolinera: "2", cambios: [
    { idCombustible: "3", idModalidad: "4", precio: "34.50" },
    { idCombustible: "3", idModalidad: "4", precio: "35.50" },
  ] }), { statusCode: 400 });
});

test("fuera de horario no inserta precios y revierte la transacción", async () => {
  const db = baseFicticia({ id_gasolinera: "2", rol: "gestor_gasolinera",
    activo: true, horario_vigente: false });
  const servicio = crearServicioPrecios(db);
  await assert.rejects(servicio.registrar({ id: "1" }, { idGasolinera: "2", cambios: [
    { idCombustible: "3", idModalidad: "4", precio: "34.50" },
  ] }), (error) => error.statusCode === 403 && /fuera del horario/i.test(error.message));
  assert.equal(db.consultas[0], "BEGIN");
  assert.equal(db.consultas.at(-1), "ROLLBACK");
  assert.equal(db.consultas.some((sql) => sql.includes("INSERT INTO precios_combustible")), false);
});

test("un gestor no puede editar otra gasolinera aunque esté dentro del horario", async () => {
  const db = baseFicticia({ id_gasolinera: "9", rol: "gestor_gasolinera",
    activo: true, horario_vigente: true });
  const servicio = crearServicioPrecios(db);
  await assert.rejects(servicio.agregarCombustible({ id: "1" }, {
    idGasolinera: "2", idTipo: "3",
  }), { statusCode: 403 });
  assert.equal(db.consultas.at(-1), "ROLLBACK");
});
