import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import cors from "cors";
import { crearAuth } from "../src/routes/auth.routes.js";
import { app } from "../src/app.js";

const origin = "http://localhost:5173";
const token = "a".repeat(64);

async function ejecutarServidor(t, aplicacion, ejecutar) {
  const server = aplicacion.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await ejecutar(`http://127.0.0.1:${server.address().port}`);
}

function crearAplicacion({ production = false } = {}) {
  let vigente = true;
  const usuario = { id: "1", rol: "administrador" };
  const auth = {
    iniciarSesion: async () => ({ token, usuario }),
    obtenerSesion: async (valor) => valor === token && vigente ? usuario : null,
    cerrarSesion: async () => { vigente = false; },
  };
  const api = express();
  api.use(cors({ origin, credentials: true }), express.json());
  const seguridad = crearAuth(auth, {
    frontendUrl: origin,
    nodeEnv: production ? "production" : "test",
  });
  api.use("/api/auth", seguridad.router);
  api.get("/api/privado", seguridad.exigirSesion, (req, res) => {
    res.json({ id: req.usuario.id });
  });
  return api;
}

test("la API real niega las rutas administrativas sin cookie", async (t) => {
  await ejecutarServidor(t, app, async (url) => {
    const res = await fetch(url + "/api/gasolineras");
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("cache-control"), "no-store");
  });
});

test("login establece una cookie HttpOnly, SameSite, duración y Secure en producción", async (t) => {
  await ejecutarServidor(t, crearAplicacion({ production: true }), async (url) => {
    const res = await fetch(url + "/api/auth/login", {
      method: "POST",
      headers: { origin },
    });
    assert.equal(res.status, 200);
    const cookie = res.headers.get("set-cookie");
    for (const atributo of ["HttpOnly", "SameSite=Lax", "Secure", "Path=/api", "Max-Age=28800"]) {
      assert.ok(cookie.includes(atributo));
    }
    assert.equal(res.headers.get("access-control-allow-credentials"), "true");
    assert.equal((await res.json()).token, undefined);
  });
});

test("las mutaciones de autenticación rechazan un origen ajeno o ausente", async (t) => {
  await ejecutarServidor(t, crearAplicacion(), async (url) => {
    for (const ruta of ["login", "logout"]) {
      for (const headers of [{}, { origin: "https://otro.example" }]) {
        const res = await fetch(`${url}/api/auth/${ruta}`, { method: "POST", headers });
        assert.equal(res.status, 403);
      }
    }
  });
});

test("una sesión válida permite entrar y logout invalida la cookie anterior", async (t) => {
  await ejecutarServidor(t, crearAplicacion(), async (url) => {
    const headers = { origin, cookie: `jalapa_sesion=${token}` };
    assert.equal((await fetch(url + "/api/auth/sesion", { headers })).status, 200);
    assert.equal((await fetch(url + "/api/privado", { headers })).status, 200);

    const salida = await fetch(url + "/api/auth/logout", { method: "POST", headers });
    assert.equal(salida.status, 204);
    assert.match(salida.headers.get("set-cookie"), /Expires=Thu, 01 Jan 1970/);
    assert.equal((await fetch(url + "/api/privado", { headers })).status, 401);
  });
});

test("logout exige una sesión autenticada", async (t) => {
  await ejecutarServidor(t, crearAplicacion(), async (url) => {
    const salida = await fetch(url + "/api/auth/logout", {
      method: "POST",
      headers: { origin },
    });
    assert.equal(salida.status, 401);
  });
});

test("una cookie manipulada no autoriza acceso", async (t) => {
  await ejecutarServidor(t, crearAplicacion(), async (url) => {
    const manipulado = await fetch(url + "/api/privado", {
      headers: { cookie: "jalapa_sesion=%GG; usuario=administrador" },
    });
    assert.equal(manipulado.status, 401);
  });
});

test("limita intentos por IP antes de ejecutar más verificaciones", async (t) => {
  await ejecutarServidor(t, crearAplicacion(), async (url) => {
    for (let i = 0; i < 30; i += 1) {
      const res = await fetch(url + "/api/auth/login", {
        method: "POST",
        headers: { origin },
      });
      assert.equal(res.status, 200);
    }
    const res = await fetch(url + "/api/auth/login", {
      method: "POST",
      headers: { origin },
    });
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("retry-after"), "900");
  });
});
