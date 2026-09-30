import { Router } from "express";
import { DURACION_SESION_MS } from "../services/auth.service.js";

const NOMBRE_COOKIE = "jalapa_sesion";

export function leerToken(req) {
  const valor = (req.headers.cookie ?? "").split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${NOMBRE_COOKIE}=`));
  return valor?.slice(NOMBRE_COOKIE.length + 1);
}

export function crearAuth(auth, env) {
  const router = Router();
  const cookie = {
    httpOnly: true,
    secure: env.nodeEnv === "production",
    sameSite: "lax",
    path: "/api",
  };
  const intentosPorIp = new Map();
  const originPermitido = new URL(env.frontendUrl).origin;

  function limitarIntentos(req, res, next) {
    const ahora = Date.now();
    for (const [ip, registro] of intentosPorIp) {
      if (registro.hasta <= ahora) intentosPorIp.delete(ip);
    }
    const registro = intentosPorIp.get(req.ip) ?? {
      cantidad: 0,
      hasta: ahora + 15 * 60 * 1000,
    };
    if (registro.cantidad >= 30 || (!intentosPorIp.has(req.ip) && intentosPorIp.size >= 10000)) {
      res.set("Retry-After", "900");
      return res.status(429).json({
        message: "Demasiados intentos. Intenta de nuevo en 15 minutos.",
      });
    }
    registro.cantidad += 1;
    intentosPorIp.set(req.ip, registro);
    next();
  }

  function validarOrigen(req, res, next) {
    if (req.headers.origin !== originPermitido) {
      return res.status(403).json({ message: "Origen de la solicitud no permitido." });
    }
    next();
  }

  async function exigirSesion(req, res, next) {
    res.set("Cache-Control", "no-store");
    const usuario = await auth.obtenerSesion(leerToken(req));
    if (!usuario) {
      res.clearCookie(NOMBRE_COOKIE, cookie);
      return res.status(401).json({
        autenticado: false,
        message: "Inicia sesión para continuar.",
      });
    }
    req.usuario = usuario;
    next();
  }

  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.post("/login", validarOrigen, limitarIntentos, async (req, res) => {
    const resultado = await auth.iniciarSesion(
      req.body?.usuario,
      req.body?.password,
      leerToken(req),
    );
    res.cookie(NOMBRE_COOKIE, resultado.token, {
      ...cookie,
      maxAge: DURACION_SESION_MS,
    });
    res.json({ autenticado: true, usuario: resultado.usuario });
  });
  router.get("/sesion", exigirSesion, (req, res) => {
    res.json({ autenticado: true, usuario: req.usuario });
  });
  router.post("/logout", validarOrigen, exigirSesion, async (req, res) => {
    await auth.cerrarSesion(leerToken(req));
    res.clearCookie(NOMBRE_COOKIE, cookie);
    res.status(204).end();
  });

  return { router, exigirSesion, validarOrigen };
}
