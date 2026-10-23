import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { datosInformeFaxcar, crearPdfInformeFaxcar, descargarInformeFaxcar, crearPanelInformeFaxcar } from '../src/faxcar-informe.js';

const vehiculo = { id: '7', alias: 'Mi automóvil', ficha: { tipo: 'auto', marca: 'Toyota', modelo: 'Corolla', anio: 2020,
  proveedor: 'manual', motorLitros: 1.8, complemento: { actualizadoEn: '2026-10-20T15:00:00Z',
    fuentes: [{ url: 'https://fabricante.gt/manual.pdf', titulo: 'Manual de referencia' }, { url: 'javascript:alert(1)', titulo: 'Rechazar' }],
    datos: [{ campo: 'combustible', valor: 'Gasolina', urlFuente: 'https://fabricante.gt/manual.pdf', origen: 'Manual', cita: 'Combustible permitido: gasolina sin plomo.', estado: 'pendiente_revision' }],
    conflictos: [{ campo: 'transmision', opciones: [{ valor: 'Manual' }, { valor: 'CVT' }] }], faltantes: ['consumoCiudadL100'] } } };
const ahora = new Date('2026-10-20T16:30:00Z');
test('reutiliza categorías y estados, conserva evidencia, excluye URLs inseguras y exige selección', () => {
  assert.throws(() => datosInformeFaxcar(null), /Selecciona/);
  const datos = datosInformeFaxcar(vehiculo, ahora);
  assert.match(datos.identidad, /Toyota.*Corolla.*2020/); assert.equal(datos.fuentes.length, 1);
  assert.match(datos.fuentes[0].citas[0], /gasolina/);
  assert.equal(datos.categorias.flatMap(c => c.campos).find(c => c.campo === 'transmision').estado, 'En conflicto');
  assert.equal(vehiculo.ficha.complemento.datos[0].fuenteId, undefined);
  assert.equal(datos.generadoEn, ahora.toISOString());
});

async function abrir(pdf) {
  const requireApi = createRequire(new URL('../../api/package.json', import.meta.url));
  const { getDocument } = await import(pathToFileURL(requireApi.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
  const tarea = getDocument({ data: new Uint8Array(pdf.output('arraybuffer')), isEvalSupported: false, verbosity: 0 });
  const doc = await tarea.promise;
  doc.destroy = () => tarea.destroy();
  return doc;
}
test('PDF reabre, contiene secciones, citas, estados y enlaces reales sin confirmar datos pendientes', async () => {
  const pdf = await crearPdfInformeFaxcar(vehiculo, ahora), doc = await abrir(pdf); let contenido = '', enlaces = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const pagina = await doc.getPage(i); contenido += (await pagina.getTextContent()).items.map(t => t.str).join(' ');
      enlaces.push(...(await pagina.getAnnotations()).map(a => a.url).filter(Boolean));
    }
    for (const cadena of ['Toyota', 'Corolla', '2020', 'Ficha técnica', 'En conflicto', 'Referencia general', 'Cita documental', 'sin plomo', 'No acredita reparaciones']) assert.ok(contenido.includes(cadena), cadena);
    assert.ok(enlaces.includes('https://fabricante.gt/manual.pdf'));
    assert.ok(!enlaces.some(u => u.startsWith('javascript:')));
    assert.ok(!contenido.includes('Confirmado para la versión'));
  } finally { await doc.destroy(); }
});

test('HU-35 el informe muestra el esquema de tracción sin confirmar 4x2 ni conflictos', async () => {
  const ficha = structuredClone(vehiculo); ficha.ficha.traccion = '4x2';
  let datos = datosInformeFaxcar(ficha, ahora);
  assert.equal(datos.categorias.flatMap(c => c.campos).find(c => c.campo === 'traccion').estado, 'Declarado por el usuario');
  const pdf = await crearPdfInformeFaxcar(ficha, ahora), doc = await abrir(pdf);
  try {
    let contenido = '';
    for (let i = 1; i <= doc.numPages; i++) contenido += (await (await doc.getPage(i)).getTextContent()).items.map(t => t.str).join(' ');
    assert.match(contenido, /Sistema de tracción/);
    assert.match(contenido, /Eje motriz sin confirmar/);
    assert.ok(!contenido.includes('Tracción delantera. Confirmado'));
  } finally { await doc.destroy(); }
});

test('campos y citas extensos continúan en páginas legibles sin perder el final ni salirse del área', async () => {
  const largo = structuredClone(vehiculo);
  largo.ficha.complemento.datos[0].valor = 'Gasolina de referencia '.repeat(220) + 'FIN_VALOR';
  largo.ficha.complemento.datos[0].cita = 'Referencia documental extensa '.repeat(300) + 'FIN_CITA';
  const pdf = await crearPdfInformeFaxcar(largo, ahora), doc = await abrir(pdf); let texto = '';
  try {
    assert.ok(doc.numPages > 3);
    for (let i = 1; i <= doc.numPages; i++) {
      const pagina = await doc.getPage(i), { items } = await pagina.getTextContent();
      texto += items.map(t => t.str).join(' ');
      for (const item of items.filter(t => t.str.trim())) {
        assert.ok(item.transform[5] > 12 && item.transform[5] < 830, `Fuera de página: ${item.str}`);
        assert.ok(item.transform[4] >= 45, `Margen izquierdo: ${item.str}`);
      }
    }
    assert.match(texto, /FIN_VALOR/); assert.match(texto, /FIN_CITA/); assert.match(texto, /continuación/);
  } finally { await doc.destroy(); }
});

test('descarga usa PDF y nombre seguro; el panel confirma solicitud al navegador y permite reintentar', async t => {
  let guardado;
  await descargarInformeFaxcar(vehiculo, { crearPdf: async () => ({ save: async (...args) => { guardado = args; } }) });
  assert.equal(guardado[0], 'FAXCAR-Toyota-Corolla-2020.pdf'); assert.deepEqual(guardado[1], { returnPromise: true });
  const previo = globalThis.document;
  globalThis.document = { createElement() { return { hijos: [], append(...n) { this.hijos.push(...n); }, setAttribute() {} }; } };
  t.after(() => { globalThis.document = previo; });
  let fallar = true;
  const panel = crearPanelInformeFaxcar(vehiculo, { descargar: async v => { assert.equal(v.id, '7'); if (fallar) throw new Error('Fallo de descarga'); } });
  await panel.hijos[0].onclick(); assert.match(panel.hijos[1].textContent, /Fallo de descarga/); assert.equal(panel.hijos[0].disabled, false);
  fallar = false; await panel.hijos[0].onclick(); assert.match(panel.hijos[1].textContent, /solicitada al navegador/);
});
