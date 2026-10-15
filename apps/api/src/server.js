import { database } from "./config/database.js";
import { iniciarTrabajadorAlertas } from "./services/alertas.service.js";
import { app } from "./app.js";
import { env } from "./config/env.js";

const server = app.listen(env.port, () => {
  console.log(`API ejecutándose en http://localhost:${env.port}`);
  console.log(`Entorno: ${env.nodeEnv}`);
});

const detenerAlertas = iniciarTrabajadorAlertas(database);
function closeServer(signal) {
  detenerAlertas();
  console.log(`\nSe recibió ${signal}. Cerrando servidor...`);

  server.close(() => {
    console.log("Servidor cerrado correctamente.");
    process.exit(0);
  });
}

process.on("SIGINT", () => closeServer("SIGINT"));
process.on("SIGTERM", () => closeServer("SIGTERM"));
