export const shorthands = undefined;

export function up(pgm) {
  pgm.sql(`
    CREATE TABLE favoritos (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      id_usuario BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      id_gasolinera BIGINT NOT NULL REFERENCES gasolineras(id) ON DELETE CASCADE,
      id_tipo_combustible BIGINT NOT NULL REFERENCES tipos_combustible(id) ON DELETE CASCADE,
      fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uq_favoritos_usuario_gasolinera_combustible
        UNIQUE (id_usuario, id_gasolinera, id_tipo_combustible)
    );
    CREATE INDEX idx_favoritos_gasolinera ON favoritos(id_gasolinera);
    CREATE INDEX idx_favoritos_tipo_combustible ON favoritos(id_tipo_combustible);
  `);
}

export function down(pgm) {
  pgm.sql("DROP TABLE favoritos;");
}
