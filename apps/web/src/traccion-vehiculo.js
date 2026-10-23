// Una representación visual nunca eleva una referencia del modelo a confirmación de la unidad.
const normalizar = valor => String(valor ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const fuenteSegura = valor => {
  try { const url = new URL(valor); return url.protocol === 'https:' && !url.username && !url.password; }
  catch { return false; }
};

export function clasificarTraccion(valor, tipo = 'auto') {
  const texto = normalizar(valor);
  if (!texto || /\b4\s*[x×]\s*2\b|\b2wd\b|\b2[ -]?wheel drive\b/.test(texto)) return null;
  if (/4[ -]?wheel\s+or\s+all[ -]?wheel|all[ -]?wheel\s+or\s+4[ -]?wheel/.test(texto)) return null;
  const frente = /\b(?:fwd|front[ -]?wheel(?: drive)?|rueda delantera|traccion delantera|delantera)\b/.test(texto);
  const atras = /\b(?:rwd|rear[ -]?wheel(?: drive)?|rueda trasera|traccion trasera|trasera)\b/.test(texto);
  const integral = /\b(?:awd|all[ -]?wheel drive|traccion integral)\b/.test(texto);
  const cuatro = /\b(?:4wd|4[ -]?wheel drive|4\s*[x×]\s*4)\b/.test(texto);
  if (tipo === 'moto') {
    return !integral && !cuatro && frente !== atras ? frente ? 'delantera' : 'trasera' : null;
  }
  const clases = [frente && 'delantera', atras && 'trasera', integral && 'awd', cuatro && '4wd'].filter(Boolean);
  return clases.length === 1 ? clases[0] : null;
}

export function interpretarTraccion(ficha = {}) {
  const tipo = ficha.tipo === 'moto' ? 'moto' : 'auto';
  const base = ficha.traccion == null || ficha.traccion === '' ? [] : [ficha.traccion];
  const propuestas = (ficha.complemento?.datos ?? []).filter(d => d.campo === 'traccion');
  const conflictos = (ficha.complemento?.conflictos ?? []).filter(c => c.campo === 'traccion');
  const valores = [...base, ...propuestas.map(d => d.valor), ...conflictos.flatMap(c => (c.opciones ?? []).map(o => o.valor))];
  const clases = valores.map(v => clasificarTraccion(v, tipo));
  const coherente = !conflictos.length && clases.length && clases.every(c => c && c === clases[0]);
  const respaldoCatalogo = base.length && ficha.proveedor !== 'manual' && fuenteSegura(ficha.urlFuente);
  const respaldoDocumento = propuestas.some(d => d.cita && fuenteSegura(d.urlFuente));
  const sistema = coherente && (respaldoCatalogo || respaldoDocumento) ? clases[0] : null;
  const nombres = { delantera: 'Tracción delantera', trasera: 'Tracción trasera', awd: 'Tracción integral AWD', '4wd': 'Tracción 4WD' };
  const estado = conflictos.length || new Set(clases.filter(Boolean)).size > 1 ? 'Información contradictoria' :
    !valores.length ? 'Información no disponible' : !sistema ? respaldoCatalogo || respaldoDocumento ? 'Tracción no determinada' : 'Sin evidencia documentada' :
    base.length ? ficha.proveedor === 'manual' ? 'Dato declarado por el usuario' : 'Referencia del catálogo' :
    propuestas.some(d => d.estado === 'confirmado' && d.alcance === 'version' && d.cita && /^https:\/\//.test(d.urlFuente ?? '')) ?
      'Confirmado para la versión' : 'Referencia documental pendiente de revisión';
  const ruedas = tipo === 'moto' ? { delantera: sistema === 'delantera', trasera: sistema === 'trasera' } :
    { delanteraIzquierda: ['delantera', 'awd', '4wd'].includes(sistema), delanteraDerecha: ['delantera', 'awd', '4wd'].includes(sistema),
      traseraIzquierda: ['trasera', 'awd', '4wd'].includes(sistema), traseraDerecha: ['trasera', 'awd', '4wd'].includes(sistema) };
  return { tipo, sistema, titulo: sistema ? nombres[sistema] : 'Eje motriz sin confirmar', estado, ruedas,
    aviso: 'Las ruedas resaltadas reciben fuerza del motor según la información disponible. El esquema no es una inspección del vehículo.' };
}

export function crearDiagramaTraccion(ficha) {
  const dato = interpretarTraccion(ficha), figura = document.createElement('figure');
  figura.className = 'diagrama-traccion'; figura.setAttribute('role', 'img');
  figura.setAttribute('aria-label', `${dato.titulo}. ${dato.estado}. ${dato.aviso}`);
  const titulo = document.createElement('figcaption'); titulo.textContent = `${dato.titulo} · ${dato.estado}`;
  const cuerpo = document.createElement('div'); cuerpo.className = `diagrama-traccion__vehiculo diagrama-traccion__vehiculo--${dato.tipo}`;
  const rueda = nombre => {
    const elemento = document.createElement('span');
    elemento.className = `diagrama-traccion__rueda${dato.ruedas[nombre] ? ' diagrama-traccion__rueda--motriz' : ''}`;
    elemento.setAttribute('aria-hidden', 'true'); return elemento;
  };
  const eje = (etiqueta, ...nombres) => { const fila = document.createElement('div'); fila.className = 'diagrama-traccion__eje';
    const texto = document.createElement('span'); texto.textContent = etiqueta; fila.append(texto, ...nombres.map(rueda)); return fila; };
  if (dato.tipo === 'moto') cuerpo.append(eje('Delante', 'delantera'), eje('Atrás', 'trasera'));
  else cuerpo.append(eje('Delante', 'delanteraIzquierda', 'delanteraDerecha'), eje('Atrás', 'traseraIzquierda', 'traseraDerecha'));
  const nota = document.createElement('p'); nota.textContent = dato.aviso;
  figura.append(titulo, cuerpo, nota); return figura;
}
