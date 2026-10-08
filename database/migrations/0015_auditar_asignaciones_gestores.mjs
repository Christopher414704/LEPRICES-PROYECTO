export const shorthands = undefined;

export function up(pgm) {
  pgm.sql(`
    CREATE TABLE auditoria_asignaciones_gestores (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      id_usuario_gestor BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
      id_administrador BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
      id_gasolinera_anterior BIGINT REFERENCES gasolineras(id) ON DELETE RESTRICT,
      id_gasolinera_nueva BIGINT NOT NULL REFERENCES gasolineras(id) ON DELETE RESTRICT,
      datos JSONB NOT NULL,
      fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX idx_auditoria_asignaciones_gestor_fecha
      ON auditoria_asignaciones_gestores (id_usuario_gestor, fecha_creacion DESC);
    CREATE INDEX idx_auditoria_asignaciones_administrador_fecha
      ON auditoria_asignaciones_gestores (id_administrador, fecha_creacion DESC);
  `);
}

export function down(pgm) {
  pgm.sql("DROP TABLE auditoria_asignaciones_gestores;");
}
