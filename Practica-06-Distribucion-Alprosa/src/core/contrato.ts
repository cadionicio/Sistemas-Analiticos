// Contrato de entrada Excel v2 (§11.1 con nodos unificados DEC-I01-D2). Lectura por NOMBRE de hoja y columna;
// validación completa antes de confirmar (todo o nada). Hojas obligatorias y opcionales declaradas en LEEME.
import { aMilesimas } from './util';

export type TipoCol = 'texto' | 'codigo' | 'decimal3' | 'decimal4' | 'decimal6' | 'entero' | 'real' | 'fecha' | 'instante' | 'bool' | 'enum';
export interface ColSpec { nombre: string; tipo: TipoCol; valores?: string[]; opcional?: boolean; desc?: string }
export interface HojaSpec { hoja: string; pk: string[]; columnas: ColSpec[]; fks?: { col: string; hoja: string; colDestino?: string }[]; opcional?: boolean; desc: string }

export const VERSION_CONTRATO = 'I06-v6';
/** Versiones de contrato que este programa acepta (probadas). Cualquier otra se rechaza. */
export const CONTRATOS_COMPATIBLES = ['I06-v6']; // solo se declara compatible lo probado; versiones anteriores no se aceptan sin prueba
const B = (nombre: string, desc?: string): ColSpec => ({ nombre, tipo: 'bool', desc });

export const CONTRATO: HojaSpec[] = [
  { hoja: 'Parametros', opcional: true, pk: ['clave'], desc: 'Valores que reemplazan parámetros versionados', columnas: [
    { nombre: 'clave', tipo: 'texto' }, { nombre: 'valor', tipo: 'texto' }, { nombre: 'vigente_desde', tipo: 'instante' }, { nombre: 'motivo', tipo: 'texto' } ] },
  { hoja: 'Usuarios', opcional: true, pk: ['usuario_id'], desc: 'Personas ficticias que operan el sistema', columnas: [
    { nombre: 'usuario_id', tipo: 'texto' }, { nombre: 'nombre_ficticio', tipo: 'texto' }, B('activo'), B('compartida', 'VERDADERO si la cuenta la usan varias personas') ] },
  { hoja: 'RolesAsignados', opcional: true, pk: ['usuario_id', 'rol', 'vigente_desde'], fks: [{ col: 'usuario_id', hoja: 'Usuarios' }], desc: 'Roles con vigencia [desde, hasta)', columnas: [
    { nombre: 'usuario_id', tipo: 'texto' }, { nombre: 'rol', tipo: 'enum', valores: ['ADMINISTRADOR', 'RESPONSABLE_DATOS', 'ENCARGADO_PEDIDOS', 'ENCARGADO_ALMACEN', 'PLANIFICADOR', 'SUPERVISOR', 'ANALISTA', 'SOPORTE'] },
    { nombre: 'vigente_desde', tipo: 'instante' }, { nombre: 'vigente_hasta', tipo: 'instante', opcional: true } ] },
  { hoja: 'Productos', pk: ['producto_id'], desc: 'Catálogo genérico (sin marcas reales)', columnas: [
    { nombre: 'producto_id', tipo: 'texto' }, { nombre: 'nombre_generico', tipo: 'texto' }, { nombre: 'familia', tipo: 'texto' },
    { nombre: 'unidad_base', tipo: 'enum', valores: ['kg', 'unidad'] }, { nombre: 'peso_kg_por_unidad', tipo: 'decimal3' }, { nombre: 'volumen_m3_por_unidad', tipo: 'decimal6' },
    B('fraccionable'), B('activo') ] },
  { hoja: 'Conversiones', pk: ['presentacion_id'], fks: [{ col: 'producto_id', hoja: 'Productos' }], desc: 'Presentaciones y su factor a unidad base', columnas: [
    { nombre: 'presentacion_id', tipo: 'texto' }, { nombre: 'producto_id', tipo: 'texto' }, { nombre: 'nombre', tipo: 'texto' }, { nombre: 'unidades_base_por_presentacion', tipo: 'decimal3' }, B('activo') ] },
  { hoja: 'Clientes', pk: ['cliente_id'], desc: 'Clientes ficticios', columnas: [{ nombre: 'cliente_id', tipo: 'texto' }, { nombre: 'nombre_ficticio', tipo: 'texto' }, B('activo')] },
  { hoja: 'NodosLogisticos', pk: ['nodo_id'], desc: 'Almacenes, tránsito, transbordos y puntos de destino', columnas: [
    { nombre: 'nodo_id', tipo: 'texto' }, { nombre: 'nombre', tipo: 'texto' }, { nombre: 'tipo', tipo: 'enum', valores: ['ALMACEN', 'TRANSITO', 'TRANSBORDO', 'DESTINO'] },
    { nombre: 'region', tipo: 'texto' }, { nombre: 'capacidad_almacen_kg', tipo: 'decimal3', opcional: true }, B('permite_espera_nocturna'), B('activo'),
    { nombre: 'fuente_dato', tipo: 'texto', opcional: true }, { nombre: 'manipulacion_min', tipo: 'entero', opcional: true, desc: 'Minutos de descarga y transbordo' } ] },
  { hoja: 'Destinos', pk: ['destino_id'], fks: [{ col: 'cliente_id', hoja: 'Clientes' }, { col: 'nodo_id', hoja: 'NodosLogisticos' }], desc: 'Puntos de entrega con identidad territorial', columnas: [
    { nombre: 'destino_id', tipo: 'texto' }, { nombre: 'cliente_id', tipo: 'texto' }, { nombre: 'nombre_ficticio', tipo: 'texto' }, { nombre: 'region', tipo: 'texto' },
    { nombre: 'codigo_territorial', tipo: 'codigo', opcional: true, desc: 'Como TEXTO para conservar ceros iniciales' }, { nombre: 'catalogo_territorial', tipo: 'texto', opcional: true },
    { nombre: 'version_catalogo', tipo: 'texto', opcional: true }, { nombre: 'latitud', tipo: 'real', opcional: true }, { nombre: 'longitud', tipo: 'real', opcional: true },
    { nombre: 'precision_geografica', tipo: 'enum', valores: ['EXACTA', 'APROXIMADA', 'CENTROIDE', 'DESCONOCIDA'] }, { nombre: 'nodo_id', tipo: 'texto' },
    B('acepta_anticipadas'), { nombre: 'vida_util_min_dias', tipo: 'entero' }, B('activo') ] },
  { hoja: 'LimitesTerritoriales', opcional: true, pk: ['region'], desc: 'Solo límites confiables con fuente; sin ellos la verificación queda pendiente', columnas: [
    { nombre: 'region', tipo: 'texto' }, { nombre: 'lat_min', tipo: 'real' }, { nombre: 'lat_max', tipo: 'real' }, { nombre: 'lon_min', tipo: 'real' }, { nombre: 'lon_max', tipo: 'real' }, { nombre: 'fuente', tipo: 'texto' } ] },
  { hoja: 'Lotes', pk: ['lote_id'], fks: [{ col: 'producto_id', hoja: 'Productos' }], desc: 'Partidas trazables; una partida por producto y código', columnas: [
    { nombre: 'lote_id', tipo: 'texto' }, { nombre: 'producto_id', tipo: 'texto' }, { nombre: 'codigo_lote', tipo: 'texto' },
    { nombre: 'fecha_fabricacion', tipo: 'fecha' }, { nombre: 'fecha_vencimiento', tipo: 'fecha' }, { nombre: 'estado_lote', tipo: 'enum', valores: ['LIBERADO', 'BLOQUEADO'] } ] },
  { hoja: 'MovimientosIniciales', pk: ['movimiento_id'], fks: [{ col: 'lote_id', hoja: 'Lotes' }, { col: 'nodo_id', hoja: 'NodosLogisticos' }], desc: 'Solo saldos de apertura por lote, nodo y condición', columnas: [
    { nombre: 'movimiento_id', tipo: 'texto' }, { nombre: 'lote_id', tipo: 'texto' }, { nombre: 'nodo_id', tipo: 'texto' },
    { nombre: 'cantidad_base', tipo: 'decimal3' }, { nombre: 'fecha', tipo: 'fecha' }, { nombre: 'condicion', tipo: 'enum', valores: ['APTO', 'CUARENTENA', 'DANADO'] } ] },
  { hoja: 'SuministrosEsperados', opcional: true, pk: ['suministro_id'], fks: [{ col: 'producto_id', hoja: 'Productos' }, { col: 'nodo_destino_id', hoja: 'NodosLogisticos', colDestino: 'nodo_id' }, { col: 'lote_id', hoja: 'Lotes' }],
    desc: 'Entradas futuras; solo CONFIRMADO sustenta propuestas', columnas: [
    { nombre: 'suministro_id', tipo: 'texto' }, { nombre: 'producto_id', tipo: 'texto' }, { nombre: 'lote_id', tipo: 'texto', opcional: true }, { nombre: 'nodo_destino_id', tipo: 'texto' },
    { nombre: 'cantidad_base', tipo: 'decimal3' }, { nombre: 'fecha_prevista', tipo: 'fecha' }, { nombre: 'estado', tipo: 'enum', valores: ['NO_CONFIRMADO', 'CONFIRMADO'] } ] },
  { hoja: 'ModosTransporte', opcional: true, pk: ['modo_id'], desc: 'Medios configurables; no afirman servicios reales', columnas: [
    { nombre: 'modo_id', tipo: 'texto' }, { nombre: 'nombre', tipo: 'texto' }, B('activo'), B('requiere_habilitacion') ] },
  { hoja: 'Recursos', opcional: true, pk: ['recurso_id'], fks: [{ col: 'modo_id', hoja: 'ModosTransporte' }], desc: 'Vehículos, embarcaciones, recuas o porteadores con capacidad', columnas: [
    { nombre: 'recurso_id', tipo: 'texto' }, { nombre: 'nombre', tipo: 'texto' }, { nombre: 'modo_id', tipo: 'texto' }, { nombre: 'operador', tipo: 'texto' },
    { nombre: 'capacidad_kg', tipo: 'decimal3' }, { nombre: 'capacidad_m3', tipo: 'decimal3' }, { nombre: 'max_bulto_kg', tipo: 'decimal3', opcional: true }, B('activo') ] },
  { hoja: 'EnlacesMultimodales', opcional: true, pk: ['enlace_id'], fks: [{ col: 'nodo_origen_id', hoja: 'NodosLogisticos', colDestino: 'nodo_id' }, { col: 'nodo_destino_id', hoja: 'NodosLogisticos', colDestino: 'nodo_id' }, { col: 'modo_id', hoja: 'ModosTransporte' }],
    desc: 'Tramos dirigidos con tiempos e incertidumbre (mín/moda/máx en horas)', columnas: [
    { nombre: 'enlace_id', tipo: 'texto' }, { nombre: 'nodo_origen_id', tipo: 'texto' }, { nombre: 'nodo_destino_id', tipo: 'texto' }, { nombre: 'modo_id', tipo: 'texto' },
    { nombre: 'distancia_km', tipo: 'decimal3' }, { nombre: 'duracion_h', tipo: 'real' }, { nombre: 'min_h', tipo: 'real' }, { nombre: 'moda_h', tipo: 'real' }, { nombre: 'max_h', tipo: 'real' },
    { nombre: 'prob_incidencia', tipo: 'real' }, { nombre: 'retraso_incidencia_h', tipo: 'real' }, { nombre: 'corredor_id', tipo: 'texto', opcional: true },
    { nombre: 'estado_acceso', tipo: 'enum', valores: ['NORMAL', 'RESTRINGIDO', 'INTERRUMPIDO', 'DESCONOCIDO'] }, { nombre: 'max_kg_recurso', tipo: 'decimal3', opcional: true },
    { nombre: 'fuente_dato', tipo: 'texto' }, B('activo') ] },
  { hoja: 'ServiciosTransporte', opcional: true, pk: ['servicio_id'], fks: [{ col: 'enlace_id', hoja: 'EnlacesMultimodales' }, { col: 'recurso_id', hoja: 'Recursos' }], desc: 'Salidas concretas con horario (hora de Lima)', columnas: [
    { nombre: 'servicio_id', tipo: 'texto' }, { nombre: 'enlace_id', tipo: 'texto' }, { nombre: 'recurso_id', tipo: 'texto' }, { nombre: 'salida', tipo: 'instante' }, { nombre: 'llegada', tipo: 'instante' },
    { nombre: 'tarifa_fija', tipo: 'decimal4' }, { nombre: 'costo_por_kg', tipo: 'decimal4' }, { nombre: 'estado', tipo: 'enum', valores: ['PROGRAMADO', 'CANCELADO'] } ] },
  { hoja: 'Compatibilidades', opcional: true, pk: ['producto_id', 'modo_id'], fks: [{ col: 'producto_id', hoja: 'Productos' }, { col: 'modo_id', hoja: 'ModosTransporte' }], desc: 'Restricciones producto–medio', columnas: [
    { nombre: 'producto_id', tipo: 'texto' }, { nombre: 'modo_id', tipo: 'texto' }, B('permitido'), { nombre: 'motivo', tipo: 'texto' } ] },
  { hoja: 'ReceptoresAutorizados', opcional: true, pk: ['receptor_id'], fks: [{ col: 'destino_id', hoja: 'Destinos' }], desc: 'Personas ficticias facultadas para aceptar en cada destino', columnas: [
    { nombre: 'receptor_id', tipo: 'texto' }, { nombre: 'destino_id', tipo: 'texto' }, { nombre: 'nombre_ficticio', tipo: 'texto' }, { nombre: 'vigente_desde', tipo: 'instante' }, { nombre: 'vigente_hasta', tipo: 'instante', opcional: true } ] },
  { hoja: 'Transbordos', opcional: true, pk: ['regla_transbordo_id'], fks: [{ col: 'nodo_id', hoja: 'NodosLogisticos' }, { col: 'modo_entrada_id', hoja: 'ModosTransporte', colDestino: 'modo_id' }, { col: 'modo_salida_id', hoja: 'ModosTransporte', colDestino: 'modo_id' }], desc: 'Reglas de cambio de medio en un nodo: duración y costo', columnas: [
    { nombre: 'regla_transbordo_id', tipo: 'texto' }, { nombre: 'nodo_id', tipo: 'texto' }, { nombre: 'modo_entrada_id', tipo: 'texto' }, { nombre: 'modo_salida_id', tipo: 'texto' },
    { nombre: 'duracion_h', tipo: 'real' }, { nombre: 'costo_fijo', tipo: 'decimal4' }, { nombre: 'costo_por_kg', tipo: 'decimal4' }, B('fraccionamiento_permitido') ] },
  { hoja: 'ActivosRetornables', opcional: true, pk: ['activo_id'], fks: [{ col: 'nodo_id', hoja: 'NodosLogisticos' }], desc: 'Envases y pallets retornables (no son alimento)', columnas: [
    { nombre: 'activo_id', tipo: 'texto' }, { nombre: 'tipo', tipo: 'texto' }, { nombre: 'propietario', tipo: 'texto' }, { nombre: 'tara_kg', tipo: 'decimal3' }, { nombre: 'volumen_m3', tipo: 'decimal6' },
    { nombre: 'nodo_id', tipo: 'texto' }, { nombre: 'condicion', tipo: 'enum', valores: ['DISPONIBLE', 'REVISION', 'DANADO', 'BAJA'] } ] },
  { hoja: 'HistPedidos', opcional: true, pk: ['pedido_id'], fks: [{ col: 'cliente_id', hoja: 'Clientes' }, { col: 'destino_id', hoja: 'Destinos' }], desc: 'Historia sintética cerrada: pedidos (52 semanas)', columnas: [
    { nombre: 'pedido_id', tipo: 'texto' }, { nombre: 'cliente_id', tipo: 'texto' }, { nombre: 'destino_id', tipo: 'texto' }, { nombre: 'region', tipo: 'texto' }, B('remoto'),
    { nombre: 'fecha_pedido', tipo: 'instante' }, { nombre: 'registrado_en', tipo: 'instante' }, { nombre: 'compromiso_inicio', tipo: 'instante' }, { nombre: 'compromiso_fin', tipo: 'instante' },
    { nombre: 'prioridad', tipo: 'enum', valores: ['NORMAL', 'URGENTE'] }, { nombre: 'tipo_demanda', tipo: 'enum', valores: ['FIRME', 'CONSULTA', 'DUPLICADO'] },
    { nombre: 'cancelado_en', tipo: 'instante', opcional: true }, { nombre: 'motivo_cancelacion', tipo: 'texto', opcional: true }, { nombre: 'origen_nodo', tipo: 'texto', opcional: true }, { nombre: 'modo_final', tipo: 'texto', opcional: true }, { nombre: 'tramos', tipo: 'entero', opcional: true } ] },
  { hoja: 'HistLineas', opcional: true, pk: ['pedido_id', 'linea'], fks: [{ col: 'pedido_id', hoja: 'HistPedidos' }, { col: 'producto_id', hoja: 'Productos' }], desc: 'Historia: líneas con solicitado, comprometido y no atendido (censura)', columnas: [
    { nombre: 'pedido_id', tipo: 'texto' }, { nombre: 'linea', tipo: 'entero' }, { nombre: 'producto_id', tipo: 'texto' }, { nombre: 'solicitado', tipo: 'decimal3' }, { nombre: 'comprometido', tipo: 'decimal3' },
    { nombre: 'no_atendido', tipo: 'decimal3' }, { nombre: 'motivo_no_atendido', tipo: 'texto', opcional: true } ] },
  { hoja: 'HistEntregas', opcional: true, pk: [], fks: [{ col: 'pedido_id', hoja: 'HistPedidos' }], desc: 'Historia: intentos de entrega por línea (ocurrido y registrado)', columnas: [
    { nombre: 'entrega_id', tipo: 'texto' }, { nombre: 'pedido_id', tipo: 'texto' }, { nombre: 'intento', tipo: 'entero' }, { nombre: 'ocurrido_en', tipo: 'instante' }, { nombre: 'registrado_en', tipo: 'instante' },
    { nombre: 'estado', tipo: 'enum', valores: ['TOTAL', 'PARCIAL', 'FALLIDO'] }, { nombre: 'motivo', tipo: 'texto', opcional: true }, { nombre: 'linea', tipo: 'entero', opcional: true },
    { nombre: 'aceptado', tipo: 'decimal3', opcional: true }, { nombre: 'rechazado', tipo: 'decimal3', opcional: true } ] },
  { hoja: 'HistEtapas', opcional: true, pk: ['etapa_id'], fks: [{ col: 'pedido_id', hoja: 'HistPedidos' }], desc: 'Historia: tramos ejecutados (plan vs real, carga y costo)', columnas: [
    { nombre: 'etapa_id', tipo: 'texto' }, { nombre: 'pedido_id', tipo: 'texto' }, { nombre: 'tramo', tipo: 'entero' }, { nombre: 'modo_id', tipo: 'texto' }, { nombre: 'nodo_origen_id', tipo: 'texto' }, { nombre: 'nodo_destino_id', tipo: 'texto' },
    { nombre: 'servicio_ref', tipo: 'texto' }, { nombre: 'salida_plan', tipo: 'instante' }, { nombre: 'salida_real', tipo: 'instante' }, { nombre: 'llegada_plan', tipo: 'instante' }, { nombre: 'llegada_real', tipo: 'instante' },
    { nombre: 'kg', tipo: 'decimal3' }, { nombre: 'capacidad_kg', tipo: 'decimal3' }, B('conexion_perdida'), { nombre: 'costo_estimado_cent', tipo: 'entero' }, { nombre: 'costo_real_cent', tipo: 'entero', opcional: true }, { nombre: 'motivo_retraso', tipo: 'texto', opcional: true } ] },
  { hoja: 'HistDevoluciones', opcional: true, pk: [], fks: [{ col: 'pedido_id', hoja: 'HistPedidos' }], desc: 'Historia: devoluciones posteriores a la aceptación', columnas: [
    { nombre: 'pedido_id', tipo: 'texto' }, { nombre: 'linea', tipo: 'entero' }, { nombre: 'cantidad', tipo: 'decimal3' }, { nombre: 'ocurrido_en', tipo: 'instante' }, { nombre: 'registrado_en', tipo: 'instante' }, { nombre: 'motivo', tipo: 'texto', opcional: true } ] },
  { hoja: 'HistSinDatos', opcional: true, pk: ['region', 'semana_inicio'], fks: [], desc: 'Semanas sin captura de datos (faltante, distinto de demanda cero)', columnas: [
    { nombre: 'region', tipo: 'texto' }, { nombre: 'semana_inicio', tipo: 'fecha' }, { nombre: 'motivo', tipo: 'texto' } ] },
  { hoja: 'HistRetornables', opcional: true, pk: [], fks: [{ col: 'activo_id', hoja: 'ActivosRetornables' }], desc: 'Historia de envases retornables (entrega y retorno)', columnas: [
    { nombre: 'activo_id', tipo: 'texto' }, { nombre: 'tipo_movimiento', tipo: 'enum', valores: ['ENTREGA', 'RETORNO_ANUNCIADO', 'RETORNO_RECIBIDO', 'INSPECCION'] }, { nombre: 'desde', tipo: 'texto' }, { nombre: 'hacia', tipo: 'texto' },
    { nombre: 'pedido_ref', tipo: 'texto', opcional: true }, { nombre: 'condicion', tipo: 'enum', valores: ['DISPONIBLE', 'REVISION', 'DANADO', 'BAJA'] }, { nombre: 'ocurrido_en', tipo: 'instante' }, { nombre: 'registrado_en', tipo: 'instante' }, { nombre: 'documento', tipo: 'texto', opcional: true } ] },
  { hoja: 'HistConteos', opcional: true, pk: ['conteo_id'], fks: [{ col: 'nodo_id', hoja: 'NodosLogisticos' }, { col: 'lote_id', hoja: 'Lotes' }], desc: 'Conteos cerrados y su resolución', columnas: [
    { nombre: 'conteo_id', tipo: 'texto' }, { nombre: 'nodo_id', tipo: 'texto' }, { nombre: 'lote_id', tipo: 'texto' }, { nombre: 'condicion', tipo: 'enum', valores: ['APTO', 'CUARENTENA', 'DANADO'] }, { nombre: 'corte', tipo: 'instante' },
    { nombre: 'contado', tipo: 'decimal3' }, { nombre: 'sistema', tipo: 'decimal3' }, { nombre: 'estado', tipo: 'enum', valores: ['SIN_DIFERENCIA', 'RESUELTO'] }, { nombre: 'recuento_de', tipo: 'texto', opcional: true }, { nombre: 'resolucion', tipo: 'texto', opcional: true }, { nombre: 'registrado_por', tipo: 'texto' } ] },
  { hoja: 'ParametrosSimulacion', opcional: true, pk: ['parametro'], fks: [], desc: 'Parámetros del modelo base de simulación Monte Carlo (sintéticos, editables)', columnas: [
    { nombre: 'parametro', tipo: 'enum', valores: ['iteraciones', 'semilla', 'shock_comun', 'prob_cierre', 'factor_duracion', 'costo_espera_hora', 'costo_reprogramacion', 'horizonte_reprogramacion_h', 'holgura_por_pedido_h'] },
    { nombre: 'valor', tipo: 'real' }, { nombre: 'unidad', tipo: 'texto', opcional: true }, { nombre: 'descripcion', tipo: 'texto', opcional: true } ] },
  { hoja: 'SupuestosEconomicos', opcional: true, pk: ['clave'], fks: [], desc: 'Supuestos de la unidad demostrativa para EBIT, NOPAT, capital y EVA (no son cifras de Alprosa)', columnas: [
    { nombre: 'clave', tipo: 'texto' }, { nombre: 'valor', tipo: 'real', opcional: true, desc: 'Vacío = dato faltante (no se rellena con cero)' }, { nombre: 'unidad', tipo: 'texto' }, { nombre: 'descripcion', tipo: 'texto' }, { nombre: 'fuente', tipo: 'texto' } ] },
  { hoja: 'EscenariosDemanda', opcional: true, pk: ['escenario_id'], fks: [{ col: 'producto_id', hoja: 'Productos' }], desc: 'Supuestos de intervención (promociones): no se usan para entrenar el pronóstico', columnas: [
    { nombre: 'escenario_id', tipo: 'texto' }, { nombre: 'nombre', tipo: 'texto' }, { nombre: 'producto_id', tipo: 'texto', opcional: true }, { nombre: 'desde', tipo: 'fecha' }, { nombre: 'hasta', tipo: 'fecha' },
    { nombre: 'aumento_pct', tipo: 'real' }, { nombre: 'fuente', tipo: 'texto' } ] },
  { hoja: 'CondicionesAcceso', opcional: true, pk: ['condicion_id'], fks: [{ col: 'enlace_id', hoja: 'EnlacesMultimodales' }], desc: 'Estado de un tramo con vigencia y fuente', columnas: [
    { nombre: 'condicion_id', tipo: 'texto' }, { nombre: 'enlace_id', tipo: 'texto' }, { nombre: 'estado', tipo: 'enum', valores: ['NORMAL', 'RESTRINGIDO', 'INTERRUMPIDO', 'DESCONOCIDO'] },
    { nombre: 'motivo', tipo: 'texto' }, { nombre: 'vigente_desde', tipo: 'instante' }, { nombre: 'vigente_hasta', tipo: 'instante' }, { nombre: 'registrado_en', tipo: 'instante' }, { nombre: 'fuente', tipo: 'texto' } ] },
  { hoja: 'Pedidos', pk: ['pedido_id'], fks: [{ col: 'cliente_id', hoja: 'Clientes' }, { col: 'destino_id', hoja: 'Destinos' }, { col: 'responsable_id', hoja: 'Usuarios', colDestino: 'usuario_id' }], desc: 'Cabeceras; estado solo BORRADOR o CONFIRMADO', columnas: [
    { nombre: 'pedido_id', tipo: 'texto' }, { nombre: 'cliente_id', tipo: 'texto' }, { nombre: 'destino_id', tipo: 'texto' },
    { nombre: 'fecha_pedido', tipo: 'fecha' }, { nombre: 'ventana_inicio', tipo: 'instante' }, { nombre: 'ventana_fin', tipo: 'instante' },
    { nombre: 'prioridad', tipo: 'enum', valores: ['NORMAL', 'URGENTE'] }, B('permite_parcial'), B('permite_entregas_divididas'),
    { nombre: 'estado', tipo: 'enum', valores: ['BORRADOR', 'CONFIRMADO'] }, { nombre: 'responsable_id', tipo: 'texto', opcional: true } ] },
  { hoja: 'PedidoDetalle', pk: ['pedido_linea_id'], fks: [{ col: 'pedido_id', hoja: 'Pedidos' }, { col: 'producto_id', hoja: 'Productos' }, { col: 'presentacion_id', hoja: 'Conversiones' }], desc: 'Líneas en la presentación pedida', columnas: [
    { nombre: 'pedido_linea_id', tipo: 'texto' }, { nombre: 'pedido_id', tipo: 'texto' }, { nombre: 'producto_id', tipo: 'texto' }, { nombre: 'presentacion_id', tipo: 'texto' },
    { nombre: 'cantidad_presentacion', tipo: 'decimal3' }, { nombre: 'precio_neto_base', tipo: 'decimal4', desc: 'Soles por unidad base, hasta 4 decimales' } ] },
];

export type Celda = string | number | boolean | Date | null | { formula: string };
export interface FilaCruda { fila: number; celdas: Record<string, { valor: Celda; ref: string }> }
export interface HojaCruda { nombre: string; encabezados: string[]; filas: FilaCruda[] }
export interface ErrorCarga { hoja: string; celda: string; fila: number | ''; columna: string; valor: string; mensaje: string }
export type Registro = Record<string, string | number | null>;
export type ConjuntoValidado = Record<string, Registro[]>;

const norm = (s: string) => s.normalize('NFC').trim();
const textoValor = (v: Celda) => (v === null ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? '=' + v.formula : String(v));

function fechaIso(v: Celda): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) {
    const d = new Date(v.trim() + 'T00:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v.trim() ? v.trim() : null;
  }
  return null;
}
/** Instantes se normalizan a hora de Lima (−05:00) para comparaciones consistentes. */
export function instanteIso(v: Celda): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 16) + ':00-05:00';
  if (typeof v === 'string') {
    const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?$/.exec(v.trim());
    if (!m || !fechaIso(m[1]) || +m[2] > 23 || +m[3] > 59) return null;
    const local = `${m[1]}T${m[2]}:${m[3]}:${m[4] ?? '00'}`;
    if (!m[5] || m[5] === '-05:00') return local + '-05:00';
    const ms = Date.parse(local + (m[5] === 'Z' ? 'Z' : m[5]));
    return new Date(ms - 5 * 3600e3).toISOString().slice(0, 19) + '-05:00';
  }
  return null;
}
function escalado(v: Celda, dec: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const f = 10 ** dec, r = Math.round(v * f);
  if (Math.abs(v * f - r) > 1e-6 * Math.max(1, Math.abs(r)) || !Number.isSafeInteger(r)) return null;
  return r;
}

/** Valida todo el conjunto. Devuelve la lista COMPLETA de errores y advertencias; con un error no se confirma nada. */
/** opciones.exigirLeeme: un archivo externo debe declarar su contrato en LEEME (el recurso empaquetado de demostración no trae LEEME). */
export function validarConjunto(hojas: HojaCruda[], opciones: { exigirLeeme?: boolean } = {}): { errores: ErrorCarga[]; advertencias: string[]; datos: ConjuntoValidado } {
  const errores: ErrorCarga[] = [], advertencias: string[] = [];
  const datos: ConjuntoValidado = {};
  const fallidas = new Set<string>();
  const rechazadas = new Map<string, Set<string>>(); // filas con error: sus dependientes no generan errores en cascada
  const porNombre = new Map<string, HojaCruda[]>();
  for (const h of hojas) porNombre.set(norm(h.nombre), [...(porNombre.get(norm(h.nombre)) ?? []), h]);
  const conocidas = new Set([...CONTRATO.map((s) => s.hoja), 'LEEME']);
  for (const n of porNombre.keys()) if (!conocidas.has(n)) advertencias.push(`Hoja «${n}» no pertenece al contrato ${VERSION_CONTRATO}; se ignoró.`);
  // Auditoría RC1 n.º 11: la semántica (versión, unidades, zona horaria) se valida por lo que DECLARA el archivo; no se adivina.
  const leeme = porNombre.get('LEEME')?.[0];
  if (!leeme) {
    if (opciones.exigirLeeme) errores.push({ hoja: 'LEEME', celda: '', fila: '', columna: '', valor: '', mensaje: 'Falta la hoja LEEME: el archivo no declara su versión de contrato, unidades ni zona horaria, y no se puede asumir su significado. Use la plantilla del sistema.' });
    else advertencias.push(`Conjunto interno sin LEEME: se valida por estructura contra el contrato ${VERSION_CONTRATO}.`);
  } else {
    // Se lee por NOMBRE de encabezado (sección / descripción), no por posición de columna (auditoría RC2 n.º 25)
    const col = (f: { celdas: Record<string, { valor: unknown; ref: string }> }, re: RegExp, i: number) => Object.entries(f.celdas).find(([c]) => re.test(c))?.[1] ?? Object.values(f.celdas)[i];
    const dec = new Map(leeme.filas.map((f) => { const k = col(f, /secci/i, 0), d = col(f, /descrip/i, 1); return [String(k?.valor ?? '').trim(), { texto: String(d?.valor ?? '').trim(), ref: d?.ref ?? '' }]; }));
    const ver = dec.get('Versión de contrato');
    if (!ver || !ver.texto) errores.push({ hoja: 'LEEME', celda: ver?.ref ?? '', fila: '', columna: 'Versión de contrato', valor: '', mensaje: `El LEEME no declara «Versión de contrato»${ver ? ' (fila vacía)' : ''}: no se puede saber qué significan las columnas.` });
    else if (!CONTRATOS_COMPATIBLES.includes(ver.texto)) errores.push({ hoja: 'LEEME', celda: ver.ref, fila: '', columna: 'Versión de contrato', valor: ver.texto, mensaje: `Versión de contrato no soportada. Este programa lee: ${CONTRATOS_COMPATIBLES.join(', ')}.` });
    else if (ver.texto !== VERSION_CONTRATO) advertencias.push(`Contrato ${ver.texto} (anterior compatible): se lee con las reglas de ${VERSION_CONTRATO}; las hojas opcionales nuevas quedan vacías.`);
    const uni = dec.get('Unidades');
    // Defecto 26: en un archivo externo la semántica es obligatoria; no se asumen unidades ni zona horaria que el archivo no declara
    if (opciones.exigirLeeme) for (const [campo, v] of [['Unidades', uni], ['Fechas', dec.get('Fechas')]] as const)
      if (!v || !v.texto) errores.push({ hoja: 'LEEME', celda: v?.ref ?? '', fila: '', columna: campo, valor: v?.texto ?? '', mensaje: `El LEEME no declara «${campo}»${v ? ' (fila vacía)' : ''}: el archivo externo debe indicar ${campo === 'Unidades' ? 'en qué unidad vienen las cantidades' : 'en qué zona horaria vienen las fechas y horas'}. Use la plantilla del sistema.` });
    if (uni && uni.texto && !/unidad base/i.test(uni.texto)) errores.push({ hoja: 'LEEME', celda: uni.ref, fila: '', columna: 'Unidades', valor: uni.texto, mensaje: 'Unidad declarada incompatible: el contrato exige cantidades en la unidad base del producto.' });
    const fec = dec.get('Fechas');
    if (fec && fec.texto && !/(UTC\s*[−-]\s*05:00|Lima)/i.test(fec.texto)) errores.push({ hoja: 'LEEME', celda: fec.ref, fila: '', columna: 'Fechas', valor: fec.texto, mensaje: 'Zona horaria declarada distinta de Lima (UTC−05:00): no se reinterpretan las horas.' });
  }
  for (const spec of CONTRATO) {
    const enc = porNombre.get(spec.hoja) ?? [];
    if (enc.length === 0) {
      if (!spec.opcional) errores.push({ hoja: spec.hoja, celda: '', fila: '', columna: '', valor: '', mensaje: 'Falta la hoja obligatoria.' });
      fallidas.add(spec.hoja); datos[spec.hoja] = []; continue;
    }
    if (enc.length > 1) { errores.push({ hoja: spec.hoja, celda: '', fila: '', columna: '', valor: '', mensaje: 'La hoja aparece más de una vez.' }); fallidas.add(spec.hoja); continue; }
    const h = enc[0];
    const cab = h.encabezados.map(norm);
    let ok = true;
    for (const c of spec.columnas) {
      const n = cab.filter((e) => e === c.nombre).length;
      if (n === 0 && !c.opcional) { errores.push({ hoja: spec.hoja, celda: '', fila: 1, columna: c.nombre, valor: '', mensaje: 'Falta la columna obligatoria.' }); ok = false; }
      if (n > 1) { errores.push({ hoja: spec.hoja, celda: '', fila: 1, columna: c.nombre, valor: '', mensaje: 'Columna duplicada.' }); ok = false; }
    }
    for (const e of new Set(cab)) if (e && !spec.columnas.some((c) => c.nombre === e)) advertencias.push(`${spec.hoja}: columna «${e}» desconocida; se ignoró sin desplazar las demás.`);
    if (!ok) { fallidas.add(spec.hoja); continue; }
    const regs: Registro[] = [];
    const vistos = new Map<string, number>();
    for (const f of h.filas) {
      const r: Registro = { __fila: f.fila };
      let filaOk = true;
      for (const c of spec.columnas) {
        const cel = f.celdas[c.nombre] ?? { valor: null, ref: '' };
        const v = cel.valor;
        r['__ref:' + c.nombre] = cel.ref;
        const err = (mensaje: string) => { errores.push({ hoja: spec.hoja, celda: cel.ref, fila: f.fila, columna: c.nombre, valor: textoValor(v), mensaje }); filaOk = false; };
        if (v !== null && typeof v === 'object' && !(v instanceof Date)) { err('La celda contiene una fórmula; se exige un valor.'); continue; }
        if (v === null || (typeof v === 'string' && v.trim() === '')) { if (c.opcional) r[c.nombre] = null; else err('Valor obligatorio vacío.'); continue; }
        switch (c.tipo) {
          case 'texto': r[c.nombre] = norm(String(v)); break;
          case 'codigo': if (typeof v !== 'string') err('El código debe ingresarse como texto (formato Texto en Excel) para conservar ceros iniciales.'); else r[c.nombre] = norm(v); break;
          case 'enum': { const s = norm(String(v)); if (!c.valores!.includes(s)) err(`Valor no permitido. Use: ${c.valores!.join(', ')}.`); else r[c.nombre] = s; break; }
          case 'bool': if (v === true || v === 1) r[c.nombre] = 1; else if (v === false || v === 0) r[c.nombre] = 0; else err('Se espera VERDADERO/FALSO o 1/0.'); break;
          case 'decimal3': case 'decimal4': case 'decimal6': {
            const dec = c.tipo === 'decimal3' ? 3 : c.tipo === 'decimal4' ? 4 : 6;
            const q = dec === 3 ? aMilesimas(v) : escalado(v, dec);
            if (q === null) err(typeof v === 'string' ? 'Número escrito como texto: ingrese una celda numérica.' : `Número inválido, fuera de rango o con más de ${dec} decimales.`);
            else if (q < 0) err('No se admiten valores negativos.'); else r[c.nombre] = q;
            break;
          }
          case 'entero': if (typeof v !== 'number' || !Number.isSafeInteger(v)) err('Se espera un número entero.'); else if (v < 0) err('No se admiten negativos.'); else r[c.nombre] = v; break;
          case 'real': if (typeof v !== 'number' || !Number.isFinite(v)) err(typeof v === 'string' ? 'Número escrito como texto: ingrese una celda numérica.' : 'Número inválido.'); else r[c.nombre] = v; break;
          case 'fecha': { const d = fechaIso(v); if (!d) err('Fecha inválida. Use una fecha de Excel o AAAA-MM-DD.'); else r[c.nombre] = d; break; }
          case 'instante': { const d = instanteIso(v); if (!d) err('Fecha y hora inválidas. Use fecha/hora de Excel o AAAA-MM-DDTHH:MM (hora de Lima).'); else r[c.nombre] = d; break; }
        }
      }
      const clave = spec.pk.map((k) => String(r[k] ?? '')).join('|');
      if (spec.pk.length && spec.pk.every((k) => r[k] !== undefined && r[k] !== null)) {
        const prev = vistos.get(clave);
        if (prev !== undefined) { errores.push({ hoja: spec.hoja, celda: String(r['__ref:' + spec.pk[0]] ?? ''), fila: f.fila, columna: spec.pk.join('+'), valor: clave, mensaje: `Identificador duplicado (también en la fila ${prev}).` }); filaOk = false; }
        else vistos.set(clave, f.fila);
      }
      if (filaOk) regs.push(r);
      else if (spec.pk.length === 1 && r[spec.pk[0]] != null) { if (!rechazadas.has(spec.hoja)) rechazadas.set(spec.hoja, new Set()); rechazadas.get(spec.hoja)!.add(String(r[spec.pk[0]])); }
    }
    datos[spec.hoja] = regs;
  }
  const e = (hoja: string, r: Registro, col: string, mensaje: string) => errores.push({ hoja, celda: String(r['__ref:' + col] ?? ''), fila: Number(r.__fila), columna: col, valor: String(r[col] ?? ''), mensaje });
  for (const spec of CONTRATO) for (const fk of spec.fks ?? []) {
    const ref = CONTRATO.find((s) => s.hoja === fk.hoja)!;
    if (fallidas.has(fk.hoja) && !ref.opcional) continue; // la hoja referida ya está rechazada: evita errores en cascada
    if (ref.opcional && !(datos[fk.hoja] ?? []).length) continue; // sin hoja opcional se valida contra lo existente al confirmar
    const destino = new Set((datos[fk.hoja] ?? []).map((r) => String(r[fk.colDestino ?? fk.col])));
    for (const r of datos[spec.hoja] ?? []) {
      if (r[fk.col] === null || r[fk.col] === undefined) continue;
      if (rechazadas.get(fk.hoja)?.has(String(r[fk.col]))) continue; // la fila referida ya tiene su propio error
      if (!destino.has(String(r[fk.col]))) e(spec.hoja, r, fk.col, `Referencia inexistente en la hoja ${fk.hoja}.`);
    }
  }
  for (const r of datos.Productos ?? []) if (Number(r.peso_kg_por_unidad) <= 0) e('Productos', r, 'peso_kg_por_unidad', 'Debe ser mayor que cero.');
  for (const r of datos.Productos ?? []) if (Number(r.volumen_m3_por_unidad) <= 0) e('Productos', r, 'volumen_m3_por_unidad', 'Debe ser mayor que cero.');
  for (const r of datos.Conversiones ?? []) if (Number(r.unidades_base_por_presentacion) <= 0) e('Conversiones', r, 'unidades_base_por_presentacion', 'El factor debe ser positivo.');
  const conv = new Map((datos.Conversiones ?? []).map((c) => [String(c.presentacion_id), c]));
  for (const r of datos.PedidoDetalle ?? []) {
    const c = conv.get(String(r.presentacion_id));
    if (c && c.producto_id !== r.producto_id) e('PedidoDetalle', r, 'presentacion_id', `La presentación pertenece al producto ${c.producto_id}, no a ${r.producto_id}.`);
    if (Number(r.cantidad_presentacion) <= 0) e('PedidoDetalle', r, 'cantidad_presentacion', 'Debe ser mayor que cero.');
    if (c && Number(r.cantidad_presentacion) > 0) {
      const p = BigInt(Number(r.cantidad_presentacion)) * BigInt(Number(c.unidades_base_por_presentacion));
      if (p % 1000n !== 0n) e('PedidoDetalle', r, 'cantidad_presentacion', 'La conversión a unidad base tendría más de 3 decimales.');
      else if (p / 1000n > BigInt(Number.MAX_SAFE_INTEGER)) e('PedidoDetalle', r, 'cantidad_presentacion', 'La cantidad convertida supera el rango soportado.');
    }
  }
  const nodos = new Map((datos.NodosLogisticos ?? []).map((n) => [String(n.nodo_id), n]));
  for (const r of datos.MovimientosIniciales ?? []) {
    if (Number(r.cantidad_base) <= 0) e('MovimientosIniciales', r, 'cantidad_base', 'La cantidad debe ser positiva.');
    const n = nodos.get(String(r.nodo_id));
    if (n && n.tipo !== 'ALMACEN') e('MovimientosIniciales', r, 'nodo_id', 'Los saldos de apertura solo se registran en almacenes.');
  }
  if (!(datos.NodosLogisticos ?? []).some((n) => n.tipo === 'TRANSITO')) errores.push({ hoja: 'NodosLogisticos', celda: '', fila: '', columna: 'tipo', valor: '', mensaje: 'Debe existir al menos un nodo de tipo TRANSITO.' });
  for (const r of datos.Lotes ?? []) if (String(r.fecha_vencimiento) < String(r.fecha_fabricacion)) e('Lotes', r, 'fecha_vencimiento', 'El vencimiento es anterior a la fabricación.');
  const partidas = new Map<string, Registro>();
  for (const r of datos.Lotes ?? []) {
    const k = `${r.producto_id}|${r.codigo_lote}`;
    const p = partidas.get(k);
    if (p) e('Lotes', r, 'codigo_lote', `La partida ${r.codigo_lote} del producto ${r.producto_id} ya está registrada como ${p.lote_id} (fila ${p.__fila}); registre las existencias por nodo en un solo lote.`);
    else partidas.set(k, r);
  }
  for (const r of datos.Pedidos ?? []) if (Date.parse(String(r.ventana_fin)) <= Date.parse(String(r.ventana_inicio))) e('Pedidos', r, 'ventana_fin', 'La ventana debe terminar después de empezar.');
  const destinos = new Map((datos.Destinos ?? []).map((d) => [String(d.destino_id), d]));
  for (const r of datos.Pedidos ?? []) { const d = destinos.get(String(r.destino_id)); if (d && d.cliente_id !== r.cliente_id) e('Pedidos', r, 'destino_id', `El destino pertenece al cliente ${d.cliente_id}.`); }
  for (const r of datos.Destinos ?? []) {
    if ((r.latitud === null) !== (r.longitud === null)) e('Destinos', r, 'longitud', 'Latitud y longitud se registran juntas o ninguna.');
    if (r.latitud !== null && Math.abs(Number(r.latitud)) > 90) e('Destinos', r, 'latitud', 'Fuera de rango [−90, 90]. ¿Intercambió latitud y longitud?');
    if (r.longitud !== null && Math.abs(Number(r.longitud)) > 180) e('Destinos', r, 'longitud', 'Fuera de rango [−180, 180].');
    if (r.codigo_territorial !== null && r.catalogo_territorial === null) e('Destinos', r, 'catalogo_territorial', 'Un código territorial exige declarar su catálogo.');
    if (r.latitud === null && r.precision_geografica !== 'DESCONOCIDA') e('Destinos', r, 'precision_geografica', 'Sin coordenadas la precisión es DESCONOCIDA.');
  }
  for (const r of datos.EnlacesMultimodales ?? []) {
    if (r.nodo_origen_id === r.nodo_destino_id) e('EnlacesMultimodales', r, 'nodo_destino_id', 'Origen y destino deben ser distintos.');
    if (!(Number(r.duracion_h) > 0)) e('EnlacesMultimodales', r, 'duracion_h', 'La duración debe ser positiva.');
    if (!(Number(r.min_h) > 0 && Number(r.min_h) <= Number(r.moda_h) && Number(r.moda_h) <= Number(r.max_h))) e('EnlacesMultimodales', r, 'moda_h', 'Se exige 0 < mínimo ≤ moda ≤ máximo.');
    if (!(Number(r.prob_incidencia) >= 0 && Number(r.prob_incidencia) <= 1)) e('EnlacesMultimodales', r, 'prob_incidencia', 'La probabilidad debe estar entre 0 y 1.');
  }
  for (const r of datos.ServiciosTransporte ?? []) if (!(Date.parse(String(r.llegada)) > Date.parse(String(r.salida)))) e('ServiciosTransporte', r, 'llegada', 'La llegada debe ser posterior a la salida.');
  // E04/AC02: un mismo vehículo o embarcación no puede estar en dos servicios programados que se solapan
  const porRecurso = new Map<string, NonNullable<ConjuntoValidado[string]>>();
  for (const r of datos.ServiciosTransporte ?? []) if (r.estado !== 'CANCELADO' && r.recurso_id) porRecurso.set(String(r.recurso_id), [...(porRecurso.get(String(r.recurso_id)) ?? []), r]);
  for (const [rec, xs] of porRecurso) {
    const o = [...xs].sort((a, b) => Date.parse(String(a.salida)) - Date.parse(String(b.salida)));
    for (let i = 1; i < o.length; i++) if (Date.parse(String(o[i].salida)) < Date.parse(String(o[i - 1].llegada)))
      e('ServiciosTransporte', o[i], 'recurso_id', `El recurso ${rec} ya está asignado al servicio ${o[i - 1].servicio_id} (${String(o[i - 1].salida).slice(0, 16)}–${String(o[i - 1].llegada).slice(0, 16)}), que se solapa con este.`);
  }
  for (const r of datos.Recursos ?? []) for (const c of ['capacidad_kg', 'capacidad_m3']) if (!(Number(r[c]) > 0)) e('Recursos', r, c, 'Debe ser mayor que cero.');
  for (const r of datos.CondicionesAcceso ?? []) if (!(Date.parse(String(r.vigente_hasta)) > Date.parse(String(r.vigente_desde)))) e('CondicionesAcceso', r, 'vigente_hasta', 'Debe ser posterior a vigente_desde.');
  for (const r of datos.RolesAsignados ?? []) if (r.vigente_hasta !== null && String(r.vigente_hasta) <= String(r.vigente_desde)) e('RolesAsignados', r, 'vigente_hasta', 'Debe ser posterior a vigente_desde.');
  for (const r of datos.LimitesTerritoriales ?? []) if (!(Number(r.lat_min) < Number(r.lat_max) && Number(r.lon_min) < Number(r.lon_max))) e('LimitesTerritoriales', r, 'lat_max', 'Los mínimos deben ser menores que los máximos.');
  return { errores, advertencias, datos };
}
