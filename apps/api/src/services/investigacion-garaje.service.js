import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { faltantesFicha } from './evidencias-vehiculos.js';

const fallo = (statusCode, message) => Object.assign(new Error(message), { statusCode });
export function ejecutarInvestigacion(consulta, usuarioId, progreso, { plazoMs = 180000, crearProceso = fork } = {}) {
  return new Promise((resolve, reject) => {
    const hijo = crearProceso(fileURLToPath(new URL('./investigacion-proceso.js', import.meta.url)), [], {
      windowsHide: true, execArgv: ['--max-old-space-size=512'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    let terminado = false;
    function terminar(error, resultado) {
      if (terminado) return;
      terminado = true; clearTimeout(limite); hijo.kill();
      if (error) reject(error); else resolve(resultado);
    }
    const limite = setTimeout(() => terminar(fallo(504, 'La investigación alcanzó el límite de tres minutos. Puedes reintentar.')), plazoMs);
    hijo.on('message', mensaje => {
      if (terminado) return;
      if (typeof mensaje?.progreso === 'string') progreso(mensaje.progreso.slice(0, 180));
      if (mensaje?.resultado) terminar(null, mensaje.resultado);
      if (mensaje?.error) terminar(fallo(mensaje.error.statusCode, mensaje.error.message));
    });
    hijo.once('error', () => terminar(fallo(503, 'No se pudo iniciar el servicio de investigación.')));
    hijo.once('exit', () => terminar(fallo(503, 'La investigación se interrumpió. Puedes reintentar.')));
    hijo.send({ consulta, usuarioId });
  });
}

export function crearInvestigacionGaraje(db, { ejecutar = ejecutarInvestigacion, ahora = Date.now } = {}) {
  const trabajos = new Map(), intentos = new Map();
  let ocupado = false;
  function acceso(usuario, id) {
    if (!usuario?.id) throw fallo(401, 'Inicia sesión para investigar tu vehículo.');
    if (usuario.rol !== 'conductor') throw fallo(403, 'Selecciona un vehículo de tu garaje.');
    if (!/^[1-9]\d{0,17}$/.test(String(id ?? ''))) throw fallo(400, 'Vehículo inválido.');
  }
  async function vehiculo(usuario, id) {
    acceso(usuario, id);
    const { rows: [v] } = await db.query(`SELECT v.id, v.ficha_personal, v.complemento_personal, v.anio_declarado, c.ficha
      FROM vehiculos_usuario v LEFT JOIN catalogo_vehiculos c ON c.id=v.id_catalogo
      WHERE v.id=$1 AND v.id_usuario=$2`, [id, usuario.id]);
    if (!v) throw fallo(404, 'No encontramos el vehículo en tu garaje.');
    const fichaBase = v.ficha_personal ?? v.ficha;
    return { id: v.id, ficha: { ...fichaBase,
      ...(v.complemento_personal ? { complemento: v.complemento_personal } : {}),
      ...(v.anio_declarado ? { anio: v.anio_declarado } : {}) } };
  }
  async function iniciar(usuario, id) {
    const v = await vehiculo(usuario, id);
    const f = v.ficha;
    if (!f?.marca || !f.modelo || !f.anio) throw fallo(400, 'Completa marca, modelo y año antes de investigar.');
    // La ficha del catálogo tiene prioridad; las propuestas previas siguen pendientes de revisión.
    const camposPendientes = faltantesFicha(f);
    if (!camposPendientes.length) return { id: null, estado: 'terminada',
      progreso: 'La ficha del catálogo ya contiene los datos técnicos disponibles. No fue necesario consultar proveedores adicionales.' };
    for (const [k, t] of trabajos) if (t.expira <= ahora() && t.estado !== 'investigando') trabajos.delete(k);
    for (const [k, t] of intentos) if (t.hasta <= ahora()) intentos.delete(k);
    if (ocupado || trabajos.size >= 100 || intentos.size >= 2000) throw fallo(429, 'El servicio está ocupado. Reintenta más tarde.');
    const clave = String(usuario.id), intento = intentos.get(clave) ?? { cantidad: 0, hasta: ahora() + 600000 };
    if (intento.cantidad >= 3) throw fallo(429, 'Puedes investigar hasta tres vehículos cada diez minutos.');
    intento.cantidad++; intentos.set(clave, intento); ocupado = true;
    const trabajo = { id: randomUUID(), usuarioId: clave, vehiculoId: String(id), estado: 'investigando',
      progreso: 'Iniciando investigación del vehículo seleccionado.', expira: ahora() + 600000 };
    trabajos.set(trabajo.id, trabajo);
    const consulta = { tipo: f.tipo ?? 'auto', marca: f.marca, modelo: f.modelo, anio: f.anio,
      version: f.version ?? '', mercado: f.mercado ?? '', camposPendientes };
    void (async () => {
      try {
        const resultado = await ejecutar(consulta, clave, texto => { trabajo.progreso = texto; });
        // El catálogo puede actualizarse durante la investigación: nunca sustituir sus valores.
        const actual = await vehiculo(usuario, id);
        if (['tipo', 'marca', 'modelo', 'anio', 'version', 'mercado'].some(campo =>
          String(actual.ficha?.[campo] ?? (campo === 'tipo' ? 'auto' : '')) !== String(consulta[campo]))) {
          throw fallo(409, 'La versión del vehículo cambió durante la investigación. Reintenta con la ficha actual.');
        }
        const pendientesActuales = faltantesFicha(actual.ficha);
        const datos = (resultado.datos ?? []).filter(d => camposPendientes.includes(d.campo) && pendientesActuales.includes(d.campo));
        // Una coincidencia literal no confirma año, mercado ni configuración.
        const complemento = { ...resultado, origen: 'investigacion', actualizadoEn: new Date(ahora()).toISOString(),
          datos: datos.map(d => ({ ...d, estado: 'pendiente_revision', alcance: 'modelo' })),
          faltantes: faltantesFicha(actual.ficha, datos) };
        // La investigación se guarda separada: jamás congela ni reemplaza la ficha del catálogo.
        const { rowCount } = await db.query('UPDATE vehiculos_usuario SET complemento_personal=$3::jsonb WHERE id=$1 AND id_usuario=$2',
          [id, usuario.id, JSON.stringify(complemento)]);
        if (!rowCount) throw fallo(404, 'El vehículo fue eliminado durante la investigación.');
        trabajo.estado = 'terminada'; trabajo.resultado = complemento;
        trabajo.progreso = 'Investigación terminada. Revisa fuentes, contradicciones y campos pendientes.';
      } catch (error) {
        trabajo.estado = 'error'; trabajo.progreso = error.statusCode ? error.message : 'No fue posible guardar la investigación. Puedes reintentar.';
      } finally { ocupado = false; trabajo.expira = ahora() + 600000; }
    })();
    return { id: trabajo.id, estado: trabajo.estado, progreso: trabajo.progreso };
  }
  async function consultar(usuario, id, trabajoId) {
    await vehiculo(usuario, id);
    const t = trabajos.get(trabajoId);
    if (!t || t.expira <= ahora() || t.usuarioId !== String(usuario.id) || t.vehiculoId !== String(id)) {
      throw fallo(404, 'La consulta de progreso expiró o no te pertenece.');
    }
    return { id: t.id, estado: t.estado, progreso: t.progreso, resultado: t.resultado };
  }
  return { iniciar, consultar };
}
