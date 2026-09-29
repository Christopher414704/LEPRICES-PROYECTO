import { env } from "../config/env.js";

export function errorHandler(error, req, res, next) {
  console.error(error);

  const statusCode = error.statusCode ?? 500;

  res.status(statusCode).json({
    status: "error",
    message:
      statusCode === 500
        ? "Ocurrió un error interno en el servidor."
        : error.message,
    ...(env.nodeEnv === "development" && {
      details: error.message,
    }),
  });
}