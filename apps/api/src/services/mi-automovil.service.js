const normalizarBusqueda = (v) => String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
function validarAnio(v) {
 if (!/^\d{4}$/.test(String(v)) || Number(v)<1886 || Number(v)>new Date().getUTCFullYear()+2) throw errorHttp(400,'Indica un año válido.');
 return Number(v);
}
const errorHttp = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const idValido = (id) => /^[1-9]\d{0,17}$/.test(String(id ?? ""));

function presentar(fila) {
  const ficha = fila.ficha_personal ?? fila.ficha;
  return { id: String(fila.id), alias: fila.alias, kilometrajeInicial: Number(fila.kilometraje_inicial),
    kilometrajeActual:Number(fila.kilometraje_actual ?? fila.kilometraje_inicial),
    creadoEn: fila.fecha_creacion, ficha: { ...ficha, ...(fila.complemento_personal ? {complemento:fila.complemento_personal} : {}), ...(fila.anio_declarado ? {anio:fila.anio_declarado,anioDeclarado:true} : {}) }, consultadoEn: fila.fecha_consulta ?? fila.fecha_creacion };
}

export function fichaManual(datos = {}) {
  const {tipo,marca,modelo,motorCc,transmision,combustible}=datos;
  const anio=validarAnio(datos.anio,true);
  if(!['auto','moto'].includes(tipo) || typeof marca!=='string' || !marca.trim() || marca.trim().length>100 || typeof modelo!=='string' || !modelo.trim() || modelo.trim().length>150) throw errorHttp(400,'Indica tipo, marca, modelo y año de tu vehículo.');
  let cilindrada=null;
  if(motorCc!=null && motorCc!=='') {
    if(!/^\d{1,6}(?:\.\d)?$/.test(String(motorCc)) || Number(motorCc)<=0 || Number(motorCc)>100000) throw errorHttp(400,'La cilindrada debe indicarse en centímetros cúbicos.');
    cilindrada=Number(motorCc);
  }
  const cambios={manual:'Manual',automatica:'Automática',cvt:'CVT'};
  const fuels=['Regular Gasoline','Premium Gasoline','Diesel','Electricity'];
  if(transmision && !Object.hasOwn(cambios,transmision))throw errorHttp(400,'Transmisión inválida.');
  if(combustible && !fuels.includes(combustible))throw errorHttp(400,'Combustible inválido.');
  return {proveedor:'manual',tipo,marca:marca.trim(),modelo:modelo.trim(),anio,motorCc:cilindrada,motorLitros:cilindrada?cilindrada/1000:null,
    transmision:cambios[transmision] ?? null,combustible:combustible || null,traccion:null,cilindros:null,
    consumo:{ciudad:null,carretera:null,combinado:null,unidad:'L/100 km'}};
}

export function crearServicioMiAutomovil(database, catalogo) {
  function exigirConductor(usuario) {
    if (usuario?.rol !== "conductor") throw errorHttp(403, "MiAutomóvil requiere una cuenta de conductor.");
  }
  async function listar(usuario) {
    exigirConductor(usuario);
    const { rows } = await database.query(`
      SELECT v.*, c.ficha, c.fecha_consulta,
        v.kilometraje_inicial AS kilometraje_actual
      FROM vehiculos_usuario v
      LEFT JOIN catalogo_vehiculos c ON c.id=v.id_catalogo
      WHERE v.id_usuario=$1 ORDER BY v.fecha_creacion DESC, v.id DESC
    `, [usuario.id]);
    return rows.map(presentar);
  }
  async function agregar(usuario, datos) {
    exigirConductor(usuario);
    const { idExterno, alias, kilometrajeInicial, proveedor = 'fueleconomy' } = datos ?? {};
    if (!['fueleconomy','manual'].includes(proveedor) ||
        (proveedor==='web' && (typeof idExterno!=='string' || !/^[a-f0-9]{40}$/.test(idExterno))) ||
        (proveedor==='fueleconomy' && (typeof idExterno !== 'string' || !/^[1-9]\d{0,8}$/.test(idExterno))) ||
        (proveedor==='nhtsa' && (typeof idExterno !== 'string' || !/^(auto|moto):[1-9]\d{0,8}:[1-9]\d{0,8}:\d{1,4}$/.test(idExterno))) ||
        typeof alias !== "string" || !alias.trim() || alias.trim().length > 80 ||
        !/^(?:0|[1-9]\d{0,6})(?:\.\d)?$/.test(String(kilometrajeInicial ?? ""))) {
      throw errorHttp(400, "Selecciona un vehículo, escribe un nombre de hasta 80 caracteres y un kilometraje válido en kilómetros.");
    }
    // Solo se aceptan características obtenidas por el servidor, nunca una ficha enviada por el cliente.
    const ficha = proveedor==='manual' ? fichaManual(datos?.datosManuales) : await catalogo.ficha(idExterno,proveedor);
    const anioDeclarado=ficha.anio == null ? validarAnio(datos?.anio,true) : null;
    if(datos?.anio && ficha.anio && validarAnio(datos.anio)!==ficha.anio)throw errorHttp(400,'El año no corresponde a la versión seleccionada.');
    const cliente = await database.connect();
    try {
      await cliente.query("BEGIN");
      let modelo;
      if(proveedor!=='manual') ({ rows: [modelo] } = await cliente.query(`
        INSERT INTO catalogo_vehiculos (proveedor, id_externo, ficha, busqueda)
        VALUES ($1, $2, $3::jsonb, $4)
        ON CONFLICT (proveedor, id_externo) DO UPDATE SET ficha=EXCLUDED.ficha || CASE WHEN catalogo_vehiculos.ficha ? 'complemento' THEN jsonb_build_object('complemento',catalogo_vehiculos.ficha->'complemento') ELSE '{}'::jsonb END, fecha_consulta=CURRENT_TIMESTAMP
        RETURNING id, fecha_consulta
      `, [proveedor,idExterno, JSON.stringify(ficha),normalizarBusqueda(`${ficha.marca} ${ficha.modelo} ${ficha.anio ?? ''}`)]));
      const { rows: [vehiculo] } = await cliente.query(`
        INSERT INTO vehiculos_usuario (id_usuario, id_catalogo, alias, kilometraje_inicial, ficha_personal, anio_declarado)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING *
      `, [usuario.id, modelo?.id ?? null, alias.trim(), kilometrajeInicial, proveedor==='manual'?JSON.stringify(ficha):null,anioDeclarado]);
      await cliente.query("COMMIT");
      return presentar({ ...vehiculo, ficha, fecha_consulta: modelo?.fecha_consulta });
    } catch (error) {
      await cliente.query("ROLLBACK");
      throw error;
    } finally { cliente.release(); }
  }
  async function eliminar(usuario, id) {
    exigirConductor(usuario);
    if (!idValido(id)) throw errorHttp(400, "Vehículo inválido.");
    const { rowCount } = await database.query("DELETE FROM vehiculos_usuario WHERE id=$1 AND id_usuario=$2", [id, usuario.id]);
    if (!rowCount) throw errorHttp(404, "No encontramos el vehículo en tu garaje.");
  }
  return { listar, agregar, eliminar };
}
