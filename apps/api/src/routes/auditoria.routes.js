import { Router } from "express";
import { database } from "../config/database.js";
import { crearServicioAuditoria } from "../services/auditoria.service.js";

export function crearAuditoriaRouter(servicio = crearServicioAuditoria(database)) {
  const router = Router();
  router.use((req, res, next) => {
    if (req.usuario?.rol !== "administrador") {
      return res.status(403).json({ message: "Solo un administrador puede consultar la auditoría." });
    }
    next();
  });
  router.get("/", async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await servicio.listar(req.usuario, req.query));
  });
  return router;
}
