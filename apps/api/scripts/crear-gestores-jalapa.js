import { randomBytes } from "node:crypto";
import * as argon2 from "argon2";

import { database } from "../src/config/database.js";
import { GASOLINERAS_JALAPA } from "./catalogo-jalapa.datos.js";

function usuarioPara(estacion) {
  return `gestor_${estacion.id.replaceAll("-", "_")}`;
}

async function crearGestores() {
  const cliente = await database.connect();
  const creados = [];
  const existentes = [];
  try {
    await cliente.query("BEGIN");
    const { rows: [rol] } = await cliente.query(`
      SELECT id FROM roles WHERE codigo = 'gestor_gasolinera' AND activo = TRUE
    `);
    if (!rol) throw new Error("El rol de gestor no existe o está inactivo. Ejecuta las migraciones.");

    for (const estacion of GASOLINERAS_JALAPA) {
      const codigo = `jalapa-${estacion.id}`;
      const { rows: [gasolinera] } = await cliente.query(`
        SELECT id, nombre FROM gasolineras WHERE codigo = $1 AND activo = TRUE FOR UPDATE
      `, [codigo]);
      if (!gasolinera) {
        throw new Error(`Falta la gasolinera activa ${codigo}. Ejecuta db:seed:catalogo primero.`);
      }

      const { rows: [asignado] } = await cliente.query(`
        SELECT u.nombre_usuario, r.codigo AS rol
        FROM usuarios u JOIN roles r ON r.id = u.id_rol
        WHERE u.id_gasolinera = $1 AND u.activo = TRUE FOR UPDATE OF u
      `, [gasolinera.id]);
      if (asignado) {
        if (asignado.rol !== "gestor_gasolinera") {
          throw new Error(`${codigo} ya tiene una cuenta activa de otro rol; revísala antes de continuar.`);
        }
        existentes.push({ gasolinera: gasolinera.nombre, usuario: asignado.nombre_usuario });
        continue;
      }

      const usuario = usuarioPara(estacion);
      const { rowCount: nombreOcupado } = await cliente.query(`
        SELECT id FROM usuarios WHERE LOWER(nombre_usuario) = LOWER($1) FOR UPDATE
      `, [usuario]);
      if (nombreOcupado) {
        throw new Error(`El nombre de usuario ${usuario} ya existe para otra cuenta. Revisa la asignación.`);
      }

      const password = randomBytes(18).toString("base64url");
      const hash = await argon2.hash(password, { type: argon2.argon2id });
      await cliente.query(`
        INSERT INTO usuarios
          (id_rol, id_gasolinera, nombre_completo, nombre_usuario, correo_electronico,
            contrasena_hash, debe_cambiar_contrasena)
        VALUES ($1,$2,$3,$4,$5,$6,FALSE)
      `, [rol.id, gasolinera.id, `Gestor de ${gasolinera.nombre}`, usuario,
        `${usuario}@leprices.invalid`, hash]);
      creados.push({ gasolinera: gasolinera.nombre, usuario, password });
    }

    await cliente.query("COMMIT");
    console.log(JSON.stringify({ creados, existentes }, null, 2));
  } catch (error) {
    await cliente.query("ROLLBACK");
    throw error;
  } finally {
    cliente.release();
  }
}

crearGestores()
  .catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(() => database.end());
