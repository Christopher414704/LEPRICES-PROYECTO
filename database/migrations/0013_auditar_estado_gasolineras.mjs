export function up(pgm) {
  pgm.sql(`
    ALTER TABLE auditoria_gasolineras DROP CONSTRAINT auditoria_gasolineras_operacion_check;
    ALTER TABLE auditoria_gasolineras ADD CONSTRAINT auditoria_gasolineras_operacion_check
      CHECK (operacion IN ('registro', 'edicion', 'desactivacion', 'reactivacion'));
  `);
}

export function down(pgm) {
  // Preserva las auditorías de cambios de estado ya registradas.
  pgm.sql(`
    ALTER TABLE auditoria_gasolineras DROP CONSTRAINT auditoria_gasolineras_operacion_check;
    ALTER TABLE auditoria_gasolineras ADD CONSTRAINT auditoria_gasolineras_operacion_check
      CHECK (operacion IN ('registro', 'edicion')) NOT VALID;
  `);
}
