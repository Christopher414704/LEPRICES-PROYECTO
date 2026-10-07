export const shorthands = undefined;

export function up(pgm) {
  pgm.sql(`
    CREATE TABLE auditoria_usuarios (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      id_usuario_objetivo BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
      id_administrador BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
      operacion TEXT NOT NULL CHECK (operacion IN ('registro', 'activacion', 'desactivacion')),
      datos JSONB NOT NULL,
      fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX idx_auditoria_usuarios_objetivo
      ON auditoria_usuarios (id_usuario_objetivo, fecha_creacion DESC);
    CREATE INDEX idx_auditoria_usuarios_administrador
      ON auditoria_usuarios (id_administrador, fecha_creacion DESC);
  `);
}

export function down(pgm) {
  pgm.sql("DROP TABLE auditoria_usuarios;");
}
