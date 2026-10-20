import {test} from 'node:test';
import assert from 'node:assert/strict';
import {crearExcelPrecios,crearPdfPrecios,filasReporte,fechaReporte} from '../src/reporte-precios.js';
const datos={gasolinera:{nombre:'Gasolinera de prueba',direccion:'Dirección de prueba',municipio:'Jalapa',departamento:'Jalapa'},consultadoEn:'2026-10-15T16:00:00Z',categorias:[
  {nombre:'Autoservicio',precios:[{combustible:'Regular',tipo:'Gasolina regular',precio:31.25,moneda:'GTQ',unidad:'galon',vigenteDesde:'2026-10-15T13:00:00Z'}]},
  {nombre:'Servicio completo',precios:[{combustible:'Regular',tipo:'Gasolina regular',precio:null}]}]};
test('Excel reabre con categorías, precios numéricos, unidad y valores ausentes separados de cero',async()=>{
  const libro=await crearExcelPrecios(datos),buffer=await libro.xlsx.writeBuffer();
  const modulo=await import('exceljs'),ExcelJS=modulo.default??modulo,nuevo=new ExcelJS.Workbook();await nuevo.xlsx.load(buffer);
  const h=nuevo.getWorksheet('Precios vigentes');assert.equal(nuevo.worksheets.length,1);assert.equal(h.getCell('C9').value,31.25);assert.equal(h.getCell('C13').value,'Sin registrar');assert.equal(h.getCell('A11').value,'Servicio completo');assert.equal(h.getCell('E9').value,'galon');assert.equal(h.getCell('F9').value,fechaReporte(datos.categorias[0].precios[0].vigenteDesde));
});
test('nombres que empiezan por igual se guardan como texto, no como fórmula',async()=>{
  const libro=await crearExcelPrecios({...datos,gasolinera:{...datos.gasolinera,nombre:'=1+1'}});assert.equal(libro.getWorksheet(1).getCell('A2').value,'=1+1');assert.equal(libro.getWorksheet(1).getCell('A2').type,3);
});
test('PDF incluye ambas categorías y los mismos precios; pagina listados extensos',async()=>{
  const pdf=await crearPdfPrecios(datos),t=pdf.internal.pages.flat().join('\n');for(const s of ['Autoservicio','Servicio completo','31.25','Sin registrar','GTQ','galon'])assert.ok(t.includes(s),s);
  const largo=await crearPdfPrecios({...datos,categorias:[{nombre:'Autoservicio',precios:Array.from({length:90},(_,i)=>({...datos.categorias[0].precios[0],combustible:'Producto '+i}))}]});assert.ok(largo.getNumberOfPages()>1);assert.ok(largo.internal.pages.flat().join('\n').includes('Producto 89'));
});
test('ausentes e inválidos no se convierten en precios gratis y las fechas usan Guatemala',()=>{
  for(const precio of [null,undefined,NaN,0,-1])assert.equal(filasReporte({precios:[{precio}]})[0][2],'Sin registrar');
  assert.match(fechaReporte('2026-10-15T16:00:00Z'),/10:00/);assert.equal(fechaReporte(null),'Sin registrar');
});
