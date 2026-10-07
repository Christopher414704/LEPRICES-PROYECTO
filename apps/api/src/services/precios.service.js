const errorHttp = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const idValido = (valor) => /^(?:[1-9]\d{0,17})$/.test(String(valor ?? ""));
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const PRECIO = /^(?:(?:[1-9]\d{0,7})(?:\.\d{1,2})?|0\.(?:0[1-9]|[1-9]\d?))$/;
const CODIGO_COMBUSTIBLE = /^[a-z0-9_-]{1,50}$/;

function fechaValida(valor) {
  if (valor == null || valor === "") return null;
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const fecha = new Date(`${valor}T00:00:00.000Z`);
  return Number.isFinite(fecha.getTime()) && fecha.toISOString().startsWith(valor) ? valor : false;
}

async function transaccion(database, operacion) {
  const cliente = await database.connect();
  try {
    await cliente.query("BEGIN");
    const resultado = await operacion(cliente);
    await cliente.query("COMMIT");
    return resultado;
  } catch (error) {
    await cliente.query("ROLLBACK");
    if (error.code === "23505") throw errorHttp(409, "Este dato ya existe o la gasolinera ya tiene un gestor activo.");
    if (error.code === "P0001" && /permiso vigente|usuario no existe|usuario.*inactivo/i.test(error.message)) {
      throw errorHttp(403, "El permiso para cambiar precios terminó o fue desactivado.");
    }
    if (error.code === "P0001" && /combustible|gasolinera|modalidad/i.test(error.message)) {
      throw errorHttp(409, "El combustible o la gasolinera dejó de estar disponible.");
    }
    throw error;
  } finally {
    cliente.release();
  }
}

async function permisoEdicion(cliente, idUsuario, idGasolinera) {
  const { rows: [permiso] } = await cliente.query(`
    SELECT u.id_gasolinera, r.codigo AS rol,
      u.activo AND r.activo AND g.activo AS activo,
      (u.precio_horario_activo AND u.precio_hora_inicio IS NOT NULL
        AND (clock_timestamp() AT TIME ZONE 'America/Guatemala')::time >= u.precio_hora_inicio
        AND (clock_timestamp() AT TIME ZONE 'America/Guatemala')::time <
          u.precio_hora_inicio + u.precio_duracion_minutos * INTERVAL '1 minute') AS horario_vigente
    FROM usuarios u JOIN roles r ON r.id = u.id_rol
    LEFT JOIN gasolineras g ON g.id = $2
    WHERE u.id = $1 FOR UPDATE OF u
  `, [idUsuario, idGasolinera]);
  if (!permiso?.activo) throw errorHttp(403, "La cuenta o la gasolinera no está activa.");
  if (permiso.rol === "administrador") return;
  if (permiso.rol !== "gestor_gasolinera" ||
      String(permiso.id_gasolinera) !== String(idGasolinera)) {
    throw errorHttp(403, "Solo puedes cambiar precios de tu gasolinera asignada.");
  }
  if (!permiso.horario_vigente) {
    throw errorHttp(403, "Fuera del horario autorizado para cambiar precios (hora de Guatemala).");
  }
}

export function crearServicioPrecios(database) {
  async function historial(usuario, filtros = {}) {
    if (usuario?.rol !== "administrador") {
      throw errorHttp(403, "Solo un administrador puede consultar el historial de precios.");
    }
    const idGasolinera = String(filtros.idGasolinera ?? "");
    const combustible = filtros.combustible == null || filtros.combustible === ""
      ? null : String(filtros.combustible);
    const desde = fechaValida(filtros.desde);
    const hasta = fechaValida(filtros.hasta);
    if (!idValido(idGasolinera) || (combustible && !CODIGO_COMBUSTIBLE.test(combustible)) ||
        desde === false || hasta === false || (desde && hasta && desde > hasta)) {
      throw errorHttp(400, "Los filtros del historial no son válidos.");
    }
    const { rows: [gasolinera] } = await database.query(
      "SELECT id, nombre FROM gasolineras WHERE id=$1", [idGasolinera]);
    if (!gasolinera) throw errorHttp(404, "La gasolinera no existe.");
    const { rows } = await database.query(`
      WITH cambios AS (
        SELECT pc.id, pc.precio AS precio_nuevo,
          LAG(pc.precio) OVER (
            PARTITION BY pc.id_combustible_gasolinera, pc.id_modalidad_servicio
            ORDER BY pc.fecha_vigencia_inicio, pc.id
          ) AS precio_anterior,
          TRIM(pc.codigo_moneda) AS moneda, pc.unidad_medida,
          pc.fecha_vigencia_inicio AS fecha,
          cg.nombre_comercial AS combustible, tc.codigo AS codigo_combustible,
          ms.nombre AS modalidad, u.id AS id_usuario,
          u.nombre_completo AS usuario, u.nombre_usuario
        FROM precios_combustible pc
        JOIN combustibles_gasolinera cg ON cg.id=pc.id_combustible_gasolinera
        JOIN tipos_combustible tc ON tc.id=cg.id_tipo_combustible
        JOIN modalidades_servicio ms ON ms.id=pc.id_modalidad_servicio
        LEFT JOIN usuarios u ON u.id=pc.id_usuario_registro
        WHERE cg.id_gasolinera=$1
      )
      SELECT * FROM cambios
      WHERE ($2::TEXT IS NULL OR codigo_combustible=$2)
        AND ($3::DATE IS NULL OR (fecha AT TIME ZONE 'America/Guatemala')::DATE >= $3)
        AND ($4::DATE IS NULL OR (fecha AT TIME ZONE 'America/Guatemala')::DATE <= $4)
      ORDER BY fecha DESC, id DESC
    `, [idGasolinera, combustible, desde, hasta]);
    return {
      gasolinera: { id: String(gasolinera.id), nombre: gasolinera.nombre },
      registros: rows.map((fila) => ({
        id: String(fila.id),
        combustible: { nombre: fila.combustible, codigo: fila.codigo_combustible },
        modalidad: fila.modalidad,
        precioAnterior: fila.precio_anterior == null ? null : Number(fila.precio_anterior),
        precioNuevo: Number(fila.precio_nuevo),
        moneda: fila.moneda,
        unidadMedida: fila.unidad_medida,
        fecha: fila.fecha,
        usuario: fila.id_usuario == null ? null : {
          id: String(fila.id_usuario), nombre: fila.usuario, usuario: fila.nombre_usuario,
        },
      })),
    };
  }

  async function estado(usuario) {
    const { rows: [fila] } = await database.query(`
      SELECT u.id_gasolinera, r.codigo AS rol, u.precio_horario_activo,
        to_char(u.precio_hora_inicio, 'HH24:MI') AS hora_inicio,
        u.precio_duracion_minutos,
        (u.precio_horario_activo AND u.precio_hora_inicio IS NOT NULL
          AND (clock_timestamp() AT TIME ZONE 'America/Guatemala')::time >= u.precio_hora_inicio
          AND (clock_timestamp() AT TIME ZONE 'America/Guatemala')::time <
            u.precio_hora_inicio + u.precio_duracion_minutos * INTERVAL '1 minute') AS horario_vigente,
        to_char(clock_timestamp() AT TIME ZONE 'America/Guatemala', 'HH24:MI') AS hora_guatemala
      FROM usuarios u JOIN roles r ON r.id = u.id_rol
      WHERE u.id = $1 AND u.activo = TRUE AND r.activo = TRUE
    `, [usuario.id]);
    if (!fila) throw errorHttp(401, "Inicia sesión para continuar.");
    const [catalogos, gestores] = await Promise.all([
      database.query(`
        SELECT id, nombre, codigo, orden_visual, 'tipo' AS categoria FROM tipos_combustible WHERE activo = TRUE
        UNION ALL
        SELECT id, nombre, codigo, orden_visual, 'modalidad' AS categoria FROM modalidades_servicio WHERE activo = TRUE
        ORDER BY categoria, orden_visual, nombre
      `),
      fila.rol === "administrador" ? database.query(`
        SELECT u.id, u.nombre_completo AS nombre, u.nombre_usuario AS usuario,
          u.id_gasolinera, u.precio_horario_activo,
          to_char(u.precio_hora_inicio, 'HH24:MI') AS hora_inicio,
          u.precio_duracion_minutos
        FROM usuarios u JOIN roles r ON r.id = u.id_rol
        WHERE r.codigo = 'gestor_gasolinera' AND u.activo = TRUE
        ORDER BY u.nombre_completo
      `) : Promise.resolve({ rows: [] }),
    ]);
    return {
      rol: fila.rol,
      idGasolinera: fila.id_gasolinera == null ? null : String(fila.id_gasolinera),
      horarioActivo: fila.precio_horario_activo,
      horaInicio: fila.hora_inicio,
      duracion: fila.precio_duracion_minutos,
      horarioVigente: Boolean(fila.horario_vigente),
      horaGuatemala: fila.hora_guatemala,
      tipos: catalogos.rows.filter((r) => r.categoria === "tipo").map(({ id, nombre, codigo }) => ({ id: String(id), nombre, codigo })),
      modalidades: catalogos.rows.filter((r) => r.categoria === "modalidad").map(({ id, nombre, codigo }) => ({ id: String(id), nombre, codigo })),
      gestores: gestores.rows.map((r) => ({
        id: String(r.id), nombre: r.nombre, usuario: r.usuario,
        idGasolinera: r.id_gasolinera == null ? null : String(r.id_gasolinera),
        horarioActivo: r.precio_horario_activo, horaInicio: r.hora_inicio,
        duracion: r.precio_duracion_minutos,
      })),
    };
  }

  async function asignar(usuario, idGestor, datos) {
    if (usuario.rol !== "administrador") throw errorHttp(403, "Solo un administrador puede asignar horarios.");
    const { idGasolinera, horaInicio, duracion } = datos ?? {};
    const minutos = Number(duracion);
    if (!idValido(idGestor) || !idValido(idGasolinera) || typeof horaInicio !== "string" || !HORA.test(horaInicio) ||
        ![15, 30, 60].includes(minutos) ||
        Number(horaInicio.slice(0, 2)) * 60 + Number(horaInicio.slice(3)) + minutos >= 1440) {
      throw errorHttp(400, "Selecciona una gasolinera, una hora y una duración válidas.");
    }
    return transaccion(database, async (cliente) => {
      const { rows: [estacion] } = await cliente.query("SELECT id FROM gasolineras WHERE id=$1 AND activo=TRUE", [idGasolinera]);
      if (!estacion) throw errorHttp(404, "La gasolinera no existe o está inactiva.");
      const { rows: [gestor] } = await cliente.query(`
        UPDATE usuarios u SET id_gasolinera=$2, precio_hora_inicio=$3,
          precio_duracion_minutos=$4, precio_horario_activo=TRUE
        FROM roles r WHERE u.id=$1 AND u.id_rol=r.id AND r.codigo='gestor_gasolinera'
          AND u.activo=TRUE AND r.activo=TRUE RETURNING u.id
      `, [idGestor, idGasolinera, horaInicio, minutos]);
      if (!gestor) throw errorHttp(404, "El gestor no existe o está inactivo.");
      return { guardado: true };
    });
  }

  async function revocar(usuario, idGestor) {
    if (usuario.rol !== "administrador") throw errorHttp(403, "Solo un administrador puede desactivar horarios.");
    if (!idValido(idGestor)) throw errorHttp(400, "Selecciona un gestor válido.");
    const { rowCount } = await database.query(`
      UPDATE usuarios u SET precio_horario_activo=FALSE,
        precio_hora_inicio=NULL, precio_duracion_minutos=NULL
      FROM roles r WHERE u.id=$1 AND u.id_rol=r.id AND r.codigo='gestor_gasolinera'
        AND u.activo=TRUE AND r.activo=TRUE
    `, [idGestor]);
    if (!rowCount) throw errorHttp(404, "El gestor no existe o está inactivo.");
    return { guardado: true };
  }

  async function agregarCombustible(usuario, datos) {
    const { idGasolinera, idTipo } = datos ?? {};
    if (!idValido(idGasolinera) || !idValido(idTipo)) throw errorHttp(400, "Selecciona una gasolinera y un combustible válidos.");
    return transaccion(database, async (cliente) => {
      await permisoEdicion(cliente, usuario.id, idGasolinera);
      const { rows: [tipo] } = await cliente.query(
        "SELECT id, nombre, codigo, orden_visual FROM tipos_combustible WHERE id=$1 AND activo=TRUE", [idTipo]);
      if (!tipo) throw errorHttp(404, "El combustible no existe o está inactivo.");
      const { rows: [existente] } = await cliente.query(`
        SELECT id FROM combustibles_gasolinera WHERE id_gasolinera=$1 AND codigo=$2
      `, [idGasolinera, tipo.codigo]);
      if (existente) throw errorHttp(409, "Este combustible ya está registrado en la gasolinera.");
      await cliente.query(`
        INSERT INTO combustibles_gasolinera
          (id_gasolinera, id_tipo_combustible, nombre_comercial, codigo, orden_visual)
        VALUES ($1,$2,$3,$4,$5)
      `, [idGasolinera, tipo.id, tipo.nombre, tipo.codigo, tipo.orden_visual]);
      return { guardado: true };
    });
  }

  async function registrar(usuario, datos) {
    const { idGasolinera, cambios } = datos ?? {};
    if (!idValido(idGasolinera) || !Array.isArray(cambios) || !cambios.length || cambios.length > 32) {
      throw errorHttp(400, "Selecciona una gasolinera y al menos un precio válido.");
    }
    const usados = new Set();
    for (const cambio of cambios) {
      const clave = `${cambio?.idCombustible}:${cambio?.idModalidad}`;
      if (!idValido(cambio?.idCombustible) || !idValido(cambio?.idModalidad) ||
          !PRECIO.test(String(cambio?.precio ?? "")) || usados.has(clave)) {
        throw errorHttp(400, "Hay precios, combustibles o modalidades inválidos o repetidos.");
      }
      usados.add(clave);
    }
    return transaccion(database, async (cliente) => {
      await permisoEdicion(cliente, usuario.id, idGasolinera);
      const ids = [...new Set(cambios.map((c) => String(c.idCombustible)))];
      const { rows: combustibles } = await cliente.query(`
        SELECT id FROM combustibles_gasolinera
        WHERE id = ANY($1::bigint[]) AND id_gasolinera=$2 AND activo=TRUE
      `, [ids, idGasolinera]);
      if (combustibles.length !== ids.length) throw errorHttp(403, "Hay combustibles que no pertenecen a esta gasolinera.");
      const { rows: modalidades } = await cliente.query("SELECT id FROM modalidades_servicio WHERE activo=TRUE");
      const validas = new Set(modalidades.map((m) => String(m.id)));
      if (cambios.some((c) => !validas.has(String(c.idModalidad)))) throw errorHttp(400, "Una modalidad no está disponible.");
      let actualizados = 0;
      for (const cambio of cambios) {
        const { rows: [vigente] } = await cliente.query(`
          SELECT precio FROM precios_combustible
          WHERE id_combustible_gasolinera=$1 AND id_modalidad_servicio=$2 AND fecha_vigencia_fin IS NULL
        `, [cambio.idCombustible, cambio.idModalidad]);
        if (vigente && Number(vigente.precio) === Number(cambio.precio)) continue;
        await cliente.query(`
          INSERT INTO precios_combustible
            (id_combustible_gasolinera, id_modalidad_servicio, id_usuario_registro, precio)
          VALUES ($1,$2,$3,$4)
        `, [cambio.idCombustible, cambio.idModalidad, usuario.id, cambio.precio]);
        actualizados += 1;
      }
      return {
        guardado: true,
        actualizados,
        message: actualizados === 1
          ? "Precio actualizado correctamente."
          : actualizados > 1
            ? `${actualizados} precios actualizados correctamente.`
            : "Los precios ya estaban actualizados.",
      };
    });
  }

  return { estado, historial, asignar, revocar, agregarCombustible, registrar };
}
