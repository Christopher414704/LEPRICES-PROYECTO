export const shorthands = undefined;

export function up(pgm) {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION validar_gestor_gasolinera_asignada()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    DECLARE
      codigo_rol VARCHAR(50);
    BEGIN
      SELECT codigo INTO codigo_rol
      FROM roles
      WHERE id = NEW.id_rol;

      IF codigo_rol = 'gestor_gasolinera' AND NEW.id_gasolinera IS NULL THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          CONSTRAINT = 'chk_gestor_gasolinera_asignada',
          MESSAGE = 'Cada gestor debe tener una gasolinera asignada.';
      END IF;

      RETURN NEW;
    END;
    $$;

    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM usuarios u
        JOIN roles r ON r.id = u.id_rol
        WHERE r.codigo = 'gestor_gasolinera'
          AND u.id_gasolinera IS NULL
      ) THEN
        RAISE EXCEPTION
          'Existen gestores sin gasolinera. Asígnelos antes de ejecutar esta migración.';
      END IF;
    END;
    $$;

    CREATE TRIGGER trg_validar_gestor_gasolinera_asignada
    BEFORE INSERT OR UPDATE OF id_rol, id_gasolinera
    ON usuarios
    FOR EACH ROW
    EXECUTE FUNCTION validar_gestor_gasolinera_asignada();
  `);
}

export function down(pgm) {
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_validar_gestor_gasolinera_asignada ON usuarios;
    DROP FUNCTION IF EXISTS validar_gestor_gasolinera_asignada();
  `);
}
