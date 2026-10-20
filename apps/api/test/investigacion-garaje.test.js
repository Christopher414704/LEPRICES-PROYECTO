import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { crearInvestigacionGaraje, ejecutarInvestigacion } from '../src/services/investigacion-garaje.service.js';

const usuario = { id: '1', rol: 'conductor' };
const ficha = { tipo: 'moto', marca: 'Suzuki', modelo: 'GN125', anio: 2022, version: 'F', motorCc: 125 };
const resultado = { fuentes: [{ id: 'f', url: 'https://suzuki.com.gt/manual.pdf', titulo: 'Manual' }],
  datos: [{ campo: 'motorCc', valor: 125, estado: 'confirmado', alcance: 'version', fuenteId: 'f',
    urlFuente: 'https://suzuki.com.gt/manual.pdf', cita: 'Engine displacement: 125 cc.' }],
  conflictos: [{ campo: 'transmision', opciones: [] }], faltantes: ['combustible'] };
function base() {
  let guardada, actual = { ...ficha };
  const llamadas = [];
  return { llamadas, get guardada() { return guardada; }, cambiar(f) { actual = f; },
    async query(sql, parametros) {
      llamadas.push({ sql, parametros });
      if (sql.startsWith('UPDATE')) { guardada = JSON.parse(parametros[2]); return { rowCount: 1 }; }
      return { rows: parametros[1] === '1' && parametros[0] === '7' ? [{ id: '7', ficha: actual }] : [] };
    } };
}
const esperar = () => new Promise(resolve => setImmediate(resolve));
test('requiere vehículo seleccionado del propietario y toma identidad del servidor', async () => {
  const db = base(); let recibida, liberar;
  const servicio = crearInvestigacionGaraje(db, { ejecutar: async (consulta, id, informar) => {
    recibida = { consulta, id }; informar('Leyendo manual permitido.');
    return new Promise(resolve => { liberar = resolve; });
  } });
  await assert.rejects(servicio.iniciar(null, '7'), { statusCode: 401 });
  await assert.rejects(servicio.iniciar({ ...usuario, rol: 'administrador' }, '7'), { statusCode: 403 });
  await assert.rejects(servicio.iniciar({ ...usuario, id: '2' }, '7'), { statusCode: 404 });
  await assert.rejects(servicio.iniciar(usuario, '../7'), { statusCode: 400 });
  const trabajo = await servicio.iniciar(usuario, '7');
  assert.equal(trabajo.estado, 'investigando');
  assert.deepEqual(recibida.consulta, { tipo: 'moto', marca: 'Suzuki', modelo: 'GN125', anio: 2022, version: 'F', mercado: '' });
  assert.equal(recibida.id, '1');
  await assert.rejects(servicio.iniciar(usuario, '7'), { statusCode: 429 });
  assert.match((await servicio.consultar(usuario, '7', trabajo.id)).progreso, /Leyendo/);
  await assert.rejects(servicio.consultar({ ...usuario, id: '2' }, '7', trabajo.id), { statusCode: 404 });
  db.cambiar({ ...ficha, notaPersonal: 'Conservar' });
  liberar(resultado); await esperar();
  const fin = await servicio.consultar(usuario, '7', trabajo.id);
  assert.equal(fin.estado, 'terminada');
  assert.deepEqual(db.guardada.complemento.fuentes, resultado.fuentes);
  assert.equal(db.guardada.complemento.datos[0].estado, 'pendiente_revision');
  assert.equal(db.guardada.complemento.datos[0].alcance, 'modelo');
  assert.equal(db.guardada.notaPersonal, 'Conservar');
  assert.equal(db.guardada.motorCc, 125);
  assert.equal(db.guardada.complemento.conflictos.length, 1);
});

test('año requerido, errores no escriben datos y límite por cuenta sobrevive al proceso', async () => {
  const db = base(); db.cambiar({ ...ficha, anio: null });
  const servicio = crearInvestigacionGaraje(db, { ejecutar: async () => { throw Object.assign(new Error('Fuente no disponible'), { statusCode: 503 }); } });
  await assert.rejects(servicio.iniciar(usuario, '7'), { statusCode: 400 });
  db.cambiar(ficha);
  for (let i = 0; i < 3; i++) {
    const t = await servicio.iniciar(usuario, '7'); await esperar();
    assert.equal((await servicio.consultar(usuario, '7', t.id)).estado, 'error');
  }
  assert.equal(db.guardada, undefined);
  await assert.rejects(servicio.iniciar(usuario, '7'), { statusCode: 429 });
});

test('proceso acotado se termina al vencer el plazo o completar la investigación', async () => {
  let hijo, opciones, muertes = 0;
  const crearProceso = (_ruta, _args, opts) => {
    opciones = opts; hijo = new EventEmitter(); hijo.send = () => {}; hijo.kill = () => { muertes++; }; return hijo;
  };
  await assert.rejects(ejecutarInvestigacion(ficha, '1', () => {}, { crearProceso, plazoMs: 5 }), { statusCode: 504 });
  assert.equal(muertes, 1); assert.deepEqual(opciones.execArgv, ['--max-old-space-size=512']);
  const tarea = ejecutarInvestigacion(ficha, '1', () => {}, { crearProceso });
  hijo.emit('message', { resultado });
  assert.deepEqual(await tarea, resultado); assert.equal(muertes, 2);
});
