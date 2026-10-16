import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { env } from "../src/config/env.js";
import { crearServicioFavoritos } from "../src/services/favoritos.service.js";

test("HU-22: persistencia, concurrencia, propietarios y precios en PostgreSQL real", {
  skip: process.env.RUN_DB_TESTS !== "1",
}, async (t) => {
  const schema = `favoritos_test_${randomUUID().replaceAll("-", "")}`;
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
  for (const archivo of ["0001_crear_marcas_y_gasolineras", "0002_crear_roles_y_usuarios",
    "0003_crear_combustibles_y_precios", "0007_publicar_gasolineras", "0019_guardar_favoritos"]) {
    const migracion = await import(`../../../database/migrations/${archivo}.mjs`);
    const consultas = [];
    migracion.up({ sql: (sql) => consultas.push(sql) });
    for (const sql of consultas) await db.query(sql);
  }
  const { rows: usuarios } = await db.query(`
    INSERT INTO usuarios(id_rol,nombre_completo,nombre_usuario,correo_electronico,contrasena_hash)
    SELECT r.id, v.nombre, v.usuario, v.correo, 'hash-prueba'
    FROM roles r CROSS JOIN (VALUES ('Usuario A','usuario_a','a@example.test'),
      ('Usuario B','usuario_b','b@example.test')) v(nombre,usuario,correo)
    WHERE r.codigo='administrador' RETURNING id
  `);
  const [a, b] = usuarios;
  const { rows: [marca] } = await db.query("INSERT INTO marcas(nombre,codigo) VALUES('Marca','marca') RETURNING id");
  const { rows: [estacion] } = await db.query(`
    INSERT INTO gasolineras(id_marca,nombre,codigo,direccion,municipio,departamento,latitud,longitud,visible_publico)
    VALUES($1,'Estación favorita','estacion-favorita','Calle 1','Jalapa','Jalapa',14.63,-89.98,TRUE) RETURNING id
  `, [marca.id]);
  const { rows: [combustible] } = await db.query(`
    INSERT INTO combustibles_gasolinera(id_gasolinera,id_tipo_combustible,nombre_comercial,codigo)
    SELECT $1,id,'Regular comercial','regular-comercial' FROM tipos_combustible WHERE codigo='regular' RETURNING id
  `, [estacion.id]);
  // Más de una oferta comercial del mismo tipo sigue siendo un solo favorito.
  await db.query(`INSERT INTO combustibles_gasolinera(id_gasolinera,id_tipo_combustible,nombre_comercial,codigo)
    SELECT $1,id,'Regular alternativa','regular-alternativa' FROM tipos_combustible WHERE codigo='regular'`, [estacion.id]);
  await db.query(`INSERT INTO precios_combustible(id_combustible_gasolinera,id_modalidad_servicio,id_usuario_registro,precio)
    SELECT $1,id,$2,30.50 FROM modalidades_servicio WHERE codigo='autoservicio'`, [combustible.id, a.id]);
  const servicio = crearServicioFavoritos(db);
  const datos = { codigoGasolinera: "estacion-favorita", codigoCombustible: "regular" };
  let guardado;

  await t.test("solo una solicitud concurrente crea el favorito y persiste al recrear el servicio", async () => {
    const resultados = await Promise.allSettled([servicio.guardar(a, datos), servicio.guardar(a, datos)]);
    guardado = resultados.find((r) => r.status === "fulfilled").value;
    assert.equal(resultados.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(resultados.find((r) => r.status === "rejected").reason.statusCode, 409);
    const [favorito] = await crearServicioFavoritos(db).listar(a);
    assert.equal(favorito.id, guardado.id);
    assert.equal(favorito.precios[0].precio, 30.5);
    assert.equal(favorito.precios[0].codigoModalidad, "autoservicio");
    assert.equal((await servicio.catalogo(a))[0].combustibles.length, 1);
  });

  await t.test("otra cuenta no puede consultar ni eliminar el favorito, pero puede guardar la misma selección", async () => {
    assert.deepEqual(await servicio.listar(b), []);
    await assert.rejects(servicio.eliminar(b, guardado.id), { statusCode: 404 });
    await servicio.guardar(b, datos);
    assert.equal((await servicio.listar(a)).length, 1);
    assert.equal((await servicio.listar(b)).length, 1);
    const { rows: [f] } = await db.query("SELECT * FROM favoritos WHERE id=$1", [guardado.id]);
    await assert.rejects(db.query("INSERT INTO favoritos(id_usuario,id_gasolinera,id_tipo_combustible) VALUES($1,$2,$3)",
      [f.id_usuario, f.id_gasolinera, f.id_tipo_combustible]), { code: "23505" });
  });

  await t.test("rechaza tipos no ofrecidos y mantiene favoritos desactivados sin mostrar precios", async () => {
    await assert.rejects(servicio.guardar(a, { ...datos, codigoCombustible: "diesel" }), { statusCode: 404 });
    await db.query("UPDATE gasolineras SET activo=FALSE WHERE id=$1", [estacion.id]);
    assert.deepEqual(await servicio.catalogo(a), []);
    await assert.rejects(servicio.guardar(a, datos), { statusCode: 404 });
    const [favorito] = await servicio.listar(a);
    assert.equal(favorito.disponible, false);
    assert.deepEqual(favorito.precios, []);
    await servicio.eliminar(a, guardado.id);
    assert.deepEqual(await servicio.listar(a), []);
    assert.equal((await servicio.listar(b)).length, 1);
    await db.query("UPDATE gasolineras SET activo=TRUE WHERE id=$1", [estacion.id]);
    await servicio.guardar(a, datos);
    assert.equal((await servicio.listar(a))[0].disponible, true);
  });

  await t.test("permite revertir y reaplicar la migración", async () => {
    const migracion = await import("../../../database/migrations/0019_guardar_favoritos.mjs");
    const sql = [];
    migracion.down({ sql: (consulta) => sql.push(consulta) });
    migracion.up({ sql: (consulta) => sql.push(consulta) });
    for (const consulta of sql) await db.query(consulta);
    assert.deepEqual(await servicio.listar(a), []);
  });
});
