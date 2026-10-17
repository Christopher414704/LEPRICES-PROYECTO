import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const fallo = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const directorio = fileURLToPath(new URL('../../', import.meta.url));
const script = fileURLToPath(new URL('../../python/simular_ruta.py', import.meta.url));
const pythonLocal = fileURLToPath(new URL(process.platform === 'win32' ? '../../.venv-fastsim/Scripts/python.exe' : '../../.venv-fastsim/bin/python', import.meta.url));

export function validarSimulacion(datos, numero) {
  if ((datos.modeloConsumo ?? 'consumo') === 'consumo') return null;
  if (datos.modeloConsumo !== 'fastsim') throw fallo(400, 'Selecciona un modelo de consumo válido.');
  if (datos.distanciaModo !== 'api') throw fallo(400, 'La simulación necesita una ruta por carretera con velocidades por tramo.');
  if (datos.ajustarSubidas) throw fallo(400, 'FASTSim ya calcula las pendientes; no añadas también el ajuste por subidas.');
  const s = datos.simulacion;
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw fallo(400, 'Completa los parámetros de simulación.');
  if (!['combinado', 'carretera', 'constante'].includes(s.referencia) || typeof s.incluirRelieve !== 'boolean') throw fallo(400, 'Selecciona la referencia de consumo y el uso de relieve.');
  const masaKg = numero(s.masaKg, 100, 10000, 'Peso de referencia'), cargaExtraKg = numero(s.cargaExtraKg ?? 0, 0, 2000, 'Carga adicional');
  if (masaKg + cargaExtraKg > 10000) throw fallo(400, 'El peso total supera el límite del simulador.');
  return { masaKg, cargaExtraKg, cda: numero(s.cda, .1, 3, 'Área aerodinámica Cd × A'),
    potenciaKw: numero(s.potenciaKw, 5, 1500, 'Potencia del motor'), rodadura: numero(s.rodadura, .004, .03, 'Coeficiente de rodadura'),
    velocidadMaxima: numero(s.velocidadMaxima, 20, 110, 'Techo de velocidad'), referencia: s.referencia,
    velocidadReferencia: s.referencia === 'constante' ? numero(s.velocidadReferencia, 20, 110, 'Velocidad del consumo de referencia') : null,
    incluirRelieve: s.incluirRelieve, minutosMotorEncendido: numero(s.minutosMotorEncendido ?? 0, 0, 180, 'Paradas adicionales con motor encendido') };
}

export function crearSimulador({ spawnFn = spawn, python = process.env.RUTAS_FASTSIM_PYTHON || pythonLocal, timeoutMs = 20000 } = {}) {
  let activos = 0;
  async function simular(data) {
    if (activos >= 2) throw fallo(429, 'El simulador está ocupado. Reintenta en un momento.');
    const entrada = JSON.stringify(data);
    if (Buffer.byteLength(entrada) > 4_000_000) throw fallo(422, 'Divide el recorrido en etapas más cortas.');
    activos++;
    try {
      return await new Promise((resolve, reject) => {
        // Ejecutable y script fijados por servidor, sin shell ni argumentos del cliente.
        const hijo = spawnFn(python, ['-I', script], { cwd: directorio, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        let salida = '', bytes = 0, resuelto = false;
        const terminar = (e, data) => { if (resuelto) return; resuelto = true; clearTimeout(timer); e ? reject(e) : resolve(data); };
        const timer = setTimeout(() => { hijo.kill(); terminar(fallo(503, 'El simulador tardó demasiado. Divide el viaje en etapas o usa el presupuesto por consumo.')); }, timeoutMs);
        hijo.on('error', () => terminar(fallo(503, 'FASTSim no está disponible en el servidor. Usa presupuesto por consumo o instala el motor según docs/rutas.md.')));
        hijo.stdin.on('error', () => {});
        hijo.stderr.on('data', () => {}); // No se exponen rutas internas ni diagnósticos del proceso.
        hijo.stdout.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > 100_000) { hijo.kill(); terminar(fallo(503, 'Respuesta del simulador inválida.')); return; }
          salida += chunk.toString();
        });
        hijo.on('close', code => {
          try {
            const json = JSON.parse(salida);
            if (code !== 0 || json.error) return terminar(fallo(422, typeof json.error === 'string' ? json.error.slice(0, 400) : 'El escenario de conducción no pudo simularse.'));
            const r = json.data;
            if (r?.motor !== 'FASTSim 3.1.0' || !Number.isFinite(r.litros) || r.litros <= 0 || r.litros > 10000 || !Array.isArray(r.tramos)) throw new Error();
            terminar(null, r);
          } catch { terminar(fallo(503, 'FASTSim no devolvió una simulación válida. Comprueba la instalación del motor.')); }
        });
        hijo.stdin.end(entrada);
      });
    } finally { activos--; }
  }
  return { simular };
}
export const simuladorConsumo = crearSimulador();
