import { database } from "../config/database.js";

export async function obtenerGasolinerasConPrecios({ soloVisibles = false, bbox = null, departamento = null, municipio = null, codigo = null, buscar = null, limite = null } = {}) {
  const consulta = `
    SELECT
      g.id AS id_gasolinera,
      g.nombre AS nombre_gasolinera,
      g.codigo AS codigo_gasolinera,
      g.direccion,
      g.municipio,
      g.departamento,
      g.pais,
      g.latitud,
      g.longitud,

      m.id AS id_marca,
      m.nombre AS nombre_marca,
      m.codigo AS codigo_marca,
      m.url_logo,
      m.color_principal,

      cg.id AS id_combustible,
      cg.nombre_comercial,
      cg.codigo AS codigo_combustible,
      cg.orden_visual AS orden_combustible,

      tc.id AS id_tipo_combustible,
      tc.nombre AS nombre_tipo_combustible,
      tc.codigo AS codigo_tipo_combustible,

      ms.id AS id_modalidad,
      ms.nombre AS nombre_modalidad,
      ms.codigo AS codigo_modalidad,
      ms.orden_visual AS orden_modalidad,

      pc.precio,
      TRIM(pc.codigo_moneda) AS codigo_moneda,
      pc.unidad_medida,
      pc.fecha_vigencia_inicio

    FROM (SELECT * FROM gasolineras g
      WHERE g.activo = TRUE
        AND ($1::BOOLEAN = FALSE OR g.visible_publico = TRUE)
        AND ($2::DOUBLE PRECISION IS NULL OR ST_Intersects(g.ubicacion,
          ST_MakeEnvelope($2, $3, $4, $5, 4326)::geography))
        AND ($6::TEXT IS NULL OR g.departamento = $6)
        AND ($7::TEXT IS NULL OR g.municipio = $7)
        AND ($9::TEXT IS NULL OR g.codigo = $9)
        AND ($10::TEXT IS NULL OR translate(lower(g.nombre), 'áéíóúüñ', 'aeiouun') LIKE '%' || $10 || '%')
      ORDER BY g.nombre, g.id
      LIMIT $8::INTEGER
    ) g

    INNER JOIN marcas m
      ON m.id = g.id_marca
      AND m.activo = TRUE

    LEFT JOIN combustibles_gasolinera cg
      ON cg.id_gasolinera = g.id
      AND cg.activo = TRUE

    LEFT JOIN tipos_combustible tc
      ON tc.id = cg.id_tipo_combustible
      AND tc.activo = TRUE

    LEFT JOIN precios_combustible pc
      ON pc.id_combustible_gasolinera = cg.id
      AND pc.fecha_vigencia_fin IS NULL

    LEFT JOIN modalidades_servicio ms
      ON ms.id = pc.id_modalidad_servicio
      AND ms.activo = TRUE

    ORDER BY
      g.nombre,
      cg.orden_visual,
      ms.orden_visual;
  `;

  const resultado = await database.query(consulta, [soloVisibles, ...(bbox ?? [null, null, null, null]), departamento, municipio, limite, codigo, buscar]);

  return resultado.rows;
}
