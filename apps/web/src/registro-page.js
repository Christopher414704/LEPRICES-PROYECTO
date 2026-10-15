import { enviarFormulario, mensajeError } from "./auth.js";
import { prepararRegistroConductor } from "./registro-conductor.js";

const formulario = document.querySelector("#formularioRegistro");
const boton = document.querySelector("#botonRegistrar");
const mensaje = document.querySelector("#mensajeRegistro");

formulario.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (boton.disabled) return;
  boton.disabled = true;
  formulario.setAttribute("aria-busy", "true");
  mensaje.hidden = true;
  try {
    const resultado = await enviarFormulario("/auth/registro-conductor", prepararRegistroConductor(formulario));
    formulario.reset();
    mensaje.classList.add("exito");
    mensaje.textContent = `${resultado.message} Ya puedes iniciar sesión.`;
    mensaje.hidden = false;
    document.querySelector("#enlaceLogin").focus();
  } catch (error) {
    mensaje.classList.remove("exito");
    mensaje.textContent = mensajeError(error);
    mensaje.hidden = false;
  } finally {
    boton.disabled = false;
    formulario.removeAttribute("aria-busy");
  }
});
