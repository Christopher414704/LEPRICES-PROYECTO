import {
  ArcGisMapServerImageryProvider, Cartesian2, Cartesian3, Color,
  CustomDataSource, DistanceDisplayCondition, HeadingPitchRange, ImageryLayer, LabelStyle,
  NearFarScalar, Rectangle, ScreenSpaceEventHandler, ScreenSpaceEventType,
  VerticalOrigin, Viewer,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import "./style.css";
import { crearTableroPrecios } from "./tablero-precios.js";

const urlApi = (import.meta.env.VITE_API_URL ?? "/api").replace(/\/$/, "");
const esPublico = true;
const estado = document.querySelector("#estadoMapa");
const panel = document.querySelector("#tableroPrecios");
const fichas = new Map();
const imagenUbicacion = `${import.meta.env.BASE_URL}images/ubicacion.png`;
const visor = new Viewer("cesiumContainer", {
  baseLayer: false, baseLayerPicker: false, animation: false, timeline: false,
  geocoder: false, homeButton: false, sceneModePicker: false,
  navigationHelpButton: false, fullscreenButton: false,
  infoBox: false, selectionIndicator: false,
  requestRenderMode: true, maximumRenderTimeChange: Number.POSITIVE_INFINITY,
  shadows: false, msaaSamples: 1,
});
visor.scene.globe.enableLighting = false;
visor.scene.globe.baseColor = Color.fromCssColorString("#07111f");
visor.scene.fog.enabled = false;
visor.scene.skyAtmosphere.show = false;
visor.scene.screenSpaceCameraController.minimumZoomDistance = 100;
visor.scene.screenSpaceCameraController.maximumZoomDistance = 2500000;
visor.scene.screenSpaceCameraController.enableTilt = false;
visor.scene.screenSpaceCameraController.enableLook = false;
visor.camera.setView({ destination: Rectangle.fromDegrees(-90.008, 14.607, -89.958, 14.663) });

// Un único PNG compartido por todos los marcadores, sin modelos GLB.
const estaciones = new CustomDataSource("gasolineras");
await visor.dataSources.add(estaciones);
estaciones.clustering.enabled = true;
estaciones.clustering.pixelRange = 22;
estaciones.clustering.minimumClusterSize = 3;
const imagenesGrupos = new Map();
estaciones.clustering.clusterEvent.addEventListener((entidades, grupo) => {
  const cantidad = entidades.length;
  if (!imagenesGrupos.has(cantidad)) {
    const imagen = document.createElement("canvas");
    imagen.width = imagen.height = 96;
    const dibujo = imagen.getContext("2d");
    dibujo.beginPath();
    dibujo.arc(48, 48, 43, 0, 2 * Math.PI);
    dibujo.fillStyle = "#d71920";
    dibujo.fill();
    dibujo.strokeStyle = "white";
    dibujo.lineWidth = 4;
    dibujo.stroke();
    dibujo.fillStyle = "white";
    dibujo.font = "bold 34px sans-serif";
    dibujo.textAlign = "center";
    dibujo.textBaseline = "middle";
    dibujo.fillText(String(cantidad), 48, 49);
    imagenesGrupos.set(cantidad, imagen);
  }
  // Número y fondo en la misma imagen para evitar solapamientos de profundidad.
  grupo.label.show = false;
  grupo.point.show = false;
  grupo.billboard.show = true;
  grupo.billboard.image = imagenesGrupos.get(cantidad);
  grupo.billboard.width = grupo.billboard.height = 46;
  grupo.billboard.verticalOrigin = VerticalOrigin.CENTER;
  grupo.billboard.disableDepthTestDistance = Number.POSITIVE_INFINITY;
  grupo.billboard.id = entidades;
});

let seleccionada = null;
let fijada = false;
let cierrePendiente;
const tablero = crearTableroPrecios(panel, ocultarTablero);

function ocultarTablero() {
  clearTimeout(cierrePendiente);
  if (seleccionada) seleccionada.billboard.scale = 1;
  seleccionada = null;
  fijada = false;
  tablero.ocultar();
  visor.scene.canvas.style.cursor = "default";
  visor.scene.requestRender();
}

function posicionDeEntidad(entidad) {
  const punto = visor.scene.cartesianToCanvasCoordinates(entidad.position.getValue(visor.clock.currentTime));
  if (!punto) return null;
  const limites = visor.scene.canvas.getBoundingClientRect();
  return { x: punto.x + limites.left, y: punto.y + limites.top };
}

function mostrarTablero(entidad, fijar = false) {
  clearTimeout(cierrePendiente);
  const punto = posicionDeEntidad(entidad);
  if (!punto) return;
  if (seleccionada !== entidad) {
    if (seleccionada) seleccionada.billboard.scale = 1;
    seleccionada = entidad;
    seleccionada.billboard.scale = 1.12;
    visor.scene.requestRender();
  }
  fijada = fijar;
  tablero.mostrar(fichas.get(entidad.id), punto);
  visor.scene.canvas.style.cursor = "pointer";
}

function programarCierre() {
  if (fijada || !seleccionada) return;
  clearTimeout(cierrePendiente);
  cierrePendiente = setTimeout(ocultarTablero, 180);
}

function seleccionar(punto) { return visor.scene.pick(punto)?.id; }

// Solo un pick por cuadro, y solo con ratón/lápiz. El toque se maneja como clic.
let movimientoPendiente;
let cuadroPendiente = null;
visor.scene.canvas.addEventListener("pointermove", (evento) => {
  if (evento.pointerType === "touch" || fijada || evento.buttons) return;
  const limites = visor.scene.canvas.getBoundingClientRect();
  movimientoPendiente = new Cartesian2(evento.clientX - limites.left, evento.clientY - limites.top);
  if (cuadroPendiente !== null) return;
  cuadroPendiente = requestAnimationFrame(() => {
    cuadroPendiente = null;
    if (fijada) return;
    const entidad = seleccionar(movimientoPendiente);
    if (entidad && fichas.has(entidad.id)) mostrarTablero(entidad);
    else {
      visor.scene.canvas.style.cursor = Array.isArray(entidad) ? "pointer" : "default";
      programarCierre();
    }
  });
});
visor.scene.canvas.addEventListener("pointerleave", () => {
  if (cuadroPendiente !== null) cancelAnimationFrame(cuadroPendiente);
  cuadroPendiente = null;
  programarCierre();
});
panel.addEventListener("pointerenter", () => clearTimeout(cierrePendiente));
panel.addEventListener("pointerleave", programarCierre);
panel.addEventListener("focusin", () => { clearTimeout(cierrePendiente); fijada = true; });

const eventos = new ScreenSpaceEventHandler(visor.scene.canvas);
eventos.setInputAction(({ position }) => {
  const entidad = seleccionar(position);
  if (Array.isArray(entidad)) {
    ocultarTablero();
    visor.flyTo(entidad, {
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : .6,
      offset: new HeadingPitchRange(0, -Math.PI / 2, 0),
    });
  } else if (entidad && fichas.has(entidad.id)) {
    if (seleccionada === entidad && fijada) ocultarTablero();
    else mostrarTablero(entidad, true);
  } else ocultarTablero();
}, ScreenSpaceEventType.LEFT_CLICK);
document.addEventListener("keydown", (evento) => {
  if (evento.key === "Escape") ocultarTablero();
});
visor.camera.moveStart.addEventListener(ocultarTablero);
window.addEventListener("resize", ocultarTablero);

// Lista permanente con búsqueda por nombre, también sin tildes o mayúsculas.
const lista = document.querySelector("#resultadosGasolineras");
const buscador = document.querySelector("#buscarGasolinera");
const contador = document.querySelector("#cantidadGasolineras");
const sinResultados = document.querySelector("#sinGasolineras");
const contenidoLista = document.querySelector("#contenidoGasolineras");
const botonPlegar = document.querySelector("#plegarGasolineras");
const vistaMovil = window.matchMedia("(max-width: 700px)");
const elementosLista = [];
const normalizar = (texto) => texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();

function filtrarGasolineras() {
  const palabras = normalizar(buscador.value).split(/\s+/).filter(Boolean);
  let cantidad = 0;
  for (const { nodo, nombre } of elementosLista) {
    nodo.hidden = !palabras.every((palabra) => nombre.includes(palabra));
    if (!nodo.hidden) cantidad++;
  }
  contador.textContent = `${cantidad} de ${elementosLista.length} gasolineras`;
  sinResultados.hidden = cantidad > 0;
}

function plegarLista(plegada) {
  contenidoLista.hidden = plegada;
  botonPlegar.setAttribute("aria-expanded", String(!plegada));
  botonPlegar.setAttribute("aria-label", `${plegada ? "Expandir" : "Contraer"} lista de gasolineras`);
  botonPlegar.textContent = plegada ? "+" : "−";
}
botonPlegar.addEventListener("click", () => plegarLista(!contenidoLista.hidden));
vistaMovil.addEventListener("change", () => plegarLista(false));
if (esPublico && vistaMovil.matches) plegarLista(true);
buscador.addEventListener("input", () => {
  filtrarGasolineras();
  if (esPublico) {
    clearTimeout(temporizadorMapa);
    temporizadorMapa = setTimeout(cargarPrecios, 280);
  }
});
document.querySelector("#verMapa").addEventListener("click", () => {
  ocultarTablero();
  if (vistaMovil.matches) plegarLista(true);
  for (const { boton } of elementosLista) boton.setAttribute("aria-pressed", "false");
  visor.camera.flyTo({
    destination: limitesRegionSeleccionada(),
    duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : .6,
  });
});

function agregarEstaciones(publicadas) {
  estaciones.entities.suspendEvents();
  const vigentes = new Set();
  lista.replaceChildren();
  elementosLista.length = 0;
  for (const estacion of publicadas) {
    if (!Number.isFinite(Number(estacion.ubicacion?.latitud)) || !Number.isFinite(Number(estacion.ubicacion?.longitud))) continue;
    const id = `gasolinera-${estacion.codigo}`;
    vigentes.add(id);
    let entidad = estaciones.entities.getById(id);
    if (!entidad) entidad = estaciones.entities.add({
      id, name: estacion.nombre,
      position: Cartesian3.fromDegrees(estacion.ubicacion.longitud, estacion.ubicacion.latitud),
      billboard: {
        image: imagenUbicacion, width: 64, height: 64,
        verticalOrigin: VerticalOrigin.BOTTOM,
        scaleByDistance: new NearFarScalar(1500, 1, 40000, .65),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: estacion.nombre.replace(/^Gasolinera /, ""),
        font: "600 13px sans-serif", fillColor: Color.WHITE,
        outlineColor: Color.BLACK, outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cartesian2(0, -68),
        distanceDisplayCondition: new DistanceDisplayCondition(0, 2500),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    fichas.set(id, estacion);
    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = "estacion-menu";
    boton.setAttribute("aria-pressed", "false");
    const icono = document.createElement("img");
    icono.src = `${import.meta.env.BASE_URL}images/gasolinera.png`;
    icono.alt = "";
    icono.width = icono.height = 56;
    const texto = document.createElement("span");
    const nombre = document.createElement("strong");
    nombre.textContent = estacion.nombre.replace(/^Gasolinera /, "");
    const indicacion = document.createElement("small");
    indicacion.textContent = "Ver ubicación y precios";
    texto.append(nombre, indicacion);
    const flecha = document.createElement("span");
    flecha.className = "flecha-estacion";
    flecha.textContent = "›";
    flecha.setAttribute("aria-hidden", "true");
    boton.append(icono, texto, flecha);
    boton.addEventListener("click", () => {
      for (const elemento of elementosLista) elemento.boton.setAttribute("aria-pressed", String(elemento.boton === boton));
      if (vistaMovil.matches) plegarLista(true);
      visor.camera.flyTo({
        destination: Cartesian3.fromDegrees(estacion.ubicacion.longitud, estacion.ubicacion.latitud, 1800),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : .5,
        complete: () => { mostrarTablero(entidad, true); panel.querySelector("button")?.focus(); },
      });
    });
    const nodo = document.createElement("li");
    nodo.append(boton);
    lista.append(nodo);
    elementosLista.push({ nodo, boton, indicacion, estacion, nombre: normalizar(estacion.nombre) });
  }
  for (const entidad of [...estaciones.entities.values]) {
    if (!vigentes.has(entidad.id)) {
      if (seleccionada === entidad) ocultarTablero();
      estaciones.entities.remove(entidad);
      fichas.delete(entidad.id);
    }
  }
  filtrarGasolineras();
  estaciones.entities.resumeEvents();
  visor.scene.requestRender();
}

async function cargarMapaSatelital() {
  try {
    const proveedor = await ArcGisMapServerImageryProvider.fromUrl(
      "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
      { enablePickFeatures: false },
    );
    visor.imageryLayers.add(new ImageryLayer(proveedor), 0);
    visor.scene.requestRender();
  } catch (error) {
    console.error("No fue posible cargar el mapa satelital:", error);
    estado.textContent = "No fue posible cargar el mapa satelital.";
    estado.classList.add("estado--error");
  }
}

const seleccionDepartamento = document.querySelector("#seleccionarDepartamento");
const seleccionMunicipio = document.querySelector("#seleccionarMunicipio");
let regiones = [];
let solicitudMapa;
let temporizadorMapa;
let consultaActual = "";

function limitesRegionSeleccionada() {
  const filtradas = regiones.filter((r) => (!seleccionDepartamento?.value || r.departamento === seleccionDepartamento.value) &&
    (!seleccionMunicipio?.value || r.municipio === seleccionMunicipio.value));
  if (!filtradas.length) return Rectangle.fromDegrees(-90.008, 14.607, -89.958, 14.663);
  const [oeste, sur, este, norte] = [Math.min(...filtradas.map((r) => r.limites[0])),
    Math.min(...filtradas.map((r) => r.limites[1])), Math.max(...filtradas.map((r) => r.limites[2])),
    Math.max(...filtradas.map((r) => r.limites[3]))];
  const margen = Math.max(.025, Math.max(este - oeste, norte - sur) * .22);
  return Rectangle.fromDegrees(oeste - margen, sur - margen, este + margen, norte + margen);
}

function areaVisible() {
  const rectangulo = visor.camera.computeViewRectangle();
  if (!rectangulo) return null;
  const factor = 180 / Math.PI;
  const valores = [rectangulo.west, rectangulo.south, rectangulo.east, rectangulo.north].map((r) => r * factor);
  const margenX = Math.max(.005, (valores[2] - valores[0]) * .15);
  const margenY = Math.max(.005, (valores[3] - valores[1]) * .15);
  return [Math.max(-180, valores[0] - margenX), Math.max(-90, valores[1] - margenY),
    Math.min(180, valores[2] + margenX), Math.min(90, valores[3] + margenY)].map((v) => Number(v.toFixed(4)));
}

function regionRequiereArea() {
  if (!seleccionDepartamento?.value) return true;
  const cantidad = regiones.filter((r) => r.departamento === seleccionDepartamento.value &&
    (!seleccionMunicipio?.value || r.municipio === seleccionMunicipio.value))
    .reduce((suma, r) => suma + r.cantidad, 0);
  return cantidad > 300;
}

async function cargarRegiones() {
  try {
    const respuesta = await fetch(`${urlApi}/publico/regiones`, { credentials: "omit" });
    if (!respuesta.ok) return;
    regiones = (await respuesta.json()).data.filter((r) => r.limites?.every(Number.isFinite));
    for (const departamento of [...new Set(regiones.map((r) => r.departamento))]) {
      const opcion = document.createElement("option");
      opcion.value = opcion.textContent = departamento;
      seleccionDepartamento.append(opcion);
    }
    if (regiones.some((r) => r.departamento === "Jalapa")) seleccionDepartamento.value = "Jalapa";
    actualizarMunicipios();
  } catch (error) { console.error("No fue posible cargar regiones:", error); }
}

function actualizarMunicipios() {
  if (!seleccionMunicipio) return;
  seleccionMunicipio.replaceChildren(new Option("Todos los municipios", ""));
  for (const municipio of [...new Set(regiones.filter((r) => !seleccionDepartamento.value || r.departamento === seleccionDepartamento.value).map((r) => r.municipio))]) {
    seleccionMunicipio.append(new Option(municipio, municipio));
  }
}

if (esPublico) {
  seleccionDepartamento.addEventListener("change", () => {
    actualizarMunicipios();
    visor.camera.flyTo({ destination: limitesRegionSeleccionada(), duration: .5 });
    cargarPrecios();
  });
  seleccionMunicipio.addEventListener("change", () => {
    visor.camera.flyTo({ destination: limitesRegionSeleccionada(), duration: .5 });
    cargarPrecios();
  });
  visor.camera.moveEnd.addEventListener(() => {
    clearTimeout(temporizadorMapa);
    temporizadorMapa = setTimeout(cargarPrecios, 250);
  });
}

async function cargarPrecios() {
  try {
    const parametros = new URLSearchParams();
    if (esPublico) {
      const bbox = areaVisible();
      const busqueda = normalizar(buscador.value);
      if (busqueda.length >= 2 && busqueda.length <= 100) parametros.set("buscar", busqueda);
      else if (regionRequiereArea() && bbox && bbox[0] < bbox[2]) parametros.set("bbox", bbox.join(","));
      if (seleccionDepartamento.value) parametros.set("departamento", seleccionDepartamento.value);
      if (seleccionMunicipio.value) parametros.set("municipio", seleccionMunicipio.value);
    }
    const consulta = parametros.toString();
    if (esPublico && consulta === consultaActual) return;
    solicitudMapa?.abort();
    solicitudMapa = new AbortController();
    const respuesta = await fetch(`${urlApi}/publico/gasolineras?${consulta}`, {
      credentials: "omit", signal: solicitudMapa.signal,
    });
    if (!respuesta.ok) throw new Error(`La API respondió con estado ${respuesta.status}.`);
    const resultado = await respuesta.json();
    if (!Array.isArray(resultado.data)) throw new Error("La API no devolvió una lista de gasolineras.");
    consultaActual = consulta;
    agregarEstaciones(resultado.data);
    if (resultado.hayMas) {
      estado.textContent = "Hay más estaciones en esta región. Acerca el mapa o elige un municipio para verlas todas.";
      estado.classList.add("estado--informacion");
    }
    if (seleccionada) mostrarTablero(seleccionada, fijada);
  } catch (error) {
    if (error.name === "AbortError") return;
    console.error(error);
    estado.textContent = "No fue posible consultar las gasolineras y sus precios. Recarga la página para intentar de nuevo.";
    estado.classList.add("estado--error");
  }
}

await Promise.allSettled([cargarMapaSatelital(), (async () => {
  if (esPublico) await cargarRegiones();
  await cargarPrecios();
})()]);
if (esPublico) {
  const codigoEnlace = new URLSearchParams(window.location.search).get("gasolinera");
  if (codigoEnlace && /^[\w-]{1,100}$/.test(codigoEnlace)) {
    try {
      const respuesta = await fetch(`${urlApi}/publico/gasolineras?codigo=${encodeURIComponent(codigoEnlace)}`, { credentials: "omit" });
      const ficha = (await respuesta.json()).data?.[0];
      if (ficha) {
        seleccionDepartamento.value = ficha.departamento;
        actualizarMunicipios();
        seleccionMunicipio.value = "";
        let entidad = estaciones.entities.getById(`gasolinera-${ficha.codigo}`);
        if (!entidad) {
          agregarEstaciones([ficha]);
          entidad = estaciones.entities.getById(`gasolinera-${ficha.codigo}`);
        }
        consultaActual = "";
        visor.camera.flyTo({ destination: Cartesian3.fromDegrees(ficha.ubicacion.longitud, ficha.ubicacion.latitud, 1800),
          duration: .5, complete: () => { mostrarTablero(entidad, true); cargarPrecios(); } });
      }
    } catch (error) { console.error("No fue posible abrir la gasolinera enlazada:", error); }
  }
}
