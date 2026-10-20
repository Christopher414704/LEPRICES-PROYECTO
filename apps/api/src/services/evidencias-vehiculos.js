export const camposVehiculo = ['motorLitros','motorCc','cilindros','transmision','traccion','combustible','consumoCiudadL100','consumoCarreteraL100','consumoCombinadoL100'];
export const revisionInvestigacion = 13;
export function faltantesFicha(ficha = {}, datos = []) {
  const presentes = new Set(datos.map(d => d.campo));
  for (const c of camposVehiculo) {
    const ciclo = {consumoCiudadL100:'ciudad',consumoCarreteraL100:'carretera',consumoCombinadoL100:'combinado'}[c];
    if (ciclo ? ficha.consumo?.[ciclo] > 0 : ficha[c] != null && ficha[c] !== '') presentes.add(c);
  }
  if (presentes.has('motorCc') || presentes.has('motorLitros')) { presentes.add('motorCc'); presentes.add('motorLitros'); }
  return camposVehiculo.filter(c => !presentes.has(c));
}

// Convierte el número literal, después de verificar su presencia en la fuente.
export function normalizarNumero(campo, valor, unidad, cita) {
  if (['motorCc','motorLitros'].includes(campo) && !/motor|engine|displacement|cilindr|cilindraje/i.test(cita)) return null;
  if (campo === 'cilindros' && /^(?:monocil[ií]ndrico|monocilindro|single[ -]cylinder)$/i.test(valor)) return { valor:1, unidad:'cilindro', valorOriginal:valor, unidadOriginal:unidad, conversion:'Denominación de un cilindro' };
  if (!/^\d+(?:[.,]\d+)?$/.test(valor)) return null;
  const escapar = v => v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const citado=unidad && (new RegExp(`(?<![\\d.,])${escapar(valor)}\\s*${escapar(unidad)}(?![\\p{L}\\d])`,'iu').exec(cita)
    || (['motorCc','motorLitros'].includes(campo) && new RegExp(`^(?:Cilindrada|Displacement|Engine displacement)\\s*\\(${escapar(unidad)}\\)\\s*:?[ \\t]*${escapar(valor)}\\s*$`,'iu').exec(cita))
    || (campo.startsWith('consumo') && new RegExp(`^(?:Consumo|Fuel consumption|Fuel economy)[^()\\d]{0,45}\\(${escapar(unidad)}\\)\\s*:?[ \\t]*${escapar(valor)}\\s*$`,'iu').exec(cita)));
  if (!citado) return null;
  const n = Number(valor.replace(',','.'));
  if (campo.startsWith('consumo')) {
    const etiquetas=/\b(extra[ -]?urban[oa]?|highway|carretera|combined|combinado|WMTC|WLTP|city|urban|ciudad|urbano)\b/gi;
    const previas=[...cita.slice(0,citado.index).matchAll(etiquetas)];
    const identificada=previas.at(-1)?.[0] ?? [...cita.matchAll(etiquetas)].at(-1)?.[0] ?? '';
    const ciclo = {consumoCiudadL100:/^(city|urban|ciudad|urbano)$/i, consumoCarreteraL100:/^(highway|extra[ -]?urban[oa]?|carretera)$/i, consumoCombinadoL100:/^(combined|combinado|WMTC|WLTP)$/i}[campo];
    if (!ciclo.test(identificada)) return null;
    let factor, formula;
    if (/^L\/100\s*km$/i.test(unidad)) return {valor:n,unidad:'L/100 km'};
    if (/^km\/(?:L|lt|litros?)$/i.test(unidad)) { factor=100; formula='100 ÷ km/L'; }
    // Un mpg sin indicar qué galón usa es ambiguo y se descarta.
    if (/^mpg(?:\s*\(US\)|\s+US)?$/i.test(unidad) && /\bUS\b|U\.S\.|EPA|US gallon/i.test(cita)) { factor=235.214583; formula='235.214583 ÷ mpg US'; }
    if (/^mpg(?:\s*\(UK\)|\s+UK)?$/i.test(unidad) && /\bUK\b|Imperial/i.test(cita)) { factor=282.480936; formula='282.480936 ÷ mpg Imperial'; }
    return factor && n > 0 ? {valor:Math.round(factor/n*100)/100,unidad:'L/100 km',valorOriginal:n,unidadOriginal:unidad,conversion:formula} : null;
  }
  const patron = {motorLitros:/^(?:L|liters?|litres?|litros?)$/i,motorCc:/^(?:cc|ccm|cm³|cm3)$/i,cilindros:/^(?:cilindros?|cylinders?)$/i}[campo];
  return patron?.test(unidad) ? {valor:n,unidad} : null;
}

const textoNormal=v=>String(v).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/(\d)-(?=speed)/g,'$1 ').trim();
function equivalente(a,b) {
  if (typeof a.valor==='number' && typeof b.valor==='number') return Math.abs(a.valor-b.valor)<=Math.max(.01,Math.abs(a.valor)*.01);
  const x=textoNormal(a.valor),y=textoNormal(b.valor);
  if(x===y) return true;
  if(a.campo==='transmision') {
    const corto=/^(\d+)\s*(?:velocidades|speeds?|spd)$/;
    const marchasX=corto.exec(x),marchasY=corto.exec(y);
    if(marchasX && marchasY) return marchasX[1]===marchasY[1];
    const parcial=corto.exec(x)??corto.exec(y);
    const completo=corto.test(x)?y:x;
    // Un número de marchas aislado no contradice una descripción que incluye ese número.
    return Boolean(parcial && /manual|mecanica|automatic|cvt/.test(completo) && new RegExp(`\\b${parcial[1]}\\s*(?:velocidades|speeds?|spd)\\b`).test(completo));
  }
  return false;
}
export function combinarEvidencias(datos) {
  const aceptados=[], conflictos=[];
  for (const campo of camposVehiculo) {
    const opciones=datos.filter(d=>d.campo===campo);
    if (!opciones.length) continue;
    if (opciones.some((d,i)=>opciones.slice(i+1).some(otro=>!equivalente(d,otro)))) {
      conflictos.push({campo,motivo:'Las fuentes publican valores distintos; falta confirmar la versión o el ciclo.',opciones});
    } else {
      const preferida=campo==='transmision' ? opciones.find(d=>/manual|mec[aá]nica|automatic|cvt/i.test(d.valor))??opciones[0] : opciones[0];
      aceptados.push({...preferida,evidencias:opciones.map(({evidencias,...d})=>d)});
    }
  }
  // cc y litros del mismo motor también deben concordar.
  const cc=aceptados.find(d=>d.campo==='motorCc'), litros=aceptados.find(d=>d.campo==='motorLitros');
  if (cc && litros && Math.abs(cc.valor/1000-litros.valor)>Math.max(.05,litros.valor*.02)) {
    conflictos.push({campo:'motorCc',motivo:'Las cilindradas corresponden a motores diferentes.',opciones:[cc,litros]});
    return {datos:aceptados.filter(d=>!['motorCc','motorLitros'].includes(d.campo)),conflictos};
  }
  return {datos:aceptados,conflictos};
}
