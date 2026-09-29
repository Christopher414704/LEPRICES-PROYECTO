import pg from "pg";

import { env } from "./env.js";

const { Pool } = pg;

export const database = new Pool({
  host: env.database.host,
  port: env.database.port,
  database: env.database.name,
  user: env.database.user,
  password: env.database.password,
  ssl: env.database.ssl,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

database.on("error", (error) => {
  console.error("Error inesperado en PostgreSQL:", error);
});

export async function verifyDatabaseConnection() {
  const query = `
    SELECT
      current_database() AS database_name,
      current_user AS database_user,
      version() AS postgresql_version,
      PostGIS_Version() AS postgis_version;
  `;

  const result = await database.query(query);

  return result.rows[0];
}