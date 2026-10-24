import { crearDiagramaTraccion, interpretarTraccion } from './traccion-vehiculo.js';

// Catálogo explícito: nunca inferir equipamiento por marca, gama o tipo de vehículo.
const campos = [
 ['motorCc','Cilindrada','Motor','cc'], ['motorLitros','Cilindrada','Motor','L'],
 ['cilindros','Cilindros','Motor',''], ['potenciaKw','Potencia','Motor','kW'], ['torqueNm','Par motor','Motor','Nm'],
 ['transmision','Transmisión','Transmisión y tracción',''], ['traccion','Tracción','Transmisión y tracción',''],
 ['combustible','Combustible','Energía y consumo',''],
 ['consumoCiudadL100','Consumo en ciudad','Energía y consumo','L/100 km'],
 ['consumoCarreteraL100','Consumo en carretera','Energía y consumo','L/100 km'],
 ['consumoCombinadoL100','Consumo combinado','Energía y consumo','L/100 km'],
 ['consumoGeneral','Consumo general sin ciclo','Energía y consumo',''],
 ['capacidadTanqueLitros','Capacidad del tanque','Energía y consumo','L'],
 ['capacidadBateriaKwh','Capacidad de batería','Energía y consumo','kWh'],
 ['largoMm','Largo','Dimensiones y peso','mm'], ['anchoMm','Ancho','Dimensiones y peso','mm'],
 ['altoMm','Alto','Dimensiones y peso','mm'], ['pesoKg','Peso','Dimensiones y peso','kg'],
 ['distanciaEjesMm','Distancia entre ejes','Dimensiones y peso','mm'],
 ['puertas','Puertas','Carrocería y capacidad','','auto'], ['plazas','Plazas','Carrocería y capacidad',''],
 ['capacidadMaleteroLitros','Maletero','Carrocería y capacidad','L','auto'],
 ['alturaAsientoMm','Altura del asiento','Ciclística','mm','moto'],
 ['transmisionFinal','Transmisión final','Ciclística','','moto'],
 ['frenoDelantero','Freno delantero','Frenos y suspensión',''], ['frenoTrasero','Freno trasero','Frenos y suspensión',''],
 ['suspensionDelantera','Suspensión delantera','Frenos y suspensión',''], ['suspensionTrasera','Suspensión trasera','Frenos y suspensión',''],
 ['abs','ABS','Seguridad y tecnología',''], ['controlTraccion','Control de tracción','Seguridad y tecnología',''],
 ['airbags','Airbags','Seguridad y tecnología','','auto'], ['conectividad','Conectividad','Seguridad y tecnología',''],
];
export function fuenteSegura(valor) {
 try { const u=new URL(valor); return u.protocol==='https:'?u.href:null; } catch { return null; }
}
const presente=v=>v!==null&&v!==undefined&&v!==''&&(typeof v!=='number'||Number.isFinite(v));
const ciclos={consumoCiudadL100:'ciudad',consumoCarreteraL100:'carretera',consumoCombinadoL100:'combinado'};
export function categoriasTecnicas(ficha={}) {
 const grupos=new Map();
 const evidencia=ficha.complemento??{};
 const electrico=/^(Electricity|Electricidad|Eléctrico)$/i.test(ficha.combustible??'');
 for(const [campo,nombre,categoria,unidad,tipo] of campos) {
  if(tipo&&ficha.tipo!==tipo)continue;
  if(electrico&&['motorCc','motorLitros','cilindros','capacidadTanqueLitros',...Object.keys(ciclos),'consumoGeneral'].includes(campo))continue;
  if(campo==='motorLitros'&&(presente(ficha.motorCc)||evidencia.datos?.some(d=>d.campo==='motorCc')))continue;
  const base=ciclos[campo]?ficha.consumo?.[ciclos[campo]]:ficha[campo];
  const candidatos=(evidencia.datos??[]).filter(d=>d.campo===campo);
  if(presente(base))candidatos.unshift({campo,valor:base,unidad,urlFuente:ficha.urlFuente,origen:ficha.proveedor,base:true});
  if(campo==='consumoGeneral')candidatos.push(...(evidencia.referenciasConsumo??[]));
  const conflicto=(evidencia.conflictos??[]).find(d=>d.campo===campo);
  if(conflicto)candidatos.push(...(conflicto.opciones??[]));
  const validos=candidatos.filter(d=>presente(d.valor));
  const valores=new Set(validos.map(d=>JSON.stringify([d.valor,d.unidad??unidad])));
  let estado=conflicto||valores.size>1?'En conflicto':!validos.length?'Información incompleta':ficha.proveedor==='manual'&&validos[0].base?'Declarado por el usuario':
   validos[0].estado==='confirmado'&&fuenteSegura(validos[0].urlFuente)&&validos[0].cita&&validos[0].alcance==='version'?'Confirmado para la versión':
   fuenteSegura(validos[0].urlFuente)?'Referencia general del modelo':'Sin evidencia documentada';
  if(campo==='traccion') {
   const traccion=interpretarTraccion(ficha);
   const estados={'Información contradictoria':'En conflicto','Información no disponible':'Información incompleta',
    'Referencia del catálogo':'Referencia general del modelo','Referencia documental pendiente de revisión':'Referencia general del modelo'};
   estado=traccion.estado==='Sin evidencia documentada'&&ficha.proveedor==='manual'&&validos[0]?.base?
    'Declarado por el usuario':estados[traccion.estado]??traccion.estado;
  }
  const opciones=validos.map(d=>({valor:typeof d.valor==='boolean'?(d.valor?'Sí':'No'):String(d.valor),unidad:d.unidad??unidad,
   fuente:fuenteSegura(d.urlFuente),origen:d.origen??(d.base?ficha.proveedor:null)??'Fuente no identificada',cita:d.cita??'',estado:d.estado??'',conversion:d.conversion??''}));
  // Las categorías de equipamiento solo aparecen si existe información; los campos básicos ausentes se señalan.
  if(!opciones.length&&!['Motor','Transmisión y tracción','Energía y consumo'].includes(categoria))continue;
  if(!grupos.has(categoria))grupos.set(categoria,[]);
  grupos.get(categoria).push({campo,nombre,estado,opciones});
 }
 return [...grupos].map(([nombre,campos])=>({nombre,campos}));
}
export function crearEspecificaciones(ficha, formatos = {}) {
 const raiz=document.createElement('section');raiz.className='especificaciones-tecnicas';
 const titulo=document.createElement('h3');titulo.textContent='Especificaciones técnicas';raiz.append(titulo);
 const nota=document.createElement('p');nota.textContent='Las referencias del modelo no confirman la configuración de tu vehículo. Los campos sin evidencia requieren verificación.';raiz.append(nota);
 for(const categoria of categoriasTecnicas(ficha)) {
  const seccion=document.createElement('section'),h=document.createElement('h4'),dl=document.createElement('dl');
  h.textContent=categoria.nombre;dl.className='datos-ficha';seccion.append(h,dl);
  for(const campo of categoria.campos) {
   const div=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=campo.nombre;
   const estado=document.createElement('strong');estado.textContent=campo.estado;dd.append(estado);
   for(const opcion of campo.opciones) {
    const p=document.createElement('p');p.textContent=(formatos[campo.campo]?.(opcion.valor) ?? opcion.valor)+(opcion.unidad?' '+opcion.unidad:'')+' · '+opcion.origen+(opcion.conversion?' · Conversión: '+opcion.conversion:'');
    if(opcion.fuente){const a=document.createElement('a');a.href=opcion.fuente;a.target='_blank';a.rel='noopener noreferrer';a.textContent=' Consultar fuente';p.append(a);}
    if(opcion.cita){const cita=document.createElement('small');cita.textContent=' · '+opcion.cita;p.append(cita);}
    dd.append(p);
   }
   div.append(dt,dd);dl.append(div);
  }
  raiz.append(seccion);
 }
 raiz.append(crearDiagramaTraccion(ficha));
 return raiz;
}

