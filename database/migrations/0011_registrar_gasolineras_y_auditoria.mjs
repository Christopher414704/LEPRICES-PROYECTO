export function up(pgm) {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION normalizar_nombre_estacion(valor TEXT)
    RETURNS TEXT LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
      SELECT translate(lower(regexp_replace(btrim(valor), '\\s+', ' ', 'g')),
        'áéíóúüñ', 'aeiouun');
    $$;

    CREATE UNIQUE INDEX uq_gasolineras_nombre_region
      ON gasolineras (normalizar_nombre_estacion(nombre),
        normalizar_nombre_estacion(municipio), normalizar_nombre_estacion(departamento));
    CREATE UNIQUE INDEX uq_gasolineras_coordenadas ON gasolineras (latitud, longitud);

    CREATE TABLE auditoria_gasolineras (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      id_gasolinera BIGINT NOT NULL REFERENCES gasolineras(id) ON DELETE RESTRICT,
      id_usuario BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
      operacion TEXT NOT NULL CHECK (operacion = 'registro'),
      datos JSONB NOT NULL,
      fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_auditoria_gasolineras_estacion ON auditoria_gasolineras (id_gasolinera, fecha_creacion DESC);
    CREATE INDEX idx_auditoria_gasolineras_usuario ON auditoria_gasolineras (id_usuario);
  `);
}

export function down(pgm) {
  pgm.sql(`
    DROP TABLE auditoria_gasolineras;
    DROP INDEX uq_gasolineras_coordenadas;
    DROP INDEX uq_gasolineras_nombre_region;
    DROP FUNCTION normalizar_nombre_estacion(TEXT);
  `);
}
