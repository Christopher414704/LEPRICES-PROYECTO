const errorHttp = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const positivo = (valor) => typeof valor === "number" && Number.isFinite(valor) && valor > 0;

function sinEstimacion(motivo, mensaje) {
  return { disponible: false, motivo, mensaje, fuente: null, unidad: "L/100 km",
    consumoL100Km: null, rendimientoKmLitro: null, litrosPorKm: null, datosUsuario: null, referencia: null };
}

export function estimarConsumo(ficha = {}, medicion = null) {
  if (/^(electricity|electricidad|eléctrico|electrico)$/i.test(ficha.combustible?.trim() ?? "")) {
    return sinEstimacion("vehiculo_electrico", "Este vehículo es eléctrico. El consumo de combustible en litros no aplica.");
  }
  let litrosPorKm;
  let fuente;
  if (medicion && positivo(medicion.distanciaKm) && positivo(medicion.litros)) {
    litrosPorKm = medicion.litros / medicion.distanciaKm;
    fuente = "usuario";
  } else if (ficha.consumo?.unidad === "L/100 km" && positivo(ficha.consumo.combinado)) {
    litrosPorKm = ficha.consumo.combinado / 100;
    fuente = "catalogo";
  } else {
    return sinEstimacion("informacion_insuficiente", "No hay información suficiente para estimar el consumo. Registra los kilómetros recorridos y los litros consumidos en el mismo intervalo.");
  }
  // Se conserva la precisión de cálculo para que rutas no dependa del redondeo de la interfaz.
  return { disponible: true, motivo: null, fuente, unidad: "L/100 km",
    consumoL100Km: litrosPorKm * 100, rendimientoKmLitro: 1 / litrosPorKm, litrosPorKm,
    mensaje: fuente === "usuario" ? "Estimación basada en tu medición de consumo." : "Consumo combinado de referencia del vehículo registrado.",
    datosUsuario: fuente === "usuario" ? medicion : null,
    referencia: fuente === "catalogo" ? { proveedor: ficha.proveedor, ciclo: "combinado" } : null };
}

export function validarMedicionConsumo(datos) {
  const leer = (valor, maximo, nombre) => {
    if (!["string", "number"].includes(typeof valor) || !/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(String(valor)) ||
        Number(valor) <= 0 || Number(valor) > maximo) {
      throw errorHttp(400, `Indica ${nombre} mayores que cero, con hasta dos decimales y un máximo de ${maximo}.`);
    }
    return Number(valor);
  };
  return { distanciaKm: leer(datos?.distanciaKm, 1000000, "kilómetros recorridos"),
    litros: leer(datos?.litros, 100000, "litros consumidos") };
}

export function crearServicioConsumoVehiculo(db) {
  function validarAcceso(usuario, id) {
    if (!usuario?.id) throw errorHttp(401, "Inicia sesión para consultar el consumo de tu vehículo.");
    if (usuario.rol !== "conductor") throw errorHttp(403, "El consumo del vehículo requiere una cuenta de conductor.");
    if (typeof id !== "string" || !/^[1-9]\d{0,17}$/.test(id)) throw errorHttp(400, "Vehículo inválido.");
  }

  async function obtener(usuario, id) {
    validarAcceso(usuario, id);
    const { rows: [fila] } = await db.query(`
      SELECT v.id, COALESCE(v.ficha_personal, c.ficha) AS ficha,
        cp.distancia_km, cp.litros, cp.fecha_actualizacion
      FROM vehiculos_usuario v
      LEFT JOIN catalogo_vehiculos c ON c.id=v.id_catalogo
      LEFT JOIN consumo_personal_vehiculo cp ON cp.id_vehiculo=v.id
      WHERE v.id=$1 AND v.id_usuario=$2
    `, [id, usuario.id]);
    if (!fila) throw errorHttp(404, "No encontramos el vehículo en tu garaje.");
    const medicion = fila.distancia_km == null ? null : { distanciaKm: Number(fila.distancia_km),
      litros: Number(fila.litros), actualizadoEn: fila.fecha_actualizacion };
    return { idVehiculo: String(fila.id), ...estimarConsumo(fila.ficha, medicion) };
  }

  async function guardar(usuario, id, datos) {
    validarAcceso(usuario, id);
    const medicion = validarMedicionConsumo(datos);
    // La lectura y el guardado validan propietario en cada sentencia, incluso si se elimina el vehículo entre ambas.
    const actual = await obtener(usuario, id);
    if (actual.motivo === "vehiculo_electrico") throw errorHttp(400, actual.mensaje);
    const { rows: [fila] } = await db.query(`
      INSERT INTO consumo_personal_vehiculo (id_vehiculo, distancia_km, litros)
      SELECT id, $3, $4 FROM vehiculos_usuario WHERE id=$1 AND id_usuario=$2
      ON CONFLICT (id_vehiculo) DO UPDATE SET distancia_km=EXCLUDED.distancia_km,
        litros=EXCLUDED.litros, fecha_actualizacion=CURRENT_TIMESTAMP
      RETURNING fecha_actualizacion
    `, [id, usuario.id, medicion.distanciaKm, medicion.litros]);
    if (!fila) throw errorHttp(404, "No encontramos el vehículo en tu garaje.");
    return { idVehiculo: id, ...estimarConsumo({}, { ...medicion, actualizadoEn: fila.fecha_actualizacion }) };
  }

  async function eliminar(usuario, id) {
    validarAcceso(usuario, id);
    const actual = await obtener(usuario, id);
    await db.query(`DELETE FROM consumo_personal_vehiculo cp USING vehiculos_usuario v
      WHERE cp.id_vehiculo=v.id AND v.id=$1 AND v.id_usuario=$2`, [id, usuario.id]);
    // Devuelve la referencia vigente después de retirar la medición personal.
    return obtener(usuario, actual.idVehiculo);
  }

  return { obtener, guardar, eliminar };
}
