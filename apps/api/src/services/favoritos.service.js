const errorHttp = (statusCode, message) => Object.assign(new Error(message), { statusCode });

function idUsuario(usuario) {
  if (!usuario?.id) throw errorHttp(401, "Inicia sesión para consultar tus favoritos.");
  return usuario.id;
}

function codigo(valor, maximo) {
  if (typeof valor !== "string" || !new RegExp(`^[\\w-]{1,${maximo}}$`).test(valor)) {
    throw errorHttp(400, "Selecciona una gasolinera y un combustible válidos.");
  }
  return valor;
}

export function crearServicioFavoritos(db) {
  async function catalogo(usuario) {
    idUsuario(usuario);
    const { rows } = await db.query(`
      SELECT DISTINCT g.codigo, g.nombre, g.municipio, g.departamento,
        tc.codigo AS codigo_combustible, tc.nombre AS nombre_combustible, tc.orden_visual
      FROM gasolineras g
      JOIN marcas m ON m.id=g.id_marca AND m.activo=TRUE
      JOIN combustibles_gasolinera cg ON cg.id_gasolinera=g.id AND cg.activo=TRUE
      JOIN tipos_combustible tc ON tc.id=cg.id_tipo_combustible AND tc.activo=TRUE
      WHERE g.activo=TRUE AND g.visible_publico=TRUE
      ORDER BY g.nombre, g.codigo, tc.orden_visual, tc.nombre
    `);
    const estaciones = new Map();
    for (const fila of rows) {
      if (!estaciones.has(fila.codigo)) estaciones.set(fila.codigo, {
        codigo: fila.codigo, nombre: fila.nombre, municipio: fila.municipio,
        departamento: fila.departamento, combustibles: [],
      });
      estaciones.get(fila.codigo).combustibles.push({ codigo: fila.codigo_combustible, nombre: fila.nombre_combustible });
    }
    return [...estaciones.values()];
  }

  async function listar(usuario) {
    const { rows } = await db.query(`
      SELECT f.id, f.fecha_creacion, g.codigo, g.nombre, g.municipio, g.departamento,
        tc.codigo AS codigo_combustible, tc.nombre AS nombre_combustible,
        (g.activo AND g.visible_publico AND m.activo AND tc.activo AND EXISTS (
          SELECT 1 FROM combustibles_gasolinera cg WHERE cg.id_gasolinera=g.id
            AND cg.id_tipo_combustible=tc.id AND cg.activo=TRUE
        )) AS disponible,
        COALESCE(precios.datos, '[]'::jsonb) AS precios
      FROM favoritos f
      JOIN gasolineras g ON g.id=f.id_gasolinera
      JOIN marcas m ON m.id=g.id_marca
      JOIN tipos_combustible tc ON tc.id=f.id_tipo_combustible
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
          'nombreCombustible', cg.nombre_comercial, 'modalidad', ms.nombre,
          'codigoModalidad', ms.codigo, 'precio', pc.precio,
          'moneda', TRIM(pc.codigo_moneda), 'unidadMedida', pc.unidad_medida,
          'vigenteDesde', pc.fecha_vigencia_inicio
        ) ORDER BY cg.orden_visual, cg.id, ms.orden_visual, ms.id) AS datos
        FROM combustibles_gasolinera cg
        JOIN precios_combustible pc ON pc.id_combustible_gasolinera=cg.id
        JOIN modalidades_servicio ms ON ms.id=pc.id_modalidad_servicio AND ms.activo=TRUE
        WHERE cg.id_gasolinera=g.id AND cg.id_tipo_combustible=tc.id AND cg.activo=TRUE
          AND g.activo=TRUE AND g.visible_publico=TRUE AND m.activo=TRUE AND tc.activo=TRUE
          AND pc.fecha_vigencia_inicio<=CURRENT_TIMESTAMP
          AND (pc.fecha_vigencia_fin IS NULL OR pc.fecha_vigencia_fin>CURRENT_TIMESTAMP)
      ) precios ON TRUE
      WHERE f.id_usuario=$1 ORDER BY f.fecha_creacion DESC, f.id DESC
    `, [idUsuario(usuario)]);
    return rows.map((fila) => ({
      id: String(fila.id), fechaCreacion: fila.fecha_creacion, disponible: fila.disponible,
      gasolinera: { codigo: fila.codigo, nombre: fila.nombre, municipio: fila.municipio, departamento: fila.departamento },
      combustible: { codigo: fila.codigo_combustible, nombre: fila.nombre_combustible },
      precios: fila.precios,
    }));
  }

  async function guardar(usuario, datos) {
    const propietario = idUsuario(usuario);
    const gasolinera = codigo(datos?.codigoGasolinera, 100);
    const combustible = codigo(datos?.codigoCombustible, 50);
    // Una sola sentencia valida la oferta e inserta; la restricción única cubre concurrencia.
    const { rows: [fila] } = await db.query(`
      WITH seleccion AS (
        SELECT DISTINCT g.id AS id_gasolinera, tc.id AS id_tipo_combustible
        FROM gasolineras g
        JOIN marcas m ON m.id=g.id_marca AND m.activo=TRUE
        JOIN combustibles_gasolinera cg ON cg.id_gasolinera=g.id AND cg.activo=TRUE
        JOIN tipos_combustible tc ON tc.id=cg.id_tipo_combustible AND tc.activo=TRUE
        WHERE g.codigo=$2 AND tc.codigo=$3 AND g.activo=TRUE AND g.visible_publico=TRUE
      ), insertado AS (
        INSERT INTO favoritos (id_usuario, id_gasolinera, id_tipo_combustible)
        SELECT $1, id_gasolinera, id_tipo_combustible FROM seleccion
        ON CONFLICT ON CONSTRAINT uq_favoritos_usuario_gasolinera_combustible DO NOTHING
        RETURNING id
      )
      SELECT (SELECT id FROM insertado) AS id, EXISTS(SELECT 1 FROM seleccion) AS disponible
    `, [propietario, gasolinera, combustible]);
    if (!fila.disponible) throw errorHttp(404, "La gasolinera o el combustible ya no están disponibles.");
    if (!fila.id) throw errorHttp(409, "Esta gasolinera y combustible ya están en tus favoritos.");
    return { id: String(fila.id), codigoGasolinera: gasolinera, codigoCombustible: combustible };
  }

  async function eliminar(usuario, id) {
    const propietario = idUsuario(usuario);
    if (typeof id !== "string" || !/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n) {
      throw errorHttp(400, "El favorito indicado no es válido.");
    }
    const { rowCount } = await db.query("DELETE FROM favoritos WHERE id=$1 AND id_usuario=$2", [id, propietario]);
    if (!rowCount) throw errorHttp(404, "El favorito no existe en tu cuenta.");
  }

  return { catalogo, listar, guardar, eliminar };
}
