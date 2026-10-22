import { categoriasTecnicas } from './especificaciones-tecnicas.js';
export function datosComparacion(vehiculos) {
 if(!Array.isArray(vehiculos)||vehiculos.length<2||vehiculos.length>4)throw new Error('Selecciona entre dos y cuatro vehículos.');
 if(new Set(vehiculos.map(v=>String(v.id))).size!==vehiculos.length)throw new Error('Selecciona vehículos distintos.');
 const columnas=vehiculos.map(v=>({id:String(v.id),nombre:[v.alias,v.ficha.marca,v.ficha.modelo,v.ficha.anio??'Año por confirmar',v.ficha.version,v.ficha.tipo].filter(Boolean).join(' · ')}));
 const categorias=vehiculos.map(v=>categoriasTecnicas(v.ficha)),filas=new Map();
 categorias.forEach(grupos=>grupos.forEach(g=>g.campos.forEach(c=>{if(!filas.has(c.campo))filas.set(c.campo,{campo:c.campo,nombre:c.nombre,categoria:g.nombre});})));
 return {columnas,filas:[...filas.values()].map(f=>({...f,celdas:categorias.map(grupos=>{
  const c=grupos.flatMap(g=>g.campos).find(c=>c.campo===f.campo);
  return c?{estado:c.estado,opciones:c.opciones.map(o=>({...o}))}:{estado:'No disponible o no aplicable',opciones:[]};
 })}))};
}
export function textoCelda(celda) {return (celda.opciones.map(o=>o.valor+(o.unidad?' '+o.unidad:'')).join(' / ')||'Sin información')+' · '+celda.estado;}
export function crearTablaComparacion(datos) {
 const tabla=document.createElement('table'),caption=document.createElement('caption'),head=document.createElement('thead'),body=document.createElement('tbody');
 caption.textContent='Comparación técnica de vehículos seleccionados';tabla.append(caption,head,body);
 const tr=document.createElement('tr');
 for(const texto of ['Categoría / característica',...datos.columnas.map(c=>c.nombre)]){const th=document.createElement('th');th.scope='col';th.textContent=texto;tr.append(th);}head.append(tr);
 for(const fila of datos.filas){const tr=document.createElement('tr'),th=document.createElement('th');th.scope='row';th.textContent=fila.categoria+' / '+fila.nombre;tr.append(th);
  for(const celda of fila.celdas){const td=document.createElement('td');td.textContent=textoCelda(celda);for(const o of celda.opciones){if(o.fuente){const a=document.createElement('a');a.href=o.fuente;a.target='_blank';a.rel='noopener noreferrer';a.textContent=' Fuente: '+o.origen;td.append(a);}}tr.append(td);}body.append(tr);
 }return tabla;
}
export function crearComparador({descargarInforme}) {
 const panel=document.createElement('section'),titulo=document.createElement('h2'),seleccion=document.createElement('div'),resultado=document.createElement('div'),limpiar=document.createElement('button'),exportar=document.createElement('button'),estado=document.createElement('p');
 titulo.textContent='Comparar vehículos';limpiar.type=exportar.type='button';limpiar.textContent='Limpiar selección';exportar.textContent='Incluir comparación en informe técnico PDF';estado.setAttribute('role','status');resultado.style.overflowX='auto';
 const elegidos=new Set();let disponibles=[];
 function render(){resultado.replaceChildren();const vehiculos=disponibles.filter(v=>elegidos.has(String(v.id)));exportar.disabled=vehiculos.length<2;
  if(vehiculos.length<2){estado.textContent='Selecciona entre dos y cuatro vehículos del garaje.';return;}estado.textContent=vehiculos.length+' vehículos seleccionados. Se conservan los datos originales y sus unidades.';resultado.append(crearTablaComparacion(datosComparacion(vehiculos)));}
 function actualizar(vehiculos){disponibles=vehiculos;for(const id of elegidos)if(!vehiculos.some(v=>String(v.id)===id))elegidos.delete(id);seleccion.replaceChildren();
  for(const v of vehiculos){const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=elegidos.has(String(v.id));check.onchange=()=>{if(check.checked&&elegidos.size>=4){check.checked=false;estado.textContent='Puedes comparar hasta cuatro vehículos.';return;}if(check.checked)elegidos.add(String(v.id));else elegidos.delete(String(v.id));render();};label.append(check,document.createTextNode([v.alias,v.ficha.marca,v.ficha.modelo,v.ficha.anio??'Año por confirmar'].join(' · ')));seleccion.append(label);}render();}
 limpiar.onclick=()=>{elegidos.clear();actualizar(disponibles);};
 exportar.onclick=async()=>{exportar.disabled=true;try{const vs=disponibles.filter(v=>elegidos.has(String(v.id)));await descargarInforme(vs[0],{comparacion:datosComparacion(vs)});estado.textContent='Informe con comparación generado.';}catch(e){estado.textContent=e.message;}finally{exportar.disabled=elegidos.size<2;}};
 panel.append(titulo,seleccion,limpiar,exportar,estado,resultado);return {panel,actualizar};
}
