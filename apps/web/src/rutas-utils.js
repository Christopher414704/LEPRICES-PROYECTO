export const LITROS_GALON = 3.785411784;
export const CIUDADES_RUTA = [
  ['Ciudad de Guatemala', 14.6349, -90.5069], ['Jalapa', 14.6345, -89.9889],
  ['Antigua Guatemala', 14.5586, -90.7295], ['Chimaltenango', 14.6611, -90.8194],
  ['Escuintla', 14.305, -90.785], ['Santa Rosa · Cuilapa', 14.2764, -90.2989],
  ['Jutiapa', 14.2917, -89.8958], ['Chiquimula', 14.7992, -89.5458],
  ['Zacapa', 14.9722, -89.5306], ['El Progreso · Guastatoya', 14.8542, -90.0694],
  ['Izabal · Puerto Barrios', 15.7278, -88.5944], ['Alta Verapaz · Cobán', 15.47, -90.3711],
  ['Baja Verapaz · Salamá', 15.1028, -90.3181], ['Quiché · Santa Cruz', 15.0306, -91.1486],
  ['Huehuetenango', 15.3192, -91.4725], ['Quetzaltenango', 14.8347, -91.5181],
  ['San Marcos', 14.9639, -91.7944], ['Totonicapán', 14.9117, -91.3611],
  ['Sololá', 14.7739, -91.1875], ['Suchitepéquez · Mazatenango', 14.5344, -91.5033],
  ['Retalhuleu', 14.5361, -91.6778], ['Petén · Flores', 16.9336, -89.8911],
];
export function nombreConsumo(fuente) {
  return { bitacora: 'Consumo medido en tu bitácora', catalogo: 'Consumo combinado de referencia del catálogo',
    referencia_general: 'Estimación con consumo general publicado',
    modelo_teorico: 'Consumo estimado del recorrido',
    manual: 'Consumo ingresado por ti', sin_datos: 'Consumo todavía no disponible' }[fuente] ?? 'Consumo';
}
export function enlaceNavegacion(origen, destino) {
  if (![origen?.latitud, origen?.longitud, destino?.latitud, destino?.longitud].every(n => typeof n === 'number' && Number.isFinite(n)) ||
      [origen, destino].some(p => Math.abs(p.latitud) > 90 || Math.abs(p.longitud) > 180)) return null;
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1'); url.searchParams.set('origin', `${origen.latitud},${origen.longitud}`);
  url.searchParams.set('destination', `${destino.latitud},${destino.longitud}`);
  url.searchParams.set('travelmode', 'driving'); url.searchParams.set('dir_action', 'navigate');
  return url.toString();
}
