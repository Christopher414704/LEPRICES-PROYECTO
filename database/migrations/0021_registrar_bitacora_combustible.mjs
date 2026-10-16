export const shorthands = undefined;

export function up(pgm) {
  pgm.sql(`
    ALTER TABLE vehiculos_usuario
      ADD CONSTRAINT uq_vehiculos_usuario_id_propietario UNIQUE (id, id_usuario);

    CREATE TABLE cargas_combustible (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      id_vehiculo BIGINT NOT NULL,
      id_usuario BIGINT NOT NULL,
      fecha_carga TIMESTAMPTZ NOT NULL,
      kilometraje NUMERIC(10,1) NOT NULL CHECK (kilometraje BETWEEN 0 AND 9999999.9),
      litros NUMERIC(8,3) NOT NULL CHECK (litros > 0 AND litros <= 10000),
      costo_total NUMERIC(10,2) CHECK (costo_total > 0 AND costo_total <= 99999999.99),
      tanque_lleno BOOLEAN NOT NULL DEFAULT TRUE,
      notas VARCHAR(300) CHECK (notas IS NULL OR length(trim(notas)) BETWEEN 1 AND 300),
      fecha_registro TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_cargas_vehiculo_propietario
        FOREIGN KEY (id_vehiculo, id_usuario)
        REFERENCES vehiculos_usuario (id, id_usuario)
        ON DELETE CASCADE
    );

    CREATE INDEX idx_cargas_combustible_vehiculo_fecha
      ON cargas_combustible (id_vehiculo, fecha_carga DESC, id DESC);
    CREATE INDEX idx_cargas_combustible_usuario
      ON cargas_combustible (id_usuario);
  `);
}

export function down(pgm) {
  pgm.sql(`
    DROP TABLE cargas_combustible;
    ALTER TABLE vehiculos_usuario DROP CONSTRAINT uq_vehiculos_usuario_id_propietario;
  `);
}
