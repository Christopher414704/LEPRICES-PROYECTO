const patrones={
  motorLitros:/engine|motor|cilindrada|displacement|cilindraje/i,motorCc:/engine|motor|cilindrada|displacement|cilindraje/i,
  cilindros:/cylinder|cilindr|monocil|single-cylinder/i,transmision:/transmi|gear|marchas|velocidades|caja/i,
  traccion:/tracci|drive|driven|\b[24]wd|\bawd|\bfwd|\brwd/i,combustible:/combustible|fuel type|petrol|gasolina|diesel|diésel/i,
  consumoCiudadL100:/consum|economy|km\/l|mpg|urban|city|ciudad/i,
  consumoCarreteraL100:/consum|economy|km\/l|mpg|highway|extra.urban|carretera/i,
  consumoCombinadoL100:/consum|rendim|redim|economy|km\/l|mpg|combined|combinado|wmtc|wltp/i,
};
export function seleccionarMaterial(texto,pendientes,maximo=3600) {
  const filas=String(texto??'').split('\n').map(l=>l.trim()).filter(Boolean);
  const indices=new Set([0]);
  for(const campo of pendientes) {
    const coincidencias=filas.map((l,i)=>patrones[campo]?.test(l)?i:-1).filter(i=>i>=0);
    for(const i of coincidencias.slice(0,6))for(const j of [i-1,i,i+1])if(j>=0 && j<filas.length)indices.add(j);
  }
  const relevantes=[...indices].sort((a,b)=>a-b).map(i=>filas[i]);
  if(relevantes.length<=1)return filas.join('\n').slice(0,maximo);
  let salida='';for(const fila of relevantes){if(salida.length+fila.length+1<=maximo)salida+=(salida?'\n':'')+fila;}
  // Las palabras clave priorizan, pero no excluyen etiquetas desconocidas para la IA.
  for(const [i,fila] of filas.entries())if(!indices.has(i) && salida.length+fila.length+1<=maximo)salida+='\n'+fila;
  return salida;
}
