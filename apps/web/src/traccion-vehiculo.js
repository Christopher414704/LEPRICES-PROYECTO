import { clasificarTraccion, resolverTracciones, citaTraccionDudosa } from '../../shared/traccion.mjs';
export { clasificarTraccion };

const fuenteSegura = valor => {
  try { const url = new URL(valor); return url.protocol === 'https:' && !url.username && !url.password; }
  catch { return false; }
};

// Una representación visual nunca eleva una referencia del modelo a confirmación de la unidad.
export function interpretarTraccion(ficha = {}) {
  const tipo = ficha.tipo === 'moto' ? 'moto' : 'auto';
  const base = ficha.traccion == null || ficha.traccion === '' ? [] : [ficha.traccion];
  const propuestas = (ficha.complemento?.datos ?? []).filter(d => d.campo === 'traccion');
  const conflictos = (ficha.complemento?.conflictos ?? []).filter(c => c.campo === 'traccion');
  const documentos = propuestas.flatMap(d => [d, ...(d.evidencias ?? [])]);
  const valores = [...base, ...documentos.map(d => d.valor), ...conflictos.flatMap(c => (c.opciones ?? []).map(o => o.valor))];
  const resuelta = resolverTracciones(valores, tipo);
  const respaldoCatalogo = base.length && ficha.proveedor && ficha.proveedor !== 'manual' && fuenteSegura(ficha.urlFuente);
  const respaldados = documentos.filter(d => typeof d.cita === 'string' && d.cita.trim() && !citaTraccionDudosa(d.cita) && fuenteSegura(d.urlFuente) && clasificarTraccion(d.valor, tipo));
  // Una fuente genérica «integral» no respalda por sí sola una propuesta AWD/4WD.
  const respaldo = resolverTracciones([
    ...(respaldoCatalogo ? base : []), ...respaldados.map(d => d.valor)
  ], tipo).sistema;
  const sistema = !conflictos.length && resuelta.sistema && respaldo ? respaldo : null;
  const nombres = { delantera: 'Tracción delantera', trasera: 'Tracción trasera', awd: 'Tracción integral AWD', '4wd': 'Tracción 4WD', integral: 'Tracción integral (AWD/4WD sin especificar)' };
  const estado = conflictos.length || resuelta.contradictoria ? 'Información contradictoria' :
    !valores.length ? 'Información no disponible' : !sistema ? respaldoCatalogo || respaldados.length ? 'Tracción no determinada' : 'Sin evidencia documentada' :
    respaldados.some(d => d.estado === 'confirmado' && d.alcance === 'version' && clasificarTraccion(d.valor, tipo) === sistema) ?
      'Confirmado para la versión' : respaldoCatalogo && clasificarTraccion(base[0], tipo) === sistema ?
        'Referencia del catálogo' : 'Referencia documental pendiente de revisión';
  const ruedas = tipo === 'moto' ? { delantera: sistema === 'delantera', trasera: sistema === 'trasera' } :
    { delanteraIzquierda: ['delantera', 'awd', '4wd', 'integral'].includes(sistema), delanteraDerecha: ['delantera', 'awd', '4wd', 'integral'].includes(sistema),
      traseraIzquierda: ['trasera', 'awd', '4wd', 'integral'].includes(sistema), traseraDerecha: ['trasera', 'awd', '4wd', 'integral'].includes(sistema) };
  const descripcion = !sistema ? 'No se resaltan ruedas: falta confirmar el eje motriz.' : tipo === 'moto' ?
    `Rueda motriz: ${sistema}.` : sistema === 'delantera' ? 'Ruedas motrices: las dos delanteras.' :
      sistema === 'trasera' ? 'Ruedas motrices: las dos traseras.' : 'Ruedas motrices: las cuatro, según el modo de funcionamiento.';
  return { tipo, sistema, titulo: sistema ? nombres[sistema] : 'Eje motriz sin confirmar', estado, ruedas, descripcion,
    aviso: 'M = rueda motriz según la fuente. Las ruedas sin M no están identificadas como motrices. El esquema no es una inspección del vehículo.' };
}

export function crearDiagramaTraccion(ficha) {
  const dato = interpretarTraccion(ficha), figura = document.createElement('figure');
  figura.className = 'diagrama-traccion';
  const titulo = document.createElement('figcaption'); titulo.textContent = `${dato.titulo} · ${dato.estado}`;
  const cuerpo = document.createElement('div'); cuerpo.className = `diagrama-traccion__vehiculo diagrama-traccion__vehiculo--${dato.tipo}`;
  cuerpo.setAttribute('role', 'img');
  cuerpo.setAttribute('aria-label', `${dato.titulo}. ${dato.estado}. ${dato.descripcion}`);
  const sentido = document.createElement('span'); sentido.className = 'diagrama-traccion__sentido'; sentido.textContent = '↑ Frente del vehículo';
  const rueda = nombre => {
    const elemento = document.createElement('span');
    elemento.className = `diagrama-traccion__rueda${dato.ruedas[nombre] ? ' diagrama-traccion__rueda--motriz' : ''}`;
    elemento.textContent = dato.ruedas[nombre] ? 'M' : '–';
    elemento.setAttribute('aria-hidden', 'true'); return elemento;
  };
  const eje = (etiqueta, ...nombres) => { const fila = document.createElement('div'); fila.className = 'diagrama-traccion__eje';
    const texto = document.createElement('span'); texto.textContent = etiqueta; fila.append(texto, ...nombres.map(rueda)); return fila; };
  if (dato.tipo === 'moto') cuerpo.append(eje('Delante', 'delantera'), eje('Atrás', 'trasera'));
  else cuerpo.append(eje('Delante', 'delanteraIzquierda', 'delanteraDerecha'), eje('Atrás', 'traseraIzquierda', 'traseraDerecha'));
  const resumen = document.createElement('p'); resumen.textContent = dato.descripcion;
  const nota = document.createElement('p'); nota.textContent = dato.aviso;
  figura.append(titulo, sentido, cuerpo, resumen, nota); return figura;
}
