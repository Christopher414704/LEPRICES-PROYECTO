export const urlApi = (import.meta.env.VITE_API_URL ?? "/api").replace(/\/$/, "");
export const urlLogin = `${import.meta.env.BASE_URL}login.html`;

export function solicitarApi(ruta, opciones = {}) {
  return fetch(`${urlApi}${ruta}`, {
    ...opciones,
    credentials: "include",
    cache: "no-store",
    signal: opciones.signal ?? AbortSignal.timeout(15000),
  });
}

export function irAlLogin() {
  const app = document.querySelector("#app");
  if (app) app.hidden = true;
  window.location.replace(urlLogin);
}

export async function consultarSesion() {
  const respuesta = await solicitarApi("/auth/sesion");
  if (respuesta.status === 401) return null;
  if (!respuesta.ok) {
    throw new Error("No fue posible comprobar tu sesión. Vuelve a intentar.");
  }
  const resultado = await respuesta.json();
  return resultado.autenticado === true ? resultado.usuario : null;
}

export async function apiAutenticada(ruta, opciones) {
  const respuesta = await solicitarApi(ruta, opciones);
  if (respuesta.status === 401) {
    irAlLogin();
    throw new Error("Tu sesión ha terminado.");
  }
  return respuesta;
}

export async function enviarFormulario(ruta, datos) {
  const respuesta = await solicitarApi(ruta, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(datos),
  });
  if (!respuesta.ok) {
    const resultado = await respuesta.json().catch(() => ({}));
    throw new Error(resultado.message ?? "No fue posible completar la solicitud.");
  }
  return respuesta.status === 204 ? null : respuesta.json();
}

export function mensajeError(error) {
  if (error.name === "TimeoutError") {
    return "El servidor tardó demasiado en responder. Vuelve a intentar.";
  }
  if (error instanceof TypeError) {
    return "No fue posible conectar con el servidor. Vuelve a intentar.";
  }
  return error.message;
}
