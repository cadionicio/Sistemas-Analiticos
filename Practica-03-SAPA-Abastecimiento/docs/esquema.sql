
-- ---------------------------------------------------------------------------
-- 0. METADATOS Y PARAMETRIA
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS metadata_esquema (
    clave               TEXT PRIMARY KEY,
    valor               TEXT NOT NULL,
    fecha_actualizacion TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS parametros_sistema (
    clave               TEXT PRIMARY KEY,
    valor               TEXT NOT NULL,
    tipo_dato           TEXT NOT NULL CHECK (tipo_dato IN ('INT','FLOAT','TEXT','BOOL','JSON')),
    ambito              TEXT NOT NULL DEFAULT 'GLOBAL',
    descripcion         TEXT,
    fecha_actualizacion TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 1. MAESTROS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS maestro_proveedores (
    proveedor_id    TEXT PRIMARY KEY,
    razon_social    TEXT NOT NULL,
    ruc             TEXT UNIQUE,
    pais            TEXT NOT NULL DEFAULT 'PE',
    es_importado    INTEGER NOT NULL DEFAULT 0 CHECK (es_importado IN (0,1)),
    moneda          TEXT NOT NULL DEFAULT 'PEN' CHECK (moneda IN ('PEN','USD')),
    dias_credito    INTEGER NOT NULL DEFAULT 30 CHECK (dias_credito >= 0),
    otif_historico  REAL CHECK (otif_historico BETWEEN 0 AND 1),
    homologado      INTEGER NOT NULL DEFAULT 1 CHECK (homologado IN (0,1)),
    fecha_alta      TEXT NOT NULL DEFAULT (date('now'))
);

CREATE TABLE IF NOT EXISTS maestro_materiales (
    sku                     TEXT PRIMARY KEY,
    descripcion             TEXT NOT NULL,
    sector                  TEXT NOT NULL CHECK (sector IN ('RETAIL','INDUSTRIAL')),
    categoria               TEXT NOT NULL,
    familia                 TEXT,
    -- Unidades: el factor de conversion evita el error de "10 cajas" = ? unidades
    unidad_base             TEXT NOT NULL,
    unidad_compra           TEXT NOT NULL,
    factor_conversion       REAL NOT NULL CHECK (factor_conversion > 0),
    costo_unitario          REAL NOT NULL CHECK (costo_unitario > 0),
    moneda                  TEXT NOT NULL DEFAULT 'PEN' CHECK (moneda IN ('PEN','USD')),
    -- Atributos fisicos y de almacenamiento (WMS)
    volumen_m3_unidad       REAL NOT NULL CHECK (volumen_m3_unidad > 0),
    peso_kg_unidad          REAL NOT NULL CHECK (peso_kg_unidad > 0),
    unidades_por_palet      INTEGER NOT NULL CHECK (unidades_por_palet > 0),
    apilable_max_niveles    INTEGER NOT NULL DEFAULT 1 CHECK (apilable_max_niveles >= 1),
    tipo_almacenamiento     TEXT NOT NULL CHECK (tipo_almacenamiento IN
                                ('RACK_SELECTIVO','RACK_DINAMICO','RACK_COMPACTO_DRIVE_IN',
                                 'PISO_BLOQUE','ESTANTERIA_PICKING')),
    politica_rotacion       TEXT NOT NULL CHECK (politica_rotacion IN ('FIFO','LIFO','FEFO')),
    vida_util_dias          INTEGER CHECK (vida_util_dias IS NULL OR vida_util_dias > 0),
    compatible_gtp          INTEGER NOT NULL DEFAULT 0 CHECK (compatible_gtp IN (0,1)),
    motivo_no_gtp           TEXT,
    -- Segmentacion estrategica: scores auditables, segmento derivado
    score_impacto_economico REAL NOT NULL CHECK (score_impacto_economico BETWEEN 0 AND 1),
    score_riesgo_suministro REAL NOT NULL CHECK (score_riesgo_suministro BETWEEN 0 AND 1),
    segmento_kraljic        TEXT NOT NULL CHECK (segmento_kraljic IN
                                ('APALANCADO','ESTRATEGICO','RUTINARIO','CUELLO_DE_BOTELLA')),
    clase_abc               TEXT CHECK (clase_abc IN ('A','B','C')),
    clase_xyz               TEXT CHECK (clase_xyz IN ('X','Y','Z')),
    cv_demanda              REAL CHECK (cv_demanda >= 0),
    criticidad_operativa    INTEGER NOT NULL DEFAULT 3 CHECK (criticidad_operativa BETWEEN 1 AND 5),
    arquetipo_demanda       TEXT NOT NULL CHECK (arquetipo_demanda IN
                                ('REGULAR','ESTACIONAL','TENDENCIA','INTERMITENTE',
                                 'PROMO_SENSIBLE','NUEVO')),
    activo                  INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
    version_maestro         INTEGER NOT NULL DEFAULT 1,
    fecha_alta              TEXT NOT NULL DEFAULT (date('now')),
    -- REGLA 1: FEFO exige vida util declarada. Sin fecha de vencimiento la
    -- politica no es ejecutable y el sistema estaria mintiendo al planificador.
    CHECK (politica_rotacion <> 'FEFO' OR vida_util_dias IS NOT NULL),
    -- REGLA 2: la compatibilidad GTP no es una opinion comercial sino una
    -- restriccion fisica del shuttle/miniload. Umbrales: 0.05 m3 y 15 kg.
    CHECK (compatible_gtp = 0 OR (volumen_m3_unidad <= 0.05 AND peso_kg_unidad <= 15.0)),
    -- REGLA 3: un material perecible NO puede ir a rack compacto con LIFO.
    CHECK (vida_util_dias IS NULL OR politica_rotacion <> 'LIFO')
);

-- Relacion n:m SKU-proveedor: aqui vive la PARAMETRIA DE ABASTECIMIENTO.
CREATE TABLE IF NOT EXISTS sku_proveedor (
    sku                     TEXT NOT NULL REFERENCES maestro_materiales(sku) ON DELETE CASCADE,
    proveedor_id            TEXT NOT NULL REFERENCES maestro_proveedores(proveedor_id) ON DELETE RESTRICT,
    prioridad               INTEGER NOT NULL DEFAULT 1 CHECK (prioridad >= 1),
    precio_unitario         REAL NOT NULL CHECK (precio_unitario > 0),
    moq                     REAL NOT NULL DEFAULT 1 CHECK (moq > 0),
    lote_multiplo           REAL NOT NULL DEFAULT 1 CHECK (lote_multiplo > 0),
    -- Lead time como DISTRIBUCION log-normal desplazada:
    --   LT = lead_time_min_dias + LogNormal(ln_mu, ln_sigma)
    -- Parametrizacion por momentos (m = media del exceso, s = desv. del exceso):
    --   ln_mu    = ln( m^2 / sqrt(m^2 + s^2) )
    --   ln_sigma = sqrt( ln( 1 + s^2/m^2 ) )
    lead_time_min_dias      REAL NOT NULL CHECK (lead_time_min_dias >= 0),
    lead_time_medio_dias    REAL NOT NULL CHECK (lead_time_medio_dias > 0),
    lead_time_sigma_dias    REAL NOT NULL CHECK (lead_time_sigma_dias >= 0),
    ln_mu                   REAL NOT NULL,
    ln_sigma                REAL NOT NULL CHECK (ln_sigma >= 0),
    homologado              INTEGER NOT NULL DEFAULT 1 CHECK (homologado IN (0,1)),
    PRIMARY KEY (sku, proveedor_id),
    CHECK (lead_time_medio_dias > lead_time_min_dias)
);

-- ---------------------------------------------------------------------------
-- 2. EVENTOS EXOGENOS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS eventos_disrupcion (
    id_disrupcion       INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo                TEXT NOT NULL CHECK (tipo IN
                            ('CLIMA','PARO_TRANSPORTISTA','CONGESTION_ADUANA',
                             'QUIEBRE_PROVEEDOR','SHOCK_TIPO_CAMBIO','FALLA_INTERNA')),
    ambito              TEXT NOT NULL CHECK (ambito IN ('PROVEEDOR','CATEGORIA','GLOBAL')),
    ambito_valor        TEXT,
    fecha_inicio        TEXT NOT NULL,
    fecha_fin           TEXT NOT NULL,
    factor_lead_time    REAL NOT NULL DEFAULT 1.0 CHECK (factor_lead_time >= 1.0),
    factor_demanda      REAL NOT NULL DEFAULT 1.0 CHECK (factor_demanda > 0),
    descripcion         TEXT,
    CHECK (fecha_fin >= fecha_inicio)
);

-- ---------------------------------------------------------------------------
-- 3. HECHOS TRANSACCIONALES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS historico_demanda (
    fecha                       TEXT NOT NULL,
    sku                         TEXT NOT NULL REFERENCES maestro_materiales(sku) ON DELETE CASCADE,
    centro                      TEXT NOT NULL DEFAULT 'CD01',
    -- OBSERVABLE: lo unico que el ERP realmente registra
    demanda_atendida            REAL NOT NULL CHECK (demanda_atendida >= 0),
    devoluciones                REAL NOT NULL DEFAULT 0 CHECK (devoluciones >= 0),
    precio_neto                 REAL CHECK (precio_neto IS NULL OR precio_neto >= 0),
    promocion_activa            INTEGER NOT NULL DEFAULT 0 CHECK (promocion_activa IN (0,1)),
    evento                      TEXT,
    horas_sin_stock             REAL NOT NULL DEFAULT 0 CHECK (horas_sin_stock BETWEEN 0 AND 24),
    -- INFERIDO: nunca confundir con observacion
    flag_censura                INTEGER NOT NULL DEFAULT 0 CHECK (flag_censura IN (0,1)),
    demanda_perdida_estimada    REAL CHECK (demanda_perdida_estimada IS NULL OR demanda_perdida_estimada >= 0),
    metodo_estimacion_perdida   TEXT,
    -- VERDAD-TERRENO SINTETICA: no existe en un entorno productivo.
    -- Uso exclusivo: medir el error del corrector de censura en la Fase 2.
    demanda_latente_sintetica   REAL,
    origen_dato                 TEXT NOT NULL DEFAULT 'SINTETICO'
                                CHECK (origen_dato IN ('SINTETICO','ERP','MANUAL','EXCEL')),
    PRIMARY KEY (fecha, sku, centro),
    -- Coherencia: si hubo censura, hubo horas sin stock.
    CHECK (flag_censura = 0 OR horas_sin_stock > 0)
);

CREATE TABLE IF NOT EXISTS inventario_diario (
    fecha                   TEXT NOT NULL,
    sku                     TEXT NOT NULL REFERENCES maestro_materiales(sku) ON DELETE CASCADE,
    centro                  TEXT NOT NULL DEFAULT 'CD01',
    stock_inicial           REAL NOT NULL CHECK (stock_inicial >= 0),
    recepciones             REAL NOT NULL DEFAULT 0 CHECK (recepciones >= 0),
    consumo                 REAL NOT NULL DEFAULT 0 CHECK (consumo >= 0),
    mermas                  REAL NOT NULL DEFAULT 0 CHECK (mermas >= 0),
    stock_final             REAL NOT NULL CHECK (stock_final >= 0),
    stock_transito          REAL NOT NULL DEFAULT 0 CHECK (stock_transito >= 0),
    stock_reservado         REAL NOT NULL DEFAULT 0 CHECK (stock_reservado >= 0),
    stock_bloqueado_calidad REAL NOT NULL DEFAULT 0 CHECK (stock_bloqueado_calidad >= 0),
    -- Posicion = disponible + transito - reservado. Es la magnitud que se
    -- compara contra el punto de pedido; usar solo el stock fisico duplica
    -- compras cuando ya hay material en camino.
    posicion_inventario     REAL NOT NULL,
    quiebre_flag            INTEGER NOT NULL DEFAULT 0 CHECK (quiebre_flag IN (0,1)),
    palets_ocupados         REAL CHECK (palets_ocupados IS NULL OR palets_ocupados >= 0),
    volumen_ocupado_m3      REAL CHECK (volumen_ocupado_m3 IS NULL OR volumen_ocupado_m3 >= 0),
    PRIMARY KEY (fecha, sku, centro)
);

CREATE TABLE IF NOT EXISTS ordenes_compra (
    id_orden                    TEXT NOT NULL,
    linea                       INTEGER NOT NULL DEFAULT 1 CHECK (linea >= 1),
    sku                         TEXT NOT NULL REFERENCES maestro_materiales(sku),
    proveedor_id                TEXT NOT NULL REFERENCES maestro_proveedores(proveedor_id),
    centro                      TEXT NOT NULL DEFAULT 'CD01',
    -- CADENA DE FECHAS COMPLETA: cada tramo aisla a un responsable distinto
    fecha_necesidad             TEXT NOT NULL,   -- cuando se requiere el material
    fecha_solicitud             TEXT NOT NULL,   -- requisicion creada por Compras
    fecha_aprobacion_finanzas   TEXT,            -- liberacion presupuestal
    fecha_emision               TEXT,            -- OC enviada al proveedor
    fecha_prometida             TEXT,            -- compromiso del proveedor
    fecha_real_recepcion        TEXT,            -- ingreso fisico a almacen
    estado_aprobacion_finanzas  TEXT NOT NULL CHECK (estado_aprobacion_finanzas IN
                                    ('PENDIENTE','APROBADA','APROBADA_CON_RETRASO',
                                     'OBSERVADA','RECHAZADA')),
    motivo_bloqueo_finanzas     TEXT,
    cantidad_solicitada         REAL NOT NULL CHECK (cantidad_solicitada > 0),
    cantidad_recibida           REAL NOT NULL DEFAULT 0 CHECK (cantidad_recibida >= 0),
    cantidad_rechazada_calidad  REAL NOT NULL DEFAULT 0 CHECK (cantidad_rechazada_calidad >= 0),
    precio_unitario             REAL NOT NULL CHECK (precio_unitario > 0),
    moneda                      TEXT NOT NULL DEFAULT 'PEN' CHECK (moneda IN ('PEN','USD')),
    costo_total                 REAL NOT NULL CHECK (costo_total >= 0),
    -- DESCOMPOSICION DEL RETRASO (analisis diagnostico de causa raiz):
    --   dias_retraso_total = dias_retraso_aprobacion + dias_retraso_proveedor
    -- donde:
    --   dias_retraso_aprobacion = fecha_emision - fecha_solicitud - SLA_interno
    --   dias_retraso_proveedor  = fecha_real_recepcion - fecha_prometida
    lead_time_plan_dias         REAL CHECK (lead_time_plan_dias IS NULL OR lead_time_plan_dias >= 0),
    lead_time_real_dias         REAL CHECK (lead_time_real_dias IS NULL OR lead_time_real_dias >= 0),
    dias_retraso_aprobacion     REAL NOT NULL DEFAULT 0,
    dias_retraso_proveedor      REAL NOT NULL DEFAULT 0,
    dias_retraso_total          REAL NOT NULL DEFAULT 0,
    causa_raiz_retraso          TEXT NOT NULL DEFAULT 'SIN_RETRASO' CHECK (causa_raiz_retraso IN
                                    ('SIN_RETRASO','BLOQUEO_FINANZAS','APROBACION_TARDIA',
                                     'INCUMPLIMIENTO_PROVEEDOR','DISRUPCION_LOGISTICA',
                                     'RECHAZO_CALIDAD','CAUSA_MIXTA')),
    id_disrupcion               INTEGER REFERENCES eventos_disrupcion(id_disrupcion),
    es_compra_urgente           INTEGER NOT NULL DEFAULT 0 CHECK (es_compra_urgente IN (0,1)),
    estado_orden                TEXT NOT NULL CHECK (estado_orden IN
                                    ('PENDIENTE_APROBACION','APROBADA','EMITIDA','EN_TRANSITO',
                                     'RECIBIDA_PARCIAL','RECIBIDA_TOTAL','CANCELADA')),
    usuario_aprobador           TEXT,
    id_corrida                  TEXT,
    PRIMARY KEY (id_orden, linea),
    -- Sobre-recepcion tolerada 5%; por encima es error de registro, no un hecho.
    CHECK (cantidad_recibida <= cantidad_solicitada * 1.05),
    -- Coherencia temporal de la cadena de fechas
    CHECK (fecha_aprobacion_finanzas IS NULL OR fecha_aprobacion_finanzas >= fecha_solicitud),
    CHECK (fecha_emision IS NULL OR fecha_aprobacion_finanzas IS NULL
           OR fecha_emision >= fecha_aprobacion_finanzas),
    CHECK (fecha_real_recepcion IS NULL OR fecha_emision IS NULL
           OR fecha_real_recepcion >= fecha_emision)
);

-- ---------------------------------------------------------------------------
-- 4. TRAZABILIDAD DE EJECUCIONES Y RESULTADOS DE AGENTES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ejecuciones (
    id_corrida          TEXT PRIMARY KEY,
    fecha_corte         TEXT NOT NULL,
    horizonte_meses     INTEGER NOT NULL CHECK (horizonte_meses > 0),
    escenarios          TEXT NOT NULL,
    usuario             TEXT NOT NULL,
    version_app         TEXT NOT NULL,
    hash_entradas       TEXT,
    estado              TEXT NOT NULL CHECK (estado IN
                            ('INICIADA','PENDIENTE_DATOS','CALCULADA','OBSERVADA',
                             'APROBADA','FALLIDA','CANCELADA')),
    ts_inicio           TEXT NOT NULL DEFAULT (datetime('now')),
    ts_fin              TEXT,
    duracion_seg        REAL,
    observaciones       TEXT
);

CREATE TABLE IF NOT EXISTS resultados_analisis (
    id_resultado    INTEGER PRIMARY KEY AUTOINCREMENT,
    id_corrida      TEXT NOT NULL REFERENCES ejecuciones(id_corrida) ON DELETE CASCADE,
    agente          TEXT NOT NULL,
    tipo_analisis   TEXT NOT NULL CHECK (tipo_analisis IN
                        ('DESCRIPTIVO','DIAGNOSTICO','PREDICTIVO','PRESCRIPTIVO','CONTROL')),
    sku             TEXT,
    centro          TEXT,
    periodo         TEXT,
    escenario       TEXT NOT NULL DEFAULT 'BASE',
    metrica         TEXT NOT NULL,
    valor           REAL,
    valor_texto     TEXT,
    unidad          TEXT,
    nivel_confianza REAL CHECK (nivel_confianza IS NULL OR nivel_confianza BETWEEN 0 AND 1),
    evidencia_json  TEXT,
    ts_registro     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS excepciones_plan (
    id_excepcion    INTEGER PRIMARY KEY AUTOINCREMENT,
    id_corrida      TEXT NOT NULL REFERENCES ejecuciones(id_corrida) ON DELETE CASCADE,
    agente          TEXT NOT NULL,
    severidad       TEXT NOT NULL CHECK (severidad IN ('BLOQUEANTE','ALTA','MEDIA','INFORMATIVA')),
    codigo          TEXT NOT NULL,
    sku             TEXT,
    descripcion     TEXT NOT NULL,
    accion_sugerida TEXT,
    responsable     TEXT,
    resuelta        INTEGER NOT NULL DEFAULT 0 CHECK (resuelta IN (0,1)),
    ts_registro     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS log_auditoria (
    id_log      INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          TEXT NOT NULL DEFAULT (datetime('now')),
    id_corrida  TEXT,
    modulo      TEXT NOT NULL,
    nivel       TEXT NOT NULL,
    evento      TEXT NOT NULL,
    detalle     TEXT
);

-- ---------------------------------------------------------------------------
-- 4bis. ESQUEMA v2: SALIDAS DE LOS AGENTES ANALITICOS (Fase 2)
-- ---------------------------------------------------------------------------
-- Restricciones del horizonte de planificacion. Si no existen filas, el agente
-- prescriptivo las deriva del gasto historico y lo declara como SUPUESTO.
CREATE TABLE IF NOT EXISTS restricciones_periodo (
    periodo             TEXT NOT NULL,      -- AAAA-MM
    centro              TEXT NOT NULL DEFAULT 'CD01',
    presupuesto_compra  REAL CHECK (presupuesto_compra IS NULL OR presupuesto_compra >= 0),
    capacidad_almacen_m3 REAL CHECK (capacidad_almacen_m3 IS NULL OR capacidad_almacen_m3 > 0),
    capacidad_palets    REAL CHECK (capacidad_palets IS NULL OR capacidad_palets > 0),
    origen              TEXT NOT NULL DEFAULT 'SUPUESTO'
                        CHECK (origen IN ('APROBADO','SUPUESTO','IMPORTADO')),
    responsable         TEXT,
    fecha_aprobacion    TEXT,
    PRIMARY KEY (periodo, centro)
);

-- Serie mensual conciliada que alimenta el pronostico. Se materializa para que
-- el agente predictivo y el dashboard lean exactamente la misma base, y para
-- dejar constancia de que el mes parcial fue excluido.
CREATE TABLE IF NOT EXISTS demanda_mensual (
    id_corrida          TEXT NOT NULL REFERENCES ejecuciones(id_corrida) ON DELETE CASCADE,
    periodo             TEXT NOT NULL,
    sku                 TEXT NOT NULL REFERENCES maestro_materiales(sku) ON DELETE CASCADE,
    centro              TEXT NOT NULL DEFAULT 'CD01',
    unidades_atendidas  REAL NOT NULL CHECK (unidades_atendidas >= 0),
    unidades_perdidas   REAL NOT NULL DEFAULT 0 CHECK (unidades_perdidas >= 0),
    demanda_corregida   REAL NOT NULL CHECK (demanda_corregida >= 0),
    dias_censurados     INTEGER NOT NULL DEFAULT 0,
    dias_periodo        INTEGER NOT NULL CHECK (dias_periodo > 0),
    mes_completo        INTEGER NOT NULL DEFAULT 1 CHECK (mes_completo IN (0,1)),
    PRIMARY KEY (id_corrida, periodo, sku, centro)
);

-- Resultado de la validacion temporal. Una fila por SKU, modelo y corte.
CREATE TABLE IF NOT EXISTS validacion_modelos (
    id_corrida      TEXT NOT NULL REFERENCES ejecuciones(id_corrida) ON DELETE CASCADE,
    sku             TEXT NOT NULL,
    modelo          TEXT NOT NULL,
    tipo_corte      TEXT NOT NULL CHECK (tipo_corte IN ('CV','RESERVA_FINAL')),
    origen          INTEGER NOT NULL,       -- meses de entrenamiento en ese corte
    n_observaciones INTEGER NOT NULL CHECK (n_observaciones > 0),
    wape            REAL,
    mase            REAL,
    sesgo           REAL,
    rmse            REAL,
    cobertura       REAL CHECK (cobertura IS NULL OR cobertura BETWEEN 0 AND 1),
    es_referente    INTEGER NOT NULL DEFAULT 0 CHECK (es_referente IN (0,1)),
    seleccionado    INTEGER NOT NULL DEFAULT 0 CHECK (seleccionado IN (0,1)),
    motivo_decision TEXT,
    PRIMARY KEY (id_corrida, sku, modelo, tipo_corte, origen)
);

-- Pronostico publicado: mediana e intervalo por SKU, mes y escenario.
CREATE TABLE IF NOT EXISTS pronosticos (
    id_corrida      TEXT NOT NULL REFERENCES ejecuciones(id_corrida) ON DELETE CASCADE,
    sku             TEXT NOT NULL REFERENCES maestro_materiales(sku) ON DELETE CASCADE,
    centro          TEXT NOT NULL DEFAULT 'CD01',
    periodo         TEXT NOT NULL,
    horizonte       INTEGER NOT NULL CHECK (horizonte BETWEEN 1 AND 36),
    escenario       TEXT NOT NULL DEFAULT 'BASE',
    modelo          TEXT NOT NULL,
    p50             REAL NOT NULL CHECK (p50 >= 0),
    p10             REAL CHECK (p10 >= 0),
    p90             REAL CHECK (p90 >= 0),
    sigma_residual  REAL CHECK (sigma_residual >= 0),
    -- Un intervalo sin calibracion verificada no es un intervalo: es un adorno.
    intervalo_calibrado INTEGER NOT NULL DEFAULT 0 CHECK (intervalo_calibrado IN (0,1)),
    validado        INTEGER NOT NULL DEFAULT 0 CHECK (validado IN (0,1)),
    PRIMARY KEY (id_corrida, sku, centro, periodo, escenario),
    CHECK (p10 IS NULL OR p90 IS NULL OR p10 <= p90)
);

-- Canasta de compras: una fila por SKU, proveedor, mes y escenario.
CREATE TABLE IF NOT EXISTS canasta_compras (
    id_corrida              TEXT NOT NULL REFERENCES ejecuciones(id_corrida) ON DELETE CASCADE,
    escenario               TEXT NOT NULL DEFAULT 'BASE',
    sku                     TEXT NOT NULL REFERENCES maestro_materiales(sku) ON DELETE CASCADE,
    proveedor_id            TEXT NOT NULL REFERENCES maestro_proveedores(proveedor_id),
    centro                  TEXT NOT NULL DEFAULT 'CD01',
    periodo                 TEXT NOT NULL,
    horizonte               INTEGER NOT NULL CHECK (horizonte >= 1),
    -- Balance: inv_final = inv_inicial + recep_confirmada + compra - demanda
    demanda_plan            REAL NOT NULL CHECK (demanda_plan >= 0),
    inventario_inicial      REAL NOT NULL,
    recepcion_confirmada    REAL NOT NULL DEFAULT 0 CHECK (recepcion_confirmada >= 0),
    stock_seguridad         REAL NOT NULL DEFAULT 0 CHECK (stock_seguridad >= 0),
    necesidad_neta          REAL NOT NULL DEFAULT 0 CHECK (necesidad_neta >= 0),
    compra_propuesta        REAL NOT NULL DEFAULT 0 CHECK (compra_propuesta >= 0),
    inventario_final        REAL NOT NULL,
    faltante                REAL NOT NULL DEFAULT 0 CHECK (faltante >= 0),
    fecha_emision           TEXT,
    fecha_recepcion         TEXT,
    emision_vencida         INTEGER NOT NULL DEFAULT 0 CHECK (emision_vencida IN (0,1)),
    precio_unitario         REAL NOT NULL CHECK (precio_unitario > 0),
    moneda                  TEXT NOT NULL DEFAULT 'PEN',
    costo_compra            REAL NOT NULL CHECK (costo_compra >= 0),
    volumen_m3              REAL CHECK (volumen_m3 IS NULL OR volumen_m3 >= 0),
    metodo_lote             TEXT NOT NULL DEFAULT 'WAGNER_WHITIN',
    ajuste_presupuesto      INTEGER NOT NULL DEFAULT 0 CHECK (ajuste_presupuesto IN (0,1)),
    nivel_riesgo            TEXT CHECK (nivel_riesgo IN ('BAJO','MEDIO','ALTO','CRITICO')),
    estado                  TEXT NOT NULL DEFAULT 'PROPUESTA'
                            CHECK (estado IN ('PROPUESTA','OBSERVADA','APROBADA','EMITIDA')),
    aprobador               TEXT,
    PRIMARY KEY (id_corrida, escenario, sku, periodo)
);

-- Resultados agregados de la simulacion estocastica por escenario.
CREATE TABLE IF NOT EXISTS simulacion_resultados (
    id_corrida      TEXT NOT NULL REFERENCES ejecuciones(id_corrida) ON DELETE CASCADE,
    escenario       TEXT NOT NULL,
    metrica         TEXT NOT NULL,
    unidad          TEXT,
    n_iteraciones   INTEGER NOT NULL CHECK (n_iteraciones > 0),
    media           REAL,
    p05             REAL,
    p50             REAL,
    p95             REAL,
    minimo          REAL,
    maximo          REAL,
    PRIMARY KEY (id_corrida, escenario, metrica)
);

-- Hipotesis diagnosticas: se distingue OBSERVACION de HIPOTESIS.
CREATE TABLE IF NOT EXISTS hipotesis_diagnostico (
    id_hipotesis    INTEGER PRIMARY KEY AUTOINCREMENT,
    id_corrida      TEXT NOT NULL REFERENCES ejecuciones(id_corrida) ON DELETE CASCADE,
    ambito          TEXT NOT NULL,
    sku             TEXT,
    hallazgo        TEXT NOT NULL,
    naturaleza      TEXT NOT NULL CHECK (naturaleza IN ('OBSERVACION','HIPOTESIS','SUPUESTO')),
    impacto_valor   REAL,
    impacto_unidad  TEXT,
    evidencia       TEXT NOT NULL,
    accion_sugerida TEXT,
    responsable     TEXT,
    estado          TEXT NOT NULL DEFAULT 'ABIERTA'
                    CHECK (estado IN ('ABIERTA','ACEPTADA','RECHAZADA','EN_ANALISIS')),
    ts_registro     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 5. INDICES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_demanda_sku_fecha   ON historico_demanda(sku, fecha);
CREATE INDEX IF NOT EXISTS ix_demanda_fecha       ON historico_demanda(fecha);
CREATE INDEX IF NOT EXISTS ix_inv_sku_fecha       ON inventario_diario(sku, fecha);
CREATE INDEX IF NOT EXISTS ix_oc_sku              ON ordenes_compra(sku);
CREATE INDEX IF NOT EXISTS ix_oc_proveedor        ON ordenes_compra(proveedor_id);
CREATE INDEX IF NOT EXISTS ix_oc_emision          ON ordenes_compra(fecha_emision);
CREATE INDEX IF NOT EXISTS ix_oc_causa            ON ordenes_compra(causa_raiz_retraso);
CREATE INDEX IF NOT EXISTS ix_res_corrida_tipo    ON resultados_analisis(id_corrida, tipo_analisis);
CREATE INDEX IF NOT EXISTS ix_exc_corrida         ON excepciones_plan(id_corrida, severidad);
CREATE INDEX IF NOT EXISTS ix_pron_corrida_sku    ON pronosticos(id_corrida, sku, escenario);
CREATE INDEX IF NOT EXISTS ix_canasta_periodo     ON canasta_compras(id_corrida, escenario, periodo);
CREATE INDEX IF NOT EXISTS ix_valida_sku          ON validacion_modelos(id_corrida, sku);
CREATE INDEX IF NOT EXISTS ix_demmes_corrida      ON demanda_mensual(id_corrida, sku);

-- ---------------------------------------------------------------------------
-- 6. VISTAS DE METRICAS (soportan el dashboard en tiempo real)
-- ---------------------------------------------------------------------------
-- Demanda mensual conciliada: separa lo observado de lo corregido por censura.
DROP VIEW IF EXISTS v_demanda_mensual;
CREATE VIEW v_demanda_mensual AS
SELECT  substr(d.fecha,1,7)                             AS periodo,
        d.sku,
        d.centro,
        m.categoria,
        m.clase_abc,
        SUM(d.demanda_atendida)                         AS unidades_atendidas,
        SUM(COALESCE(d.demanda_perdida_estimada,0))     AS unidades_perdidas_est,
        SUM(d.demanda_atendida + COALESCE(d.demanda_perdida_estimada,0))
                                                        AS demanda_corregida,
        SUM(d.demanda_atendida * COALESCE(d.precio_neto, m.costo_unitario))
                                                        AS venta_valorizada,
        SUM(CASE WHEN d.flag_censura = 1 THEN 1 ELSE 0 END) AS dias_censurados
FROM    historico_demanda d
JOIN    maestro_materiales m ON m.sku = d.sku
GROUP BY periodo, d.sku, d.centro, m.categoria, m.clase_abc;

-- OTIF por proveedor: entregas completas Y a tiempo sobre entregas evaluadas.
DROP VIEW IF EXISTS v_otif_proveedor;
CREATE VIEW v_otif_proveedor AS
SELECT  o.proveedor_id,
        p.razon_social,
        COUNT(*)                                            AS entregas_evaluadas,
        SUM(CASE WHEN o.fecha_real_recepcion <= o.fecha_prometida
                  AND o.cantidad_recibida >= o.cantidad_solicitada
                 THEN 1 ELSE 0 END)                         AS entregas_otif,
        ROUND(1.0 * SUM(CASE WHEN o.fecha_real_recepcion <= o.fecha_prometida
                              AND o.cantidad_recibida >= o.cantidad_solicitada
                             THEN 1 ELSE 0 END) / COUNT(*), 4) AS otif,
        ROUND(AVG(o.dias_retraso_total), 2)                 AS retraso_medio_dias,
        ROUND(AVG(o.dias_retraso_aprobacion), 2)            AS retraso_medio_interno,
        ROUND(AVG(o.dias_retraso_proveedor), 2)             AS retraso_medio_externo
FROM    ordenes_compra o
JOIN    maestro_proveedores p ON p.proveedor_id = o.proveedor_id
WHERE   o.estado_orden IN ('RECIBIDA_TOTAL','RECIBIDA_PARCIAL')
GROUP BY o.proveedor_id, p.razon_social;

-- Atribucion de causa raiz del retraso: insumo directo del agente diagnostico.
DROP VIEW IF EXISTS v_causa_raiz_retrasos;
CREATE VIEW v_causa_raiz_retrasos AS
SELECT  causa_raiz_retraso,
        COUNT(*)                                AS n_ordenes,
        ROUND(AVG(dias_retraso_total), 2)       AS retraso_medio,
        ROUND(SUM(dias_retraso_total), 1)       AS dias_retraso_acumulados,
        ROUND(SUM(costo_total), 2)              AS valor_comprometido
FROM    ordenes_compra
WHERE   estado_orden <> 'CANCELADA'
GROUP BY causa_raiz_retraso;

-- Fill rate y quiebres por SKU-mes.
DROP VIEW IF EXISTS v_nivel_servicio;
CREATE VIEW v_nivel_servicio AS
SELECT  substr(d.fecha,1,7)                     AS periodo,
        d.sku,
        SUM(d.demanda_atendida)                 AS atendido,
        SUM(d.demanda_atendida + COALESCE(d.demanda_perdida_estimada,0)) AS demandado,
        ROUND(1.0 * SUM(d.demanda_atendida) /
              NULLIF(SUM(d.demanda_atendida + COALESCE(d.demanda_perdida_estimada,0)),0), 4)
                                                AS fill_rate,
        SUM(CASE WHEN i.quiebre_flag = 1 THEN 1 ELSE 0 END) AS dias_quiebre
FROM    historico_demanda d
LEFT JOIN inventario_diario i ON i.fecha = d.fecha AND i.sku = d.sku AND i.centro = d.centro
GROUP BY periodo, d.sku;
