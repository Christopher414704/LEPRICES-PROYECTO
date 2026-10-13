function coordenadasValidas(ubicacion) {
  if (ubicacion?.latitud == null || ubicacion?.longitud == null
      || ubicacion.latitud === "" || ubicacion.longitud === "") return false;
  const latitud = Number(ubicacion.latitud);
  const longitud = Number(ubicacion.longitud);
  return Number.isFinite(latitud) && Number.isFinite(longitud)
    && latitud >= -90 && latitud <= 90 && longitud >= -180 && longitud <= 180;
}

export function enlaceNavegacion(ubicacion) {
  if (!coordenadasValidas(ubicacion)) return null;
  const parametros = new URLSearchParams({
    api: "1",
    destination: `${Number(ubicacion.latitud)},${Number(ubicacion.longitud)}`,
    travelmode: "driving",
  });
  return `https://www.google.com/maps/dir/?${parametros}`;
}

export function distanciaEnLineaRecta(origen, destino) {
  if (!coordenadasValidas(origen) || !coordenadasValidas(destino)) return null;
  const radianes = (grados) => grados * Math.PI / 180;
  const latitudOrigen = radianes(Number(origen.latitud));
  const latitudDestino = radianes(Number(destino.latitud));
  const diferenciaLatitud = latitudDestino - latitudOrigen;
  const diferenciaLongitud = radianes(Number(destino.longitud) - Number(origen.longitud));
  const seno = Math.sin(diferenciaLatitud / 2) ** 2
    + Math.cos(latitudOrigen) * Math.cos(latitudDestino) * Math.sin(diferenciaLongitud / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.min(1, Math.sqrt(seno)));
}

export function formatearDistancia(kilometros) {
  return kilometros < 1
    ? `${Math.round(kilometros * 1000)} m`
    : `${kilometros.toLocaleString("es-GT", { maximumFractionDigits: 1 })} km`;
}
