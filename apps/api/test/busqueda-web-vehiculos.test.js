import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearBusquedaWebVehiculos, configurarBusquedaWeb } from '../src/services/busqueda-web-vehiculos.service.js';
import { extraerFuente } from '../src/services/fuentes-especializadas.service.js';

test('buscador web descubre enlaces técnicos, elimina duplicados y excluye otros destinos; caché acotada por consulta', async()=>{
  let llamadas=0;
  const destino='https://www.toyota.com.gt/vehiculo/toyota-hilux-guatemala';
  const buscador=crearBusquedaWebVehiculos({solicitar:async(url,opciones)=>{
    llamadas++;assert.equal(url.hostname,'html.duckduckgo.com');assert.match(url.searchParams.get('q'),/Toyota Hilux.*Guatemala/);assert.equal(opciones.redirect,'error');
    return new Response(`<a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(destino)}">Hilux</a><a class="result__a" href="${destino}">Repetido</a><a class="result__a" href="https://127.0.0.1/spec">Privada</a><a class="result__a" href="https://toyota.com.evil.test/spec">Otro</a>`);
  }});
  const consulta={marca:'Toyota',modelo:'Hilux',anio:null};
  assert.deepEqual(await buscador.buscar(consulta),[destino]);assert.deepEqual(await buscador.buscar(consulta),[destino]);assert.equal(llamadas,1);
  await buscador.buscar({...consulta,anio:2020});assert.equal(llamadas,2);
});
test('un bloqueo del buscador o una respuesta excesiva se rechaza sin evadirlo',async()=>{
  for(const html of ['<form id="challenge-form"></form>','a'.repeat(500001)]) {
    const buscador=crearBusquedaWebVehiculos({solicitar:async()=>new Response(html)});
    await assert.rejects(buscador.buscar({marca:'Toyota',modelo:'Hilux'}));
  }
});
test('fuente sin año puede descubrir una variante exacta y conserva su identidad; no inventa el año solicitado',()=>{
  const consulta={tipo:'moto',marca:'Suzuki',modelo:'GN125',anio:null};
  const html='<title>GN125F - Motos Suzuki Guatemala</title><main><div class="et_pb_column">Cilindrada 125 cc Transmisión Mecánica 5 velocidades</div></main>';
  const fuente=extraerFuente(html,'https://suzuki.com.gt/motos/motocicletas/gn125f/',consulta);
  assert.deepEqual(fuente.identidad,{...consulta,modelo:'GN125F'});assert.match(fuente.texto,/125 cc/);
  assert.equal(extraerFuente(html,fuente.url,{...consulta,modelo:'GN250'}),null);
  assert.equal(extraerFuente(html,fuente.url,{...consulta,anio:2020}).identidad.anio,null);
  assert.equal(extraerFuente(html.replace('GN125F -','2021 GN125F -'),fuente.url,{...consulta,anio:2020}),null);
});

test('SearXNG local devuelve resultados JSON públicos y conserva el respaldo cuando falla',async()=>{
  assert.equal(configurarBusquedaWeb({}),null);
  const local=configurarBusquedaWeb({VEHICULOS_SEARXNG_URL:'http://127.0.0.1:8888'});
  assert.equal(local.pathname,'/search');
  for(const u of ['https://example.org/search','http://10.0.0.1/search','http://user@localhost/search','http://localhost/otra','http://localhost/?q=x'])assert.throws(()=>configurarBusquedaWeb({VEHICULOS_SEARXNG_URL:u}));
  let llamadas=0;
  const b=crearBusquedaWebVehiculos({searxng:local,solicitar:async u=>{
    llamadas++;assert.equal(u.hostname,'127.0.0.1');assert.equal(u.searchParams.get('format'),'json');
    return Response.json({results:[{url:'https://motosfreedom.com.gt/producto/fire-125/'},{url:'http://127.0.0.1/spec'},{url:'https://motosfreedom.com.gt/producto/fire-125/'}]});
  }});
  assert.deepEqual(await b.buscar({marca:'Freedom',modelo:'Fire 125'}),['https://motosfreedom.com.gt/producto/fire-125/']);
  assert.equal(llamadas,1);
  const hosts=[];
  const respaldo=crearBusquedaWebVehiculos({searxng:local,solicitar:async u=>{hosts.push(u.hostname);if(u.hostname==='127.0.0.1')throw Error('apagado');return new Response('<a class="result__a" href="https://motosfreedom.com.gt/producto/fire-125/">Ficha</a>');}});
  assert.equal((await respaldo.buscar({marca:'Freedom',modelo:'Fire 125'})).length,1);
  assert.deepEqual(hosts,['127.0.0.1','html.duckduckgo.com']);
});

test('dominio oficial Freedom acredita la marca sin aceptar dominios parecidos',()=>{
  const html='<title>Fire 125 – Motos Freedom Guatemala</title><main><table><tr><th>Cilindrada</th><td>125 cc</td></tr><tr><th>Transmisión</th><td>5 velocidades con embrague</td></tr></table></main>';
  const sinMarca=html.replace(' – Motos Freedom Guatemala','');
  const consulta={tipo:'moto',marca:'Freedom',modelo:'Fire 125',anio:2025};
  assert.equal(extraerFuente(sinMarca,'https://motosfreedom.com.gt/producto/fire-125/',consulta).identidad.marca,'Freedom');
  assert.equal(extraerFuente(sinMarca,'https://motosfreedom.com.gt.evil.org/producto/fire-125/',consulta),null);
  assert.equal(extraerFuente(html.replace('Fire 125 –','Fire 125 TT –'),'https://motosfreedom.com.gt/producto/fire-125-tt/',consulta).identidad.modelo,'Fire 125 TT');
});
