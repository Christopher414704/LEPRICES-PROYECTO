import { consultarSesion, solicitarApi, mensajeError } from './auth.js';
import { CIUDADES_RUTA, LITROS_GALON, enlaceNavegacion, nombreConsumo } from './rutas-utils.js';

const $ = id => document.getElementById(id);
const formato = n => new Intl.NumberFormat('es-GT', { maximumFractionDigits: 2 }).format(n);
const parametro = n => new Intl.NumberFormat('es-GT', { maximumFractionDigits: 3 }).format(n);
const dinero = n => `Q ${new Intl.NumberFormat('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
let mapa, ultimoResultado, estacionesMapa = [], calculando = false, localizando = false;
let consumoRevision = 0, consultaConsumo, consumoListo = true;
let consumoMedido = false;
let consumoGeneral = false;
let consumoDisponible = true, consumoConsultando = false;
let simulacionCompatible = true;
const camposTeoricos=['propulsionTeorica','pesoTeorico','velocidadTeorica','eficienciaTeorica','cdaTeorico','rodaduraTeorica','auxiliaresTeoricos','ralentiTeorico','regeneracionTeorica','paradasTeoricas','minutosTeoricos','temperaturaTeorica','altitudTeorica','ascensoTeoricoIda','ascensoTeoricoVuelta'];
const camposCalibracion=['kmCalibracion','cantidadCalibracion','velocidadCalibracion','paradasCalibracion','minutosCalibracion','ascensoCalibracion','altitudCalibracion','temperaturaCalibracion'];
const lugares = new Map(CIUDADES_RUTA.map(([nombre, latitud, longitud], i) => [`ciudad-${i}`, { nombre, latitud, longitud }]));

async function pedir(ruta, opciones = {}) {
  const respuesta = await solicitarApi(ruta, opciones);
  const datos = await respuesta.json();
  if (!respuesta.ok) throw new Error(datos.message ?? 'No fue posible completar la consulta.');
  return datos.data;
}
function estado(texto, error = false) {
  $('mensajeRuta').textContent = texto; $('mensajeRuta').classList.toggle('error', error);
}
function invalidar() {
  ultimoResultado = null; $('resultadoRuta').hidden = true; $('panelEstacionesRuta').hidden = true;
  mapa?.recorrido(null);
  $('leyendaRuta').textContent = 'A = origen · B = destino · Línea punteada = guía entre puntos. Calcula para ver la carretera.';
  estado('');
}
function puntos() {
  return { origen: { latitud: Number($('latOrigen').value), longitud: Number($('lonOrigen').value) },
    destino: { latitud: Number($('latDestino').value), longitud: Number($('lonDestino').value) } };
}
function actualizarMapa() {
  if (['latOrigen', 'lonOrigen', 'latDestino', 'lonDestino'].some(id => !$(id).value || !$(id).checkValidity())) return;
  const { origen, destino } = puntos(); mapa?.actualizar(origen, destino);
}
function marcar(tipo, punto, personal = true) {
  if (calculando) return;
  if (punto.latitud < 13.5 || punto.latitud > 18.1 || punto.longitud < -92.3 || punto.longitud > -88) {
    estado('Marca un punto dentro del área de Guatemala que muestra el mapa.', true); return;
  }
  const suffix = tipo === 'origen' ? 'Origen' : 'Destino';
  $(`lat${suffix}`).value = punto.latitud; $(`lon${suffix}`).value = punto.longitud;
  $('kmIda').value = ''; $('kmVuelta').value = '';
  if (personal) $(`${tipo}Ruta`).value = 'personalizado';
  invalidar(); actualizarMapa();
}
function llenarLugares() {
  for (const id of ['origenRuta', 'destinoRuta']) {
    const valor = $(id).value;
    $(id).replaceChildren(new Option('Punto personalizado · mapa o coordenadas', 'personalizado'),
      ...[...lugares].map(([codigo, lugar]) => new Option(lugar.nombre, codigo)));
    if (valor && [...$(id).options].some(o => o.value === valor)) $(id).value = valor;
  }
}
llenarLugares();
$('origenRuta').value = 'ciudad-0'; $('destinoRuta').value = 'ciudad-1';
marcar('origen', lugares.get('ciudad-0'), false); marcar('destino', lugares.get('ciudad-1'), false);
for (const tipo of ['origen', 'destino']) {
  $(`${tipo}Ruta`).addEventListener('change', () => {
    const lugar = lugares.get($(`${tipo}Ruta`).value);
    if (lugar) marcar(tipo, lugar, false);
  });
  const suffix = tipo === 'origen' ? 'Origen' : 'Destino';
  for (const id of [`lat${suffix}`, `lon${suffix}`]) $(id).addEventListener('input', () => {
    $('kmIda').value = ''; $('kmVuelta').value = '';
    $(`${tipo}Ruta`).value = 'personalizado'; actualizarMapa();
  });
}
for (const [id, tipo] of [['marcarOrigen', 'origen'], ['marcarDestino', 'destino']]) {
  $(id).addEventListener('click', () => {
    mapa?.seleccionar(tipo);
    $('marcarOrigen').setAttribute('aria-pressed', String(tipo === 'origen'));
    $('marcarDestino').setAttribute('aria-pressed', String(tipo === 'destino'));
    $('estadoMapaRuta').textContent = `Toca el mapa para marcar ${tipo === 'origen' ? 'el origen A' : 'el destino B'}. También puedes elegir una ciudad.`;
  });
}
$('centrarRuta').addEventListener('click', () => mapa?.centrar());
function ajustarCampos() {
  const viaje = $('viajeRuta').value;
  const manual = $('distanciaModo').value === 'manual';
  const opcionFisica = $('modeloConsumoRuta').querySelector('option[value="fastsim"]');
  const electrico=$('combustibleRuta').value==='electricidad';
  opcionFisica.disabled = electrico || manual || consumoMedido || !consumoListo || !simulacionCompatible;
  if (opcionFisica.disabled && $('modeloConsumoRuta').value==='fastsim') $('modeloConsumoRuta').value = 'consumo';
  const teorico=$('modeloConsumoRuta').value==='teorico';
  $('camposTeoricos').hidden=!teorico;
  for(const id of camposTeoricos) {$(id).disabled=!teorico;$(id).required=teorico;}
  $('calibrarTeorico').disabled=!teorico;
  const calibrar=teorico && $('calibrarTeorico').checked;
  $('camposCalibracion').hidden=!calibrar;
  for(const id of camposCalibracion) {$(id).disabled=!calibrar;$(id).required=calibrar;}
  $('eficienciaTeorica').min=electrico?'50':'10';$('eficienciaTeorica').max=electrico?'98':'45';
  $('regeneracionTeorica').disabled=!teorico || $('propulsionTeorica').value==='combustion';
  $('ralentiTeorico').disabled=!teorico || electrico;
  $('unidadConsumoManual').textContent=electrico?'Consumo · kWh/100 km':'Consumo · L/100 km';
  $('consumoManual').max=electrico?'300':'100';
  $('unidadPrecioRuta').textContent=electrico?'Tarifa de batería · Q/kWh · opcional':'Precio por galón · Q · opcional';
  $('precioManualRuta').placeholder=electrico?'Sin tarifa no calculamos costo':'Usar promedio publicado';
  $('unidadCantidadCalibracion').textContent=electrico?'Energía de batería consumida · kWh':'Litros consumidos';
  $('modalidadRuta').disabled=electrico;
  $('conversionConsumo').hidden=electrico || Boolean($('vehiculoRuta').value);
  $('campoConsumoManual').hidden=teorico || Boolean($('vehiculoRuta').value);
  $('consumoManual').disabled=teorico || Boolean($('vehiculoRuta').value);
  $('consumoManual').required=!teorico && !$('vehiculoRuta').value;
  consumoListo=!consumoConsultando && (consumoDisponible || teorico);
  $('calcularRuta').disabled=!consumoListo || localizando || calculando;
  const fisica = $('modeloConsumoRuta').value === 'fastsim';
  $('camposSimulacion').hidden = !fisica;
  for (const id of ['pesoSimulacion', 'cargaSimulacion', 'potenciaSimulacion', 'cdaSimulacion', 'rodaduraSimulacion', 'referenciaSimulacion', 'velocidadMaximaRuta', 'paradasSimulacion', 'relieveSimulacion']) {
    $(id).disabled = !fisica; $(id).required = fisica && !['relieveSimulacion', 'paradasSimulacion'].includes(id);
  }
  const constante = fisica && $('referenciaSimulacion').value === 'constante';
  $('campoReferenciaVelocidad').hidden = !constante;
  $('velocidadReferencia').disabled = !constante; $('velocidadReferencia').required = constante;
  $('referenciaSimulacion').querySelector('option[value="constante"]').disabled = Boolean($('vehiculoRuta').value);
  $('notaSimulacion').textContent = teorico ? 'Modelo físico para el recorrido: relieve, velocidades, paradas y tiempo detenido. Puedes calibrarlo con un viaje medido del mismo vehículo.' : consumoGeneral ? 'La fuente publica un consumo general sin ciclo ni velocidad: permite estimar el presupuesto, pero no calibrar FASTSim.' : consumoMedido ? 'Tu bitácora no registra la velocidad de referencia: conservamos tu consumo medido sin aplicar otro ciclo de conducción.' : electrico ? 'Consumo de batería en kWh; el costo usa únicamente la tarifa que indiques.' : !simulacionCompatible ? 'Para este híbrido usa presupuesto con consumo o el modelo del recorrido. FASTSim aquí admite motores convencionales.' : manual ? 'FASTSim necesita velocidades por tramo de una ruta automática. También puedes usar el modelo del recorrido con condiciones manuales.' : 'FASTSim compara velocidad, peso y relieve. El consumo calibra el escenario, pero los parámetros físicos deben corresponder a tu vehículo.';
  $('distanciasManuales').hidden = !manual;
  for (const [suffix, visible] of [['Ida', viaje !== 'vuelta'], ['Vuelta', viaje !== 'ida']]) {
    $(`campoKm${suffix}`).hidden = !visible; $(`km${suffix}`).disabled = !visible || !manual; $(`km${suffix}`).required = visible && manual;
  }
  $('notaDistancia').textContent = manual ? 'Indica los kilómetros por carretera de cada sentido. La línea punteada es una guía; esta alternativa no obtiene elevaciones ni tiempos.' : 'Al calcular, enviamos los puntos A y B y el tipo de vehículo a Valhalla para obtener la carretera y sus elevaciones. Tu bitácora y datos personales permanecen en LEPRICES.';
  // El consumo medido ya puede incluir pendientes; evita sumar ese esfuerzo dos veces.
  $('ajustarSubidas').disabled = electrico || manual || consumoMedido || !consumoListo || fisica || teorico;
  if ($('ajustarSubidas').disabled) $('ajustarSubidas').checked = false;
  const ajustar = $('ajustarSubidas').checked;
  $('camposSubidas').hidden = !ajustar;
  for (const id of ['masaRuta', 'eficienciaRuta']) { $(id).disabled = !ajustar; $(id).required = ajustar; }
  $('notaSubidas').textContent = consumoMedido ? 'Usamos tu consumo medido: no añadimos pendientes otra vez. El relieve seguirá visible.' : 'Úsalo si el consumo base corresponde a terreno llano. Un consumo combinado puede incluir pendientes; añadirlas puede sobreestimar. El relieve se mostrará aunque no actives el ajuste.';
}
for (const id of ['viajeRuta', 'distanciaModo', 'ajustarSubidas', 'modeloConsumoRuta', 'referenciaSimulacion','calibrarTeorico']) $(id).addEventListener('change', ajustarCampos);
function ajustarPropulsion() {
  const electrico=$('combustibleRuta').value==='electricidad';
  if(electrico) { $('propulsionTeorica').value='electrico';$('ralentiTeorico').value='0';if(Number($('eficienciaTeorica').value)<50)$('eficienciaTeorica').value='85'; }
  else if($('propulsionTeorica').value==='electrico') { $('propulsionTeorica').value='combustion';$('eficienciaTeorica').value='25';$('regeneracionTeorica').value='0';$('ralentiTeorico').value=$('tipoVehiculoRuta').value==='moto'?'0.15':'0.6'; }
  if(!electrico && Number($('eficienciaTeorica').value)>45)$('eficienciaTeorica').value='25';
  ajustarCampos();
}
function reiniciarCalibracion() {
  $('calibrarTeorico').checked=false;
  for(const id of ['kmCalibracion','cantidadCalibracion','velocidadCalibracion'])$(id).value='';
}
$('combustibleRuta').addEventListener('change',()=>{reiniciarCalibracion();$('precioManualRuta').value='';ajustarPropulsion();});
$('propulsionTeorica').addEventListener('change',()=>{
  reiniciarCalibracion();
  if($('propulsionTeorica').value==='electrico')$('combustibleRuta').value='electricidad';
  else if($('combustibleRuta').value==='electricidad')$('combustibleRuta').value='';
  if($('propulsionTeorica').value==='combustion')$('regeneracionTeorica').value='0';
  $('precioManualRuta').value='';ajustarPropulsion();
});
$('tipoVehiculoRuta').addEventListener('change',()=>{
  reiniciarCalibracion();
  const moto=$('tipoVehiculoRuta').value==='moto';
  $('cdaTeorico').value=moto?'0.45':'0.7';$('auxiliaresTeoricos').value=moto?'0.1':'0.5';
  if($('combustibleRuta').value!=='electricidad')$('ralentiTeorico').value=moto?'0.15':'0.6';
  ajustarCampos();
});
$('perfilFisicoRuta').addEventListener('change', () => {
  const ejemplos = { sedan: [1500, 100, .7], suv: [2200, 160, 1.1], deportivo: [1700, 500, .75], moto: [300, 25, .45] };
  const valores = ejemplos[$('perfilFisicoRuta').value];
  if (valores) ['pesoSimulacion', 'potenciaSimulacion', 'cdaSimulacion'].forEach((id, i) => { $(id).value = valores[i]; });
  if (valores && !$('vehiculoRuta').value) $('tipoVehiculoRuta').value = $('perfilFisicoRuta').value === 'moto' ? 'moto' : 'auto';
});
for (const id of ['pesoSimulacion', 'potenciaSimulacion', 'cdaSimulacion']) $(id).addEventListener('input', () => { $('perfilFisicoRuta').value = 'personalizado'; });
ajustarCampos();
$('consumoManual').addEventListener('input', () => {
  const c = Number($('consumoManual').value);
  $('conversionConsumo').textContent = c > 0 ? `Equivale a ${formato(100 * LITROS_GALON / c)} km por galón estadounidense.` : '';
});
$('ubicacionRuta').addEventListener('click', () => {
  if (!navigator.geolocation) return estado('Este navegador no permite obtener la ubicación. Elige una ciudad o marca el mapa.', true);
  localizando = true; $('ubicacionRuta').disabled = true; $('calcularRuta').disabled = true;
  estado('Solicitando tu ubicación…');
  function terminar() { localizando = false; $('ubicacionRuta').disabled = false; $('calcularRuta').disabled = calculando || !consumoListo; }
  navigator.geolocation.getCurrentPosition(p => {
    marcar('origen', { latitud: p.coords.latitude, longitud: p.coords.longitude }); mapa?.centrar(); terminar();
  }, e => {
    estado(e.code === 1 ? 'Permiso de ubicación denegado. Puedes elegir el origen en el mapa o por ciudad.' : 'No pudimos obtener tu ubicación. Puedes elegir el origen en el mapa o por ciudad.', true); terminar();
  }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 });
});

$('vehiculoRuta').addEventListener('change', async () => {
  reiniciarCalibracion();
  const revision = ++consumoRevision; consultaConsumo?.abort();
  const id = $('vehiculoRuta').value;
  consumoDisponible=!id; consumoConsultando=Boolean(id);
  consumoMedido = false; consumoGeneral = false; simulacionCompatible = true; $('campoTipoVehiculo').hidden = Boolean(id);
  if (id && $('referenciaSimulacion').value === 'constante') $('referenciaSimulacion').value = 'combinado';
  $('campoConsumoManual').hidden = Boolean(id); $('consumoManual').disabled = Boolean(id); $('consumoManual').required = !id;
  $('consumoVehiculoRuta').hidden = !id; $('conversionConsumo').hidden = Boolean(id);
  consumoListo = !id; $('calcularRuta').disabled = !consumoListo || localizando;
  ajustarCampos();
  if (!id) return;
  consultaConsumo = new AbortController(); $('consumoVehiculoRuta').textContent = 'Consultando el consumo de tu vehículo…';
  try {
    const data = await pedir(`/rutas/vehiculos/${encodeURIComponent(id)}/consumo`, { signal: consultaConsumo.signal });
    if (revision !== consumoRevision) return;
    const sinConsumo = data.motivo==='referencias_en_conflicto' ? 'Las fuentes publican consumos distintos. Puedes usar un escenario teórico, tu consumo manual o la bitácora.' : 'No hay consumo utilizable. Completa los parámetros del escenario teórico, ingresa tu consumo o registra llenados en la bitácora.';
    $('consumoVehiculoRuta').textContent = data.l100km == null ? sinConsumo : `${nombreConsumo(data.fuente)}: ${formato(data.l100km)} L/100 km.${data.fuente==='referencia_general' ? ' Sin mediciones separadas de ciudad y carretera.' : ''}${data.supuestoGalon ? ' Para este presupuesto suponemos galón estadounidense (3.785 L); la fuente no especifica el tipo.' : ''}${data.vehiculo.anioDeclarado ? ' El año fue ingresado por el usuario; no es una versión confirmada por el catálogo.' : ''}`;
    const combustible = data.vehiculo.combustible ?? '';
    if (/^electricity$|^electricidad$|^el[eé]ctric[oa]$/i.test(combustible) || /^bev$|^electric$/i.test(data.vehiculo.tecnologia ?? '')) $('combustibleRuta').value = 'electricidad';
    else if (/di[eé]sel/i.test(combustible)) $('combustibleRuta').value = 'diesel';
    else if (/premium/i.test(combustible)) $('combustibleRuta').value = 'premium';
    else if (/regular/i.test(combustible)) $('combustibleRuta').value = 'regular';
    else $('combustibleRuta').value = '';
    consumoDisponible = data.l100km != null;
    if(!consumoDisponible)$('modeloConsumoRuta').value='teorico';
    $('cdaTeorico').value=data.vehiculo.tipo==='moto'?'0.45':'0.7';
    $('auxiliaresTeoricos').value=data.vehiculo.tipo==='moto'?'0.1':'0.5';
    $('tipoVehiculoRuta').value=data.vehiculo.tipo==='moto'?'moto':'auto';
    $('propulsionTeorica').value=$('combustibleRuta').value==='electricidad'?'electrico':/hybrid|plug|phev|hev/i.test(data.vehiculo.tecnologia ?? '')?'hibrido':'combustion';
    $('regeneracionTeorica').value='0';
    $('eficienciaTeorica').value=$('combustibleRuta').value==='electricidad'?'85':'25';
    $('ralentiTeorico').value=$('combustibleRuta').value==='electricidad'?'0':data.vehiculo.tipo==='moto'?'0.15':'0.6';
    $('precioManualRuta').value='';ajustarPropulsion();
    consumoMedido = data.fuente === 'bitacora'; ajustarCampos();
    consumoGeneral = data.fuente === 'referencia_general';
    simulacionCompatible = !consumoGeneral && !/hybrid|plug|electric|phev|hev/i.test(data.vehiculo.tecnologia ?? ''); ajustarCampos();
  } catch (e) {
    if (revision !== consumoRevision || e.name === 'AbortError') return;
    $('consumoVehiculoRuta').textContent = mensajeError(e) + ' Puedes elegir «Ingresar mi consumo».';
  } finally {
    if (revision === consumoRevision) $('calcularRuta').disabled = !consumoListo || localizando;
    if (revision === consumoRevision) {consumoConsultando=false;ajustarCampos();}
  }
});
$('formRuta').addEventListener('input', invalidar);
$('formRuta').addEventListener('change', invalidar);

function mostrarEstaciones() {
  if (!ultimoResultado) return;
  const q = $('buscarEstacionRuta').value.trim().toLocaleLowerCase('es');
  const lista = ultimoResultado.estaciones.filter(e => e.nombre.toLocaleLowerCase('es').includes(q));
  $('estacionesRuta').replaceChildren(...lista.map(e => {
    const li = document.createElement('li'), datos = document.createElement('div'), nombre = document.createElement('strong'), detalle = document.createElement('small'), precio = document.createElement('span'), enlace = document.createElement('a');
    nombre.textContent = e.nombre;
    detalle.textContent = `${e.municipio} · ${e.departamento} · A ${formato(e.cercaKm)} km ${ultimoResultado.ruta ? 'del recorrido' : 'de A o B'} en línea recta · Precio publicado: ${new Date(e.vigenteDesde).toLocaleString('es-GT', { timeZone: 'America/Guatemala', dateStyle: 'short', timeStyle: 'short' })}`;
    enlace.textContent = `Ver precios en el mapa ↗`; enlace.href = `/publico.html?gasolinera=${encodeURIComponent(e.codigo)}`;
    precio.className = 'precio-estacion'; precio.textContent = `${dinero(e.precioGalon)}/gal`;
    const costo = document.createElement('small'); costo.textContent = `Viaje: ${dinero(ultimoResultado.galones * e.precioGalon)}`; precio.append(costo);
    datos.append(nombre, detalle, enlace); li.append(datos, precio); return li;
  }));
  $('estadoPreciosRuta').textContent = ultimoResultado.estaciones.length ? `${lista.length} de ${ultimoResultado.estaciones.length} estaciones con precio de este combustible y servicio.${ultimoResultado.precio.hayMas ? ' La consulta alcanzó el límite: el promedio utiliza la muestra disponible.' : ''}` : 'No hay precios publicados de este combustible y servicio cerca del viaje. Puedes indicar un precio por galón para calcular el costo.';
}
function mostrarCarretera(data) {
  $('detalleCarretera').hidden = !data.ruta;
  mapa?.recorrido(data.ruta ?? null);
  $('tituloEstacionesRuta').textContent = data.ruta ? 'Gasolineras cerca del recorrido' : 'Gasolineras cerca de A o B';
  $('notaEstacionesRuta').textContent = data.ruta ? 'Hasta 2 km en línea recta de la carretera calculada. No confirma acceso desde la vía ni incluye desvíos.' : 'Hasta 20 km en línea recta de A o B. No confirma que estén sobre tu recorrido ni incluye desvíos.';
  if (!data.ruta) return;
  $('leyendaRuta').textContent = 'A = origen · B = destino · Azul = carretera de ida · Rojo = carretera de regreso.';
  $('tramosRuta').replaceChildren(...data.ruta.tramos.map(t => {
    const tarjeta = document.createElement('section'), titulo = document.createElement('h4'), p = document.createElement('p');
    tarjeta.className = `tramo-ruta ${t.sentido}`;
    titulo.textContent = t.sentido === 'ida' ? 'Ida · A → B' : 'Regreso · B → A';
    p.textContent = `${formato(t.kilometros)} km · ${formato(t.segundos / 60)} min estimados${t.relieve.ascensoM != null ? ` · ↑ ${formato(t.relieve.ascensoM)} m · ↓ ${formato(t.relieve.descensoM)} m${t.relieve.disponible ? '' : ' (datos parciales)'}` : ' · Sin elevación'}${t.peajes ? ' · Peajes' : ''}`;
    tarjeta.append(titulo, p);
    const perfil = t.relieve.perfil;
    if (perfil.length > 1) {
      const alturas = perfil.filter(v => v.alturaM != null).map(v => v.alturaM);
      if (alturas.length > 1) {
        const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 500 100'); svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', `Perfil de elevación del recorrido de ${t.sentido}. Datos del terreno, no medición de la carretera.`);
        const min = Math.min(...alturas), max = Math.max(...alturas), amplitud = Math.max(20, max - min);
        let segmento = [];
        function dibujar() {
          if (!segmento.length) return;
          const linea = document.createElementNS(ns, 'polyline'); linea.setAttribute('points', segmento.join(' '));
          linea.setAttribute('fill', 'none'); linea.setAttribute('stroke', t.sentido === 'ida' ? '#2676b6' : '#d71920'); linea.setAttribute('stroke-width', '3');
          svg.append(linea); segmento = [];
        }
        for (const muestra of perfil) {
          if (muestra.alturaM == null) { dibujar(); continue; }
          segmento.push(`${5 + 490 * muestra.km / t.kilometros},${90 - 80 * (muestra.alturaM - min) / amplitud}`);
        }
        dibujar(); tarjeta.append(svg);
        const leyenda = document.createElement('small'); leyenda.textContent = `Perfil de terreno muestreado · ${formato(min)}–${formato(max)} m sobre el nivel del mar · 0–${formato(t.kilometros)} km`; tarjeta.append(leyenda);
      }
    }
    return tarjeta;
  }));
  $('detalleTerreno').textContent = data.terreno.aplicado ? `Subidas: +${formato(data.litrosSubidas)} L sobre ${formato(data.litrosBase)} L base, antes del margen. Peso cargado: ${formato(data.masaKg)} kg; eficiencia supuesta: ${formato(data.eficiencia * 100)} %. Es un modelo orientativo de energía, aún sin calibrar con viajes en Guatemala.` : data.terreno.motivo === 'sin_elevacion_completa' ? 'No aplicamos el ajuste solicitado: faltan elevaciones. El presupuesto usa solamente tu consumo base y margen.' : 'Presupuesto basado en tu consumo, sin sumar subidas. Puedes activar el modelo de terreno si tu consumo base proviene de conducción en llano.';
  $('avisosCarretera').replaceChildren(...data.ruta.avisos.map(texto => { const li = document.createElement('li'); li.textContent = texto; return li; }));
  mapa?.centrar();
}
function mostrarResultado(data) {
  ultimoResultado = data;
  const electrico=data.combustible==='electricidad';
  const viajes = { ida: 'Solo ida · A → B', vuelta: 'Solo regreso · B → A', ida_vuelta: 'Ida y vuelta · A → B → A' };
  $('descripcionRuta').textContent = `${viajes[data.viaje]} · ${data.ruta ? `Carretera calculada con ${data.ruta.proveedor}. Duración: ${formato(data.ruta.segundos / 60)} min, sin tráfico en vivo.` : 'Kilómetros por carretera ingresados por ti.'}`;
  const metricas=[['Distancia total',`${formato(data.kilometros)} km`],...(electrico?[['Energía de batería',`${formato(data.kwh)} kWh`]]:[['Combustible',`${formato(data.galones)} gal`],['Equivalente en litros',`${formato(data.litros)} L`]]),['Costo estimado',data.costo==null?'Sin precio':dinero(data.costo)]];
  $('metricasRuta').replaceChildren(...metricas.map(([nombre, valor]) => {
    const grupo = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = nombre; dd.textContent = valor; grupo.append(dt, dd); return grupo;
  }));
  $('fuenteConsumo').textContent = `${nombreConsumo(data.consumo.fuente)}: ${formato(electrico?data.consumo.kwh100km:data.consumo.l100km)} ${electrico?'kWh':'L'}/100 km${data.consumo.vehiculo ? ` · ${data.consumo.vehiculo.alias}` : ''}.${data.consumo.fuente==='referencia_general' ? ' Referencia sin ciclo de ciudad o carretera; el consumo real puede variar.' : ''}`;
  if(data.consumo.supuestoGalon)$('fuenteConsumo').append(' Conversión con galón estadounidense supuesto (3.785 L); no confirmado por la fuente.');
  if(data.consumo.fuente==='modelo_teorico') {
    const p=data.consumo.parametrosTeoricos;
    const c=data.consumo.condiciones,cal=data.consumo.calibracion;
    $('fuenteConsumo').append(` ${data.consumo.aviso} Peso: ${formato(p.masaKg)} kg; techo: ${formato(p.velocidadKmh)} km/h; eficiencia: ${formato(p.eficienciaPct)} %; Cd × A: ${parametro(p.cda)} m²; rodadura: ${parametro(p.rodadura)}; auxiliares: ${parametro(p.auxiliaresKw)} kW. Paradas adicionales: ${parametro(c.paradasKm)}/km; detenido: ${formato(c.minutosRalenti)} min; temperatura: ${formato(c.temperaturaC)} °C; ralentí: ${parametro(p.ralentiLitrosHora)} L/h; recuperación: ${formato(p.regeneracionPct)} %.`);
    if(cal.estado==='referencia_usuario')$('fuenteConsumo').append(` Ajuste de la referencia: ×${parametro(cal.factor)} a partir de ${formato(cal.cantidadMedida)} ${cal.unidad} medidos en ${formato(cal.kilometros)} km. Solo para este cálculo.`);
    for(const t of data.consumo.modeloTeorico.tramos) {
      const detalle=document.createElement('p');detalle.textContent=`${t.sentido==='ida'?'Ida':'Regreso'}: ${formato(t.cantidad)} ${t.unidad}, antes del margen · ${t.relieveAplicado?'Pendientes del mapa':'Ascenso manual / llano supuesto'} · ${t.velocidadesMapa?'Velocidades del mapa limitadas por el techo':'Velocidad indicada'}.`;$('fuenteConsumo').append(detalle);
    }
    for(const aviso of data.consumo.modeloTeorico.avisos) {const p=document.createElement('p');p.textContent=aviso;$('fuenteConsumo').append(p);}
  }
  if (data.consumo.referenciaGeneral?.urlFuente?.startsWith('https:')) {
    const fuente=document.createElement('a'); fuente.href=data.consumo.referenciaGeneral.urlFuente; fuente.target='_blank'; fuente.rel='noopener noreferrer'; fuente.textContent=' Fuente ↗';
    $('fuenteConsumo').append(fuente);
  }
  $('fuentePrecio').textContent = electrico ? data.precio.precioKwh==null?'Sin tarifa: calculamos kWh de batería, sin inventar costo.':`Tarifa indicada: ${dinero(data.precio.precioKwh)}/kWh de batería. No incluye pérdidas del cargador.` : data.precio.precioGalon == null ? 'No hay un precio disponible. El combustible se puede estimar; el costo necesita un precio.' : data.precio.fuente === 'manual' ? `Precio indicado por ti: ${dinero(data.precio.precioGalon)} por galón.` : `Precio usado: ${dinero(data.precio.precioGalon)} por galón · ${data.precio.fuente === 'gasolinera' ? 'Gasolinera seleccionada' : `Promedio de ${data.precio.estaciones} ${data.precio.estaciones === 1 ? 'gasolinera' : 'gasolineras'} ${data.ruta ? 'cerca del recorrido' : 'cerca de A o B'}`}. Rango: ${dinero(data.precio.minimo)}–${dinero(data.precio.maximo)}.`;
  $('detalleMargen').textContent = `Margen adicional elegido: ${formato(data.margen)} %. Cálculo realizado el ${new Date(data.calculadoEn).toLocaleString('es-GT', { timeZone: 'America/Guatemala' })}.`;
  $('resultadoSimulacion').hidden = !data.simulacion;
  if (data.simulacion) {
    const s = data.simulacion, p = s.parametros;
    const referencia = { combinado: 'combinado 55 % ciudad / 45 % carretera', carretera: 'carretera HWFET', constante: `llano a ${formato(p.velocidadReferencia)} km/h` };
    $('detalleSimulacion').textContent = `${s.motor} · ${formato(s.litros / data.kilometros * 100)} L/100 km para este escenario, antes del margen. Referencia de consumo: ${referencia[p.referencia]}. Peso de referencia: ${formato(p.masaKg)} kg + ${formato(p.cargaExtraKg)} kg extra · Potencia: ${formato(p.potenciaKw)} kW · Cd × A: ${parametro(p.cda)} m² · Rodadura: ${parametro(p.rodadura)}. Techo: ${formato(p.velocidadMaxima)} km/h. Paradas adicionales con motor: ${formato(p.minutosMotorEncendido)} min (${formato(s.litrosParadas)} L).`;
    $('tramosSimulacion').replaceChildren(...s.tramos.map(t => {
      const nodo = document.createElement('p');
      nodo.textContent = `${t.sentido === 'ida' ? 'Ida' : 'Regreso'}: ${formato(t.litros)} L · Media simulada: ${formato(t.velocidadMedia)} km/h · ${formato(t.segundosSimulados / 60)} min · ${t.relieveAplicado ? 'Con pendientes del terreno' : 'Terreno llano'}.`;
      return nodo;
    }));
    $('avisosSimulacion').replaceChildren(...s.avisos.map(a => { const li = document.createElement('li'); li.textContent = a; return li; }));
  }
  mostrarCarretera(data);
  if(data.consumo.fuente==='modelo_teorico')$('detalleTerreno').textContent='El modelo del recorrido ya incorpora las pendientes disponibles. No se suma el ajuste por subidas otra vez. Revisa los avisos de cobertura de cada tramo.';
  if (data.simulacion) $('detalleTerreno').textContent = 'El presupuesto procede de la simulación completa. No se suma de nuevo el consumo base ni el antiguo ajuste por subidas. La duración del mapa y la duración del escenario pueden diferir.';
  $('navegarIda').hidden = data.viaje === 'vuelta'; $('navegarIda').href = enlaceNavegacion(data.origen, data.destino);
  $('navegarVuelta').hidden = data.viaje === 'ida'; $('navegarVuelta').href = enlaceNavegacion(data.destino, data.origen);
  $('resultadoRuta').hidden = false; $('panelEstacionesRuta').hidden = electrico;if(!electrico)mostrarEstaciones();
  $('tituloResultado').focus({ preventScroll: true }); $('resultadoRuta').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$('buscarEstacionRuta').addEventListener('input', mostrarEstaciones);
$('formRuta').addEventListener('submit', async evento => {
  evento.preventDefault(); if (calculando || localizando || !consumoListo) return;
  invalidar(); calculando = true; $('calcularRuta').disabled = true; $('camposRuta').disabled = true;
  $('marcarOrigen').disabled = true; $('marcarDestino').disabled = true;
  $('calcularRuta').textContent = 'Calculando viaje…'; estado('Consultando precios y calculando tu presupuesto…');
  const vehiculoId = $('vehiculoRuta').value;
  const datos = { ...puntos(), viaje: $('viajeRuta').value, distanciaModo: $('distanciaModo').value, tipoVehiculo: $('tipoVehiculoRuta').value,
    modeloConsumo: $('modeloConsumoRuta').value,
    estimacionTeorica:{propulsion:$('propulsionTeorica').value,masaKg:$('pesoTeorico').value,velocidadKmh:$('velocidadTeorica').value,eficienciaPct:$('eficienciaTeorica').value,cda:$('cdaTeorico').value,rodadura:$('rodaduraTeorica').value,auxiliaresKw:$('auxiliaresTeoricos').value,
      ralentiLitrosHora:$('combustibleRuta').value==='electricidad'?0:$('ralentiTeorico').value,regeneracionPct:$('propulsionTeorica').value==='combustion'?0:$('regeneracionTeorica').value,
      condiciones:{paradasKm:$('paradasTeoricas').value,minutosRalenti:$('minutosTeoricos').value,temperaturaC:$('temperaturaTeorica').value,altitudM:$('altitudTeorica').value,ascensoIdaM:$('ascensoTeoricoIda').value,ascensoVueltaM:$('ascensoTeoricoVuelta').value},
      ...($('calibrarTeorico').checked?{calibracion:{kilometros:$('kmCalibracion').value,cantidad:$('cantidadCalibracion').value,velocidadKmh:$('velocidadCalibracion').value,
        condiciones:{paradasKm:$('paradasCalibracion').value,minutosRalenti:$('minutosCalibracion').value,ascensoIdaM:$('ascensoCalibracion').value,altitudM:$('altitudCalibracion').value,temperaturaC:$('temperaturaCalibracion').value}}}:{})},
    simulacion: { masaKg: $('pesoSimulacion').value, cargaExtraKg: $('cargaSimulacion').value, potenciaKw: $('potenciaSimulacion').value, cda: $('cdaSimulacion').value,
      rodadura: $('rodaduraSimulacion').value, referencia: $('referenciaSimulacion').value, velocidadReferencia: $('velocidadReferencia').value,
      velocidadMaxima: $('velocidadMaximaRuta').value, minutosMotorEncendido: $('paradasSimulacion').value, incluirRelieve: $('relieveSimulacion').checked },
    ajustarSubidas: $('ajustarSubidas').checked, masaKg: $('masaRuta').value, eficienciaPct: $('eficienciaRuta').value,
    kmIda: $('kmIda').value, kmVuelta: $('kmVuelta').value,
    combustible: $('combustibleRuta').value, modalidad: $('modalidadRuta').value, margen: $('margenRuta').value,
    ...(vehiculoId ? { vehiculoId } : { consumoManual: $('consumoManual').value }),
    ...($('precioManualRuta').value ? { precioManual: $('precioManualRuta').value } : {}) };
  try {
    const data = await pedir(vehiculoId ? '/rutas/estimar' : '/publico/rutas/estimar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos), signal: AbortSignal.timeout(45000) });
    mostrarResultado(data); estado('Presupuesto calculado.');
  } catch (e) { estado(mensajeError(e), true); }
  finally {
    calculando = false; $('calcularRuta').disabled = false; $('camposRuta').disabled = false;
    $('marcarOrigen').disabled = false; $('marcarDestino').disabled = false; $('calcularRuta').textContent = 'Calcular mi viaje →';
  }
});

async function cargarGaraje() {
  try {
    const sesion = await consultarSesion();
    if (sesion?.rol !== 'conductor' || sesion.debeCambiarContrasena) {
      const p = $('estadoGarajeRuta'); p.replaceChildren('Calcula con consumo manual. Para usar tu garaje, ');
      const a = document.createElement('a'); a.href = '/mi-automovil.html'; a.textContent = 'entra a MiAutomóvil'; p.append(a, '.'); return;
    }
    const vehiculos = await pedir('/mi-automovil/vehiculos');
    for (const v of vehiculos) $('vehiculoRuta').add(new Option(`${v.alias} · ${v.ficha.marca} ${v.ficha.modelo}`, v.id));
    $('estadoGarajeRuta').textContent = `Garaje de ${sesion.nombre}. Primero usamos tu consumo medido; si falta, la referencia del catálogo. También puedes estimar con los parámetros del vehículo; para eléctricos usamos kWh.`;
    const elegido = new URLSearchParams(location.search).get('vehiculo');
    if (elegido && [...$('vehiculoRuta').options].some(o => o.value === elegido)) { $('vehiculoRuta').value = elegido; $('vehiculoRuta').dispatchEvent(new Event('change', { bubbles: true })); }
  } catch (e) { $('estadoGarajeRuta').textContent = `${mensajeError(e)} Puedes continuar con consumo manual.`; }
}
async function cargarEstaciones() {
  try {
    const respuesta = await solicitarApi('/publico/gasolineras'); if (!respuesta.ok) return;
    const datos = await respuesta.json(); estacionesMapa = datos.data;
    for (const e of estacionesMapa) lugares.set(`estacion-${e.codigo}`, { nombre: `${e.nombre} · ${e.municipio}`, ...e.ubicacion });
    llenarLugares(); mapa?.estaciones(estacionesMapa);
  } catch { /* El cálculo consulta los precios de nuevo en el servidor. */ }
}
async function cargarMapa() {
  try {
    const modulo = await import('./rutas-mapa.js'); mapa = await modulo.iniciarMapaRutas(marcar);
    actualizarMapa(); if (ultimoResultado?.ruta) mapa.recorrido(ultimoResultado.ruta); mapa.centrar(); if (estacionesMapa.length) mapa.estaciones(estacionesMapa);
    $('estadoMapaRuta').textContent = 'Toca el mapa para marcar el destino B. Puedes cambiar a origen A o elegir una ciudad.';
  } catch {
    $('estadoMapaRuta').textContent = 'Mapa no disponible. Puedes calcular el viaje eligiendo ciudades o escribiendo coordenadas.';
    $('centrarRuta').disabled = true; $('marcarOrigen').disabled = true; $('marcarDestino').disabled = true;
  }
}
void cargarGaraje(); void cargarEstaciones(); void cargarMapa();
