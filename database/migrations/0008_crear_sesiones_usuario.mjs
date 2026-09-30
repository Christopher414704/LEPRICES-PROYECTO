export function up(pgm) {
  pgm.sql(`
    CREATE TABLE sesiones_usuario (
      token_hash CHAR(64) PRIMARY KEY,
      id_usuario BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      fecha_expiracion TIMESTAMPTZ NOT NULL
    );

    CREATE INDEX idx_sesiones_usuario ON sesiones_usuario (id_usuario);
    CREATE INDEX idx_sesiones_expiracion ON sesiones_usuario (fecha_expiracion);
  `);
}

export function down(pgm) {
  pgm.sql("DROP TABLE sesiones_usuario;");
}
