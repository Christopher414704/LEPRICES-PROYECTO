// El respaldo describe los datos, no una probabilidad de acertar ni un porcentaje de precisión.
export function evaluarRespaldo(resultado, referencia = null) {
  const c=resultado.consumo;
  const medido=c.fuente==='bitacora';
  const teorico=c.fuente==='modelo_teorico';
  const calibrado=teorico && c.calibracion?.estado==='referencia_usuario';
  const estado=medido?'medido':calibrado?'calibrado':teorico?'supuestos':c.fuente==='manual'?'ingresado':'publicado';
  const pendientes=teorico?c.modeloTeorico.tramos.every(t=>t.relieveAplicado):false;
  const avisos=[];
  if(teorico&&!calibrado)avisos.push('Simulación sin calibrar: peso, aerodinámica y eficiencia deben corresponder a tu vehículo.');
  if(teorico&&!pendientes)avisos.push('Falta relieve completo. El ascenso manual puede ser insuficiente para esta carretera.');
  if(medido)avisos.push('El consumo de bitácora incluye condiciones anteriores; no se aplica una corrección de tráfico o pendientes sin medir esas condiciones.');
  if(calibrado)avisos.push('Ajustado a una medición ingresada; falta validación con viajes independientes.');
  if(c.fuente==='referencia_general')avisos.push('La fuente no especifica ciclo ni velocidad; no se utiliza para calibrar automáticamente la física.');
  let comparacionReferencia=null;
  if(teorico && Number.isFinite(referencia?.l100km) && referencia.l100km>0) {
    const diferenciaPct=(c.l100km-referencia.l100km)/referencia.l100km*100;
    comparacionReferencia={fuente:referencia.fuente,l100km:referencia.l100km,diferenciaPct,
      litros:resultado.kilometros*referencia.l100km/100*(1+resultado.margen/100),comparable:false};
    avisos.push('La referencia y la simulación corresponden a condiciones distintas. Su diferencia no mide el error real; revisa los supuestos antes de confiar en un consumo menor.');
  }
  const h=c.historialConsumo;
  const variacionHistorica=medido&&h?.length?{minimoL100:Math.min(...h),maximoL100:Math.max(...h),muestra:h.length,
    descripcion:'Variación observada entre intervalos completos recientes; no es un intervalo de confianza para este viaje.'}:null;
  return {estado,precisionValidada:false,traficoEnVivo:false,pendientesSimuladas:pendientes,avisos,comparacionReferencia,variacionHistorica};
}
