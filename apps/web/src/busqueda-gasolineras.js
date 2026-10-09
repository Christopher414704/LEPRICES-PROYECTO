export function normalizarNombreGasolinera(texto = "") {
  return String(texto)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .trim();
}

export function coincideNombreGasolinera(nombre, busqueda) {
  const nombreNormalizado = normalizarNombreGasolinera(nombre);
  const palabras = normalizarNombreGasolinera(busqueda).split(/\s+/).filter(Boolean);
  return palabras.every((palabra) => nombreNormalizado.includes(palabra));
}

export function coincideFiltrosGasolinera(gasolinera, { busqueda = "", departamento = "", municipio = "" } = {}) {
  return (!departamento || gasolinera.departamento === departamento)
    && (!municipio || gasolinera.municipio === municipio)
    && coincideNombreGasolinera(gasolinera.nombre, busqueda);
}
