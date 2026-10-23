import { textoCelda } from "./comparacion-vehiculos.js";
import { categoriasTecnicas, fuenteSegura } from './especificaciones-tecnicas.js';
import { interpretarTraccion } from './traccion-vehiculo.js';

const texto = valor => String(valor ?? '').normalize('NFKC').replace(/[–—]/g, '-').replace(/[^\x20-\x7e\u00a0-\u00ff\n]/g, '?');
const urlSegura = valor => {
  const url = fuenteSegura(valor);
  if (!url) return null;
  const u = new URL(url); return u.username || u.password ? null : url;
};
export function datosInformeFaxcar(vehiculo, generadoEn = new Date()) {
  if (!vehiculo?.id || !vehiculo.ficha?.marca || !vehiculo.ficha.modelo) throw new Error('Selecciona un vehículo con marca y modelo antes de generar el informe.');
  const ficha = vehiculo.ficha, fuentes = [], categorias = categoriasTecnicas(ficha);
  function registrar(url, titulo, cita) {
    const segura = urlSegura(url); if (!segura) return null;
    let f = fuentes.find(f => f.url === segura);
    if (!f) { f = { id: fuentes.length + 1, url: segura, titulo: titulo || 'Fuente documental', citas: [] }; fuentes.push(f); }
    if (cita && !f.citas.includes(cita)) f.citas.push(cita);
    return f.id;
  }
  registrar(ficha.urlFuente, ficha.proveedor || 'Fuente del catálogo');
  for (const f of ficha.complemento?.fuentes ?? []) registrar(f.url, f.titulo || f.origen);
  for (const dato of [...(ficha.complemento?.datos ?? []), ...(ficha.complemento?.referenciasConsumo ?? []),
    ...(ficha.complemento?.conflictos ?? []).flatMap(c => c.opciones ?? [])]) {
    registrar(dato.urlFuente, dato.origen, dato.cita);
    for (const e of dato.evidencias ?? []) registrar(e.urlFuente, e.origen, e.cita);
  }
  for (const c of categorias) for (const campo of c.campos) for (const opcion of campo.opciones) {
    opcion.fuenteId = registrar(opcion.fuente, opcion.origen, opcion.cita);
  }
  return { id: String(vehiculo.id), alias: vehiculo.alias || 'Vehículo seleccionado',
    identidad: [ficha.marca, ficha.modelo, ficha.anio ?? 'Año por confirmar'].join(' · '),
    version: ficha.version || 'Sin versión confirmada', mercado: ficha.mercado || 'Sin mercado confirmado',
    generadoEn: new Date(generadoEn).toISOString(), investigadoEn: ficha.complemento?.actualizadoEn || null,
    categorias, fuentes, pendientes: categorias.flatMap(c => c.campos.filter(campo => campo.estado === 'Información incompleta').map(campo => campo.campo)),
    contradicciones: ficha.complemento?.conflictos?.length ?? 0 };
}

export async function crearPdfInformeFaxcar(vehiculo, generadoEn, comparacion = null) {
  const datos = datosInformeFaxcar(vehiculo, generadoEn);
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const margen = 17, ancho = 176, limite = 276, anchos = [40, 82, 54]; let y = 25;
  function escribir(t, x, cy, size = 9, negrita = false) {
    pdf.setFont('helvetica', negrita ? 'bold' : 'normal'); pdf.setFontSize(size); pdf.text(texto(t), x, cy);
  }
  function pagina(nueva = false) {
    if (nueva) pdf.addPage();
    pdf.setFillColor(181, 25, 40); pdf.rect(0, 0, 210, 3, 'F'); pdf.setTextColor(30, 44, 60);
    escribir('LEPRICES / FAXCAR - INFORME TÉCNICO', margen, 14, 11, true); y = 25;
  }
  function parrafo(t, size = 9, url = null) {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(size);
    for (const linea of pdf.splitTextToSize(texto(t), ancho)) {
      if (y + 5 > limite) pagina(true);
      escribir(linea, margen, y, size);
      if (url) pdf.link(margen, y - 3.5, Math.min(ancho, pdf.getTextWidth(linea)), 5, { url });
      y += 4.5;
    } y += 3;
  }
  function seccion(t) {
    if (y + 20 > limite) pagina(true);
    pdf.setFillColor(231, 236, 242); pdf.rect(margen, y - 4, ancho, 9, 'F');
    escribir(t, margen + 2, y + 2, 11, true); y += 13;
  }
  let titulosTabla = ['Característica', 'Información disponible / fuente', 'Estado de verificación'];
  function cabecera() {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8);
    const lineas = titulosTabla.map((t,i)=>pdf.splitTextToSize(texto(t),anchos[i]-4));
    const alto = Math.max(...lineas.map(l=>l.length))*4+4;
    if(y+alto+10>limite) pagina(true);
    let x=margen;
    lineas.forEach((ls,i)=>{ls.forEach((l,j)=>escribir(l,x+2,y+j*4,8,true));x+=anchos[i];});
    y+=alto;
  }
  function fila(valores, categoria) {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9);
    const columnas = valores.map((v, i) => pdf.splitTextToSize(texto(v), anchos[i] - 4));
    let desplazamiento = 0; const largo = Math.max(...columnas.map(c => c.length));
    while (desplazamiento < largo) {
      if (y + 10 > limite) { pagina(true); seccion(categoria + ' (continuación)'); cabecera(); }
      const cantidad = Math.min(largo - desplazamiento, Math.floor((limite - y - 4) / 4.5));
      const alto = cantidad * 4.5 + 4;
      pdf.setFillColor(246, 248, 250); pdf.rect(margen, y - 3.5, ancho, alto, 'F');
      let x = margen;
      columnas.forEach((lineas, i) => {
        lineas.slice(desplazamiento, desplazamiento + cantidad).forEach((linea, j) => escribir(linea, x + 2, y + j * 4.5, 9, i === 0));
        x += anchos[i];
      });
      y += alto + 2; desplazamiento += cantidad;
    }
  }
  const fecha = valor => valor && Number.isFinite(new Date(valor).getTime()) ? new Date(valor).toLocaleString('es-GT', { timeZone: 'America/Guatemala' }) : 'Sin registrar';
  pagina();
  seccion('1. Vehículo consultado');
  parrafo(datos.alias, 12); parrafo(datos.identidad, 12);
  parrafo(`Identificador en LEPRICES: ${datos.id} | Versión: ${datos.version} | Mercado: ${datos.mercado}`);
  parrafo(`Generado: ${fecha(datos.generadoEn)} (Guatemala). Investigación: ${fecha(datos.investigadoEn)}.`);
  seccion('2. Alcance del informe');
  parrafo('Documento de consulta técnica del modelo. Las referencias generales y los datos declarados requieren confirmación para la versión y unidad seleccionadas. Los campos incompletos y las contradicciones se conservan visibles.');
  parrafo('No acredita reparaciones, accidentes, inspecciones, estado mecánico ni historial individual. No se han realizado inspecciones físicas ni verificaciones por VIN para generar este documento.');
  seccion('3. Ficha técnica y evidencia disponible');
  const traccion = interpretarTraccion(vehiculo.ficha);
  seccion('Sistema de tracción');
  parrafo(`${traccion.titulo}. ${traccion.estado}. ${traccion.aviso}`);
  if (y + 34 > limite) pagina(true);
  const xRuedas = traccion.tipo === 'moto' ? [103] : [91, 119];
  const dibujarRueda = (x, cy, motriz) => {
    pdf.setFillColor(...(motriz ? [181, 25, 40] : [222, 228, 235]));
    pdf.setDrawColor(83, 99, 115); pdf.roundedRect(x, cy, 8, 12, 2, 2, 'FD');
  };
  pdf.setDrawColor(137, 151, 168); pdf.roundedRect(84, y - 2, 51, 34, 5, 5, 'S');
  escribir('Delante', margen, y + 6, 8); escribir('Atrás', margen, y + 26, 8);
  for (const x of xRuedas) {
    dibujarRueda(x, y, traccion.tipo === 'moto' ? traccion.ruedas.delantera : traccion.ruedas[x === xRuedas[0] ? 'delanteraIzquierda' : 'delanteraDerecha']);
    dibujarRueda(x, y + 18, traccion.tipo === 'moto' ? traccion.ruedas.trasera : traccion.ruedas[x === xRuedas[0] ? 'traseraIzquierda' : 'traseraDerecha']);
  }
  y += 40;
  for (const categoria of datos.categorias) {
    seccion(categoria.nombre); cabecera();
    for (const campo of categoria.campos) {
      const valores = campo.opciones.map(o => `${o.valor}${o.unidad ? ' ' + o.unidad : ''}${o.fuenteId ? ' [F' + o.fuenteId + ']' : ''}${o.conversion ? ' - Conversión: ' + o.conversion : ''}`).join('\n');
      fila([campo.nombre, valores || 'Sin información disponible', campo.estado], categoria.nombre);
    } y += 3;
  }
  seccion('4. Datos que requieren confirmación');
  parrafo(`Contradicciones documentadas: ${datos.contradicciones}. Campos pendientes de investigación: ${datos.pendientes.length}.`);
  parrafo('Revisar los estados de cada fila: información incompleta, datos declarados, sin evidencia y referencias generales no equivalen a confirmación. Las alternativas en conflicto no se resuelven automáticamente.');
  if (datos.pendientes.length) {
    const campos = datos.categorias.flatMap(c => c.campos);
    parrafo('Campos pendientes: ' + datos.pendientes.map(c => campos.find(f => f.campo === c)?.nombre || 'Dato técnico sin respaldo').join(', '));
  }
  if (comparacion) {
    seccion('Comparación de vehículos seleccionados');
    parrafo('Valores originales sin conversiones. Una ausencia puede corresponder a información no disponible o a un campo no aplicable.');
    titulosTabla = ['Característica', ...comparacion.columnas.map(c=>c.nombre)];
    anchos.splice(0, anchos.length, 40, ...comparacion.columnas.map(()=>136/comparacion.columnas.length));
    cabecera();
    for (const f of comparacion.filas) fila([f.categoria+' / '+f.nombre,...f.celdas.map(textoCelda)],'Comparación');
  }
  seccion('5. Fuentes y citas documentales');
  if (!datos.fuentes.length) parrafo('No hay fuentes documentales enlazables en la ficha. La ausencia de evidencia no se sustituye por información generada.');
  for (const fuente of datos.fuentes) {
    parrafo(`[F${fuente.id}] ${fuente.titulo}`);
    parrafo(fuente.url, 8, fuente.url);
    for (const cita of fuente.citas) parrafo('Cita documental: ' + cita, 8);
  }
  const total = pdf.getNumberOfPages();
  for (let i = 1; i <= total; i++) { pdf.setPage(i); escribir(`FAXCAR - ${i} / ${total} - Referencia técnica, sin inspección de la unidad`, margen, 289, 8); }
  pdf.setProperties({ title: 'FAXCAR - ' + texto(datos.identidad), author: 'LEPRICES', subject: 'Especificaciones y fuentes documentadas del vehículo' });
  return pdf;
}

export async function descargarInformeFaxcar(vehiculo, { crearPdf = crearPdfInformeFaxcar, comparacion = null } = {}) {
  const pdf = await crearPdf(vehiculo, undefined, comparacion);
  const nombre = `FAXCAR-${vehiculo.ficha.marca}-${vehiculo.ficha.modelo}-${vehiculo.ficha.anio ?? 'sin-anio'}`.replace(/[^\p{L}\p{N}-]/gu, '_').slice(0, 120) + '.pdf';
  await pdf.save(nombre, { returnPromise: true });
}

export function crearPanelInformeFaxcar(vehiculo, { descargar = descargarInformeFaxcar } = {}) {
  const panel = document.createElement('section'), boton = document.createElement('button'), estado = document.createElement('p');
  boton.type = 'button'; boton.textContent = 'Descargar informe técnico FAXCAR (PDF)';
  estado.setAttribute('role', 'status'); estado.setAttribute('aria-live', 'polite');
  boton.onclick = async () => {
    if (boton.disabled) return;
    boton.disabled = true; estado.textContent = 'Generando informe del vehículo seleccionado…';
    try { await descargar(vehiculo); estado.textContent = 'PDF generado y descarga solicitada al navegador.'; }
    catch (error) { estado.textContent = error.message || 'No se pudo generar el PDF. Reintenta.'; }
    finally { boton.disabled = false; }
  };
  panel.append(boton, estado); return panel;
}
