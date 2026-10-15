export const shorthands = undefined;

export function up(pgm) {
  pgm.sql(`
    CREATE TABLE push_suscripciones (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      endpoint TEXT NOT NULL UNIQUE,
      id_usuario BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE push_favoritos (
      id_suscripcion BIGINT NOT NULL REFERENCES push_suscripciones(id) ON DELETE CASCADE,
      codigo_gasolinera VARCHAR(100) NOT NULL,
      codigo_combustible VARCHAR(50) NOT NULL,
      codigo_modalidad VARCHAR(50) NOT NULL,
      precio_objetivo NUMERIC(10,2),
      PRIMARY KEY (id_suscripcion, codigo_gasolinera, codigo_combustible, codigo_modalidad),
      CONSTRAINT chk_push_precio_objetivo CHECK (precio_objetivo IS NULL OR precio_objetivo > 0)
    );
    CREATE INDEX idx_push_favoritos_busqueda ON push_favoritos
      (codigo_gasolinera, codigo_combustible, codigo_modalidad);
    CREATE TABLE push_eventos (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      id_precio BIGINT NOT NULL UNIQUE REFERENCES precios_combustible(id) ON DELETE CASCADE,
      precio_anterior NUMERIC(10,2) NOT NULL,
      fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      procesado BOOLEAN NOT NULL DEFAULT FALSE
    );
    CREATE INDEX idx_push_eventos_pendientes ON push_eventos(id) WHERE procesado=FALSE;
    CREATE TABLE push_entregas (
      id_evento BIGINT NOT NULL REFERENCES push_eventos(id) ON DELETE CASCADE,
      id_suscripcion BIGINT NOT NULL REFERENCES push_suscripciones(id) ON DELETE CASCADE,
      fecha_envio TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id_evento, id_suscripcion)
    );
    CREATE OR REPLACE FUNCTION registrar_rebaja_push() RETURNS TRIGGER LANGUAGE plpgsql AS $$
    DECLARE anterior NUMERIC(10,2);
    BEGIN
      SELECT precio INTO anterior FROM precios_combustible
      WHERE id_combustible_gasolinera=NEW.id_combustible_gasolinera
        AND id_modalidad_servicio=NEW.id_modalidad_servicio
        AND id<>NEW.id AND fecha_vigencia_fin=NEW.fecha_vigencia_inicio
      ORDER BY id DESC LIMIT 1;
      IF anterior IS NOT NULL AND NEW.precio < anterior THEN
        INSERT INTO push_eventos (id_precio, precio_anterior) VALUES (NEW.id, anterior);
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER trg_registrar_rebaja_push AFTER INSERT ON precios_combustible
      FOR EACH ROW EXECUTE FUNCTION registrar_rebaja_push();
  `);
}

export function down(pgm) {
  pgm.sql(`
    DROP TRIGGER trg_registrar_rebaja_push ON precios_combustible;
    DROP FUNCTION registrar_rebaja_push();
    DROP TABLE push_entregas;
    DROP TABLE push_eventos;
    DROP TABLE push_favoritos;
    DROP TABLE push_suscripciones;
  `);
}
