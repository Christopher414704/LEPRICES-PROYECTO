import { consultarSesion, enviarFormulario, mensajeError } from "./auth.js";

const formulario = document.querySelector("#formularioLogin");
const usuario = document.querySelector("#usuario");
const password = document.querySelector("#password");
const mostrar = document.querySelector("#mostrarPassword");
const ingresar = document.querySelector("#botonIngresar");
const mensaje = document.querySelector("#mensajeLogin");

function entrarAlMapa() {
  window.location.replace(`${import.meta.env.BASE_URL}mapa.html`);
}

mostrar.addEventListener("click", () => {
  const visible = password.type === "password";
  password.type = visible ? "text" : "password";
  mostrar.textContent = visible ? "Ocultar" : "Mostrar";
  mostrar.setAttribute("aria-pressed", String(visible));
  mostrar.setAttribute("aria-label", visible ? "Ocultar contraseña" : "Mostrar contraseña");
});

formulario.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (ingresar.disabled) return;

  ingresar.disabled = true;
  ingresar.textContent = "Ingresando...";
  formulario.setAttribute("aria-busy", "true");
  mensaje.hidden = true;

  try {
    await enviarFormulario("/auth/login", {
      usuario: usuario.value.trim(),
      password: password.value,
    });
    password.value = "";
    entrarAlMapa();
  } catch (error) {
    mensaje.textContent = mensajeError(error);
    mensaje.hidden = false;
  } finally {
    ingresar.disabled = false;
    ingresar.textContent = "Iniciar sesión";
    formulario.removeAttribute("aria-busy");
  }
});

ingresar.disabled = true;
consultarSesion()
  .then((sesion) => {
    if (sesion) entrarAlMapa();
  })
  .catch((error) => {
    mensaje.textContent = mensajeError(error);
    mensaje.hidden = false;
  })
  .finally(() => {
    ingresar.disabled = false;
  });
