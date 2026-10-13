import { test } from "node:test";
import assert from "node:assert/strict";
import { crearServicioAuditoria, validarFiltrosAuditoria } from "../src/services/auditoria.service.js";

const admin = { id: "1", rol: "administrador" };

test("solo un administrador activo puede consultar la auditoría", async () => {
  const servicio = crearServicioAuditoria({});
  await assert.rejects(servicio.listar({ id: "2", rol: "consulta" }, {}), { statusCode: 403 });
  await assert.rejects(crearServicioAuditoria({ query: async () => ({ rows: [] }) }).listar(admin, {}),
    { statusCode: 403 });
});

test("valida fechas, catálogos y límites antes de consultar", () => {
  assert.deepEqual(validarFiltrosAuditoria({ pagina: "2", limite: "50", tipo: "usuario" }), {
    tipo: "usuario", operacion: null, idUsuario: null, desde: null, hasta: null,
    busqueda: null, pagina: 2, limite: 50,
  });
  for (const filtros of [
    { tipo: "precio" }, { operacion: "borrar" }, { desde: "2026-02-30" },
    { desde: "2026-10-12", hasta: "2026-10-01" }, { pagina: "0" }, { limite: "101" },
  ]) assert.throws(() => validarFiltrosAuditoria(filtros), { statusCode: 400 });
});

test("unifica eventos, aplica filtros y devuelve paginación", async () => {
  const consultas = [];
  const db = { async query(sql, valores) {
    consultas.push({ sql, valores });
    if (sql.includes("r.codigo='administrador'")) return { rows: [{ id: 1 }] };
    return { rows: [{
      id: 8, tipo: "gasolinera", operacion: "edicion", fecha: new Date("2026-10-12T15:00:00Z"),
      id_responsable: 1, responsable: "Ada Admin", usuario_responsable: "ada",
      id_elemento: 4, elemento: "Estación Central", datos: { antes: {}, despues: {} }, total: 26,
    }] };
  } };
  const resultado = await crearServicioAuditoria(db).listar(admin, {
    tipo: "gasolinera", operacion: "edicion", idUsuario: "1", desde: "2026-10-01",
    hasta: "2026-10-12", busqueda: "Central", pagina: "2", limite: "25",
  });
  assert.equal(resultado.registros[0].id, "gasolinera-8");
  assert.deepEqual(resultado.registros[0].responsable, { id: "1", nombre: "Ada Admin", usuario: "ada" });
  assert.deepEqual(resultado.paginacion, { pagina: 2, limite: 25, total: 26, paginas: 2 });
  assert.deepEqual(consultas[1].valores, ["gasolinera", "edicion", "1", "2026-10-01",
    "2026-10-12", "Central", 25, 25]);
  assert.match(consultas[1].sql, /UNION ALL[\s\S]+COUNT\(\*\) OVER\(\)/);
  assert.match(consultas[1].sql, /ORDER BY fecha DESC,tipo,id DESC/);
});
