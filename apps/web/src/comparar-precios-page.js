import { urlApi } from "./auth.js";
import {
  compararPrecios,
  municipiosDisponibles,
  opcionesComparacion,
} from "./comparador-precios.js";

const formulario = document.querySelector("#filtrosComparacion");
const combustible = document.querySelector("#combustible");
const modalidad = document.querySelector("#modalidad");
const departamento = document.querySelector("#departamento");
const municipio = document.querySelector("#municipio");
const buscar = document.querySelector("#buscar");
const cuerpo = document.querySelector("#resultadosComparacion");
const resumen = document.querySelector("#resumenComparacion");
const vacio = document.querySelector("#sinResultados");
const mensaje = document.querySelector("#mensaje");
const tabla = document.querySelector("#tablaComparacion");
const reintentar = document.querySelector("#reintentar");
let gasolineras = [];

const formatoPrecio = new Intl.NumberFormat("es-GT", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const formatoFecha = new Intl.DateTimeFormat("es-GT", {
  dateStyle: "medium",
  timeStyle: "short",
});

function opcion(valor, etiqueta) {
  const nodo = document.createElement("option");
  nodo.value = valor;
  nodo.textContent = etiqueta;
  return nodo;
}

function llenarSelect(select, opciones, valorAnterior) {
  select.replaceChildren(...opciones.map(({ codigo, nombre }) => opcion(codigo, nombre)));
  if (opciones.some(({ codigo }) => codigo === valorAnterior)) select.value = valorAnterior;
}

function actualizarMunicipios() {
  const anterior = municipio.value;
  municipio.replaceChildren(opcion("", "Todos los municipios"));
  for (const nombre of municipiosDisponibles(gasolineras, departamento.value)) {
    municipio.append(opcion(nombre, nombre));
  }
  if ([...municipio.options].some((item) => item.value === anterior)) municipio.value = anterior;
}

function celda(texto, clase = "") {
  const nodo = document.createElement("td");
  nodo.textContent = texto;
  if (clase) nodo.className = clase;
  return nodo;
}

function renderizar() {
  const resultados = compararPrecios(gasolineras, {
    combustible: combustible.value,
    modalidad: modalidad.value,
    departamento: departamento.value,
    municipio: municipio.value,
    buscar: buscar.value,
  });
  cuerpo.replaceChildren();

  for (const { gasolinera, precio, esMasBarata } of resultados) {
    const fila = document.createElement("tr");
    if (esMasBarata) fila.className = "resultado-mejor";
    const estacion = celda("");
    const nombre = document.createElement("strong");
    nombre.textContent = gasolinera.nombre;
    estacion.append(nombre);
    if (esMasBarata) {
      const insignia = document.createElement("span");
      insignia.className = "insignia-mejor";
      insignia.textContent = "Precio más bajo";
      estacion.append(insignia);
    }
    const ubicacion = celda([gasolinera.municipio, gasolinera.departamento].filter(Boolean).join(", "));
    const valor = celda(`${precio.moneda || "GTQ"} ${formatoPrecio.format(precio.precio)}`, "valor-precio");
    const unidad = document.createElement("small");
    unidad.textContent = precio.unidadMedida ? ` por ${precio.unidadMedida}` : "";
    valor.append(unidad);
    const fechaValida = Number.isFinite(new Date(precio.vigenteDesde).getTime());
    const actualizacion = celda(fechaValida ? formatoFecha.format(new Date(precio.vigenteDesde)) : "Sin fecha");
    const accion = celda("");
    const enlace = document.createElement("a");
    enlace.className = "enlace-mapa";
    enlace.href = `/publico.html?gasolinera=${encodeURIComponent(gasolinera.codigo)}`;
    enlace.textContent = "Ver en mapa";
    accion.append(enlace);
    fila.append(estacion, ubicacion, valor, actualizacion, accion);
    cuerpo.append(fila);
  }

  tabla.hidden = resultados.length === 0;
  vacio.hidden = resultados.length !== 0;
  resumen.textContent = resultados.length
    ? `${resultados.length} ${resultados.length === 1 ? "gasolinera encontrada" : "gasolineras comparadas"}, ordenadas de menor a mayor precio.`
    : "No hay precios vigentes para los filtros seleccionados.";
}

async function cargar() {
  reintentar.hidden = true;
  mensaje.hidden = false;
  mensaje.classList.remove("error");
  mensaje.textContent = "Cargando precios vigentes…";
  try {
    const respuesta = await fetch(`${urlApi}/publico/gasolineras`, {
      credentials: "omit",
      cache: "no-cache",
      signal: AbortSignal.timeout(15000),
    });
    if (!respuesta.ok) throw new Error(`La API respondió con estado ${respuesta.status}.`);
    const resultado = await respuesta.json();
    if (!Array.isArray(resultado.data)) throw new Error("La API no devolvió el catálogo esperado.");
    gasolineras = resultado.data;
    const opciones = opcionesComparacion(gasolineras);
    llenarSelect(combustible, opciones.combustibles, combustible.value);
    llenarSelect(modalidad, opciones.modalidades, modalidad.value);
    departamento.replaceChildren(opcion("", "Todos los departamentos"));
    for (const nombre of [...new Set(gasolineras.map((item) => item.departamento).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }))) {
      departamento.append(opcion(nombre, nombre));
    }
    actualizarMunicipios();
    mensaje.hidden = true;
    if (!opciones.combustibles.length || !opciones.modalidades.length) {
      vacio.hidden = false;
      tabla.hidden = true;
      resumen.textContent = "Aún no hay precios vigentes para comparar.";
      return;
    }
    renderizar();
  } catch (error) {
    mensaje.textContent = `No fue posible cargar los precios. ${error.message}`;
    mensaje.classList.add("error");
    reintentar.hidden = false;
    tabla.hidden = true;
    vacio.hidden = true;
    resumen.textContent = "";
  }
}

formulario.addEventListener("input", renderizar);
departamento.addEventListener("change", () => {
  actualizarMunicipios();
  renderizar();
});
reintentar.addEventListener("click", cargar);
cargar();
