import "./style.css";
import {
  consultarSesion,
  enviarFormulario,
  irAlLogin,
  mensajeError,
  urlLogin,
} from "./auth.js";

const app = document.querySelector("#app");
const acceso = document.querySelector("#verificacionSesion");
const estado = document.querySelector("#mensajeSesion");
const reintentar = document.querySelector("#reintentarSesion");
const salir = document.querySelector("#cerrarSesion");
document.querySelector("#enlaceLogin").href = urlLogin;

let cargada = false;
let comprobando = false;
let cerrando = false;

async function comprobarAcceso() {
  if (comprobando || cerrando) return;
  comprobando = true;
  reintentar.hidden = true;
  try {
    const usuario = await consultarSesion();
    if (!usuario) {
      irAlLogin();
      return;
    }
    app.hidden = false;
    acceso.hidden = true;
    if (!cargada) {
      await import("./main.js");
      cargada = true;
    }
  } catch (error) {
    app.hidden = true;
    acceso.hidden = false;
    estado.textContent = mensajeError(error);
    reintentar.hidden = false;
  } finally {
    comprobando = false;
  }
}

salir.addEventListener("click", async () => {
  if (cerrando) return;
  cerrando = true;
  salir.disabled = true;
  try {
    await enviarFormulario("/auth/logout", {});
    irAlLogin();
  } catch (error) {
    cerrando = false;
    salir.disabled = false;
    const estadoMapa = document.querySelector("#estadoMapa");
    estadoMapa.textContent = `No se pudo cerrar la sesión. ${mensajeError(error)}`;
    estadoMapa.classList.add("estado--error");
  }
});

reintentar.addEventListener("click", comprobarAcceso);
window.addEventListener("focus", comprobarAcceso);
window.addEventListener("pageshow", (evento) => {
  if (evento.persisted) {
    app.hidden = true;
    comprobarAcceso();
  }
});
setInterval(comprobarAcceso, 60000);
comprobarAcceso();
