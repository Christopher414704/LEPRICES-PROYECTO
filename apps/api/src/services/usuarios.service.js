import * as argon2 from "argon2";

const errorHttp = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const ID = /^[1-9]\d{0,17}$/;
const USUARIO = /^[\p{L}\p{N}._-]{4,100}$/u;
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function texto(valor, campo, maximo) {
  if (typeof valor !== "string") throw errorHttp(400, `Ingresa ${campo}.`);
  const limpio = valor.trim().replace(/\s+/g, " ");
  if (!limpio || limpio.length > maximo || /[\u0000-\u001f\u007f]/.test(limpio)) {
    throw errorHttp(400, `Ingresa ${campo} válido.`);
  }
  return limpio;
}

export function validarNuevoUsuario(datos) {
  const nombre = texto(datos?.nombre, "el nombre completo", 150);
  const usuario = texto(datos?.usuario, "el nombre de usuario", 100);
  const correo = texto(datos?.correo, "el correo electrónico", 254).toLocaleLowerCase("es");
  const password = datos?.password;
  const idRol = String(datos?.idRol ?? "");
  const idGasolinera = datos?.idGasolinera == null || datos.idGasolinera === ""
    ? null : String(datos.idGasolinera);
  if (!USUARIO.test(usuario)) throw errorHttp(400, "El usuario debe tener entre 4 y 100 letras, números, puntos, guiones o guiones bajos.");
  if (!CORREO.test(correo)) throw errorHttp(400, "Ingresa un correo electrónico válido.");
  if (typeof password !== "string" || password.length < 12 || password.length > 128) {
    throw errorHttp(400, "La contraseña debe tener entre 12 y 128 caracteres.");
  }
  if (!ID.test(idRol) || (idGasolinera && !ID.test(idGasolinera))) {
    throw errorHttp(400, "Selecciona un rol y una gasolinera válidos.");
  }
  return { nombre, usuario, correo, password, idRol, idGasolinera };
}

function publico(fila) {
  return {
    id: String(fila.id), nombre: fila.nombre_completo, usuario: fila.nombre_usuario,
    correo: fila.correo_electronico, activo: Boolean(fila.activo),
    rol: { id: String(fila.id_rol), codigo: fila.codigo_rol, nombre: fila.nombre_rol },
    gasolinera: fila.id_gasolinera == null ? null : {
      id: String(fila.id_gasolinera), nombre: fila.nombre_gasolinera,
    },
    ultimoAcceso: fila.ultimo_acceso,
  };
}

async function administradorActivo(cliente, usuario, bloqueo = "FOR SHARE OF u, r") {
  if (usuario?.rol !== "administrador" || !ID.test(String(usuario.id ?? ""))) {
    throw errorHttp(403, "Solo un administrador puede gestionar usuarios.");
  }
  const { rows: [administrador] } = await cliente.query(`
    SELECT u.id FROM usuarios u JOIN roles r ON r.id=u.id_rol
    WHERE u.id=$1 AND u.activo=TRUE AND r.activo=TRUE AND r.codigo='administrador'
    ${bloqueo}
  `, [usuario.id]);
  if (!administrador) throw errorHttp(403, "La cuenta no tiene permisos de administrador activos.");
}

export function crearServicioUsuarios(database) {
  async function listar(usuario) {
    await administradorActivo(database, usuario, "");
    const [usuarios, roles, gasolineras] = await Promise.all([
      database.query(`
        SELECT u.id,u.nombre_completo,u.nombre_usuario,u.correo_electronico,u.activo,
          u.id_rol,r.codigo AS codigo_rol,r.nombre AS nombre_rol,u.id_gasolinera,
          g.nombre AS nombre_gasolinera,u.ultimo_acceso
        FROM usuarios u JOIN roles r ON r.id=u.id_rol
        LEFT JOIN gasolineras g ON g.id=u.id_gasolinera
        ORDER BY u.nombre_completo,u.id
      `),
      database.query("SELECT id,codigo,nombre FROM roles WHERE activo=TRUE ORDER BY nombre"),
      database.query("SELECT id,nombre,activo FROM gasolineras ORDER BY nombre,id"),
    ]);
    return {
      usuarios: usuarios.rows.map(publico),
      roles: roles.rows.map((r) => ({ id: String(r.id), codigo: r.codigo, nombre: r.nombre })),
      gasolineras: gasolineras.rows.map((g) => ({ id: String(g.id), nombre: g.nombre, activo: g.activo })),
    };
  }

  async function registrar(usuarioAutenticado, datos) {
    if (usuarioAutenticado?.rol !== "administrador") {
      throw errorHttp(403, "Solo un administrador puede gestionar usuarios.");
    }
    const nuevo = validarNuevoUsuario(datos);
    const hash = await argon2.hash(nuevo.password, { type: argon2.argon2id });
    const cliente = await database.connect();
    try {
      await cliente.query("BEGIN");
      await administradorActivo(cliente, usuarioAutenticado);
      const { rows: [rol] } = await cliente.query(
        "SELECT id,codigo,nombre FROM roles WHERE id=$1 AND activo=TRUE FOR SHARE", [nuevo.idRol]);
      if (!rol) throw errorHttp(400, "El rol no existe o está inactivo.");
      if (rol.codigo === "gestor_gasolinera" && !nuevo.idGasolinera) {
        throw errorHttp(400, "Selecciona la gasolinera asignada al gestor.");
      }
      if (rol.codigo !== "gestor_gasolinera" && nuevo.idGasolinera) {
        throw errorHttp(400, "Solo los gestores pueden tener una gasolinera asignada.");
      }
      let gasolinera = null;
      if (nuevo.idGasolinera) {
        const { rows: [fila] } = await cliente.query(
          "SELECT id,nombre FROM gasolineras WHERE id=$1 AND activo=TRUE FOR SHARE", [nuevo.idGasolinera]);
        if (!fila) throw errorHttp(400, "La gasolinera no existe o está inactiva.");
        gasolinera = fila;
      }
      const { rows: [fila] } = await cliente.query(`
        INSERT INTO usuarios
          (id_rol,id_gasolinera,nombre_completo,nombre_usuario,correo_electronico,contrasena_hash,debe_cambiar_contrasena)
        VALUES ($1,$2,$3,$4,$5,$6,TRUE)
        RETURNING id,nombre_completo,nombre_usuario,correo_electronico,activo,id_rol,id_gasolinera,ultimo_acceso
      `, [nuevo.idRol, nuevo.idGasolinera, nuevo.nombre, nuevo.usuario, nuevo.correo, hash]);
      const creado = publico({ ...fila, codigo_rol: rol.codigo, nombre_rol: rol.nombre,
        nombre_gasolinera: gasolinera?.nombre ?? null });
      await cliente.query(`
        INSERT INTO auditoria_usuarios (id_usuario_objetivo,id_administrador,operacion,datos)
        VALUES ($1,$2,'registro',$3::jsonb)
      `, [fila.id, usuarioAutenticado.id, JSON.stringify(creado)]);
      await cliente.query("COMMIT");
      return creado;
    } catch (error) {
      await cliente.query("ROLLBACK");
      if (error.code === "23505") throw errorHttp(409, "El nombre de usuario, correo o gasolinera asignada ya está en uso.");
      throw error;
    } finally {
      cliente.release();
    }
  }

  async function cambiarEstado(usuarioAutenticado, id, datos) {
    if (usuarioAutenticado?.rol !== "administrador") {
      throw errorHttp(403, "Solo un administrador puede gestionar usuarios.");
    }
    if (!ID.test(String(id ?? "")) || typeof datos?.activo !== "boolean") {
      throw errorHttp(400, "Selecciona un usuario y un estado válidos.");
    }
    if (String(id) === String(usuarioAutenticado?.id) && datos.activo === false) {
      throw errorHttp(409, "No puedes desactivar tu propia cuenta.");
    }
    const cliente = await database.connect();
    try {
      await cliente.query("BEGIN");
      await administradorActivo(cliente, usuarioAutenticado);
      const { rows: [anterior] } = await cliente.query(`
        SELECT u.id,u.nombre_completo,u.nombre_usuario,u.correo_electronico,u.activo,
          u.id_rol,r.codigo AS codigo_rol,r.nombre AS nombre_rol,u.id_gasolinera,
          g.nombre AS nombre_gasolinera,u.ultimo_acceso
        FROM usuarios u JOIN roles r ON r.id=u.id_rol
        LEFT JOIN gasolineras g ON g.id=u.id_gasolinera
        WHERE u.id=$1 FOR UPDATE OF u
      `, [id]);
      if (!anterior) throw errorHttp(404, "El usuario no existe.");
      if (anterior.activo === datos.activo) {
        await cliente.query("COMMIT");
        return { usuario: publico(anterior), cambiado: false };
      }
      const { rows: [actualizado] } = await cliente.query(
        "UPDATE usuarios SET activo=$2,intentos_fallidos=0,bloqueado_hasta=NULL WHERE id=$1 RETURNING *",
        [id, datos.activo]);
      if (!datos.activo) await cliente.query("DELETE FROM sesiones_usuario WHERE id_usuario=$1", [id]);
      const resultado = publico({ ...actualizado, codigo_rol: anterior.codigo_rol,
        nombre_rol: anterior.nombre_rol, nombre_gasolinera: anterior.nombre_gasolinera });
      await cliente.query(`
        INSERT INTO auditoria_usuarios (id_usuario_objetivo,id_administrador,operacion,datos)
        VALUES ($1,$2,$3,$4::jsonb)
      `, [id, usuarioAutenticado.id, datos.activo ? "activacion" : "desactivacion",
        JSON.stringify({ antes: { activo: anterior.activo }, despues: { activo: resultado.activo } })]);
      await cliente.query("COMMIT");
      return { usuario: resultado, cambiado: true };
    } catch (error) {
      await cliente.query("ROLLBACK");
      if (error.code === "23505") {
        throw errorHttp(409, "La gasolinera ya tiene otro gestor activo.");
      }
      throw error;
    } finally {
      cliente.release();
    }
  }

  async function asignarGasolinera(usuarioAutenticado, idGestor, datos) {
    if (usuarioAutenticado?.rol !== "administrador") {
      throw errorHttp(403, "Solo un administrador puede asignar gestores.");
    }
    const idGasolinera = String(datos?.idGasolinera ?? "");
    if (!ID.test(String(idGestor ?? "")) || !ID.test(idGasolinera)) {
      throw errorHttp(400, "Selecciona un gestor y una gasolinera válidos.");
    }

    const cliente = await database.connect();
    try {
      await cliente.query("BEGIN");
      await administradorActivo(cliente, usuarioAutenticado);
      const { rows: [gestor] } = await cliente.query(`
        SELECT u.id,u.nombre_completo,u.nombre_usuario,u.correo_electronico,u.activo,
          u.id_rol,r.codigo AS codigo_rol,r.nombre AS nombre_rol,u.id_gasolinera,
          g.nombre AS nombre_gasolinera,u.ultimo_acceso
        FROM usuarios u JOIN roles r ON r.id=u.id_rol
        LEFT JOIN gasolineras g ON g.id=u.id_gasolinera
        WHERE u.id=$1 AND u.activo=TRUE AND r.activo=TRUE AND r.codigo='gestor_gasolinera'
        FOR UPDATE OF u
      `, [idGestor]);
      if (!gestor) throw errorHttp(404, "El gestor no existe o está inactivo.");

      const { rows: [gasolinera] } = await cliente.query(
        "SELECT id,nombre FROM gasolineras WHERE id=$1 AND activo=TRUE FOR UPDATE", [idGasolinera]);
      if (!gasolinera) throw errorHttp(404, "La gasolinera no existe o está inactiva.");

      if (String(gestor.id_gasolinera) === idGasolinera) {
        await cliente.query("COMMIT");
        return { usuario: publico(gestor), cambiado: false };
      }

      const { rows: [ocupacion] } = await cliente.query(`
        SELECT id FROM usuarios WHERE id_gasolinera=$1 AND activo=TRUE AND id<>$2
        LIMIT 1 FOR UPDATE
      `, [idGasolinera, idGestor]);
      if (ocupacion) throw errorHttp(409, "La gasolinera ya tiene un gestor asignado.");

      const { rows: [actualizado] } = await cliente.query(
        "UPDATE usuarios SET id_gasolinera=$2 WHERE id=$1 RETURNING *", [idGestor, idGasolinera]);
      const resultado = publico({ ...actualizado, codigo_rol: gestor.codigo_rol,
        nombre_rol: gestor.nombre_rol, nombre_gasolinera: gasolinera.nombre });
      await cliente.query(`
        INSERT INTO auditoria_asignaciones_gestores
          (id_usuario_gestor,id_administrador,id_gasolinera_anterior,id_gasolinera_nueva,datos)
        VALUES ($1,$2,$3,$4,$5::jsonb)
      `, [idGestor, usuarioAutenticado.id, gestor.id_gasolinera, idGasolinera,
        JSON.stringify({
          antes: gestor.id_gasolinera == null ? null : {
            idGasolinera: String(gestor.id_gasolinera), nombreGasolinera: gestor.nombre_gasolinera,
          },
          despues: { idGasolinera, nombreGasolinera: gasolinera.nombre },
        })]);
      await cliente.query("COMMIT");
      return { usuario: resultado, cambiado: true };
    } catch (error) {
      await cliente.query("ROLLBACK");
      if (error.code === "23505") throw errorHttp(409, "La gasolinera ya tiene un gestor asignado.");
      throw error;
    } finally {
      cliente.release();
    }
  }

  return { listar, registrar, cambiarEstado, asignarGasolinera };
}
