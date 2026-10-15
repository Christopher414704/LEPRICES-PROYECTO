import webpush from "web-push";
import { env } from "../config/env.js";

const configurado = Boolean(env.push.publicKey && env.push.privateKey);
if (configurado) webpush.setVapidDetails(env.push.subject, env.push.publicKey, env.push.privateKey);

const errorHttp = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const LLAMADAS = new Map();

function limitar(ip) {
  const ahora = Date.now();
  const historial = (LLAMADAS.get(ip) ?? []).filter((t) => ahora - t < 60000);
  if (historial.length >= 12) throw errorHttp(429, "Espera un momento antes de modificar los avisos.");
  historial.push(ahora);
  LLAMADAS.set(ip, historial);
  if (LLAMADAS.size > 10000) LLAMADAS.clear();
}

function origenPermitido(req) {
  try { return new URL(req.get("origin")).origin === new URL(env.frontendUrl).origin; }
  catch { return false; }
}

export function validarSuscripcion(datos) {
  const endpoint = datos?.endpoint;
  const p256dh = datos?.keys?.p256dh;
  const auth = datos?.keys?.auth;
  let url;
  try { url = new URL(endpoint); } catch { throw errorHttp(400, "La suscripción del navegador no es válida."); }
  const host = url.hostname.toLowerCase();
  const aprobado = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com", "android.googleapis.com"]
    .includes(host) || host.endsWith(".notify.windows.com") || host.endsWith(".push.apple.com");
  if (url.protocol !== "https:" || url.port || url.username || url.password || !aprobado ||
      endpoint.length > 2048 || !/^[\w-]{60,200}$/.test(p256dh ?? "") || !/^[\w-]{12,100}$/.test(auth ?? "")) {
    throw errorHttp(400, "La suscripción del navegador no es válida.");
  }
  return { endpoint, p256dh, auth };
}

export function configurarRutasAlertas(router, db) {
  router.use((req, res, next) => {
    if (!req.usuario?.id) return res.status(401).json({ message: "Inicia sesión para gestionar tus favoritos y alertas." });
    next();
  });
  router.get("/alertas/favoritos", async (req, res) => {
    const { rows } = await db.query(`SELECT f.* FROM push_favoritos f JOIN push_suscripciones s ON s.id=f.id_suscripcion WHERE s.id_usuario=$1`, [req.usuario.id]);
    res.json({ data: rows });
  });
  router.get("/alertas/configuracion", (_req, res) => {
    res.set("Cache-Control", "public, max-age=300");
    res.json({ disponible: configurado, clavePublica: configurado ? env.push.publicKey : null });
  });
  router.put("/alertas/suscripcion", async (req, res) => {
    if (!configurado) throw errorHttp(503, "Los avisos aún no están configurados.");
    if (!origenPermitido(req)) throw errorHttp(403, "Origen no permitido.");
    limitar(req.ip);
    const { endpoint, p256dh, auth } = validarSuscripcion(req.body?.suscripcion);
    const favoritos = req.body?.favoritos;
    if (!Array.isArray(favoritos) || favoritos.length === 0 || favoritos.length > 50) throw errorHttp(400, "Selecciona hasta 50 favoritos.");
    for (const f of favoritos) {
      if (!/^[\w-]{1,100}$/.test(f?.codigo ?? "") || !/^[\w-]{1,50}$/.test(f?.combustible ?? "") ||
          !/^[\w-]{1,50}$/.test(f?.modalidad ?? "") ||
          (f.objetivo != null && f.objetivo !== "" && (!/^\d{1,6}(?:\.\d{1,2})?$/.test(String(f.objetivo)) || Number(f.objetivo) <= 0))) {
        throw errorHttp(400, "Hay un favorito no válido.");
      }
    }
    const cliente = await db.connect();
    try {
      await cliente.query("BEGIN");
      const { rows: [suscripcion] } = await cliente.query(`
        INSERT INTO push_suscripciones(endpoint,p256dh,auth,id_usuario) VALUES($1,$2,$3,$4)
        ON CONFLICT(endpoint) DO UPDATE SET p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth,
          fecha_actualizacion=CURRENT_TIMESTAMP WHERE push_suscripciones.id_usuario=EXCLUDED.id_usuario RETURNING id
      `, [endpoint, p256dh, auth, req.usuario.id]);
      if (!suscripcion) throw errorHttp(409, "Este navegador tiene una suscripción de otra cuenta. Desactívala desde esa cuenta primero.");
      await cliente.query("DELETE FROM push_favoritos WHERE id_suscripcion=$1", [suscripcion.id]);
      for (const f of favoritos) {
        const valido = await cliente.query(`
          SELECT 1 FROM gasolineras g
          JOIN combustibles_gasolinera cg ON cg.id_gasolinera=g.id AND cg.activo=TRUE
          JOIN tipos_combustible tc ON tc.id=cg.id_tipo_combustible AND tc.activo=TRUE
          JOIN modalidades_servicio ms ON ms.codigo=$3 AND ms.activo=TRUE
          WHERE g.codigo=$1 AND g.activo=TRUE AND g.visible_publico=TRUE AND tc.codigo=$2
        `, [f.codigo, f.combustible, f.modalidad]);
        if (!valido.rowCount) throw errorHttp(400, "Un favorito ya no está disponible.");
        await cliente.query(`INSERT INTO push_favoritos
          (id_suscripcion,codigo_gasolinera,codigo_combustible,codigo_modalidad,precio_objetivo)
          VALUES($1,$2,$3,$4,$5) ON CONFLICT (id_suscripcion,codigo_gasolinera,codigo_combustible,codigo_modalidad) DO UPDATE SET precio_objetivo=EXCLUDED.precio_objetivo`,
        [suscripcion.id, f.codigo, f.combustible, f.modalidad, f.objetivo || null]);
      }
      await cliente.query("COMMIT");
      res.json({ guardado: true });
    } catch (error) { await cliente.query("ROLLBACK"); throw error; }
    finally { cliente.release(); }
  });
  router.delete("/alertas/suscripcion", async (req, res) => {
    if (!origenPermitido(req)) throw errorHttp(403, "Origen no permitido.");
    limitar(req.ip);
    const { endpoint } = validarSuscripcion(req.body?.suscripcion);
    await db.query("DELETE FROM push_suscripciones WHERE endpoint=$1 AND id_usuario=$2", [endpoint, req.usuario.id]);
    res.json({ eliminado: true });
  });
}

export function iniciarTrabajadorAlertas(db, { enviar = webpush.sendNotification.bind(webpush), habilitado = configurado, automatico = true } = {}) {
  if (!habilitado) return () => {};
  let trabajando = false;
  async function ejecutar() {
    if (trabajando) return;
    trabajando = true;
    let bloqueo;
    try {
      bloqueo = await db.connect();
      const { rows: [estadoBloqueo] } = await bloqueo.query("SELECT pg_try_advisory_lock(20260922, 1) AS obtenido");
      if (!estadoBloqueo.obtenido) return;
      const { rows: eventos } = await db.query(`
        SELECT e.id, e.fecha_creacion, pc.precio, pc.unidad_medida, g.codigo AS codigo_gasolinera,
          g.nombre AS nombre_gasolinera, tc.codigo AS codigo_combustible, tc.nombre AS nombre_combustible,
          ms.codigo AS codigo_modalidad, (g.activo AND g.visible_publico) AS publicado
        FROM push_eventos e JOIN precios_combustible pc ON pc.id=e.id_precio
        JOIN combustibles_gasolinera cg ON cg.id=pc.id_combustible_gasolinera
        JOIN gasolineras g ON g.id=cg.id_gasolinera
        JOIN tipos_combustible tc ON tc.id=cg.id_tipo_combustible
        JOIN modalidades_servicio ms ON ms.id=pc.id_modalidad_servicio
        WHERE e.procesado=FALSE ORDER BY e.id LIMIT 10
      `);
      for (const evento of eventos) {
        if (!evento.publicado || Date.now() - new Date(evento.fecha_creacion).getTime() > 86400000) {
          await db.query("UPDATE push_eventos SET procesado=TRUE WHERE id=$1", [evento.id]);
          continue;
        }
        const { rows: destinos } = await db.query(`
          SELECT s.id, s.endpoint, s.p256dh, s.auth FROM push_favoritos f
          JOIN push_suscripciones s ON s.id=f.id_suscripcion
          JOIN usuarios u ON u.id=s.id_usuario AND u.activo=TRUE
          LEFT JOIN push_entregas d ON d.id_evento=$1 AND d.id_suscripcion=s.id
          WHERE f.codigo_gasolinera=$2 AND f.codigo_combustible=$3 AND f.codigo_modalidad=$4
            AND (f.precio_objetivo IS NULL OR $5::NUMERIC <= f.precio_objetivo)
            AND s.fecha_actualizacion <= $6::TIMESTAMPTZ
            AND d.id_evento IS NULL
        `, [evento.id, evento.codigo_gasolinera, evento.codigo_combustible, evento.codigo_modalidad, evento.precio, evento.fecha_creacion]);
        let errorTemporal = false;
        for (const destino of destinos) {
          try {
            const reserva = await db.query("INSERT INTO push_entregas(id_evento,id_suscripcion) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id_evento", [evento.id, destino.id]);
            if (!reserva.rowCount) continue;
            await enviar({ endpoint: destino.endpoint,
              keys: { p256dh: destino.p256dh, auth: destino.auth } }, JSON.stringify({
              titulo: `Bajó ${evento.nombre_combustible} en ${evento.nombre_gasolinera}`,
              cuerpo: `Nuevo precio: Q${Number(evento.precio).toFixed(2)} por ${evento.unidad_medida === "galon" ? "galón" : evento.unidad_medida}`,
              codigo: evento.codigo_gasolinera,
            }), { TTL: 86400 });
            await db.query("INSERT INTO push_entregas(id_evento,id_suscripcion) VALUES($1,$2) ON CONFLICT DO NOTHING", [evento.id, destino.id]);
          } catch (error) {
            if ([404, 410].includes(error.statusCode)) await db.query("DELETE FROM push_suscripciones WHERE id=$1", [destino.id]);
            else {
              // Retry only a definitive rejection; ambiguous network failures retain the claim.
              if (error.statusCode === 429 || error.statusCode >= 500) {
                await db.query("DELETE FROM push_entregas WHERE id_evento=$1 AND id_suscripcion=$2", [evento.id, destino.id]);
                errorTemporal = true;
              }
            }
          }
        }
        if (!errorTemporal) await db.query("UPDATE push_eventos SET procesado=TRUE WHERE id=$1", [evento.id]);
      }
    } catch (error) { console.error("Error al procesar avisos de precio:", error.message); }
    finally {
      if (bloqueo) {
        await bloqueo.query("SELECT pg_advisory_unlock(20260922, 1)").catch(() => {});
        bloqueo.release();
      }
      trabajando = false;
    }
  }
  if (!automatico) return ejecutar;
  const temporizador = setInterval(ejecutar, 30000);
  temporizador.unref();
  ejecutar();
  return () => clearInterval(temporizador);
}


