import { inflateSync } from "node:zlib";
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {datosComparacion,textoCelda} from '../src/comparacion-vehiculos.js';
import {crearPdfInformeFaxcar} from '../src/faxcar-informe.js';
const a={id:'1',alias:'Auto',ficha:{tipo:'auto',marca:'Toyota',modelo:'Corolla',anio:2020,motorLitros:1.8,puertas:4}};
const b={id:'2',alias:'Moto',ficha:{tipo:'moto',marca:'Honda',modelo:'CB',anio:2021,motorCc:125}};
test('identifica modelos, conserva unidades y señala ausencias sin mutar las fichas',()=>{
 const antes=JSON.stringify([a,b]),datos=datosComparacion([a,b]);
 assert.match(datos.columnas[0].nombre,/Toyota.*Corolla.*2020/);
 const litros=datos.filas.find(f=>f.campo==='motorLitros');assert.match(textoCelda(litros.celdas[0]),/1.8 L/);
 assert.equal(litros.celdas[1].opciones.length,0);
 assert.match(textoCelda(datos.filas.find(f=>f.campo==='motorCc').celdas[1]),/125 cc/);
 assert.match(textoCelda(datos.filas.find(f=>f.campo==='puertas').celdas[1]),/Sin información/);
 assert.equal(JSON.stringify([a,b]),antes);
});
test('rechaza selección insuficiente, excesiva o duplicada',()=>{
 for(const vs of [[],[a],[a,a],[a,b,{...a,id:3},{...a,id:4},{...a,id:5}]])assert.throws(()=>datosComparacion(vs));
});
test('PDF incluye comparación y modelos sin alterar selección ni fichas',async()=>{
 const comparacion=datosComparacion([a,b]),antes=JSON.stringify(comparacion);
 const pdf=await crearPdfInformeFaxcar(a,new Date('2026-10-22'),comparacion);
 const raw=pdf.output();const texto=[...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(m=>{try{return inflateSync(Buffer.from(m[1],"latin1")).toString("latin1");}catch{return m[1];}}).join(" ");assert.match(texto,/Toyota/);assert.match(texto,/Honda/);assert.match(texto,/125 cc/);
 assert.equal(JSON.stringify(comparacion),antes);
});

test('interfaz permite seleccionar y limpiar la tabla',async()=>{
 class Nodo {constructor(tag){this.tag=tag;this.children=[];this.style={};}append(...h){this.children.push(...h);}replaceChildren(...h){this.children=h;}setAttribute(){}}
 globalThis.document={createElement:tag=>new Nodo(tag),createTextNode:text=>({text})};
 try {
 const {crearComparador}=await import('../src/comparacion-vehiculos.js');
 const c=crearComparador({descargarInforme:async()=>{}});c.actualizar([a,b]);
 const seleccion=c.panel.children[1],resultado=c.panel.children[5];
 for(const label of seleccion.children){const check=label.children[0];check.checked=true;check.onchange();}
 assert.equal(resultado.children[0].tag,'table');
 c.panel.children[2].onclick();assert.equal(resultado.children.length,0);
 assert.ok(c.panel.children[1].children.every(l=>!l.children[0].checked));
 }finally{delete globalThis.document;}
});

