import {
  listarGasolinerasConPrecios,
} from "../services/gasolineras.service.js";

export function crearListarGasolineras(listar = listarGasolinerasConPrecios) {
  return async function listarGasolineras(_req, res, next) {
    try {
      const gasolineras = await listar();
      res.set("Cache-Control", "no-cache");
      res.status(200).json({
        status: "ok",
        total: gasolineras.length,
        data: gasolineras,
      });
    } catch (error) {
      next(error);
    }
  };
}

export const listarGasolineras = crearListarGasolineras();
