const fallo = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const indisponible = () => fallo(503, 'No pudimos obtener una carretera del proveedor. Reintenta o elige «Kilómetros manuales»; no sustituiremos la ruta por una línea recta.');
const finito = n => typeof n === 'number' && Number.isFinite(n);

// Valhalla codifica latitud/longitud con seis decimales, no cinco.
export function decodificarPolyline6(texto) {
  if (typeof texto !== 'string' || texto.length > 1_500_000) throw indisponible();
  let i = 0, lat = 0, lon = 0;
  const puntos = [];
  function leer() {
    let valor = 0, desplazamiento = 0, b;
    do {
      if (i >= texto.length || desplazamiento > 30) throw indisponible();
      b = texto.charCodeAt(i++) - 63;
      if (b < 0 || b > 63) throw indisponible();
      valor += (b & 31) * 2 ** desplazamiento; desplazamiento += 5;
    } while (b >= 32);
    return valor % 2 ? -(valor + 1) / 2 : valor / 2;
  }
  while (i < texto.length) {
    lat += leer(); lon += leer();
    const p = { latitud: lat / 1e6, longitud: lon / 1e6 };
    if (Math.abs(p.latitud) > 90 || Math.abs(p.longitud) > 180 || puntos.length >= 100_000) throw indisponible();
    puntos.push(p);
  }
  if (puntos.length < 2) throw indisponible();
  return puntos;
}
function distancia(a, b) {
  const rad = n => n * Math.PI / 180;
  const h = Math.sin(rad(b.latitud - a.latitud) / 2) ** 2 + Math.cos(rad(a.latitud)) * Math.cos(rad(b.latitud)) * Math.sin(rad(b.longitud - a.longitud) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function analizarElevacion(valores, intervalo, kilometros) {
  if (!Array.isArray(valores) || valores.length < 2 || valores.length > 200_001 || !finito(intervalo) || intervalo <= 0 ||
      Math.abs((valores.length - 1) * intervalo - kilometros * 1000) > intervalo * 2) return { disponible: false, cobertura: 0, ascensoM: null, descensoM: null, perfil: [] };
  const validos = valores.map(v => finito(v) && v >= -500 && v <= 6000 ? v : null);
  // Mediana de tres muestras contiguas y reversión de 3 m para reducir ruido del DEM.
  // Nunca se conectan muestras separadas por elevaciones ausentes.
  const suavizado = validos.map((v, i) => v == null || i === 0 || i === validos.length - 1 || validos[i - 1] == null || validos[i + 1] == null
    ? v : [validos[i - 1], v, validos[i + 1]].sort((a, b) => a - b)[1]);
  let ascensoM = 0, descensoM = 0, base = null, extremo = null, sentido = 0;
  function cerrar() {
    if (base != null) { const d = extremo - base; ascensoM += Math.max(0, d); descensoM += Math.max(0, -d); }
    base = extremo = null; sentido = 0;
  }
  for (const v of suavizado) {
    if (v == null) { cerrar(); continue; }
    if (base == null) { base = extremo = v; continue; }
    if (!sentido) { extremo = v; if (Math.abs(v - base) >= 3) sentido = Math.sign(v - base); continue; }
    if ((v - extremo) * sentido > 0) extremo = v;
    else if ((extremo - v) * sentido >= 3) {
      const d = extremo - base; ascensoM += Math.max(0, d); descensoM += Math.max(0, -d);
      base = extremo; extremo = v; sentido *= -1;
    }
  }
  cerrar();
  const paso = Math.max(1, Math.ceil(valores.length / 120));
  const indices = new Set([0, ...Array.from({ length: Math.ceil(valores.length / paso) }, (_, i) => i * paso), valores.length - 1]);
  const seleccion = [...indices].sort((a, b) => a - b);
  const perfil = seleccion.map((i, k) => ({ km: Math.min(kilometros, i * intervalo / 1000),
    alturaM: suavizado.slice(k ? seleccion[k - 1] + 1 : 0, i + 1).includes(null) ? null : suavizado[i] }));
  const cobertura = validos.filter(v => v != null).length / valores.length;
  // El motor recibe muestras propias (aprox. 120 m); no usa la gráfica reducida.
  const pasoMotor = Math.max(1, Math.ceil(120 / intervalo));
  const motorIndices = [...new Set([0, ...Array.from({ length: Math.ceil(valores.length / pasoMotor) }, (_, i) => i * pasoMotor), valores.length - 1])].sort((a, b) => a - b);
  const perfilMotor = motorIndices.map(i => ({ km: Math.min(kilometros, i * intervalo / 1000), alturaM: suavizado[i] }));
  // La última muestra puede sobrepasar unos metros el total redondeado y duplicar el extremo.
  const sinDuplicados = lista => lista.reduce((salida,p)=>{if(salida.at(-1)?.km===p.km)salida[salida.length-1]=p;else salida.push(p);return salida;},[]);
  return { disponible: cobertura === 1, cobertura, ascensoM, descensoM, perfil:sinDuplicados(perfil), perfilMotor:sinDuplicados(perfilMotor) };
}

export function interpretarVelocidades(maniobras, km) {
  if (!Array.isArray(maniobras) || maniobras.length > 10000) return [];
  const partes = maniobras.filter(m => finito(m.length) && m.length > 0);
  if (!partes.length || partes.some(m => !finito(m.time) || m.time <= 0 || m.length * 3600 / m.time > 160) ||
      Math.abs(partes.reduce((s, m) => s + m.length, 0) - km) > Math.max(.05, km * .02)) return [];
  // Las longitudes por maniobra se redondean; ajusta solo su cobertura al total validado.
  const escala=km/partes.reduce((s,m)=>s+m.length,0);
  let inicioKm = 0;
  return partes.map((m,i) => {
    const p = { inicioKm, finKm: i===partes.length-1?km:inicioKm + m.length*escala, kmh: m.length * 3600 / m.time };
    inicioKm = p.finKm; return p;
  });
}

export function interpretarRuta(json, ubicaciones, viaje) {
  const trip = json?.trip;
  if (trip?.status !== 0 || trip.units !== 'kilometers' || !Array.isArray(trip.legs) || trip.legs.length !== ubicaciones.length - 1) throw indisponible();
  const avisos = new Set(['La duración usa velocidades del mapa; no incluye tráfico en vivo, bloqueos ni paradas.']);
  const tramos = trip.legs.map((leg, i) => {
    const km = leg.summary?.length, segundos = leg.summary?.time;
    if (!finito(km) || km <= 0 || km > 3000 || !finito(segundos) || segundos <= 0 || segundos > 604800) throw indisponible();
    const puntos = decodificarPolyline6(leg.shape);
    if (distancia(puntos[0], ubicaciones[i]) > 2 || distancia(puntos.at(-1), ubicaciones[i + 1]) > 2 ||
        km < distancia(puntos[0], puntos.at(-1)) * .98) throw fallo(422, 'No encontramos una carretera cercana a los puntos. Acércalos a una calle o entrada de gasolinera.');
    let longitudGeometria = 0;
    for (let j = 1; j < puntos.length; j++) longitudGeometria += distancia(puntos[j - 1], puntos[j]);
    if (Math.abs(longitudGeometria - km) > Math.max(.15, km * .1)) throw indisponible();
    if (distancia(puntos[0], ubicaciones[i]) > .1 || distancia(puntos.at(-1), ubicaciones[i + 1]) > .1) avisos.add('Algún punto se ajustó a una carretera próxima; revisa las entradas en el mapa.');
    const relieve = analizarElevacion(leg.elevation, leg.elevation_interval, km);
    if (!relieve.disponible) avisos.add('Hay elevaciones ausentes: no se aplicará un ajuste por subidas.');
    if (leg.summary.has_ferry) throw fallo(422, 'La ruta incluye un ferry. El cálculo de combustible por carretera no contempla este cruce; elige otros puntos o kilómetros manuales.');
    const irregular = (leg.maneuvers ?? []).some(m => m.rough === true);
    if (irregular) avisos.add('El mapa señala alguna sección sin pavimentar o con superficie irregular. Su extensión y estado actual no están confirmados; puedes reservar un margen adicional.');
    if (leg.summary.has_toll) avisos.add('Hay peajes señalados en el mapa; su importe no está incluido en el presupuesto.');
    const admins = leg.summary.admins ?? [];
    if (admins.some(a => a.country_code && a.country_code !== 'GT')) avisos.add('La ruta pasa por otro país. Revisa fronteras, documentación y precios fuera de Guatemala.');
    const velocidades = interpretarVelocidades(leg.maneuvers, km);
    if (!velocidades.length) avisos.add('No hay velocidades por maniobra completas para simular este tramo. Puedes usar el presupuesto por consumo.');
    return { sentido: viaje === 'vuelta' || i === 1 ? 'vuelta' : 'ida', kilometros: km, segundos, puntos, relieve, velocidades,
      superficieIrregular: irregular, peajes: Boolean(leg.summary.has_toll) };
  });
  if (trip.warnings?.length) avisos.add('El proveedor emitió advertencias o ajustó opciones de la solicitud. Revisa el recorrido antes de viajar.');
  return { proveedor: 'Valhalla · OpenStreetMap', calculadoEn: new Date().toISOString(), tramos,
    kilometros: tramos.reduce((s, t) => s + t.kilometros, 0), segundos: tramos.reduce((s, t) => s + t.segundos, 0), avisos: [...avisos] };
}

export function crearEnrutador({ fetchFn = fetch, url = process.env.RUTAS_VALHALLA_URL || 'https://valhalla1.openstreetmap.de',
  ahora = Date.now, esperar = ms => new Promise(r => setTimeout(r, ms)), intervaloMs = 1100, timeoutMs = 12000 } = {}) {
  const endpoint = new URL('route', `${url.replace(/\/$/, '')}/`);
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))) throw new Error('RUTAS_VALHALLA_URL requiere HTTPS o un servidor local.');
  const cache = new Map(), pendientes = new Map();
  let cola = Promise.resolve(), ultimoInicio = -Infinity, enfriarHasta = 0;
  async function consultar({ origen, destino, viaje, tipo }) {
    const ubicaciones = viaje === 'ida_vuelta' ? [origen, destino, origen] : viaje === 'vuelta' ? [destino, origen] : [origen, destino];
    const clave = JSON.stringify([ubicaciones, tipo, viaje]);
    const previo = cache.get(clave);
    if (previo && ahora() - previo.fecha < 600_000) return structuredClone(previo.data);
    cache.delete(clave);
    if (pendientes.has(clave)) return structuredClone(await pendientes.get(clave));
    if (pendientes.size >= 3 || ahora() < enfriarHasta) throw fallo(429, 'El servicio de rutas está ocupado. Espera un momento o usa kilómetros manuales.');
    const solicitado = ahora();
    const promesa = cola.catch(() => {}).then(async () => {
      if (ahora() - solicitado > 10_000 || ahora() < enfriarHasta) throw fallo(429, 'El servicio de rutas está ocupado. Reintenta en un momento.');
      const pausa = intervaloMs - (ahora() - ultimoInicio); if (pausa > 0) await esperar(pausa);
      ultimoInicio = ahora();
      const costing = tipo === 'moto' ? 'motorcycle' : 'auto';
      let respuesta;
      try {
        respuesta = await fetchFn(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json',
          'User-Agent': 'LEPRICES/1.0 local-development', 'X-Client-Id': 'leprices-local-development' },
        body: JSON.stringify({ locations: ubicaciones.map(p => ({ lat: p.latitud, lon: p.longitud, type: 'break' })),
          costing, costing_options: { [costing]: { use_ferry: 0, use_tracks: 0, speed_types: ['freeflow', 'constrained'] } }, units: 'kilometers', language: 'es-ES',
          directions_type: 'maneuvers', elevation_interval: 30, admin_crossings: true }), signal: AbortSignal.timeout(timeoutMs) });
        if (respuesta.status === 429) { enfriarHasta = ahora() + 60_000; throw fallo(429, 'El proveedor de carreteras alcanzó su límite. Espera un minuto o usa kilómetros manuales.'); }
        if (!respuesta.ok) throw indisponible();
        const reader = respuesta.body.getReader(), chunks = []; let bytes = 0;
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          bytes += value.length;
          if (bytes > 10_000_000) { await reader.cancel(); throw indisponible(); }
          chunks.push(value);
        }
        const data = interpretarRuta(JSON.parse(Buffer.concat(chunks).toString('utf8')), ubicaciones, viaje);
        if (cache.size >= 50) cache.delete(cache.keys().next().value);
        cache.set(clave, { fecha: ahora(), data }); return data;
      } catch (e) { if (e.statusCode) throw e; throw indisponible(); }
    });
    cola = promesa; pendientes.set(clave, promesa);
    try { return structuredClone(await promesa); } finally { pendientes.delete(clave); }
  }
  return { consultar };
}
// Público y privado comparten cola, caché y límite del proveedor en este proceso.
export const enrutador = crearEnrutador();
