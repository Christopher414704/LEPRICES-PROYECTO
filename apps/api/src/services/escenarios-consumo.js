export const perfilesConsumo={fluido:[100,.1,0],moderado:[75,.5,10],intenso:[40,1,30]};
export function compararEscenariosConsumo({viaje,consumo,datos,calcular,estimar,estaciones}){
 if(consumo.fuente!=='modelo_teorico')return [];
 return Object.entries(perfilesConsumo).map(([escenario,perfil])=>{
 const [velocidadDisponiblePct,paradasKm,minutosRalenti]=perfil;
 const condiciones={...datos.estimacionTeorica.condiciones,velocidadDisponiblePct,paradasKm,minutosRalenti,...(datos.escenariosConsumo?.[escenario]??{})};
 try{
 const pct=Number(condiciones.velocidadDisponiblePct);if(!Number.isFinite(pct)||pct<10||pct>100)throw Object.assign(Error('Velocidad disponible: indica un porcentaje entre 10 y 100.'),{statusCode:400});
 const contexto=structuredClone(viaje);if(contexto.ruta)for(const t of contexto.ruta.tramos)for(const v of t.velocidades??[])v.kmh*=pct/100;
 const c=estimar({...datos.estimacionTeorica,propulsion:consumo.parametrosTeoricos.propulsion,velocidadKmh:Math.max(10,Number(datos.estimacionTeorica.velocidadKmh)*pct/100),condiciones},viaje.combustible,contexto);
 const r=calcular(viaje,c,estaciones,false);
 return {escenario,hipotetico:true,parametros:{...c.condiciones,velocidadDisponiblePct:pct},litros:r.litros,kwh:r.kwh??null,costo:r.costo,minutos:c.modeloTeorico.tramos.reduce((s,t)=>s+t.segundosEnMovimiento/60+t.minutosDetenido,0),aviso:'Escenario hipotético con parámetros asumidos o editados; no representa tráfico en tiempo real ni mediciones del viaje.'};
 }catch(e){return {escenario,hipotetico:true,error:e.statusCode===400?e.message:'No fue posible calcular este escenario.'};}
 });
}
