import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent } from 'undici';

export function direccionPublica(ip) {
  if (isIP(ip)===4) {
    const [a,b,c]=ip.split('.').map(Number);
    return !(a===0 || a===10 || a===127 || a>=224 || a===169&&b===254 || a===172&&b>=16&&b<=31 || a===192&&b===168 || a===100&&b>=64&&b<=127 || a===198&&(b===18||b===19) || a===192&&b===0 || a===192&&b===88&&c===99 || a===198&&b===51&&c===100 || a===203&&b===0&&c===113);
  }
  // Solo unicast global; excluye mecanismos que encapsulan otra dirección y redes de documentación.
  return isIP(ip)===6 && /^[23]/i.test(ip) && !/^2002:|^2001:(?:0{1,4}:|db8:|0*2:|0*10:|0*20:)/i.test(ip);
}
export function urlPublica(valor) {
  try {
    const u=new URL(valor),host=u.hostname.toLowerCase();
    return u.protocol==='https:' && !u.username && !u.password && !u.port && !isIP(host.replace(/^\[|\]$/g,'')) && host.includes('.') && !/(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(host) && u.href.length<=1800;
  }catch{return false;}
}

// Verifica todos los resultados DNS y fija esos mismos destinos al abrir la conexión.
// La IA no puede convertir una página web en acceso a servicios de la red local.
export function crearLectorWebPublico({solicitar=fetch,resolver=lookup}={}) {
  return {async leer(inicial) {
    let url=inicial;
    for(let salto=0;salto<4;salto++) {
      if(!urlPublica(url))throw new Error('Solo se pueden leer páginas HTTPS públicas.');
      const u=new URL(url),direcciones=await resolver(u.hostname,{all:true,verbatim:true});
      if(!direcciones.length || direcciones.some(d=>!direccionPublica(d.address)))throw new Error('El destino no pertenece a internet público.');
      const dispatcher=new Agent({connect:{lookup:(_host,opciones,callback)=>{
        const candidatas=direcciones.filter(d=>!opciones.family || d.family===opciones.family);
        if(!candidatas.length)return callback(new Error('Familia de dirección no disponible.'));
        if(opciones.all)callback(null,candidatas);else callback(null,candidatas[0].address,candidatas[0].family);
      }}});
      try {
        const r=await solicitar(u.href,{dispatcher,redirect:'manual',signal:AbortSignal.timeout(12000),headers:{'User-Agent':'LEPRICES/1.0 (vehicle research)',Accept:'text/html,application/pdf'}});
        if([301,302,303,307,308].includes(r.status)) {
          await r.body?.cancel();url=new URL(r.headers.get('location'),u).href;continue;
        }
        const pdf=/application\/pdf/i.test(r.headers.get('content-type')??'');
        if(!r.ok || !pdf&&!/text\/html/i.test(r.headers.get('content-type')??''))throw new Error('Documento no disponible.');
        const maximo=pdf?12000000:8000000;
        if(Number(r.headers.get('content-length'))>maximo){await r.body?.cancel();throw new Error('Documento demasiado grande.');}
        const partes=[];let bytes=0;
        for await(const parte of r.body){bytes+=parte.length;if(bytes>maximo)throw new Error('Documento demasiado grande.');partes.push(parte);}
        const contenido=new Uint8Array(bytes);let offset=0;for(const p of partes){contenido.set(p,offset);offset+=p.length;}
        return {url:u.href,html:pdf?null:new TextDecoder().decode(contenido),pdf:pdf?contenido:null};
      }finally{await dispatcher.close();}
    }
    throw new Error('Demasiadas redirecciones.');
  }};
}
