import {test} from 'node:test';
import assert from 'node:assert/strict';
import {crearHerramientasVehiculos,investigarConHerramientas,llamadasHerramienta,resumirCamposInvestigados} from '../src/services/herramientas-vehiculos.js';
import {crearLectorWebPublico,direccionPublica,urlPublica} from '../src/services/lectura-web-publica.js';
import {seleccionarMaterial} from '../src/services/material-investigacion-vehiculos.js';
import {consultaBusqueda,crearBusquedaWebVehiculos} from '../src/services/busqueda-web-vehiculos.service.js';
import {crearInvestigacionVehiculos,completarCamposLiterales,comprobarEvidencias} from '../src/services/investigacion-vehiculos.service.js';
import {normalizarNumero} from '../src/services/evidencias-vehiculos.js';

const consulta={tipo:'moto',marca:'Suzuki',modelo:'GN125',anio:2022};
const url='https://www.suzukimotos.pe/gn-125/';
const pdf='https://www.suzukimotos.pe/manual.pdf';
const fuente={id:'f',url,texto:'Suzuki GN125. Fuel type: Petrol.',identidad:{...consulta,anio:null}};
const llamada=(nombre,args,id='una')=>({id,type:'function',function:{name:nombre,arguments:JSON.stringify(args)}});
const resolver=async()=>[{address:'93.184.216.34',family:4}];

test('tracción de motocicletas y cuatrimotos requiere evidencia; combustible no se deduce de la gama',()=>{
  const f={...fuente,texto:'Tracción: rueda trasera.\nCombustible: Gasolina sin plomo, mínimo 91 RON.\nMotor 125 cc con cadena.'};
  const literal=completarCamposLiterales({datos:[],descartados:[]},[f]);
  assert.equal(literal.datos.find(d=>d.campo==='traccion').valor,'rueda trasera');
  const combustible={campo:'combustible',valor:'Gasolina sin plomo, mínimo 91 RON',unidad:'',fuente:f.id,cita:'Combustible: Gasolina sin plomo, mínimo 91 RON.',version:'unspecified'};
  assert.equal(comprobarEvidencias({datos:[combustible]},[f]).datos[0].valor,combustible.valor);
  assert.equal(comprobarEvidencias({datos:[{...combustible,valor:'Gasolina premium'}]},[f]).datos.length,0);
  const basica={...fuente,texto:'Motocicleta de lujo. Motor 125 cc con cadena.'};
  const vacia=completarCamposLiterales({datos:[],descartados:[]},[basica]);
  assert.ok(!vacia.datos.some(d=>['traccion','combustible'].includes(d.campo)));
  const quad={...fuente,texto:'Drive system: selectable 2WD / 4WD.'};
  const dato={campo:'traccion',valor:'2WD / 4WD',unidad:'',fuente:quad.id,cita:quad.texto,version:'unspecified'};
  assert.equal(comprobarEvidencias({datos:[dato]},[quad]).datos[0].valor,'2WD / 4WD');
});

test('investigación permite reformular para manuales o pruebas y pregunta por rendimiento general',async()=>{
  const consultas=[];
  const sesion=crearHerramientasVehiculos({consulta,buscador:{buscar:async q=>{consultas.push(q);return [];}},lector:{}});
  await sesion.ejecutar('buscar_web',{campo:'consumoCombinadoL100',idioma:'es',alcance:'exacto',enfoque:'manual'});
  await sesion.ejecutar('buscar_web',{campo:'consumoCombinadoL100',idioma:'en',alcance:'general',enfoque:'prueba'});
  assert.equal(consultas.length,2);
  assert.match(consultaBusqueda(consultas[0]),/2022.*general.*km\/galón.*manual usuario/);
  assert.match(consultaBusqueda(consultas[1]),/general fuel economy.*road test/);
  const rechazado=await sesion.ejecutar('buscar_web',{campo:'combustible',idioma:'es',alcance:'exacto',enfoque:'inventar'});
  assert.ok(rechazado.error);assert.equal(consultas.length,2);
});
test('consumo con unidad en encabezado conserva el ciclo exacto y no acepta filas con varios valores',()=>{
  assert.deepEqual(normalizarNumero('consumoCiudadL100','8,5','L/100 km','Consumo urbano (L/100 km): 8,5'),{valor:8.5,unidad:'L/100 km'});
  assert.deepEqual(normalizarNumero('consumoCarreteraL100','5.2','L/100 km','Consumo extraurbano (L/100 km) 5.2'),{valor:5.2,unidad:'L/100 km'});
  assert.equal(normalizarNumero('consumoCiudadL100','5.2','L/100 km','Consumo extraurbano (L/100 km) 5.2'),null);
  assert.equal(normalizarNumero('consumoCombinadoL100','8','L/100 km','Consumo (L/100 km) 8'),null);
  assert.equal(normalizarNumero('consumoCiudadL100','8','L/100 km','Consumo urbano (L/100 km) 8 12'),null);
});
for(const tipo of ['auto','moto'])test(`el respaldo distribuye búsquedas por campos para ${tipo} con presupuesto acotado`,async()=>{
  const queries=[];
  const sesion=crearHerramientasVehiculos({consulta:{...consulta,tipo},buscador:{buscar:async q=>{queries.push(q);return []; }},lector:{leerFuente:async()=>{throw Error('Sin enlaces');}}});
  await investigarConHerramientas({sesion,consulta:{...consulta,tipo},pendientes:['motorLitros','motorCc','cilindros','transmision','traccion','combustible','consumoCiudadL100','consumoCarreteraL100'],inferir:async()=>({choices:[{message:{content:'Sin llamadas'}}]})});
  assert.equal(queries.length,7);assert.equal(new Set(queries.map(q=>q.campo)).size,7);assert.ok(queries.some(q=>q.campo==='combustible'));assert.ok(!queries.some(q=>q.campo==='motorLitros'));assert.equal(sesion.busquedasRestantes,1);
});
test('informe distingue pendiente, búsqueda sin evidencia, rechazo y conflicto',()=>{
  const campos=['motorLitros','motorCc','transmision','traccion','combustible','cilindros'];
  const r=resumirCamposInvestigados(campos,{datos:[{campo:'motorCc'}],descartados:[{campo:'transmision',motivo:'Versión ambigua'}],conflictos:[{campo:'traccion'}],busqueda:{herramientas:[{herramienta:'buscar_web',campo:'combustible'}]}});
  assert.deepEqual(r.map(d=>d.estado),['respaldado','respaldado','evidencia_rechazada','conflicto','sin_evidencia','pendiente']);
});
test('cajas manual y automática en una misma página requieren versión literal en la cita',()=>{
  const f={...fuente,texto:'Versión Base: caja manual 5 velocidades.\nVersión Lujo: caja automática 6 velocidades.'};
  const candidato={campo:'transmision',valor:'manual',unidad:'',fuente:'f',cita:'Versión Base: caja manual 5 velocidades.',version:'unspecified'};
  assert.equal(comprobarEvidencias({datos:[candidato]},[f]).datos.length,0);
  assert.equal(comprobarEvidencias({datos:[{...candidato,version:'Versión Base'}]},[f]).datos.length,1);
});
test('una ficha con 4x2 y 4x4 no atribuye una tracción al modelo entero',()=>{
  const f={...fuente,texto:'Versión Base: tracción 4x2.\nVersión Lujo: tracción 4x4.'};
  const candidato={campo:'traccion',valor:'4x4',unidad:'',fuente:'f',cita:'Versión Lujo: tracción 4x4.',version:'unspecified'};
  assert.equal(comprobarEvidencias({datos:[candidato]},[f]).datos.length,0);
  assert.equal(comprobarEvidencias({datos:[{...candidato,version:'Versión Lujo'}]},[f]).datos.length,1);
});

test('cilindrada en encabezado de tabla se recupera aunque Qwen la omita; no confunde depósito ni transmisión final',()=>{
  const f={...fuente,texto:'Suzuki GN125\nCilindrada (cm³) 124.0\nCaja de cambios5-speed\nTransmisión finalChain (final drive)\nCapacidad del depósito (l)10,3'};
  const r=completarCamposLiterales({datos:[],descartados:[]},[f]);
  assert.equal(r.datos.find(d=>d.campo==='motorCc').valor,124);
  assert.equal(r.datos.find(d=>d.campo==='transmision').valor,'5-speed');
  assert.equal(r.datos.some(d=>d.campo==='motorLitros'),false);
  const ambiguo={...f,texto:f.texto+'\nCilindrada (cm³) 150.0'};
  assert.equal(completarCamposLiterales({datos:[],descartados:[]},[ambiguo]).datos.some(d=>d.campo==='motorCc'),false);
  assert.equal(comprobarEvidencias({datos:[{campo:'motorCc',valor:'124.0',unidad:'cm³',fuente:'f',cita:'Capacidad del depósito (cm³) 124.0',version:''}]},[{...f,texto:'Capacidad del depósito (cm³) 124.0'}]).datos.length,0);
});

test('URLs y DNS públicos: bloquea IPs privadas, mixtas, metadatos y cada redirección',async()=>{
  for(const ip of ['127.0.0.1','10.1.1.1','172.20.1.1','192.168.1.1','169.254.169.254','100.64.0.1','198.18.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1','2002:7f00:1::'])assert.equal(direccionPublica(ip),false,ip);
  assert.equal(direccionPublica('8.8.8.8'),true);assert.equal(direccionPublica('2606:4700::1111'),true);
  for(const u of ['https://localhost/','http://example.org/','https://user:pass@example.org/','https://example.org:1234/','https://127.0.0.1/','https://host.internal/'])assert.equal(urlPublica(u),false);
  let peticiones=0;
  const lector=crearLectorWebPublico({resolver:async()=>[{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}],solicitar:async()=>{peticiones++;}});
  await assert.rejects(lector.leer(url),/internet público/);assert.equal(peticiones,0);
  const redirigido=crearLectorWebPublico({resolver,solicitar:async()=>{peticiones++;return new Response('',{status:302,headers:{location:'https://169.254.169.254/latest/meta-data/'}});}});
  await assert.rejects(redirigido.leer(url),/HTTPS públicas/);assert.equal(peticiones,1);
});

test('lector fija las direcciones verificadas; acepta HTML público nuevo y rechaza documentos excesivos',async()=>{
  const lector=crearLectorWebPublico({resolver,solicitar:async(_url,opciones)=>{
    assert.ok(opciones.dispatcher);assert.equal(opciones.redirect,'manual');
    return new Response('<title>Ficha</title>',{headers:{'content-type':'text/html'}});
  }});
  assert.match((await lector.leer('https://fichas-vehiculos.org/modelo')).html,/Ficha/);
  const gigante=crearLectorWebPublico({resolver,solicitar:async()=>new Response('',{headers:{'content-type':'application/pdf','content-length':'12000001'}})});
  await assert.rejects(gigante.leer(url),/demasiado grande/);
});

test('búsquedas por campo en dos idiomas y respaldo RSS conservan nuevos destinos públicos',async()=>{
  assert.match(consultaBusqueda({...consulta,campo:'transmision',idioma:'es',alcance:'exacto'}),/2022.*transmisión/);
  assert.match(consultaBusqueda({...consulta,campo:'consumoCarreteraL100',idioma:'en',alcance:'general'}),/highway/);
  assert.doesNotMatch(consultaBusqueda({...consulta,campo:'combustible',idioma:'en',alcance:'general'}),/2022/);
  const llamadas=[];
  const b=crearBusquedaWebVehiculos({solicitar:async u=>{llamadas.push(u.hostname);return new Response(u.hostname==='html.duckduckgo.com'?'<form id="challenge-form"></form>':`<rss><channel><item><link>https://fichas-vehiculos.org/gn125</link></item></channel></rss>`);}});
  assert.deepEqual(await b.buscar(consulta),['https://fichas-vehiculos.org/gn125']);assert.deepEqual(llamadas,['html.duckduckgo.com','www.bing.com']);
});

test('herramientas no aceptan URL inventada ni otra identidad; siguen manual descubierto y limitan acciones',async()=>{
  let lecturas=0,queries=[];
  const sesion=crearHerramientasVehiculos({consulta,buscador:{buscar:async q=>{queries.push(q);return[url];}},lector:{leerFuente:async u=>{lecturas++;return {fuente:{...fuente,url:u},enlaces:u===url?[{url:pdf,pdf:true}]:[]};}}});
  assert.match((await sesion.ejecutar('leer_pagina',{url:'https://inventada.org/'})).error,/descubierto/);assert.equal(lecturas,0);
  assert.match((await sesion.ejecutar('buscar_web',{campo:'ficha',idioma:'es',alcance:'general',marca:'Honda'})).error,/inválida/);
  await sesion.ejecutar('buscar_web',{campo:'combustible',idioma:'es',alcance:'general'});assert.equal(queries[0].marca,'Suzuki');
  await sesion.ejecutar('leer_pagina',{url});await sesion.ejecutar('leer_pdf',{url:pdf});assert.equal(lecturas,2);assert.equal(sesion.documentos.length,2);
  for(let i=0;i<24;i++)await sesion.ejecutar('buscar_web',{campo:'ficha',idioma:'en',alcance:'general'});
  assert.equal(sesion.restantes,0);assert.ok(queries.length<=8);
});

test('Qwen llama búsqueda y lectura, recibe resultados de herramientas y no ejecuta texto como código',async()=>{
  const sesion=crearHerramientasVehiculos({consulta,buscador:{buscar:async()=>[url]},lector:{leerFuente:async()=>({fuente,enlaces:[]})}});
  let turnos=0;
  const r=await investigarConHerramientas({sesion,consulta,pendientes:['combustible'],inferir:async(messages,tools)=>{
    assert.equal(tools.length,turnos===1?2:3);
    if(turnos++) {assert.equal(messages.find(m=>m.role==='assistant').reasoning_content,'Buscar primero una fuente técnica.');assert.equal(messages.at(-1).role,'tool');assert.match(messages.at(-1).content,/gn-125/);return {choices:[{message:{tool_calls:[llamada('leer_pagina',{url})]}}]};}
    return {choices:[{message:{reasoning_content:'Buscar primero una fuente técnica.',tool_calls:[llamada('buscar_web',{campo:'combustible',idioma:'en',alcance:'general'})]}}]};
  }});
  assert.equal(r.llamadasModelo,3);assert.equal(r.fuentes.length,1);
  assert.equal(llamadasHerramienta({content:'<tool_call>not JSON</tool_call>'}).length,0);
});

test('si el modelo no solicita herramientas, el respaldo investiga igualmente los campos pendientes',async()=>{
  const sesion=crearHerramientasVehiculos({consulta,buscador:{buscar:async()=>[url]},lector:{leerFuente:async()=>({fuente,enlaces:[]})}});
  const r=await investigarConHerramientas({sesion,consulta,pendientes:['combustible'],inferir:async()=>({choices:[{message:{content:'No sé.'}}]})});
  assert.equal(r.fuentes.length,1);assert.ok(r.traza.some(t=>t.herramienta==='buscar_web'));
});

test('tras leer una fuente incompleta permite reformular la búsqueda y prioriza consumos',async()=>{
  const queries=[];
  const sesion=crearHerramientasVehiculos({consulta,buscador:{buscar:async q=>{queries.push(q);return[url];}},lector:{leerFuente:async()=>({fuente,enlaces:[]})}});
  let turno=0;
  await investigarConHerramientas({sesion,consulta,pendientes:['motorCc','consumoCiudadL100','consumoCarreteraL100'],inferir:async(_mensajes,tools)=>{
    turno++;
    if(turno===1)return {choices:[{message:{tool_calls:[llamada('buscar_web',{campo:'ficha',idioma:'es',alcance:'exacto'})]}}]};
    if(turno===2){assert.equal(tools.some(t=>t.function.name==='buscar_web'),false);return {choices:[{message:{tool_calls:[llamada('leer_pagina',{url})]}}]};}
    assert.equal(tools.some(t=>t.function.name==='buscar_web'),true);
    return {choices:[{message:{content:'Continuar con los ciclos pendientes.'}}]};
  }});
  assert.deepEqual(queries.map(q=>q.campo),['ficha','motorCc','consumoCiudadL100','consumoCarreteraL100']);
});

test('el límite de contexto detiene la planificación sin perder documentos ya leídos',async()=>{
  const sesion=crearHerramientasVehiculos({consulta,buscador:{buscar:async()=>[url]},lector:{leerFuente:async()=>({fuente,enlaces:[]})}});
  let llamadas=0;
  const r=await investigarConHerramientas({sesion,consulta,pendientes:['combustible'],inferir:async()=>{llamadas++;return {choices:[{message:{reasoning_content:'x'.repeat(17000),tool_calls:[llamada('buscar_web',{campo:'ficha',idioma:'es',alcance:'general'})]}}]};}});
  assert.equal(llamadas,1);assert.equal(r.fuentes.length,1);
});

test('el material técnico del final de una página se entrega completo, con etiqueta y unidad',()=>{
  const texto='Suzuki GN125\n'+Array(80).fill('Presentación y publicidad del vehículo.').join('\n')+'\nConsumo combinado: 40 km/L.\nCiclo WMTC.';
  const r=seleccionarMaterial(texto,['consumoCombinadoL100']);assert.match(r,/Consumo combinado: 40 km\/L/);assert.match(r,/WMTC/);assert.ok(r.length<=3600);
});

test('flujo integrado extrae evidencias de herramientas en el buscador y mantiene inferencias secuenciales',async()=>{
  let extracciones=0,planes=0,activos=0;
  const fuentes={buscar:async()=>[],crearHerramientas:()=>crearHerramientasVehiculos({consulta,buscador:{buscar:async()=>[url]},lector:{leerFuente:async()=>({fuente,enlaces:[]})}})};
  const investigador=crearInvestigacionVehiculos({fuentes,solicitar:async(u,opciones)=>{
    if(u.endsWith('/models'))return Response.json({data:[{id:'google/gemma-4-e4b'}]});
    assert.equal(++activos,1);const body=JSON.parse(opciones.body);assert.ok(body.max_tokens<=2048);activos--;
    if(body.tools) {planes++;return Response.json({choices:[{message:{tool_calls:[planes===1?llamada('buscar_web',{campo:'combustible',idioma:'en',alcance:'general'}):llamada('leer_pagina',{url})]}}]});}
    extracciones++;return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({datos:[{campo:'combustible',valor:'Petrol',unidad:'',fuente:'herramienta_1',cita:'Fuel type: Petrol.',version:'unspecified'}]})}}]});
  }});
  const r=await investigador.investigar(consulta,'1');assert.equal(r.datos[0].valor,'Petrol');assert.equal(planes,3);assert.equal(extracciones,1);assert.equal(r.busqueda.llamadasPlanificacion,3);
});
