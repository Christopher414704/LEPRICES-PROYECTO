import { apiAutenticada, consultarSesion, irAlLogin, mensajeError } from "./auth.js";

const $ = (selector) => document.querySelector(selector);
const nodos = {
  app: $("#app"), espera: $("#espera"), mensaje: $("#mensaje"), administracion: $("#administracion"),
  gestor: $("#gestor"), gasolineraGestor: $("#gasolineraGestor"), horaInicio: $("#horaInicio"),
  duracion: $("#duracion"), revocar: $("#revocar"), selectorEstacion: $("#selectorEstacion"),
  gasolineraEditor: $("#gasolineraEditor"), estadoHorario: $("#estadoHorario"),
  contenidoEditor: $("#contenidoEditor"), tipoNuevo: $("#tipoNuevo"), filasPrecios: $("#filasPrecios"),
  guardarPrecios: $("#guardarPrecios"), formAgregar: $("#formAgregar"),
};
let estado;
let estaciones = [];

function mostrarMensaje(texto, error = false) {
  nodos.mensaje.textContent = texto;
  nodos.mensaje.classList.toggle("error", error);
  nodos.mensaje.hidden = false;
  nodos.mensaje.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

async function solicitar(ruta, method = "GET", datos) {
  const respuesta = await apiAutenticada(ruta, {
    method,
    ...(datos === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos) }),
  });
  const resultado = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw new Error(resultado.message ?? "No fue posible completar la solicitud.");
  return resultado;
}

function llenarSelect(select, opciones, valor, texto) {
  select.replaceChildren();
  for (const opcion of opciones) {
    const nodo = document.createElement("option");
    nodo.value = String(opcion.id);
    nodo.textContent = texto(opcion);
    select.append(nodo);
  }
  if (valor != null && opciones.some((o) => String(o.id) === String(valor))) select.value = String(valor);
}

function seleccionActual() {
  const id = estado.rol === "administrador" ? nodos.gasolineraEditor.value : estado.idGasolinera;
  return estaciones.find((e) => String(e.id) === String(id));
}

function actualizarGestor() {
  const gestor = estado.gestores.find((g) => g.id === nodos.gestor.value);
  if (!gestor) return;
  nodos.gasolineraGestor.value = gestor.idGasolinera ?? estaciones[0]?.id ?? "";
  nodos.horaInicio.value = gestor.horaInicio ?? "08:00";
  nodos.duracion.value = String(gestor.duracion ?? 30);
  nodos.revocar.disabled = !gestor.horarioActivo;
}

function campoPrecio(combustible, modalidad, editable) {
  const label = document.createElement("label");
  const nombreModalidad = modalidad.codigo === "servicio_manual" ? "Servicio Completo" : modalidad.nombre;
  label.textContent = nombreModalidad;
  const input = document.createElement("input");
  input.type = "number";
  input.inputMode = "decimal";
  input.min = "0.01";
  input.max = "99999999.99";
  input.step = "0.01";
  input.placeholder = "Q 0.00";
  input.setAttribute("aria-label", `${combustible.nombreComercial}, ${nombreModalidad}, quetzales por galón`);
  const previo = combustible.precios?.[modalidad.codigo]?.precio;
  if (previo != null) input.value = Number(previo).toFixed(2);
  input.dataset.previo = previo == null ? "" : Number(previo).toFixed(2);
  input.dataset.combustible = String(combustible.id);
  input.dataset.modalidad = modalidad.id;
  input.disabled = !editable;
  label.append(input);
  return label;
}

function actualizarEstadoHorario(estacion) {
  const editable = estado.rol === "administrador" || estado.horarioVigente;
  nodos.estadoHorario.classList.toggle("vigente", editable);
  nodos.estadoHorario.textContent = estado.rol === "administrador"
    ? "Administrador: puedes editar los precios de cualquier gasolinera activa."
    : !estacion ? "Aún no tienes una gasolinera asignada. Pide al administrador que te la asigne."
      : !estado.horarioActivo ? "Tu horario de edición está desactivado. Consulta al administrador."
        : editable ? `Horario abierto. Puedes editar cada día de ${estado.horaInicio} durante ${estado.duracion} minutos (Guatemala).`
          : `Horario cerrado. Puedes editar cada día de ${estado.horaInicio} durante ${estado.duracion} minutos (Guatemala). Hora actual: ${estado.horaGuatemala}.`;
  nodos.formAgregar.querySelector("button").disabled = !editable;
  nodos.guardarPrecios.disabled = !editable || !estacion?.combustibles.length;
  for (const input of nodos.filasPrecios.querySelectorAll("input")) input.disabled = !editable;
}

function renderEditor() {
  const estacion = seleccionActual();
  const editable = estado.rol === "administrador" || estado.horarioVigente;
  nodos.contenidoEditor.hidden = !estacion;
  if (!estacion) return actualizarEstadoHorario(estacion);
  $("#tituloEditor").textContent = estacion.nombre;
  const disponibles = estado.tipos.filter((t) => !estacion.combustibles.some((c) => c.tipo?.codigo === t.codigo));
  llenarSelect(nodos.tipoNuevo, disponibles, null, (t) => t.nombre);
  nodos.formAgregar.hidden = !disponibles.length;
  nodos.filasPrecios.replaceChildren();
  for (const combustible of estacion.combustibles) {
    const fila = document.createElement("div");
    fila.className = "fila-combustible";
    const nombre = document.createElement("div");
    const titulo = document.createElement("strong");
    titulo.textContent = combustible.nombreComercial;
    const unidad = document.createElement("small");
    unidad.textContent = "Quetzales por galón";
    nombre.append(titulo, unidad);
    fila.append(nombre, ...estado.modalidades.map((m) => campoPrecio(combustible, m, editable)));
    nodos.filasPrecios.append(fila);
  }
  if (!estacion.combustibles.length) {
    const vacio = document.createElement("p");
    vacio.className = "vacio";
    vacio.textContent = "Esta gasolinera aún no tiene combustibles registrados. Agrégale uno para empezar.";
    nodos.filasPrecios.append(vacio);
  }
  actualizarEstadoHorario(estacion);
}

async function recargar(conservar = true) {
  const idGestor = conservar ? nodos.gestor.value : null;
  const idEstacion = conservar ? nodos.gasolineraEditor.value : null;
  const [nuevoEstado, listado] = await Promise.all([
    solicitar("/precios/estado"), solicitar("/gasolineras"),
  ]);
  estado = nuevoEstado;
  estaciones = listado.data;
  if (estado.rol === "administrador") {
    nodos.administracion.hidden = false;
    nodos.selectorEstacion.hidden = false;
    llenarSelect(nodos.gestor, estado.gestores, idGestor, (g) => `${g.nombre} (${g.usuario})`);
    llenarSelect(nodos.gasolineraGestor, estaciones, null, (e) => e.nombre);
    llenarSelect(nodos.gasolineraEditor, estaciones, idEstacion, (e) => e.nombre);
    actualizarGestor();
    $("#formPermisos").querySelector("button[type=submit]").disabled = !estado.gestores.length || !estaciones.length;
    nodos.revocar.disabled = !estado.gestores.length || nodos.revocar.disabled;
  } else {
    nodos.administracion.hidden = true;
    nodos.selectorEstacion.hidden = true;
  }
  renderEditor();
}

async function ejecutar(accion, exito) {
  nodos.mensaje.hidden = true;
  try {
    await accion();
    await recargar();
    mostrarMensaje(exito);
  } catch (error) {
    mostrarMensaje(mensajeError(error), true);
  }
}

async function iniciar() {
  const usuario = await consultarSesion();
  if (!usuario) return irAlLogin();
  await recargar(false);
  nodos.espera.hidden = true;
  nodos.app.hidden = false;

  nodos.gestor.addEventListener("change", actualizarGestor);
  nodos.gasolineraEditor.addEventListener("change", renderEditor);
  $("#formPermisos").addEventListener("submit", (evento) => {
    evento.preventDefault();
    ejecutar(() => solicitar(`/precios/gestores/${nodos.gestor.value}`, "PUT", {
      idGasolinera: nodos.gasolineraGestor.value,
      horaInicio: nodos.horaInicio.value,
      duracion: Number(nodos.duracion.value),
    }), "Asignación y horario guardados.");
  });
  nodos.revocar.addEventListener("click", () => ejecutar(
    () => solicitar(`/precios/gestores/${nodos.gestor.value}/horario`, "DELETE"),
    "Horario desactivado para este gestor.",
  ));
  nodos.formAgregar.addEventListener("submit", (evento) => {
    evento.preventDefault();
    const estacion = seleccionActual();
    if (!estacion) return;
    ejecutar(() => solicitar("/precios/combustibles", "POST", {
      idGasolinera: estacion.id, idTipo: nodos.tipoNuevo.value,
    }), "Combustible agregado. Ya puedes registrar sus precios.");
  });
  $("#formPrecios").addEventListener("submit", (evento) => {
    evento.preventDefault();
    const estacion = seleccionActual();
    if (!estacion) return;
    const cambios = [...nodos.filasPrecios.querySelectorAll("input")]
      .filter((input) => input.value !== "" && Number(input.value) !== Number(input.dataset.previo || NaN))
      .map((input) => ({
        idCombustible: input.dataset.combustible,
        idModalidad: input.dataset.modalidad,
        precio: input.value,
      }));
    if (!cambios.length) return mostrarMensaje("No hay precios nuevos que guardar.");
    ejecutar(() => solicitar("/precios/registrar", "POST", { idGasolinera: estacion.id, cambios }),
      "Precios guardados. El mapa ya mostrará los valores nuevos.");
  });
  $("#salir").addEventListener("click", async () => {
    try { await solicitar("/auth/logout", "POST", {}); } finally { irAlLogin(); }
  });
  setInterval(async () => {
    if (estado.rol !== "administrador") {
      try {
        const nuevoEstado = await solicitar("/precios/estado");
        if (nuevoEstado.idGasolinera !== estado.idGasolinera || nuevoEstado.rol !== estado.rol) {
          await recargar();
          return;
        }
        estado = nuevoEstado;
        actualizarEstadoHorario(seleccionActual());
      } catch { /* La siguiente acción mostrará el error de red. */ }
    }
  }, 30000);
}

iniciar().catch((error) => {
  nodos.espera.textContent = mensajeError(error);
  nodos.espera.classList.add("error");
});
