import { Router } from "express";
import { listarGasolinerasConPrecios } from "../services/gasolineras.service.js";
import { database } from "../config/database.js";

const errorHttp = (statusCode, message) => Object.assign(new Error(message), { statusCode });

export function leerFiltrosPublicos(query) {
  const texto = (valor) => typeof valor === "string" && valor.length <= 100 && !/[<>]/.test(valor) ? valor.trim() || null : null;
  const departamento = texto(query.departamento);
  const municipio = texto(query.municipio);
  const codigo = texto(query.codigo);
  const buscar = typeof query.buscar === "string" && /^[\p{L}\p{N}\s-]{1,100}$/u.test(query.buscar.trim())
    ? query.buscar.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es") : null;
  if ((query.departamento != null && !departamento) || (query.municipio != null && !municipio) ||
      (query.codigo != null && (!codigo || !/^[\w-]{1,100}$/.test(codigo))) ||
      (query.buscar != null && !buscar)) {
    throw errorHttp(400, "La región indicada no es válida.");
  }
  let bbox = null;
  if (query.bbox != null) {
    const partes = typeof query.bbox === "string" ? query.bbox.split(",").map(Number) : [];
    if (partes.length !== 4 || partes.some((n) => !Number.isFinite(n)) ||
        partes[0] < -180 || partes[2] > 180 || partes[1] < -90 || partes[3] > 90 ||
        partes[0] >= partes[2] || partes[1] >= partes[3]) {
      throw errorHttp(400, "El área del mapa no es válida.");
    }
    bbox = partes;
  }
  return { bbox, departamento, municipio, codigo, buscar };
}

export function prepararGasolineraPublica(gasolinera) {
  const combustibles = gasolinera.combustibles.map((combustible) => ({
    nombre: combustible.nombreComercial,
    codigo: combustible.tipo.codigo,
    precios: Object.fromEntries(Object.entries(combustible.precios).map(([modalidad, precio]) => [
      modalidad,
      { precio: precio.precio, moneda: precio.moneda,
        unidadMedida: precio.unidadMedida, vigenteDesde: precio.vigenteDesde },
    ])),
  }));
  const fechas = combustibles.flatMap((combustible) =>
    Object.values(combustible.precios).map((precio) => new Date(precio.vigenteDesde).getTime()))
    .filter(Number.isFinite);
  return {
    codigo: gasolinera.codigo,
    nombre: gasolinera.nombre,
    direccion: gasolinera.direccion,
    municipio: gasolinera.municipio,
    departamento: gasolinera.departamento,
    ubicacion: gasolinera.ubicacion,
    marca: { nombre: gasolinera.marca.nombre, colorPrincipal: gasolinera.marca.colorPrincipal },
    combustibles,
    ultimaActualizacion: fechas.length ? new Date(Math.max(...fechas)).toISOString() : null,
  };
}

export function crearPublicoRouter(listar = listarGasolinerasConPrecios, db = database) {
  const router = Router();
  router.get("/gasolineras", async (req, res) => {
    const filtros = leerFiltrosPublicos(req.query);
    const limite = 301;
    const gasolineras = await listar({ soloVisibles: true, ...filtros, limite });
    res.set("Cache-Control", "public, max-age=30");
    res.json({ data: gasolineras.slice(0, 300).map(prepararGasolineraPublica),
      total: Math.min(gasolineras.length, 300), hayMas: gasolineras.length > 300 });
  });
  router.get("/gasolineras/:codigo/precios", async (req, res) => {
    const { codigo } = leerFiltrosPublicos({ codigo: req.params.codigo });
    const [gasolinera] = await listar({ soloVisibles: true, codigo, limite: 1 });

    if (!gasolinera) {
      throw errorHttp(404, "La gasolinera no existe o no está disponible.");
    }

    res.set("Cache-Control", "public, max-age=30");
    res.json({ data: prepararGasolineraPublica(gasolinera) });
  });
  router.get("/regiones", async (_req, res) => {
    const { rows } = await db.query(`
      SELECT departamento, municipio, COUNT(*)::INTEGER AS cantidad,
        MIN(latitud) AS sur, MAX(latitud) AS norte,
        MIN(longitud) AS oeste, MAX(longitud) AS este
      FROM gasolineras WHERE activo = TRUE AND visible_publico = TRUE
      GROUP BY departamento, municipio ORDER BY departamento, municipio
    `);
    res.set("Cache-Control", "public, max-age=300");
    res.json({ data: rows.map((r) => ({ departamento: r.departamento, municipio: r.municipio,
      cantidad: Number(r.cantidad), limites: [Number(r.oeste), Number(r.sur), Number(r.este), Number(r.norte)] })) });
  });
  return router;
}
