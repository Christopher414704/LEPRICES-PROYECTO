import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { crearInvestigacionGaraje, ejecutarInvestigacion } from '../src/services/investigacion-garaje.service.js';
import * as migracionComplemento from '../../../database/migrations/0022_separar_complemento_vehicular.mjs';

const usuario = { id: '1', rol: 'conductor' };
const ficha = { tipo: 'moto', marca: 'Suzuki', modelo: 'GN125', anio: 2022, version: 'F', motorCc: 125 };
const resultado = { fuentes: [{ id: 'f', url: 'https://suzuki.com.gt/manual.pdf', titulo: 'Manual' }],
  datos: [{ campo: 'transmision', valor: 'Manual', estado: 'confirmado', alcance: 'version', fuenteId: 'f',
    urlFuente: 'https://suzuki.com.gt/manual.pdf', cita: 'Transmission: Manual.' }],
  conflictos: [{ campo: 'transmision', opciones: [] }], faltantes: ['combustible'] };
function base() {
  let guardada, complemento, actual = { ...ficha };
  const llamadas = [];
  return { llamadas, get guardada() { return guardada; }, cambiar(f) { actual = f; },
    async query(sql, parametros) {
      llamadas.push({ sql, parametros });
      if (sql.startsWith('UPDATE')) { complemento = JSON.parse(parametros[2]); guardada = { ...actual, complemento }; return { rowCount: 1 }; }
      return { rows: parametros[1] === '1' && parametros[0] === '7' ? [{ id: '7', ficha: actual, complemento_personal: complemento }] : [] };
    } };
}
const esperar = () => new Promise(resolve => setImmediate(resolve));
test('la migración agrega un complemento separado sin relajar la restricción del origen', () => {
  const sentencias=[];
  migracionComplemento.up({sql: texto => sentencias.push(texto)});
  assert.match(sentencias[0], /ADD COLUMN complemento_personal JSONB/);
  assert.match(sentencias[0], /jsonb_typeof\(complemento_personal\) = 'object'/);
  assert.doesNotMatch(sentencias[0], /DROP CONSTRAINT vehiculo_origen/);
});
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
  assert.deepEqual(recibida.consulta, { tipo: 'moto', marca: 'Suzuki', modelo: 'GN125', anio: 2022, version: 'F', mercado: '',
    camposPendientes: ['cilindros', 'transmision', 'traccion', 'combustible', 'consumoCiudadL100', 'consumoCarreteraL100', 'consumoCombinadoL100'] });
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
  assert.match(db.llamadas.find(c => c.sql.startsWith('UPDATE')).sql, /SET complemento_personal=/);
});

test('HU-40 ficha completa conserva el catálogo y no consume el proveedor ni cuota', async () => {
  const db = base(); let llamadas = 0;
  db.cambiar({ ...ficha, cilindros: 1, transmision: 'Manual', traccion: '2x2', combustible: 'Gasolina',
    consumo: { ciudad: 3, carretera: 2.5, combinado: 2.8 } });
  const servicio = crearInvestigacionGaraje(db, { ejecutar: async () => { llamadas++; } });
  for (let i = 0; i < 4; i++) {
    const trabajo = await servicio.iniciar(usuario, '7');
    assert.equal(trabajo.estado, 'terminada');
    assert.equal(trabajo.id, null);
    assert.match(trabajo.progreso, /catálogo/);
  }
  assert.equal(llamadas, 0);
  assert.equal(db.guardada, undefined);
});

test('ficha eléctrica completa no investiga cilindrada ni consumo de combustible', async () => {
  const db = base(); let llamadas = 0;
  db.cambiar({ tipo: 'auto', marca: 'Demo', modelo: 'EV', anio: 2025, combustible: 'Electricity',
    transmision: 'Automática', traccion: 'AWD' });
  const servicio = crearInvestigacionGaraje(db, { ejecutar: async () => { llamadas++; } });
  assert.equal((await servicio.iniciar(usuario, '7')).estado, 'terminada');
  assert.equal(llamadas, 0);
});

test('HU-40 solo almacena propuestas para campos todavía faltantes y conserva el resto', async () => {
  const db = base(); let liberar, consulta;
  const servicio = crearInvestigacionGaraje(db, { ejecutar: c => { consulta = c; return new Promise(resolve => { liberar = resolve; }); } });
  const trabajo = await servicio.iniciar(usuario, '7');
  assert.ok(!consulta.camposPendientes.includes('motorCc'));
  assert.ok(!consulta.camposPendientes.includes('motorLitros'));
  db.cambiar({ ...ficha, combustible: 'Gasolina', notaPersonal: 'Preservar' });
  liberar({ ...resultado, datos: [
    { campo: 'motorCc', valor: 150 }, { campo: 'combustible', valor: 'Diésel' },
    { campo: 'transmision', valor: 'Manual', fuenteId: 'f', cita: 'Transmisión: Manual.' },
  ] });
  await esperar();
  assert.equal((await servicio.consultar(usuario, '7', trabajo.id)).estado, 'terminada');
  assert.deepEqual(db.guardada.complemento.datos.map(d => d.campo), ['transmision']);
  assert.equal(db.guardada.combustible, 'Gasolina');
  assert.equal(db.guardada.notaPersonal, 'Preservar');
  assert.ok(!db.guardada.complemento.faltantes.includes('motorCc'));
  assert.ok(!db.guardada.complemento.faltantes.includes('combustible'));
  assert.deepEqual(db.guardada.complemento.fuentes, resultado.fuentes);
});

test('HU-40 no asocia resultados a otra versión si la ficha cambia durante la búsqueda', async () => {
  const db = base(); let liberar;
  const servicio = crearInvestigacionGaraje(db, { ejecutar: () => new Promise(resolve => { liberar = resolve; }) });
  const trabajo = await servicio.iniciar(usuario, '7');
  db.cambiar({ ...ficha, version: 'Sport' });
  liberar(resultado); await esperar();
  const fin = await servicio.consultar(usuario, '7', trabajo.id);
  assert.equal(fin.estado, 'error');
  assert.match(fin.progreso, /versión del vehículo cambió/);
  assert.equal(db.guardada, undefined);
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
