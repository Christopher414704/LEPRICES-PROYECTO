import { formatearPrecio } from "./precios.js";

export function opcionesCombustible(estacion, favoritos) {
  return (estacion?.combustibles ?? []).map((combustible) => ({
    ...combustible,
    guardado: favoritos.some((f) => f.gasolinera.codigo === estacion.codigo && f.combustible.codigo === combustible.codigo),
  }));
}

export function describirPrecio(precio) {
  const valor = formatearPrecio(precio.precio);
  if (valor === "--.--") return "Precio no registrado";
  return `${precio.moneda === "GTQ" ? "Q" : precio.moneda + " "}${valor} por ${precio.unidadMedida === "galon" ? "galón" : precio.unidadMedida}`;
}
