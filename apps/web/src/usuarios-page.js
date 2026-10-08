import { apiAutenticada, consultarSesion, irAlLogin, mensajeError } from "./auth.js";

const nodos = {
  app: document.querySelector("#app"), espera: document.querySelector("#espera"),
  mensaje: document.querySelector("#mensaje"), formulario: document.querySelector("#formUsuario"),
  rol: document.querySelector("#rol"), campoGasolinera: document.querySelector("#campoGasolinera"),
  gasolinera: document.querySelector("#gasolinera"), lista: document.querySelector("#listaUsuarios"),
  sinUsuarios: document.querySelector("#sinUsuarios"), boton: document.querySelector("#crearUsuario"),
  formularioAsignacion: document.querySelector("#formAsignacion"),
  gestorAsignacion: document.querySelector("#gestorAsignacion"),
  gasolineraAsignacion: document.querySelector("#gasolineraAsignacion"),
  botonAsignacion: document.querySelector("#asignarGestor"),
};
let datos;
let administradorActual;

async function solicitar(ruta, opciones = {}) {
  const respuesta = await apiAutenticada(ruta, opciones);
  const cuerpo = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw new Error(cuerpo.message ?? "No fue posible completar la operación.");
  return cuerpo;
}

function informar(texto, error = false) {
  nodos.mensaje.textContent = texto;
  nodos.mensaje.classList.toggle("error", error);
  nodos.mensaje.hidden = false;
}

function ajustarRol() {
  const rol = datos.roles.find((r) => r.id === nodos.rol.value);
  const esGestor = rol?.codigo === "gestor_gasolinera";
  nodos.campoGasolinera.hidden = !esGestor;
  nodos.gasolinera.required = esGestor;
  if (!esGestor) nodos.gasolinera.value = "";
}

const fecha = (valor) => valor ? new Intl.DateTimeFormat("es-GT", {
  dateStyle: "medium", timeStyle: "short", timeZone: "America/Guatemala",
}).format(new Date(valor)) : "Sin acceso registrado";

function render() {
  nodos.lista.replaceChildren();
  for (const usuario of datos.usuarios) {
    const fila = document.createElement("tr");
    const identidad = document.createElement("td");
    identidad.className = "identidad";
    const nombre = document.createElement("strong");
    nombre.textContent = usuario.nombre;
    const cuenta = document.createElement("small");
    cuenta.textContent = `@${usuario.usuario} · ${usuario.correo}`;
    identidad.append(nombre, cuenta);
    const estado = document.createElement("span");
    estado.className = `estado-cuenta${usuario.activo ? " activo" : ""}`;
    estado.textContent = usuario.activo ? "Activa" : "Inactiva";
    const estadoCelda = document.createElement("td");
    estadoCelda.append(estado);
    const accion = document.createElement("td");
    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = "boton-secundario";
    boton.textContent = usuario.activo ? "Desactivar" : "Activar";
    boton.disabled = usuario.id === administradorActual;
    boton.title = boton.disabled ? "No puedes desactivar tu propia cuenta" : "";
    boton.addEventListener("click", () => cambiarEstado(usuario, boton));
    accion.append(boton);
    for (const contenido of [usuario.rol.nombre, usuario.gasolinera?.nombre ?? "No aplica", fecha(usuario.ultimoAcceso)]) {
      const td = document.createElement("td");
      td.textContent = contenido;
      fila.append(td);
    }
    fila.prepend(identidad);
    fila.insertBefore(estadoCelda, fila.children[3]);
    fila.append(accion);
    nodos.lista.append(fila);
  }
  nodos.sinUsuarios.hidden = Boolean(datos.usuarios.length);
}

function ajustarGasolinerasAsignacion() {
  const gestor = datos.usuarios.find((usuario) => usuario.id === nodos.gestorAsignacion.value);
  const ocupadas = new Set(datos.usuarios
    .filter((usuario) => usuario.activo && usuario.rol.codigo === "gestor_gasolinera" && usuario.id !== gestor?.id)
    .map((usuario) => usuario.gasolinera?.id).filter(Boolean));
  nodos.gasolineraAsignacion.replaceChildren(new Option("Selecciona una gasolinera", ""));
  for (const estacion of datos.gasolineras.filter((g) => g.activo &&
    (!ocupadas.has(g.id) || g.id === gestor?.gasolinera?.id))) {
    nodos.gasolineraAsignacion.append(new Option(estacion.nombre, estacion.id));
  }
  nodos.gasolineraAsignacion.value = gestor?.gasolinera?.id ?? "";
}

async function cambiarEstado(usuario, boton) {
  boton.disabled = true;
  nodos.mensaje.hidden = true;
  try {
    const resultado = await solicitar(`/usuarios/${encodeURIComponent(usuario.id)}/estado`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: !usuario.activo }),
    });
    Object.assign(usuario, resultado.data);
    render();
    informar(resultado.message);
  } catch (error) {
    informar(mensajeError(error), true);
    boton.disabled = false;
  }
}

async function recargar() {
  datos = await solicitar("/usuarios");
  nodos.rol.replaceChildren();
  for (const rol of datos.roles) nodos.rol.append(new Option(rol.nombre, rol.id));
  nodos.gasolinera.replaceChildren(new Option("Selecciona una gasolinera", ""));
  for (const estacion of datos.gasolineras.filter((g) => g.activo)) {
    nodos.gasolinera.append(new Option(estacion.nombre, estacion.id));
  }
  nodos.gestorAsignacion.replaceChildren(new Option("Selecciona un gestor", ""));
  if (datos.roles.some((rol) => rol.codigo === "gestor_gasolinera")) {
    for (const usuario of datos.usuarios.filter((u) => u.activo && u.rol.codigo === "gestor_gasolinera")) {
      nodos.gestorAsignacion.append(new Option(`${usuario.nombre} · ${usuario.gasolinera?.nombre ?? "Sin asignación"}`, usuario.id));
    }
  }
  ajustarRol();
  ajustarGasolinerasAsignacion();
  render();
}

async function iniciar() {
  const usuario = await consultarSesion();
  if (!usuario) return irAlLogin();
  if (usuario.rol !== "administrador") {
    nodos.espera.textContent = "Solo un administrador puede gestionar usuarios.";
    return;
  }
  administradorActual = usuario.id;
  await recargar();
  nodos.app.hidden = false;
  nodos.espera.hidden = true;
  nodos.rol.addEventListener("change", ajustarRol);
  nodos.gestorAsignacion.addEventListener("change", ajustarGasolinerasAsignacion);
  nodos.formularioAsignacion.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    nodos.botonAsignacion.disabled = true;
    nodos.mensaje.hidden = true;
    try {
      const resultado = await solicitar(`/usuarios/${encodeURIComponent(nodos.gestorAsignacion.value)}/gasolinera`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idGasolinera: nodos.gasolineraAsignacion.value }),
      });
      await recargar();
      nodos.gestorAsignacion.value = resultado.data.id;
      ajustarGasolinerasAsignacion();
      informar(resultado.message);
    } catch (error) {
      informar(mensajeError(error), true);
    } finally {
      nodos.botonAsignacion.disabled = false;
    }
  });
  nodos.formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    nodos.boton.disabled = true;
    nodos.mensaje.hidden = true;
    try {
      const formulario = new FormData(nodos.formulario);
      const resultado = await solicitar("/usuarios", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(formulario)),
      });
      nodos.formulario.reset();
      await recargar();
      informar(resultado.message);
    } catch (error) {
      informar(mensajeError(error), true);
    } finally {
      nodos.boton.disabled = false;
    }
  });
  document.querySelector("#salir").addEventListener("click", async () => {
    try { await apiAutenticada("/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); }
    finally { irAlLogin(); }
  });
}

iniciar().catch((error) => { nodos.espera.textContent = mensajeError(error); });
