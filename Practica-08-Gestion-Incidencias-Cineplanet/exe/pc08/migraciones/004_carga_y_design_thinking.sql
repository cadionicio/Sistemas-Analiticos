-- PC08 · Migración 004 · Lotes de carga desde Excel y versiones de las herramientas de Design Thinking
CREATE TABLE lote_importado (
  id INTEGER PRIMARY KEY,
  proyecto_id INTEGER NOT NULL REFERENCES proyecto(id),
  huella_sha256 TEXT NOT NULL CHECK (length(huella_sha256) = 64),
  archivo TEXT NOT NULL,
  fecha_utc INTEGER NOT NULL,
  usuario TEXT NOT NULL,
  filas_leidas INTEGER NOT NULL CHECK (filas_leidas >= 0),
  filas_nuevas INTEGER NOT NULL CHECK (filas_nuevas >= 0),
  filas_existentes INTEGER NOT NULL CHECK (filas_existentes >= 0),
  resumen TEXT NOT NULL,
  UNIQUE (proyecto_id, huella_sha256)
) STRICT;
CREATE TABLE instrumento_version (
  id INTEGER PRIMARY KEY,
  proyecto_id INTEGER NOT NULL REFERENCES proyecto(id),
  codigo TEXT NOT NULL CHECK (codigo IN ('EM1','EM2','DF1','DF2','ID1','ID2','PR1','PR2','PV1','PV2')),
  version INTEGER NOT NULL CHECK (version >= 1),
  estado TEXT NOT NULL CHECK (estado IN ('BORRADOR','COMPLETA','VALIDADA')),
  contenido TEXT NOT NULL CHECK (json_valid(contenido)),
  naturaleza TEXT NOT NULL,
  autor TEXT NOT NULL,
  fecha_utc INTEGER NOT NULL,
  revisado_por TEXT,
  fecha_revision_utc INTEGER,
  nota_revision TEXT,
  UNIQUE (proyecto_id, codigo, version)
) STRICT;
CREATE INDEX ix_instrumento ON instrumento_version (proyecto_id, codigo, version);
