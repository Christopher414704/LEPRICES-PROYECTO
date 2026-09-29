export const shorthands = undefined;

export function up(pgm) {
  pgm.sql(`
    ALTER TABLE gasolineras
      ADD COLUMN visible_publico BOOLEAN NOT NULL DEFAULT FALSE;

    CREATE INDEX idx_gasolineras_visibles_publico
      ON gasolineras (id)
      WHERE activo = TRUE AND visible_publico = TRUE;
  `);
}

export function down(pgm) {
  pgm.sql(`
    DROP INDEX idx_gasolineras_visibles_publico;
    ALTER TABLE gasolineras DROP COLUMN visible_publico;
  `);
}
