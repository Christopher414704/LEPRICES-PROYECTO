import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import express from "express";
import pg from "pg";
import { env } from "../src/config/env.js";
import { crearServicioRegistroGasolineras } from "../src/services/registro-gasolineras.service.js";
import { listarGasolinerasConPrecios } from "../src/services/gasolineras.service.js";
import { crearPublicoRouter } from "../src/routes/publico.routes.js";

test("HU-11/HU-12/HU-13: registro, edición, estado, historial y API pública en PostgreSQL real", {
  skip: process.env.RUN_DB_TESTS !== "1",
}, async (t) => {
  const schema = `gasolineras_test_${randomUUID().replaceAll("-", "")}`;
  const config = { host: env.database.host, port: env.database.port, database: env.database.name,
    user: env.database.user, password: env.database.password, ssl: env.database.ssl };
  const adminPool = new pg.Pool(config);
  const db = new pg.Pool({ ...config, options: `-c search_path=${schema},public` });
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  t.after(async () => {
    await db.end();
    await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
    await adminPool.end();
  });
  for (const archivo of [
    "0001_crear_marcas_y_gasolineras", "0002_crear_roles_y_usuarios", "0003_crear_combustibles_y_precios",
    "0007_publicar_gasolineras", "0008_crear_sesiones_usuario", "0009_restringir_actualizacion_precios_por_horario",
    "0010_limitar_gestores_a_gasolinera", "0011_registrar_gasolineras_y_auditoria",
    "0012_auditar_edicion_gasolineras",
    "0013_auditar_estado_gasolineras",
    "0014_administrar_usuarios",
  ]) {
    const migracion = await import(`../../../database/migrations/${archivo}.mjs`);
    const consultas = [];
    migracion.up({ sql: (sql) => consultas.push(sql) });
    for (const sql of consultas) await db.query(sql);
  }
  const { rows: [marca] } = await db.query("INSERT INTO marcas (nombre,codigo) VALUES ('Marca de prueba','marca-prueba') RETURNING id");
  const { rows: [usuario] } = await db.query(`
    INSERT INTO usuarios (id_rol,nombre_completo,nombre_usuario,correo_electronico,contrasena_hash)
    SELECT id,'Administrador de prueba','admin_prueba','admin@example.test','hash-prueba'
    FROM roles WHERE codigo='administrador' RETURNING id
  `);
  const administrador = { id: usuario.id, rol: "administrador" };
  const servicio = crearServicioRegistroGasolineras(db);
  const datos = { nombre: "Estación Montaña", direccion: "Calle 1", municipio: "Jalapa", departamento: "Jalapa",
    idMarca: marca.id, latitud: "14.630001", longitud: "-89.980001" };
  let creada;

  await t.test("persiste coordenadas PostGIS, publicación y auditoría del administrador", async () => {
    creada = await servicio.registrar(administrador, datos);
    const { rows: [fila] } = await db.query(`
      SELECT g.visible_publico, ST_X(g.ubicacion::geometry) AS longitud,
        ST_Y(g.ubicacion::geometry) AS latitud, a.id_usuario, a.datos, a.operacion
      FROM gasolineras g JOIN auditoria_gasolineras a ON a.id_gasolinera=g.id WHERE g.codigo=$1
    `, [creada.codigo]);
    assert.equal(fila.visible_publico, true);
    assert.equal(fila.longitud, -89.980001);
    assert.equal(fila.latitud, 14.630001);
    assert.equal(fila.id_usuario, usuario.id);
    assert.equal(fila.datos.nombre, datos.nombre);
    assert.equal(fila.operacion, "registro");
  });

  await t.test("aparece inmediatamente en el listado y API públicos sin precios inventados", async (st) => {
    const listado = await listarGasolinerasConPrecios({ soloVisibles: true }, db);
    assert.equal(listado[0].codigo, creada.codigo);
    assert.deepEqual(listado[0].combustibles, []);
    const app = express();
    app.use("/api/publico", crearPublicoRouter((opciones) => listarGasolinerasConPrecios(opciones, db), db));
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    st.after(() => new Promise((resolve) => server.close(resolve)));
    const respuesta = await fetch(`http://127.0.0.1:${server.address().port}/api/publico/gasolineras?codigo=${creada.codigo}`);
    assert.equal(respuesta.status, 200);
    assert.equal((await respuesta.json()).data[0].codigo, creada.codigo);
  });

  await t.test("rechaza nombres normalizados y coordenadas duplicadas incluso en solicitudes concurrentes", async () => {
    await assert.rejects(servicio.registrar(administrador, { ...datos, nombre: "  ESTACION   MONTANA  ", latitud: 15, longitud: -90 }), { statusCode: 409 });
    await assert.rejects(servicio.registrar(administrador, { ...datos, nombre: "Otro nombre" }), { statusCode: 409 });
    const simultaneas = await Promise.allSettled([
      servicio.registrar(administrador, { ...datos, nombre: "Concurrente A", latitud: 15, longitud: -90 }),
      servicio.registrar(administrador, { ...datos, nombre: "Concurrente B", latitud: 15, longitud: -90 }),
    ]);
    assert.equal(simultaneas.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(simultaneas.find((r) => r.status === "rejected").reason.statusCode, 409);
    const { rows: [conteo] } = await db.query("SELECT (SELECT count(*)::int FROM gasolineras) AS estaciones,(SELECT count(*)::int FROM auditoria_gasolineras) AS auditorias");
    assert.equal(conteo.estaciones, 2);
    assert.equal(conteo.auditorias, 2);
  });

  await t.test("edita ubicación PostGIS y API conservando identificador, marca y precios", async () => {
    const { rows: [combustible] } = await db.query(`
      INSERT INTO combustibles_gasolinera (id_gasolinera,id_tipo_combustible,nombre_comercial,codigo)
      SELECT $1,id,'Regular de prueba','regular-prueba' FROM tipos_combustible WHERE codigo='regular' RETURNING id
    `, [creada.id]);
    const { rows: [precio] } = await db.query(`
      INSERT INTO precios_combustible (id_combustible_gasolinera,id_modalidad_servicio,id_usuario_registro,precio)
      SELECT $1,id,$2,30.50 FROM modalidades_servicio WHERE codigo='autoservicio' RETURNING id
    `, [combustible.id, usuario.id]);
    const editada = await servicio.editar(administrador, creada.id, {
      ...datos, nombre: 'Estación renovada', direccion: 'Avenida nueva', municipio: 'Monjas', latitud: 14.5, longitud: -89.9,
    });
    assert.equal(editada.codigo, creada.codigo);
    assert.equal(editada.idMarca, marca.id);
    const { rows: [fila] } = await db.query(`
      SELECT g.visible_publico, g.activo, ST_X(g.ubicacion::geometry) AS longitud,
        ST_Y(g.ubicacion::geometry) AS latitud, a.id_usuario, a.datos
      FROM gasolineras g JOIN auditoria_gasolineras a ON a.id_gasolinera=g.id
      WHERE g.id=$1 AND a.operacion='edicion'
    `, [creada.id]);
    assert.equal(fila.longitud, -89.9);
    assert.equal(fila.latitud, 14.5);
    assert.equal(fila.activo, true);
    assert.equal(fila.visible_publico, true);
    assert.equal(fila.id_usuario, usuario.id);
    assert.equal(fila.datos.antes.nombre, datos.nombre);
    assert.deepEqual(fila.datos.despues, editada);
    const listado = await listarGasolinerasConPrecios({ soloVisibles: true, codigo: creada.codigo }, db);
    assert.equal(listado[0].nombre, 'Estación renovada');
    assert.equal(listado[0].municipio, 'Monjas');
    assert.deepEqual(listado[0].ubicacion, editada.ubicacion);
    assert.equal(listado[0].combustibles[0].id, Number(combustible.id));
    assert.equal(listado[0].combustibles[0].precios.autoservicio.precio, 30.5);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM precios_combustible WHERE id=$1', [precio.id])).rows[0].n, 1);
  });

  await t.test("editar la misma estación no es duplicado; un conflicto mantiene datos y auditoría", async () => {
    const { rows: [antes] } = await db.query('SELECT * FROM gasolineras WHERE id=$1', [creada.id]);
    const cambios = { nombre: antes.nombre, direccion: antes.direccion, municipio: antes.municipio,
      departamento: antes.departamento, latitud: antes.latitud, longitud: antes.longitud };
    await servicio.editar(administrador, creada.id, cambios);
    const n = (await db.query('SELECT count(*)::int AS n FROM auditoria_gasolineras')).rows[0].n;
    await assert.rejects(servicio.editar(administrador, creada.id, { ...cambios, latitud: 15, longitud: -90 }), { statusCode: 409 });
    const { rows: [despues] } = await db.query('SELECT * FROM gasolineras WHERE id=$1', [creada.id]);
    for (const campo of ['nombre', 'direccion', 'municipio', 'departamento', 'latitud', 'longitud']) {
      assert.equal(despues[campo], antes[campo]);
    }
    assert.equal((await db.query('SELECT count(*)::int AS n FROM auditoria_gasolineras')).rows[0].n, n);
  });

  await t.test("ediciones simultáneas dejan una secuencia de auditoría coherente", async () => {
    const cambios = { ...datos, municipio: 'Monjas', latitud: 14.5, longitud: -89.9 };
    await Promise.all([
      servicio.editar(administrador, creada.id, { ...cambios, nombre: 'Edición A' }),
      servicio.editar(administrador, creada.id, { ...cambios, nombre: 'Edición B' }),
    ]);
    const { rows } = await db.query("SELECT datos FROM auditoria_gasolineras WHERE id_gasolinera=$1 AND operacion='edicion' ORDER BY id DESC LIMIT 2", [creada.id]);
    assert.equal(rows[0].datos.antes.nombre, rows[1].datos.despues.nombre);
    assert.equal((await db.query('SELECT nombre FROM gasolineras WHERE id=$1', [creada.id])).rows[0].nombre, rows[0].datos.despues.nombre);
  });

  await t.test("una auditoría de edición fallida revierte los cambios", async () => {
    const { rows: [antes] } = await db.query('SELECT nombre,latitud,longitud FROM gasolineras WHERE id=$1', [creada.id]);
    await db.query("ALTER TABLE auditoria_gasolineras ADD CONSTRAINT simular_fallo_edicion CHECK (operacion <> 'edicion' OR datos->'despues'->>'nombre' <> 'Edición fallida')");
    await assert.rejects(servicio.editar(administrador, creada.id, { ...datos, nombre: 'Edición fallida', latitud: 17, longitud: -92 }));
    assert.deepEqual((await db.query('SELECT nombre,latitud,longitud FROM gasolineras WHERE id=$1', [creada.id])).rows[0], antes);
  });

  await t.test("si la auditoría falla PostgreSQL revierte también la estación", async () => {
    await db.query("ALTER TABLE auditoria_gasolineras ADD CONSTRAINT simular_fallo_auditoria CHECK (datos->>'nombre' <> 'Fallo auditoría')");
    await assert.rejects(servicio.registrar(administrador, { ...datos, nombre: "Fallo auditoría", latitud: 16, longitud: -91 }));
    assert.equal((await db.query("SELECT count(*)::int AS n FROM gasolineras WHERE nombre='Fallo auditoría'")).rows[0].n, 0);
  });

  let preciosHistoricos;
  let combustiblesHistoricos;
  await t.test("desactivar preserva estación, precios históricos y relaciones; la API pública la excluye", async (st) => {
    // Genera un precio anterior cerrado y uno vigente para comprobar ambos.
    await db.query(`
      INSERT INTO precios_combustible (id_combustible_gasolinera,id_modalidad_servicio,id_usuario_registro,precio)
      SELECT pc.id_combustible_gasolinera,pc.id_modalidad_servicio,$2,32.50
      FROM precios_combustible pc JOIN combustibles_gasolinera cg ON cg.id=pc.id_combustible_gasolinera
      WHERE cg.id_gasolinera=$1 AND pc.fecha_vigencia_fin IS NULL
    `, [creada.id, usuario.id]);
    preciosHistoricos = (await db.query(`
      SELECT pc.* FROM precios_combustible pc JOIN combustibles_gasolinera cg ON cg.id=pc.id_combustible_gasolinera
      WHERE cg.id_gasolinera=$1 ORDER BY pc.id
    `, [creada.id])).rows;
    combustiblesHistoricos = (await db.query('SELECT * FROM combustibles_gasolinera WHERE id_gasolinera=$1 ORDER BY id', [creada.id])).rows;
    assert.equal(preciosHistoricos.length, 2);
    assert.ok(preciosHistoricos[0].fecha_vigencia_fin);
    const antes = (await db.query('SELECT * FROM gasolineras WHERE id=$1', [creada.id])).rows[0];
    await servicio.cambiarEstado(administrador, creada.id, { activo: false });
    const despues = (await db.query('SELECT * FROM gasolineras WHERE id=$1', [creada.id])).rows[0];
    assert.equal(despues.activo, false);
    const { activo: _a, fecha_actualizacion: _f, ...original } = antes;
    const { activo: _b, fecha_actualizacion: _g, ...restante } = despues;
    assert.deepEqual(restante, original);
    assert.deepEqual((await db.query(`
      SELECT pc.* FROM precios_combustible pc JOIN combustibles_gasolinera cg ON cg.id=pc.id_combustible_gasolinera
      WHERE cg.id_gasolinera=$1 ORDER BY pc.id
    `, [creada.id])).rows, preciosHistoricos);
    assert.deepEqual((await db.query('SELECT * FROM combustibles_gasolinera WHERE id_gasolinera=$1 ORDER BY id', [creada.id])).rows, combustiblesHistoricos);
    const auditoria = (await db.query("SELECT * FROM auditoria_gasolineras WHERE id_gasolinera=$1 AND operacion='desactivacion'", [creada.id])).rows[0];
    assert.equal(auditoria.id_usuario, usuario.id);
    assert.equal(auditoria.datos.antes.activo, true);
    assert.equal(auditoria.datos.despues.activo, false);
    assert.equal((await servicio.listarAdministracion(administrador)).find((g) => g.codigo === creada.codigo).activo, false);
    assert.deepEqual(await listarGasolinerasConPrecios({ codigo: creada.codigo }, db), []);
    const app = express();
    app.use('/api/publico', crearPublicoRouter((opciones) => listarGasolinerasConPrecios(opciones, db), db));
    app.use((error, _req, res, _next) => res.status(error.statusCode ?? 500).json({ message: error.message }));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    st.after(() => new Promise((resolve) => server.close(resolve)));
    const url = `http://127.0.0.1:${server.address().port}/api/publico`;
    const respuesta = await fetch(`${url}/gasolineras?codigo=${creada.codigo}`);
    assert.equal(respuesta.headers.get('cache-control'), 'no-cache');
    assert.deepEqual((await respuesta.json()).data, []);
    assert.equal((await fetch(`${url}/gasolineras/${creada.codigo}/precios`)).status, 404);
    assert.equal((await (await fetch(`${url}/regiones`)).json()).data.some((r) => r.municipio === 'Monjas'), false);
  });

  await t.test("reactivar recupera la misma estación y sus precios sin perder historial", async () => {
    const resultado = await servicio.cambiarEstado(administrador, creada.id, { activo: true });
    assert.equal(resultado.gasolinera.codigo, creada.codigo);
    const [publica] = await listarGasolinerasConPrecios({ soloVisibles: true, codigo: creada.codigo }, db);
    assert.equal(publica.combustibles[0].precios.autoservicio.precio, 32.5);
    assert.deepEqual((await db.query(`
      SELECT pc.* FROM precios_combustible pc JOIN combustibles_gasolinera cg ON cg.id=pc.id_combustible_gasolinera
      WHERE cg.id_gasolinera=$1 ORDER BY pc.id
    `, [creada.id])).rows, preciosHistoricos);
    assert.deepEqual((await db.query('SELECT * FROM combustibles_gasolinera WHERE id_gasolinera=$1 ORDER BY id', [creada.id])).rows, combustiblesHistoricos);
    const auditoria = (await db.query("SELECT datos FROM auditoria_gasolineras WHERE id_gasolinera=$1 AND operacion='reactivacion'", [creada.id])).rows[0];
    assert.equal(auditoria.datos.antes.activo, false);
    assert.equal(auditoria.datos.despues.activo, true);
  });

  await t.test("desactivaciones concurrentes y repetidas producen un solo cambio auditado", async () => {
    const antes = (await db.query('SELECT count(*)::int AS n FROM auditoria_gasolineras')).rows[0].n;
    const resultados = await Promise.all([
      servicio.cambiarEstado(administrador, creada.id, { activo: false }),
      servicio.cambiarEstado(administrador, creada.id, { activo: false }),
    ]);
    assert.equal(resultados.filter((r) => r.cambiado).length, 1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM auditoria_gasolineras')).rows[0].n, antes + 1);
    await servicio.cambiarEstado(administrador, creada.id, { activo: true });
  });

  await t.test("si falla la auditoría PostgreSQL conserva el estado y todo el historial", async () => {
    await db.query("ALTER TABLE auditoria_gasolineras ADD CONSTRAINT simular_fallo_estado CHECK (operacion NOT IN ('desactivacion','reactivacion')) NOT VALID");
    for (const activo of [true, false]) {
      await db.query('UPDATE gasolineras SET activo=$2 WHERE id=$1', [creada.id, activo]);
      await assert.rejects(servicio.cambiarEstado(administrador, creada.id, { activo: !activo }));
      assert.equal((await db.query('SELECT activo FROM gasolineras WHERE id=$1', [creada.id])).rows[0].activo, activo);
      assert.deepEqual((await db.query(`
        SELECT pc.* FROM precios_combustible pc JOIN combustibles_gasolinera cg ON cg.id=pc.id_combustible_gasolinera
        WHERE cg.id_gasolinera=$1 ORDER BY pc.id
      `, [creada.id])).rows, preciosHistoricos);
    }
    await db.query('ALTER TABLE auditoria_gasolineras DROP CONSTRAINT simular_fallo_estado');
  });

  await t.test("reactivar una estación privada no la publica automáticamente", async () => {
    await db.query('UPDATE gasolineras SET visible_publico=FALSE WHERE id=$1', [creada.id]);
    await servicio.cambiarEstado(administrador, creada.id, { activo: true });
    assert.deepEqual(await listarGasolinerasConPrecios({ soloVisibles: true, codigo: creada.codigo }, db), []);
    assert.equal((await listarGasolinerasConPrecios({ codigo: creada.codigo }, db))[0].codigo, creada.codigo);
  });
});
