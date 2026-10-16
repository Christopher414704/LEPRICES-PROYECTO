const errorHttp = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const idValido = (id) => /^[1-9]\d{0,17}$/.test(String(id ?? ""));

function numero(valor, { nombre, maximo, decimales, permiteCero = false }) {
  const patron = new RegExp(`^(?:0|[1-9]\\d{0,9})(?:\\.\\d{1,${decimales}})?$`);
  const convertido = Number(valor);
  if (!["string", "number"].includes(typeof valor) || !patron.test(String(valor)) ||
      !Number.isFinite(convertido) || (permiteCero ? convertido < 0 : convertido <= 0) || convertido > maximo) {
    throw errorHttp(400, `${nombre} debe ser un número ${permiteCero ? "mayor o igual que cero" : "mayor que cero"} con hasta ${decimales} decimales.`);
  }
  return convertido;
}

export function validarCargaCombustible(datos, ahora = new Date()) {
  const fecha = new Date(datos?.fechaCarga);
  const formatoFecha = typeof datos?.fechaCarga === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(datos.fechaCarga);
  const fechaNormalizada = formatoFecha ? datos.fechaCarga.replace(/Z$/, datos.fechaCarga.includes(".") ? "Z" : ".000Z") : "";
  if (!formatoFecha || !Number.isFinite(fecha.getTime()) || fecha.toISOString() !== fechaNormalizada ||
      fecha.getTime() > ahora.getTime() + 5 * 60 * 1000) {
    throw errorHttp(400, "Indica una fecha válida que no esté en el futuro.");
  }
  const notas = datos?.notas == null || datos.notas === "" ? null : String(datos.notas).trim();
  if (notas != null && (!notas || notas.length > 300)) throw errorHttp(400, "Las notas deben tener hasta 300 caracteres.");
  if (datos?.tanqueLleno != null && typeof datos.tanqueLleno !== "boolean") {
    throw errorHttp(400, "El indicador de tanque lleno es inválido.");
  }
  return {
    fechaCarga: fecha.toISOString(),
    kilometraje: numero(datos?.kilometraje, { nombre: "El kilometraje", maximo: 9999999.9, decimales: 1, permiteCero: true }),
    litros: numero(datos?.litros, { nombre: "Los litros", maximo: 10000, decimales: 3 }),
    costoTotal: datos?.costoTotal == null || datos.costoTotal === "" ? null
      : numero(datos.costoTotal, { nombre: "El costo total", maximo: 99999999.99, decimales: 2 }),
    tanqueLleno: datos?.tanqueLleno ?? true,
    notas,
  };
}

function presentar(fila) {
  return {
    id: String(fila.id), idVehiculo: String(fila.id_vehiculo), fechaCarga: fila.fecha_carga,
    kilometraje: Number(fila.kilometraje), litros: Number(fila.litros),
    costoTotal: fila.costo_total == null ? null : Number(fila.costo_total),
    tanqueLleno: fila.tanque_lleno, notas: fila.notas, registradoEn: fila.fecha_registro,
    rendimientoKmLitro: null,
  };
}

export function calcularRendimientos(filas = []) {
  const cargas = filas.map(presentar);
  let kilometrajeLlenoAnterior = null;
  let litrosDesdeLleno = 0;
  let distanciaTotal = 0;
  let litrosCalculados = 0;
  for (const carga of cargas) {
    litrosDesdeLleno += carga.litros;
    if (!carga.tanqueLleno) continue;
    if (kilometrajeLlenoAnterior != null && carga.kilometraje > kilometrajeLlenoAnterior && litrosDesdeLleno > 0) {
      const distancia = carga.kilometraje - kilometrajeLlenoAnterior;
      carga.rendimientoKmLitro = distancia / litrosDesdeLleno;
      distanciaTotal += distancia;
      litrosCalculados += litrosDesdeLleno;
    }
    kilometrajeLlenoAnterior = carga.kilometraje;
    litrosDesdeLleno = 0;
  }
  return { cargas: cargas.reverse(),
    rendimientoPromedioKmLitro: litrosCalculados > 0 ? distanciaTotal / litrosCalculados : null };
}

export function crearServicioBitacoraCombustible(db) {
  function validarAcceso(usuario, id) {
    if (!usuario?.id) throw errorHttp(401, "Inicia sesión para consultar tu bitácora.");
    if (usuario.rol !== "conductor") throw errorHttp(403, "La bitácora requiere una cuenta de conductor.");
    if (!idValido(id)) throw errorHttp(400, "Vehículo inválido.");
  }

  async function listar(usuario, id) {
    validarAcceso(usuario, id);
    const { rows: vehiculos } = await db.query("SELECT id FROM vehiculos_usuario WHERE id=$1 AND id_usuario=$2", [id, usuario.id]);
    if (!vehiculos.length) throw errorHttp(404, "No encontramos el vehículo en tu garaje.");
    const { rows } = await db.query(`
      SELECT id,id_vehiculo,fecha_carga,kilometraje,litros,costo_total,tanque_lleno,notas,fecha_registro
      FROM cargas_combustible WHERE id_vehiculo=$1 AND id_usuario=$2
      ORDER BY fecha_carga ASC, id ASC
    `, [id, usuario.id]);
    return { idVehiculo: String(id), ...calcularRendimientos(rows) };
  }

  async function registrar(usuario, id, datos) {
    validarAcceso(usuario, id);
    const carga = validarCargaCombustible(datos);
    const { rows: [fila] } = await db.query(`
      INSERT INTO cargas_combustible
        (id_vehiculo,id_usuario,fecha_carga,kilometraje,litros,costo_total,tanque_lleno,notas)
      SELECT id,id_usuario,$3,$4,$5,$6,$7,$8 FROM vehiculos_usuario WHERE id=$1 AND id_usuario=$2
      RETURNING id,id_vehiculo,fecha_carga,kilometraje,litros,costo_total,tanque_lleno,notas,fecha_registro
    `, [id, usuario.id, carga.fechaCarga, carga.kilometraje, carga.litros, carga.costoTotal, carga.tanqueLleno, carga.notas]);
    if (!fila) throw errorHttp(404, "No encontramos el vehículo en tu garaje.");
    return presentar(fila);
  }

  return { listar, registrar };
}
