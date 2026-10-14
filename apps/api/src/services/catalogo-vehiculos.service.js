const errorHttp = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const idValido = (id) => typeof id === "string" && /^[1-9]\d{0,8}$/.test(id);
const numero = (valor) => Number.isFinite(Number(valor)) && Number(valor) > 0 ? Number(valor) : null;
const texto = (valor) => typeof valor === "string" && valor.trim() ? valor.trim() : null;

export function normalizarFicha(datos) {
  if (!idValido(String(datos?.id ?? "")) || !texto(datos.make) || !texto(datos.model) || !numero(datos.year)) {
    throw errorHttp(502, "El catálogo devolvió una ficha incompleta. Prueba otra versión.");
  }
  // EPA devuelve millas por galón estadounidense; MPGe de eléctricos no es gasolina consumida.
  const usaCombustible = /gasoline|diesel|e85/i.test(datos.fuelType1 ?? "");
  const consumo = (valor) => usaCombustible && numero(valor) ? Number((235.214583 / numero(valor)).toFixed(2)) : null;
  return {
    proveedor: "fueleconomy", idExterno: String(datos.id),
    anio: Number(datos.year), marca: datos.make, modelo: datos.model,
    motorLitros: numero(datos.displ), cilindros: numero(datos.cylinders),
    transmision: texto(datos.trany), traccion: texto(datos.drive),
    combustible: texto(datos.fuelType1), combustibleAlternativo: texto(datos.fuelType2),
    categoria: texto(datos.VClass), tecnologia: texto(datos.atvType),
    consumo: { ciudad: consumo(datos.city08), carretera: consumo(datos.highway08), combinado: consumo(datos.comb08), unidad: "L/100 km" },
    urlFuente: `https://www.fueleconomy.gov/feg/Find.do?action=sbs&id=${datos.id}`,
  };
}

export function crearCatalogoVehiculos({ solicitar = fetch, ahora = Date.now } = {}) {
  const cache = new Map();
  const pendientes = new Map();
  async function consultar(ruta, parametros = {}) {
    const url = new URL(`https://www.fueleconomy.gov/ws/rest/vehicle/${ruta}`);
    url.search = new URLSearchParams(parametros).toString();
    const clave = url.href;
    const guardado = cache.get(clave);
    if (guardado && guardado.hasta > ahora()) return guardado.datos;
    if (pendientes.has(clave)) return pendientes.get(clave);
    if (pendientes.size >= 8) throw errorHttp(503, "El catálogo está ocupado. Intenta nuevamente en unos segundos.");
    const consulta = (async () => {
      try {
        const respuesta = await solicitar(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
        if (respuesta.status === 404) throw errorHttp(404, "No encontramos ese vehículo en el catálogo.");
        if (!respuesta.ok) throw new Error("Respuesta del proveedor no disponible");
        const datos = await respuesta.json();
        if (cache.size >= 128) cache.delete(cache.keys().next().value);
        cache.set(clave, { datos, hasta: ahora() + 24 * 60 * 60 * 1000 });
        return datos;
      } catch (error) {
        if (error.statusCode) throw error;
        throw errorHttp(503, "No pudimos consultar el catálogo de vehículos. Vuelve a intentar; tus vehículos guardados siguen disponibles.");
      }
    })();
    pendientes.set(clave, consulta);
    try { return await consulta; } finally { pendientes.delete(clave); }
  }

  async function menu(nivel, datos = {}) {
    if (!["year", "make", "model", "options"].includes(nivel)) throw errorHttp(400, "Selección de catálogo inválida.");
    const parametros = {};
    if (nivel !== "year") {
      if (!/^\d{4}$/.test(String(datos.anio ?? "")) || Number(datos.anio) < 1984 || Number(datos.anio) > new Date(ahora()).getUTCFullYear() + 2) {
        throw errorHttp(400, "Selecciona un año válido.");
      }
      parametros.year = String(datos.anio);
    }
    for (const [campo, externo] of [["marca", "make"], ["modelo", "model"]]) {
      if ((campo === "marca" && ["model", "options"].includes(nivel)) || (campo === "modelo" && nivel === "options")) {
        if (typeof datos[campo] !== "string" || !datos[campo].trim() || datos[campo].length > 100) throw errorHttp(400, "Selecciona la marca y el modelo.");
        parametros[externo] = datos[campo].trim();
      }
    }
    const resultado = await consultar(`menu/${nivel}`, parametros);
    const opciones = resultado.menuItem == null ? [] : Array.isArray(resultado.menuItem) ? resultado.menuItem : [resultado.menuItem];
    return opciones.filter((o) => typeof o.text === "string" && o.value != null)
      .map((o) => ({ nombre: o.text, valor: String(o.value) }));
  }

  async function ficha(id) {
    if (!idValido(id)) throw errorHttp(400, "Selecciona un vehículo válido.");
    const datos = await consultar(id);
    if (String(datos?.id) !== id) throw errorHttp(502, "La ficha no corresponde al vehículo seleccionado.");
    return normalizarFicha(datos);
  }
  return { menu, ficha };
}
