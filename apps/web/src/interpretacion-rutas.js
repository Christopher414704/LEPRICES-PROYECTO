export function mostrarInterpretacionRutas(datos){
 let panel=document.getElementById('interpretacionRuta');
 if(!panel){panel=document.createElement('section');panel.id='interpretacionRuta';document.getElementById('resultadoRuta').append(panel);}
 panel.replaceChildren();
 const titulo=document.createElement('h3');titulo.textContent='Interpretación y respaldo';panel.append(titulo);
 const texto=t=>{const p=document.createElement('p');p.textContent=t;panel.append(p);};
 const estados={medido:'consumo registrado en bitácora',calibrado:'referencia de calibración',supuestos:'parámetros físicos asumidos',ingresado:'consumo ingresado',publicado:'referencia publicada'};
 texto('Respaldo: '+(estados[datos.respaldo?.estado]??'por confirmar')+'. Precisión en este viaje no validada; sin tráfico en tiempo real.');
 for(const aviso of datos.respaldo?.avisos??[])texto(aviso);
 if(datos.analisisIA?.estado==='disponible')for(const hallazgo of datos.analisisIA.hallazgos)texto(hallazgo);
 else texto(datos.analisisIA?.estado==='desactivado'?'La interpretación con Qwen es opcional y está desactivada.':'Interpretación de IA no disponible. Se conserva el cálculo del servidor.');
}
