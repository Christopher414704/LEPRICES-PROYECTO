import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// El OCR corre en CPU, una página a la vez; no comparte la VRAM de LM Studio.
export function seleccionarPaginasPdf(paginas,limite=6) {
  const puntaje=t=>[...String(t).matchAll(/cilindrada|displacement|engine|motor|transmi|fuel|combustible|consum|economy|tracci|drive|specification|datos técnicos|características/gi)].length;
  const orden=paginas.map((p,i)=>({n:i+1,puntos:puntaje(p)})).filter(p=>p.puntos>0).sort((a,b)=>b.puntos-a.puntos||a.n-b.n);
  const elegidas=new Set([1,2].filter(n=>n<=paginas.length));
  for(const p of orden)if(elegidas.size<limite)elegidas.add(p.n);
  return [...elegidas].sort((a,b)=>a-b);
}
export async function leerPdfVehiculo(bytes, { ocr, alRenderizar,consulta } = {}) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const tarea = getDocument({ data: bytes, isEvalSupported: false, verbosity: 0 });
  let worker;
  try {
    const pdf = await tarea.promise;
    const paginas = [], confianzas = [];
    const indice=[],textos=new Map(),inicio=Date.now();
    // Localiza las especificaciones aunque estén al final del manual, sin hacer OCR de todo él.
    for(let n=1;n<=Math.min(pdf.numPages,80)&&Date.now()-inicio<10000;n++) {
      const p=await pdf.getPage(n),contenido=await p.getTextContent();
      const texto=contenido.items.map(i=>i.str+(i.hasEOL?'\n':' ')).join('').trim();
      textos.set(n,texto);indice.push(texto.slice(0,18000));p.cleanup();
    }
    const elegidas=new Set(seleccionarPaginasPdf(indice));
    // Los marcadores pueden señalar una sección técnica en un PDF escaneado.
    const explorar=async(nodos,presupuesto={restantes:25})=>{
      for(const nodo of nodos??[]) {
        if(presupuesto.restantes--<=0)return;
        if(/specification|datos técnicos|características|technical|consumo/i.test(nodo.title??'')) {
          try {
            const destino=typeof nodo.dest==='string'?await pdf.getDestination(nodo.dest):nodo.dest;
            const n=destino?.[0]?(typeof destino[0]==='number'?destino[0]:await pdf.getPageIndex(destino[0]))+1:null;
            if(n && n<=pdf.numPages && elegidas.size<6)elegidas.add(n);
          }catch{/* Otro marcador puede ser legible. */}
        }
        await explorar(nodo.items,presupuesto);
      }
    };
    await explorar(await pdf.getOutline());
    if([...textos.values()].every(t=>t.replace(/\s/g,'').length<80) && pdf.numPages>=3 && elegidas.size===2)elegidas.add(3);
    let paginasOcr=0;
    const numeros=[...elegidas].sort((a,b)=>a-b);
    for (const n of numeros) {
      const pagina = await pdf.getPage(n);
      let texto = textos.get(n)??(await pagina.getTextContent()).items.map(i=>i.str+(i.hasEOL?'\n':' ')).join('').trim();
      if (texto.replace(/\s/g, '').length < 80 && paginasOcr<3) {
        paginasOcr++;
        const original = pagina.getViewport({ scale: 1 });
        const escala = Math.min(2.6, 2000 / original.width, 2600 / original.height);
        const viewport = pagina.getViewport({ scale: escala });
        const lienzo = pdf.canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
        try {
          await pagina.render({ canvasContext: lienzo.context, viewport }).promise;
          const png = lienzo.canvas.toBuffer('image/png');
          if (alRenderizar) await alRenderizar(png, n);
          if (!ocr && !worker) {
            const { createWorker } = await import('tesseract.js');
            const cachePath = fileURLToPath(new URL('../../../../.cache/ocr/',import.meta.url));
            await mkdir(cachePath, { recursive: true });
            let vencido=false, limite;
            const carga=createWorker(['eng', 'spa'], 1, { cachePath });
            carga.then(w=>{if(vencido)w.terminate();}).catch(()=>{});
            try { worker=await Promise.race([carga,new Promise((_,reject)=>{limite=setTimeout(()=>{vencido=true;reject(new Error('No se pudo iniciar OCR en 45 segundos'));},45000);})]); }
            finally { clearTimeout(limite); }
          }
          let temporizador;
          try {
            const resultado = await Promise.race([
              ocr ? ocr(png) : worker.recognize(png,{tessedit_pageseg_mode:'11'}, {text:true,blocks:true}),
              new Promise((_, reject) => { temporizador = setTimeout(() => reject(new Error('OCR excedió 45 segundos')), 45000); }),
            ]);
            const datos = resultado.data ?? resultado;
            // Una lectura dudosa no puede convertirse en especificación respaldada.
            const lineas=(datos.blocks??[]).flatMap(b=>b.paragraphs??[]).flatMap(p=>p.lines??[]);
            const legibles=lineas.filter(l=>l.confidence>=65 && l.words?.every(w=>w.confidence>=45));
            if (legibles.length) { texto=legibles.map(l=>l.text.trim()).join('\n');confianzas.push(Math.min(...legibles.map(l=>l.confidence))); }
            else if (!lineas.length && datos.confidence>=65) { texto=datos.text;confianzas.push(datos.confidence); }
            const encabezado=lineas.find(l=>/^(?:CARACTER[IÍ]STICAS|SPECIFICATIONS|FICHA T[EÉ]CNICA)\s*$/i.test(l.text.trim()));
            // Tablas de folleto en tres columnas: separar columnas evita asociar
            // «cilindrada» con el arranque de la columna vecina.
            const etiquetas=lineas.filter(l=>l.bbox.y0>=(encabezado?.bbox.y1??Infinity) && /^(?:Motor|Cilindrada|Transmisi[oó]n|Freno delantero)\s*$/i.test(l.text.trim()));
            if (!ocr && encabezado && new Set(etiquetas.map(l=>Math.min(2,Math.floor(l.bbox.x0/viewport.width*3)))).size===3) {
              const columnas=[];
              for(let col=0;col<3;col++) {
                const top=Math.ceil(encabezado.bbox.y1),left=Math.floor(viewport.width*col/3),width=Math.floor(viewport.width/3);
                let limiteColumna;
                let lectura;
                try {
                  lectura=await Promise.race([worker.recognize(png,{rectangle:{left,top,width,height:Math.floor(viewport.height)-top},tessedit_pageseg_mode:'6'},{text:true,blocks:true}),new Promise((_,reject)=>{limiteColumna=setTimeout(()=>reject(new Error('OCR de columna excedió 15 segundos')),15000);})]);
                }finally{clearTimeout(limiteColumna);}
                const filas=(lectura.data.blocks??[]).flatMap(b=>b.paragraphs??[]).flatMap(p=>p.lines??[]).filter(l=>l.confidence>=65 && l.words?.every(w=>w.confidence>=45));
                columnas.push(filas.map(l=>l.text.trim()).join('\n'));
              }
              texto=[...legibles.filter(l=>l.bbox.y0<encabezado.bbox.y1).map(l=>l.text.trim()),...columnas].join('\n');
            }
          } finally { clearTimeout(temporizador); }
        } finally { pdf.canvasFactory.destroy(lienzo); }
      }
      paginas.push(`[Página ${n}]\n${texto}`); pagina.cleanup();
    }
    return { texto: paginas.join('\n').slice(0, 24000), lectura: confianzas.length ? 'ocr' : 'texto', confianza: confianzas.length ? Math.min(...confianzas) : null,
      paginas:numeros,paginasTotales:pdf.numPages,documentoLimitado:indice.length<pdf.numPages || numeros.length<pdf.numPages,modeloConsultado:consulta?.modelo };
  } finally { if (worker) await worker.terminate(); await tarea.destroy(); }
}
