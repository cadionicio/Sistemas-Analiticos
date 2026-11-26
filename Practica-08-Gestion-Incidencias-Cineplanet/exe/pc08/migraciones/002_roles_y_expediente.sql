-- PC08 · Migración 002 · Cuentas y roles, modo de operación, verificación de estados y resolución
CREATE TABLE configuracion (
  id INTEGER PRIMARY KEY,
  clave TEXT NOT NULL UNIQUE,
  valor TEXT NOT NULL
) STRICT;
CREATE TABLE usuario (
  id INTEGER PRIMARY KEY,
  correo TEXT NOT NULL UNIQUE CHECK (correo LIKE '%_@_%'),
  nombre TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('CLIENTE','DIGITAL','BOLETERIA','SUPERVISION')),
  sede_id INTEGER REFERENCES sede(id),
  ambito TEXT NOT NULL CHECK (ambito IN ('DEMO','PRODUCCION')),
  sal TEXT NOT NULL CHECK (length(sal) = 32),
  hash TEXT NOT NULL CHECK (length(hash) = 64),
  iteraciones INTEGER NOT NULL CHECK (iteraciones >= 100000),
  activo INTEGER NOT NULL CHECK (activo IN (0,1))
) STRICT;
CREATE TABLE verificacion (
  id INTEGER PRIMARY KEY,
  incidencia_id INTEGER NOT NULL REFERENCES incidencia(id),
  utc INTEGER NOT NULL,
  actor TEXT NOT NULL,
  estado_compra TEXT NOT NULL CHECK (estado_compra IN ('CONFIRMADO','PENDIENTE','FALLIDO','POR_VERIFICAR')),
  estado_pago TEXT NOT NULL CHECK (estado_pago IN ('CONFIRMADO','PENDIENTE','DUPLICADO','FALLIDO','POR_VERIFICAR')),
  estado_emision TEXT NOT NULL CHECK (estado_emision IN ('EMITIDA','NO_EMITIDA','POR_VERIFICAR')),
  estado_ingreso TEXT NOT NULL CHECK (estado_ingreso IN ('NO_APLICA','VALIDADO','RECHAZADO','POR_VERIFICAR')),
  origen TEXT NOT NULL,
  nota TEXT NOT NULL
) STRICT;
CREATE INDEX ix_verificacion_incidencia ON verificacion (incidencia_id, utc);
ALTER TABLE sede ADD COLUMN piloto INTEGER NOT NULL DEFAULT 0 CHECK (piloto IN (0,1));
ALTER TABLE compra ADD COLUMN fuente_estado TEXT NOT NULL DEFAULT 'DISPONIBLE' CHECK (fuente_estado IN ('DISPONIBLE','SIN_RESPUESTA'));
ALTER TABLE incidencia ADD COLUMN cliente_id INTEGER REFERENCES usuario(id);
ALTER TABLE incidencia ADD COLUMN resultado TEXT;
ALTER TABLE incidencia ADD COLUMN evidencia_resolucion TEXT;
ALTER TABLE incidencia ADD COLUMN resuelto_por TEXT;
ALTER TABLE incidencia ADD COLUMN a_tiempo INTEGER CHECK (a_tiempo IN (0,1));
CREATE INDEX ix_incidencia_cliente ON incidencia (cliente_id);
