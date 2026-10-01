import { Router } from "express";

import { database } from "../config/database.js";
import { env } from "../config/env.js";
import { getHealth } from "../controllers/health.controller.js";
import { crearServicioAuth } from "../services/auth.service.js";
import { crearAuth } from "./auth.routes.js";
import { crearPublicoRouter } from "./publico.routes.js";
import { gasolinerasRouter } from "./gasolineras.routes.js";
import { crearPreciosRouter } from "./precios.routes.js";

export function crearApiRouter(auth = crearServicioAuth(database)) {
  const router = Router();
  const seguridad = crearAuth(auth, env);

  router.get("/health", getHealth);
  router.use("/auth", seguridad.router);
  router.use("/publico", crearPublicoRouter());
  router.use(seguridad.exigirSesion);
  router.use((req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    return seguridad.validarOrigen(req, res, next);
  });
  router.use("/gasolineras", gasolinerasRouter);
  router.use("/precios", crearPreciosRouter());

  return router;
}

export const apiRouter = crearApiRouter();
