const fallo = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const normalizar = valor => String(valor).normalize('NFKC').toUpperCase().replace(/[\s-]+/g, '');
const texto = (valor, limite = 12000) => typeof valor === 'string' ? valor.trim().slice(0, limite) : '';
export const AVISO_CAMPANAS = 'Avisos del mercado de Estados Unidos (NHTSA), relacionados con marca, modelo y año. No confirman que tu unidad tenga un defecto o una reparación pendiente. La aplicación a vehículos de Guatemala u otros mercados debe verificarse con el fabricante y el VIN.';

export function identidadCampanas(ficha = {}) {
  const marca = texto(ficha.marca, 101), modelo = texto(ficha.modelo, 151);
  if (!marca || !modelo || marca.length > 100 || modelo.length > 150 ||
      /[\x00-\x1f<>]/.test(marca + modelo) || !/^\d{4}$/.test(String(ficha.anio ?? '')) ||
      Number(ficha.anio) < 1949 || Number(ficha.anio) > new Date().getUTCFullYear() + 2) {
    throw fallo(400, 'Se necesita marca, modelo y año válidos (desde 1949) para consultar campañas.');
  }
  return { marca, modelo, anio: Number(ficha.anio) };
}

export function interpretarCampanas(json, identidad) {
  if (!json || !Array.isArray(json.results) || !Number.isInteger(json.Count) ||
      json.Count !== json.results.length || json.Count > 1000) throw fallo(502, 'NHTSA devolvió una respuesta inválida. Reintenta más tarde.');
  const vistas = new Set(), campanas = []; let descartadas = 0;
  for (const r of json.results) {
    if (!r || typeof r.Make !== 'string' || typeof r.Model !== 'string' || !/^\d{4}$/.test(String(r.ModelYear)) ||
        !/^\d{2}[A-Z]\d{6}$/.test(r.NHTSACampaignNumber ?? '') || !texto(r.Summary)) {
      throw fallo(502, 'NHTSA devolvió campañas incompletas. Reintenta más tarde.');
    }
    if (normalizar(r.Make) !== normalizar(identidad.marca) || normalizar(r.Model) !== normalizar(identidad.modelo) ||
        Number(r.ModelYear) !== identidad.anio) { descartadas++; continue; }
    if (vistas.has(r.NHTSACampaignNumber)) continue;
    vistas.add(r.NHTSACampaignNumber);
    const fuente = new URL('https://api.nhtsa.gov/recalls/campaignNumber');
    fuente.searchParams.set('campaignNumber', r.NHTSACampaignNumber);
    campanas.push({ numero: r.NHTSACampaignNumber, marca: r.Make, modelo: r.Model, anio: Number(r.ModelYear),
      fabricante: texto(r.Manufacturer, 300), fechaReporte: texto(r.ReportReceivedDate, 30), componente: texto(r.Component, 500),
      resumen: texto(r.Summary), consecuencia: texto(r.Consequence), solucion: texto(r.Remedy), notas: texto(r.Notes),
      noConducir: r.parkIt === true, estacionarAfuera: r.parkOutSide === true, fuente: fuente.href, mercado: 'Estados Unidos' });
  }
  return { estado: campanas.length ? 'con_campanas' : 'sin_coincidencias', campanas, descartadas };
}

export function crearCampanasVehiculos(db, { solicitar = fetch, ahora = Date.now, timeoutMs = 10000 } = {}) {
  const cache = new Map(), pendientes = new Map(), intentos = new Map();
  async function consultarNhtsa(identidad) {
    const url = new URL('https://api.nhtsa.gov/recalls/recallsByVehicle');
    url.search = new URLSearchParams({ make: identidad.marca, model: identidad.modelo, modelYear: String(identidad.anio) }).toString();
    try {
      const respuesta = await solicitar(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json' } });
      if (!respuesta.ok) throw fallo(503, 'NHTSA no está disponible o alcanzó su límite de consultas. Reintenta más tarde.');
      let bytes = 0, contenido = ''; const decoder = new TextDecoder();
      for await (const parte of respuesta.body) {
        bytes += parte.length;
        if (bytes > 2000000) throw fallo(502, 'La respuesta de NHTSA excedió el tamaño permitido.');
        contenido += decoder.decode(parte, { stream: true });
      }
      contenido += decoder.decode();
      let json; try { json = JSON.parse(contenido); } catch { throw fallo(502, 'NHTSA devolvió una respuesta inválida.'); }
      return { ...interpretarCampanas(json, identidad), consultadoEn: new Date(ahora()).toISOString(), fuente: url.href };
    } catch (error) {
      if (error.statusCode) throw error;
      throw fallo(503, 'No fue posible conectar con NHTSA. Reintenta más tarde.');
    }
  }
  return { async consultar(usuario, id) {
    if (!usuario?.id) throw fallo(401, 'Inicia sesión para consultar campañas.');
    if (usuario.debeCambiarContrasena) throw fallo(403, 'Cambia tu contraseña inicial para continuar.');
    if (!/^[1-9]\d{0,17}$/.test(String(id ?? ''))) throw fallo(400, 'Vehículo inválido.');
    const { rows: [v] } = await db.query(`SELECT COALESCE(v.ficha_personal,c.ficha) AS ficha FROM vehiculos_usuario v
      LEFT JOIN catalogo_vehiculos c ON c.id=v.id_catalogo WHERE v.id=$1 AND v.id_usuario=$2`, [id, usuario.id]);
    if (!v) throw fallo(404, 'No encontramos el vehículo en tu cuenta.');
    const identidad = identidadCampanas(v.ficha);
    const instante = ahora();
    for (const [k, e] of cache) if (e.hasta <= instante) cache.delete(k);
    for (const [k, e] of intentos) if (e.hasta <= instante) intentos.delete(k);
    const cuenta = String(usuario.id), intento = intentos.get(cuenta) ?? { cantidad: 0, hasta: instante + 60000 };
    if (intento.cantidad >= 20 || (!intentos.has(cuenta) && intentos.size >= 2000)) throw fallo(429, 'Puedes consultar campañas hasta veinte veces por minuto.');
    intento.cantidad++; intentos.set(cuenta, intento);
    const clave = JSON.stringify([normalizar(identidad.marca), normalizar(identidad.modelo), identidad.anio]);
    let resultado = cache.get(clave)?.resultado;
    if (!resultado) {
      let promesa = pendientes.get(clave);
      if (!promesa) {
        if (pendientes.size >= 10) throw fallo(429, 'Hay varias consultas a NHTSA en curso. Reintenta en un momento.');
        promesa = consultarNhtsa(identidad).then(data => {
          if (cache.size >= 100) cache.delete(cache.keys().next().value);
          cache.set(clave, { resultado: data, hasta: ahora() + 900000 }); return data;
        }).finally(() => pendientes.delete(clave));
        pendientes.set(clave, promesa);
      }
      resultado = await promesa;
    }
    return { ...structuredClone(resultado), identidad, mercado: 'Estados Unidos (NHTSA)', aviso: AVISO_CAMPANAS };
  } };
}
