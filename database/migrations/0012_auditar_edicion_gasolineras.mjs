export function up(pgm) {
  pgm.sql(`
    ALTER TABLE auditoria_gasolineras DROP CONSTRAINT auditoria_gasolineras_operacion_check;
    ALTER TABLE auditoria_gasolineras ADD CONSTRAINT auditoria_gasolineras_operacion_check
      CHECK (operacion IN ('registro', 'edicion'));
  `);
}

export function down(pgm) {
  // Conserva las auditorías de edición existentes al volver a la versión anterior.
  pgm.sql(`
    ALTER TABLE auditoria_gasolineras DROP CONSTRAINT auditoria_gasolineras_operacion_check;
    ALTER TABLE auditoria_gasolineras ADD CONSTRAINT auditoria_gasolineras_operacion_check
      CHECK (operacion = 'registro') NOT VALID;
  `);
}
