const normalizar = valor => String(valor ?? '').normalize('NFD').replace(/\p{M}/gu, '')
  .toLowerCase().replace(/[‐‑–—-]/g, ' ').replace(/×/g, 'x').replace(/\s+/g, ' ').trim();

// Las palabras restantes (negaciones, opciones, versiones, etc.) impiden
// convertir una mención aislada en una afirmación sobre las ruedas motrices.
const patrones = [
  ['delantera', /\b(?:fwd|front wheel(?: drive)?|ruedas? delanteras?|eje delantero|delantera)\b/g],
  ['trasera', /\b(?:rwd|rear wheel(?: drive)?|ruedas? traseras?|eje trasero|trasera)\b/g],
  ['awd', /\b(?:awd|all wheel drive)\b/g],
  ['4wd', /\b(?:(?:part time |full time )?4 wheel drive|4wd)\b/g],
  ['integral', /\b(?:integral|4\s*x\s*4|(?:a |en )?las cuatro ruedas)\b/g],
];
const dosRuedas = /\b(?:4\s*x\s*2|2wd|2 wheel drive)\b/g;

export const citaTraccionDudosa = cita => /\b(?:no|sin|not|without|opcional|optional|seg[uú]n|depending|excepto|except)\b|\b(?:por confirmar|no disponible|not available)\b/i.test(String(cita));

function analizar(valor) {
  let texto = normalizar(valor).replace(/^(?:sistema de traccion|sistema de propulsion|traccion|drive system|drivetrain|drive)\s*:?\s*/, '');
  const clases = new Set();
  for (const [clase, patron] of patrones) texto = texto.replace(patron, () => { clases.add(clase); return ' '; });
  let dos = false;
  texto = texto.replace(dosRuedas, () => { dos = true; return ' '; });
  const resto = texto.replace(/[\s(),:;./]+/g, '');
  // «Integral» o «4x4» no establecen por sí solos la denominación AWD o 4WD.
  if (clases.has('awd') || clases.has('4wd')) clases.delete('integral');
  const contradictoria = clases.size > 1 || (dos && [...clases].some(c => !['delantera', 'trasera'].includes(c)));
  return { sistema: !resto && !contradictoria && clases.size === 1 ? [...clases][0] : null,
    incompleta: !resto && dos && !clases.size, contradictoria };
}

export function clasificarTraccion(valor, tipo = 'auto') {
  const { sistema } = analizar(valor);
  return tipo === 'moto' && !['delantera', 'trasera'].includes(sistema) ? null : sistema;
}

export function resolverTracciones(valores, tipo = 'auto') {
  const datos = valores.map(analizar), clases = new Set(datos.map(d => d.sistema).filter(Boolean));
  if (clases.has('awd') || clases.has('4wd')) clases.delete('integral');
  const sistema = clases.size === 1 ? [...clases][0] : null;
  const contradictoria = clases.size > 1 || datos.some(d => d.contradictoria) ||
    (datos.some(d => d.incompleta) && ['awd', '4wd', 'integral'].includes(sistema));
  // 4x2/2WD solo son compatibles con un eje identificado expresamente por otro dato.
  const coherente = datos.length && datos.every(d => d.sistema || (d.incompleta && ['delantera', 'trasera'].includes(sistema)));
  return { sistema: coherente && !contradictoria && (tipo !== 'moto' || ['delantera', 'trasera'].includes(sistema)) ? sistema : null,
    contradictoria };
}
