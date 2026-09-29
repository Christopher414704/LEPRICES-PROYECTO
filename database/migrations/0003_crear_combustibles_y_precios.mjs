export const shorthands = undefined;

export function up(pgm) {
  pgm.sql(`
    CREATE TABLE tipos_combustible (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      nombre VARCHAR(100) NOT NULL,
      codigo VARCHAR(50) NOT NULL,
      descripcion TEXT,
      orden_visual SMALLINT NOT NULL DEFAULT 0,
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CONSTRAINT uq_tipos_combustible_nombre
        UNIQUE (nombre),

      CONSTRAINT uq_tipos_combustible_codigo
        UNIQUE (codigo),

      CONSTRAINT chk_tipos_combustible_orden
        CHECK (orden_visual >= 0)
    );

    CREATE TABLE combustibles_gasolinera (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      id_gasolinera BIGINT NOT NULL,
      id_tipo_combustible BIGINT NOT NULL,
      nombre_comercial VARCHAR(120) NOT NULL,
      codigo VARCHAR(100) NOT NULL,
      descripcion TEXT,
      orden_visual SMALLINT NOT NULL DEFAULT 0,
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CONSTRAINT fk_combustibles_gasolinera
        FOREIGN KEY (id_gasolinera)
        REFERENCES gasolineras(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

      CONSTRAINT fk_combustibles_tipo
        FOREIGN KEY (id_tipo_combustible)
        REFERENCES tipos_combustible(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

      CONSTRAINT uq_combustible_codigo_por_gasolinera
        UNIQUE (id_gasolinera, codigo),

      CONSTRAINT chk_combustibles_gasolinera_orden
        CHECK (orden_visual >= 0)
    );

    CREATE TABLE modalidades_servicio (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      nombre VARCHAR(100) NOT NULL,
      codigo VARCHAR(50) NOT NULL,
      descripcion TEXT,
      orden_visual SMALLINT NOT NULL DEFAULT 0,
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CONSTRAINT uq_modalidades_servicio_nombre
        UNIQUE (nombre),

      CONSTRAINT uq_modalidades_servicio_codigo
        UNIQUE (codigo),

      CONSTRAINT chk_modalidades_servicio_orden
        CHECK (orden_visual >= 0)
    );

    CREATE TABLE precios_combustible (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      id_combustible_gasolinera BIGINT NOT NULL,
      id_modalidad_servicio BIGINT NOT NULL,
      id_usuario_registro BIGINT NOT NULL,
      precio NUMERIC(10, 2) NOT NULL,
      codigo_moneda CHAR(3) NOT NULL DEFAULT 'GTQ',
      unidad_medida VARCHAR(30) NOT NULL DEFAULT 'galon',
      observacion TEXT,
      fecha_vigencia_inicio TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      fecha_vigencia_fin TIMESTAMPTZ,
      fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CONSTRAINT fk_precios_combustible
        FOREIGN KEY (id_combustible_gasolinera)
        REFERENCES combustibles_gasolinera(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

      CONSTRAINT fk_precios_modalidad
        FOREIGN KEY (id_modalidad_servicio)
        REFERENCES modalidades_servicio(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

      CONSTRAINT fk_precios_usuario
        FOREIGN KEY (id_usuario_registro)
        REFERENCES usuarios(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

      CONSTRAINT chk_precios_valor
        CHECK (precio > 0),

      CONSTRAINT chk_precios_moneda
        CHECK (codigo_moneda ~ '^[A-Z]{3}$'),

      CONSTRAINT chk_precios_fechas
        CHECK (
          fecha_vigencia_fin IS NULL
          OR fecha_vigencia_fin > fecha_vigencia_inicio
        )
    );

    CREATE INDEX idx_combustibles_id_gasolinera
      ON combustibles_gasolinera (id_gasolinera);

    CREATE INDEX idx_combustibles_id_tipo
      ON combustibles_gasolinera (id_tipo_combustible);

    CREATE INDEX idx_precios_historial
      ON precios_combustible (
        id_combustible_gasolinera,
        id_modalidad_servicio,
        fecha_vigencia_inicio DESC
      );

    CREATE INDEX idx_precios_id_usuario
      ON precios_combustible (id_usuario_registro);

    CREATE UNIQUE INDEX uq_precio_vigente
      ON precios_combustible (
        id_combustible_gasolinera,
        id_modalidad_servicio
      )
      WHERE fecha_vigencia_fin IS NULL;

    CREATE TRIGGER trg_tipos_combustible_actualizar_fecha
    BEFORE UPDATE ON tipos_combustible
    FOR EACH ROW
    EXECUTE FUNCTION actualizar_fecha_modificacion();

    CREATE TRIGGER trg_combustibles_gasolinera_actualizar_fecha
    BEFORE UPDATE ON combustibles_gasolinera
    FOR EACH ROW
    EXECUTE FUNCTION actualizar_fecha_modificacion();

    CREATE TRIGGER trg_modalidades_servicio_actualizar_fecha
    BEFORE UPDATE ON modalidades_servicio
    FOR EACH ROW
    EXECUTE FUNCTION actualizar_fecha_modificacion();

    CREATE OR REPLACE FUNCTION preparar_nuevo_precio()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    DECLARE
      gasolinera_del_combustible BIGINT;
      gasolinera_del_usuario BIGINT;
      codigo_rol_usuario VARCHAR(50);
      usuario_activo BOOLEAN;
    BEGIN
      SELECT cg.id_gasolinera
      INTO gasolinera_del_combustible
      FROM combustibles_gasolinera cg
      WHERE cg.id = NEW.id_combustible_gasolinera
        AND cg.activo = TRUE;

      IF NOT FOUND THEN
        RAISE EXCEPTION
          'El combustible seleccionado no existe o está inactivo.';
      END IF;

      SELECT
        u.id_gasolinera,
        r.codigo,
        u.activo
      INTO
        gasolinera_del_usuario,
        codigo_rol_usuario,
        usuario_activo
      FROM usuarios u
      INNER JOIN roles r ON r.id = u.id_rol
      WHERE u.id = NEW.id_usuario_registro;

      IF NOT FOUND THEN
        RAISE EXCEPTION
          'El usuario seleccionado no existe.';
      END IF;

      IF usuario_activo IS NOT TRUE THEN
        RAISE EXCEPTION
          'El usuario seleccionado está inactivo.';
      END IF;

      IF codigo_rol_usuario = 'administrador' THEN
        NULL;
      ELSIF (
        codigo_rol_usuario = 'gestor_gasolinera'
        AND gasolinera_del_usuario = gasolinera_del_combustible
      ) THEN
        NULL;
      ELSE
        RAISE EXCEPTION
          'El usuario no tiene permiso para modificar esta gasolinera.';
      END IF;

      UPDATE precios_combustible
      SET fecha_vigencia_fin = NEW.fecha_vigencia_inicio
      WHERE id_combustible_gasolinera =
              NEW.id_combustible_gasolinera
        AND id_modalidad_servicio =
              NEW.id_modalidad_servicio
        AND fecha_vigencia_fin IS NULL;

      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER trg_preparar_nuevo_precio
    BEFORE INSERT ON precios_combustible
    FOR EACH ROW
    EXECUTE FUNCTION preparar_nuevo_precio();

    INSERT INTO tipos_combustible (
      nombre,
      codigo,
      descripcion,
      orden_visual
    )
    VALUES
      (
        'Regular',
        'regular',
        'Gasolina regular.',
        1
      ),
      (
        'Súper',
        'super',
        'Gasolina súper.',
        2
      ),
      (
        'Premium',
        'premium',
        'Combustible premium, como V-Power.',
        3
      ),
      (
        'Diésel',
        'diesel',
        'Combustible diésel.',
        4
      );

    INSERT INTO modalidades_servicio (
      nombre,
      codigo,
      descripcion,
      orden_visual
    )
    VALUES
      (
        'Autoservicio',
        'autoservicio',
        'El cliente utiliza la modalidad de autoservicio.',
        1
      ),
      (
        'Servicio manual',
        'servicio_manual',
        'La gasolinera proporciona atención por medio de un encargado.',
        2
      );
  `);
}

export function down(pgm) {
  pgm.sql(`
    DROP TABLE IF EXISTS precios_combustible;
    DROP FUNCTION IF EXISTS preparar_nuevo_precio();
    DROP TABLE IF EXISTS modalidades_servicio;
    DROP TABLE IF EXISTS combustibles_gasolinera;
    DROP TABLE IF EXISTS tipos_combustible;
  `);
}