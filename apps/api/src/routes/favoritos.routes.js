import { Router } from "express";
import { database } from "../config/database.js";
import { crearServicioFavoritos } from "../services/favoritos.service.js";

export function crearFavoritosRouter(servicio = crearServicioFavoritos(database)) {
  const router = Router();
  router.get("/catalogo", async (req, res) => res.json({ data: await servicio.catalogo(req.usuario) }));
  router.get("/", async (req, res) => res.json({ data: await servicio.listar(req.usuario) }));
  router.post("/", async (req, res) => {
    const data = await servicio.guardar(req.usuario, req.body);
    res.status(201).json({ message: "Favorito guardado correctamente.", data });
  });
  router.delete("/:id", async (req, res) => {
    await servicio.eliminar(req.usuario, req.params.id);
    res.status(204).end();
  });
  return router;
}
