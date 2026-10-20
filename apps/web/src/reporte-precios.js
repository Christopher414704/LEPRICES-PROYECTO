export function fechaReporte(valor){
  if(!valor||!Number.isFinite(new Date(valor).getTime()))return 'Sin registrar';
  return new Intl.DateTimeFormat('es-GT',{timeZone:'America/Guatemala',dateStyle:'short',timeStyle:'short',hour12:false}).format(new Date(valor));
}
export function filasReporte(categoria){
  return categoria.precios.map(p=>[String(p.combustible??''),String(p.tipo??''),typeof p.precio==='number'&&Number.isFinite(p.precio)&&p.precio>0?p.precio:'Sin registrar',p.moneda??'—',p.unidad??'—',fechaReporte(p.vigenteDesde)]);
}
const encabezados=['Combustible','Tipo','Precio','Moneda','Unidad','Vigente desde (GT)'];
const ubicacion=g=>[g.direccion,g.municipio,g.departamento].filter(Boolean).join(' · ');
export async function crearExcelPrecios(datos){
  const modulo=await import('exceljs');const ExcelJS=modulo.default??modulo;
  const libro=new ExcelJS.Workbook();libro.creator='LEPRICES';libro.created=new Date(datos.consultadoEn);
  const hoja=libro.addWorksheet('Precios vigentes',{views:[{state:'frozen',ySplit:5}],pageSetup:{paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0}});
  [34,24,18,13,17,28].forEach((ancho,i)=>{hoja.getColumn(i+1).width=ancho;});
  for(const t of ['LEPRICES · Precios vigentes',datos.gasolinera.nombre,ubicacion(datos.gasolinera),'Descargado: '+fechaReporte(datos.consultadoEn)+' · Hora de Guatemala','Fuente: precios guardados en LEPRICES. Sin registrar = no hay precio vigente.']){
    const r=hoja.addRow([String(t)]);hoja.mergeCells(r.number,1,r.number,6);r.height=30;r.alignment={vertical:'middle',wrapText:true};
  }
  hoja.getRow(1).font={name:'Calibri',size:18,bold:true,color:{argb:'FFCD1924'}};
  hoja.getRow(2).font={name:'Calibri',size:14,bold:true};
  for(const categoria of datos.categorias){
    hoja.addRow([]);const titulo=hoja.addRow([categoria.nombre]);hoja.mergeCells(titulo.number,1,titulo.number,6);titulo.height=26;
    titulo.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFCD1924'}};titulo.font={name:'Calibri',bold:true,size:12,color:{argb:'FFFFFFFF'}};
    const cabecera=hoja.addRow(encabezados);cabecera.font={bold:true,color:{argb:'FFFFFFFF'}};cabecera.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF243447'}};cabecera.height=26;
    const filas=filasReporte(categoria);
    if(!filas.length){const r=hoja.addRow(['No hay combustibles registrados.']);hoja.mergeCells(r.number,1,r.number,6);r.height=26;}
    for(const [i,valores] of filas.entries()){
      const r=hoja.addRow(valores);r.height=Math.max(30,Math.ceil(String(valores[0]).length/30)*16,Math.ceil(String(valores[1]).length/22)*16);
      r.alignment={vertical:'middle',wrapText:true};r.font={name:'Calibri',size:11};
      if(i%2===0)r.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF2F5F8'}};
      r.getCell(3).numFmt='#,##0.00';r.getCell(3).alignment={horizontal:'right',vertical:'middle'};
    }
  }
  hoja.pageSetup.printArea=`A1:F${hoja.rowCount}`;
  hoja.headerFooter.oddFooter='LEPRICES | Página &P de &N';
  return libro;
}
export async function crearPdfPrecios(datos){
  const {jsPDF}=await import('jspdf');const pdf=new jsPDF({unit:'mm',format:'a4',compress:true});
  const limpio=t=>String(t??'').replace(/[—–]/g,'-').replace(/[^\x20-\x7E\u00A0-\u00FF\n]/g,'');
  let y=0;const anchos=[47,33,23,18,20,35];
  const text=(t,x,cy,size=9,bold=false)=>{pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);pdf.text(limpio(t),x,cy);};
  function pagina(nueva=false){if(nueva)pdf.addPage();pdf.setFillColor(205,25,36);pdf.rect(0,0,210,3,'F');pdf.setTextColor(205,25,36);text('LEPRICES / PRECIOS VIGENTES',17,14,11,true);pdf.setTextColor(35,48,65);y=26;
    for(const t of [datos.gasolinera.nombre,ubicacion(datos.gasolinera),'Descargado: '+fechaReporte(datos.consultadoEn)+' (Guatemala)']){pdf.setFontSize(10);for(const l of pdf.splitTextToSize(limpio(t),176)){text(l,17,y,10);y+=5;}}y+=4;
  }
  function cabecera(nombre){pdf.setFillColor(205,25,36);pdf.rect(17,y-4,176,9,'F');pdf.setTextColor(255,255,255);text(nombre,20,y+2,11,true);y+=12;pdf.setTextColor(35,48,65);let x=17;for(let i=0;i<6;i++){text(encabezados[i],x+2,y,8,true);x+=anchos[i];}y+=6;}
  pagina();
  for(const c of datos.categorias){if(y+40>274)pagina(true);cabecera(c.nombre);
    const filas=filasReporte(c);
    if(!filas.length){text('No hay combustibles registrados.',19,y);y+=10;}
    for(const valores of filas){pdf.setFont('helvetica','normal');pdf.setFontSize(9);const ls=valores.map((v,i)=>pdf.splitTextToSize(limpio(typeof v==='number'?v.toFixed(2):v),anchos[i]-4));
      const alto=Math.max(11,...ls.map(l=>l.length*4.5+5));if(y+alto>274){pagina(true);cabecera(c.nombre+' (continuación)');}
      pdf.setFillColor(242,245,248);pdf.rect(17,y-4,176,alto,'F');let x=17;
      ls.forEach((l,i)=>{l.forEach((t,j)=>text(t,x+2,y+j*4.5,9,i===2));x+=anchos[i];});y+=alto+2;
    }y+=7;
  }
  if(y+12>274)pagina(true);pdf.setTextColor(102,115,130);text('Sin registrar: no existe un precio vigente. Se exportan solo los cambios guardados.',17,y,8);
  const total=pdf.getNumberOfPages();for(let i=1;i<=total;i++){pdf.setPage(i);pdf.setTextColor(102,115,130);text('LEPRICES · '+i+' / '+total,17,289,8);}
  pdf.setProperties({title:'Precios - '+datos.gasolinera.nombre,author:'LEPRICES'});return pdf;
}
export async function descargarPrecios(datos,formato){
  const nombre='Precios-'+String(datos.gasolinera.nombre).replace(/[^\p{L}\p{N}-]/gu,'_').slice(0,70)+'-'+datos.consultadoEn.slice(0,10);
  if(formato==='pdf'){(await crearPdfPrecios(datos)).save(nombre+'.pdf');return;}
  if(formato!=='xlsx')throw new Error('Formato de descarga inválido.');
  const libro=await crearExcelPrecios(datos),buffer=await libro.xlsx.writeBuffer();
  const url=URL.createObjectURL(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const a=document.createElement('a');a.href=url;a.download=nombre+'.xlsx';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
