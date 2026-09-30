import { Router } from "express";

import { database } from "../config/database.js";
import { env } from "../config/env.js";
import { getHealth } from "../controllers/health.controller.js";
import { crearServicioAuth } from "../services/auth.service.js";
import { crearAuth } from "./auth.routes.js";
import { crearPublicoRouter } from "./publico.routes.js";
import { gasolinerasRouter } from "./gasolineras.routes.js";

export function crearApiRouter(auth = crearServicioAuth(database)) {
  const router = Router();
  const seguridad = crearAuth(auth, env);

  router.get("/health", getHealth);
  router.use("/auth", seguridad.router);
  router.use("/publico", crearPublicoRouter());
  router.use(seguridad.exigirSesion);
  router.use("/gasolineras", gasolinerasRouter);

  return router;
}

export const apiRouter = crearApiRouter();
