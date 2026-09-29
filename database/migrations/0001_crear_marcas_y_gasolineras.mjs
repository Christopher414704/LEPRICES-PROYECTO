export const shorthands = undefined;

export function up(pgm) {
  pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS postgis;

    CREATE OR REPLACE FUNCTION actualizar_fecha_modificacion()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    BEGIN
      NEW.fecha_actualizacion = CURRENT_TIMESTAMP;
      RETURN NEW;
    END;
    $$;

    CREATE TABLE marcas (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      nombre VARCHAR(100) NOT NULL,
      codigo VARCHAR(100) NOT NULL,
      url_logo TEXT,
      color_principal VARCHAR(7),
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CONSTRAINT uq_marcas_nombre
        UNIQUE (nombre),

      CONSTRAINT uq_marcas_codigo
        UNIQUE (codigo),

      CONSTRAINT chk_marcas_color_principal
        CHECK (
          color_principal IS NULL
          OR color_principal ~ '^#[0-9A-Fa-f]{6}$'
        )
    );

    CREATE TABLE gasolineras (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      id_marca BIGINT NOT NULL,
      nombre VARCHAR(150) NOT NULL,
      codigo VARCHAR(150) NOT NULL,
      direccion TEXT NOT NULL,
      municipio VARCHAR(100) NOT NULL DEFAULT 'Jalapa',
      departamento VARCHAR(100) NOT NULL DEFAULT 'Jalapa',
      pais VARCHAR(100) NOT NULL DEFAULT 'Guatemala',
      latitud NUMERIC(9, 6) NOT NULL,
      longitud NUMERIC(9, 6) NOT NULL,
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      ubicacion GEOGRAPHY(POINT, 4326)
        GENERATED ALWAYS AS (
          ST_SetSRID(
            ST_MakePoint(
              longitud::DOUBLE PRECISION,
              latitud::DOUBLE PRECISION
            ),
            4326
          )::GEOGRAPHY
        ) STORED,

      CONSTRAINT uq_gasolineras_codigo
        UNIQUE (codigo),

      CONSTRAINT fk_gasolineras_marca
        FOREIGN KEY (id_marca)
        REFERENCES marcas(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

      CONSTRAINT chk_gasolineras_latitud
        CHECK (latitud BETWEEN -90 AND 90),

      CONSTRAINT chk_gasolineras_longitud
        CHECK (longitud BETWEEN -180 AND 180)
    );

    CREATE INDEX idx_gasolineras_id_marca
      ON gasolineras (id_marca);

    CREATE INDEX idx_gasolineras_activo
      ON gasolineras (activo);

    CREATE INDEX idx_gasolineras_ubicacion
      ON gasolineras
      USING GIST (ubicacion);

    CREATE TRIGGER trg_marcas_actualizar_fecha
    BEFORE UPDATE ON marcas
    FOR EACH ROW
    EXECUTE FUNCTION actualizar_fecha_modificacion();

    CREATE TRIGGER trg_gasolineras_actualizar_fecha
    BEFORE UPDATE ON gasolineras
    FOR EACH ROW
    EXECUTE FUNCTION actualizar_fecha_modificacion();

  `);
}

export function down(pgm) {
  pgm.sql(`
    DROP TABLE IF EXISTS gasolineras;
    DROP TABLE IF EXISTS marcas;
    DROP FUNCTION IF EXISTS actualizar_fecha_modificacion();
  `);
}
