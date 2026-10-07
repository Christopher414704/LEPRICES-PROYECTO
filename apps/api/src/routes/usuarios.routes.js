import { Router } from "express";
import { database } from "../config/database.js";
import { crearServicioUsuarios } from "../services/usuarios.service.js";

export function crearUsuariosRouter(servicio = crearServicioUsuarios(database)) {
  const router = Router();
  router.use((req, res, next) => {
    if (req.usuario?.rol !== "administrador") {
      return res.status(403).json({ message: "Solo un administrador puede gestionar usuarios." });
    }
    next();
  });
  router.get("/", async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await servicio.listar(req.usuario));
  });
  router.post("/", async (req, res) => {
    const usuario = await servicio.registrar(req.usuario, req.body);
    res.status(201).json({ message: "Usuario creado correctamente.", data: usuario });
  });
  router.patch("/:id/estado", async (req, res) => {
    const resultado = await servicio.cambiarEstado(req.usuario, req.params.id, req.body);
    const message = resultado.cambiado
      ? (resultado.usuario.activo ? "Usuario activado correctamente." : "Usuario desactivado correctamente.")
      : (resultado.usuario.activo ? "El usuario ya está activo." : "El usuario ya está inactivo.");
    res.json({ message, data: resultado.usuario, cambiado: resultado.cambiado });
  });
  return router;
}
