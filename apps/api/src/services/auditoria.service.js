const errorHttp = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const ID = /^[1-9]\d{0,17}$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const TIPOS = new Set(["gasolinera", "usuario", "asignacion"]);
const OPERACIONES = new Set(["registro", "edicion", "activacion", "desactivacion", "reactivacion", "asignacion"]);

function fechaValida(valor) {
  if (!FECHA.test(valor)) return false;
  const fecha = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(fecha.valueOf()) && fecha.toISOString().slice(0, 10) === valor;
}

export function validarFiltrosAuditoria(entrada = {}) {
  const tipo = entrada.tipo ? String(entrada.tipo) : null;
  const operacion = entrada.operacion ? String(entrada.operacion) : null;
  const idUsuario = entrada.idUsuario ? String(entrada.idUsuario) : null;
  const desde = entrada.desde ? String(entrada.desde) : null;
  const hasta = entrada.hasta ? String(entrada.hasta) : null;
  const busqueda = String(entrada.busqueda ?? "").trim().replace(/\s+/g, " ");
  const pagina = entrada.pagina == null || entrada.pagina === "" ? 1 : Number(entrada.pagina);
  const limite = entrada.limite == null || entrada.limite === "" ? 25 : Number(entrada.limite);

  if ((tipo && !TIPOS.has(tipo)) || (operacion && !OPERACIONES.has(operacion)) ||
      (idUsuario && !ID.test(idUsuario)) || (desde && !fechaValida(desde)) ||
      (hasta && !fechaValida(hasta)) || (desde && hasta && desde > hasta) ||
      busqueda.length > 120 || !Number.isInteger(pagina) || pagina < 1 ||
      !Number.isInteger(limite) || limite < 1 || limite > 100) {
    throw errorHttp(400, "Los filtros de auditoría no son válidos.");
  }
  return { tipo, operacion, idUsuario, desde, hasta, busqueda: busqueda || null, pagina, limite };
}

function presentar(fila) {
  return {
    id: `${fila.tipo}-${fila.id}`,
    tipo: fila.tipo,
    operacion: fila.operacion,
    fecha: fila.fecha,
    responsable: fila.id_responsable == null ? null : {
      id: String(fila.id_responsable), nombre: fila.responsable, usuario: fila.usuario_responsable,
    },
    elemento: { id: String(fila.id_elemento), nombre: fila.elemento },
    datos: fila.datos,
  };
}

export function crearServicioAuditoria(database) {
  async function listar(usuario, entrada) {
    if (usuario?.rol !== "administrador" || !ID.test(String(usuario.id ?? ""))) {
      throw errorHttp(403, "Solo un administrador puede consultar la auditoría.");
    }
    const filtros = validarFiltrosAuditoria(entrada);
    const { rows: [administrador] } = await database.query(`
      SELECT u.id FROM usuarios u JOIN roles r ON r.id=u.id_rol
      WHERE u.id=$1 AND u.activo=TRUE AND r.activo=TRUE AND r.codigo='administrador'
    `, [usuario.id]);
    if (!administrador) throw errorHttp(403, "La cuenta no tiene permisos de administrador activos.");

    const valores = [filtros.tipo, filtros.operacion, filtros.idUsuario, filtros.desde,
      filtros.hasta, filtros.busqueda, filtros.limite, (filtros.pagina - 1) * filtros.limite];
    const { rows } = await database.query(`
      WITH eventos AS (
        SELECT a.id,'gasolinera'::TEXT AS tipo,a.operacion,a.fecha_creacion AS fecha,
          a.id_usuario AS id_responsable,ur.nombre_completo AS responsable,
          ur.nombre_usuario AS usuario_responsable,a.id_gasolinera AS id_elemento,
          g.nombre AS elemento,a.datos
        FROM auditoria_gasolineras a
        JOIN gasolineras g ON g.id=a.id_gasolinera
        LEFT JOIN usuarios ur ON ur.id=a.id_usuario
        UNION ALL
        SELECT a.id,'usuario'::TEXT,a.operacion,a.fecha_creacion,a.id_administrador,
          ur.nombre_completo,ur.nombre_usuario,a.id_usuario_objetivo,
          u.nombre_completo,a.datos
        FROM auditoria_usuarios a
        JOIN usuarios u ON u.id=a.id_usuario_objetivo
        LEFT JOIN usuarios ur ON ur.id=a.id_administrador
        UNION ALL
        SELECT a.id,'asignacion'::TEXT,'asignacion'::TEXT,a.fecha_creacion,a.id_administrador,
          ur.nombre_completo,ur.nombre_usuario,a.id_usuario_gestor,
          u.nombre_completo,a.datos
        FROM auditoria_asignaciones_gestores a
        JOIN usuarios u ON u.id=a.id_usuario_gestor
        LEFT JOIN usuarios ur ON ur.id=a.id_administrador
      ), filtrados AS (
        SELECT * FROM eventos
        WHERE ($1::TEXT IS NULL OR tipo=$1)
          AND ($2::TEXT IS NULL OR operacion=$2)
          AND ($3::BIGINT IS NULL OR id_responsable=$3)
          AND ($4::DATE IS NULL OR (fecha AT TIME ZONE 'America/Guatemala')::DATE >= $4)
          AND ($5::DATE IS NULL OR (fecha AT TIME ZONE 'America/Guatemala')::DATE <= $5)
          AND ($6::TEXT IS NULL OR CONCAT_WS(' ',elemento,responsable,usuario_responsable,operacion) ILIKE '%' || $6 || '%')
      )
      SELECT *,COUNT(*) OVER()::INT AS total FROM filtrados
      ORDER BY fecha DESC,tipo,id DESC LIMIT $7 OFFSET $8
    `, valores);
    const total = rows[0]?.total ?? 0;
    return {
      registros: rows.map(presentar),
      paginacion: { pagina: filtros.pagina, limite: filtros.limite, total,
        paginas: Math.max(1, Math.ceil(total / filtros.limite)) },
    };
  }
  return { listar };
}
