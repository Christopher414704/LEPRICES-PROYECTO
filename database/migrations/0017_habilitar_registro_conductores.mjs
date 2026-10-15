export const shorthands = undefined;

export function up(pgm) {
  pgm.sql(`
    INSERT INTO roles (nombre, codigo, descripcion, activo)
    VALUES ('Conductor', 'conductor', 'Gestiona únicamente sus propios vehículos y registros.', TRUE)
    ON CONFLICT (codigo) DO UPDATE SET
      nombre = EXCLUDED.nombre,
      descripcion = EXCLUDED.descripcion,
      activo = TRUE;

    UPDATE roles SET activo = FALSE WHERE codigo = 'consulta';
  `);
}

export function down(pgm) {
  pgm.sql("UPDATE roles SET activo = TRUE WHERE codigo = 'consulta';");
  // El rol conductor puede tener cuentas y también pertenece a HU-24; no se elimina.
}
