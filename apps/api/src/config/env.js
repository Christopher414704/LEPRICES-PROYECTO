import "dotenv/config";

function getRequiredEnvironmentVariable(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}.`);
  }

  return value;
}

function getValidPort(value, variableName) {
  const port = Number(value);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`${variableName} debe contener un puerto válido.`);
  }

  return port;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",

  port: getValidPort(
    process.env.PORT ?? 3000,
    "PORT",
  ),

  frontendUrl:
    process.env.FRONTEND_URL ?? "http://localhost:5173",

  database: {
    host: process.env.DB_HOST ?? "127.0.0.1",

    port: getValidPort(
      process.env.DB_PORT ?? 5433,
      "DB_PORT",
    ),

    name: process.env.DB_NAME ?? "mapa_gasolineras_jalapa",
    user: process.env.DB_USER ?? "jalapa_admin",
    password: process.env.DB_PASSWORD ?? "",
    ssl: process.env.DB_SSL === "true",
  },
};
