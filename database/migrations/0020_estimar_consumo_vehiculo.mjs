export const shorthands = undefined;

export function up(pgm) {
  pgm.sql(`
    CREATE TABLE consumo_personal_vehiculo (
      id_vehiculo BIGINT PRIMARY KEY REFERENCES vehiculos_usuario(id) ON DELETE CASCADE,
      distancia_km NUMERIC(10,2) NOT NULL CHECK (distancia_km > 0 AND distancia_km <= 1000000),
      litros NUMERIC(10,2) NOT NULL CHECK (litros > 0 AND litros <= 100000),
      fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export function down(pgm) {
  pgm.sql("DROP TABLE consumo_personal_vehiculo;");
}
