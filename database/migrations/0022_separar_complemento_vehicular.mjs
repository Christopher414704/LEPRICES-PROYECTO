export function up(pgm) {
  pgm.sql(`ALTER TABLE vehiculos_usuario ADD COLUMN complemento_personal JSONB
    CHECK (complemento_personal IS NULL OR jsonb_typeof(complemento_personal) = 'object');`);
}

export function down(pgm) {
  pgm.sql('ALTER TABLE vehiculos_usuario DROP COLUMN complemento_personal;');
}

export const shorthands = undefined;
