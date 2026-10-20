import { Router } from "express";
import { database } from "../config/database.js";
import { crearServicioPrecios } from "../services/precios.service.js";

import { crearReportePrecios } from '../services/reporte-precios.service.js';

export function crearPreciosRouter(servicio = crearServicioPrecios(database), reporte = crearReportePrecios(database)) {
  const router = Router();
  router.get('/reporte/:id', async (req,res) => { res.set('Cache-Control','no-store'); res.json({data:await reporte(req.usuario,req.params.id)}); });
  router.get("/estado", async (req, res) => res.json(await servicio.estado(req.usuario)));
  router.get("/historial", async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await servicio.historial(req.usuario, req.query));
  });
  router.put("/gestores/:id", async (req, res) =>
    res.json(await servicio.asignar(req.usuario, req.params.id, req.body)));
  router.delete("/gestores/:id/horario", async (req, res) =>
    res.json(await servicio.revocar(req.usuario, req.params.id)));
  router.post("/combustibles", async (req, res) =>
    res.status(201).json(await servicio.agregarCombustible(req.usuario, req.body)));
  router.post("/registrar", async (req, res) =>
    res.status(201).json(await servicio.registrar(req.usuario, req.body)));
  return router;
}
