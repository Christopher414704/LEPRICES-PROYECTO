const errorHttp = (statusCode, message) => Object.assign(new Error(message), { statusCode });

function texto(valor, campo, maximo) {
  if (typeof valor !== "string") throw errorHttp(400, `Ingresa ${campo}.`);
  const limpio = valor.trim().replace(/\s+/g, " ");
  if (!limpio || limpio.length > maximo || /[\u0000-\u001f\u007f]/.test(limpio)) {
    throw errorHttp(400, `Ingresa ${campo} válido (máximo ${maximo} caracteres).`);
  }
  return limpio;
}

function coordenada(valor, campo, limite) {
  if ((typeof valor !== "number" && typeof valor !== "string") ||
      (typeof valor === "string" && !/^[+-]?\d+(?:\.\d+)?$/.test(valor.trim()))) {
    throw errorHttp(400, `Ingresa una ${campo} numérica válida.`);
  }
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < -limite || numero > limite) {
    throw errorHttp(400, `La ${campo} debe estar entre ${-limite} y ${limite}.`);
  }
  return numero.toFixed(6);
}

export function validarEdicionGasolinera(datos) {
  const { nombre, direccion, municipio, departamento, latitud, longitud } = datos ?? {};
  return {
    nombre: texto(nombre, "el nombre de la estación", 150),
    direccion: texto(direccion, "la dirección", 500),
    municipio: texto(municipio, "el municipio", 100),
    departamento: texto(departamento, "el departamento", 100),
    latitud: coordenada(latitud, "latitud", 90),
    longitud: coordenada(longitud, "longitud", 180),
  };
}

export function validarNuevaGasolinera(datos) {
  const { idMarca } = datos ?? {};
  if (!/^[1-9]\d{0,17}$/.test(String(idMarca ?? ""))) throw errorHttp(400, "Selecciona una marca válida.");
  return { ...validarEdicionGasolinera(datos), idMarca: String(idMarca) };
}

function exigirAdministrador(usuario) {
  if (usuario?.rol !== "administrador") {
    throw errorHttp(403, "Solo un administrador puede administrar gasolineras.");
  }
}

export function crearServicioRegistroGasolineras(database) {
  async function marcas(usuario) {
    exigirAdministrador(usuario);
    const { rows } = await database.query("SELECT id, nombre FROM marcas WHERE activo=TRUE ORDER BY nombre");
    return rows.map((marca) => ({ id: String(marca.id), nombre: marca.nombre }));
  }

  async function registrar(usuario, datos) {
    exigirAdministrador(usuario);
    const nueva = validarNuevaGasolinera(datos);
    const cliente = await database.connect();
    try {
      await cliente.query("BEGIN");
      const { rows: [administrador] } = await cliente.query(`
        SELECT u.id FROM usuarios u JOIN roles r ON r.id=u.id_rol
        WHERE u.id=$1 AND u.activo=TRUE AND r.activo=TRUE AND r.codigo='administrador'
        FOR SHARE OF u, r
      `, [usuario.id]);
      if (!administrador) throw errorHttp(403, "La cuenta no tiene permisos de administrador activos.");
      const { rows: [marca] } = await cliente.query(
        "SELECT id, nombre, codigo, color_principal, url_logo FROM marcas WHERE id=$1 AND activo=TRUE FOR SHARE", [nueva.idMarca]);
      if (!marca) throw errorHttp(400, "La marca no existe o está inactiva.");
      const { rows: [fila] } = await cliente.query(`
        INSERT INTO gasolineras
          (id_marca, nombre, codigo, direccion, municipio, departamento, pais, latitud, longitud, visible_publico)
        VALUES ($1,$2,'estacion-' || gen_random_uuid()::text,$3,$4,$5,'Guatemala',$6,$7,TRUE)
        RETURNING id, codigo
      `, [nueva.idMarca, nueva.nombre, nueva.direccion, nueva.municipio, nueva.departamento, nueva.latitud, nueva.longitud]);
      const gasolinera = {
        id: Number(fila.id), codigo: fila.codigo, nombre: nueva.nombre,
        direccion: nueva.direccion, municipio: nueva.municipio, departamento: nueva.departamento,
        pais: "Guatemala", ubicacion: { latitud: Number(nueva.latitud), longitud: Number(nueva.longitud) },
        marca: { id: Number(marca.id), nombre: marca.nombre, codigo: marca.codigo,
          colorPrincipal: marca.color_principal, urlLogo: marca.url_logo }, combustibles: [],
      };
      await cliente.query(`
        INSERT INTO auditoria_gasolineras (id_gasolinera, id_usuario, operacion, datos)
        VALUES ($1,$2,'registro',$3::jsonb)
      `, [fila.id, usuario.id, JSON.stringify(gasolinera)]);
      await cliente.query("COMMIT");
      return gasolinera;
    } catch (error) {
      await cliente.query("ROLLBACK");
      if (error.code === "23505") throw errorHttp(409, "Ya existe una gasolinera con ese nombre en la misma región o con esas coordenadas.");
      throw error;
    } finally {
      cliente.release();
    }
  }
  async function editar(usuario, id, datos) {
    exigirAdministrador(usuario);
    if (!/^[1-9]\d{0,17}$/.test(String(id ?? ""))) throw errorHttp(400, "Selecciona una estación válida.");
    const cambios = validarEdicionGasolinera(datos);
    const cliente = await database.connect();
    const campos = "id, id_marca, codigo, nombre, direccion, municipio, departamento, pais, latitud, longitud";
    const ficha = (fila) => ({
      id: Number(fila.id), idMarca: String(fila.id_marca), codigo: fila.codigo, nombre: fila.nombre,
      direccion: fila.direccion, municipio: fila.municipio, departamento: fila.departamento, pais: fila.pais,
      ubicacion: { latitud: Number(fila.latitud), longitud: Number(fila.longitud) },
    });
    try {
      await cliente.query("BEGIN");
      const { rows: [administrador] } = await cliente.query(`
        SELECT u.id FROM usuarios u JOIN roles r ON r.id=u.id_rol
        WHERE u.id=$1 AND u.activo=TRUE AND r.activo=TRUE AND r.codigo='administrador'
        FOR SHARE OF u, r
      `, [usuario.id]);
      if (!administrador) throw errorHttp(403, "La cuenta no tiene permisos de administrador activos.");
      const { rows: [anterior] } = await cliente.query(
        `SELECT ${campos} FROM gasolineras WHERE id=$1 AND activo=TRUE FOR UPDATE`, [id]);
      if (!anterior) throw errorHttp(404, "La gasolinera no existe o está inactiva.");
      const { rows: [actualizada] } = await cliente.query(`
        UPDATE gasolineras SET nombre=$2, direccion=$3, municipio=$4, departamento=$5, latitud=$6, longitud=$7
        WHERE id=$1 RETURNING ${campos}
      `, [id, cambios.nombre, cambios.direccion, cambios.municipio, cambios.departamento, cambios.latitud, cambios.longitud]);
      const resultado = ficha(actualizada);
      await cliente.query(`
        INSERT INTO auditoria_gasolineras (id_gasolinera, id_usuario, operacion, datos)
        VALUES ($1,$2,'edicion',$3::jsonb)
      `, [id, usuario.id, JSON.stringify({ antes: ficha(anterior), despues: resultado })]);
      await cliente.query("COMMIT");
      return resultado;
    } catch (error) {
      await cliente.query("ROLLBACK");
      if (error.code === "23505") throw errorHttp(409, "Ya existe una gasolinera con ese nombre en la misma región o con esas coordenadas.");
      throw error;
    } finally {
      cliente.release();
    }
  }
  return { marcas, registrar, editar };
}
