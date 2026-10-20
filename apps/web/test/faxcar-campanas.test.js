import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearPanelCampanas } from '../src/faxcar-campanas.js';
function documento(t) {
  const anterior = globalThis.document;
  globalThis.document = { createElement(tag) { return { tag, hijos: [], append(...n) { this.hijos.push(...n); },
    replaceChildren(...n) { this.hijos = n; }, setAttribute() {} }; } };
  t.after(() => { globalThis.document = anterior; });
}
const vacio = { estado: 'sin_coincidencias', campanas: [], identidad: { marca: 'Honda', modelo: 'Accord', anio: 2020 },
  mercado: 'Estados Unidos (NHTSA)', consultadoEn: '2026-10-20T12:00:00Z' };
test('consulta solo el vehículo seleccionado y diferencia ausencia de error; permite reintentar', async t => {
  documento(t); let error = false;
  const p = crearPanelCampanas({ id: '7' }, async id => {
    assert.equal(id, '7'); if (error) throw new Error('NHTSA no está disponible'); return vacio;
  });
  assert.match(p.hijos[1].textContent, /no confirman un defecto/);
  await p.hijos[2].onclick(); assert.match(p.hijos[3].textContent, /no devolvió campañas/);
  assert.match(p.hijos[4].hijos[0].textContent, /Honda Accord/);
  error = true; await p.hijos[2].onclick(); assert.match(p.hijos[3].textContent, /no está disponible/);
  assert.equal(p.hijos[4].hijos.length, 0); assert.equal(p.hijos[2].disabled, false);
});
test('renderiza texto oficial sin HTML y genera enlaces oficiales con avisos relevantes', async t => {
  documento(t);
  const p = crearPanelCampanas({ id: '7' }, async () => ({ ...vacio, estado: 'con_campanas', campanas: [{
    numero: '20V771000', componente: '<script>componente</script>', resumen: '<img src=x>',
    noConducir: true, estacionarAfuera: true, fuente: 'javascript:alert(1)' }] }));
  await p.hijos[2].onclick();
  const bloque = p.hijos[4].hijos[1];
  assert.match(bloque.hijos[0].textContent, /<script>/); assert.match(bloque.hijos[1].textContent, /<img/);
  assert.match(bloque.hijos[2].textContent, /no conducir/);
  assert.equal(new URL(bloque.hijos[3].href).hostname, 'api.nhtsa.gov');
});
