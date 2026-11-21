// Esquema físico SQLite (modelo lógico §6 con decisiones DEC-I01-D2/D3/D7).
// Convenciones: cantidades en unidad base × 1000 (q_mil, enteros); importes en céntimos (cent);
// precios unitarios en diezmilésimas de sol (p4); volúmenes en cm³ por unidad; instantes ISO con zona.
export const SCHEMA_VERSION = 7;

/** Esquema v2 completo (bases nuevas). Las bases v1 de la prueba I02 se migran (ver migraciones.ts). */
export const DDL_V2 = `
CREATE TABLE IF NOT EXISTS meta (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS migracion (version INTEGER PRIMARY KEY, aplicada_en TEXT NOT NULL, detalle TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS usuario (
  usuario_id TEXT PRIMARY KEY, nombre_ficticio TEXT NOT NULL, activo INTEGER NOT NULL CHECK (activo IN (0,1)),
  compartida INTEGER NOT NULL DEFAULT 0 CHECK (compartida IN (0,1)), desactivado_en TEXT, motivo_desactivacion TEXT);
CREATE TABLE IF NOT EXISTS rol_asignacion (
  asignacion_id TEXT PRIMARY KEY, usuario_id TEXT NOT NULL REFERENCES usuario(usuario_id),
  rol TEXT NOT NULL CHECK (rol IN ('ADMINISTRADOR','RESPONSABLE_DATOS','ENCARGADO_PEDIDOS','ENCARGADO_ALMACEN','PLANIFICADOR','SUPERVISOR','ANALISTA','SOPORTE')),
  vigente_desde TEXT NOT NULL, vigente_hasta TEXT, otorgado_por TEXT, registrado_en TEXT NOT NULL,
  CHECK (vigente_hasta IS NULL OR vigente_hasta > vigente_desde));
CREATE TABLE IF NOT EXISTS parametro (
  clave TEXT NOT NULL, version INTEGER NOT NULL, tipo TEXT NOT NULL, valor TEXT NOT NULL, unidad TEXT NOT NULL,
  vigente_desde TEXT NOT NULL, autor TEXT NOT NULL, registrado_en TEXT NOT NULL, motivo TEXT NOT NULL, PRIMARY KEY (clave, version));
CREATE TABLE IF NOT EXISTS producto (
  producto_id TEXT PRIMARY KEY, nombre_generico TEXT NOT NULL, familia TEXT NOT NULL,
  unidad_base TEXT NOT NULL CHECK (unidad_base IN ('kg','unidad')),
  peso_kg_por_unidad_mil INTEGER NOT NULL CHECK (peso_kg_por_unidad_mil > 0),
  vol_cm3_por_unidad INTEGER NOT NULL CHECK (vol_cm3_por_unidad > 0),
  fraccionable INTEGER NOT NULL CHECK (fraccionable IN (0,1)),
  activo INTEGER NOT NULL CHECK (activo IN (0,1)), revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS presentacion (
  presentacion_id TEXT PRIMARY KEY, producto_id TEXT NOT NULL REFERENCES producto(producto_id), nombre TEXT NOT NULL,
  factor_base_mil INTEGER NOT NULL CHECK (factor_base_mil > 0), activo INTEGER NOT NULL CHECK (activo IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1, UNIQUE (producto_id, nombre));
CREATE TABLE IF NOT EXISTS cliente (cliente_id TEXT PRIMARY KEY, nombre_ficticio TEXT NOT NULL, activo INTEGER NOT NULL CHECK (activo IN (0,1)), revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS nodo (
  nodo_id TEXT PRIMARY KEY, nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('ALMACEN','TRANSITO','TRANSBORDO','DESTINO')),
  region TEXT NOT NULL, capacidad_almacen_kg_mil INTEGER CHECK (capacidad_almacen_kg_mil IS NULL OR capacidad_almacen_kg_mil >= 0),
  permite_espera_nocturna INTEGER NOT NULL DEFAULT 0 CHECK (permite_espera_nocturna IN (0,1)), alias_legado TEXT UNIQUE,
  activo INTEGER NOT NULL CHECK (activo IN (0,1)), revision INTEGER NOT NULL DEFAULT 1, fuente_dato TEXT NOT NULL DEFAULT 'SINTETICO',
  manipulacion_min INTEGER NOT NULL DEFAULT 30 CHECK (manipulacion_min >= 0), abre TEXT NOT NULL DEFAULT '00:00', cierra TEXT NOT NULL DEFAULT '23:59');
CREATE TABLE IF NOT EXISTS destino (
  destino_id TEXT PRIMARY KEY, cliente_id TEXT NOT NULL REFERENCES cliente(cliente_id), nombre_ficticio TEXT NOT NULL,
  region TEXT NOT NULL, codigo_territorial TEXT, catalogo_territorial TEXT, version_catalogo TEXT,
  latitud REAL CHECK (latitud IS NULL OR (latitud BETWEEN -90 AND 90)), longitud REAL CHECK (longitud IS NULL OR (longitud BETWEEN -180 AND 180)),
  precision_geografica TEXT NOT NULL CHECK (precision_geografica IN ('EXACTA','APROXIMADA','CENTROIDE','DESCONOCIDA')),
  nodo_id TEXT NOT NULL REFERENCES nodo(nodo_id), acepta_anticipadas INTEGER NOT NULL CHECK (acepta_anticipadas IN (0,1)),
  vida_util_min_dias INTEGER NOT NULL CHECK (vida_util_min_dias >= 0), activo INTEGER NOT NULL CHECK (activo IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1,
  CHECK ((latitud IS NULL) = (longitud IS NULL)),
  CHECK (codigo_territorial IS NULL OR catalogo_territorial IS NOT NULL));
CREATE TABLE IF NOT EXISTS destino_alias (destino_id TEXT NOT NULL REFERENCES destino(destino_id), codigo_anterior TEXT NOT NULL, catalogo_territorial TEXT NOT NULL,
  version_catalogo TEXT, vigente_hasta TEXT NOT NULL, motivo TEXT NOT NULL, PRIMARY KEY (destino_id, codigo_anterior, catalogo_territorial));
CREATE TABLE IF NOT EXISTS limite_region (region TEXT PRIMARY KEY, lat_min REAL NOT NULL, lat_max REAL NOT NULL, lon_min REAL NOT NULL, lon_max REAL NOT NULL, fuente TEXT NOT NULL,
  CHECK (lat_min < lat_max AND lon_min < lon_max));
CREATE TABLE IF NOT EXISTS lote (
  lote_id TEXT PRIMARY KEY, producto_id TEXT NOT NULL REFERENCES producto(producto_id), codigo_lote TEXT NOT NULL,
  fecha_fabricacion TEXT NOT NULL, fecha_vencimiento TEXT NOT NULL,
  estado_lote TEXT NOT NULL CHECK (estado_lote IN ('LIBERADO','BLOQUEADO')),
  UNIQUE (producto_id, codigo_lote), CHECK (fecha_vencimiento >= fecha_fabricacion));
CREATE TABLE IF NOT EXISTS movimiento (
  movimiento_id TEXT PRIMARY KEY, lote_id TEXT NOT NULL REFERENCES lote(lote_id),
  nodo_origen_id TEXT REFERENCES nodo(nodo_id), nodo_destino_id TEXT REFERENCES nodo(nodo_id),
  condicion TEXT NOT NULL CHECK (condicion IN ('APTO','CUARENTENA','DANADO')),
  q_mil INTEGER NOT NULL CHECK (q_mil > 0), ocurrido_en TEXT NOT NULL, registrado_en TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('SALDO_APERTURA','TRASLADO_SALIDA','TRASLADO_RECEPCION','AJUSTE_POSITIVO','AJUSTE_NEGATIVO','DESPACHO','RECEPCION','ENTREGA_FISICA','ACEPTACION','DEVOLUCION','RETORNO','PERDIDA','RECLASIFICACION')),
  transfer_id TEXT, motivo TEXT, usuario_id TEXT, command_id TEXT NOT NULL,
  CHECK (nodo_origen_id IS NOT NULL OR nodo_destino_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS ix_mov_lote ON movimiento(lote_id);
CREATE INDEX IF NOT EXISTS ix_mov_transfer ON movimiento(transfer_id);
CREATE TABLE IF NOT EXISTS pedido (
  pedido_id TEXT PRIMARY KEY, cliente_id TEXT NOT NULL REFERENCES cliente(cliente_id), destino_id TEXT NOT NULL REFERENCES destino(destino_id),
  fecha_pedido TEXT NOT NULL, ventana_inicio TEXT NOT NULL, ventana_fin TEXT NOT NULL,
  ventana_rep_inicio TEXT, ventana_rep_fin TEXT,
  prioridad TEXT NOT NULL CHECK (prioridad IN ('NORMAL','URGENTE')),
  permite_parcial INTEGER NOT NULL CHECK (permite_parcial IN (0,1)),
  permite_entregas_divididas INTEGER NOT NULL CHECK (permite_entregas_divididas IN (0,1)),
  estado_base TEXT NOT NULL CHECK (estado_base IN ('BORRADOR','CONFIRMADO','CANCELADO')),
  confirmado_en TEXT, cancelado_en TEXT, motivo_cancelacion TEXT,
  responsable_id TEXT REFERENCES usuario(usuario_id), snapshot_destino TEXT, revision INTEGER NOT NULL DEFAULT 1,
  CHECK (ventana_fin > ventana_inicio));
CREATE TABLE IF NOT EXISTS pedido_linea (
  pedido_linea_id TEXT PRIMARY KEY, pedido_id TEXT NOT NULL REFERENCES pedido(pedido_id),
  producto_id TEXT NOT NULL REFERENCES producto(producto_id), presentacion_id TEXT NOT NULL REFERENCES presentacion(presentacion_id),
  cantidad_presentacion_mil INTEGER NOT NULL CHECK (cantidad_presentacion_mil > 0), factor_snapshot_mil INTEGER NOT NULL CHECK (factor_snapshot_mil > 0),
  q_solicitada_mil INTEGER NOT NULL CHECK (q_solicitada_mil > 0), precio_neto_base_p4 INTEGER NOT NULL CHECK (precio_neto_base_p4 >= 0),
  importe_cent INTEGER NOT NULL CHECK (importe_cent >= 0), q_cancelada_mil INTEGER NOT NULL DEFAULT 0 CHECK (q_cancelada_mil >= 0),
  nombre_producto_snapshot TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reserva (
  reserva_id TEXT PRIMARY KEY, pedido_linea_id TEXT NOT NULL REFERENCES pedido_linea(pedido_linea_id),
  lote_id TEXT NOT NULL REFERENCES lote(lote_id), nodo_id TEXT NOT NULL REFERENCES nodo(nodo_id),
  q_mil INTEGER NOT NULL CHECK (q_mil > 0), estado TEXT NOT NULL CHECK (estado IN ('ACTIVA','CONSUMIDA','LIBERADA')),
  creada_en TEXT NOT NULL, liberada_en TEXT, motivo_liberacion TEXT, command_id TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_res_linea ON reserva(pedido_linea_id, estado);
CREATE TABLE IF NOT EXISTS suministro_esperado (
  suministro_id TEXT PRIMARY KEY, producto_id TEXT NOT NULL REFERENCES producto(producto_id), lote_id TEXT REFERENCES lote(lote_id),
  nodo_destino_id TEXT NOT NULL REFERENCES nodo(nodo_id), q_mil INTEGER NOT NULL CHECK (q_mil > 0), fecha_prevista TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('NO_CONFIRMADO','CONFIRMADO','RECIBIDO','RETRASADO','CANCELADO')),
  transfer_id TEXT UNIQUE, revision INTEGER NOT NULL DEFAULT 1, actualizado_en TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS propuesta_entrega (
  propuesta_id TEXT PRIMARY KEY, pedido_id TEXT NOT NULL REFERENCES pedido(pedido_id), version INTEGER NOT NULL,
  fecha_propuesta TEXT NOT NULL, estimacion_plazo_fijo TEXT, inicio TEXT NOT NULL, vence TEXT NOT NULL,
  condicionada INTEGER NOT NULL CHECK (condicionada IN (0,1)), dependencias TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('PROPUESTA','ACEPTADA','EXPIRADA','INVALIDADA')),
  motivo_estado TEXT, creada_en TEXT NOT NULL, resuelta_en TEXT, CHECK (vence > inicio), UNIQUE (pedido_id, version));
CREATE TABLE IF NOT EXISTS compromiso_futuro (
  compromiso_id TEXT PRIMARY KEY, pedido_linea_id TEXT NOT NULL REFERENCES pedido_linea(pedido_linea_id),
  producto_id TEXT NOT NULL REFERENCES producto(producto_id), nodo_id TEXT NOT NULL REFERENCES nodo(nodo_id),
  suministro_id TEXT REFERENCES suministro_esperado(suministro_id), propuesta_id TEXT REFERENCES propuesta_entrega(propuesta_id),
  q_mil INTEGER NOT NULL CHECK (q_mil > 0), fecha_compromiso TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('TEMPORAL','FIRME')),
  estado TEXT NOT NULL CHECK (estado IN ('ACTIVO','LIBERADO','CONSUMIDO')), creado_en TEXT NOT NULL, resuelto_en TEXT);
CREATE TABLE IF NOT EXISTS solicitud_ajuste (
  ajuste_id TEXT PRIMARY KEY, lote_id TEXT NOT NULL REFERENCES lote(lote_id), nodo_id TEXT NOT NULL REFERENCES nodo(nodo_id),
  condicion TEXT NOT NULL, q_delta_mil INTEGER NOT NULL CHECK (q_delta_mil <> 0), motivo TEXT NOT NULL CHECK (length(trim(motivo)) >= 5),
  solicitado_por TEXT NOT NULL REFERENCES usuario(usuario_id), solicitado_en TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('PENDIENTE','APROBADO','RECHAZADO')),
  resuelto_por TEXT REFERENCES usuario(usuario_id), resuelto_en TEXT, comentario_resolucion TEXT);
CREATE TABLE IF NOT EXISTS tarifa (
  tarifa_id TEXT NOT NULL, version INTEGER NOT NULL, modo TEXT NOT NULL, base_fija_cent INTEGER NOT NULL CHECK (base_fija_cent >= 0),
  costo_kg_p4 INTEGER NOT NULL CHECK (costo_kg_p4 >= 0), minimo_cent INTEGER NOT NULL DEFAULT 0 CHECK (minimo_cent >= 0),
  moneda TEXT NOT NULL DEFAULT 'PEN', vigente_desde TEXT NOT NULL, vigente_hasta TEXT, registrado_en TEXT NOT NULL,
  PRIMARY KEY (tarifa_id, version), CHECK (vigente_hasta IS NULL OR vigente_hasta > vigente_desde));
CREATE TABLE IF NOT EXISTS maestro_historial (
  historial_id INTEGER PRIMARY KEY AUTOINCREMENT, entidad TEXT NOT NULL, entidad_id TEXT NOT NULL, revision INTEGER NOT NULL,
  antes TEXT, despues TEXT NOT NULL, usuario_id TEXT NOT NULL, registrado_en TEXT NOT NULL, motivo TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS comando (command_id TEXT PRIMARY KEY, tipo TEXT NOT NULL, aplicado_en TEXT NOT NULL, resultado TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS carga (carga_id TEXT PRIMARY KEY, file_hash TEXT NOT NULL, nombre_archivo TEXT NOT NULL, bytes INTEGER NOT NULL,
  registrado_en TEXT NOT NULL, resultado TEXT NOT NULL, dataset_id TEXT, usuario_id TEXT);
CREATE TABLE IF NOT EXISTS auditoria (evento_id INTEGER PRIMARY KEY AUTOINCREMENT, registrado_en TEXT NOT NULL, usuario_id TEXT NOT NULL, roles TEXT NOT NULL,
  accion TEXT NOT NULL, command_id TEXT, detalle TEXT NOT NULL);
`;

/** Tablas de transporte multimodal, ejecución y custodia añadidas en v3 (I04). */
export const DDL_V3_TRANSPORTE = `
CREATE TABLE IF NOT EXISTS modo_transporte (modo_id TEXT PRIMARY KEY, nombre TEXT NOT NULL, activo INTEGER NOT NULL CHECK (activo IN (0,1)), requiere_habilitacion INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS recurso (
  recurso_id TEXT PRIMARY KEY, nombre TEXT NOT NULL, modo_id TEXT NOT NULL REFERENCES modo_transporte(modo_id), operador TEXT NOT NULL,
  capacidad_kg_mil INTEGER NOT NULL CHECK (capacidad_kg_mil > 0), capacidad_dm3 INTEGER NOT NULL CHECK (capacidad_dm3 > 0),
  max_bulto_kg_mil INTEGER CHECK (max_bulto_kg_mil IS NULL OR max_bulto_kg_mil > 0), activo INTEGER NOT NULL CHECK (activo IN (0,1)));
CREATE TABLE IF NOT EXISTS enlace (
  enlace_id TEXT PRIMARY KEY, nodo_origen_id TEXT NOT NULL REFERENCES nodo(nodo_id), nodo_destino_id TEXT NOT NULL REFERENCES nodo(nodo_id),
  modo_id TEXT NOT NULL REFERENCES modo_transporte(modo_id), distancia_km_mil INTEGER NOT NULL CHECK (distancia_km_mil >= 0),
  duracion_min INTEGER NOT NULL CHECK (duracion_min > 0), min_min INTEGER NOT NULL, moda_min INTEGER NOT NULL, max_min INTEGER NOT NULL,
  prob_incidencia_ppm INTEGER NOT NULL DEFAULT 0 CHECK (prob_incidencia_ppm BETWEEN 0 AND 1000000), retraso_incidencia_min INTEGER NOT NULL DEFAULT 0,
  corredor_id TEXT, max_kg_recurso_mil INTEGER, estado_acceso TEXT NOT NULL CHECK (estado_acceso IN ('NORMAL','RESTRINGIDO','INTERRUMPIDO','DESCONOCIDO')),
  fuente TEXT NOT NULL, activo INTEGER NOT NULL DEFAULT 1, CHECK (nodo_origen_id <> nodo_destino_id), CHECK (min_min > 0 AND min_min <= moda_min AND moda_min <= max_min));
CREATE TABLE IF NOT EXISTS condicion_acceso (
  condicion_id TEXT PRIMARY KEY, enlace_id TEXT NOT NULL REFERENCES enlace(enlace_id), estado TEXT NOT NULL CHECK (estado IN ('NORMAL','RESTRINGIDO','INTERRUMPIDO','DESCONOCIDO')),
  motivo TEXT NOT NULL, vigente_desde TEXT NOT NULL, vigente_hasta TEXT NOT NULL, registrado_en TEXT NOT NULL, fuente TEXT NOT NULL, usuario_id TEXT,
  CHECK (vigente_hasta > vigente_desde));
CREATE TABLE IF NOT EXISTS servicio (
  servicio_id TEXT PRIMARY KEY, enlace_id TEXT NOT NULL REFERENCES enlace(enlace_id), recurso_id TEXT NOT NULL REFERENCES recurso(recurso_id),
  salida TEXT NOT NULL, llegada TEXT NOT NULL, tarifa_fija_cent INTEGER NOT NULL CHECK (tarifa_fija_cent >= 0), costo_kg_p4 INTEGER NOT NULL CHECK (costo_kg_p4 >= 0),
  estado TEXT NOT NULL CHECK (estado IN ('PROGRAMADO','CANCELADO','EN_CURSO','FINALIZADO')), salida_real TEXT, llegada_real TEXT, CHECK (llegada > salida));
CREATE INDEX IF NOT EXISTS ix_servicio_enlace ON servicio(enlace_id, salida);
CREATE TABLE IF NOT EXISTS compatibilidad (producto_id TEXT NOT NULL REFERENCES producto(producto_id), modo_id TEXT NOT NULL REFERENCES modo_transporte(modo_id),
  permitido INTEGER NOT NULL CHECK (permitido IN (0,1)), motivo TEXT NOT NULL, PRIMARY KEY (producto_id, modo_id));
CREATE TABLE IF NOT EXISTS receptor_autorizado (receptor_id TEXT PRIMARY KEY, destino_id TEXT NOT NULL REFERENCES destino(destino_id), nombre_ficticio TEXT NOT NULL,
  vigente_desde TEXT NOT NULL, vigente_hasta TEXT, revocado_en TEXT);
CREATE TABLE IF NOT EXISTS itinerario (
  itinerario_id TEXT PRIMARY KEY, pedido_id TEXT NOT NULL REFERENCES pedido(pedido_id), nodo_origen_id TEXT NOT NULL REFERENCES nodo(nodo_id), version INTEGER NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('CONFIRMADO','EN_EJECUCION','COMPLETADO','CANCELADO','REEMPLAZADO')),
  ruta TEXT NOT NULL, salida_prevista TEXT NOT NULL, llegada_prevista TEXT NOT NULL, entrega_prevista TEXT NOT NULL,
  costo_estimado_cent INTEGER NOT NULL, criterio TEXT NOT NULL, creado_en TEXT NOT NULL, usuario_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS etapa (
  etapa_id TEXT PRIMARY KEY, itinerario_id TEXT NOT NULL REFERENCES itinerario(itinerario_id), tramo INTEGER NOT NULL, viaje INTEGER NOT NULL,
  servicio_id TEXT NOT NULL REFERENCES servicio(servicio_id), nodo_origen_id TEXT NOT NULL REFERENCES nodo(nodo_id), nodo_destino_id TEXT NOT NULL REFERENCES nodo(nodo_id),
  kg_bruto_mil INTEGER NOT NULL, dm3 INTEGER NOT NULL, bultos INTEGER NOT NULL, final INTEGER NOT NULL CHECK (final IN (0,1)),
  estado TEXT NOT NULL CHECK (estado IN ('PLANIFICADA','DESPACHADA','RECIBIDA','ENTREGADA','CANCELADA')),
  despachada_en TEXT, recibida_en TEXT, UNIQUE (itinerario_id, tramo, viaje));
CREATE TABLE IF NOT EXISTS etapa_carga (etapa_id TEXT NOT NULL REFERENCES etapa(etapa_id), pedido_linea_id TEXT NOT NULL REFERENCES pedido_linea(pedido_linea_id),
  lote_id TEXT NOT NULL REFERENCES lote(lote_id), q_mil INTEGER NOT NULL CHECK (q_mil > 0), PRIMARY KEY (etapa_id, pedido_linea_id, lote_id));
CREATE TABLE IF NOT EXISTS transferencia (
  transferencia_id TEXT PRIMARY KEY, etapa_id TEXT NOT NULL REFERENCES etapa(etapa_id), nodo_id TEXT NOT NULL REFERENCES nodo(nodo_id),
  emisor TEXT NOT NULL, receptor TEXT NOT NULL, q_enviada_mil INTEGER NOT NULL, q_apta_mil INTEGER NOT NULL, q_cuarentena_mil INTEGER NOT NULL, q_danada_mil INTEGER NOT NULL,
  q_diferencia_mil INTEGER NOT NULL, ocurrido_en TEXT NOT NULL, registrado_en TEXT NOT NULL, evidencia TEXT, command_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS entrega (
  entrega_id TEXT PRIMARY KEY, pedido_id TEXT NOT NULL REFERENCES pedido(pedido_id), etapa_id TEXT NOT NULL REFERENCES etapa(etapa_id), intento INTEGER NOT NULL,
  ocurrido_en TEXT NOT NULL, registrado_en TEXT NOT NULL, receptor_nombre TEXT, receptor_id TEXT REFERENCES receptor_autorizado(receptor_id),
  metodo_evidencia TEXT, evidencia_ref TEXT, motivo TEXT,
  estado TEXT NOT NULL CHECK (estado IN ('TOTAL','PARCIAL','FALLIDO','EN_VERIFICACION')), verificada_en TEXT, verificada_por TEXT, command_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS entrega_detalle (entrega_id TEXT NOT NULL REFERENCES entrega(entrega_id), pedido_linea_id TEXT NOT NULL REFERENCES pedido_linea(pedido_linea_id),
  lote_id TEXT NOT NULL REFERENCES lote(lote_id), aceptado_mil INTEGER NOT NULL DEFAULT 0, rechazado_mil INTEGER NOT NULL DEFAULT 0, en_verificacion_mil INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (entrega_id, pedido_linea_id, lote_id));
CREATE TABLE IF NOT EXISTS lectura_clima (
  lectura_id TEXT PRIMARY KEY, referencia TEXT NOT NULL, latitud REAL NOT NULL, longitud REAL NOT NULL, observado_en TEXT, consultado_en TEXT NOT NULL,
  vigente_hasta TEXT NOT NULL, temperatura_c REAL, precipitacion_mm REAL, viento_kmh REAL, texto TEXT NOT NULL, fuente TEXT NOT NULL, resultado TEXT NOT NULL);
`;

/** v4 (I04-b): incidencias, retornos/devoluciones, calidad y retiro de lotes, conteos, alertas, cargos reales, transbordos y envases retornables. Solo agrega tablas y columnas. */
export const DDL_V4_OPERACION = `
ALTER TABLE itinerario ADD COLUMN origen_tipo TEXT NOT NULL DEFAULT 'RESERVA';
ALTER TABLE itinerario ADD COLUMN reemplaza_a TEXT;
CREATE TABLE IF NOT EXISTS regla_transbordo (
  regla_id TEXT PRIMARY KEY, nodo_id TEXT NOT NULL REFERENCES nodo(nodo_id), modo_entrada_id TEXT NOT NULL REFERENCES modo_transporte(modo_id),
  modo_salida_id TEXT NOT NULL REFERENCES modo_transporte(modo_id), duracion_min INTEGER NOT NULL CHECK (duracion_min >= 0),
  costo_fijo_cent INTEGER NOT NULL CHECK (costo_fijo_cent >= 0), costo_kg_p4 INTEGER NOT NULL DEFAULT 0 CHECK (costo_kg_p4 >= 0),
  fraccionamiento_permitido INTEGER NOT NULL DEFAULT 1, UNIQUE (nodo_id, modo_entrada_id, modo_salida_id));
CREATE TABLE IF NOT EXISTS incidencia (
  incidencia_id TEXT PRIMARY KEY, tipo TEXT NOT NULL CHECK (tipo IN ('AVERIA','DETENCION','PERDIDA','DANO','RETRASO','SOBRECOSTO','OTRO')),
  etapa_id TEXT REFERENCES etapa(etapa_id), servicio_id TEXT REFERENCES servicio(servicio_id), lote_id TEXT REFERENCES lote(lote_id), q_mil INTEGER NOT NULL DEFAULT 0,
  retraso_min INTEGER NOT NULL DEFAULT 0, costo_cent INTEGER NOT NULL DEFAULT 0, ubicacion TEXT, custodio TEXT, descripcion TEXT NOT NULL,
  ocurrido_en TEXT NOT NULL, registrado_en TEXT NOT NULL, estado TEXT NOT NULL CHECK (estado IN ('ABIERTA','CERRADA')), cerrada_en TEXT, resolucion TEXT,
  usuario_id TEXT NOT NULL, command_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS retorno (
  retorno_id TEXT PRIMARY KEY, tipo TEXT NOT NULL CHECK (tipo IN ('RECHAZO','NO_ENTREGADO','DEVOLUCION_REPOSICION','DEVOLUCION_ANULACION')),
  etapa_id TEXT REFERENCES etapa(etapa_id), pedido_linea_id TEXT REFERENCES pedido_linea(pedido_linea_id), lote_id TEXT NOT NULL REFERENCES lote(lote_id),
  q_mil INTEGER NOT NULL CHECK (q_mil > 0), nodo_destino_id TEXT NOT NULL REFERENCES nodo(nodo_id), condicion TEXT NOT NULL CHECK (condicion IN ('CUARENTENA','DANADO')),
  motivo TEXT NOT NULL, estado TEXT NOT NULL CHECK (estado IN ('ANUNCIADO','RECIBIDO')), anunciado_en TEXT NOT NULL, recibido_en TEXT, documento TEXT,
  usuario_id TEXT NOT NULL, command_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS decision_calidad (
  decision_id TEXT PRIMARY KEY, lote_id TEXT NOT NULL REFERENCES lote(lote_id), nodo_id TEXT NOT NULL REFERENCES nodo(nodo_id), q_mil INTEGER NOT NULL CHECK (q_mil > 0),
  desde TEXT NOT NULL, hacia TEXT NOT NULL CHECK (hacia IN ('APTO','DANADO','BAJA')), evidencia TEXT NOT NULL, bloqueo_id TEXT,
  decidido_en TEXT NOT NULL, usuario_id TEXT NOT NULL, command_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bloqueo_lote (
  bloqueo_id TEXT PRIMARY KEY, lote_id TEXT NOT NULL REFERENCES lote(lote_id), motivo TEXT NOT NULL, efecto_desde TEXT NOT NULL, registrado_en TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('ACTIVO','CERRADO')), cerrado_en TEXT, cierre TEXT, usuario_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS conteo (
  conteo_id TEXT PRIMARY KEY, nodo_id TEXT NOT NULL REFERENCES nodo(nodo_id), lote_id TEXT NOT NULL REFERENCES lote(lote_id), condicion TEXT NOT NULL,
  corte TEXT NOT NULL, contado_mil INTEGER NOT NULL CHECK (contado_mil >= 0), sistema_mil INTEGER NOT NULL, diferencia_mil INTEGER NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('SIN_DIFERENCIA','PENDIENTE','RECUENTO','AJUSTE_SOLICITADO','RESUELTO')), recuento_de TEXT, solicitud_id TEXT,
  registrado_por TEXT NOT NULL, registrado_en TEXT NOT NULL, resolucion TEXT);
CREATE TABLE IF NOT EXISTS alerta (
  alerta_id TEXT PRIMARY KEY, regla TEXT NOT NULL, clave TEXT NOT NULL, entidad TEXT NOT NULL, entidad_id TEXT NOT NULL, grupo TEXT NOT NULL,
  severidad TEXT NOT NULL CHECK (severidad IN ('ALTA','MEDIA','BAJA')), mensaje TEXT NOT NULL, umbral TEXT, version_parametro INTEGER,
  estado TEXT NOT NULL CHECK (estado IN ('ABIERTA','RECONOCIDA','SILENCIADA','RESUELTA','DESCARTADA')),
  responsable_id TEXT, creada_en TEXT NOT NULL, plazo TEXT NOT NULL, escalada INTEGER NOT NULL DEFAULT 0, silencio_hasta TEXT, motivo TEXT,
  episodio INTEGER NOT NULL DEFAULT 1, anterior_id TEXT, cerrada_en TEXT, cerrada_por TEXT);
CREATE INDEX IF NOT EXISTS ix_alerta_clave ON alerta(clave, estado);
CREATE TABLE IF NOT EXISTS alerta_historial (alerta_id TEXT NOT NULL REFERENCES alerta(alerta_id), en TEXT NOT NULL, usuario_id TEXT, de TEXT, a TEXT NOT NULL, motivo TEXT);
CREATE TABLE IF NOT EXISTS cargo_transporte (
  cargo_id TEXT PRIMARY KEY, documento_ref TEXT NOT NULL, concepto TEXT NOT NULL CHECK (concepto IN ('FLETE','ESPERA','MANIPULACION','TRANSBORDO','PEAJE','RECARGO','PENALIDAD','OTRO')),
  servicio_id TEXT REFERENCES servicio(servicio_id), etapa_id TEXT REFERENCES etapa(etapa_id), importe_cent INTEGER NOT NULL CHECK (importe_cent >= 0),
  moneda TEXT NOT NULL DEFAULT 'PEN', tasa_pen_p6 INTEGER NOT NULL DEFAULT 1000000, importe_pen_cent INTEGER NOT NULL, incluido_en_tarifa INTEGER NOT NULL DEFAULT 0,
  no_reembolsable INTEGER NOT NULL DEFAULT 0, ocurrido_en TEXT NOT NULL, registrado_en TEXT NOT NULL, archivo_hash TEXT, usuario_id TEXT NOT NULL,
  UNIQUE (documento_ref, concepto, servicio_id));
CREATE TABLE IF NOT EXISTS activo_retornable (
  activo_id TEXT PRIMARY KEY, tipo TEXT NOT NULL, propietario TEXT NOT NULL, tara_kg_mil INTEGER NOT NULL DEFAULT 0, dm3 INTEGER NOT NULL DEFAULT 0,
  condicion TEXT NOT NULL CHECK (condicion IN ('DISPONIBLE','REVISION','DANADO','BAJA')),
  ubicacion_tipo TEXT NOT NULL CHECK (ubicacion_tipo IN ('NODO','CLIENTE','TRANSITO')), ubicacion_id TEXT NOT NULL, actualizado_en TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS movimiento_activo (
  mov_id TEXT PRIMARY KEY, activo_id TEXT NOT NULL REFERENCES activo_retornable(activo_id),
  tipo TEXT NOT NULL CHECK (tipo IN ('ENTREGA','RETORNO_ANUNCIADO','RETORNO_RECIBIDO','INSPECCION','CONFLICTO')),
  desde TEXT, hacia TEXT, pedido_id TEXT, etapa_id TEXT, condicion TEXT, documento TEXT, reportado_por TEXT NOT NULL, ocurrido_en TEXT NOT NULL, registrado_en TEXT NOT NULL, command_id TEXT NOT NULL);
`;

/** v5 (I05): pronóstico diario en la lectura de clima, historia sintética cerrada, KPI y simulación. Solo agrega. */
export const DDL_V5_ANALITICA = `
ALTER TABLE lectura_clima ADD COLUMN lluvia_hoy_mm REAL;
ALTER TABLE lectura_clima ADD COLUMN prob_lluvia_pct INTEGER;
CREATE TABLE IF NOT EXISTS hist_pedido (pedido_id TEXT PRIMARY KEY, cliente_id TEXT NOT NULL, destino_id TEXT NOT NULL, region TEXT NOT NULL, remoto INTEGER NOT NULL,
  fecha_pedido TEXT NOT NULL, registrado_en TEXT NOT NULL, compromiso_inicio TEXT NOT NULL, compromiso_fin TEXT NOT NULL, prioridad TEXT NOT NULL,
  tipo_demanda TEXT NOT NULL CHECK (tipo_demanda IN ('FIRME','CONSULTA','DUPLICADO')), cancelado_en TEXT, motivo_cancelacion TEXT, origen_nodo TEXT, modo_final TEXT, tramos INTEGER);
CREATE TABLE IF NOT EXISTS hist_linea (pedido_id TEXT NOT NULL REFERENCES hist_pedido(pedido_id), linea INTEGER NOT NULL, producto_id TEXT NOT NULL REFERENCES producto(producto_id),
  solicitado_mil INTEGER NOT NULL, comprometido_mil INTEGER NOT NULL, no_atendido_mil INTEGER NOT NULL DEFAULT 0, motivo_no_atendido TEXT, PRIMARY KEY (pedido_id, linea));
CREATE TABLE IF NOT EXISTS hist_entrega (entrega_id TEXT NOT NULL, pedido_id TEXT NOT NULL REFERENCES hist_pedido(pedido_id), intento INTEGER NOT NULL, ocurrido_en TEXT NOT NULL, registrado_en TEXT NOT NULL,
  estado TEXT NOT NULL, motivo TEXT, linea INTEGER, aceptado_mil INTEGER NOT NULL DEFAULT 0, rechazado_mil INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS ix_hist_entrega ON hist_entrega(pedido_id);
CREATE TABLE IF NOT EXISTS hist_etapa (etapa_id TEXT PRIMARY KEY, pedido_id TEXT NOT NULL REFERENCES hist_pedido(pedido_id), tramo INTEGER NOT NULL, modo_id TEXT NOT NULL, nodo_origen_id TEXT, nodo_destino_id TEXT,
  servicio_ref TEXT NOT NULL, salida_plan TEXT NOT NULL, salida_real TEXT NOT NULL, llegada_plan TEXT NOT NULL, llegada_real TEXT NOT NULL, kg_mil INTEGER NOT NULL, capacidad_kg_mil INTEGER NOT NULL,
  conexion_perdida INTEGER NOT NULL DEFAULT 0, costo_estimado_cent INTEGER NOT NULL, costo_real_cent INTEGER, motivo_retraso TEXT);
CREATE INDEX IF NOT EXISTS ix_hist_etapa ON hist_etapa(pedido_id);
CREATE TABLE IF NOT EXISTS hist_devolucion (pedido_id TEXT NOT NULL REFERENCES hist_pedido(pedido_id), linea INTEGER NOT NULL, q_mil INTEGER NOT NULL, ocurrido_en TEXT NOT NULL, registrado_en TEXT NOT NULL, motivo TEXT);
CREATE TABLE IF NOT EXISTS hist_sin_datos (region TEXT NOT NULL, semana_inicio TEXT NOT NULL, motivo TEXT NOT NULL, PRIMARY KEY (region, semana_inicio));
CREATE TABLE IF NOT EXISTS causa_analisis (analisis_id TEXT PRIMARY KEY, indicador TEXT NOT NULL, entidad TEXT NOT NULL, entidad_id TEXT NOT NULL, hecho TEXT NOT NULL, evento TEXT NOT NULL,
  causa_candidata TEXT NOT NULL, estado TEXT NOT NULL CHECK (estado IN ('HIPOTESIS_PENDIENTE','EN_VALIDACION','CONFIRMADA','REFUTADA','NO_CONCLUYENTE')),
  conclusion TEXT, alternativa TEXT, creado_por TEXT NOT NULL, creado_en TEXT NOT NULL, actualizado_en TEXT NOT NULL, validado_por TEXT);
CREATE TABLE IF NOT EXISTS causa_evidencia (evidencia_id TEXT PRIMARY KEY, analisis_id TEXT NOT NULL REFERENCES causa_analisis(analisis_id), sentido TEXT NOT NULL CHECK (sentido IN ('A_FAVOR','EN_CONTRA')),
  descripcion TEXT NOT NULL, fuente TEXT NOT NULL, registrado_por TEXT NOT NULL, registrado_en TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS causa_historial (analisis_id TEXT NOT NULL REFERENCES causa_analisis(analisis_id), en TEXT NOT NULL, usuario_id TEXT NOT NULL, de TEXT, a TEXT NOT NULL, motivo TEXT);
CREATE TABLE IF NOT EXISTS corrida_pronostico (corrida_id TEXT PRIMARY KEY, creada_en TEXT NOT NULL, creada_por TEXT NOT NULL, serie TEXT NOT NULL, corte TEXT NOT NULL, conocimiento_hasta TEXT NOT NULL,
  metodo_elegido TEXT, parametros TEXT NOT NULL, metricas TEXT NOT NULL, prediccion TEXT NOT NULL, advertencias TEXT NOT NULL, version_motor TEXT NOT NULL, corrige_a TEXT, motivo TEXT);
CREATE TABLE IF NOT EXISTS recomendacion (recomendacion_id TEXT PRIMARY KEY, regla TEXT NOT NULL, entidad TEXT NOT NULL, entidad_id TEXT NOT NULL, valores TEXT NOT NULL, alternativa TEXT NOT NULL,
  impacto TEXT NOT NULL, restricciones TEXT NOT NULL, estado TEXT NOT NULL CHECK (estado IN ('PROPUESTA','ACEPTADA','RECHAZADA')), creada_en TEXT NOT NULL, decidida_por TEXT, decidida_en TEXT, motivo TEXT);
`;

/** v6 (I06): modelos y corridas de simulación Monte Carlo, supuestos y corridas económicas (EVA), escenarios de demanda. Solo agrega tablas. */
export const DDL_V6_SIMULACION = `
CREATE TABLE IF NOT EXISTS modelo_simulacion (modelo_id TEXT NOT NULL, version INTEGER NOT NULL CHECK (version >= 1), nombre TEXT NOT NULL, parametros TEXT NOT NULL,
  clonado_de TEXT, creado_en TEXT NOT NULL, creado_por TEXT NOT NULL, motivo TEXT NOT NULL, PRIMARY KEY (modelo_id, version));
CREATE TABLE IF NOT EXISTS corrida_simulacion (run_id TEXT PRIMARY KEY, modelo_id TEXT NOT NULL, modelo_version INTEGER NOT NULL, parametros TEXT NOT NULL,
  semilla INTEGER NOT NULL, iteraciones INTEGER NOT NULL, iteraciones_completas INTEGER NOT NULL, estado TEXT NOT NULL CHECK (estado IN ('COMPLETA','CANCELADA')),
  planes TEXT NOT NULL, entrada_hash TEXT NOT NULL, resultados TEXT, version_motor TEXT NOT NULL, dataset_id TEXT, creada_en TEXT NOT NULL, creada_por TEXT NOT NULL,
  FOREIGN KEY (modelo_id, modelo_version) REFERENCES modelo_simulacion(modelo_id, version));
CREATE TABLE IF NOT EXISTS supuesto_economico (clave TEXT PRIMARY KEY, valor REAL, unidad TEXT NOT NULL, descripcion TEXT NOT NULL, fuente TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS corrida_economica (run_id TEXT PRIMARY KEY, creada_en TEXT NOT NULL, creada_por TEXT NOT NULL, sim_run_id TEXT REFERENCES corrida_simulacion(run_id),
  supuestos TEXT NOT NULL, escenario_demanda TEXT NOT NULL, horizonte_meses INTEGER NOT NULL, resultados TEXT NOT NULL, version_motor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS escenario_demanda (escenario_id TEXT PRIMARY KEY, nombre TEXT NOT NULL, producto_id TEXT, desde TEXT NOT NULL, hasta TEXT NOT NULL,
  aumento_pct REAL NOT NULL CHECK (aumento_pct > -100), fuente TEXT NOT NULL, creado_en TEXT NOT NULL, creado_por TEXT NOT NULL, CHECK (hasta > desde));
`;

/** v7 (I07): eventos técnicos correlacionados (observabilidad local) y ensayos de restauración con RPO/RTO medidos. Solo agrega tablas. */
export const DDL_V7_CONTINUIDAD = `
CREATE TABLE IF NOT EXISTS evento_tecnico (evento_id TEXT PRIMARY KEY, primer_instante TEXT NOT NULL, ultimo_instante TEXT NOT NULL, nivel TEXT NOT NULL CHECK (nivel IN ('INFO','AVISO','ERROR')),
  etapa TEXT NOT NULL, codigo TEXT NOT NULL, mensaje TEXT NOT NULL, run_id TEXT, ocurrencias INTEGER NOT NULL DEFAULT 1, estado TEXT NOT NULL DEFAULT 'ABIERTO' CHECK (estado IN ('ABIERTO','RESUELTO')));
CREATE TABLE IF NOT EXISTS ensayo_restauracion (ensayo_id TEXT PRIMARY KEY, instante TEXT NOT NULL, usuario_id TEXT NOT NULL, archivo_hash TEXT NOT NULL, resultado TEXT NOT NULL,
  duracion_ms INTEGER NOT NULL, rpo_h REAL, rto_meta_s REAL NOT NULL, rpo_meta_h REAL NOT NULL, cumple_rto INTEGER NOT NULL, cumple_rpo INTEGER, detalle TEXT NOT NULL);
`;
