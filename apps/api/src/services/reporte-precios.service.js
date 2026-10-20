const errorHttp=(statusCode,message)=>Object.assign(new Error(message),{statusCode});
const idValido=v=>/^[1-9]\d{0,17}$/.test(String(v??''));

export function crearReportePrecios(database,{ahora=()=>new Date()}={}){
  return async function reporte(usuario,idGasolinera){
    if(!['administrador','gestor_gasolinera'].includes(usuario?.rol))throw errorHttp(403,'Solo administradores y encargados pueden descargar precios.');
    if(!idValido(idGasolinera))throw errorHttp(400,'Selecciona una gasolinera válida.');
    // La asignación se verifica de nuevo en la misma consulta que obtiene los precios.
    // El horario limita las ediciones, no las descargas.
    const {rows}=await database.query(`
      SELECT g.id,g.nombre,g.codigo,g.direccion,g.municipio,g.departamento,
        cg.id AS id_combustible,cg.nombre_comercial,tc.nombre AS tipo,
        ms.codigo AS modalidad,pc.precio,trim(pc.codigo_moneda) AS moneda,
        pc.unidad_medida,pc.fecha_vigencia_inicio
      FROM usuarios u JOIN roles r ON r.id=u.id_rol AND r.activo=TRUE
      JOIN gasolineras g ON g.id=$2 AND g.activo=TRUE
        AND (r.codigo='administrador' OR (r.codigo='gestor_gasolinera' AND u.id_gasolinera=g.id))
      LEFT JOIN combustibles_gasolinera cg ON cg.id_gasolinera=g.id AND cg.activo=TRUE
      LEFT JOIN tipos_combustible tc ON tc.id=cg.id_tipo_combustible AND tc.activo=TRUE
      LEFT JOIN modalidades_servicio ms ON ms.activo=TRUE AND ms.codigo IN ('autoservicio','servicio_manual')
      LEFT JOIN precios_combustible pc ON pc.id_combustible_gasolinera=cg.id
        AND pc.id_modalidad_servicio=ms.id AND pc.fecha_vigencia_fin IS NULL
      WHERE u.id=$1 AND u.activo=TRUE AND r.codigo IN ('administrador','gestor_gasolinera')
      ORDER BY cg.orden_visual,cg.id,ms.orden_visual
    `,[usuario.id,String(idGasolinera)]);
    if(!rows.length)throw errorHttp(404,'La gasolinera no está disponible o no tienes permiso para descargarla.');
    const g=rows[0];
    return {gasolinera:{id:String(g.id),nombre:g.nombre,codigo:g.codigo,direccion:g.direccion,municipio:g.municipio,departamento:g.departamento},
      consultadoEn:ahora().toISOString(),categorias:[['autoservicio','Autoservicio'],['servicio_manual','Servicio completo']].map(([codigo,nombre])=>({codigo,nombre,
        precios:rows.filter(r=>r.modalidad===codigo&&r.id_combustible!=null&&r.tipo).map(r=>({combustible:r.nombre_comercial,tipo:r.tipo,
          precio:r.precio==null?null:Number(r.precio),moneda:r.moneda??null,unidad:r.unidad_medida??null,vigenteDesde:r.fecha_vigencia_inicio??null}))}))};
  };
}
