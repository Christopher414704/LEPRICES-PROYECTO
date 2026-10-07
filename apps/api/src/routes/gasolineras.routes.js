import { Router } from "express";
import { database } from "../config/database.js";
import { crearServicioRegistroGasolineras } from "../services/registro-gasolineras.service.js";

import {
  listarGasolineras,
} from "../controllers/gasolineras.controller.js";

export function crearGasolinerasRouter(servicio = crearServicioRegistroGasolineras(database)) {
  const router = Router();
  router.get("/", listarGasolineras);
  router.use((req, res, next) => {
    if (req.usuario?.rol !== "administrador") {
      return res.status(403).json({ message: "Solo un administrador puede administrar gasolineras." });
    }
    next();
  });
  router.get("/marcas", async (req, res) => res.json({ data: await servicio.marcas(req.usuario) }));
  router.post("/", async (req, res) => {
    const gasolinera = await servicio.registrar(req.usuario, req.body);
    res.status(201).json({ status: "ok", message: "Gasolinera registrada correctamente.", data: gasolinera });
  });
  router.put("/:id", async (req, res) => {
    const gasolinera = await servicio.editar(req.usuario, req.params.id, req.body);
    res.json({ status: "ok", message: "Gasolinera modificada correctamente.", data: gasolinera });
  });
  return router;
}

export const gasolinerasRouter = crearGasolinerasRouter();
