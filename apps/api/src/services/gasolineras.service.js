import {
  obtenerGasolinerasConPrecios,
} from "../repositories/gasolineras.repository.js";

function convertirNumero(valor) {
  if (valor === null || valor === undefined) {
    return null;
  }

  return Number(valor);
}

export async function listarGasolinerasConPrecios({ soloVisibles = false, bbox = null, departamento = null, municipio = null, codigo = null, buscar = null, limite = null } = {}) {
  const filas = await obtenerGasolinerasConPrecios({ soloVisibles, bbox, departamento, municipio, codigo, buscar, limite });
  const registros = new Map();

  for (const fila of filas) {
    const idGasolinera = convertirNumero(
      fila.id_gasolinera,
    );

    if (!registros.has(idGasolinera)) {
      registros.set(idGasolinera, {
        gasolinera: {
          id: idGasolinera,
          nombre: fila.nombre_gasolinera,
          codigo: fila.codigo_gasolinera,
          direccion: fila.direccion,
          municipio: fila.municipio,
          departamento: fila.departamento,
          pais: fila.pais,

          ubicacion: {
            latitud: convertirNumero(fila.latitud),
            longitud: convertirNumero(fila.longitud),
          },

          marca: {
            id: convertirNumero(fila.id_marca),
            nombre: fila.nombre_marca,
            codigo: fila.codigo_marca,
            urlLogo: fila.url_logo,
            colorPrincipal: fila.color_principal,
          },

          combustibles: [],
        },

        combustibles: new Map(),
      });
    }

    const registro = registros.get(idGasolinera);

    if (!fila.id_combustible) {
      continue;
    }

    const idCombustible = convertirNumero(
      fila.id_combustible,
    );

    if (!registro.combustibles.has(idCombustible)) {
      registro.combustibles.set(idCombustible, {
        id: idCombustible,
        nombreComercial: fila.nombre_comercial,
        codigo: fila.codigo_combustible,
        ordenVisual: fila.orden_combustible,

        tipo: {
          id: convertirNumero(
            fila.id_tipo_combustible,
          ),
          nombre: fila.nombre_tipo_combustible,
          codigo: fila.codigo_tipo_combustible,
        },

        precios: {},
      });
    }

    if (
      fila.id_modalidad
      && fila.precio !== null
    ) {
      const combustible =
        registro.combustibles.get(idCombustible);

      combustible.precios[fila.codigo_modalidad] = {
        modalidad: fila.nombre_modalidad,
        precio: convertirNumero(fila.precio),
        moneda: fila.codigo_moneda,
        unidadMedida: fila.unidad_medida,
        vigenteDesde: fila.fecha_vigencia_inicio,
      };
    }
  }

  return Array.from(registros.values()).map(
    ({ gasolinera, combustibles }) => ({
      ...gasolinera,
      combustibles: Array.from(
        combustibles.values(),
      ),
    }),
  );
}
