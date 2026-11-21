// Esquema SQLite PC05 — versión de esquema 1
// Separación: catálogos (versionados por modelo) / hechos / corridas / auditoría.
export const SCHEMA_VERSION = 4;

export const DDL = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS meta (clave TEXT PRIMARY KEY, valor TEXT);

CREATE TABLE IF NOT EXISTS empresa (
  id TEXT PRIMARY KEY, nombre TEXT NOT NULL, ruc TEXT, moneda TEXT NOT NULL DEFAULT 'PEN',
  igv_tasa REAL NOT NULL DEFAULT 0.18 CHECK (igv_tasa >= 0 AND igv_tasa < 1),
  sintetico INTEGER NOT NULL DEFAULT 1, creado_en TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS periodo (
  id TEXT PRIMARY KEY, empresa_id TEXT NOT NULL REFERENCES empresa(id),
  codigo TEXT NOT NULL, nombre TEXT NOT NULL, inicio TEXT, fin TEXT,
  estado TEXT NOT NULL DEFAULT 'ABIERTO' CHECK (estado IN ('ABIERTO','CERRADO')),
  UNIQUE (empresa_id, codigo));

CREATE TABLE IF NOT EXISTS modelo (
  id TEXT PRIMARY KEY, empresa_id TEXT NOT NULL REFERENCES empresa(id),
  codigo TEXT NOT NULL, nombre TEXT NOT NULL, descripcion TEXT,
  origen TEXT NOT NULL CHECK (origen IN ('DEMO','PLANTILLA','EJEMPLO','USUARIO','CLON')),
  estado TEXT NOT NULL DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO','ARCHIVADO')),
  creado_en TEXT NOT NULL, UNIQUE (empresa_id, codigo));

CREATE TABLE IF NOT EXISTS modelo_version (
  id TEXT PRIMARY KEY, modelo_id TEXT NOT NULL REFERENCES modelo(id),
  numero INTEGER NOT NULL, estado TEXT NOT NULL DEFAULT 'BORRADOR' CHECK (estado IN ('BORRADOR','ACTIVA','CERRADA')),
  nota TEXT, creado_en TEXT NOT NULL, UNIQUE (modelo_id, numero));

CREATE TABLE IF NOT EXISTS centro (
  id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES modelo_version(id),
  codigo TEXT NOT NULL, nombre TEXT NOT NULL,
  participacion TEXT NOT NULL DEFAULT 'PARTICIPA' CHECK (participacion IN ('PARTICIPA','NO_PARTICIPA','PARCIAL')),
  pct_participacion REAL CHECK (pct_participacion IS NULL OR (pct_participacion >= 0 AND pct_participacion <= 1)),
  UNIQUE (version_id, codigo));

CREATE TABLE IF NOT EXISTS actividad (
  id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES modelo_version(id),
  codigo TEXT NOT NULL, nombre TEXT NOT NULL, centro_id TEXT NOT NULL REFERENCES centro(id),
  alcance TEXT NOT NULL DEFAULT 'INCLUIDA' CHECK (alcance IN ('INCLUIDA','EXCLUIDA','PARCIAL')),
  pct_alcance REAL, clase_valor TEXT CHECK (clase_valor IS NULL OR clase_valor IN ('AV','NAVN','NAVI')),
  orden INTEGER NOT NULL DEFAULT 0, UNIQUE (version_id, codigo));

CREATE TABLE IF NOT EXISTS puesto (
  id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES modelo_version(id),
  codigo TEXT NOT NULL, nombre TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'DIRECTO' CHECK (tipo IN ('DIRECTO','INDIRECTO')), UNIQUE (version_id, codigo));

CREATE TABLE IF NOT EXISTS persona (
  id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES modelo_version(id),
  codigo TEXT NOT NULL, nombre TEXT NOT NULL, sintetico INTEGER NOT NULL DEFAULT 1,
  UNIQUE (version_id, codigo));

CREATE TABLE IF NOT EXISTS persona_puesto (
  id TEXT PRIMARY KEY, persona_id TEXT NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
  puesto_id TEXT NOT NULL REFERENCES puesto(id), centro_id TEXT REFERENCES centro(id),
  desde TEXT NOT NULL, hasta TEXT);

CREATE TABLE IF NOT EXISTS costo_persona (
  id TEXT PRIMARY KEY, persona_id TEXT NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
  periodo_id TEXT NOT NULL REFERENCES periodo(id),
  remuneracion REAL NOT NULL DEFAULT 0, essalud REAL NOT NULL DEFAULT 0, gratificacion REAL NOT NULL DEFAULT 0,
  cts REAL NOT NULL DEFAULT 0, vacaciones REAL NOT NULL DEFAULT 0, bonos REAL NOT NULL DEFAULT 0, otros REAL NOT NULL DEFAULT 0,
  horas_disponibles REAL NOT NULL DEFAULT 0 CHECK (horas_disponibles >= 0),
  sobreimputacion_autorizada INTEGER NOT NULL DEFAULT 0, justificacion TEXT,
  fuente TEXT NOT NULL DEFAULT 'MANUAL', UNIQUE (persona_id, periodo_id));

CREATE TABLE IF NOT EXISTS imputacion_horas (
  id TEXT PRIMARY KEY, persona_id TEXT NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
  actividad_id TEXT NOT NULL REFERENCES actividad(id), periodo_id TEXT NOT NULL REFERENCES periodo(id),
  horas REAL NOT NULL CHECK (horas >= 0), fuente TEXT NOT NULL DEFAULT 'MANUAL',
  UNIQUE (persona_id, actividad_id, periodo_id));

CREATE TABLE IF NOT EXISTS objeto_costo (
  id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES modelo_version(id),
  codigo TEXT NOT NULL, nombre TEXT NOT NULL, magnitud TEXT, UNIQUE (version_id, codigo));

CREATE TABLE IF NOT EXISTS inductor (
  id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES modelo_version(id),
  codigo TEXT NOT NULL, nombre TEXT NOT NULL, unidad TEXT NOT NULL, definicion TEXT,
  nivel TEXT NOT NULL CHECK (nivel IN ('EC_CA','CA_AC','AC_OC','LAB')),
  tipo_base TEXT NOT NULL CHECK (tipo_base IN ('cantidad','porcentaje','importe','directo','plano')),
  UNIQUE (version_id, codigo));

CREATE TABLE IF NOT EXISTS pool_costo (
  id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES modelo_version(id),
  periodo_id TEXT NOT NULL REFERENCES periodo(id), codigo TEXT NOT NULL, nombre TEXT NOT NULL,
  monto REAL NOT NULL CHECK (monto >= 0), inductor_id TEXT NOT NULL REFERENCES inductor(id),
  fuente TEXT NOT NULL DEFAULT 'MANUAL', UNIQUE (version_id, periodo_id, codigo));

CREATE TABLE IF NOT EXISTS base_inductor (
  id TEXT PRIMARY KEY, pool_id TEXT NOT NULL REFERENCES pool_costo(id) ON DELETE CASCADE,
  destino_tipo TEXT NOT NULL, destino_id TEXT NOT NULL, valor REAL CHECK (valor IS NULL OR valor >= 0),
  estado_valor TEXT NOT NULL DEFAULT 'REAL' CHECK (estado_valor IN ('REAL','ESTIMADO','AJUSTADO','PENDIENTE')),
  metodo TEXT, justificacion TEXT, UNIQUE (pool_id, destino_tipo, destino_id));

CREATE TABLE IF NOT EXISTS corrida (
  id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES modelo_version(id),
  periodo_id TEXT NOT NULL REFERENCES periodo(id), etapa TEXT NOT NULL, params_hash TEXT NOT NULL,
  estado TEXT NOT NULL, host TEXT, app_version TEXT, creado_en TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS asignacion (
  id INTEGER PRIMARY KEY AUTOINCREMENT, corrida_id TEXT NOT NULL REFERENCES corrida(id) ON DELETE CASCADE,
  etapa TEXT NOT NULL, origen_tipo TEXT NOT NULL, origen_id TEXT NOT NULL, destino_tipo TEXT NOT NULL, destino_id TEXT NOT NULL,
  base REAL, denominador REAL, tasa REAL, importe REAL NOT NULL, detalle TEXT);

CREATE TABLE IF NOT EXISTS saldo (
  id INTEGER PRIMARY KEY AUTOINCREMENT, corrida_id TEXT NOT NULL REFERENCES corrida(id) ON DELETE CASCADE,
  etapa TEXT NOT NULL, origen_tipo TEXT NOT NULL, origen_id TEXT NOT NULL, monto REAL NOT NULL, causa TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, actor TEXT NOT NULL, accion TEXT NOT NULL,
  entidad TEXT, entidad_id TEXT, antes TEXT, despues TEXT, correlacion TEXT);


-- ===== Esquema 2: costeo completo P1–P4c =====
CREATE TABLE IF NOT EXISTS modelo_origen (
  modelo_id TEXT PRIMARY KEY REFERENCES modelo(id), archivo TEXT, sha256 TEXT, importado_en TEXT, formato TEXT, advertencias TEXT);

CREATE TABLE IF NOT EXISTS material (
  id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES modelo_version(id),
  codigo TEXT NOT NULL, nombre TEXT NOT NULL, unidad_consumo TEXT NOT NULL, unidad_factura TEXT,
  costo_factura REAL NOT NULL CHECK (costo_factura >= 0), cantidad_factura REAL NOT NULL CHECK (cantidad_factura > 0),
  equivalencia REAL NOT NULL DEFAULT 1 CHECK (equivalencia > 0), equivalencia_texto TEXT,
  incluye_igv INTEGER NOT NULL DEFAULT 0, igv_recuperable INTEGER NOT NULL DEFAULT 1,
  tratamiento_validado INTEGER NOT NULL DEFAULT 1, fuente TEXT, UNIQUE (version_id, codigo));

CREATE TABLE IF NOT EXISTS material_precio (
  material_id TEXT NOT NULL REFERENCES material(id) ON DELETE CASCADE, periodo_id TEXT NOT NULL REFERENCES periodo(id),
  costo_factura REAL NOT NULL CHECK (costo_factura >= 0), fuente TEXT, PRIMARY KEY (material_id, periodo_id));

CREATE TABLE IF NOT EXISTS consumo_material (
  id TEXT PRIMARY KEY, actividad_id TEXT NOT NULL REFERENCES actividad(id) ON DELETE CASCADE,
  material_id TEXT NOT NULL REFERENCES material(id) ON DELETE CASCADE, periodo_id TEXT NOT NULL REFERENCES periodo(id),
  cantidad REAL NOT NULL CHECK (cantidad >= 0), fuente TEXT, UNIQUE (actividad_id, material_id, periodo_id));

CREATE TABLE IF NOT EXISTS servicio_directo (
  id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES modelo_version(id), periodo_id TEXT NOT NULL REFERENCES periodo(id),
  actividad_id TEXT NOT NULL REFERENCES actividad(id) ON DELETE CASCADE, proveedor TEXT, servicio TEXT NOT NULL,
  cantidad REAL NOT NULL CHECK (cantidad >= 0), unidad TEXT, tarifa REAL NOT NULL CHECK (tarifa >= 0), documento TEXT, fuente TEXT);

CREATE TABLE IF NOT EXISTS elemento_costo (
  id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES modelo_version(id),
  codigo TEXT NOT NULL, nombre TEXT NOT NULL, tipo TEXT, UNIQUE (version_id, codigo));

CREATE TABLE IF NOT EXISTS ec_monto (
  ec_id TEXT NOT NULL REFERENCES elemento_costo(id) ON DELETE CASCADE, periodo_id TEXT NOT NULL REFERENCES periodo(id),
  monto REAL NOT NULL CHECK (monto >= 0), fuente TEXT, PRIMARY KEY (ec_id, periodo_id));

CREATE TABLE IF NOT EXISTS regla_reparto (
  id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES modelo_version(id), codigo TEXT NOT NULL,
  nivel TEXT NOT NULL CHECK (nivel IN ('EC_CA','CA_AC','AC_OC')),
  origen_id TEXT NOT NULL, centro_id TEXT REFERENCES centro(id),
  inductor TEXT NOT NULL, unidad TEXT, tipo_base TEXT NOT NULL CHECK (tipo_base IN ('cantidad','porcentaje','importe','directo','plano')),
  base_desde TEXT, definicion TEXT, fuente TEXT, UNIQUE (version_id, codigo));

CREATE TABLE IF NOT EXISTS valor_base (
  id TEXT PRIMARY KEY, regla_id TEXT NOT NULL REFERENCES regla_reparto(id) ON DELETE CASCADE,
  destino_id TEXT NOT NULL, periodo_id TEXT NOT NULL REFERENCES periodo(id),
  valor REAL CHECK (valor IS NULL OR valor >= 0),
  estado_valor TEXT NOT NULL DEFAULT 'REAL' CHECK (estado_valor IN ('REAL','ESTIMADO','AJUSTADO','PENDIENTE')),
  metodo TEXT, justificacion TEXT, fuente TEXT, UNIQUE (regla_id, destino_id, periodo_id));

CREATE TABLE IF NOT EXISTS objeto_magnitud (
  objeto_id TEXT NOT NULL REFERENCES objeto_costo(id) ON DELETE CASCADE, periodo_id TEXT NOT NULL REFERENCES periodo(id),
  cantidad REAL CHECK (cantidad IS NULL OR cantidad >= 0), fuente TEXT, PRIMARY KEY (objeto_id, periodo_id));

CREATE TABLE IF NOT EXISTS referencia_excel (
  id INTEGER PRIMARY KEY AUTOINCREMENT, version_id TEXT NOT NULL REFERENCES modelo_version(id),
  hoja TEXT NOT NULL, celda TEXT NOT NULL, concepto TEXT NOT NULL, clave TEXT, valor REAL, formula TEXT);

-- ===== Esquema 3: presupuesto, finanzas, EVA, escenarios =====
CREATE TABLE IF NOT EXISTS presupuesto (
  id INTEGER PRIMARY KEY AUTOINCREMENT, version_id TEXT NOT NULL REFERENCES modelo_version(id), periodo_id TEXT NOT NULL REFERENCES periodo(id),
  concepto TEXT NOT NULL, monto REAL NOT NULL, unidad TEXT, fuente TEXT, UNIQUE (version_id, periodo_id, concepto));
CREATE TABLE IF NOT EXISTS finanzas_periodo (
  version_id TEXT NOT NULL REFERENCES modelo_version(id), periodo_id TEXT NOT NULL REFERENCES periodo(id),
  ventas REAL, costo_ventas_sin_logistica REAL, otros_gastos_operativos REAL, tasa_impuesto REAL, fuente TEXT, PRIMARY KEY (version_id, periodo_id));
CREATE TABLE IF NOT EXISTS parametro_eva (
  version_id TEXT NOT NULL REFERENCES modelo_version(id), clave TEXT NOT NULL, valor REAL, unidad TEXT, descripcion TEXT, fuente TEXT, PRIMARY KEY (version_id, clave));
CREATE TABLE IF NOT EXISTS escenario_variable (
  id INTEGER PRIMARY KEY AUTOINCREMENT, version_id TEXT NOT NULL REFERENCES modelo_version(id), escenario TEXT NOT NULL, variable TEXT NOT NULL,
  distribucion TEXT NOT NULL, minimo REAL, moda REAL, maximo REAL, fuente TEXT, UNIQUE (version_id, escenario, variable));

-- ===== Esquema 4: simulaciones guardadas (nunca modifican corridas ni datos históricos) =====
CREATE TABLE IF NOT EXISTS simulacion (
  id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES modelo_version(id), periodo_id TEXT NOT NULL REFERENCES periodo(id),
  escenario TEXT NOT NULL, semilla INTEGER NOT NULL, iteraciones INTEGER NOT NULL, estado TEXT NOT NULL CHECK (estado IN ('COMPLETA')),
  base_run_id TEXT NOT NULL REFERENCES corrida(id), params_hash TEXT NOT NULL, resultado TEXT NOT NULL, ms INTEGER, app_version TEXT, creado_en TEXT NOT NULL);

CREATE INDEX IF NOT EXISTS ix_vb_regla ON valor_base(regla_id, periodo_id);
CREATE INDEX IF NOT EXISTS ix_cm_per ON consumo_material(periodo_id);

CREATE INDEX IF NOT EXISTS ix_imp_per ON imputacion_horas(periodo_id, persona_id);
CREATE INDEX IF NOT EXISTS ix_asig_corr ON asignacion(corrida_id, etapa);
`;

/** Columnas añadidas en esquema 2 a tablas existentes (migración sin pérdida). */
export const MIGRACIONES_COLUMNAS: [string, string, string][] = [
  ["centro", "nota", "TEXT"],
  ["actividad", "nota", "TEXT"],
  ["objeto_costo", "clase", "TEXT NOT NULL DEFAULT 'OBJETO'"],
  ["objeto_costo", "nota", "TEXT"],
  ["persona", "agregado_puesto", "INTEGER NOT NULL DEFAULT 0"],
  ["periodo", "orden", "INTEGER NOT NULL DEFAULT 0"],
];
