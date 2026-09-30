import { createHash, randomBytes } from "node:crypto";
import * as argon2 from "argon2";

export const DURACION_SESION_MS = 8 * 60 * 60 * 1000;

const tokenValido = (token) => typeof token === "string" && /^[a-f0-9]{64}$/.test(token);
const resumenToken = (token) => createHash("sha256").update(token).digest("hex");
let hashFicticio;

function errorHttp(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function usuarioPublico(fila) {
  return {
    id: String(fila.id),
    nombre: fila.nombre_completo,
    usuario: fila.nombre_usuario,
    rol: fila.rol,
    idGasolinera: fila.id_gasolinera == null ? null : String(fila.id_gasolinera),
  };
}

export function crearServicioAuth(database) {
  async function transaccion(operacion) {
    const cliente = await database.connect();
    let resultado;
    try {
      await cliente.query("BEGIN");
      resultado = await operacion(cliente);
      await cliente.query("COMMIT");
    } catch (error) {
      await cliente.query("ROLLBACK");
      throw error;
    } finally {
      cliente.release();
    }

    // Los intentos fallidos deben persistirse antes de responder el error.
    if (resultado.error) throw resultado.error;
    return resultado;
  }

  async function registrarFallo(cliente, fila) {
    await cliente.query(`
      UPDATE usuarios SET
        intentos_fallidos = CASE WHEN bloqueado_hasta <= CURRENT_TIMESTAMP
          THEN 1 ELSE LEAST(intentos_fallidos + 1, 5) END,
        bloqueado_hasta = CASE
          WHEN bloqueado_hasta <= CURRENT_TIMESTAMP THEN NULL
          WHEN intentos_fallidos >= 4 THEN CURRENT_TIMESTAMP + INTERVAL '15 minutes'
          ELSE NULL END
      WHERE id = $1;
    `, [fila.id]);
    return { error: errorHttp(401, "Usuario o contraseña incorrectos.") };
  }

  async function nuevaSesion(cliente, fila, tokenAnterior) {
    if (tokenValido(tokenAnterior)) {
      await cliente.query("DELETE FROM sesiones_usuario WHERE token_hash = $1", [resumenToken(tokenAnterior)]);
    }
    await cliente.query("DELETE FROM sesiones_usuario WHERE fecha_expiracion <= CURRENT_TIMESTAMP");
    const token = randomBytes(32).toString("hex");
    await cliente.query(`
      INSERT INTO sesiones_usuario (token_hash, id_usuario, fecha_expiracion)
      VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '8 hours');
    `, [resumenToken(token), fila.id]);
    return { token, usuario: usuarioPublico(fila) };
  }

  async function iniciarSesion(usuario, password, tokenAnterior) {
    if (typeof usuario !== "string" || !usuario.trim() || usuario.trim().length > 100
        || typeof password !== "string" || !password || password.length > 256) {
      throw errorHttp(400, "Escribe un usuario y una contraseña válidos.");
    }

    return transaccion(async (cliente) => {
      const { rows: [fila] } = await cliente.query(`
        SELECT u.*, r.codigo AS rol, r.activo AS rol_activo,
          u.bloqueado_hasta > CURRENT_TIMESTAMP AS bloqueado
        FROM usuarios u JOIN roles r ON r.id = u.id_rol
        WHERE LOWER(u.nombre_usuario) = LOWER($1) FOR UPDATE OF u;
      `, [usuario.trim()]);

      if (!fila || !fila.activo || !fila.rol_activo) {
        hashFicticio ??= argon2.hash(randomBytes(32), { type: argon2.argon2id });
        await argon2.verify(await hashFicticio, password);
        return { error: errorHttp(401, "Usuario o contraseña incorrectos.") };
      }
      if (fila.bloqueado) {
        return { error: errorHttp(429, "Demasiados intentos. Intenta de nuevo en 15 minutos.") };
      }
      if (!await argon2.verify(fila.contrasena_hash, password)) {
        return registrarFallo(cliente, fila);
      }

      await cliente.query(`
        UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL,
          ultimo_acceso = CURRENT_TIMESTAMP WHERE id = $1;
      `, [fila.id]);
      return nuevaSesion(cliente, fila, tokenAnterior);
    });
  }

  async function obtenerSesion(token) {
    if (!tokenValido(token)) return null;
    const { rows: [fila] } = await database.query(`
      SELECT u.*, r.codigo AS rol FROM sesiones_usuario s
      JOIN usuarios u ON u.id = s.id_usuario AND u.activo = TRUE
      JOIN roles r ON r.id = u.id_rol AND r.activo = TRUE
      WHERE s.token_hash = $1 AND s.fecha_expiracion > CURRENT_TIMESTAMP;
    `, [resumenToken(token)]);
    return fila ? usuarioPublico(fila) : null;
  }

  async function cerrarSesion(token) {
    if (!tokenValido(token)) return;
    await database.query(
      "DELETE FROM sesiones_usuario WHERE token_hash = $1",
      [resumenToken(token)],
    );
  }

  return { iniciarSesion, obtenerSesion, cerrarSesion };
}
