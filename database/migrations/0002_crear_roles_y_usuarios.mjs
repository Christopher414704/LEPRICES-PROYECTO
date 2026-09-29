export const shorthands = undefined;

export function up(pgm) {
  pgm.sql(`
    CREATE TABLE roles (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      nombre VARCHAR(100) NOT NULL,
      codigo VARCHAR(50) NOT NULL,
      descripcion TEXT,
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CONSTRAINT uq_roles_nombre
        UNIQUE (nombre),

      CONSTRAINT uq_roles_codigo
        UNIQUE (codigo)
    );

    CREATE TABLE usuarios (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      id_rol BIGINT NOT NULL,
      id_gasolinera BIGINT,
      nombre_completo VARCHAR(150) NOT NULL,
      nombre_usuario VARCHAR(100) NOT NULL,
      correo_electronico VARCHAR(254) NOT NULL,
      contrasena_hash TEXT NOT NULL,
      debe_cambiar_contrasena BOOLEAN NOT NULL DEFAULT TRUE,
      intentos_fallidos SMALLINT NOT NULL DEFAULT 0,
      bloqueado_hasta TIMESTAMPTZ,
      ultimo_acceso TIMESTAMPTZ,
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CONSTRAINT fk_usuarios_rol
        FOREIGN KEY (id_rol)
        REFERENCES roles(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

      CONSTRAINT fk_usuarios_gasolinera
        FOREIGN KEY (id_gasolinera)
        REFERENCES gasolineras(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

      CONSTRAINT chk_usuarios_intentos_fallidos
        CHECK (intentos_fallidos >= 0),

      CONSTRAINT chk_usuarios_nombre_usuario
        CHECK (LENGTH(TRIM(nombre_usuario)) >= 4),

      CONSTRAINT chk_usuarios_contrasena_hash
        CHECK (LENGTH(TRIM(contrasena_hash)) > 0)
    );

    CREATE UNIQUE INDEX uq_usuarios_nombre_usuario_minusculas
      ON usuarios (LOWER(nombre_usuario));

    CREATE UNIQUE INDEX uq_usuarios_correo_minusculas
      ON usuarios (LOWER(correo_electronico));

    CREATE UNIQUE INDEX uq_usuario_activo_por_gasolinera
      ON usuarios (id_gasolinera)
      WHERE activo = TRUE
        AND id_gasolinera IS NOT NULL;

    CREATE INDEX idx_usuarios_id_rol
      ON usuarios (id_rol);

    CREATE INDEX idx_usuarios_id_gasolinera
      ON usuarios (id_gasolinera);

    CREATE INDEX idx_usuarios_activo
      ON usuarios (activo);

    CREATE TRIGGER trg_roles_actualizar_fecha
    BEFORE UPDATE ON roles
    FOR EACH ROW
    EXECUTE FUNCTION actualizar_fecha_modificacion();

    CREATE TRIGGER trg_usuarios_actualizar_fecha
    BEFORE UPDATE ON usuarios
    FOR EACH ROW
    EXECUTE FUNCTION actualizar_fecha_modificacion();

    INSERT INTO roles (
      nombre,
      codigo,
      descripcion
    )
    VALUES
      (
        'Administrador',
        'administrador',
        'Puede administrar todas las gasolineras, usuarios y precios.'
      ),
      (
        'Gestor de gasolinera',
        'gestor_gasolinera',
        'Puede modificar únicamente los precios de su gasolinera asignada.'
      ),
      (
        'Consulta',
        'consulta',
        'Puede consultar información sin realizar modificaciones.'
      );
  `);
}

export function down(pgm) {
  pgm.sql(`
    DROP TABLE IF EXISTS usuarios;
    DROP TABLE IF EXISTS roles;
  `);
}