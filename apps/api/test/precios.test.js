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

test("el estado identifica la gasolinera asignada al usuario autenticado", async () => {
  const db = {
    async query(sql) {
      if (sql.includes("FROM usuarios u JOIN roles")) return { rows: [{
        id_gasolinera: 7, rol: "gestor_gasolinera", precio_horario_activo: true,
        hora_inicio: "08:00", precio_duracion_minutos: 30,
        horario_vigente: true, hora_guatemala: "08:10",
      }] };
      if (sql.includes("FROM tipos_combustible")) return { rows: [] };
      throw new Error(`Consulta inesperada: ${sql.slice(0, 80)}`);
    },
  };

  const estado = await crearServicioPrecios(db).estado({ id: "15" });

  assert.equal(estado.rol, "gestor_gasolinera");
  assert.equal(estado.idGasolinera, "7");
  assert.equal(estado.horarioVigente, true);
});

test("el administrador puede actualizar cualquier gasolinera y la transacción se confirma", async () => {
  const consultas = [];
  const cliente = {
    async query(sql, parametros) {
      consultas.push({ sql, parametros });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
      if (sql.includes("SELECT u.id_gasolinera, r.codigo AS rol")) return { rows: [{
        id_gasolinera: null, rol: "administrador", activo: true, horario_vigente: false,
      }] };
      if (sql.includes("id = ANY")) return { rows: [{ id: "3" }] };
      if (sql.includes("SELECT id FROM modalidades_servicio")) return { rows: [{ id: "4" }] };
      if (sql.includes("SELECT precio FROM precios_combustible")) return { rows: [{ precio: "34.50" }] };
      if (sql.includes("INSERT INTO precios_combustible")) return { rows: [], rowCount: 1 };
      throw new Error(`Consulta inesperada: ${sql.slice(0, 80)}`);
    },
    release() {},
  };
  const servicio = crearServicioPrecios({ connect: async () => cliente });

  const resultado = await servicio.registrar({ id: "1" }, { idGasolinera: "2", cambios: [
    { idCombustible: "3", idModalidad: "4", precio: "35.25" },
  ] });

  assert.deepEqual(resultado, {
    guardado: true,
    actualizados: 1,
    message: "Precio actualizado correctamente.",
  });
  assert.equal(consultas.at(-1).sql, "COMMIT");
  const insercion = consultas.find(({ sql }) => sql.includes("INSERT INTO precios_combustible"));
  assert.deepEqual(insercion.parametros, ["3", "4", "1", "35.25"]);
});

test("solo el administrador puede consultar el historial de precios", async () => {
  const servicio = crearServicioPrecios({});
  await assert.rejects(servicio.historial({ rol: "gestor_gasolinera" }, {
    idGasolinera: "2",
  }), { statusCode: 403 });
});

test("el historial devuelve precio anterior, responsable y orden de consulta descendente", async () => {
  const consultas = [];
  const db = {
    async query(sql, parametros) {
      consultas.push({ sql, parametros });
      if (sql.startsWith("SELECT id, nombre FROM gasolineras")) {
        return { rows: [{ id: 2, nombre: "Estación Central" }] };
      }
      if (sql.includes("WITH cambios AS")) return { rows: [{
        id: 9, combustible: "Regular", codigo_combustible: "regular",
        modalidad: "Autoservicio", precio_anterior: "31.25", precio_nuevo: "32.10",
        moneda: "GTQ", unidad_medida: "galon", fecha: new Date("2026-10-05T16:30:00Z"),
        id_usuario: 4, usuario: "Ana Pérez", nombre_usuario: "ana.admin",
      }] };
      throw new Error(`Consulta inesperada: ${sql.slice(0, 80)}`);
    },
  };
  const resultado = await crearServicioPrecios(db).historial({ rol: "administrador" }, {
    idGasolinera: "2", combustible: "regular", desde: "2026-10-01", hasta: "2026-10-06",
  });

  assert.deepEqual(resultado.registros[0], {
    id: "9", combustible: { nombre: "Regular", codigo: "regular" },
    modalidad: "Autoservicio", precioAnterior: 31.25, precioNuevo: 32.1,
    moneda: "GTQ", unidadMedida: "galon", fecha: new Date("2026-10-05T16:30:00Z"),
    usuario: { id: "4", nombre: "Ana Pérez", usuario: "ana.admin" },
  });
  assert.deepEqual(consultas[1].parametros, ["2", "regular", "2026-10-01", "2026-10-06"]);
  assert.match(consultas[1].sql, /ORDER BY fecha DESC, id DESC/);
});

test("el historial rechaza filtros inválidos antes de consultar la base de datos", async () => {
  const servicio = crearServicioPrecios({});
  for (const filtros of [
    { idGasolinera: "0" },
    { idGasolinera: "2", combustible: "<script>" },
    { idGasolinera: "2", desde: "2026-02-30" },
    { idGasolinera: "2", desde: "2026-10-06", hasta: "2026-10-01" },
  ]) {
    await assert.rejects(servicio.historial({ rol: "administrador" }, filtros), { statusCode: 400 });
  }
});
