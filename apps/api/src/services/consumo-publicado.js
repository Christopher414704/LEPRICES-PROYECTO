// Conserva rendimientos publicados sin atribuirles un ciclo ni convertir galones ambiguos.
export function extraerConsumoPublicado(fuentes=[]) {
  const referencias=[];
  for(const f of fuentes) {
    if(!f.identidad || !f.url?.startsWith('https:'))continue;
    for(const fila of String(f.texto??'').split('\n')) {
      if(fila.length<12 || fila.length>280 || !/rendim|redim|consumo|fuel economy|fuel consumption/i.test(fila) || /\b(?:city|ciudad|highway|carretera|combined|combinado|wmtc|wltp|urbano)\b/i.test(fila))continue;
      const encontrados=[...fila.matchAll(/(?<![\d.,+\-])\b(\d+(?:[.,]\d+)?)\s*km(?:s\.?)?\s*(?:\/|por)\s*(?:(US|U\.S\.|UK|imperial)\s+)?(gal(?:lons?|[óo]n(?:es)?)?\.?|l(?:itros?)?)(?![a-z])(?:\s*(?:\(\s*)?(US|U\.S\.|UK|imperial|estadounidense|americano|brit[aá]nico)(?:\s*\))?)?/gi),
        ...fila.matchAll(/(?<![\d.,+\-])\b(\d+(?:[.,]\d+)?)\s*(?:L|litros?)\s*(?:\/|por)\s*100\s*km\b/gi)];
      if(encontrados.length!==1)continue;
      const m=encontrados[0],valor=Number(m[1].replace(',','.'));
      let unidad = m[3] ? /^gal/i.test(m[3]) ? 'km/gal' : 'km/L' : 'L/100 km';
      if(unidad==='km/gal') {
        const tipos=[m[2],m[4]].filter(Boolean).map(t=>/US|U\.S\.|estadounidense|americano/i.test(t)?'US':'UK');
        if(new Set(tipos).size>1)continue;
        if(tipos.length)unidad+=' '+tipos[0];
      }
      if(!(valor>0 && valor<=(unidad==='L/100 km'?100:2000)))continue;
      const dato={valor,unidad,cita:fila,fuenteId:f.id,urlFuente:f.url,estado:'publicado_sin_ciclo',anio:f.identidad.anio??null};
      if(!referencias.some(r=>r.valor===valor && r.unidad===unidad && r.urlFuente===f.url))referencias.push(dato);
    }
  }
  return referencias.slice(0,8);
}

// La referencia sigue sin ciclo: la conversión sirve para presupuesto, nunca para rellenar ciudad/carretera.
export function seleccionarConsumoGeneral(referencias=[],{galonSupuesto=null}={}) {
  if(!referencias.length)return {l100km:null,motivo:'sin_referencia_general'};
  const convertir=r=>r.unidad==='L/100 km'?r.valor:r.unidad==='km/L'?100/r.valor:
    r.unidad==='km/gal US'?100*3.785411784/r.valor:r.unidad==='km/gal UK'?100*4.54609/r.valor:
    r.unidad==='km/gal' && galonSupuesto==='US'?100*3.785411784/r.valor:
    r.unidad==='km/gal' && galonSupuesto==='UK'?100*4.54609/r.valor:null;
  const valores=referencias.map(convertir);
  if(valores.some(n=>n==null))return {l100km:null,motivo:'galon_sin_especificar'};
  if(valores.some(n=>!Number.isFinite(n) || n<.1 || n>100))return {l100km:null,motivo:'consumo_fuera_de_rango'};
  if(valores.some(n=>Math.abs(n-valores[0])>Math.max(.01,valores[0]*.01)))return {l100km:null,motivo:'referencias_en_conflicto'};
  const supuestoGalon=referencias.some(r=>r.unidad==='km/gal')?galonSupuesto:null;
  return {l100km:valores[0],referenciaGeneral:referencias[0],estimado:true,motivo:'referencia_general',supuestoGalon};
}

export function depurarConsumoPublicado(referencias=[],fuentes=[]) {
  return referencias.filter(r=>{
    const fuente=fuentes.find(f=>f.id===r.fuenteId && f.url===r.urlFuente);
    if(!fuente)return false;
    return extraerConsumoPublicado([{...fuente,texto:r.cita}]).some(v=>v.valor===r.valor && v.unidad===r.unidad && r.estado===v.estado);
  }).slice(0,8);
}
