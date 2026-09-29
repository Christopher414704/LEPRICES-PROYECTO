import { app } from "./app.js";
import { env } from "./config/env.js";

const server = app.listen(env.port, () => {
  console.log(`API ejecutándose en http://localhost:${env.port}`);
  console.log(`Entorno: ${env.nodeEnv}`);
});

function closeServer(signal) {
  console.log(`\nSe recibió ${signal}. Cerrando servidor...`);

  server.close(() => {
    console.log("Servidor cerrado correctamente.");
    process.exit(0);
  });
}

process.on("SIGINT", () => closeServer("SIGINT"));
process.on("SIGTERM", () => closeServer("SIGTERM"));
