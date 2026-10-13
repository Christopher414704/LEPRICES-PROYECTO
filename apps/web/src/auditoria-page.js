import { apiAutenticada, consultarSesion, irAlLogin, mensajeError } from "./auth.js";

const nodos = {
  app: document.querySelector("#app"), espera: document.querySelector("#espera"),
  mensaje: document.querySelector("#mensaje"), formulario: document.querySelector("#formFiltros"),
  lista: document.querySelector("#listaEventos"), vacio: document.querySelector("#sinEventos"),
  anterior: document.querySelector("#anterior"), siguiente: document.querySelector("#siguiente"),
  pagina: document.querySelector("#pagina"), limpiar: document.querySelector("#limpiar"),
};
let paginaActual = 1;

const fecha = (valor) => new Intl.DateTimeFormat("es-GT", {
  dateStyle: "medium", timeStyle: "short", timeZone: "America/Guatemala",
}).format(new Date(valor));

const etiquetas = {
  gasolinera: "Gasolinera", usuario: "Usuario", asignacion: "Asignación",
  registro: "Registro", edicion: "Edición", activacion: "Activación",
  desactivacion: "Desactivación", reactivacion: "Reactivación", asignacion: "Asignación",
};

function mostrarError(error) {
  nodos.mensaje.textContent = mensajeError(error);
  nodos.mensaje.classList.add("error");
  nodos.mensaje.hidden = false;
}

function detalle(datos) {
  const contenedor = document.createElement("details");
  const resumen = document.createElement("summary");
  resumen.textContent = "Ver detalle";
  const contenido = document.createElement("pre");
  contenido.textContent = JSON.stringify(datos, null, 2);
  contenedor.append(resumen, contenido);
  return contenedor;
}

function render(resultado) {
  nodos.lista.replaceChildren();
  for (const evento of resultado.registros) {
    const fila = document.createElement("tr");
    const valores = [fecha(evento.fecha), etiquetas[evento.tipo] ?? evento.tipo,
      etiquetas[evento.operacion] ?? evento.operacion, evento.elemento.nombre,
      evento.responsable ? `${evento.responsable.nombre} (@${evento.responsable.usuario})` : "Usuario no disponible"];
    for (const valor of valores) {
      const celda = document.createElement("td");
      celda.textContent = valor;
      fila.append(celda);
    }
    const celdaDetalle = document.createElement("td");
    celdaDetalle.append(detalle(evento.datos));
    fila.append(celdaDetalle);
    nodos.lista.append(fila);
  }
  nodos.vacio.hidden = resultado.registros.length !== 0;
  nodos.pagina.textContent = `Página ${resultado.paginacion.pagina} de ${resultado.paginacion.paginas} · ${resultado.paginacion.total} eventos`;
  nodos.anterior.disabled = resultado.paginacion.pagina <= 1;
  nodos.siguiente.disabled = resultado.paginacion.pagina >= resultado.paginacion.paginas;
}

async function consultar(pagina = 1) {
  nodos.mensaje.hidden = true;
  const parametros = new URLSearchParams();
  for (const [clave, valor] of new FormData(nodos.formulario)) if (valor) parametros.set(clave, valor);
  parametros.set("pagina", String(pagina));
  const respuesta = await apiAutenticada(`/auditoria?${parametros}`);
  const resultado = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw new Error(resultado.message ?? "No fue posible consultar la auditoría.");
  paginaActual = pagina;
  render(resultado);
}

async function iniciar() {
  const usuario = await consultarSesion();
  if (!usuario) return irAlLogin();
  if (usuario.rol !== "administrador") {
    nodos.espera.textContent = "Solo un administrador puede consultar la auditoría.";
    return;
  }
  await consultar();
  nodos.app.hidden = false;
  nodos.espera.hidden = true;
  nodos.formulario.addEventListener("submit", (evento) => {
    evento.preventDefault();
    consultar().catch(mostrarError);
  });
  nodos.limpiar.addEventListener("click", () => {
    nodos.formulario.reset();
    consultar().catch(mostrarError);
  });
  nodos.anterior.addEventListener("click", () => consultar(paginaActual - 1).catch(mostrarError));
  nodos.siguiente.addEventListener("click", () => consultar(paginaActual + 1).catch(mostrarError));
  document.querySelector("#salir").addEventListener("click", async () => {
    try { await apiAutenticada("/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); }
    finally { irAlLogin(); }
  });
}

iniciar().catch((error) => { nodos.espera.textContent = mensajeError(error); });
