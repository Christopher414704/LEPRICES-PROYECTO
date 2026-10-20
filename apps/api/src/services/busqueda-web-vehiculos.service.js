import { load } from 'cheerio';
import { fuentePermitida } from './fuentes-especializadas.service.js';
import { urlPublica } from './lectura-web-publica.js';

const terminos={
  motorLitros:['motor cilindrada ficha técnica','engine displacement specifications'],motorCc:['motor cilindrada ficha técnica','engine displacement specifications'],
  cilindros:['motor número cilindros','engine cylinders specifications'],transmision:['transmisión caja número marchas manual','transmission gearbox gears specifications'],
  traccion:['tracción rueda motriz ficha técnica','drivetrain driven wheels specifications'],combustible:['tipo combustible octanaje RON AKI manual fabricante','fuel type minimum octane RON AKI owner manual'],
  consumoCiudadL100:['consumo ciudad urbano km/l','city urban fuel consumption mpg km/l'],
  consumoCarreteraL100:['consumo carretera extraurbano km/l','highway extra urban fuel economy mpg km/l'],
  consumoCombinadoL100:['consumo rendimiento general combustible km/l km/galón ficha técnica','general fuel economy mileage combined km/l km/gallon specifications'],
};
export function consultaBusqueda(consulta) {
  const ingles=consulta.idioma==='en';
  const objetivo=terminos[consulta.campo]?.[ingles?1:0] ?? (consulta.objetivo==='consumo'?'fuel consumption city highway combined km/l specifications':consulta.objetivo==='manual'?'ficha tecnica motor transmision combustible -filetype:pdf':'ficha tecnica Guatemala');
  const enfoque={manual:ingles?' owner manual fuel economy octane':' manual usuario rendimiento combustible octanaje',prueba:ingles?' documented fuel consumption road test':' prueba consumo rendimiento medido'}[consulta.enfoque]??'';
  return `${consulta.marca} ${consulta.modelo}${consulta.anio && consulta.alcance!=='general'?' '+consulta.anio:''}${consulta.version?' '+consulta.version:''} ${objetivo}${enfoque}${consulta.campo && consulta.mercado?' '+consulta.mercado:''}`;
}

// Búsqueda HTML pública, sin credenciales. No evade bloqueos del proveedor.
export function configurarBusquedaWeb(variables=process.env) {
  if(!variables.VEHICULOS_SEARXNG_URL)return null;
  const u=new URL(variables.VEHICULOS_SEARXNG_URL);
  if(u.protocol!=='http:' || !['127.0.0.1','localhost','[::1]'].includes(u.hostname) || u.username || u.password || u.search || u.hash || !['/','/search'].includes(u.pathname))throw new Error('VEHICULOS_SEARXNG_URL debe apuntar a SearXNG local, sin credenciales ni parámetros.');
  u.pathname='/search';return u;
}
export function crearBusquedaWebVehiculos({ solicitar = fetch, ahora = Date.now, searxng=configurarBusquedaWeb() } = {}) {
  const cache = new Map();
  async function obtener(url) {
    const r=await solicitar(url,{redirect:'error',signal:AbortSignal.timeout(12000),headers:{Accept:'text/html,application/rss+xml'}});
    if(!r.ok)throw new Error('El buscador web no respondió.');
    let texto='',bytes=0;const decoder=new TextDecoder();
    for await(const trozo of r.body){bytes+=trozo.length;if(bytes>500000)throw new Error('Respuesta demasiado grande');texto+=decoder.decode(trozo,{stream:true});}
    return texto+decoder.decode();
  }
  return { async buscar(consulta) {
    // La segunda pasada amplía a referencias del modelo; nunca confirma el año por ello.
    const q = consultaBusqueda(consulta);
    const previa = cache.get(q); if (previa?.hasta > ahora()) return previa.enlaces;
    const url = new URL('https://html.duckduckgo.com/html/'); url.searchParams.set('q', q);
    let enlaces=[],fallo;
    if(searxng) {
      try {
        const u=new URL(searxng);u.search=new URLSearchParams({q,format:'json',categories:'general',language:consulta.idioma==='en'?'en':'es',safesearch:'0'});
        const datos=JSON.parse(await obtener(u));
        if(!Array.isArray(datos.results))throw new Error('SearXNG devolvió resultados inválidos.');
        enlaces=datos.results.map(r=>r.url).filter(u=>typeof u==='string' && urlPublica(u));
      }catch(e){fallo=e;}
    }
    if(!enlaces.length)try {
      const $=load(await obtener(url));
      if($('form[action*="anomaly"],#challenge-form').length)throw new Error('El buscador web limitó las consultas.');
      enlaces=$('.result__a').map((_,e)=>{try{const u=new URL($(e).attr('href'),'https://duckduckgo.com');return u.hostname==='duckduckgo.com'?u.searchParams.get('uddg'):u.href;}catch{return null;}}).get().filter(urlPublica);
    }catch(e){fallo=e;}
    if(!enlaces.length) {
      try {
        const respaldo=new URL('https://www.bing.com/search');respaldo.search=new URLSearchParams({q,format:'rss'});
        const $=load(await obtener(respaldo),{xmlMode:true});
        enlaces=$('rss channel item > link').map((_,e)=>$(e).text().trim()).get().filter(urlPublica);
      }catch(e){fallo??=e;}
    }
    if(!enlaces.length && fallo)throw fallo;
    // Los fabricantes conocidos se leen primero, sin excluir nuevas fuentes públicas.
    const unicos=[...new Set(enlaces)].sort((a,b)=>Number(fuentePermitida(b))-Number(fuentePermitida(a))).slice(0,8);
    if(cache.size>=100)cache.delete(cache.keys().next().value);
    cache.set(q,{enlaces:unicos,hasta:ahora()+900000});
    return unicos;
  } };
}
