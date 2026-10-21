import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearVisorCatalogo } from '../src/catalogo-tecnico.js';

function nodo(tag = 'div') {
  return { tag, children: [], disabled: false, append(...hijos) { this.children.push(...hijos); },
    replaceChildren(...hijos) { this.children = hijos; } };
}

function preparar(t, consultar) {
  const anterior = globalThis.document;
  globalThis.document = { createElement: tag => nodo(tag) };
  t.after(() => { globalThis.document = anterior; });
  const boton = nodo('button'), estado = nodo('p'), resultado = nodo();
  return { boton, estado, resultado, visor: crearVisorCatalogo({ boton, estado, resultado, consultar }) };
}

test('HU-29 consulta la versión seleccionada y presenta su ficha como referencia', async t => {
  let id;
  const ui = preparar(t, async seleccionado => { id = seleccionado; return { proveedor: 'fueleconomy', idExterno: seleccionado,
    marca: 'Toyota', modelo: '<Corolla>', anio: 2020, motorLitros: 1.8, consumo: { combinado: 7.13 },
    urlFuente: 'https://www.fueleconomy.gov/feg/Find.do?id=41217' }; });
  assert.equal(ui.boton.disabled, true);
  ui.visor.seleccionar('41217');
  await ui.boton.onclick();
  assert.equal(id, '41217');
  assert.equal(ui.resultado.children[0].textContent, 'Toyota <Corolla> · 2020');
  assert.equal(ui.resultado.children[1].tag, 'section');
  assert.match(ui.estado.textContent, /referencia del modelo/);
  assert.equal(ui.boton.disabled, false);
});

test('HU-29 limpia fichas anteriores, informa errores y descarta respuestas obsoletas', async t => {
  let resolver;
  const ui = preparar(t, id => id === '1' ? new Promise(r => { resolver = r; }) : Promise.reject(new Error('Catálogo no disponible')));
  ui.visor.seleccionar('1');
  const anterior = ui.boton.onclick();
  ui.visor.seleccionar('2');
  resolver({ marca: 'Anterior', modelo: 'Obsoleto', anio: 2000, consumo: {} });
  await anterior;
  assert.equal(ui.resultado.children.length, 0);
  await ui.boton.onclick();
  assert.match(ui.estado.textContent, /no disponible/);
  assert.equal(ui.boton.disabled, false);
  ui.visor.seleccionar('');
  assert.equal(ui.boton.disabled, true);
});
