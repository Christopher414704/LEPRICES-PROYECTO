import * as argon2 from "argon2";

import { database } from "../src/config/database.js";

function obtenerClaveSegura(nombreVariable) {
  const valor = process.env[nombreVariable];

  if (!valor) {
    throw new Error(
      `Falta la variable ${nombreVariable} en apps/api/.env.`,
    );
  }

  if (
    valor.includes("CAMBIAR")
    || valor.includes("COLOCA_AQUI")
  ) {
    throw new Error(
      `Debes reemplazar el valor de ${nombreVariable}.`,
    );
  }

  if (valor.length < 12) {
    throw new Error(
      `${nombreVariable} debe tener al menos 12 caracteres.`,
    );
  }

  return valor;
}

async function sembrarDatosIniciales() {
  const claveAdministrador = obtenerClaveSegura(
    "CLAVE_INICIAL_ADMIN",
  );

  const claveGestor = obtenerClaveSegura(
    "CLAVE_INICIAL_GESTOR",
  );

  const hashAdministrador = await argon2.hash(
    claveAdministrador,
    {
      type: argon2.argon2id,
    },
  );

  const hashGestor = await argon2.hash(
    claveGestor,
    {
      type: argon2.argon2id,
    },
  );

  const cliente = await database.connect();

  try {
    await cliente.query("BEGIN");

    const resultadoMarca = await cliente.query(
      `
        INSERT INTO marcas (
          nombre,
          codigo,
          color_principal
        )
        VALUES ($1, $2, $3)
        ON CONFLICT (codigo)
        DO UPDATE SET
          nombre = EXCLUDED.nombre,
          color_principal = EXCLUDED.color_principal
        RETURNING id;
      `,
      [
        "Marca de demostración",
        "marca-demo",
        "#2E7D32",
      ],
    );

    const idMarca = resultadoMarca.rows[0].id;

    const resultadoGasolinera = await cliente.query(
      `
        INSERT INTO gasolineras (
          id_marca,
          nombre,
          codigo,
          direccion,
          municipio,
          departamento,
          pais,
          latitud,
          longitud
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9
        )
        ON CONFLICT (codigo)
        DO UPDATE SET
          id_marca = EXCLUDED.id_marca,
          nombre = EXCLUDED.nombre,
          direccion = EXCLUDED.direccion,
          municipio = EXCLUDED.municipio,
          departamento = EXCLUDED.departamento,
          pais = EXCLUDED.pais,
          latitud = EXCLUDED.latitud,
          longitud = EXCLUDED.longitud
        RETURNING id;
      `,
      [
        idMarca,
        "Gasolinera Demo Jalapa",
        "gasolinera-demo-jalapa",
        "Ubicación de demostración, Jalapa",
        "Jalapa",
        "Jalapa",
        "Guatemala",
        14.6349,
        -89.9887,
      ],
    );

    const idGasolinera = resultadoGasolinera.rows[0].id;

    const resultadoRoles = await cliente.query(`
      SELECT id, codigo
      FROM roles
      WHERE codigo IN (
        'administrador',
        'gestor_gasolinera'
      );
    `);

    const roles = Object.fromEntries(
      resultadoRoles.rows.map((rol) => [
        rol.codigo,
        rol.id,
      ]),
    );

    if (!roles.administrador) {
      throw new Error(
        "No existe el rol administrador.",
      );
    }

    if (!roles.gestor_gasolinera) {
      throw new Error(
        "No existe el rol gestor_gasolinera.",
      );
    }

    await cliente.query(
      `
        INSERT INTO usuarios (
          id_rol,
          id_gasolinera,
          nombre_completo,
          nombre_usuario,
          correo_electronico,
          contrasena_hash,
          debe_cambiar_contrasena
        )
        SELECT
          $1::BIGINT,
          NULL::BIGINT,
          $2::TEXT,
          $3::TEXT,
          $4::TEXT,
          $5::TEXT,
          TRUE
        WHERE NOT EXISTS (
          SELECT 1
          FROM usuarios
          WHERE LOWER(nombre_usuario) =
                LOWER($3::TEXT)
        );
      `,
      [
        roles.administrador,
        "Administrador general",
        "administrador",
        "admin@mapajalapa.local",
        hashAdministrador,
      ],
    );

    await cliente.query(
      `
        INSERT INTO usuarios (
          id_rol,
          id_gasolinera,
          nombre_completo,
          nombre_usuario,
          correo_electronico,
          contrasena_hash,
          debe_cambiar_contrasena
        )
        SELECT
          $1::BIGINT,
          $2::BIGINT,
          $3::TEXT,
          $4::TEXT,
          $5::TEXT,
          $6::TEXT,
          TRUE
        WHERE NOT EXISTS (
          SELECT 1
          FROM usuarios
          WHERE LOWER(nombre_usuario) =
                LOWER($4::TEXT)
        );
      `,
      [
        roles.gestor_gasolinera,
        idGasolinera,
        "Gestor de Gasolinera Demo Jalapa",
        "gestor_demo",
        "gestor.demo@mapajalapa.local",
        hashGestor,
      ],
    );

    await cliente.query("COMMIT");

    console.log("Datos iniciales creados correctamente.");
    console.log(`Gasolinera creada con id: ${idGasolinera}`);
    console.log("Usuario administrador: administrador");
    console.log("Usuario gestor: gestor_demo");
  } catch (error) {
    await cliente.query("ROLLBACK");
    throw error;
  } finally {
    cliente.release();
  }
}

sembrarDatosIniciales()
  .catch((error) => {
    console.error(
      "No fue posible crear los datos iniciales:",
      error.message,
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    await database.end();
  });