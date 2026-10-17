const error=mensaje=>Object.assign(new Error(mensaje),{statusCode:400});
function numero(valor,min,max,nombre) {
  if(!['number','string'].includes(typeof valor) || String(valor).trim()==='' || !Number.isFinite(Number(valor)) || Number(valor)<min || Number(valor)>max)throw error(`${nombre}: indica un número entre ${min} y ${max}.`);
  return Number(valor);
}

function condiciones(datos = {}) {
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) throw error('Condiciones del recorrido inválidas.');
  return {
    temperaturaC: numero(datos.temperaturaC ?? 15, 0, 45, 'Temperatura'),
    altitudM: numero(datos.altitudM ?? 0, 0, 5000, 'Altitud manual'),
    paradasKm: numero(datos.paradasKm ?? 0, 0, 5, 'Paradas adicionales por km'),
    minutosRalenti: numero(datos.minutosRalenti ?? 0, 0, 180, 'Minutos detenido'),
    ascensoIdaM: numero(datos.ascensoIdaM ?? 0, 0, 30000, 'Ascenso de ida'),
    ascensoVueltaM: numero(datos.ascensoVueltaM ?? 0, 0, 30000, 'Ascenso de regreso')
  };
}
// La altura solo ajusta el arrastre: no inventa una eficiencia del motor por país.
const densidad = (altura, temperatura) => 101325 * (1 - 2.25577e-5 * altura) ** 5.25588 / (287.05 * (temperatura + 273.15));
function alturaEn(perfil, km) {
  let izquierda=1,derecha=perfil.length-1;
  while(izquierda<derecha) { const centro=Math.floor((izquierda+derecha)/2);if(perfil[centro].km<km)izquierda=centro+1;else derecha=centro; }
  const i=izquierda;
  const a = perfil[i - 1], b = perfil[i];
  return a.alturaM + (b.alturaM - a.alturaM) * Math.max(0, Math.min(1, (km - a.km) / (b.km - a.km)));
}
function evaluar(p, c, combustible, tramos) {
  const electrico = p.propulsion === 'electrico', eta = p.eficienciaPct / 100;
  const energiaMJLitro = combustible === 'diesel' ? 35.8 : 32;
  const avisos = new Set(), detalle = [];
  const kmTotal = tramos.reduce((s, t) => s + t.kilometros, 0);
  let total = 0;
  for (const tramo of tramos) {
    const km = tramo.kilometros;
    const candidatas = tramo.relieve?.perfilMotor ?? tramo.relieve?.perfil;
    const perfil = tramo.relieve?.disponible && Array.isArray(candidatas) && candidatas.length >= 2 && candidatas.length <= 50000 &&
      candidatas.every((v, i) => Number.isFinite(v.alturaM) && v.alturaM >= -500 && v.alturaM <= 6000 && Number.isFinite(v.km) && (!i || v.km > candidatas[i - 1].km)) &&
      Math.abs(candidatas[0].km) < .001 && Math.abs(candidatas.at(-1).km - km) < .001 ? candidatas : null;
    const velocidades = tramo.velocidades;
    const completas = Array.isArray(velocidades) && velocidades.length > 0 && velocidades.length <= 10000 &&
      velocidades.every((v, i) => Number.isFinite(v.kmh) && v.kmh > 0 && v.kmh <= 160 && Number.isFinite(v.inicioKm) && Number.isFinite(v.finKm) && v.finKm > v.inicioKm &&
        Math.abs(v.inicioKm - (i ? velocidades[i - 1].finKm : 0)) < .001) && Math.abs(velocidades.at(-1).finKm - km) < .001;
    if (!perfil) avisos.add('Sin perfil de elevación completo: se usa el ascenso manual de cada sentido y no se descuentan bajadas. Un cero significa llano supuesto.');
    if (!completas) avisos.add('Sin velocidades completas por maniobra: se usa la velocidad indicada.');
    if (tramo.superficieIrregular) avisos.add('El mapa indica superficie irregular; revisa la rodadura. No conocemos su extensión ni aplicamos un porcentaje nacional.');
    const cortes = [...new Set([0, km, ...(perfil?.map(v => v.km) ?? []), ...(completas ? velocidades.flatMap(v => [v.inicioKm, v.finKm]) : [])])].sort((a, b) => a - b);
    let positivaMJ = 0, frenadoMJ = 0, segundos = 0, anterior = 0, indiceVelocidad = 0, ascensoM = 0;
    for (let i = 1; i < cortes.length; i++) {
      const a = cortes[i - 1], b = cortes[i], centro = (a + b) / 2;
      while (completas && indiceVelocidad < velocidades.length - 1 && velocidades[indiceVelocidad].finKm <= centro) indiceVelocidad++;
      const v = (completas ? Math.min(p.velocidadKmh, velocidades[indiceVelocidad].kmh) : p.velocidadKmh) / 3.6;
      const altura = perfil ? alturaEn(perfil, centro) : c.altitudM;
      const dh = perfil ? alturaEn(perfil, b) - alturaEn(perfil, a) : 0;
      ascensoM += Math.max(0, dh);
      const aire = .5 * densidad(altura, c.temperaturaC) * p.cda * v ** 2;
      const trabajoMJ = ((p.masaKg * 9.80665 * p.rodadura + aire) * (b - a) * 1000 + p.masaKg * 9.80665 * dh) / 1e6;
      positivaMJ += Math.max(0, trabajoMJ); frenadoMJ += Math.max(0, -trabajoMJ);
      const cinetica = .5 * p.masaKg * (v ** 2 - anterior ** 2) / 1e6;
      positivaMJ += Math.max(0, cinetica); frenadoMJ += Math.max(0, -cinetica); anterior = v;
      segundos += (b - a) * 1000 / v;
    }
    // Cada tramo termina detenido; paradas/km representa eventos adicionales.
    frenadoMJ += .5 * p.masaKg * anterior ** 2 / 1e6;
    if (!perfil) { ascensoM = tramo.sentido === 'vuelta' ? c.ascensoVueltaM : c.ascensoIdaM; positivaMJ += p.masaKg * 9.80665 * ascensoM / 1e6; }
    const paradas = c.paradasKm * km;
    const cineticaParadas = .5 * p.masaKg * (Math.min(p.velocidadKmh, 50) / 3.6) ** 2 * paradas / 1e6;
    positivaMJ += cineticaParadas; frenadoMJ += cineticaParadas;
    const minutosDetenido = c.minutosRalenti * km / kmTotal;
    const auxiliaresMJ = p.auxiliaresKw * (segundos + minutosDetenido * 60) / 1000;
    // Recuperación equivalente limitada al trabajo positivo; nunca produce combustible negativo.
    const recuperadaMJ = Math.min(positivaMJ, frenadoMJ * p.regeneracionPct / 100);
    const traccionMJ = Math.max(0, positivaMJ - recuperadaMJ);
    const cantidad = electrico ? (traccionMJ / eta + auxiliaresMJ) / 3.6 :
      (traccionMJ + auxiliaresMJ) / (eta * energiaMJLitro) + p.ralentiLitrosHora * minutosDetenido / 60;
    total += cantidad;
    detalle.push({ sentido: tramo.sentido, kilometros: km, cantidad, unidad: electrico ? 'kWh' : 'L', ascensoM,
      relieveAplicado: Boolean(perfil), velocidadesMapa: completas, segundosEnMovimiento: segundos, paradasAdicionales: paradas, minutosDetenido,
      energiaPositivaMJ: positivaMJ, energiaRecuperadaMJ: recuperadaMJ });
  }
  return { total, por100: total / kmTotal * 100, tramos: detalle, avisos: [...avisos], energiaMJLitro: electrico ? null : energiaMJLitro };
}
export function estimarConsumoTeorico(datos, combustible, contexto = {}) {
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) throw error('Completa los parámetros de la estimación teórica.');
  if (!['regular', 'super', 'premium', 'diesel', 'electricidad'].includes(combustible)) throw error('Selecciona el combustible o electricidad.');
  const propulsion = datos.propulsion ?? (combustible === 'electricidad' ? 'electrico' : 'combustion');
  if (!['combustion', 'hibrido', 'electrico'].includes(propulsion) || (propulsion === 'electrico') !== (combustible === 'electricidad')) throw error('La propulsión debe corresponder al combustible seleccionado.');
  const electrico = propulsion === 'electrico';
  const p = { propulsion, masaKg: numero(datos.masaKg, 60, 10000, 'Peso total'), velocidadKmh: numero(datos.velocidadKmh, 10, 110, 'Techo de velocidad'),
    cda: numero(datos.cda, .1, 3, 'Cd × área frontal'), rodadura: numero(datos.rodadura, .004, .04, 'Rodadura'),
    eficienciaPct: numero(datos.eficienciaPct, electrico ? 50 : 10, electrico ? 98 : 45, 'Eficiencia global'),
    auxiliaresKw: numero(datos.auxiliaresKw, 0, 5, 'Potencia auxiliar'),
    ralentiLitrosHora: numero(datos.ralentiLitrosHora ?? 0, 0, electrico ? 0 : 5, 'Consumo al ralentí'),
    regeneracionPct: numero(datos.regeneracionPct ?? 0, 0, propulsion === 'combustion' ? 0 : 85, 'Recuperación supuesta') };
  const c = condiciones(datos.condiciones);
  const tramos = contexto.ruta?.tramos ?? [
    ...(contexto.kmIda > 0 ? [{ sentido: 'ida', kilometros: contexto.kmIda }] : []),
    ...(contexto.kmVuelta > 0 ? [{ sentido: 'vuelta', kilometros: contexto.kmVuelta }] : [])];
  if (!tramos.length) tramos.push({ sentido: 'ida', kilometros: 100 });
  const r = evaluar(p, c, combustible, tramos);
  let calibracion = { estado: 'sin_mediciones', factor: 1 };
  if (datos.calibracion != null) {
    const q = datos.calibracion;
    if (!q || typeof q !== 'object' || Array.isArray(q)) throw error('Referencia de calibración inválida.');
    const kilometros = numero(q.kilometros, 1, 3000, 'Distancia medida'), cantidad = numero(q.cantidad, .01, 3000, electrico ? 'kWh medidos' : 'Litros medidos');
    const velocidadKmh = numero(q.velocidadKmh, 10, 110, 'Velocidad del recorrido medido');
    const referencia = evaluar({ ...p, velocidadKmh }, condiciones(q.condiciones), combustible, [{ sentido: 'ida', kilometros }]);
    const factor = cantidad / referencia.total;
    if (!Number.isFinite(factor) || factor < .25 || factor > 4) throw error('La referencia medida difiere demasiado del modelo. Revisa unidades, peso y condiciones antes de calibrar.');
    calibracion = { estado: 'referencia_usuario', factor, kilometros, cantidadMedida: cantidad, cantidadModelo: referencia.total,
      velocidadKmh, condiciones: condiciones(q.condiciones), unidad: electrico ? 'kWh' : 'L' };
  }
  const por100 = r.por100 * calibracion.factor;
  if (!Number.isFinite(por100) || por100 < .1 || por100 > (electrico ? 300 : 100)) throw error('Los parámetros producen un consumo fuera del rango admitido. Revisa los supuestos.');
  return { l100km: electrico ? null : por100, ...(electrico ? { kwh100km: por100 } : {}), fuente: 'modelo_teorico', estimado: true,
    parametrosTeoricos: p, condiciones: c, calibracion,
    modeloTeorico: { version: 2, energiaMJLitro: r.energiaMJLitro, tramos: r.tramos.map(t => ({ ...t, cantidad: t.cantidad * calibracion.factor })), avisos: r.avisos },
    aviso: `Estimación física del recorrido con pendientes disponibles, velocidad, paradas y ralentí indicados. ${calibracion.estado === 'referencia_usuario' ? 'Ajustada a un recorrido medido que ingresaste; no es validación independiente.' : 'Sin calibración empírica de este vehículo.'} No incluye tráfico en vivo, viento ni mapa de eficiencia del motor. No es un consumo homologado ni una calibración nacional de Guatemala.${propulsion === 'hibrido' ? ' Híbrido en modo de combustible con recuperación simplificada; no calcula reparto de batería de un enchufable.' : ''}${electrico ? ' Energía de batería; no incluye pérdidas del cargador.' : ''}` };
}
