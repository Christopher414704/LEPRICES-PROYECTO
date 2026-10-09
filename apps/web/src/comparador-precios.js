function textoNormalizado(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("es");
}

function compararTexto(a, b) {
  return String(a).localeCompare(String(b), "es", { sensitivity: "base" });
}

function nombreDesdeCodigo(codigo) {
  const texto = String(codigo).replaceAll("_", " ");
  return texto.charAt(0).toLocaleUpperCase("es") + texto.slice(1);
}

export function opcionesComparacion(gasolineras = []) {
  const combustibles = new Map();
  const modalidades = new Map();

  for (const gasolinera of gasolineras) {
    for (const combustible of gasolinera.combustibles ?? []) {
      if (combustible.codigo && !combustibles.has(combustible.codigo)) {
        combustibles.set(combustible.codigo, combustible.nombre || combustible.codigo);
      }
      for (const [codigo, precio] of Object.entries(combustible.precios ?? {})) {
        if (!modalidades.has(codigo)) modalidades.set(codigo, precio.modalidad || nombreDesdeCodigo(codigo));
      }
    }
  }

  const ordenar = ([codigoA, nombreA], [codigoB, nombreB]) =>
    compararTexto(nombreA, nombreB) || compararTexto(codigoA, codigoB);
  return {
    combustibles: [...combustibles].sort(ordenar).map(([codigo, nombre]) => ({ codigo, nombre })),
    modalidades: [...modalidades].sort(ordenar).map(([codigo, nombre]) => ({ codigo, nombre })),
  };
}

export function precioVigente(gasolinera, codigoCombustible, codigoModalidad) {
  const combustible = (gasolinera.combustibles ?? [])
    .find((item) => item.codigo === codigoCombustible);
  const precio = combustible?.precios?.[codigoModalidad];
  const valor = Number(precio?.precio);
  if (!precio || !Number.isFinite(valor) || valor <= 0) return null;
  return { ...precio, precio: valor, combustible: combustible.nombre || codigoCombustible };
}

export function compararPrecios(gasolineras = [], filtros = {}) {
  const buscar = textoNormalizado(filtros.buscar);
  const departamento = String(filtros.departamento ?? "");
  const municipio = String(filtros.municipio ?? "");

  const resultados = gasolineras.flatMap((gasolinera) => {
    if (departamento && gasolinera.departamento !== departamento) return [];
    if (municipio && gasolinera.municipio !== municipio) return [];
    if (buscar && !textoNormalizado(gasolinera.nombre).includes(buscar)) return [];
    const precio = precioVigente(gasolinera, filtros.combustible, filtros.modalidad);
    return precio ? [{ gasolinera, precio }] : [];
  }).sort((a, b) => a.precio.precio - b.precio.precio
    || compararTexto(a.gasolinera.nombre, b.gasolinera.nombre));

  const menor = resultados[0]?.precio.precio ?? null;
  return resultados.map((resultado) => ({
    ...resultado,
    esMasBarata: resultado.precio.precio === menor,
  }));
}

export function municipiosDisponibles(gasolineras = [], departamento = "") {
  return [...new Set(gasolineras
    .filter((gasolinera) => !departamento || gasolinera.departamento === departamento)
    .map((gasolinera) => gasolinera.municipio)
    .filter(Boolean))].sort(compararTexto);
}
