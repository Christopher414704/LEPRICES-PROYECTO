import {test} from 'node:test';
import assert from 'node:assert/strict';
import {categoriasTecnicas,fuenteSegura,crearEspecificaciones} from '../src/especificaciones-tecnicas.js';
const filas=f=>categoriasTecnicas(f).flatMap(g=>g.campos);
test('categorías conservan datos y fuentes sin confirmar automáticamente referencias',()=>{
 const ficha={tipo:'auto',proveedor:'fueleconomy',urlFuente:'https://www.fueleconomy.gov/feg/Find.do?id=1',motorLitros:1.8,consumo:{ciudad:8},puertas:4};
 const datos=filas(ficha);assert.equal(datos.find(d=>d.campo==='motorLitros').estado,'Referencia general del modelo');
 assert.equal(datos.find(d=>d.campo==='consumoCiudadL100').opciones[0].valor,'8');
 assert.ok(categoriasTecnicas(ficha).some(g=>g.nombre==='Carrocería y capacidad'));
 assert.equal(datos.find(d=>d.campo==='transmision').estado,'Información incompleta');
});
test('manuales y valores sin evidencia no aparecen confirmados',()=>{
 assert.equal(filas({proveedor:'manual',motorCc:125}).find(d=>d.campo==='motorCc').estado,'Declarado por el usuario');
 assert.equal(filas({motorCc:125}).find(d=>d.campo==='motorCc').estado,'Sin evidencia documentada');
 const f={complemento:{datos:[{campo:'potenciaKw',valor:10,estado:'confirmado',urlFuente:'javascript:alert(1)',alcance:'version',cita:'10 kW'}]}};
 assert.equal(filas(f).find(d=>d.campo==='potenciaKw').estado,'Sin evidencia documentada');
 f.complemento.datos[0].urlFuente='https://fabricante.example/manual.pdf';
 assert.equal(filas(f).find(d=>d.campo==='potenciaKw').estado,'Confirmado para la versión');
});
test('conflictos conservan todas las alternativas y no rellenan ciclos con consumo general',()=>{
 const f={motorCc:125,complemento:{datos:[{campo:'motorCc',valor:150}],conflictos:[{campo:'transmision',opciones:[{valor:'Manual'},{valor:'CVT'}]}],referenciasConsumo:[{valor:40,unidad:'km/L'}]}};
 const datos=filas(f);assert.equal(datos.find(d=>d.campo==='motorCc').estado,'En conflicto');
 assert.equal(datos.find(d=>d.campo==='transmision').opciones.length,2);
 assert.equal(datos.find(d=>d.campo==='consumoGeneral').opciones[0].unidad,'km/L');
 assert.equal(datos.find(d=>d.campo==='consumoCombinadoL100').estado,'Información incompleta');
});
test('autos, motos y eléctricos solo muestran campos aplicables',()=>{
 const ficha={alturaAsientoMm:800,puertas:4,airbags:6,motorCc:125,motorLitros:.125,abs:false};
 const moto=filas({...ficha,tipo:'moto'}),auto=filas({...ficha,tipo:'auto'});
 assert.ok(moto.some(d=>d.campo==='alturaAsientoMm'));assert.ok(!moto.some(d=>['airbags','puertas','motorLitros'].includes(d.campo)));
 assert.ok(!auto.some(d=>d.campo==='alturaAsientoMm'));
 assert.equal(moto.find(d=>d.campo==='abs').opciones[0].valor,'No');
 assert.ok(!filas({tipo:'auto',combustible:'Electricity',motorCc:1000}).some(d=>['motorCc','motorLitros','cilindros','consumoCiudadL100'].includes(d.campo)));
 assert.equal(fuenteSegura('javascript:alert(1)'),null);
});
test('renderiza fuentes y categorías como texto sin interpretar HTML de los datos',()=>{
 class Nodo {constructor(tag){this.tag=tag;this.children=[];}append(...h){this.children.push(...h);}setAttribute(nombre,valor){this[nombre]=valor;}}
 globalThis.document={createElement:tag=>new Nodo(tag)};
 try {const r=crearEspecificaciones({tipo:'moto',transmision:'<script>peligro</script>'});
 const recorrer=n=>[n,...n.children.flatMap(recorrer)];const nodos=recorrer(r);
 assert.ok(nodos.some(n=>n.textContent?.includes('<script>peligro</script>')));
 assert.ok(nodos.some(n=>n.tag==='h4'));assert.ok(!nodos.some(n=>n.tag==='script'));
 }finally{delete globalThis.document;}
});

test('HU-35 la tabla y el esquema comparten estados sin conflictos entre sinónimos', () => {
 const base={tipo:'auto',traccion:'FWD',proveedor:'fueleconomy',urlFuente:'https://catalogo.example/ficha',
  complemento:{datos:[{campo:'traccion',valor:'Front-Wheel Drive',cita:'Front-Wheel Drive.',urlFuente:'https://fabricante.example/ficha'}]}};
 assert.equal(filas(base).find(d=>d.campo==='traccion').estado,'Referencia general del modelo');
 base.complemento.datos[0].valor='RWD';
 assert.equal(filas(base).find(d=>d.campo==='traccion').estado,'En conflicto');
 const negada={complemento:{datos:[{campo:'traccion',valor:'AWD',cita:'AWD opcional según versión.',
  urlFuente:'https://fabricante.example/ficha',estado:'confirmado',alcance:'version'}]}};
 assert.notEqual(filas(negada).find(d=>d.campo==='traccion').estado,'Confirmado para la versión');
});
