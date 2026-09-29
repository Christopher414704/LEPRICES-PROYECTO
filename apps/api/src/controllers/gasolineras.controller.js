import {
  listarGasolinerasConPrecios,
} from "../services/gasolineras.service.js";

export async function listarGasolineras(
  req,
  res,
  next,
) {
  try {
    const gasolineras =
      await listarGasolinerasConPrecios();

    res.status(200).json({
      status: "ok",
      total: gasolineras.length,
      data: gasolineras,
    });
  } catch (error) {
    next(error);
  }
}
