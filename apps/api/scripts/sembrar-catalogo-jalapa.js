import { database } from "../src/config/database.js";
import { GASOLINERAS_JALAPA } from "../../web/src/gasolineras-jalapa.datos.js";

const codigoMarca = (nombre) => nombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function sembrar() {
  const cliente = await database.connect();
  try {
    await cliente.query("BEGIN");
    const marcas = new Map();
    for (const estacion of GASOLINERAS_JALAPA) {
      const marca = estacion.marca;
      if (!marcas.has(marca.nombre)) {
        const codigo = codigoMarca(marca.nombre);
        await cliente.query(`
          INSERT INTO marcas (nombre, codigo, color_principal)
          VALUES ($1, $2, $3) ON CONFLICT (codigo) DO NOTHING
        `, [marca.nombre, codigo, marca.colorPrincipal]);
        const { rows: [fila] } = await cliente.query("SELECT id FROM marcas WHERE codigo=$1", [codigo]);
        marcas.set(marca.nombre, fila.id);
      }
      const codigo = `jalapa-${estacion.id}`;
      await cliente.query(`
        INSERT INTO gasolineras
          (id_marca, nombre, codigo, direccion, municipio, departamento, pais, latitud, longitud, visible_publico)
        VALUES ($1, $2, $3, 'Jalapa, Guatemala', 'Jalapa', 'Jalapa', 'Guatemala', $4, $5, TRUE)
        ON CONFLICT (codigo) DO UPDATE SET visible_publico = TRUE
      `, [marcas.get(marca.nombre), estacion.nombre, codigo,
        estacion.ubicacion.latitud, estacion.ubicacion.longitud]);
      const { rows: [existente] } = await cliente.query(
        "SELECT nombre, latitud, longitud FROM gasolineras WHERE codigo=$1", [codigo]);
      if (existente.nombre !== estacion.nombre ||
          Math.abs(Number(existente.latitud) - estacion.ubicacion.latitud) > .00001 ||
          Math.abs(Number(existente.longitud) - estacion.ubicacion.longitud) > .00001) {
        throw new Error(`La gasolinera ${codigo} ya existe con datos diferentes; revísala antes de continuar.`);
      }
    }
    await cliente.query("COMMIT");
    console.log(`Catálogo de Jalapa sincronizado: ${GASOLINERAS_JALAPA.length} gasolineras. Sin precios ficticios.`);
  } catch (error) {
    await cliente.query("ROLLBACK");
    throw error;
  } finally {
    cliente.release();
  }
}

sembrar().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => database.end());
