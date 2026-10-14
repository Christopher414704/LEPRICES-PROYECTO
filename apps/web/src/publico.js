export function distanciaKm(origen, destino) {
  const radianes = (grados) => grados * Math.PI / 180;
  const lat1 = radianes(origen.latitud);
  const lat2 = radianes(destino.latitud);
  const dLat = lat2 - lat1;
  const dLon = radianes(destino.longitud - origen.longitud);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function urlGoogleMaps(ubicacion) {
  const latitud = Number(ubicacion?.latitud);
  const longitud = Number(ubicacion?.longitud);
  if (!Number.isFinite(latitud) || !Number.isFinite(longitud) ||
      latitud < -90 || latitud > 90 || longitud < -180 || longitud > 180) return null;
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("destination", `${latitud},${longitud}`);
  url.searchParams.set("travelmode", "driving");
  url.searchParams.set("dir_action", "navigate");
  return url.toString();
}
