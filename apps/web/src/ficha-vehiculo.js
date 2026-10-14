const combustibles = { "Regular Gasoline": "Gasolina regular", "Premium Gasoline": "Gasolina premium", "Midgrade Gasoline": "Gasolina intermedia", Diesel: "Diésel", Electricity: "Electricidad", E85: "E85" };
const tracciones = { "Front-Wheel Drive": "Delantera", "Rear-Wheel Drive": "Trasera", "All-Wheel Drive": "Integral (AWD)", "4-Wheel Drive": "4×4", "4-Wheel or All-Wheel Drive": "4×4 / integral", "2-Wheel Drive": "Dos ruedas", "Part-time 4-Wheel Drive": "4×4 conectable" };
const formato = new Intl.NumberFormat("es-GT", { maximumFractionDigits: 2 });

export function nombreCombustible(valor) {
  if (!valor) return 'No disponible';
  if (/^(?:gasolina|gasoline|petrol)(?:\s+sin plomo|\s+unleaded)?$/i.test(valor.trim())) return 'Gasolina · octanaje por confirmar';
  return combustibles[valor] ?? valor;
}

export function nombreTraccion(valor) {
  if (!valor) return 'No disponible';
  // Solo el singular explícito identifica una rueda; 2WD también puede describir una cuatrimoto.
  if (/^(?:rear[ -]wheel|rueda trasera)$/i.test(valor.trim())) return 'Rueda trasera';
  return tracciones[valor] ?? valor;
}

export function nombreModelo(ficha) {
  return `${ficha.marca} ${ficha.modelo} · ${ficha.anio ?? 'Año por confirmar'}`;
}

export function nombreFuente(ficha) {
  if(ficha.complemento?.origen==='biblioteca')return 'Biblioteca LEPRICES · ficha con fuentes documentadas';
  if(ficha.proveedor==='web')return 'Ficha técnica encontrada en la web · Referencia del modelo';
  return ficha.proveedor==='manual'?'Datos ingresados por ti':ficha.proveedor==='nhtsa'?'NHTSA vPIC · Datos básicos del modelo':'FuelEconomy.gov · Consumo de referencia';
}

export function nombreTransmision(valor) {
  if(!valor)return 'No disponible';
  return valor.replace(/Five-speed manual/gi,'Manual de cinco velocidades').replace(/Automatic/gi,'Automática').replace(/Manual/gi,'Manual').replace(/variable gear ratios/gi,'relación variable').replace(/\bspd\b/gi,'velocidades');
}

export function datosFicha(ficha) {
  const consumo = ficha.consumo ?? {};
  const mostrarConsumo = (n) => typeof n === "number" && Number.isFinite(n) && n > 0 ? `${formato.format(n)} L/100 km` : "No disponible";
  return [
    ["Motor", ficha.tipo==='moto' && ficha.motorCc ? `${formato.format(ficha.motorCc)} cc` : ficha.motorLitros ? `${formato.format(ficha.motorLitros)} L${ficha.cilindros ? ` · ${ficha.cilindros} cilindros` : ""}` : "No disponible"],
    ["Transmisión", nombreTransmision(ficha.transmision)],
    ["Tracción", nombreTraccion(ficha.traccion)],
    ["Combustible de referencia", nombreCombustible(ficha.combustible)],
    ["Consumo en ciudad", mostrarConsumo(consumo.ciudad)],
    ["Consumo en carretera", mostrarConsumo(consumo.carretera)],
    ["Consumo combinado", mostrarConsumo(consumo.combinado)],
  ];
}

export function filasFicha(ficha) {
  const filas=datosFicha(ficha).map(([nombre,valor])=>({nombre,valor}));
  const nombres={motorLitros:'Motor',motorCc:'Motor',cilindros:'Cilindros',transmision:'Transmisión',traccion:'Tracción',combustible:'Combustible de referencia',consumoCiudadL100:'Consumo en ciudad',consumoCarreteraL100:'Consumo en carretera',consumoCombinadoL100:'Consumo combinado'};
  const usados=new Set();
  for(const dato of ficha.complemento?.datos ?? []) {
    if(!nombres[dato.campo] || usados.has(nombres[dato.campo]))continue;
    const ciclo={consumoCiudadL100:'ciudad',consumoCarreteraL100:'carretera',consumoCombinadoL100:'combinado'}[dato.campo];
    if(ciclo?ficha.consumo?.[ciclo]:ficha[dato.campo]!=null)continue;
    if(['motorCc','motorLitros'].includes(dato.campo) && (ficha.motorCc || ficha.motorLitros))continue;
    const existente=filas.find(f=>f.nombre===nombres[dato.campo]);
    if(existente && existente.valor!=='No disponible')continue;
    const texto = dato.campo==='transmision' ? nombreTransmision(dato.valor) : dato.campo==='combustible' ? nombreCombustible(dato.valor) : dato.campo==='traccion' ? nombreTraccion(dato.valor) : dato.valor;
    const fila={nombre:nombres[dato.campo],valor:`${texto}${dato.unidad?' '+dato.unidad:''}`,referencia:dato};
    if(existente)Object.assign(existente,fila);else filas.push(fila);
    usados.add(fila.nombre);
  }
  const publicados=ficha.complemento?.referenciasConsumo??[];
  const sinCombinado=filas.find(f=>f.nombre==='Consumo combinado' && f.valor==='No disponible');
  if(sinCombinado && publicados.length) {
    const unicos=[...new Set(publicados.map(r=>`${r.valor} ${r.unidad}`))];
    Object.assign(sinCombinado,{nombre:'Consumo general',valor:unicos.length===1?unicos[0]:'Fuentes con valores distintos',referencia:publicados[0]});
  }
  return filas.filter(f=>!f.nombre.startsWith('Consumo ') || f.valor!=='No disponible');
}

export function crearDatosFicha(ficha) {
  const lista = document.createElement("dl");
  lista.className = "datos-ficha";
  for (const {nombre,valor,referencia} of filasFicha(ficha)) {
    const grupo = document.createElement("div");
    const termino = document.createElement("dt");
    const descripcion = document.createElement("dd");
    termino.textContent = nombre;
    descripcion.textContent = valor;
    if(referencia) {
      const nota=document.createElement('small');nota.textContent=` · Referencia del modelo${referencia.estado==='publicado_sin_ciclo'?' · Sin ciclo especificado':''}${referencia.conversion && typeof referencia.valorOriginal==='number' ? ` (${referencia.valorOriginal} ${referencia.unidadOriginal}; convertido)` : ''}${referencia.lectura==='ocr'?' · PDF escaneado':''} `;
      descripcion.append(nota);
      try {const url=new URL(referencia.urlFuente);if(url.protocol==='https:'){const fuente=document.createElement('a');fuente.href=url.href;fuente.target='_blank';fuente.rel='noopener noreferrer';fuente.textContent='Fuente ↗';fuente.title=referencia.cita;descripcion.append(fuente);}}catch{ /* Sin enlace válido. */ }
    }
    grupo.append(termino, descripcion);
    lista.append(grupo);
  }
  return lista;
}
