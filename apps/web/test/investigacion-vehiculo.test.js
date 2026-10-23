import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearPanelInvestigacion } from '../src/investigacion-vehiculo.js';

function documento(t) {
  const previo = globalThis.document;
  globalThis.document = { createElement(tag) { return { tag, hijos: [], isConnected: true,
    append(...nodos) { this.hijos.push(...nodos); }, setAttribute() {} }; } };
  t.after(() => { globalThis.document = previo; });
}
test('exige año y presenta fuentes seguras y contradicciones sin interpretar HTML', t => {
  documento(t);
  const p = crearPanelInvestigacion({ ficha: { complemento: { origen: 'investigacion', conflictos: [{}], faltantes: ['motor'],
    fuentes: [{ url: 'javascript:alert(1)', titulo: 'Peligro' }, { url: 'https://fabricante.gt/manual.pdf', titulo: '<script>texto</script>' }] } } });
  assert.equal(p.hijos[2].disabled, true);
  assert.match(p.hijos[3].textContent, /1 contradicciones/);
  assert.equal(p.hijos[4].hijos.length, 1);
  assert.equal(p.hijos[4].hijos[0].hijos[0].textContent, '<script>texto</script>');
});
test('investiga el vehículo seleccionado y recarga al terminar; comunica fallos', async t => {
  documento(t); const llamadas = []; let recargas = 0;
  const p = crearPanelInvestigacion({ id: '7', ficha: { anio: 2022 } }, async (...args) => {
    llamadas.push(args); return { id: 'trabajo', estado: 'terminada', progreso: 'Lista' };
  }, async () => { recargas++; });
  await p.hijos[2].onclick();
  assert.equal(llamadas[0][0], '/vehiculos/7/investigacion');
  assert.equal(llamadas[0][1].body, '{}'); assert.equal(recargas, 1);
  const error = crearPanelInvestigacion({ id: '7', ficha: { anio: 2022 } }, async () => { throw new Error('Servicio no disponible'); });
  await error.hijos[2].onclick();
  assert.match(error.hijos[3].textContent, /Servicio no disponible/);
  assert.equal(error.hijos[2].disabled, false);
});
test('HU-40 una ficha completa informa el resultado sin recargar ni consultar otro proveedor', async t => {
  documento(t); let recargas = 0;
  const p = crearPanelInvestigacion({ id: '7', ficha: { anio: 2022 } }, async () => ({
    id: null, estado: 'terminada', progreso: 'La ficha del catálogo ya contiene los datos técnicos disponibles.'
  }), async () => { recargas++; });
  await p.hijos[2].onclick();
  assert.equal(recargas, 0);
  assert.match(p.hijos[3].textContent, /catálogo/);
});
