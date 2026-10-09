export async function consultarCatalogoGasolineras({
  publico,
  parametros = new URLSearchParams(),
  forzar = false,
  signal,
  api,
  fetcher = globalThis.fetch,
  urlApi = "/api",
}) {
  const respuesta = publico
    ? await fetcher(`${urlApi}/publico/gasolineras?${parametros}`, {
      credentials: "omit",
      cache: forzar ? "no-cache" : "default",
      signal,
    })
    : await api("/gasolineras", { signal });

  if (!respuesta.ok) {
    throw new Error(`La API respondió con estado ${respuesta.status}.`);
  }

  const resultado = await respuesta.json();
  if (!Array.isArray(resultado.data)) {
    throw new Error("La API no devolvió una lista de gasolineras.");
  }

  return resultado;
}
