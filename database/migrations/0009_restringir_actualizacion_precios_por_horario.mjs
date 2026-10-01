export const shorthands = undefined;

export function up(pgm) {
  pgm.sql(`
    ALTER TABLE usuarios
      ADD COLUMN precio_hora_inicio TIME,
      ADD COLUMN precio_duracion_minutos SMALLINT,
      ADD COLUMN precio_horario_activo BOOLEAN NOT NULL DEFAULT FALSE,
      ADD CONSTRAINT chk_ventana_edicion_precios CHECK (
        (precio_hora_inicio IS NULL AND precio_duracion_minutos IS NULL AND precio_horario_activo = FALSE)
        OR (precio_hora_inicio IS NOT NULL AND precio_duracion_minutos IN (15, 30, 60)
          AND EXTRACT(EPOCH FROM precio_hora_inicio) + precio_duracion_minutos * 60 < 86400)
      );

    CREATE OR REPLACE FUNCTION preparar_nuevo_precio()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
    DECLARE
      gasolinera_del_combustible BIGINT;
      gasolinera_del_usuario BIGINT;
      codigo_rol_usuario VARCHAR(50);
      usuario_activo BOOLEAN;
      rol_activo BOOLEAN;
      inicio TIME;
      duracion SMALLINT;
      horario_activo BOOLEAN;
    BEGIN
      SELECT cg.id_gasolinera INTO gasolinera_del_combustible
      FROM combustibles_gasolinera cg
      JOIN gasolineras g ON g.id = cg.id_gasolinera AND g.activo = TRUE
      WHERE cg.id = NEW.id_combustible_gasolinera AND cg.activo = TRUE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'El combustible o la gasolinera no existe o está inactivo.';
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM modalidades_servicio
        WHERE id = NEW.id_modalidad_servicio AND activo = TRUE
      ) THEN
        RAISE EXCEPTION 'La modalidad no existe o está inactiva.';
      END IF;

      SELECT u.id_gasolinera, r.codigo, u.activo, r.activo,
             u.precio_hora_inicio, u.precio_duracion_minutos, u.precio_horario_activo
      INTO gasolinera_del_usuario, codigo_rol_usuario, usuario_activo,
           rol_activo, inicio, duracion, horario_activo
      FROM usuarios u JOIN roles r ON r.id = u.id_rol
      WHERE u.id = NEW.id_usuario_registro FOR UPDATE OF u;

      IF NOT FOUND OR usuario_activo IS NOT TRUE OR rol_activo IS NOT TRUE THEN
        RAISE EXCEPTION 'El usuario no existe o está inactivo.';
      END IF;

      IF codigo_rol_usuario = 'administrador' THEN
        NULL;
      ELSIF codigo_rol_usuario = 'gestor_gasolinera'
        AND gasolinera_del_usuario = gasolinera_del_combustible
        AND horario_activo = TRUE
        AND (clock_timestamp() AT TIME ZONE 'America/Guatemala')::time >= inicio
        AND (clock_timestamp() AT TIME ZONE 'America/Guatemala')::time < inicio + duracion * INTERVAL '1 minute' THEN
        NULL;
      ELSE
        RAISE EXCEPTION 'El usuario no tiene permiso vigente para modificar esta gasolinera.';
      END IF;

      UPDATE precios_combustible
      SET fecha_vigencia_fin = NEW.fecha_vigencia_inicio
      WHERE id_combustible_gasolinera = NEW.id_combustible_gasolinera
        AND id_modalidad_servicio = NEW.id_modalidad_servicio
        AND fecha_vigencia_fin IS NULL;
      RETURN NEW;
    END;
    $$;
  `);
}

export function down(pgm) {
  pgm.sql(`
    ALTER TABLE usuarios DROP CONSTRAINT chk_ventana_edicion_precios;
    ALTER TABLE usuarios DROP COLUMN precio_hora_inicio,
      DROP COLUMN precio_duracion_minutos, DROP COLUMN precio_horario_activo;

    CREATE OR REPLACE FUNCTION preparar_nuevo_precio()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
    DECLARE
      estacion BIGINT;
      asignada BIGINT;
      rol VARCHAR(50);
      activo BOOLEAN;
    BEGIN
      SELECT id_gasolinera INTO estacion FROM combustibles_gasolinera
      WHERE id = NEW.id_combustible_gasolinera AND activo = TRUE;
      IF NOT FOUND THEN RAISE EXCEPTION 'El combustible no existe o está inactivo.'; END IF;
      SELECT u.id_gasolinera, r.codigo, u.activo INTO asignada, rol, activo
      FROM usuarios u JOIN roles r ON r.id = u.id_rol WHERE u.id = NEW.id_usuario_registro;
      IF NOT FOUND OR activo IS NOT TRUE THEN RAISE EXCEPTION 'El usuario no existe o está inactivo.'; END IF;
      IF rol <> 'administrador' AND NOT (rol = 'gestor_gasolinera' AND asignada = estacion) THEN
        RAISE EXCEPTION 'El usuario no tiene permiso para modificar esta gasolinera.';
      END IF;
      UPDATE precios_combustible SET fecha_vigencia_fin = NEW.fecha_vigencia_inicio
      WHERE id_combustible_gasolinera = NEW.id_combustible_gasolinera
        AND id_modalidad_servicio = NEW.id_modalidad_servicio AND fecha_vigencia_fin IS NULL;
      RETURN NEW;
    END;
    $$;
  `);
}
