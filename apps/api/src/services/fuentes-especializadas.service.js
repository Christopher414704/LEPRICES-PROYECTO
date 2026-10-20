import { load } from 'cheerio';
import { normalizarBusqueda } from './identidad-investigacion.js';
import { leerPdfVehiculo } from './lectura-pdf-vehiculos.js';
import { crearLectorWebPublico, urlPublica } from './lectura-web-publica.js';

// No URLs aportadas por el cliente. Cada redirección vuelve a comprobarse.
const fabricantes = ['honda.com', 'honda.com.gt', 'yamaha-motor.eu', 'yamaha-motor.com', 'suzukicycles.com', 'suzuki.com.gt', 'kawasaki.com', 'ktm.com', 'bajajauto.com', 'tvsmotor.com', 'toyota.com', 'toyota.com.gt', 'toyota.mx', 'toyota.com.ec', 'ford.com', 'hyundai.com', 'kia.com', 'nissanusa.com', 'mazdausa.com', 'bmw.com', 'mercedes-benz.com', 'lamborghini.com'];
fabricantes.push('suzuki.com.co', 'suzukimotos.pe', 'suzukimotos.com.bo', 'globalsuzuki.com');
fabricantes.push('motosfreedom.com.gt','motosfreedom.com');
const dominiosMarca={freedom:['motosfreedom.com.gt','motosfreedom.com']};
const especialistas = ['motorcyclespecs.co.za', 'cycleworld.com', 'caranddriver.com', 'auto-data.net', 'motor1.com'];
export function fuentePermitida(valor) {
  try {
    const u = new URL(valor);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && [...fabricantes, ...especialistas].some(d => u.hostname === d || u.hostname.endsWith('.' + d));
  } catch { return false; }
}
const contiene = (texto,valor) => {
  const partes=normalizarBusqueda(valor).match(/[a-z]+|\d+/g);
  return partes?.length ? new RegExp(`(?:^| )${partes.join('\\s*')}(?: |$)`).test(normalizarBusqueda(texto)) : false;
};
function identidadFuente(titulo,texto,url,consulta) {
  // La marca puede estar acreditada por el dominio del fabricante (p. ej. GN125.pdf).
  let modelo=consulta.modelo;
  const partesModelo=normalizarBusqueda(modelo).match(/[a-z]+|\d+/g)??[];
  if(partesModelo.length && !partesModelo.includes('tt') && new RegExp(`(?:^| )${partesModelo.join('\\s*')}\\s+tt(?= |\\d|$)`).test(normalizarBusqueda(titulo)))modelo+=' TT';
  if(!contiene(titulo,modelo)) {
    const base=normalizarBusqueda(modelo).replace(/ /g,'');
    const variante=normalizarBusqueda(titulo).split(' ').find(p=>/\d/.test(base) && p.startsWith(base) && /^[a-z]{1,3}$/.test(p.slice(base.length)));
    if(!variante)return null;modelo=variante.toUpperCase();
  }
  const host=new URL(url).hostname,marca=normalizarBusqueda(consulta.marca);
  const dominioFabricante=(dominiosMarca[marca]??[]).some(d=>host===d || host.endsWith('.'+d));
  if(!(contiene(titulo+' '+texto,consulta.marca) || host.split('.').includes(marca) || dominioFabricante))return null;
  const anos=[...new Set([...titulo.matchAll(/\b(?:19|20)\d{2}\b/g)].map(m=>Number(m[0])).concat([...texto.matchAll(/\b(?:modelo|model year|año|year)\s*[:·-]?\s*((?:19|20)\d{2})\b/gi)].map(m=>Number(m[1]))))];
  if(consulta.anio && anos.length && !anos.includes(consulta.anio))return null;
  return {tipo:consulta.tipo,marca:consulta.marca,modelo,anio:anos.length===1?anos[0]:null};
}
export function extraerFuente(html, url, consulta) {
  const $ = load(html);
  const titulo = $('title').first().text().trim();
  // Leer datos JSON publicados, nunca ejecutar scripts. Conservar únicamente el producto solicitado.
  const estructuradas=[],nombresEstructurados=[];
  for(const e of $('script').toArray()) {
    const crudo=$(e).text().trim();if(!crudo.startsWith('{') && !crudo.startsWith('['))continue;
    try {
      const j=JSON.parse(crudo);
      const recorrer=(v,profundidad=0)=>{
        if(!v || typeof v!=='object' || profundidad>5)return;
        if(Array.isArray(v)){for(const x of v.slice(0,100))recorrer(x,profundidad+1);return;}
        const tipos=[v['@type']].flat();
        const nombre=v.productName??(tipos.some(t=>['Product','Vehicle','Car','Motorcycle'].includes(t))?v.name:null);
        if(nombre && contiene(nombre,consulta.modelo) && contiene(nombre+' '+(v.brand?.name??v.brand??''),consulta.marca)) {
          estructuradas.push(nombre);
          nombresEstructurados.push(nombre);
          if(typeof v.description==='string')estructuradas.push(load(v.description).text());
          for(const p of v.additionalProperty??[])if(typeof p.name==='string' && ['string','number'].includes(typeof p.value))estructuradas.push(`${p.name}: ${p.value}`);
          // Cachés normalizadas conservan referencias a filas; solo seguir las de este producto.
          const seguir=(n,d=0)=>{if(!n||typeof n!=='object'||d>5)return;if(n.id&&j[n.id])seguir(j[n.id],d+1);if(n.name && n.values?.json)estructuradas.push(`${n.name}: ${n.values.json.join(' · ')}`);for(const x of n.specifications??n.specificationGroups??[])seguir(x,d+1);};
          seguir(v);
          // Esquemas de autos y motos: conservar etiquetas y valores originales para Gemma.
          // No confundir oferta, vendedor o productos relacionados con datos del vehículo.
          const omitir=new Set(['offers','seller','manufacturer','brand','image','url','@id','@context','@type','isRelatedTo','isSimilarTo','review','aggregateRating','description','name','productName','additionalProperty','specificationGroups','items']);
          let nodos=0;
          const propiedades=(o,ruta='',nivel=0)=>{
            if(!o || typeof o!=='object' || nivel>4 || ++nodos>120)return;
            if(['string','number'].includes(typeof o.value) && typeof (o.unitText??o.unitCode)==='string') {
              estructuradas.push(`${ruta}: ${o.value} ${o.unitText??o.unitCode}`);return;
            }
            for(const [k,x] of Object.entries(o)) {
              if(omitir.has(k))continue;
              const etiqueta=ruta?`${ruta} · ${k}`:k;
              if(['string','number','boolean'].includes(typeof x) && String(x).length<=280)estructuradas.push(`${etiqueta}: ${x}`);
              else if(Array.isArray(x)){for(const z of x.slice(0,20))if(z && typeof z==='object')propiedades(z,etiqueta,nivel+1);}
              else if(x && typeof x==='object')propiedades(x,etiqueta,nivel+1);
            }
          };propiedades(v);
        }
        for(const x of Object.values(v))if(x && typeof x==='object')recorrer(x,profundidad+1);
      };recorrer(j);
    }catch{/* Un script que no es JSON no es una fuente de datos. */}
  }
  $('script,style,noscript,nav,footer,header,form').remove();
  const principal=$('main').first();
  const raiz=principal.find('table').length ? principal : $('body table').length ? $('body') : principal.length ? principal : $('body');
  const tablas = raiz.find('table').filter((_, e) => /engine|displacement|cilindrada|transmission|transmisión|consumo|rendim|combustible|weight|masa|power|potencia/i.test($(e).text()));
  const secciones = raiz.find('[id*="spec"],[class*="technical-spec"],[id*="ficha-tecnica"],dl,[role="table"]');
  const columnas=raiz.find('.et_pb_column').filter((_,e)=>/Cilindrada|Transmisión/.test($(e).text()) && $(e).text().length<1800);
  const bloques = tablas.length ? tablas.find('tr') : secciones.length ? secciones.find('dt,dd,p,li,[role="row"]').add(secciones.find('div').filter((_,e)=>!$(e).children('div').length)) : columnas.length ? columnas : raiz.find('p,li');
  // No leer publicidad o tarjetas de otros modelos como especificaciones de este.
  const lineas = bloques.map((_, e) => $(e).text().replace(/\s+/g, ' ').trim()).get();
  // Conserva los bloques con especificaciones, no los primeros 3 KB de publicidad.
  const tecnica = /displacement|engine type|cylinder|cilindr|transmission|transmisi|fuel type|combustible|fuel consumption|consumo|rendim|redim|drive|tracci|caja|4x[24]|\d\s*(?:cc|L\b|L\/100)|di[ée]sel/i;
  // Una ficha delimitada conserva sus filas completas: el modelo interpreta etiquetas nuevas.
  const filas = tablas.length || secciones.length ? lineas : lineas.filter((l, i) => tecnica.test(l) || (i && tecnica.test(lineas[i - 1])));
  if(!tablas.length && !secciones.length && !columnas.length){const largas=filas.filter(l=>l.length>25);filas.splice(0,filas.length,...largas.slice(0,20));}
  const texto = [titulo, ...[...new Set([...filas,...estructuradas])].filter(l => l.length < 1200)].join('\n').slice(0, 16000);
  if (texto.length <= titulo.length + 20) return null;
  const identidad=identidadFuente([titulo,...nombresEstructurados].join(' '),texto,url,consulta);if(!identidad)return null;
  return { id: 'especializada', titulo, url, texto, origen: fabricantes.some(d => new URL(url).hostname === d || new URL(url).hostname.endsWith('.' + d)) ? 'Fabricante · ficha técnica' : 'Fuente automotriz especializada', identidad };
}
export async function extraerPdf(bytes,url,consulta,lectorPdf) {
  const lectura = await lectorPdf(bytes,{consulta});
  const { texto } = lectura;
  // Se conserva el nombre leído, nunca el nombre pedido como prueba de identidad.
  const titulo = texto.slice(0, 1000);
  const identidad = identidadFuente(titulo, texto, url, consulta); if (!identidad) return null;
  const filas=texto.split('\n');
  const lineas = filas.filter((l,i) => /motor|engine|cilind|transmi|mec[aá]nica|marchas|gasolina|petrol|di[eé]sel|consumo|fuel|drive|tracci|\bcc\b/i.test(l) || i>0 && /motor|cilind|transmi|consumo|fuel|tracci/i.test(filas[i-1]));
  return { id:'especializada', titulo:titulo.slice(0,120), texto:[titulo,...lineas].join('\n').slice(0,16000), url, origen:'Ficha técnica PDF', identidad, lectura:lectura.lectura, confianza:lectura.confianza,paginas:lectura.paginas,documentoLimitado:lectura.documentoLimitado };
}
export function crearFuentesEspecializadas({ solicitar = fetch, referencias, lectorPdf = leerPdfVehiculo, resolver } = {}) {
  const lector=crearLectorWebPublico({solicitar,...(resolver?{resolver}:{})});
  const leer=url=>lector.leer(url);
  async function leerFuente(url,consulta) {
    const pagina=await leer(url);
    const f=pagina.pdf?await extraerPdf(pagina.pdf,pagina.url,consulta,lectorPdf):extraerFuente(pagina.html,pagina.url,consulta);
    const enlaces=[];
    if(pagina.html) {
      const $=load(pagina.html);
      for(const e of $('a[href]').toArray()) {
        const a=$(e),nombre=a.text().replace(/\s+/g,' ').trim();
        try {
          const u=new URL(a.attr('href'),pagina.url);
          if(urlPublica(u.href) && /manual|spec|ficha|t[eé]cnic|consum|economy|\.pdf/i.test(nombre+' '+u.pathname))enlaces.push({url:u.href,titulo:nombre.slice(0,140),pdf:/\.pdf$/i.test(u.pathname)});
        }catch{/* Ignorar enlaces inválidos. */}
      }
    }
    return {fuente:f?{...f,origen:fuentePermitida(pagina.url)?f.origen:'Referencia web secundaria · verificar versión'}:null,enlaces:[...new Map(enlaces.map(e=>[e.url,e])).values()].slice(0,8)};
  }
  return { leerFuente, async buscar(consulta, { visitadas = new Set(), maximo = 3 } = {}) {
    const enlaces = [];
    // Índice público del fabricante: funciona incluso si Wikipedia no conoce el modelo.
    if (consulta.tipo === 'moto' && normalizarBusqueda(consulta.marca) === 'honda') {
      try {
        const indice = await leer('https://powersports.honda.com/motorcycle'); const $ = load(indice.html);
        const modelo = normalizarBusqueda(consulta.modelo).replace(/ /g, '');
        const ruta = $('a[href]').map((_, e) => $(e).attr('href')).get().find(h => /^\/motorcycle\/[^/]+\/[^/?]+$/.test(h) && normalizarBusqueda(h.split('/').pop()).replace(/ /g, '') === modelo);
        if (ruta && consulta.anio) enlaces.push(`https://powersports.honda.com${ruta}/${consulta.anio}/${ruta.split('/').pop()}`);
      } catch { /* Las otras fuentes siguen disponibles. */ }
    }
    if (consulta.objetivo==='manual' && consulta.tipo==='moto' && normalizarBusqueda(consulta.marca)==='suzuki') {
      // Índice oficial regional: respaldo cuando el buscador limita consultas.
      try {
        const indice=await leer('https://www.suzukimotos.pe/');const $=load(indice.html);
        const modelo=normalizarBusqueda(consulta.modelo).replace(/ /g,'');
        const ruta=$('a[href]').map((_,e)=>$(e).attr('href')).get().find(h=>{
          try {const u=new URL(h,indice.url);return fuentePermitida(u.href) && normalizarBusqueda(u.pathname.split('/').filter(Boolean).pop()).replace(/ /g,'')===modelo;}catch{return false;}
        });
        if(ruta) enlaces.push(new URL(ruta,indice.url).href);
      }catch { /* Continúa la búsqueda general. */ }
    }
    try { enlaces.push(...await referencias(consulta)); } catch { /* No depender de un solo índice. */ }
    const fuentes = [];
    const cola = [...new Set(enlaces)].filter(urlPublica).filter(u => !visitadas.has(u)).slice(0, 8);
    let intentos = 0;
    while (cola.length && fuentes.length < maximo && intentos++ < 6) {
      const enlace = cola.shift(); if (visitadas.has(enlace)) continue;
      visitadas.add(enlace);
      try {
        const {fuente:f,enlaces:documentos}=await leerFuente(enlace,consulta);
        if (f) fuentes.push({ ...f, enlaces:documentos, id:`especializada_${visitadas.size}` });
        // Las fichas y manuales enlazados por el fabricante también se investigan.
        if (f)cola.unshift(...documentos.filter(d=>d.pdf && !visitadas.has(d.url)).slice(0,2).map(d=>d.url));
      } catch { /* Otro documento o sitio todavía puede aportar los campos pendientes. */ }
    }
    return fuentes;
  } };
}
