-- PC08 · Migración 001 · Núcleo operativo del Caso 12 (Cineplanet) · solución EXE
CREATE TABLE proyecto (
  id INTEGER PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  caso_catalogo INTEGER NOT NULL CHECK (caso_catalogo BETWEEN 1 AND 16),
  nombre TEXT NOT NULL CHECK (length(trim(nombre)) BETWEEN 1 AND 150),
  sector TEXT NOT NULL CHECK (sector IN ('INDUSTRIAL','COMERCIAL','SERVICIOS','COMBINADA')),
  tamano TEXT NOT NULL CHECK (tamano IN ('MICRO','PEQUENA','MEDIANA','GRANDE')),
  naturaleza TEXT NOT NULL CHECK (naturaleza IN ('REAL','SINTETICO','MIXTO')),
  objetivo TEXT NOT NULL,
  alcance TEXT NOT NULL,
  creado_utc INTEGER NOT NULL
) STRICT;
CREATE TABLE sede (
  id INTEGER PRIMARY KEY,
  proyecto_id INTEGER NOT NULL REFERENCES proyecto(id),
  codigo TEXT NOT NULL,
  nombre TEXT NOT NULL,
  UNIQUE (proyecto_id, codigo)
) STRICT;
CREATE TABLE funcion (
  id INTEGER PRIMARY KEY,
  proyecto_id INTEGER NOT NULL REFERENCES proyecto(id),
  sede_id INTEGER NOT NULL REFERENCES sede(id),
  codigo TEXT NOT NULL,
  pelicula TEXT NOT NULL,
  sala TEXT NOT NULL,
  inicio_utc INTEGER,
  horario_estado TEXT NOT NULL CHECK (horario_estado IN ('CONFIRMADO','DESCONOCIDO','CONTRADICTORIO')),
  naturaleza TEXT NOT NULL,
  UNIQUE (proyecto_id, codigo),
  CHECK (horario_estado <> 'CONFIRMADO' OR inicio_utc IS NOT NULL)
) STRICT;
CREATE TABLE compra (
  id INTEGER PRIMARY KEY,
  proyecto_id INTEGER NOT NULL REFERENCES proyecto(id),
  codigo_pedido TEXT NOT NULL,
  funcion_id INTEGER REFERENCES funcion(id),
  canal TEXT NOT NULL CHECK (canal IN ('WEB','APP')),
  entradas INTEGER NOT NULL CHECK (entradas BETWEEN 1 AND 20),
  monto_centimos INTEGER NOT NULL CHECK (monto_centimos >= 0),
  estado_compra TEXT NOT NULL,
  estado_pago TEXT NOT NULL,
  estado_emision TEXT NOT NULL,
  estado_ingreso TEXT NOT NULL,
  creado_utc INTEGER NOT NULL,
  naturaleza TEXT NOT NULL,
  UNIQUE (proyecto_id, codigo_pedido)
) STRICT;
CREATE TABLE tipo_incidencia (
  id INTEGER PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  grupo TEXT NOT NULL,
  prioritario INTEGER NOT NULL CHECK (prioritario IN (0,1)),
  responsable_defecto TEXT NOT NULL,
  accion_sugerida TEXT NOT NULL,
  regla TEXT NOT NULL,
  palabras_clave TEXT NOT NULL,
  activo INTEGER NOT NULL CHECK (activo IN (0,1)),
  version INTEGER NOT NULL
) STRICT;
CREATE TABLE incidencia (
  id INTEGER PRIMARY KEY,
  proyecto_id INTEGER NOT NULL REFERENCES proyecto(id),
  codigo TEXT NOT NULL,
  compra_id INTEGER REFERENCES compra(id),
  funcion_id INTEGER REFERENCES funcion(id),
  sede_id INTEGER NOT NULL REFERENCES sede(id),
  tipo_codigo TEXT NOT NULL REFERENCES tipo_incidencia(codigo),
  pedido_declarado TEXT,
  descripcion TEXT NOT NULL,
  canal_origen TEXT NOT NULL CHECK (canal_origen IN ('CLIENTE','DIGITAL','BOLETERIA','CARGA')),
  estado TEXT NOT NULL CHECK (estado IN ('NUEVO','EN_VERIFICACION','EN_ATENCION','ESCALADO','RESUELTO','CERRADO')),
  provisional INTEGER NOT NULL CHECK (provisional IN (0,1)),
  responsable TEXT NOT NULL,
  siguiente_accion TEXT NOT NULL,
  naturaleza TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  apertura_utc INTEGER NOT NULL,
  actualizado_utc INTEGER NOT NULL,
  resuelto_utc INTEGER,
  cerrado_utc INTEGER,
  UNIQUE (proyecto_id, codigo)
) STRICT;
CREATE INDEX ix_incidencia_proyecto ON incidencia (proyecto_id, estado);
CREATE INDEX ix_incidencia_compra ON incidencia (compra_id);
CREATE TABLE contacto (
  id INTEGER PRIMARY KEY,
  incidencia_id INTEGER NOT NULL REFERENCES incidencia(id),
  canal TEXT NOT NULL,
  clave_origen TEXT NOT NULL UNIQUE,
  registrado_utc INTEGER NOT NULL,
  detalle TEXT NOT NULL
) STRICT;
CREATE INDEX ix_contacto_incidencia ON contacto (incidencia_id);
CREATE TABLE evento (
  id INTEGER PRIMARY KEY,
  incidencia_id INTEGER NOT NULL REFERENCES incidencia(id),
  utc INTEGER NOT NULL,
  tipo TEXT NOT NULL,
  canal TEXT NOT NULL,
  actor TEXT NOT NULL,
  detalle TEXT NOT NULL,
  regla TEXT
) STRICT;
CREATE INDEX ix_evento_incidencia ON evento (incidencia_id, utc);
CREATE TABLE evidencia (
  id INTEGER PRIMARY KEY,
  proyecto_id INTEGER NOT NULL REFERENCES proyecto(id),
  codigo TEXT NOT NULL,
  incidencia_id INTEGER REFERENCES incidencia(id),
  tipo TEXT NOT NULL,
  naturaleza TEXT NOT NULL,
  fecha_utc INTEGER NOT NULL,
  origen TEXT NOT NULL,
  contenido TEXT NOT NULL,
  url_https TEXT CHECK (url_https IS NULL OR (url_https LIKE 'https://%' AND length(url_https) <= 1000)),
  UNIQUE (proyecto_id, codigo)
) STRICT;
CREATE TABLE verificacion_enlace (
  id INTEGER PRIMARY KEY,
  evidencia_id INTEGER REFERENCES evidencia(id),
  url TEXT NOT NULL,
  dominio TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('DISPONIBLE','NO_DISPONIBLE','NO_VERIFICADO')),
  codigo_http INTEGER,
  detalle TEXT NOT NULL,
  utc INTEGER NOT NULL
) STRICT;
