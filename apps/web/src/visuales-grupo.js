import './inventario-funciones.css';
const header=document.querySelector('body>header,#app>.encabezado');
if(header){
 let marca=header.querySelector('.marca,.espacio-logotipo');
 if(!marca){marca=document.createElement('span');marca.className='marca';const img=document.createElement('img');img.src='/images/leprices-marca.webp';img.alt='LEPRICES';marca.append(img);header.prepend(marca);}
 let nav=header.querySelector('nav');
 if(!nav){nav=document.createElement('nav');for(const nodo of [...header.children])if(nodo!==marca&&nodo.matches('a,button'))nav.append(nodo);header.append(nav);}
 for(const nodo of [...header.children])if(nodo!==marca&&nodo!==nav&&nodo.matches('a,button'))nav.append(nodo);
 if(nav.children.length){
  const abrir=document.createElement('button');abrir.type='button';abrir.className='abrir-funciones';abrir.setAttribute('aria-label','Abrir funciones');abrir.setAttribute('aria-haspopup','dialog');
  const img=document.createElement('img');img.src='/images/menu.webp';img.alt='';const texto=document.createElement('span');texto.textContent='Funciones';abrir.append(img,texto);
  const dialog=document.createElement('dialog');dialog.className='inventario-funciones';dialog.setAttribute('aria-labelledby','tituloInventarioVisual');
  const cabecera=document.createElement('div');cabecera.className='inventario-cabecera';const titulo=document.createElement('h2');titulo.id='tituloInventarioVisual';titulo.textContent='Tus funciones';
  const cerrar=document.createElement('button');cerrar.type='button';cerrar.className='cerrar-funciones';cerrar.textContent='×';cerrar.setAttribute('aria-label','Cerrar funciones');cerrar.onclick=()=>dialog.close();cabecera.append(titulo,cerrar);
  const buscar=document.createElement('input');buscar.type='search';buscar.placeholder='Buscar una función…';buscar.setAttribute('aria-label','Buscar función');
  nav.classList.add('menu-superior');
  const normalizar=t=>t.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
  for(const item of [...nav.children]){
   item.classList.add('opcion-menu');
   if(!item.querySelector('img')){const icono=document.createElement('img');icono.src=/ruta/i.test(item.textContent)?'/images/rutas-ida_vuelta.webp':/vehículo|automóvil|garaje/i.test(item.textContent)?'/images/mi-vehiculo.webp':/precio/i.test(item.textContent)?'/images/precios.webp':'/images/gasolinera.webp';icono.alt='';item.prepend(icono);}
  }
  const filtrar=()=>{for(const item of nav.children)item.classList.toggle('funcion-filtrada',!normalizar(item.textContent).includes(normalizar(buscar.value)));};buscar.oninput=filtrar;
  nav.addEventListener('click',e=>{if(e.target.closest('a,button'))dialog.close();});
  dialog.append(cabecera,buscar,nav);document.body.append(dialog);header.append(abrir);
  abrir.onclick=()=>{buscar.value='';filtrar();dialog.showModal();buscar.focus();};dialog.addEventListener('close',()=>abrir.focus());
 }
}
const tipo=document.querySelector('#manual select[name="tipo"]');
if(tipo){
 const opciones=document.createElement('div');opciones.className='selector-visual-vehiculo';opciones.setAttribute('role','group');opciones.setAttribute('aria-label','Tipo de vehículo');
 for(const [valor,nombre] of [['auto','Automóvil'],['moto','Motocicleta']]){const boton=document.createElement('button');boton.type='button';boton.setAttribute('aria-label',nombre);const img=document.createElement('img');img.src='/images/selector-'+valor+'.webp';img.alt='';boton.append(img,document.createTextNode(nombre));boton.onclick=()=>{tipo.value=valor;tipo.dispatchEvent(new Event('change',{bubbles:true}));};boton.dataset.tipo=valor;opciones.append(boton);}
 const actualizar=()=>{for(const boton of opciones.children)boton.setAttribute('aria-pressed',String(boton.dataset.tipo===tipo.value));};tipo.addEventListener('change',actualizar);tipo.form?.addEventListener('reset',()=>queueMicrotask(actualizar));tipo.after(opciones);tipo.hidden=true;actualizar();
}
if(document.body.dataset.vista==='mi-automovil'){
 const iconos=()=>{for(const resumen of document.querySelectorAll('summary'))if(/bitácora/i.test(resumen.textContent)&&!resumen.querySelector('.icono-bitacora-nuevo')){const img=document.createElement('img');img.className='icono-bitacora-nuevo';img.src='/images/bitacora-cuaderno.webp';img.alt='';resumen.prepend(img);}};
 iconos();new MutationObserver(iconos).observe(document.querySelector('#garaje')??document.body,{childList:true,subtree:true});
}
