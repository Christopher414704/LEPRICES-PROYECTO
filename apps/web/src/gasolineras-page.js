import { apiAutenticada, consultarSesion, irAlLogin, mensajeError } from "./auth.js";

const formulario = document.querySelector("#formRegistro");
const boton = document.querySelector("#guardarRegistro");
const mensaje = document.querySelector("#mensajeRegistro");
const espera = document.querySelector("#esperaRegistro");
let guardando = false;

async function iniciar() {
  const usuario = await consultarSesion();
  if (!usuario) return irAlLogin();
  if (usuario.rol !== "administrador") {
    espera.textContent = "Solo un administrador puede registrar nuevas gasolineras.";
    return;
  }
  const respuesta = await apiAutenticada("/gasolineras/marcas");
  if (!respuesta.ok) throw new Error("No fue posible cargar las marcas disponibles.");
  const { data: marcas } = await respuesta.json();
  const select = document.querySelector("#marcaRegistro");
  for (const marca of marcas) select.append(new Option(marca.nombre, marca.id));
  boton.disabled = !marcas.length;
  if (!marcas.length) {
    mensaje.textContent = "No hay marcas activas disponibles. Configura el catálogo de marcas antes de registrar una estación.";
    mensaje.classList.add("error");
    mensaje.hidden = false;
  }
  document.querySelector("#app").hidden = false;
  espera.hidden = true;
  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    if (guardando) return;
    guardando = true;
    boton.disabled = true;
    boton.textContent = "Registrando…";
    formulario.setAttribute("aria-busy", "true");
    mensaje.hidden = true;
    try {
      const datos = Object.fromEntries(new FormData(formulario));
      const resultado = await apiAutenticada("/gasolineras", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos),
      });
      const cuerpo = await resultado.json();
      if (!resultado.ok) throw new Error(cuerpo.message ?? "No fue posible registrar la gasolinera.");
      window.location.assign(`${import.meta.env.BASE_URL}mapa.html?gasolinera=${encodeURIComponent(cuerpo.data.codigo)}`);
    } catch (error) {
      mensaje.textContent = mensajeError(error);
      mensaje.classList.add("error");
      mensaje.hidden = false;
      guardando = false;
      boton.disabled = false;
      boton.textContent = "Registrar gasolinera";
      formulario.removeAttribute("aria-busy");
    }
  });
}

iniciar().catch((error) => { espera.textContent = mensajeError(error); });
