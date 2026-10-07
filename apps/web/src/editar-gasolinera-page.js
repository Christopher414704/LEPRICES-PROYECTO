import { apiAutenticada, consultarSesion, irAlLogin, mensajeError } from "./auth.js";

const formulario = document.querySelector("#formEdicion");
const selector = document.querySelector("#estacionEdicion");
const boton = document.querySelector("#guardarEdicion");
const mensaje = document.querySelector("#mensajeEdicion");
const espera = document.querySelector("#esperaEdicion");
const gestionEstado = document.querySelector("#gestionEstado");
const botonEstado = document.querySelector("#cambiarEstado");
const estaciones = new Map();
let guardando = false;

function informar(texto, error = false) {
  mensaje.textContent = texto;
  mensaje.classList.toggle("error", error);
  mensaje.hidden = false;
}

const textoOpcion = (estacion) => `${estacion.nombre} — ${estacion.municipio}, ${estacion.departamento} (${estacion.activo ? "Activa" : "Inactiva"})`;

function mostrarSeleccion() {
  const estacion = estaciones.get(selector.value);
  gestionEstado.hidden = !estacion;
  formulario.hidden = !estacion?.activo;
  if (!estacion) return;
  document.querySelector("#estadoEstacion").textContent = `Estado: ${estacion.activo ? "Activa" : "Inactiva"}`;
  botonEstado.textContent = estacion.activo ? "Desactivar gasolinera" : "Reactivar gasolinera";
  for (const campo of ["nombre", "direccion", "municipio", "departamento"]) {
    formulario.elements.namedItem(campo).value = estacion[campo] ?? "";
  }
  for (const campo of ["latitud", "longitud"]) {
    formulario.elements.namedItem(campo).value = estacion.ubicacion[campo];
  }
  document.querySelector("#verEstacionEditada").href = `${import.meta.env.BASE_URL}mapa.html?gasolinera=${encodeURIComponent(estacion.codigo)}`;
}

async function iniciar() {
  const usuario = await consultarSesion();
  if (!usuario) return irAlLogin();
  if (usuario.rol !== "administrador") {
    espera.textContent = "Solo un administrador puede administrar gasolineras.";
    return;
  }
  const respuesta = await apiAutenticada("/gasolineras/administracion");
  if (!respuesta.ok) throw new Error("No fue posible cargar las estaciones disponibles.");
  const { data } = await respuesta.json();
  for (const estacion of data.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))) {
    estaciones.set(String(estacion.id), estacion);
    selector.append(new Option(textoOpcion(estacion), estacion.id));
  }
  selector.disabled = !estaciones.size;
  if (!estaciones.size) informar("No hay estaciones disponibles para administrar.");
  document.querySelector("#app").hidden = false;
  espera.hidden = true;

  selector.addEventListener("change", () => {
    mensaje.hidden = true;
    mostrarSeleccion();
  });

  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    if (guardando || !estaciones.has(selector.value)) return;
    guardando = true;
    boton.disabled = selector.disabled = true;
    botonEstado.disabled = true;
    boton.textContent = "Guardando…";
    formulario.setAttribute("aria-busy", "true");
    mensaje.hidden = true;
    try {
      const id = selector.value;
      const datos = Object.fromEntries(new FormData(formulario));
      const respuesta = await apiAutenticada(`/gasolineras/${encodeURIComponent(id)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos),
      });
      const cuerpo = await respuesta.json();
      if (!respuesta.ok) throw new Error(cuerpo.message ?? "No fue posible modificar la gasolinera.");
      const estacion = { ...estaciones.get(id), ...cuerpo.data };
      estaciones.set(id, estacion);
      selector.selectedOptions[0].textContent = textoOpcion(estacion);
      informar(cuerpo.message ?? "Gasolinera modificada correctamente.");
    } catch (error) {
      informar(mensajeError(error), true);
    } finally {
      guardando = false;
      boton.disabled = selector.disabled = false;
      botonEstado.disabled = false;
      boton.textContent = "Guardar cambios";
      formulario.removeAttribute("aria-busy");
    }
  });

  botonEstado.addEventListener("click", async () => {
    const estacion = estaciones.get(selector.value);
    if (guardando || !estacion) return;
    guardando = true;
    boton.disabled = botonEstado.disabled = selector.disabled = true;
    botonEstado.textContent = estacion.activo ? "Desactivando…" : "Reactivando…";
    gestionEstado.setAttribute("aria-busy", "true");
    mensaje.hidden = true;
    try {
      const respuesta = await apiAutenticada(`/gasolineras/${encodeURIComponent(estacion.id)}/estado`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: !estacion.activo }),
      });
      const cuerpo = await respuesta.json();
      if (!respuesta.ok) throw new Error(cuerpo.message ?? "No fue posible cambiar el estado de la gasolinera.");
      const actualizada = { ...estacion, ...cuerpo.data };
      estaciones.set(selector.value, actualizada);
      selector.selectedOptions[0].textContent = textoOpcion(actualizada);
      mostrarSeleccion();
      informar(cuerpo.message);
    } catch (error) {
      informar(mensajeError(error), true);
    } finally {
      guardando = false;
      boton.disabled = botonEstado.disabled = selector.disabled = false;
      const actual = estaciones.get(selector.value);
      botonEstado.textContent = actual.activo ? "Desactivar gasolinera" : "Reactivar gasolinera";
      gestionEstado.removeAttribute("aria-busy");
    }
  });
}

iniciar().catch((error) => { espera.textContent = mensajeError(error); });
