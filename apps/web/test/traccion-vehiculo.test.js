import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clasificarTraccion, interpretarTraccion, crearDiagramaTraccion } from '../src/traccion-vehiculo.js';

test('HU-35 distingue ejes motrices, AWD y 4WD sin inferir a partir de 4x2', () => {
  for (const [valor, esperado] of [
    ['Front-Wheel Drive', 'delantera'], ['FWD', 'delantera'], ['Rear-Wheel Drive', 'trasera'],
    ['RWD', 'trasera'], ['All-Wheel Drive', 'awd'], ['AWD', 'awd'],
    ['4-Wheel Drive', '4wd'], ['Part-time 4-Wheel Drive', '4wd'], ['4x4', '4wd'],
    ['4x2', null], ['2-Wheel Drive', null], ['4-Wheel or All-Wheel Drive', null],
    ['2WD / 4WD', null], ['AWD / 4WD', null], ['FWD / RWD', null], ['Tracción no indicada', null]
  ]) assert.equal(clasificarTraccion(valor), esperado, valor);
  assert.deepEqual(interpretarTraccion({ tipo: 'auto', traccion: 'AWD', proveedor: 'fueleconomy', urlFuente: 'https://www.fueleconomy.gov/ficha' }).ruedas,
    { delanteraIzquierda: true, delanteraDerecha: true, traseraIzquierda: true, traseraDerecha: true });
  assert.equal(interpretarTraccion({ tipo: 'auto', traccion: 'AWD', proveedor: 'fueleconomy', urlFuente: 'https://www.fueleconomy.gov/ficha' }).titulo, 'Tracción integral AWD');
  assert.equal(interpretarTraccion({ tipo: 'auto', traccion: '4WD', proveedor: 'fueleconomy', urlFuente: 'https://www.fueleconomy.gov/ficha' }).titulo, 'Tracción 4WD');
});

test('HU-35 las contradicciones y referencias ambiguas nunca encienden una rueda', () => {
  for (const ficha of [
    { tipo: 'auto', traccion: '4x2' },
    { tipo: 'auto', traccion: 'FWD', complemento: { datos: [{ campo: 'traccion', valor: 'RWD' }] } },
    { tipo: 'auto', traccion: 'AWD', complemento: { datos: [{ campo: 'traccion', valor: '4WD' }] } },
    { tipo: 'auto', traccion: 'FWD', complemento: { conflictos: [{ campo: 'traccion', opciones: [] }] } }
  ]) {
    const dato = interpretarTraccion(ficha);
    assert.equal(dato.sistema, null);
    assert.ok(Object.values(dato.ruedas).every(valor => !valor));
    assert.notEqual(dato.estado, 'Confirmado para la versión');
  }
});

test('HU-35 motocicletas usan dos ruedas y solo resaltan la motriz explícita', () => {
  const trasera = interpretarTraccion({ tipo: 'moto', complemento: { datos: [{ campo: 'traccion', valor: 'Rueda trasera', cita: 'Tracción: rueda trasera.', urlFuente: 'https://fabricante.example/manual' }] } });
  assert.deepEqual(trasera.ruedas, { delantera: false, trasera: true });
  assert.equal(trasera.estado, 'Referencia documental pendiente de revisión');
  assert.deepEqual(interpretarTraccion({ tipo: 'moto', traccion: '2WD' }).ruedas,
    { delantera: false, trasera: false });
  assert.deepEqual(interpretarTraccion({ tipo: 'moto', traccion: '4x4' }).ruedas,
    { delantera: false, trasera: false });
});

test('HU-35 las propuestas documentales no se presentan como confirmadas sin versión y cita', () => {
  assert.equal(interpretarTraccion({ tipo: 'auto', traccion: 'FWD' }).sistema, null);
  assert.equal(interpretarTraccion({ tipo: 'auto', complemento: { datos: [{ campo: 'traccion', valor: 'FWD' }] } }).sistema, null);
  const dato = interpretarTraccion({ tipo: 'auto', complemento: { datos: [
    { campo: 'traccion', valor: 'FWD', estado: 'pendiente_revision', cita: 'Front-Wheel Drive', urlFuente: 'https://fabricante.example/ficha' }
  ] } });
  assert.equal(dato.sistema, 'delantera');
  assert.match(dato.estado, /pendiente de revisión/);
  const confirmada = interpretarTraccion({ tipo: 'auto', complemento: { datos: [
    { campo: 'traccion', valor: 'FWD', estado: 'confirmado', alcance: 'version', cita: 'Front-Wheel Drive', urlFuente: 'https://fabricante.example/ficha' }
  ] } });
  assert.equal(confirmada.estado, 'Confirmado para la versión');
});

test('HU-35 el diagrama accesible contiene dos o cuatro ruedas y marca solo las respaldadas', t => {
  const previo = globalThis.document;
  globalThis.document = { createElement(tag) { return { tag, hijos: [], append(...nodos) { this.hijos.push(...nodos); }, setAttribute(nombre, valor) { this[nombre] = valor; } }; } };
  t.after(() => { globalThis.document = previo; });
  const recorrer = nodo => [nodo, ...nodo.hijos.flatMap(recorrer)];
  const auto = crearDiagramaTraccion({ tipo: 'auto', traccion: 'FWD', proveedor: 'fueleconomy', urlFuente: 'https://www.fueleconomy.gov/ficha' });
  assert.match(auto['aria-label'], /Tracción delantera/);
  assert.equal(recorrer(auto).filter(n => n.className?.includes('diagrama-traccion__rueda--motriz')).length, 2);
  const moto = crearDiagramaTraccion({ tipo: 'moto', complemento: { datos: [{ campo: 'traccion', valor: 'Rueda trasera', cita: 'Tracción: rueda trasera.', urlFuente: 'https://fabricante.example/manual' }] } });
  assert.equal(recorrer(moto).filter(n => n.className?.includes('diagrama-traccion__rueda--motriz')).length, 1);
  const incierto = crearDiagramaTraccion({ tipo: 'auto', traccion: '4x2' });
  assert.equal(recorrer(incierto).filter(n => n.className?.includes('diagrama-traccion__rueda--motriz')).length, 0);
});
