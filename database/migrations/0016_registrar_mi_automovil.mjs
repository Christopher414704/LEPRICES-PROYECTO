export function up(pgm) {
  pgm.sql(`
    INSERT INTO roles (nombre, codigo, descripcion)
    VALUES ('Conductor', 'conductor', 'Gestiona únicamente sus propios vehículos y registros.')
    ON CONFLICT (codigo) DO NOTHING;

    CREATE TABLE catalogo_vehiculos (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      proveedor VARCHAR(40) NOT NULL CHECK (proveedor = 'fueleconomy'),
      id_externo VARCHAR(30) NOT NULL,
      ficha JSONB NOT NULL CHECK (jsonb_typeof(ficha) = 'object'),
      fecha_consulta TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (proveedor, id_externo)
    );

    CREATE TABLE vehiculos_usuario (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      id_usuario BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      id_catalogo BIGINT NOT NULL REFERENCES catalogo_vehiculos(id) ON DELETE RESTRICT,
      alias VARCHAR(80) NOT NULL CHECK (length(trim(alias)) BETWEEN 1 AND 80),
      kilometraje_inicial NUMERIC(10,1) NOT NULL CHECK (kilometraje_inicial BETWEEN 0 AND 9999999.9),
      fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    ALTER TABLE catalogo_vehiculos ADD COLUMN busqueda TEXT NOT NULL DEFAULT '';
    ALTER TABLE vehiculos_usuario ALTER COLUMN id_catalogo DROP NOT NULL;
    ALTER TABLE vehiculos_usuario ADD COLUMN ficha_personal JSONB;
    ALTER TABLE vehiculos_usuario ADD COLUMN anio_declarado SMALLINT CHECK(anio_declarado BETWEEN 1886 AND 2200);
    ALTER TABLE vehiculos_usuario ADD CONSTRAINT vehiculo_origen CHECK (
      (id_catalogo IS NOT NULL AND ficha_personal IS NULL) OR
      (id_catalogo IS NULL AND ficha_personal IS NOT NULL AND jsonb_typeof(ficha_personal)='object')
    );
    CREATE INDEX idx_vehiculos_usuario_propietario ON vehiculos_usuario(id_usuario);
  `);
}

export function down(pgm) {
  pgm.sql('DROP TABLE vehiculos_usuario; DROP TABLE catalogo_vehiculos;');
  // Se conserva el rol: las cuentas de conductores no se eliminan al revertir el garaje.
}
