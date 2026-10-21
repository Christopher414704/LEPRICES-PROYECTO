import { listarGasolinerasConPrecios } from './gasolineras.service.js';
import { crearServicioMiAutomovil } from './mi-automovil.service.js';
import { crearServicioBitacoraCombustible } from './bitacora-combustible.service.js';
const LITROS_GALON = 3.785411784;
function crearBitacoraVehiculos(db) {
  return { async historial(usuario, id) {
    const datos = await crearServicioBitacoraCombustible(db).listar(usuario, id);
    const rendimiento = datos.rendimientoPromedioKmLitro;
    return { resumen: { consumoReal: rendimiento > 0 ? { l100km: 100 / rendimiento } : null } };
  } };
}
import { database } from '../config/database.js';
import { enrutador } from './enrutamiento.service.js';
import { validarSimulacion, simuladorConsumo } from './simulacion-consumo.service.js';
import { estimarConsumoTeorico } from './consumo-teorico.js';

const error = (statusCode, message) => Object.assign(new Error(message), { statusCode });
function numero(valor, min, max, nombre) {
  if (!['number', 'string'].includes(typeof valor) || String(valor).trim() === '' ||
      !Number.isFinite(Number(valor)) || Number(valor) < min || Number(valor) > max) {
    throw error(400, `${nombre}: indica un número entre ${min} y ${max}.`);
  }
  return Number(valor);
}
function booleano(valor, predeterminado, nombre) {
  if (valor === undefined) return predeterminado;
  if (typeof valor !== 'boolean') throw error(400, `${nombre}: selecciona una opción válida.`);
  return valor;
}
export function puntoGuatemala(punto) {
  if (!punto || typeof punto !== 'object') throw error(400, 'Selecciona origen y destino.');
  // Área de trabajo del mapa, no una comprobación de frontera política.
  return { latitud: numero(punto.latitud, 13.5, 18.1, 'Latitud'),
    longitud: numero(punto.longitud, -92.3, -88, 'Longitud') };
}
export function distanciaRecta(a, b) {
  const r = n => n * Math.PI / 180;
  const h = Math.sin(r(b.latitud - a.latitud) / 2) ** 2 +
    Math.cos(r(a.latitud)) * Math.cos(r(b.latitud)) * Math.sin(r(b.longitud - a.longitud) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export function validarViaje(datos = {}) {
  const origen = puntoGuatemala(datos.origen), destino = puntoGuatemala(datos.destino);
  const recta = distanciaRecta(origen, destino);
  if (recta < 0.05) throw error(400, 'Origen y destino deben ser distintos.');
  if (!['ida', 'vuelta', 'ida_vuelta'].includes(datos.viaje)) throw error(400, 'Selecciona el tipo de viaje.');
  const distanciaModo = datos.distanciaModo ?? 'manual'; // Compatibilidad con clientes de la primera versión.
  if (!['api', 'manual'].includes(distanciaModo)) throw error(400, 'Selecciona distancia por carretera o kilómetros manuales.');
  const criterioRuta = datos.criterioRuta ?? 'rapida';
  if (!['rapida', 'equilibrada', 'corta'].includes(criterioRuta)) throw error(400, 'Selecciona una prioridad de ruta válida.');
  const preferenciasRuta = {
    criterio: criterioRuta,
    evitarPeajes: booleano(datos.evitarPeajes, false, 'Evitar peajes'),
    evitarAutopistas: booleano(datos.evitarAutopistas, false, 'Evitar autopistas'),
    evitarNoPavimentadas: booleano(datos.evitarNoPavimentadas, true, 'Evitar caminos no pavimentados'),
  };
  const ida = distanciaModo === 'manual' && datos.viaje !== 'vuelta' ? numero(datos.kmIda, 0.1, 3000, 'Distancia de ida') : 0;
  const vuelta = distanciaModo === 'manual' && datos.viaje !== 'ida' ? numero(datos.kmVuelta, 0.1, 3000, 'Distancia de regreso') : 0;
  if ([ida, vuelta].some(km => km > 0 && km < recta * 0.98)) {
    throw error(400, 'La distancia por carretera no puede ser menor que la separación entre los puntos. Revisa los kilómetros o las ubicaciones.');
  }
  if (!['regular', 'super', 'premium', 'diesel', 'electricidad'].includes(datos.combustible) ||
      !['autoservicio', 'servicio_manual'].includes(datos.modalidad)) throw error(400, 'Selecciona combustible y modalidad de servicio.');
  if (datos.codigoGasolinera != null && (typeof datos.codigoGasolinera !== 'string' || !/^[\w-]{1,100}$/.test(datos.codigoGasolinera))) throw error(400, 'Gasolinera inválida.');
  const margen = numero(datos.margen ?? 0, 0, 50, 'Margen de combustible');
  const precioManual = datos.precioManual == null ? null : numero(datos.precioManual, 0.01, 1000, datos.combustible==='electricidad'?'Tarifa por kWh':'Precio por galón');
  if (datos.ajustarSubidas != null && typeof datos.ajustarSubidas !== 'boolean') throw error(400, 'Ajuste por subidas inválido.');
  const ajustarSubidas = datos.ajustarSubidas === true;
  if (ajustarSubidas && distanciaModo !== 'api') throw error(400, 'El ajuste por subidas necesita elevaciones de una ruta por carretera.');
  const masaKg = ajustarSubidas ? numero(datos.masaKg, 100, 10000, 'Peso total cargado en kg') : null;
  const eficiencia = ajustarSubidas ? numero(datos.eficienciaPct, 10, 45, 'Eficiencia estimada en %') / 100 : null;
  if(datos.modeloConsumo==='teorico' && ajustarSubidas)throw error(400,'El modelo teórico ya incluye pendientes. Desactiva el ajuste adicional por subidas.');
  if(datos.combustible==='electricidad' && (ajustarSubidas || datos.modeloConsumo==='fastsim' || datos.codigoGasolinera))throw error(400,'Para electricidad usa consumo en kWh o el modelo teórico, sin seleccionar un precio de gasolinera ni ajuste adicional por subidas.');
  const simulacion = datos.modeloConsumo==='teorico'?null:validarSimulacion(datos, numero);
  return { origen, destino, viaje: datos.viaje, distanciaModo, preferenciasRuta, simulacion, modeloConsumo: datos.modeloConsumo==='teorico'?'teorico':simulacion ? 'fastsim' : 'consumo', ajustarSubidas, masaKg, eficiencia, kmIda: ida, kmVuelta: vuelta, kilometros: ida + vuelta,
    combustible: datos.combustible, modalidad: datos.modalidad, margen, precioManual,
    codigoGasolinera: datos.codigoGasolinera ?? null, distanciaRectaKm: recta };
}
export function distanciaAlRecorrido(p, tramos) {
  let minima = Infinity;
  // Proyección local sobre cada segmento (km); no una línea entre A y B.
  const x = 111.32 * Math.cos(p.latitud * Math.PI / 180), y = 111.32;
  for (const tramo of tramos) for (let i = 1; i < tramo.puntos.length; i++) {
    const a = tramo.puntos[i - 1], b = tramo.puntos[i];
    const ax = (a.longitud - p.longitud) * x, ay = (a.latitud - p.latitud) * y;
    const dx = (b.longitud - a.longitud) * x, dy = (b.latitud - a.latitud) * y;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    minima = Math.min(minima, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return minima;
}
function precioGalon(precio, ahora) {
  if (!precio || precio.moneda?.trim() !== 'GTQ' || !Number.isFinite(Number(precio.precio)) || Number(precio.precio) <= 0 ||
      !Number.isFinite(Date.parse(precio.vigenteDesde)) || Date.parse(precio.vigenteDesde) > ahora) return null;
  const unidad = String(precio.unidadMedida).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (unidad === 'galon') return Number(precio.precio);
  if (unidad === 'litro') return Number(precio.precio) * LITROS_GALON;
  return null;
}
export function elegirPrecios(estaciones, viaje, ahora = Date.now()) {
  const vistas = new Set();
  return estaciones.flatMap(estacion => {
    if (vistas.has(estacion.codigo)) return [];
    vistas.add(estacion.codigo);
    const cercaKm = viaje.ruta ? distanciaAlRecorrido(estacion.ubicacion, viaje.ruta.tramos) :
      Math.min(distanciaRecta(viaje.origen, estacion.ubicacion), distanciaRecta(viaje.destino, estacion.ubicacion));
    if (!Number.isFinite(cercaKm) || cercaKm > (viaje.ruta ? 2 : 20)) return [];
    const precio = estacion.combustibles.find(c => c.tipo.codigo === viaje.combustible)?.precios[viaje.modalidad];
    const valor = precioGalon(precio, ahora);
    if (valor == null) return [];
    return [{ codigo: estacion.codigo, nombre: estacion.nombre, ubicacion: estacion.ubicacion,
      municipio: estacion.municipio, departamento: estacion.departamento,
      precioGalon: valor, vigenteDesde: precio.vigenteDesde, cercaKm }];
  }).sort((a, b) => a.precioGalon - b.precioGalon || a.codigo.localeCompare(b.codigo));
}
export function calcularEstimacion(viaje, consumo, estaciones, hayMas = false, simulacion = null) {
  if(viaje.combustible==='electricidad') {
    const kwh100km=numero(consumo.kwh100km,.1,300,'Consumo en kWh/100 km');
    const kwhBase=viaje.kilometros*kwh100km/100, kwh=kwhBase*(1+viaje.margen/100);
    return {...viaje,simulacion:null,distanciaFuente:viaje.ruta?'valhalla':'manual',consumo:{...consumo,kwh100km},
      litros:null,galones:null,litrosBase:null,litrosSubidas:0,kwhBase,kwh,
      terreno:{aplicado:false,ascensoM:null,motivo:'modelo_energia_electrica'},
      precio:{fuente:viaje.precioManual!=null?'manual':'sin_tarifa',precioKwh:viaje.precioManual,precioGalon:null,estaciones:0,hayMas:false},
      costo:viaje.precioManual==null?null:kwh*viaje.precioManual,estaciones:[],calculadoEn:new Date().toISOString()};
  }
  const l100km = numero(consumo.l100km, 0.1, 100, 'Consumo en L/100 km');
  const litrosBase = viaje.kilometros * l100km / 100;
  const relieveCompleto = viaje.ruta?.tramos.every(t => t.relieve.disponible);
  const ascensoM = relieveCompleto ? viaje.ruta.tramos.reduce((s, t) => s + t.relieve.ascensoM, 0) : null;
  // Modelo opcional de energía potencial. 32/35.8 MJ/L son valores de referencia;
  // la eficiencia es una hipótesis del usuario, no una medición del motor.
  const energiaMJLitro = viaje.combustible === 'diesel' ? 35.8 : 32;
  if (viaje.ajustarSubidas && consumo.fuente === 'bitacora') throw error(400, 'Tu consumo medido ya incluye condiciones de conducción. No añadimos subidas otra vez; usa un consumo base de terreno llano para este ajuste.');
  const litrosSubidas = viaje.ajustarSubidas && relieveCompleto ? viaje.masaKg * 9.80665 * ascensoM / (energiaMJLitro * 1e6 * viaje.eficiencia) : 0;
  const litros = (simulacion?.litros ?? (litrosBase + litrosSubidas)) * (1 + viaje.margen / 100), galones = litros / LITROS_GALON;
  const seleccionada = viaje.codigoGasolinera ? estaciones.find(e => e.codigo === viaje.codigoGasolinera) : null;
  if (viaje.codigoGasolinera && !seleccionada) throw error(400, 'La gasolinera seleccionada no tiene un precio disponible para este combustible y servicio cerca de los puntos.');
  const precios = estaciones.map(e => e.precioGalon);
  const promedio = precios.length ? precios.reduce((s, p) => s + p, 0) / precios.length : null;
  const precioGalon = viaje.precioManual ?? seleccionada?.precioGalon ?? promedio;
  return { ...viaje, simulacion, distanciaFuente: viaje.ruta ? 'valhalla' : 'manual', consumo: { ...consumo, l100km }, litrosBase, litrosSubidas, litros, galones,
    terreno: { aplicado: Boolean(viaje.ajustarSubidas && relieveCompleto), ascensoM, energiaMJLitro,
      motivo: !viaje.ajustarSubidas ? 'sin_ajuste' : !relieveCompleto ? 'sin_elevacion_completa' : 'modelo_energia' },
    precio: { fuente: viaje.precioManual != null ? 'manual' : seleccionada ? 'gasolinera' : viaje.ruta ? 'promedio_recorrido' : 'promedio_extremos',
      precioGalon, promedio, minimo: precios.length ? Math.min(...precios) : null,
      maximo: precios.length ? Math.max(...precios) : null, estaciones: precios.length, hayMas },
    costo: precioGalon == null ? null : galones * precioGalon,
    estaciones, calculadoEn: new Date().toISOString() };
}
export function crearServicioRutas({ listar = listarGasolinerasConPrecios,
  garaje = crearServicioMiAutomovil(database, {}), bitacora = crearBitacoraVehiculos(database), proveedor = enrutador, simulador = simuladorConsumo } = {}) {
  async function consumoVehiculo(usuario, id) {
    if (usuario?.rol !== 'conductor') throw error(403, 'Seleccionar tu vehículo requiere una cuenta de conductor.');
    if (!/^[1-9]\d{0,17}$/.test(String(id ?? ''))) throw error(400, 'Vehículo inválido.');
    const vehiculo = (await garaje.listar(usuario)).find(v => v.id === String(id));
    if (!vehiculo) throw error(404, 'No encontramos el vehículo en tu garaje.');
    const historial = await bitacora.historial(usuario, id);
    const real = historial.resumen.consumoReal?.l100km;
    const referencia = vehiculo.ficha.consumo?.combinado;
    const l100km = real ?? referencia ?? null;
    const combustible = vehiculo.ficha.combustible ?? null;
    if (/^electricity$|^electricidad$|^el[eé]ctric[oa]$/i.test(combustible ?? '') || /^bev$|^electric$/i.test(vehiculo.ficha.tecnologia ?? '')) return {
      vehiculo:{id:vehiculo.id,alias:vehiculo.alias,combustible,tipo:vehiculo.ficha.tipo,tecnologia:'BEV'},
      l100km:null,kwh100km:null,fuente:'sin_datos'};
    return { vehiculo: { id: vehiculo.id, alias: vehiculo.alias, combustible, tipo: vehiculo.ficha.tipo,
      tecnologia: vehiculo.ficha.tecnologia, anioDeclarado: Boolean(vehiculo.ficha.anioDeclarado) }, referencia: vehiculo.ficha.consumo ?? null,
      l100km, fuente: real != null ? 'bitacora' : referencia != null ? 'catalogo' : 'sin_datos' };
  }
  async function estimar(datos, usuario = null) {
    const viaje = validarViaje(datos);
    let consumo;
    if (datos.vehiculoId != null) {
      consumo = await consumoVehiculo(usuario, datos.vehiculoId);
      if (consumo.l100km == null && viaje.modeloConsumo!=='teorico') throw error(400, 'Este vehículo todavía no tiene consumo utilizable. Elige el modelo teórico o ingresa tu consumo sin seleccionar el garaje.');
      const fuel = (consumo.vehiculo.combustible ?? '').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
      if ((fuel.includes('diesel') && viaje.combustible !== 'diesel') || (/gasoline|gasolina|petrol/.test(fuel) && viaje.combustible === 'diesel')) throw error(400, 'El combustible seleccionado no corresponde al vehículo.');
      const electrico=/^electricity$|^electricidad$|^electrico$|^electrica$/.test(fuel) || /^bev$|^electric$/i.test(consumo.vehiculo.tecnologia ?? '');
      const liquido=/diesel|gasoline|gasolina|petrol/.test(fuel);
      if((electrico && viaje.combustible!=='electricidad') || (liquido && viaje.combustible==='electricidad'))throw error(400,'El combustible seleccionado no corresponde al vehículo.');
    } else consumo = viaje.modeloConsumo==='teorico' ? {} : viaje.combustible==='electricidad' ?
      {l100km:null,kwh100km:numero(datos.consumoManual,.1,300,'Consumo en kWh/100 km'),fuente:'manual'} :
      {l100km:numero(datos.consumoManual,.1,100,'Consumo en L/100 km'),fuente:'manual'};
    if (viaje.simulacion) {
      if (consumo.fuente === 'referencia_general') throw error(400, 'El consumo general no identifica un ciclo ni una velocidad de referencia. Usa el presupuesto por consumo; no se puede calibrar esta simulación con ese dato.');
      if (consumo.fuente === 'bitacora') throw error(400, 'Tu bitácora no registra la velocidad de referencia. Conserva el presupuesto medido o usa consumo manual con una referencia conocida para simular.');
      if (consumo.vehiculo && /hybrid|plug|electric|phev|hev/i.test(consumo.vehiculo.tecnologia ?? '')) throw error(400, 'Esta simulación es para motores convencionales. Usa el presupuesto por consumo para este híbrido.');
      if (consumo.vehiculo && viaje.simulacion.referencia === 'constante') throw error(400, 'El catálogo no proporciona consumo a velocidad constante. Elige referencia combinada o carretera.');
      if (consumo.vehiculo && viaje.simulacion.referencia === 'carretera') {
        consumo = { ...consumo, l100km: numero(consumo.referencia?.carretera, .1, 100, 'Referencia de carretera del catálogo') };
      }
    }
    if (viaje.ajustarSubidas && consumo.fuente === 'bitacora') throw error(400, 'Desactiva el ajuste por subidas: tu consumo medido ya incluye las condiciones de conducción.');
    let grupos;
    if (viaje.distanciaModo === 'api') {
      const tipo = consumo.vehiculo ? (consumo.vehiculo.tipo === 'moto' ? 'moto' : 'auto') : datos.tipoVehiculo ?? 'auto';
      if (!['auto', 'moto'].includes(tipo)) throw error(400, 'Selecciona automóvil o motocicleta.');
      viaje.ruta = await proveedor.consultar({ ...viaje, tipo });
      viaje.kmIda = viaje.ruta.tramos.filter(t => t.sentido === 'ida').reduce((s, t) => s + t.kilometros, 0);
      viaje.kmVuelta = viaje.ruta.tramos.filter(t => t.sentido === 'vuelta').reduce((s, t) => s + t.kilometros, 0);
      viaje.kilometros = viaje.kmIda + viaje.kmVuelta;
      let oeste = Infinity, sur = Infinity, este = -Infinity, norte = -Infinity;
      for (const tramo of viaje.ruta.tramos) for (const p of tramo.puntos) {
        oeste = Math.min(oeste, p.longitud); este = Math.max(este, p.longitud);
        sur = Math.min(sur, p.latitud); norte = Math.max(norte, p.latitud);
      }
      grupos = viaje.combustible==='electricidad'?[]:[await listar({ soloVisibles: true, bbox: [oeste - .03, sur - .02, este + .03, norte + .02], limite: 301 })];
    } else grupos = viaje.combustible==='electricidad'?[]:await Promise.all([viaje.origen, viaje.destino].map(p => listar({ soloVisibles: true,
      bbox: [p.longitud - .25, p.latitud - .2, p.longitud + .25, p.latitud + .2], limite: 301 })));
    let simulacion = null;
    if (viaje.simulacion) {
      if (viaje.ruta.tramos.some(t => !t.velocidades?.length)) throw error(422, 'El proveedor no entregó velocidades por maniobra completas. Usa presupuesto por consumo o elige otra ruta.');
      const tipo = consumo.vehiculo?.tipo ?? datos.tipoVehiculo ?? 'auto';
      simulacion = await simulador.simular({ l100km: consumo.l100km, parametros: { ...viaje.simulacion, tipo },
        tramos: viaje.ruta.tramos.map(t => ({ sentido: t.sentido, kilometros: t.kilometros, velocidades: t.velocidades, relieve: t.relieve })) });
    }
    if(viaje.modeloConsumo==='teorico') {
      const propulsion=viaje.combustible==='electricidad'?'electrico':/hybrid|plug|phev|hev/i.test(consumo.vehiculo?.tecnologia ?? '')?'hibrido':datos.estimacionTeorica?.propulsion;
      consumo={vehiculo:consumo.vehiculo,...estimarConsumoTeorico({...datos.estimacionTeorica,...(propulsion?{propulsion}:{})},viaje.combustible,viaje)};
    }
    const estaciones = viaje.combustible==='electricidad'?[]:elegirPrecios(grupos.flatMap(g => g.slice(0, 300)), viaje);
    return calcularEstimacion(viaje, consumo, estaciones, grupos.some(g => g.length > 300), simulacion);
  }
  return { estimar, consumoVehiculo };
}
