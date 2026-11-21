-- =====================================================================
-- Sistema de Análisis de Datos y Predictivo de Gestión de Inventarios
-- Esquema SQLite v1.0 (F1) · Autor: IA (Claude Opus 5.5) para
-- Dionicio Achachagua Cesar Alonso (20192589B) · GE803U · Práctica 04
-- Motor: sql.js (SQLite WASM) en memoria; persistencia en archivo .sqlite
-- =====================================================================
PRAGMA foreign_keys = ON;

-- ---------- 1. Datos de entrada ----------
CREATE TABLE dataset (
  id            INTEGER PRIMARY KEY,
  nombre        TEXT NOT NULL,
  tipo          TEXT NOT NULL CHECK (tipo IN ('ventas','kardex')),
  archivo       TEXT NOT NULL,
  hash_sha256   TEXT NOT NULL,           -- source_hash del contrato de resultados
  hojas         INTEGER,
  filas_origen  INTEGER,
  filas_validas INTEGER,
  fecha_min     TEXT, fecha_max TEXT,
  ultimo_mes_cerrado TEXT,               -- p. ej. '2019-03' (abril 2019 incompleto)
  estado        TEXT NOT NULL DEFAULT 'RECIBIDO'
                CHECK (estado IN ('RECIBIDO','DATOS_VALIDADOS','DATOS_INCOMPLETOS')),
  cargado_en    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','localtime'))
);

CREATE TABLE producto (
  id            INTEGER PRIMARY KEY,
  dataset_id    INTEGER NOT NULL REFERENCES dataset(id) ON DELETE CASCADE,
  codigo        TEXT NOT NULL,
  descripcion   TEXT,
  lote_ref      TEXT,
  familia       TEXT,                    -- p. ej. MATPRIMA, TB60, AL6063, CHAT
  unidad        TEXT DEFAULT 'unid.',
  -- Parámetros de abastecimiento (SUPUESTOS editables si el Excel no los trae)
  costo_unit        REAL, costo_es_supuesto INTEGER DEFAULT 1,
  lead_time_dias    REAL DEFAULT 15, lead_time_sd REAL DEFAULT 5,
  moq               REAL DEFAULT 0,  multiplo REAL DEFAULT 1,
  UNIQUE (dataset_id, codigo)
);

CREATE TABLE venta (
  id            INTEGER PRIMARY KEY,
  dataset_id    INTEGER NOT NULL REFERENCES dataset(id) ON DELETE CASCADE,
  n_origen      INTEGER,
  fecha         TEXT NOT NULL,           -- ISO yyyy-mm-dd
  periodo       TEXT GENERATED ALWAYS AS (substr(fecha,1,7)) STORED,
  ruc           TEXT, cliente TEXT, direccion TEXT, departamento TEXT,
  producto_id   INTEGER REFERENCES producto(id),
  sku           TEXT NOT NULL,
  soles         REAL NOT NULL,
  volumen       REAL,                    -- "Venta (Ton)": unidad ambigua -> volumen reportado
  utilidad      REAL NOT NULL,
  costo_implicito  REAL GENERATED ALWAYS AS (soles - utilidad) STORED,
  precio_implicito REAL GENERATED ALWAYS AS (CASE WHEN volumen > 0 THEN soles / volumen END) STORED,
  origen        TEXT NOT NULL DEFAULT 'excel' CHECK (origen IN ('excel','manual'))
);
CREATE INDEX ix_venta_periodo ON venta(dataset_id, periodo);
CREATE INDEX ix_venta_sku     ON venta(dataset_id, sku, periodo);

CREATE TABLE kardex_bloque (             -- un bloque = producto x hoja (mes)
  id              INTEGER PRIMARY KEY,
  dataset_id      INTEGER NOT NULL REFERENCES dataset(id) ON DELETE CASCADE,
  producto_id     INTEGER NOT NULL REFERENCES producto(id),
  hoja            TEXT NOT NULL,
  periodo         TEXT,                  -- tomado de las fechas reales, no del nombre de la hoja
  saldo_inicial   REAL, total_final_reportado REAL, total_final_calculado REAL,
  conciliado      INTEGER GENERATED ALWAYS AS (abs(coalesce(total_final_reportado,0) - coalesce(total_final_calculado,0)) <= 0.01) STORED
);

CREATE TABLE kardex_mov (
  id              INTEGER PRIMARY KEY,
  dataset_id      INTEGER NOT NULL REFERENCES dataset(id) ON DELETE CASCADE,
  bloque_id       INTEGER REFERENCES kardex_bloque(id),
  producto_id     INTEGER NOT NULL REFERENCES producto(id),
  hoja            TEXT, fila_origen INTEGER,
  fecha           TEXT NOT NULL,
  periodo         TEXT GENERATED ALWAYS AS (substr(fecha,1,7)) STORED,
  documento       TEXT, tipo_doc TEXT,   -- GU, N/S, N/I, T/I, T/S
  item            INTEGER,
  entrada         REAL NOT NULL DEFAULT 0,
  salida          REAL NOT NULL DEFAULT 0,
  stock_reportado REAL,
  stock_calculado REAL,
  motivo          TEXT,
  clase_mov       TEXT CHECK (clase_mov IN ('ENTRADA_COMPRA','ENTRADA_PRODUCCION','SALIDA_VENTA',
                   'SALIDA_CONSUMO','TRANSFORMACION','AJUSTE_DEVOLUCION','OTRO')),
  almacen         TEXT, sede TEXT,
  flag_inconsistente INTEGER GENERATED ALWAYS AS (abs(coalesce(stock_reportado,0) - coalesce(stock_calculado,0)) > 0.01) STORED,
  flag_negativo      INTEGER GENERATED ALWAYS AS (coalesce(stock_reportado,0) < 0) STORED,
  origen          TEXT NOT NULL DEFAULT 'excel' CHECK (origen IN ('excel','manual'))
);
CREATE INDEX ix_kmov_prod ON kardex_mov(dataset_id, producto_id, fecha);

CREATE TABLE mapeo_columna (             -- asistente de mapeo (sinónimos + correcciones del usuario)
  id INTEGER PRIMARY KEY, dataset_id INTEGER REFERENCES dataset(id) ON DELETE CASCADE,
  columna_origen TEXT NOT NULL, campo_canonico TEXT NOT NULL, confianza REAL, confirmado INTEGER DEFAULT 0
);

CREATE TABLE parametro (
  clave        TEXT PRIMARY KEY,           -- p. ej. tasa_mantener_anual, costo_ordenar, nivel_servicio_A
  valor        TEXT NOT NULL,
  unidad       TEXT,
  es_supuesto  INTEGER NOT NULL DEFAULT 1,
  descripcion  TEXT,
  actualizado_en TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','localtime'))
);

CREATE TABLE calidad_hallazgo (
  id INTEGER PRIMARY KEY, dataset_id INTEGER NOT NULL REFERENCES dataset(id) ON DELETE CASCADE,
  regla TEXT NOT NULL, severidad TEXT CHECK (severidad IN ('CRITICA','ALTA','MEDIA','BAJA','INFO')),
  entidad TEXT, fila_origen INTEGER, detalle TEXT
);

-- ---------- 2. Ejecuciones del Super Agente (contrato transversal) ----------
CREATE TABLE ejecucion (
  run_id        TEXT PRIMARY KEY,           -- UUID
  skill         TEXT NOT NULL CHECK (skill IN ('ingesta','describir_operacion','diagnosticar_desviacion',
                  'proyectar_6m','optimizar_plan','simular_escenarios','redactar_informe','generar_ppt','evaluador')),
  skill_version TEXT NOT NULL,
  dataset_id    INTEGER REFERENCES dataset(id) ON DELETE CASCADE,
  cutoff        TEXT, source_hash TEXT, metric_version TEXT,
  status        TEXT NOT NULL CHECK (status IN ('OK','PROVISIONAL','NEEDS_REVIEW','BLOCKED')),
  estado_flujo  TEXT CHECK (estado_flujo IN ('RECIBIDO','DATOS_VALIDADOS','ANALIZADO','EVALUADO','PROPUESTO','APROBADO',
                  'DATOS_INCOMPLETOS','MODELO_NO_APTO','INVIABLE')),
  parametros_json TEXT, assumptions_json TEXT, warnings_json TEXT, validation_json TEXT, next_action TEXT,
  inicio TEXT NOT NULL, fin TEXT
);

CREATE TABLE kpi_valor (
  run_id TEXT NOT NULL REFERENCES ejecucion(run_id) ON DELETE CASCADE,
  kpi TEXT NOT NULL, dimension TEXT NOT NULL DEFAULT 'total', clave TEXT NOT NULL DEFAULT '*',
  periodo TEXT NOT NULL DEFAULT '*', valor REAL, unidad TEXT, tipo TEXT DEFAULT 'real' CHECK (tipo IN ('real','proyectado')),
  PRIMARY KEY (run_id, kpi, dimension, clave, periodo, tipo)
);

CREATE TABLE clasificacion (              -- ABC, XYZ y patrón Syntetos-Boylan por producto
  run_id TEXT NOT NULL REFERENCES ejecucion(run_id) ON DELETE CASCADE,
  producto_id INTEGER NOT NULL REFERENCES producto(id),
  abc_valor TEXT, abc_utilidad TEXT, xyz TEXT, cv REAL, adi REAL, cv2 REAL,
  patron_sb TEXT CHECK (patron_sb IN ('SUAVE','ERRATICA','INTERMITENTE','IRREGULAR','SIN_DEMANDA')),
  PRIMARY KEY (run_id, producto_id)
);

CREATE TABLE causa_raiz (                  -- diagnóstico: hipótesis con evidencia a favor y en contra
  id INTEGER PRIMARY KEY, run_id TEXT NOT NULL REFERENCES ejecucion(run_id) ON DELETE CASCADE,
  problema_id TEXT CHECK (problema_id IN ('01','02','03','04','05','06','07','08','09','10')),
  categoria_6m TEXT, hipotesis TEXT NOT NULL, evidencia_favor TEXT, evidencia_contra TEXT,
  nivel_sustento TEXT CHECK (nivel_sustento IN ('COMPROBADA','ASOCIATIVA','A_VERIFICAR','SIN_EVIDENCIA')),
  contribucion REAL, unidad TEXT
);

CREATE TABLE pronostico (
  run_id TEXT NOT NULL REFERENCES ejecucion(run_id) ON DELETE CASCADE,
  serie TEXT NOT NULL,                      -- ventas_soles | volumen | utilidad | demanda_kardex
  nivel TEXT NOT NULL,                      -- total | departamento | clase | producto
  clave TEXT NOT NULL, periodo TEXT NOT NULL, h INTEGER NOT NULL CHECK (h BETWEEN 1 AND 6),
  modelo TEXT NOT NULL, p025 REAL, p10 REAL, p50 REAL, p90 REAL, p975 REAL, media REAL,
  PRIMARY KEY (run_id, serie, nivel, clave, periodo)
);

CREATE TABLE backtest (
  run_id TEXT NOT NULL REFERENCES ejecucion(run_id) ON DELETE CASCADE,
  serie TEXT NOT NULL, nivel TEXT NOT NULL, clave TEXT NOT NULL, modelo TEXT NOT NULL, h INTEGER NOT NULL,
  mae REAL, rmse REAL, wape REAL, mase REAL, pinball_p10 REAL, pinball_p90 REAL, cobertura80 REAL, sesgo REAL,
  seleccionado INTEGER DEFAULT 0,
  PRIMARY KEY (run_id, serie, nivel, clave, modelo, h)
);

CREATE TABLE politica_inventario (
  run_id TEXT NOT NULL REFERENCES ejecucion(run_id) ON DELETE CASCADE,
  producto_id INTEGER NOT NULL REFERENCES producto(id),
  politica TEXT CHECK (politica IN ('(s,Q)','(R,S)','MIN_MAX','BAJO_PEDIDO','REVISAR')),
  nivel_servicio REAL, demanda_media REAL, demanda_sd REAL,
  ss REAL, rop REAL, eoq REAL, s_objetivo REAL, posicion_inventario REAL, q_sugerida REAL,
  PRIMARY KEY (run_id, producto_id)
);

CREATE TABLE plan_compra (
  run_id TEXT NOT NULL REFERENCES ejecucion(run_id) ON DELETE CASCADE,
  producto_id INTEGER NOT NULL REFERENCES producto(id), periodo TEXT NOT NULL,
  cantidad REAL NOT NULL, costo REAL, restriccion_activa TEXT,
  PRIMARY KEY (run_id, producto_id, periodo)
);

CREATE TABLE simulacion (
  run_id TEXT NOT NULL REFERENCES ejecucion(run_id) ON DELETE CASCADE,
  escenario TEXT NOT NULL, semilla INTEGER NOT NULL, iteraciones INTEGER NOT NULL, parametros_json TEXT,
  PRIMARY KEY (run_id, escenario)
);
CREATE TABLE simulacion_resultado (
  run_id TEXT NOT NULL, escenario TEXT NOT NULL, metrica TEXT NOT NULL,
  media REAL, p5 REAL, p50 REAL, p95 REAL, probabilidad REAL, histograma_json TEXT,
  PRIMARY KEY (run_id, escenario, metrica),
  FOREIGN KEY (run_id, escenario) REFERENCES simulacion(run_id, escenario) ON DELETE CASCADE
);

CREATE TABLE recomendacion (
  id INTEGER PRIMARY KEY, run_id TEXT NOT NULL REFERENCES ejecucion(run_id) ON DELETE CASCADE,
  problema_id TEXT, titulo TEXT NOT NULL, evidencia TEXT NOT NULL, accion TEXT NOT NULL,
  responsable TEXT, plazo TEXT, kpi TEXT,
  impacto_conservador REAL, impacto_central REAL, impacto_favorable REAL,   -- S/, sin doble conteo
  tipo_impacto TEXT CHECK (tipo_impacto IN ('RECURRENTE_ANUAL','CAJA_UNA_VEZ')),
  prioridad INTEGER, estado TEXT DEFAULT 'PROPUESTO' CHECK (estado IN ('PROPUESTO','APROBADO','DESCARTADO'))
);

CREATE TABLE alerta (
  id INTEGER PRIMARY KEY, run_id TEXT REFERENCES ejecucion(run_id) ON DELETE CASCADE,
  tipo TEXT, severidad TEXT, entidad TEXT, mensaje TEXT, creada_en TEXT
);

-- ---------- 3. Informes, bitácora y auditoría ----------
CREATE TABLE informe (
  id INTEGER PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('tecnico','ejecutivo','presentacion')),
  version INTEGER NOT NULL,
  generado_en TEXT NOT NULL,
  cambios TEXT,                              -- control de versiones (qué cambió respecto a la anterior)
  aportes_usuario TEXT,                      -- sección "Aportes del usuario"
  runs_json TEXT, contenido_json TEXT, hash TEXT,
  UNIQUE (tipo, version)
);

CREATE TABLE bitacora_uso (                  -- fuente del Word de la P2 con tiempos por actividad
  id INTEGER PRIMARY KEY, ts_inicio TEXT NOT NULL, ts_fin TEXT,
  duracion_ms INTEGER, pantalla TEXT, accion TEXT NOT NULL, detalle TEXT
);

CREATE TABLE auditoria (
  id INTEGER PRIMARY KEY, ts TEXT NOT NULL, entidad TEXT NOT NULL, entidad_id TEXT,
  accion TEXT NOT NULL CHECK (accion IN ('INSERT','UPDATE','DELETE','APROBAR')), antes_json TEXT, despues_json TEXT
);

CREATE TABLE configuracion (clave TEXT PRIMARY KEY, valor TEXT);  -- tema, proveedor LLM (la API key NO se guarda por defecto)

-- Parámetros por defecto (SUPUESTOS editables, visibles como tales en la UI)
INSERT INTO parametro (clave, valor, unidad, es_supuesto, descripcion) VALUES
 ('tasa_mantener_anual','0.20','fracción/año',1,'Costo anual de mantener inventario (ayuda base: ejemplo 20 %)'),
 ('costo_ordenar','150','S/ por orden',1,'Costo administrativo por orden de compra'),
 ('nivel_servicio_A','0.95','prob.',1,'Nivel de servicio de ciclo objetivo, clase A'),
 ('nivel_servicio_B','0.90','prob.',1,'Nivel de servicio de ciclo objetivo, clase B'),
 ('nivel_servicio_C','0.85','prob.',1,'Nivel de servicio de ciclo objetivo, clase C'),
 ('revision_R_dias','30','días',1,'Intervalo de revisión periódica'),
 ('presupuesto_compras_mensual','0','S/',1,'0 = sin restricción de presupuesto'),
 ('mc_iteraciones','10000','iteraciones',0,'Iteraciones Monte Carlo'),
 ('mc_semilla','24092026','semilla',0,'Semilla reproducible'),
 ('horizonte_meses','6','meses',0,'Horizonte de proyección exigido por la práctica');
