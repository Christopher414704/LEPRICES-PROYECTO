export function leerCoordenadas(query) {
  const numero = (v) => typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  const latitud = numero(query.latitud), longitud = numero(query.longitud);
  if (!Number.isFinite(latitud) || !Number.isFinite(longitud) || Math.abs(latitud) > 90 || Math.abs(longitud) > 180) {
    throw Object.assign(new Error("Las coordenadas no son válidas."), { statusCode: 400 });
  }
  return { latitud, longitud };
}

export async function encontrarGasolineraCercana(ubicacion, db) {
  const { rows } = await db.query(`
    SELECT g.codigo, ST_DistanceSphere(
      ST_MakePoint(g.longitud, g.latitud), ST_MakePoint($2, $1)
    ) / 1000 AS distancia_km
    FROM gasolineras g
    INNER JOIN marcas m ON m.id = g.id_marca AND m.activo = TRUE
    WHERE g.activo = TRUE AND g.visible_publico = TRUE
      AND g.latitud BETWEEN -90 AND 90 AND g.longitud BETWEEN -180 AND 180
    ORDER BY distancia_km, g.codigo
    LIMIT 1
  `, [ubicacion.latitud, ubicacion.longitud]);
  return rows[0] ?? null;
}
