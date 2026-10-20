import {test} from 'node:test';
import assert from 'node:assert/strict';
import {leerPdfVehiculo,seleccionarPaginasPdf} from '../src/services/lectura-pdf-vehiculos.js';

// PDF mínimo generado en memoria para comprobar páginas reales, sin descargar manuales.
function documentoPdf(textos) {
  const objetos=['<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids=[];
  for(const texto of textos) {
    const pagina=objetos.length+1,flujo=pagina+1;kids.push(`${pagina} 0 R`);
    objetos.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${flujo} 0 R >>`);
    const lineas=texto.split('\n').map(t=>`(${t.replace(/[\\()]/g,'\\$&')}) Tj 0 -18 Td`).join('\n');
    const contenido=`BT /F1 12 Tf 50 740 Td ${lineas} ET`;
    objetos.push(`<< /Length ${Buffer.byteLength(contenido)} >>\nstream\n${contenido}\nendstream`);
  }
  objetos[1]=`<< /Type /Pages /Count ${textos.length} /Kids [${kids.join(' ')}] >>`;
  let pdf='%PDF-1.4\n';const offsets=[0];
  for(let i=0;i<objetos.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objetos[i]}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for(const o of offsets.slice(1))pdf+=String(o).padStart(10,'0')+' 00000 n \n';
  pdf+=`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Buffer.from(pdf));
}

test('localiza especificaciones al final del manual, conserva identidad y limita páginas leídas',async()=>{
  const paginas=Array.from({length:10},(_,i)=>`Suzuki GN125 owner manual page ${i+1}. `+'General instructions and contents. '.repeat(4));
  paginas[8]='Suzuki GN125\nTechnical specifications\nEngine displacement: 124 cc.\nTransmission: Manual 5 speeds.\nFuel type: Petrol.\nCombined fuel consumption: 40 km/L.';
  assert.ok(seleccionarPaginasPdf(paginas).includes(9));
  const r=await leerPdfVehiculo(documentoPdf(paginas));
  assert.match(r.texto,/124 cc/);assert.match(r.texto,/40 km\/L/);assert.ok(r.paginas.includes(9));assert.ok(r.paginas.length<=6);assert.equal(r.paginasTotales,10);assert.equal(r.lectura,'texto');assert.equal(r.documentoLimitado,true);
});

test('PDF escaneado usa OCR de hasta tres páginas y conserva el número de página',async()=>{
  let ocr=0;
  const r=await leerPdfVehiculo(documentoPdf(Array(8).fill('')),{ocr:async()=>{ocr++;return {text:'Suzuki GN125. Engine displacement: 124 cc. Transmission: Manual 5 speeds.',confidence:95};}});
  assert.equal(ocr,3);assert.equal(r.lectura,'ocr');assert.match(r.texto,/Página 3/);assert.match(r.texto,/124 cc/);
});
