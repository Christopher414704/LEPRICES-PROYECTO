import { database } from "../config/database.js";

export async function getHealth(req, res, next) {
  try {
    const query = `
      SELECT
        current_database() AS database_name,
        PostGIS_Version() AS postgis_version;
    `;

    const result = await database.query(query);
    const databaseInfo = result.rows[0];

    res.status(200).json({
      status: "ok",
      message: "API del mapa de gasolineras funcionando correctamente.",
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      database: {
        status: "connected",
        name: databaseInfo.database_name,
        postgis: databaseInfo.postgis_version,
      },
    });
  } catch (error) {
    next(error);
  }
}