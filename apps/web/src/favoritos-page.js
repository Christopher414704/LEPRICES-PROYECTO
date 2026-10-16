import { apiAutenticada, consultarSesion, enviarFormulario, irAlLogin, mensajeError } from "./auth.js";
import { opcionesCombustible, describirPrecio } from "./favoritos.js";

const $ = (id) => document.getElementById(id);
const gasolinera = $("gasolineraFavorita");
const combustible = $("combustibleFavorito");
const guardar = $("guardarFavorito");
let estaciones = [];
let favoritos = [];
let listaCargada = false;
let ocupado = false;
let cerrando = false;
let primeraCarga = true;
let propietarioActual;

function elemento(etiqueta, clase, texto) {
  const nodo = document.createElement(etiqueta);
  nodo.className = clase;
  if (texto != null) nodo.textContent = texto;
  return nodo;
}

function mensaje(texto, error = false) {
  $("mensaje").textContent = texto;
  $("mensaje").classList.toggle("error", error);
  $("mensaje").hidden = false;
}

async function api(ruta = "", opciones) {
  const respuesta = await apiAutenticada(`/favoritos${ruta}`, opciones);
  const cuerpo = respuesta.status === 204 ? null : await respuesta.json();
  if (!respuesta.ok) throw Object.assign(new Error(cuerpo?.message ?? "No fue posible completar la solicitud."), { status: respuesta.status });
  return cuerpo;
}

function actualizarCombustibles() {
  const anterior = combustible.value;
  const opciones = opcionesCombustible(estaciones.find((e) => e.codigo === gasolinera.value), favoritos);
  combustible.replaceChildren(...opciones.map((c) => {
    const opcion = new Option(`${c.nombre}${c.guardado ? " · ya guardado" : ""}`, c.codigo);
    opcion.disabled = c.guardado;
    return opcion;
  }));
  const elegible = opciones.find((c) => c.codigo === anterior && !c.guardado) ?? opciones.find((c) => !c.guardado);
  if (!elegible) combustible.prepend(new Option(opciones.length ? "Todos los combustibles guardados" : "Sin combustibles disponibles", ""));
  combustible.value = elegible?.codigo ?? "";
  combustible.disabled = ocupado || !listaCargada || !elegible;
  guardar.disabled = combustible.disabled;
  gasolinera.disabled = ocupado || !estaciones.length;
  $("ayudaSeleccion").textContent = !listaCargada ? "Actualiza la lista para poder guardar favoritos."
    : !estaciones.length ? "No hay gasolineras con combustibles disponibles."
    : !elegible ? "Ya guardaste todos los combustibles de esta gasolinera." : "";
}

function mostrarFavoritos() {
  $("listaFavoritos").replaceChildren(...favoritos.map((favorito) => {
    const tarjeta = elemento("li", "favorito");
    tarjeta.append(elemento("p", "tipo-favorito", favorito.combustible.nombre),
      elemento("h3", "", favorito.gasolinera.nombre),
      elemento("p", "ayuda", [favorito.gasolinera.municipio, favorito.gasolinera.departamento].filter(Boolean).join(", ")));
    if (!favorito.disponible || !favorito.precios.length) {
      tarjeta.append(elemento("p", "vacio", favorito.disponible ? "Precios pendientes de actualización." : "Esta gasolinera o combustible no está disponible actualmente."));
    } else {
      const precios = elemento("ul", "precios-favorito");
      for (const precio of favorito.precios) {
        const fila = elemento("li", "");
        fila.append(elemento("span", "ayuda", `${precio.nombreCombustible} · ${precio.modalidad}`), elemento("strong", "", describirPrecio(precio)));
        const fecha = new Date(precio.vigenteDesde);
        if (!Number.isNaN(fecha.getTime())) fila.append(elemento("small", "", `Reportado: ${new Intl.DateTimeFormat("es-GT", { timeZone: "America/Guatemala", dateStyle: "medium", timeStyle: "short" }).format(fecha)} · Guatemala`));
        precios.append(fila);
      }
      tarjeta.append(precios);
    }
    const acciones = elemento("div", "acciones-favorito");
    if (favorito.disponible) {
      const enlace = elemento("a", "", "Ver en el mapa");
      enlace.href = `${import.meta.env.BASE_URL}publico.html?gasolinera=${encodeURIComponent(favorito.gasolinera.codigo)}`;
      acciones.append(enlace);
    }
    const quitar = elemento("button", "boton-secundario", "Eliminar favorito");
    quitar.type = "button";
    quitar.disabled = ocupado;
    quitar.setAttribute("aria-label", `Eliminar ${favorito.combustible.nombre} de ${favorito.gasolinera.nombre} de favoritos`);
    quitar.addEventListener("click", () => eliminar(favorito));
    acciones.append(quitar);
    tarjeta.append(acciones);
    return tarjeta;
  }));
  $("estadoFavoritos").hidden = favoritos.length > 0;
  $("estadoFavoritos").textContent = "Aún no tienes favoritos. Selecciona una gasolinera y un combustible para guardar el primero.";
}

function bloquear(valor) {
  ocupado = valor;
  $("actualizarFavoritos").disabled = valor;
  $("formFavorito").setAttribute("aria-busy", String(valor));
  actualizarCombustibles();
  for (const boton of $("listaFavoritos").querySelectorAll("button")) boton.disabled = valor;
}

async function cargar() {
  if (ocupado || cerrando) return;
  bloquear(true);
  try {
    const sesion = await consultarSesion();
    if (!sesion) return irAlLogin();
    if (propietarioActual !== sesion.id) {
      propietarioActual = sesion.id;
      favoritos = [];
      listaCargada = false;
      $("listaFavoritos").replaceChildren();
      $("estadoFavoritos").hidden = false;
      $("estadoFavoritos").textContent = "Cargando favoritos…";
    }
    $("app").hidden = false;
    $("espera").hidden = true;
    const [catalogo, lista] = await Promise.all([api("/catalogo"), api()]);
    const anterior = primeraCarga ? new URLSearchParams(location.search).get("gasolinera") : gasolinera.value;
    estaciones = catalogo.data;
    favoritos = lista.data;
    listaCargada = true;
    gasolinera.replaceChildren(...estaciones.map((e) => new Option(`${e.nombre} · ${e.municipio}`, e.codigo)));
    if (estaciones.some((e) => e.codigo === anterior)) gasolinera.value = anterior;
    primeraCarga = false;
    mostrarFavoritos();
    $("mensaje").hidden = true;
  } catch (error) {
    listaCargada = false;
    if ($("app").hidden) {
      $("espera").textContent = mensajeError(error);
      $("app").hidden = false;
    }
    mensaje(`No se pudieron actualizar tus favoritos. ${mensajeError(error)}`, true);
    if (!favoritos.length) $("estadoFavoritos").textContent = "No fue posible cargar los favoritos. Pulsa Actualizar para reintentar.";
  } finally { bloquear(false); }
}

$("formFavorito").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (ocupado || guardar.disabled) return;
  const datos = { codigoGasolinera: gasolinera.value, codigoCombustible: combustible.value };
  bloquear(true);
  guardar.textContent = "Guardando…";
  let guardado = false;
  try {
    await api("", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos) });
    guardado = true;
    favoritos = (await api()).data;
    mostrarFavoritos();
    mensaje("Favorito guardado correctamente.");
  } catch (error) {
    if (guardado) listaCargada = false;
    mensaje(guardado ? "El favorito se guardó. Pulsa Actualizar para volver a cargar la lista." : mensajeError(error), true);
  } finally {
    guardar.textContent = "Guardar favorito";
    bloquear(false);
  }
});

async function eliminar(favorito) {
  if (ocupado || cerrando) return;
  bloquear(true);
  try {
    await api(`/${encodeURIComponent(favorito.id)}`, { method: "DELETE" });
    favoritos = favoritos.filter((f) => f.id !== favorito.id);
    mostrarFavoritos();
    mensaje("Favorito eliminado correctamente.");
  } catch (error) { mensaje(mensajeError(error), true); }
  finally { bloquear(false); }
}

gasolinera.addEventListener("change", actualizarCombustibles);
$("actualizarFavoritos").addEventListener("click", cargar);
$("salir").addEventListener("click", async () => {
  if (ocupado || cerrando) return;
  cerrando = true;
  $("salir").disabled = true;
  try { await enviarFormulario("/auth/logout", {}); irAlLogin(); }
  catch (error) { mensaje(mensajeError(error), true); cerrando = false; $("salir").disabled = false; }
});
window.addEventListener("focus", cargar);
window.addEventListener("pageshow", (evento) => { if (evento.persisted) { $("app").hidden = true; cargar(); } });
cargar();
