// Esquema físico SQLite · versión de esquema 1
// Horas: TEXT ISO 8601 con zona fija de Lima (AAAA-MM-DDTHH:MM:SS-05:00), intervalos [inicio, fin).
// Dinero: INTEGER en céntimos de sol. Cantidades: INTEGER en unidades de la pieza.
export const VERSION_ESQUEMA = 1;

export const TABLAS_DATOS = [
  // orden de borrado inverso a dependencias
  'seguimiento_accion', 'accion', 'mant_programado', 'ejecucion_preventiva', 'tarea_preventiva',
  'reserva', 'consumo', 'movimiento', 'intervencion', 'orden', 'verificacion', 'correccion_tramo', 'tramo',
  'parada', 'horas_operacion', 'pieza', 'modo_falla', 'equipo', 'tipo_equipo', 'parametro', 'corrida',
];

export const DDL = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS meta (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS carga (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instante TEXT NOT NULL,
  origen TEXT NOT NULL CHECK (origen IN ('DEMOSTRACION','ARCHIVO')),
  archivo TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  contrato TEXT NOT NULL,
  empresa TEXT NOT NULL,
  periodo_desde TEXT NOT NULL,
  periodo_hasta TEXT NOT NULL,
  conteos_json TEXT NOT NULL,
  usuario TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS evento (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instante TEXT NOT NULL,
  tipo TEXT NOT NULL,
  referencia TEXT,
  detalle TEXT,
  usuario TEXT
);
CREATE TABLE IF NOT EXISTS usuario (
  codigo TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('PRODUCCION','MANTENIMIENTO','ALMACEN','RESP_MANTENIMIENTO','EVALUACION')),
  sal TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1))
);
CREATE TABLE IF NOT EXISTS parametro (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  unidad TEXT NOT NULL,
  descripcion TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tipo_equipo (
  codigo TEXT PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS equipo (
  codigo TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  tipo_codigo TEXT NOT NULL REFERENCES tipo_equipo(codigo),
  area TEXT NOT NULL,
  criticidad TEXT NOT NULL CHECK (criticidad IN ('ALTA','MEDIA','BAJA')),
  horas_plan_min INTEGER NOT NULL CHECK (horas_plan_min BETWEEN 0 AND 1440)
);
CREATE TABLE IF NOT EXISTS modo_falla (
  codigo TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  tipo_codigo TEXT NOT NULL REFERENCES tipo_equipo(codigo)
);
CREATE TABLE IF NOT EXISTS pieza (
  codigo TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  unidad TEXT NOT NULL,
  costo_cent INTEGER NOT NULL CHECK (costo_cent >= 0),
  plazo_normal_dias INTEGER NOT NULL CHECK (plazo_normal_dias >= 0),
  plazo_urgente_horas INTEGER NOT NULL CHECK (plazo_urgente_horas >= 0),
  stock_minimo INTEGER NOT NULL CHECK (stock_minimo >= 0),
  equipo_codigo TEXT NOT NULL REFERENCES equipo(codigo)
);
CREATE TABLE IF NOT EXISTS horas_operacion (
  equipo_codigo TEXT NOT NULL REFERENCES equipo(codigo),
  fecha TEXT NOT NULL,
  minutos INTEGER NOT NULL CHECK (minutos BETWEEN 0 AND 1440),
  PRIMARY KEY (equipo_codigo, fecha)
);
CREATE TABLE IF NOT EXISTS parada (
  codigo TEXT PRIMARY KEY,
  equipo_codigo TEXT NOT NULL REFERENCES equipo(codigo),
  inicio TEXT NOT NULL,
  fin TEXT,
  registro TEXT NOT NULL,
  sintoma TEXT NOT NULL,
  modo_codigo TEXT REFERENCES modo_falla(codigo),
  estado_causa TEXT NOT NULL CHECK (estado_causa IN ('PENDIENTE','HIPOTESIS','CONFIRMADA')),
  causa TEXT NOT NULL DEFAULT '',
  evidencia_causa TEXT NOT NULL DEFAULT '',
  reportado_por TEXT NOT NULL,
  verificado_por TEXT NOT NULL DEFAULT '',
  reincidencia_de TEXT REFERENCES parada(codigo),
  estado_reincidencia TEXT NOT NULL DEFAULT '' CHECK (estado_reincidencia IN ('','PENDIENTE','CONFIRMADA','DESCARTADA')),
  estado TEXT NOT NULL CHECK (estado IN ('ABIERTA','CERRADA')),
  op_id TEXT UNIQUE,
  CHECK (fin IS NULL OR fin > inicio),
  CHECK ((estado = 'ABIERTA') = (fin IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_parada_equipo_inicio ON parada(equipo_codigo, inicio);
CREATE TABLE IF NOT EXISTS tramo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parada_codigo TEXT NOT NULL REFERENCES parada(codigo),
  secuencia INTEGER NOT NULL CHECK (secuencia >= 1),
  tipo TEXT NOT NULL CHECK (tipo IN ('ESPERA_ATENCION','DIAGNOSTICO','ESPERA_REPUESTO','REPARACION','VERIFICACION','SIN_CLASIFICAR')),
  inicio TEXT NOT NULL,
  fin TEXT,
  evidencia TEXT NOT NULL DEFAULT '',
  autor TEXT NOT NULL DEFAULT '',
  registro TEXT NOT NULL,
  UNIQUE (parada_codigo, secuencia),
  CHECK (fin IS NULL OR fin > inicio)
);
CREATE INDEX IF NOT EXISTS ix_tramo_parada ON tramo(parada_codigo);
CREATE TABLE IF NOT EXISTS correccion_tramo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tramo_id INTEGER NOT NULL REFERENCES tramo(id),
  tipo_anterior TEXT NOT NULL,
  tipo_nuevo TEXT NOT NULL,
  autor TEXT NOT NULL,
  instante TEXT NOT NULL,
  motivo TEXT NOT NULL CHECK (length(motivo) > 0),
  evidencia TEXT NOT NULL CHECK (length(evidencia) > 0)
);
CREATE TABLE IF NOT EXISTS verificacion (
  codigo TEXT PRIMARY KEY,
  parada_codigo TEXT NOT NULL REFERENCES parada(codigo),
  instante TEXT NOT NULL,
  resultado TEXT NOT NULL CHECK (resultado IN ('APTO','NO_APTO')),
  verificado_por TEXT NOT NULL,
  observacion TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS tarea_preventiva (
  codigo TEXT PRIMARY KEY,
  equipo_codigo TEXT NOT NULL REFERENCES equipo(codigo),
  modo_codigo TEXT NOT NULL REFERENCES modo_falla(codigo),
  descripcion TEXT NOT NULL,
  frecuencia_dias INTEGER NOT NULL CHECK (frecuencia_dias > 0),
  justificacion TEXT NOT NULL,
  responsable TEXT NOT NULL,
  critica INTEGER NOT NULL CHECK (critica IN (0,1)),
  criterio_aceptacion TEXT NOT NULL,
  primer_vencimiento TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orden (
  codigo TEXT PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('CORRECTIVA','PREVENTIVA')),
  equipo_codigo TEXT NOT NULL REFERENCES equipo(codigo),
  parada_codigo TEXT REFERENCES parada(codigo),
  tarea_codigo TEXT REFERENCES tarea_preventiva(codigo),
  apertura TEXT NOT NULL,
  cierre TEXT,
  estado TEXT NOT NULL CHECK (estado IN ('ABIERTA','CERRADA','ANULADA')),
  responsable TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  op_id TEXT UNIQUE,
  CHECK (tipo <> 'CORRECTIVA' OR parada_codigo IS NOT NULL),
  CHECK (cierre IS NULL OR cierre >= apertura)
);
CREATE INDEX IF NOT EXISTS ix_orden_parada ON orden(parada_codigo);
CREATE TABLE IF NOT EXISTS intervencion (
  codigo TEXT PRIMARY KEY,
  orden_codigo TEXT NOT NULL REFERENCES orden(codigo),
  inicio TEXT NOT NULL,
  fin TEXT,
  tecnico TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  requirio_pieza INTEGER NOT NULL CHECK (requirio_pieza IN (0,1)),
  pieza_codigo TEXT REFERENCES pieza(codigo),
  CHECK (requirio_pieza = 0 OR pieza_codigo IS NOT NULL),
  CHECK (fin IS NULL OR fin > inicio)
);
CREATE TABLE IF NOT EXISTS movimiento (
  codigo TEXT PRIMARY KEY,
  pieza_codigo TEXT NOT NULL REFERENCES pieza(codigo),
  tipo TEXT NOT NULL CHECK (tipo IN ('SALDO_INICIAL','INGRESO','CONSUMO','AJUSTE_POSITIVO','AJUSTE_NEGATIVO','ANULACION')),
  cantidad INTEGER NOT NULL CHECK (cantidad > 0 OR (tipo = 'SALDO_INICIAL' AND cantidad = 0)),
  signo INTEGER NOT NULL CHECK (signo IN (1,-1)),
  fecha_efectiva TEXT NOT NULL,
  fecha_registro TEXT NOT NULL,
  orden_codigo TEXT REFERENCES orden(codigo),
  referencia TEXT NOT NULL DEFAULT '',
  responsable TEXT NOT NULL,
  motivo TEXT NOT NULL DEFAULT '',
  movimiento_ref TEXT REFERENCES movimiento(codigo),
  op_id TEXT UNIQUE,
  CHECK (tipo <> 'CONSUMO' OR orden_codigo IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_mov_pieza_fecha ON movimiento(pieza_codigo, fecha_efectiva);
CREATE TABLE IF NOT EXISTS reserva (
  codigo TEXT PRIMARY KEY,
  orden_codigo TEXT NOT NULL REFERENCES orden(codigo),
  pieza_codigo TEXT NOT NULL REFERENCES pieza(codigo),
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  fecha TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('VIGENTE','CONSUMIDA','LIBERADA')),
  cierre TEXT
);
CREATE TABLE IF NOT EXISTS consumo (
  codigo TEXT PRIMARY KEY,
  orden_codigo TEXT NOT NULL REFERENCES orden(codigo),
  pieza_codigo TEXT NOT NULL REFERENCES pieza(codigo),
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  fecha_efectiva TEXT NOT NULL,
  fecha_registro TEXT NOT NULL,
  responsable TEXT NOT NULL,
  movimiento_codigo TEXT NOT NULL UNIQUE REFERENCES movimiento(codigo),
  reserva_codigo TEXT REFERENCES reserva(codigo),
  op_id TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS ix_consumo_orden ON consumo(orden_codigo);
CREATE TABLE IF NOT EXISTS ejecucion_preventiva (
  codigo TEXT PRIMARY KEY,
  tarea_codigo TEXT NOT NULL REFERENCES tarea_preventiva(codigo),
  orden_codigo TEXT REFERENCES orden(codigo),
  fecha_vencimiento TEXT NOT NULL,
  fecha_ejecucion TEXT,
  resultado TEXT NOT NULL CHECK (resultado IN ('CONFORME','NO_CONFORME','PENDIENTE')),
  evidencia TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS mant_programado (
  codigo TEXT PRIMARY KEY,
  equipo_codigo TEXT NOT NULL REFERENCES equipo(codigo),
  inicio TEXT NOT NULL,
  fin TEXT NOT NULL,
  orden_codigo TEXT REFERENCES orden(codigo),
  descripcion TEXT NOT NULL,
  CHECK (fin > inicio)
);
CREATE TABLE IF NOT EXISTS accion (
  codigo TEXT PRIMARY KEY,
  problema TEXT NOT NULL,
  accion TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('TECNICA','ALMACEN')),
  responsable TEXT NOT NULL,
  fecha TEXT NOT NULL,
  objetivo TEXT NOT NULL,
  indicador TEXT NOT NULL,
  revision_desde TEXT NOT NULL,
  revision_hasta TEXT NOT NULL,
  resultado TEXT NOT NULL DEFAULT '',
  parada_codigo TEXT REFERENCES parada(codigo),
  pieza_codigo TEXT REFERENCES pieza(codigo),
  modo_codigo TEXT REFERENCES modo_falla(codigo),
  CHECK (revision_hasta >= revision_desde)
);
CREATE TABLE IF NOT EXISTS seguimiento_accion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  accion_codigo TEXT NOT NULL REFERENCES accion(codigo),
  fecha TEXT NOT NULL,
  valor TEXT NOT NULL,
  comentario TEXT NOT NULL DEFAULT '',
  autor TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS corrida (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,
  instante TEXT NOT NULL,
  version TEXT NOT NULL,
  semilla INTEGER,
  repeticiones INTEGER,
  horizonte_dias INTEGER,
  parametros_json TEXT NOT NULL,
  entrada_sha256 TEXT,
  resultado_json TEXT NOT NULL
);
`;
