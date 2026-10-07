import { apiAutenticada, consultarSesion, irAlLogin, mensajeError } from "./auth.js";

const nodos = {
  app: document.querySelector("#app"), espera: document.querySelector("#espera"),
  mensaje: document.querySelector("#mensaje"), formulario: document.querySelector("#filtrosHistorial"),
  gasolinera: document.querySelector("#gasolinera"), combustible: document.querySelector("#combustible"),
  desde: document.querySelector("#desde"), hasta: document.querySelector("#hasta"),
  titulo: document.querySelector("#tituloResultados"), resumen: document.querySelector("#resumen"),
  tabla: document.querySelector("#tablaHistorial"), cuerpo: document.querySelector("#tablaHistorial tbody"),
  sinRegistros: document.querySelector("#sinRegistros"),
};
let solicitud;

const dinero = (valor, moneda = "GTQ") => valor == null ? "Sin registro anterior" :
  new Intl.NumberFormat("es-GT", { style: "currency", currency: moneda }).format(valor);
const fechaHora = (fecha) => new Intl.DateTimeFormat("es-GT", {
  dateStyle: "medium", timeStyle: "short", timeZone: "America/Guatemala",
}).format(new Date(fecha));

function celda(texto, clase) {
  const td = document.createElement("td");
  td.textContent = texto;
  if (clase) td.className = clase;
  return td;
}

function mostrar(registros, gasolinera) {
  nodos.cuerpo.replaceChildren();
  nodos.titulo.textContent = gasolinera.nombre;
  nodos.resumen.textContent = `${registros.length} cambio${registros.length === 1 ? "" : "s"}, del más reciente al más antiguo.`;
  for (const registro of registros) {
    const fila = document.createElement("tr");
    const responsable = celda(registro.usuario?.nombre ?? "Usuario no disponible", "responsable");
    if (registro.usuario?.usuario) {
      const cuenta = document.createElement("small");
      cuenta.textContent = `@${registro.usuario.usuario}`;
      responsable.append(cuenta);
    }
    fila.append(
      celda(fechaHora(registro.fecha)), celda(registro.combustible.nombre), celda(registro.modalidad),
      celda(dinero(registro.precioAnterior, registro.moneda), "precio-anterior"),
      celda(dinero(registro.precioNuevo, registro.moneda), "precio-nuevo"), responsable,
    );
    nodos.cuerpo.append(fila);
  }
  nodos.tabla.hidden = !registros.length;
  nodos.sinRegistros.hidden = Boolean(registros.length);
}

function actualizarCombustibles(registros) {
  const actual = nodos.combustible.value;
  const opciones = new Map(registros.map((r) => [r.combustible.codigo, r.combustible.nombre]));
  nodos.combustible.replaceChildren(new Option("Todos", ""));
  for (const [codigo, nombre] of [...opciones].sort((a, b) => a[1].localeCompare(b[1], "es"))) {
    nodos.combustible.append(new Option(nombre, codigo));
  }
  if (opciones.has(actual)) nodos.combustible.value = actual;
}

async function cargar({ catalogo = false } = {}) {
  if (!nodos.gasolinera.value) return;
  solicitud?.abort();
  solicitud = new AbortController();
  nodos.mensaje.hidden = true;
  nodos.formulario.setAttribute("aria-busy", "true");
  const parametros = new URLSearchParams({ idGasolinera: nodos.gasolinera.value });
  if (!catalogo && nodos.combustible.value) parametros.set("combustible", nodos.combustible.value);
  if (!catalogo && nodos.desde.value) parametros.set("desde", nodos.desde.value);
  if (!catalogo && nodos.hasta.value) parametros.set("hasta", nodos.hasta.value);
  try {
    const respuesta = await apiAutenticada(`/precios/historial?${parametros}`, { signal: solicitud.signal });
    const resultado = await respuesta.json();
    if (!respuesta.ok) throw new Error(resultado.message ?? "No fue posible consultar el historial.");
    if (catalogo) actualizarCombustibles(resultado.registros);
    mostrar(resultado.registros, resultado.gasolinera);
  } catch (error) {
    if (error.name === "AbortError") return;
    nodos.mensaje.textContent = mensajeError(error);
    nodos.mensaje.classList.add("error");
    nodos.mensaje.hidden = false;
  } finally {
    nodos.formulario.removeAttribute("aria-busy");
  }
}

async function iniciar() {
  const usuario = await consultarSesion();
  if (!usuario) return irAlLogin();
  if (usuario.rol !== "administrador") {
    nodos.espera.textContent = "Solo un administrador puede consultar el historial de precios.";
    return;
  }
  const respuesta = await apiAutenticada("/gasolineras/administracion");
  const resultado = await respuesta.json();
  if (!respuesta.ok) throw new Error(resultado.message ?? "No fue posible cargar las gasolineras.");
  for (const estacion of resultado.data) {
    nodos.gasolinera.append(new Option(`${estacion.nombre} (${estacion.activo ? "Activa" : "Inactiva"})`, estacion.id));
  }
  nodos.app.hidden = false;
  nodos.espera.hidden = true;
  nodos.gasolinera.addEventListener("change", () => cargar({ catalogo: true }));
  nodos.formulario.addEventListener("submit", (evento) => { evento.preventDefault(); cargar(); });
  document.querySelector("#limpiarFiltros").addEventListener("click", () => {
    nodos.combustible.value = nodos.desde.value = nodos.hasta.value = "";
    cargar({ catalogo: true });
  });
  document.querySelector("#salir").addEventListener("click", async () => {
    try { await apiAutenticada("/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); }
    finally { irAlLogin(); }
  });
}

iniciar().catch((error) => { nodos.espera.textContent = mensajeError(error); });
