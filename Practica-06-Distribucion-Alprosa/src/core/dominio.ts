// Reglas de negocio de I03: maestros, pedidos, inventario por lote y nodo, multi-origen, disponibilidad a fecha y propuestas.
// Toda escritura pasa por un comando/transacción y revalida permisos al confirmar.
import type { Repo, Fila } from './db';
import { exigir, actor } from './permisos';
import { nuevoId, aLima, fmtNum } from './util';

export class ErrorValidacion extends Error {
  constructor(public campos: Record<string, string>) { super(Object.entries(campos).map(([c, m]) => `${c}: ${m}`).join(' · ')); }
}
const hoyDe = (instante: string) => instante.slice(0, 10);
const sumaDias = (fecha: string, n: number) => new Date(Date.parse(fecha + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);

// ---------------------------------------------------------------- Metrología y precisión (AQ01, AQ02, AQ08, A04)
/** Multiplicación exacta de cantidades en milésimas: (a/1000)×(b/1000) → milésimas; rechaza pérdida de precisión o desborde. */
export function multMil(aMil: number, bMil: number): number {
  const p = BigInt(aMil) * BigInt(bMil);
  if (p % 1000n !== 0n) throw new Error('El resultado tendría más de 3 decimales; revise la cantidad o el factor de conversión.');
  const r = p / 1000n;
  if (r > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('La cantidad supera el rango numérico soportado; no se registró.');
  return Number(r);
}
/** Reparto exacto: porciones iguales a 0,001 y remanente a la última rama (AQ02). */
export function repartir(qMil: number, n: number): number[] {
  if (!Number.isInteger(n) || n < 1) throw new Error('Número de porciones inválido.');
  const base = Math.floor(qMil / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? qMil - base * (n - 1) : base));
}
/** No se suman cantidades de unidades distintas (A04, I06). */
export function sumarCompatibles(items: { q_mil: number; unidad: string }[]): { unidad: string; q_mil: number } {
  const u = new Set(items.map((i) => i.unidad));
  if (u.size > 1) throw new Error(`No se pueden sumar cantidades en unidades distintas (${[...u].join(', ')}); convierta primero a una unidad común.`);
  return { unidad: items[0]?.unidad ?? '', q_mil: items.reduce((a, i) => a + i.q_mil, 0) };
}

// ---------------------------------------------------------------- Parámetros versionados
export const PARAMETROS_INICIALES: [string, string, string, string, string][] = [
  ['ttl_propuesta_min', 'entero', '30', 'min', 'Vigencia de una propuesta de fecha [inicio, vencimiento)'],
  ['plazo_fijo_dias', 'entero', '3', 'días', 'Estimación ingenua por plazo fijo, solo como referencia (AP08)'],
  ['ajuste_doble_revision', 'booleano', 'true', '—', 'Un ajuste de inventario lo aprueba otra persona con rol Supervisión'],
  ['preparacion_min', 'entero', '60', 'min', 'Tiempo de preparación antes de la primera salida desde el almacén'],
  ['clima_vigencia_min', 'entero', '60', 'min', 'Vigencia de una lectura de clima antes de volver a consultar'],
  ['alerta_verificacion_h', 'entero', '24', 'h', 'Horas en verificación tras las que una entrega genera alerta'],
  ['alerta_plazo_h', 'entero', '8', 'h', 'Plazo de atención de una alerta antes de escalarla a supervisión'],
  ['rto_meta_s', 'entero', '60', 's', 'Meta de tiempo de recuperación (RTO): restaurar y verificar una copia'],
  ['rpo_meta_h', 'entero', '24', 'h', 'Meta de pérdida máxima de datos (RPO): antigüedad de la última copia válida'],
  ['almacenamiento_alerta_mb', 'entero', '200', 'MB', 'Tamaño de la base a partir del cual se avisa (no se borra historia)'],
];
export function parametro(repo: Repo, clave: string, instante = repo.reloj()): string {
  const f = repo.uno('SELECT valor FROM parametro WHERE clave = ? AND vigente_desde <= ? ORDER BY version DESC LIMIT 1', [clave, instante]);
  if (!f) throw new Error(`Parámetro no configurado: ${clave}`);
  return String(f.valor);
}
export function asegurarParametros(repo: Repo) {
  const t = repo.reloj();
  for (const [k, tipo, v, u, motivo] of PARAMETROS_INICIALES)
    if (!repo.uno('SELECT 1 FROM parametro WHERE clave = ?', [k])) repo.run('INSERT INTO parametro VALUES (?,1,?,?,?,?,?,?,?)', [k, tipo, v, u, '2026-01-01T00:00:00-05:00', 'SISTEMA', t, motivo]);
}
export function cambiarParametro(repo: Repo, usuario: string, clave: string, valor: string, desde: string, motivo: string, versionBase?: number) {
  return repo.transaccion(() => {
    const a = exigir(repo, usuario, 'EDITAR_PARAMETROS');
    const act = repo.uno('SELECT * FROM parametro WHERE clave = ? ORDER BY version DESC LIMIT 1', [clave]);
    if (!act) throw new Error('Parámetro inexistente.');
    // BB03: si otra sesión publicó una versión después de que se abrió el formulario, no gana el último en silencio
    if (versionBase !== undefined && Number(act.version) !== versionBase) throw new Error(`Conflicto: «${clave}» pasó a la versión ${act.version} mientras editaba (usted partió de la ${versionBase}). Revise el valor nuevo y repita el cambio.`);
    if (act.tipo === 'entero' && /^\d+$/.test(valor) && /plazo|capacidad|vigencia|_h$|_min$|_dias$/.test(clave) && Number(valor) === 0) throw new ErrorValidacion({ valor: 'El valor 0 desactivaría la regla: use un valor positivo.' });
    if (act.tipo === 'entero' && !/^\d+$/.test(valor)) throw new ErrorValidacion({ valor: 'Se espera un entero no negativo.' });
    if (act.tipo === 'booleano' && !['true', 'false'].includes(valor)) throw new ErrorValidacion({ valor: 'Se espera true o false.' });
    if (!motivo || motivo.trim().length < 5) throw new ErrorValidacion({ motivo: 'Indique el motivo del cambio.' });
    repo.run('INSERT INTO parametro VALUES (?,?,?,?,?,?,?,?,?)', [clave, Number(act.version) + 1, act.tipo, valor, act.unidad, desde, usuario, repo.reloj(), motivo]);
    repo.auditar(a, 'CAMBIAR_PARAMETRO', null, { clave, antes: act.valor, despues: valor, desde });
  });
}

// ---------------------------------------------------------------- Maestros (A01–A08, AT01–AT07)
type Campo = { col: string; tipo: 'texto' | 'mil' | 'entero' | 'bool' | 'real' | 'enum'; obligatorio: boolean; valores?: string[]; min?: number };
export const MAESTROS: Record<string, { tabla: string; pk: string; campos: Campo[] }> = {
  producto: { tabla: 'producto', pk: 'producto_id', campos: [
    { col: 'producto_id', tipo: 'texto', obligatorio: true }, { col: 'nombre_generico', tipo: 'texto', obligatorio: true }, { col: 'familia', tipo: 'texto', obligatorio: true },
    { col: 'unidad_base', tipo: 'enum', obligatorio: true, valores: ['kg', 'unidad'] }, { col: 'peso_kg_por_unidad_mil', tipo: 'mil', obligatorio: true, min: 1 },
    { col: 'vol_cm3_por_unidad', tipo: 'entero', obligatorio: true, min: 1 }, { col: 'fraccionable', tipo: 'bool', obligatorio: true }, { col: 'activo', tipo: 'bool', obligatorio: true } ] },
  presentacion: { tabla: 'presentacion', pk: 'presentacion_id', campos: [
    { col: 'presentacion_id', tipo: 'texto', obligatorio: true }, { col: 'producto_id', tipo: 'texto', obligatorio: true }, { col: 'nombre', tipo: 'texto', obligatorio: true },
    { col: 'factor_base_mil', tipo: 'mil', obligatorio: true, min: 1 }, { col: 'activo', tipo: 'bool', obligatorio: true } ] },
  cliente: { tabla: 'cliente', pk: 'cliente_id', campos: [
    { col: 'cliente_id', tipo: 'texto', obligatorio: true }, { col: 'nombre_ficticio', tipo: 'texto', obligatorio: true }, { col: 'activo', tipo: 'bool', obligatorio: true } ] },
  nodo: { tabla: 'nodo', pk: 'nodo_id', campos: [
    { col: 'nodo_id', tipo: 'texto', obligatorio: true }, { col: 'nombre', tipo: 'texto', obligatorio: true }, { col: 'tipo', tipo: 'enum', obligatorio: true, valores: ['ALMACEN', 'TRANSITO', 'TRANSBORDO', 'DESTINO'] },
    { col: 'region', tipo: 'texto', obligatorio: true }, { col: 'capacidad_almacen_kg_mil', tipo: 'mil', obligatorio: false, min: 0 },
    { col: 'permite_espera_nocturna', tipo: 'bool', obligatorio: true }, { col: 'activo', tipo: 'bool', obligatorio: true } ] },
  destino: { tabla: 'destino', pk: 'destino_id', campos: [
    { col: 'destino_id', tipo: 'texto', obligatorio: true }, { col: 'cliente_id', tipo: 'texto', obligatorio: true }, { col: 'nombre_ficticio', tipo: 'texto', obligatorio: true },
    { col: 'region', tipo: 'texto', obligatorio: true }, { col: 'codigo_territorial', tipo: 'texto', obligatorio: false }, { col: 'catalogo_territorial', tipo: 'texto', obligatorio: false },
    { col: 'version_catalogo', tipo: 'texto', obligatorio: false }, { col: 'latitud', tipo: 'real', obligatorio: false }, { col: 'longitud', tipo: 'real', obligatorio: false },
    { col: 'precision_geografica', tipo: 'enum', obligatorio: true, valores: ['EXACTA', 'APROXIMADA', 'CENTROIDE', 'DESCONOCIDA'] }, { col: 'nodo_id', tipo: 'texto', obligatorio: true },
    { col: 'acepta_anticipadas', tipo: 'bool', obligatorio: true }, { col: 'vida_util_min_dias', tipo: 'entero', obligatorio: true, min: 0 }, { col: 'activo', tipo: 'bool', obligatorio: true } ] },
  lote: { tabla: 'lote', pk: 'lote_id', campos: [
    { col: 'lote_id', tipo: 'texto', obligatorio: true }, { col: 'producto_id', tipo: 'texto', obligatorio: true }, { col: 'codigo_lote', tipo: 'texto', obligatorio: true },
    { col: 'fecha_fabricacion', tipo: 'texto', obligatorio: true }, { col: 'fecha_vencimiento', tipo: 'texto', obligatorio: true },
    { col: 'estado_lote', tipo: 'enum', obligatorio: true, valores: ['LIBERADO', 'BLOQUEADO'] } ] },
};

function validarCampos(def: (typeof MAESTROS)[string], datos: Record<string, unknown>) {
  const err: Record<string, string> = {};
  const limpio: Record<string, string | number | null> = {};
  for (const c of def.campos) {
    const v = datos[c.col];
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
      if (c.obligatorio) err[c.col] = 'Obligatorio.';
      else limpio[c.col] = null;
      continue;
    }
    switch (c.tipo) {
      case 'texto': if (typeof v !== 'string') err[c.col] = 'Debe ser texto (los códigos con ceros iniciales se conservan como texto).'; else limpio[c.col] = v.normalize('NFC').trim(); break;
      case 'enum': if (!c.valores!.includes(String(v))) err[c.col] = 'Valor no permitido: ' + c.valores!.join(', '); else limpio[c.col] = String(v); break;
      case 'bool': if (![0, 1, true, false].includes(v as never)) err[c.col] = 'Sí/No.'; else limpio[c.col] = v === true || v === 1 ? 1 : 0; break;
      case 'mil': case 'entero': {
        const n = Number(v);
        if (!Number.isSafeInteger(n)) err[c.col] = 'Número inválido o fuera de rango.';
        else if (c.min !== undefined && n < c.min) err[c.col] = c.min === 0 ? 'No puede ser negativo.' : 'Debe ser mayor que cero.';
        else limpio[c.col] = n;
        break;
      }
      case 'real': { const n = Number(v); if (!Number.isFinite(n)) err[c.col] = 'Número inválido.'; else limpio[c.col] = n; break; }
    }
  }
  return { err, limpio };
}

/** Alta o edición de un maestro con validación por campo y versión histórica (A01–A03, A05, A06). */
export function guardarMaestro(repo: Repo, usuario: string, entidad: keyof typeof MAESTROS, datos: Record<string, unknown>, modo: 'alta' | 'edicion', motivo = 'Mantenimiento de maestro') {
  const def = MAESTROS[entidad];
  return repo.transaccion(() => {
    const a = exigir(repo, usuario, 'EDITAR_MAESTROS');
    const { err, limpio } = validarCampos(def, datos);
    if (entidad === 'lote' && limpio.fecha_vencimiento && limpio.fecha_fabricacion && String(limpio.fecha_vencimiento) < String(limpio.fecha_fabricacion)) err.fecha_vencimiento = 'Anterior a la fabricación.';
    if (entidad === 'destino') Object.assign(err, validarTerritorio(limpio));
    for (const [col, ref] of [['producto_id', 'producto'], ['cliente_id', 'cliente'], ['nodo_id', 'nodo']] as const)
      if (col in limpio && col !== def.pk && limpio[col] && !repo.uno(`SELECT 1 FROM ${ref} WHERE ${col} = ?`, [limpio[col]])) err[col] = 'No existe.';
    const id = limpio[def.pk];
    const previo = id ? repo.uno(`SELECT * FROM ${def.tabla} WHERE ${def.pk} = ?`, [id]) : undefined;
    if (modo === 'alta' && previo) err[def.pk] = 'Ya existe un registro con este código.';
    if (modo === 'edicion' && !previo) err[def.pk] = 'No existe el registro a editar.';
    if (Object.keys(err).length) throw new ErrorValidacion(err);
    const cols = def.campos.map((c) => c.col);
    if (modo === 'alta') {
      repo.run(`INSERT INTO ${def.tabla}(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map((c) => limpio[c]));
    } else {
      repo.run(`UPDATE ${def.tabla} SET ${cols.filter((c) => c !== def.pk).map((c) => `${c} = ?`).join(', ')}${entidad === 'lote' ? '' : ', revision = revision + 1'} WHERE ${def.pk} = ?`,
        [...cols.filter((c) => c !== def.pk).map((c) => limpio[c]), id]);
    }
    const despues = repo.uno(`SELECT * FROM ${def.tabla} WHERE ${def.pk} = ?`, [id])!;
    repo.run('INSERT INTO maestro_historial(entidad, entidad_id, revision, antes, despues, usuario_id, registrado_en, motivo) VALUES (?,?,?,?,?,?,?,?)',
      [entidad, String(id), Number(despues.revision ?? 1), previo ? JSON.stringify(previo) : null, JSON.stringify(despues), usuario, repo.reloj(), motivo]);
    repo.auditar(a, modo === 'alta' ? 'ALTA_MAESTRO' : 'EDITAR_MAESTRO', null, { entidad, id });
    return String(id);
  });
}

/** Inactivar no borra historia y bloquea nuevas selecciones; las operaciones existentes continúan (A07). */
export function cambiarActivo(repo: Repo, usuario: string, entidad: 'producto' | 'presentacion' | 'cliente' | 'nodo' | 'destino', id: string, activo: boolean) {
  const def = MAESTROS[entidad];
  const f = repo.uno(`SELECT * FROM ${def.tabla} WHERE ${def.pk} = ?`, [id]);
  if (!f) throw new Error('No existe.');
  return guardarMaestro(repo, usuario, entidad, { ...f, activo: activo ? 1 : 0 }, 'edicion', activo ? 'Reactivación' : 'Inactivación');
}

/** Territorio: código como texto, catálogo/versión, coordenadas en par y en rango (AT02, AT03, AT05). */
function validarTerritorio(d: Record<string, string | number | null>): Record<string, string> {
  const e: Record<string, string> = {};
  if (d.codigo_territorial !== null && d.catalogo_territorial === null) e.catalogo_territorial = 'Un código territorial exige declarar su catálogo y versión.';
  if ((d.latitud === null) !== (d.longitud === null)) e.longitud = 'Latitud y longitud se registran juntas o ninguna.';
  if (d.latitud !== null && Math.abs(Number(d.latitud)) > 90) e.latitud = 'Fuera de rango [−90, 90]. ¿Intercambió latitud y longitud?';
  if (d.longitud !== null && Math.abs(Number(d.longitud)) > 180) e.longitud = 'Fuera de rango [−180, 180].';
  if (d.latitud === null && d.precision_geografica && d.precision_geografica !== 'DESCONOCIDA') e.precision_geografica = 'Sin coordenadas la precisión es DESCONOCIDA.';
  return e;
}

/** Verificación espacial SOLO con límites confiables cargados; sin ellos queda pendiente (AT04, AT05, AT06). */
export function verificacionTerritorial(repo: Repo, destinoId: string): { estado: 'PENDIENTE' | 'CONSISTENTE' | 'INCONSISTENTE' | 'SIN_COORDENADAS'; detalle: string } {
  const d = repo.uno('SELECT * FROM destino WHERE destino_id = ?', [destinoId]);
  if (!d) throw new Error('Destino inexistente.');
  if (d.latitud === null) return { estado: 'SIN_COORDENADAS', detalle: 'Sin coordenadas; la última milla requiere verificación.' };
  const lim = repo.uno('SELECT * FROM limite_region WHERE region = ?', [d.region]);
  const prec = d.precision_geografica === 'CENTROIDE' ? ' La coordenada es un centroide: no es el punto de entrega ni sirve para distancia carretera.' : '';
  if (!lim) return { estado: 'PENDIENTE', detalle: 'No hay límites territoriales confiables cargados para esta región; verificación pendiente.' + prec };
  const dentro = Number(d.latitud) >= Number(lim.lat_min) && Number(d.latitud) <= Number(lim.lat_max) && Number(d.longitud) >= Number(lim.lon_min) && Number(d.longitud) <= Number(lim.lon_max);
  return dentro ? { estado: 'CONSISTENTE', detalle: `Dentro de los límites de ${d.region} (fuente: ${lim.fuente}).` + prec }
    : { estado: 'INCONSISTENTE', detalle: `Las coordenadas caen fuera de los límites cargados para ${d.region} (fuente: ${lim.fuente}). Revise; no se corrige automáticamente.` };
}

/** Cambio administrativo de código sin mudanza: alias histórico y misma identidad (AT07). */
export function cambiarCodigoTerritorial(repo: Repo, usuario: string, destinoId: string, nuevoCodigo: string, catalogo: string, version: string, motivo: string) {
  return repo.transaccion(() => {
    exigir(repo, usuario, 'EDITAR_MAESTROS');
    const d = repo.uno('SELECT * FROM destino WHERE destino_id = ?', [destinoId]);
    if (!d) throw new Error('Destino inexistente.');
    if (d.codigo_territorial) repo.run('INSERT INTO destino_alias VALUES (?,?,?,?,?,?)', [destinoId, d.codigo_territorial, d.catalogo_territorial, d.version_catalogo, repo.reloj(), motivo]);
    return guardarMaestro(repo, usuario, 'destino', { ...d, codigo_territorial: nuevoCodigo, catalogo_territorial: catalogo, version_catalogo: version }, 'edicion', motivo);
  });
}

/** Tarifas por vigencia: una nueva versión no recalcula cierres (A08). */
export function registrarTarifa(repo: Repo, usuario: string, t: { tarifa_id: string; modo: string; base_fija_cent: number; costo_kg_p4: number; minimo_cent: number; vigente_desde: string }) {
  return repo.transaccion(() => {
    exigir(repo, usuario, 'EDITAR_MAESTROS');
    const prev = repo.uno('SELECT * FROM tarifa WHERE tarifa_id = ? ORDER BY version DESC LIMIT 1', [t.tarifa_id]);
    if (prev && String(prev.vigente_desde) >= t.vigente_desde) throw new ErrorValidacion({ vigente_desde: 'Debe ser posterior al inicio de la versión vigente.' });
    if (prev) repo.run('UPDATE tarifa SET vigente_hasta = ? WHERE tarifa_id = ? AND version = ?', [t.vigente_desde, t.tarifa_id, prev.version]);
    const v = prev ? Number(prev.version) + 1 : 1;
    repo.run('INSERT INTO tarifa VALUES (?,?,?,?,?,?,?,?,NULL,?)', [t.tarifa_id, v, t.modo, t.base_fija_cent, t.costo_kg_p4, t.minimo_cent, 'PEN', t.vigente_desde, repo.reloj()]);
    return v;
  });
}
export function tarifaVigente(repo: Repo, tarifaId: string, instante: string): Fila | undefined {
  return repo.uno('SELECT * FROM tarifa WHERE tarifa_id = ? AND vigente_desde <= ? AND (vigente_hasta IS NULL OR vigente_hasta > ?)', [tarifaId, instante, instante]);
}

// ---------------------------------------------------------------- Inventario (D01–D08, RN-06/07, DEC-I01-D3)
export interface Existencia { lote_id: string; codigo_lote: string; producto_id: string; nodo_id: string; tipo_nodo: string; condicion: string; fecha_vencimiento: string; estado_lote: string; fisico_mil: number; reservado_mil: number; disponible_mil: number; motivo_no_disponible: string }

export function existencias(repo: Repo, hoy = hoyDe(repo.reloj())): Existencia[] {
  const filas = repo.todos(`
    WITH s AS (
      SELECT lote_id, nodo_destino_id AS nodo_id, condicion, q_mil AS q FROM movimiento WHERE nodo_destino_id IS NOT NULL
      UNION ALL SELECT lote_id, nodo_origen_id, condicion, -q_mil FROM movimiento WHERE nodo_origen_id IS NOT NULL
    ), sal AS (SELECT lote_id, nodo_id, condicion, SUM(q) AS fisico FROM s GROUP BY 1,2,3),
    res AS (SELECT lote_id, nodo_id, SUM(q_mil) AS reservado FROM reserva WHERE estado = 'ACTIVA' GROUP BY 1,2)
    SELECT sal.lote_id, l.codigo_lote, l.producto_id, sal.nodo_id, n.tipo AS tipo_nodo, sal.condicion, l.fecha_vencimiento, l.estado_lote, sal.fisico,
           CASE WHEN sal.condicion = 'APTO' THEN COALESCE(res.reservado, 0) ELSE 0 END AS reservado
    FROM sal JOIN lote l USING (lote_id) JOIN nodo n ON n.nodo_id = sal.nodo_id
    LEFT JOIN res ON res.lote_id = sal.lote_id AND res.nodo_id = sal.nodo_id
    WHERE sal.fisico <> 0 OR COALESCE(res.reservado,0) <> 0
    ORDER BY l.producto_id, l.fecha_vencimiento, l.codigo_lote, sal.nodo_id`);
  return filas.map((f) => {
    const fisico = Number(f.fisico), reservado = Number(f.reservado);
    let motivo = '';
    if (f.condicion !== 'APTO') motivo = 'Condición ' + f.condicion;
    else if (f.estado_lote !== 'LIBERADO') motivo = 'Lote bloqueado';
    else if (String(f.fecha_vencimiento) < hoy) motivo = 'Vencido';
    else if (f.tipo_nodo !== 'ALMACEN') motivo = f.tipo_nodo === 'TRANSITO' ? 'En tránsito' : 'No es almacén';
    return { lote_id: String(f.lote_id), codigo_lote: String(f.codigo_lote), producto_id: String(f.producto_id), nodo_id: String(f.nodo_id), tipo_nodo: String(f.tipo_nodo),
      condicion: String(f.condicion), fecha_vencimiento: String(f.fecha_vencimiento), estado_lote: String(f.estado_lote), fisico_mil: fisico, reservado_mil: reservado,
      disponible_mil: motivo ? 0 : fisico - reservado, motivo_no_disponible: motivo };
  });
}

/** Invariantes de integridad de cantidades, verificados al final de cada comando (DEC-I01-D3). */
export function verificarInvariantes(repo: Repo) {
  const neg = repo.todos(`WITH s AS (SELECT lote_id, nodo_destino_id n, condicion c, q_mil q FROM movimiento WHERE nodo_destino_id IS NOT NULL
      UNION ALL SELECT lote_id, nodo_origen_id, condicion, -q_mil FROM movimiento WHERE nodo_origen_id IS NOT NULL)
    SELECT lote_id, n, c, SUM(q) t FROM s GROUP BY 1,2,3 HAVING SUM(q) < 0`);
  if (neg.length) throw new Error(`Invariante violado: saldo negativo del lote ${neg[0].lote_id} en ${neg[0].n}. Operación revertida.`);
  const sobre = repo.todos(`WITH s AS (SELECT lote_id, nodo_destino_id n, q_mil q FROM movimiento WHERE nodo_destino_id IS NOT NULL AND condicion='APTO'
      UNION ALL SELECT lote_id, nodo_origen_id, -q_mil FROM movimiento WHERE nodo_origen_id IS NOT NULL AND condicion='APTO'),
    f AS (SELECT lote_id, n, SUM(q) t FROM s GROUP BY 1,2), r AS (SELECT lote_id, nodo_id n, SUM(q_mil) t FROM reserva WHERE estado='ACTIVA' GROUP BY 1,2)
    SELECT r.lote_id, r.n FROM r LEFT JOIN f USING (lote_id, n) WHERE r.t > COALESCE(f.t, 0)`);
  if (sobre.length) throw new Error(`Invariante violado: reservas mayores que el saldo apto del lote ${sobre[0].lote_id} en ${sobre[0].n}. Operación revertida.`);
}

/** Balance canónico por lote (DEC-I01-D3): entradas externas − salidas externas = Σ ubicaciones (incluye tránsito). */
export function balanceLote(repo: Repo, loteId: string) {
  const entradas = repo.num('SELECT COALESCE(SUM(q_mil),0) FROM movimiento WHERE lote_id = ? AND nodo_origen_id IS NULL AND tipo <> \'RECLASIFICACION\'', [loteId]);
  const salidas = repo.num('SELECT COALESCE(SUM(q_mil),0) FROM movimiento WHERE lote_id = ? AND nodo_destino_id IS NULL AND tipo <> \'RECLASIFICACION\'', [loteId]);
  const porTipo = repo.todos(`WITH s AS (SELECT nodo_destino_id n, q_mil q FROM movimiento WHERE lote_id=? AND nodo_destino_id IS NOT NULL UNION ALL SELECT nodo_origen_id, -q_mil FROM movimiento WHERE lote_id=? AND nodo_origen_id IS NOT NULL)
    SELECT nd.tipo, SUM(q) t FROM s JOIN nodo nd ON nd.nodo_id = s.n GROUP BY nd.tipo`, [loteId, loteId]);
  const enNodos = porTipo.filter((f) => f.tipo !== 'TRANSITO').reduce((a, f) => a + Number(f.t), 0);
  const transito = porTipo.filter((f) => f.tipo === 'TRANSITO').reduce((a, f) => a + Number(f.t), 0);
  return { entradas_mil: entradas, salidas_mil: salidas, en_nodos_mil: enNodos, en_transito_mil: transito, cuadra: entradas - salidas === enNodos + transito };
}

function nodoTransito(repo: Repo): string {
  const t = repo.uno("SELECT nodo_id FROM nodo WHERE tipo = 'TRANSITO' AND activo = 1 ORDER BY nodo_id LIMIT 1");
  if (!t) throw new Error('No existe un nodo de tipo TRANSITO activo.');
  return String(t.nodo_id);
}
function disponibleEn(repo: Repo, loteId: string, nodoId: string) {
  return existencias(repo).filter((e) => e.lote_id === loteId && e.nodo_id === nodoId && e.condicion === 'APTO').reduce((a, e) => a + e.disponible_mil, 0);
}

/** Traslado origen→tránsito con transfer_id; el destino lo ve como suministro esperado CONFIRMADO, no como stock (D07, AO08). */
export function trasladar(repo: Repo, usuario: string, p: { lote_id: string; origen: string; destino: string; q_mil: number; fecha_prevista: string }, commandId = nuevoId('CMD')) {
  return repo.comando(commandId, 'TRASLADO_SALIDA', actor(repo, usuario), () => {
    exigir(repo, usuario, 'MOVER_INVENTARIO');
    if (!(p.q_mil > 0)) throw new ErrorValidacion({ cantidad: 'Debe ser positiva.' });
    if (p.origen === p.destino) throw new ErrorValidacion({ destino: 'Debe ser distinto del origen.' });
    const dst = repo.uno("SELECT tipo, activo FROM nodo WHERE nodo_id = ?", [p.destino]);
    if (!dst || dst.activo !== 1 || dst.tipo !== 'ALMACEN') throw new ErrorValidacion({ destino: 'Debe ser un almacén activo.' });
    const disp = disponibleEn(repo, p.lote_id, p.origen);
    if (p.q_mil > disp) throw new ErrorValidacion({ cantidad: `Supera lo disponible sin reservar en el origen (${disp / 1000}).` });
    const tr = nuevoId('TRF'), t = repo.reloj(), transito = nodoTransito(repo);
    const lote = repo.uno('SELECT producto_id FROM lote WHERE lote_id = ?', [p.lote_id])!;
    repo.run('INSERT INTO movimiento VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [nuevoId('MOV'), p.lote_id, p.origen, transito, 'APTO', p.q_mil, t, t, 'TRASLADO_SALIDA', tr, 'Traslado a ' + p.destino, usuario, commandId]);
    repo.run('INSERT INTO suministro_esperado VALUES (?,?,?,?,?,?,?,?,1,?)', [nuevoId('SUM'), lote.producto_id, p.lote_id, p.destino, p.q_mil, p.fecha_prevista, 'CONFIRMADO', tr, t]);
    verificarInvariantes(repo);
    return { transfer_id: tr };
  });
}

/** Recepción del traslado: solo lo recibido entra al destino; la diferencia queda en tránsito en investigación (D07, RN-35). */
export function recibirTraslado(repo: Repo, usuario: string, transferId: string, qRecibidaMil: number, commandId = nuevoId('CMD')) {
  return repo.comando(commandId, 'TRASLADO_RECEPCION', actor(repo, usuario), () => {
    exigir(repo, usuario, 'MOVER_INVENTARIO');
    const sum = repo.uno('SELECT * FROM suministro_esperado WHERE transfer_id = ?', [transferId]);
    if (!sum) throw new Error('Traslado inexistente.');
    if (sum.estado === 'RECIBIDO') throw new Error('El traslado ya fue recibido.');
    if (!(qRecibidaMil > 0) || qRecibidaMil > Number(sum.q_mil)) throw new ErrorValidacion({ cantidad: `Debe estar entre 0,001 y lo enviado (${Number(sum.q_mil) / 1000}).` });
    const t = repo.reloj(), transito = nodoTransito(repo);
    repo.run('INSERT INTO movimiento VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [nuevoId('MOV'), sum.lote_id, transito, sum.nodo_destino_id, 'APTO', qRecibidaMil, t, t, 'TRASLADO_RECEPCION', transferId, null, usuario, commandId]);
    repo.run("UPDATE suministro_esperado SET estado = 'RECIBIDO', revision = revision + 1, actualizado_en = ? WHERE suministro_id = ?", [t, sum.suministro_id]);
    verificarInvariantes(repo);
    const diferencia = Number(sum.q_mil) - qRecibidaMil;
    return { recibido_mil: qRecibidaMil, diferencia_en_investigacion_mil: diferencia };
  });
}


/** Solicitud de ajuste con motivo; la aplica otra persona con rol Supervisión si la política lo exige (D08, BG04). */
export function solicitarAjuste(repo: Repo, usuario: string, p: { lote_id: string; nodo_id: string; condicion: string; q_delta_mil: number; motivo: string }) {
  return repo.transaccion(() => {
    const a = exigir(repo, usuario, 'SOLICITAR_AJUSTE');
    const err: Record<string, string> = {};
    if (!p.motivo || p.motivo.trim().length < 5) err.motivo = 'Obligatorio (mínimo 5 caracteres).';
    if (!Number.isSafeInteger(p.q_delta_mil) || p.q_delta_mil === 0) err.cantidad = 'Debe ser distinta de cero.';
    if (Object.keys(err).length) throw new ErrorValidacion(err);
    const id = nuevoId('AJU');
    repo.run('INSERT INTO solicitud_ajuste VALUES (?,?,?,?,?,?,?,?,?,NULL,NULL,NULL)', [id, p.lote_id, p.nodo_id, p.condicion, p.q_delta_mil, p.motivo.trim(), usuario, repo.reloj(), 'PENDIENTE']);
    repo.auditar(a, 'SOLICITAR_AJUSTE', null, { id, ...p });
    return id;
  });
}
export function resolverAjuste(repo: Repo, usuario: string, ajusteId: string, aprobar: boolean, comentario: string, commandId = nuevoId('CMD')) {
  return repo.comando(commandId, aprobar ? 'APROBAR_AJUSTE' : 'RECHAZAR_AJUSTE', actor(repo, usuario), () => {
    exigir(repo, usuario, 'APROBAR_AJUSTE');
    const s = repo.uno('SELECT * FROM solicitud_ajuste WHERE ajuste_id = ?', [ajusteId]);
    if (!s || s.estado !== 'PENDIENTE') throw new Error('La solicitud no existe o ya fue resuelta.');
    if (parametro(repo, 'ajuste_doble_revision') === 'true' && s.solicitado_por === usuario) throw new Error('La política exige doble revisión: quien solicita el ajuste no puede aprobarlo.');
    const t = repo.reloj();
    if (aprobar) {
      const q = Number(s.q_delta_mil);
      repo.run('INSERT INTO movimiento VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [nuevoId('MOV'), s.lote_id, q < 0 ? s.nodo_id : null, q > 0 ? s.nodo_id : null, s.condicion, Math.abs(q), t, t,
        q > 0 ? 'AJUSTE_POSITIVO' : 'AJUSTE_NEGATIVO', null, s.motivo, usuario, commandId]);
      verificarInvariantes(repo); // impide saldo negativo o dejar reservas sin respaldo (AY08)
    }
    repo.run('UPDATE solicitud_ajuste SET estado = ?, resuelto_por = ?, resuelto_en = ?, comentario_resolucion = ? WHERE ajuste_id = ?', [aprobar ? 'APROBADO' : 'RECHAZADO', usuario, t, comentario, ajusteId]);
    return { ajusteId, estado: aprobar ? 'APROBADO' : 'RECHAZADO' };
  });
}

// ---------------------------------------------------------------- Pedidos (C01–C08, RN-02, RN-03, RN-16)
export interface LineaNueva { pedido_linea_id?: string; producto_id: string; presentacion_id: string; cantidad_presentacion_mil: number; precio_neto_base_p4: number }
export interface PedidoNuevo { pedido_id?: string; cliente_id: string; destino_id: string; fecha_pedido: string; ventana_inicio: string; ventana_fin: string; prioridad: 'NORMAL' | 'URGENTE'; permite_parcial: boolean; permite_entregas_divididas: boolean; responsable_id?: string | null; lineas: LineaNueva[] }

function validarLineas(repo: Repo, lineas: LineaNueva[]) {
  const err: Record<string, string> = {};
  if (!lineas.length) err.lineas = 'El pedido necesita al menos una línea.';
  const out = lineas.map((l, i) => {
    const pr = repo.uno('SELECT * FROM producto WHERE producto_id = ?', [l.producto_id]);
    const ps = repo.uno('SELECT * FROM presentacion WHERE presentacion_id = ? AND producto_id = ?', [l.presentacion_id, l.producto_id]);
    if (!pr || pr.activo !== 1) err[`linea ${i + 1} producto`] = 'Producto inexistente o inactivo.';
    if (!ps || ps.activo !== 1) err[`linea ${i + 1} presentación`] = 'Presentación inexistente, de otro producto o inactiva.';
    if (!Number.isSafeInteger(l.cantidad_presentacion_mil) || l.cantidad_presentacion_mil <= 0) err[`linea ${i + 1} cantidad`] = 'Debe ser mayor que cero.';
    if (!Number.isSafeInteger(l.precio_neto_base_p4) || l.precio_neto_base_p4 < 0) err[`linea ${i + 1} precio`] = 'No puede ser negativo.';
    let q = 0, imp = 0;
    if (ps && !err[`linea ${i + 1} cantidad`]) {
      try { q = multMil(l.cantidad_presentacion_mil, Number(ps.factor_base_mil)); imp = Math.round((q * l.precio_neto_base_p4) / 1e5); if (!Number.isSafeInteger(imp)) throw new Error('Importe fuera de rango.'); }
      catch (e) { err[`linea ${i + 1} cantidad`] = (e as Error).message; }
    }
    return { ...l, factor: Number(ps?.factor_base_mil ?? 0), q, imp, nombre: String(pr?.nombre_generico ?? '') };
  });
  return { err, out };
}

export function crearPedido(repo: Repo, usuario: string, p: PedidoNuevo) {
  return repo.transaccion(() => {
    const a = exigir(repo, usuario, 'GESTIONAR_PEDIDOS');
    const err: Record<string, string> = {};
    const cli = repo.uno('SELECT activo FROM cliente WHERE cliente_id = ?', [p.cliente_id]);
    const des = repo.uno('SELECT activo, cliente_id FROM destino WHERE destino_id = ?', [p.destino_id]);
    if (!cli || cli.activo !== 1) err.cliente = 'Cliente inexistente o inactivo.';
    if (!des || des.activo !== 1) err.destino = 'Destino inexistente o inactivo.';
    else if (des.cliente_id !== p.cliente_id) err.destino = 'El destino no pertenece al cliente.';
    if (!(Date.parse(p.ventana_fin) > Date.parse(p.ventana_inicio))) err.ventana = 'La ventana debe terminar después de empezar.';
    const v = validarLineas(repo, p.lineas);
    Object.assign(err, v.err);
    const id = p.pedido_id?.trim() || 'PED-' + nuevoId('X').split('-')[2].slice(0, 8).toUpperCase();
    if (repo.uno('SELECT 1 FROM pedido WHERE pedido_id = ?', [id])) err.pedido_id = 'Ya existe.';
    if (Object.keys(err).length) throw new ErrorValidacion(err);
    repo.run(`INSERT INTO pedido(pedido_id,cliente_id,destino_id,fecha_pedido,ventana_inicio,ventana_fin,prioridad,permite_parcial,permite_entregas_divididas,estado_base,responsable_id)
      VALUES (?,?,?,?,?,?,?,?,?, 'BORRADOR', ?)`, [id, p.cliente_id, p.destino_id, p.fecha_pedido, p.ventana_inicio, p.ventana_fin, p.prioridad, p.permite_parcial ? 1 : 0, p.permite_entregas_divididas ? 1 : 0, p.responsable_id ?? usuario]);
    v.out.forEach((l, i) => repo.run('INSERT INTO pedido_linea VALUES (?,?,?,?,?,?,?,?,?,0,?)',
      [l.pedido_linea_id || `${id}-${String(i + 1).padStart(2, '0')}`, id, l.producto_id, l.presentacion_id, l.cantidad_presentacion_mil, l.factor, l.q, l.precio_neto_base_p4, l.imp, l.nombre]));
    repo.auditar(a, 'CREAR_PEDIDO', null, { id });
    return id;
  });
}

/** Confirmar: copia el compromiso y el destino como snapshot (RN-02). */
export function confirmarPedido(repo: Repo, usuario: string, pedidoId: string) {
  return repo.transaccion(() => {
    const a = exigir(repo, usuario, 'GESTIONAR_PEDIDOS');
    const p = repo.uno('SELECT * FROM pedido WHERE pedido_id = ?', [pedidoId]);
    if (!p) throw new Error('Pedido inexistente.');
    if (p.estado_base !== 'BORRADOR') throw new Error('Solo un pedido en borrador puede confirmarse.');
    if (!repo.num('SELECT COUNT(*) FROM pedido_linea WHERE pedido_id = ?', [pedidoId])) throw new Error('El pedido no tiene líneas.');
    const d = repo.uno('SELECT * FROM destino WHERE destino_id = ?', [p.destino_id]);
    if (!d || d.activo !== 1) throw new Error('El destino está inactivo: no se puede confirmar.');
    repo.run("UPDATE pedido SET estado_base = 'CONFIRMADO', confirmado_en = ?, snapshot_destino = ?, revision = revision + 1 WHERE pedido_id = ?", [repo.reloj(), JSON.stringify(d), pedidoId]);
    repo.auditar(a, 'CONFIRMAR_PEDIDO', null, { pedidoId });
  });
}

/** Modificar un pedido con reservas exige liberarlas primero (C06). */
export function modificarLinea(repo: Repo, usuario: string, lineaId: string, cantidadPresentacionMil: number) {
  return repo.transaccion(() => {
    const a = exigir(repo, usuario, 'GESTIONAR_PEDIDOS');
    const l = repo.uno('SELECT pl.*, p.estado_base FROM pedido_linea pl JOIN pedido p USING (pedido_id) WHERE pedido_linea_id = ?', [lineaId]);
    if (!l) throw new Error('Línea inexistente.');
    if (l.estado_base === 'CANCELADO') throw new Error('El pedido está cancelado.');
    if (repo.num("SELECT COUNT(*) FROM reserva WHERE pedido_linea_id = ? AND estado IN ('ACTIVA','CONSUMIDA')", [lineaId]) || repo.num("SELECT COUNT(*) FROM compromiso_futuro WHERE pedido_linea_id = ? AND estado = 'ACTIVO'", [lineaId]))
      throw new Error('La línea tiene reservas o compromisos: libérelos primero para revalidar la nueva cantidad.');
    if (!Number.isSafeInteger(cantidadPresentacionMil) || cantidadPresentacionMil <= 0) throw new ErrorValidacion({ cantidad: 'Debe ser mayor que cero.' });
    const q = multMil(cantidadPresentacionMil, Number(l.factor_snapshot_mil));
    repo.run('UPDATE pedido_linea SET cantidad_presentacion_mil = ?, q_solicitada_mil = ?, importe_cent = ? WHERE pedido_linea_id = ?', [cantidadPresentacionMil, q, Math.round((q * Number(l.precio_neto_base_p4)) / 1e5), lineaId]);
    repo.run('UPDATE pedido SET revision = revision + 1 WHERE pedido_id = ?', [l.pedido_id]);
    repo.auditar(a, 'MODIFICAR_LINEA', null, { lineaId, antes: l.cantidad_presentacion_mil, despues: cantidadPresentacionMil });
  });
}

/** Cancelar antes de salida libera reservas y compromisos; no crea movimiento físico (C05, RN-16). */
export function cancelarPedido(repo: Repo, usuario: string, pedidoId: string, motivo: string) {
  return repo.transaccion(() => {
    const a = exigir(repo, usuario, 'GESTIONAR_PEDIDOS');
    if (!motivo || motivo.trim().length < 5) throw new ErrorValidacion({ motivo: 'Indique el motivo de la cancelación.' });
    const p = repo.uno('SELECT * FROM pedido WHERE pedido_id = ?', [pedidoId]);
    if (!p || p.estado_base === 'CANCELADO') throw new Error('Pedido inexistente o ya cancelado.');
    const t = repo.reloj();
    const salio = repo.num("SELECT COUNT(*) FROM reserva r JOIN pedido_linea pl USING (pedido_linea_id) WHERE pl.pedido_id = ? AND r.estado = 'CONSUMIDA'", [pedidoId]) > 0;
    // Con ramas ya despachadas (AJ02): se conserva lo aceptado o en verificación; lo que sigue en camino queda para retorno, sin devolución ficticia.
    const lineasAntes = salio ? pedidos(repo).find((x) => x.pedido_id === pedidoId)!.lineas : [];
    repo.run(`UPDATE etapa SET estado = 'CANCELADA' WHERE estado = 'PLANIFICADA' AND itinerario_id IN (SELECT itinerario_id FROM itinerario WHERE pedido_id = ? AND estado IN ('CONFIRMADO','EN_EJECUCION'))`, [pedidoId]);
    repo.run(`UPDATE itinerario SET estado = 'CANCELADO' WHERE pedido_id = ? AND estado IN ('CONFIRMADO','EN_EJECUCION') AND NOT EXISTS (SELECT 1 FROM etapa e WHERE e.itinerario_id = itinerario.itinerario_id AND e.estado <> 'CANCELADA')`, [pedidoId]);
    repo.run(`UPDATE reserva SET estado = 'LIBERADA', liberada_en = ?, motivo_liberacion = 'Cancelación del pedido' WHERE estado = 'ACTIVA' AND pedido_linea_id IN (SELECT pedido_linea_id FROM pedido_linea WHERE pedido_id = ?)`, [t, pedidoId]);
    repo.run(`UPDATE compromiso_futuro SET estado = 'LIBERADO', resuelto_en = ? WHERE estado = 'ACTIVO' AND pedido_linea_id IN (SELECT pedido_linea_id FROM pedido_linea WHERE pedido_id = ?)`, [t, pedidoId]);
    repo.run(`UPDATE propuesta_entrega SET estado = 'INVALIDADA', motivo_estado = 'Pedido cancelado', resuelta_en = ? WHERE pedido_id = ? AND estado = 'PROPUESTA'`, [t, pedidoId]);
    if (!salio) repo.run('UPDATE pedido_linea SET q_cancelada_mil = q_solicitada_mil WHERE pedido_id = ?', [pedidoId]);
    else for (const l of lineasAntes) repo.run('UPDATE pedido_linea SET q_cancelada_mil = ? WHERE pedido_linea_id = ?', [Math.max(0, l.solicitada_mil - l.aceptada_mil - l.en_verificacion_mil), l.pedido_linea_id]);
    repo.run("UPDATE pedido SET estado_base = 'CANCELADO', cancelado_en = ?, motivo_cancelacion = ?, revision = revision + 1 WHERE pedido_id = ?", [t, motivo.trim(), pedidoId]);
    repo.auditar(a, 'CANCELAR_PEDIDO', null, { pedidoId, motivo });
  });
}

export interface LineaEstado { pedido_linea_id: string; producto_id: string; presentacion_id: string; nombre: string; solicitada_mil: number; reservada_mil: number; cancelada_mil: number; despachada_mil: number; aceptada_mil: number; en_verificacion_mil: number; rechazada_mil: number; retornada_mil: number; devuelta_mil: number; perdida_mil: number; pendiente_mil: number; reservas: { reserva_id: string; nodo_id: string; lote: string; q_mil: number }[] }
export interface PedidoEstado { pedido_id: string; cliente_id: string; destino_id: string; ventana_inicio: string; ventana_fin: string; prioridad: string; permite_parcial: boolean; permite_entregas_divididas: boolean; estado: string; atrasado: boolean; responsable_id: string | null; importe_cent: number; lineas: LineaEstado[] }

/** Estado derivado de cantidades y hechos (§5.1). */
export function pedidos(repo: Repo, ahora = repo.reloj()): PedidoEstado[] {
  const res = repo.todos(`SELECT r.reserva_id, r.pedido_linea_id, r.nodo_id, l.codigo_lote, r.q_mil FROM reserva r JOIN lote l USING (lote_id) WHERE r.estado = 'ACTIVA' ORDER BY r.creada_en`);
  const despMap = new Map(repo.todos("SELECT pedido_linea_id, SUM(q_mil) q FROM reserva WHERE estado = 'CONSUMIDA' GROUP BY 1").map((f) => [String(f.pedido_linea_id), Number(f.q)]));
  const acep = new Map(repo.todos('SELECT pedido_linea_id, SUM(aceptado_mil) a, SUM(en_verificacion_mil) v, SUM(rechazado_mil) r FROM entrega_detalle GROUP BY 1').map((f) => [String(f.pedido_linea_id), { a: Number(f.a), v: Number(f.v), r: Number(f.r) }]));
  // I04-b: lo que vuelve sin aceptarse o se pierde en ruta reabre el pendiente; la devolución tras aceptar reduce la aceptación neta (AJ03/AJ04/AJ05, T08)
  const ret = new Map<string, Record<string, number>>();
  for (const f of repo.todos("SELECT pedido_linea_id, tipo, SUM(q_mil) q FROM retorno WHERE estado = 'RECIBIDO' AND pedido_linea_id IS NOT NULL GROUP BY 1,2")) {
    const k = String(f.pedido_linea_id); ret.set(k, { ...(ret.get(k) ?? {}), [String(f.tipo)]: Number(f.q) });
  }
  const perd = new Map(repo.todos(`SELECT (SELECT ec.pedido_linea_id FROM etapa_carga ec WHERE ec.etapa_id = i.etapa_id AND ec.lote_id = i.lote_id LIMIT 1) linea, SUM(i.q_mil) q
    FROM incidencia i WHERE i.tipo = 'PERDIDA' AND i.q_mil > 0 GROUP BY 1`).map((f) => [String(f.linea), Number(f.q)]));
  const lin = repo.todos('SELECT * FROM pedido_linea ORDER BY pedido_linea_id');
  return repo.todos('SELECT * FROM pedido ORDER BY pedido_id').map((p) => {
    const lineas = lin.filter((l) => l.pedido_id === p.pedido_id).map((l) => {
      const rs = res.filter((r) => r.pedido_linea_id === l.pedido_linea_id).map((r) => ({ reserva_id: String(r.reserva_id), nodo_id: String(r.nodo_id), lote: String(r.codigo_lote), q_mil: Number(r.q_mil) }));
      const reservada = rs.reduce((a, r) => a + r.q_mil, 0), cancelada = Number(l.q_cancelada_mil);
      const despachada = despMap.get(String(l.pedido_linea_id)) ?? 0, ac = acep.get(String(l.pedido_linea_id)) ?? { a: 0, v: 0, r: 0 };
      const rt = ret.get(String(l.pedido_linea_id)) ?? {};
      const retornada = (rt.RECHAZO ?? 0) + (rt.NO_ENTREGADO ?? 0), devuelta = (rt.DEVOLUCION_REPOSICION ?? 0) + (rt.DEVOLUCION_ANULACION ?? 0), perdida = perd.get(String(l.pedido_linea_id)) ?? 0;
      return { pedido_linea_id: String(l.pedido_linea_id), producto_id: String(l.producto_id), presentacion_id: String(l.presentacion_id), nombre: String(l.nombre_producto_snapshot),
        solicitada_mil: Number(l.q_solicitada_mil), reservada_mil: reservada, cancelada_mil: cancelada, despachada_mil: despachada, aceptada_mil: ac.a - devuelta, en_verificacion_mil: ac.v, rechazada_mil: ac.r,
        retornada_mil: retornada, devuelta_mil: devuelta, perdida_mil: perdida,
        pendiente_mil: Math.max(0, Number(l.q_solicitada_mil) - reservada - cancelada - despachada + retornada + perdida + devuelta), reservas: rs };
    });
    const sol = lineas.reduce((a, l) => a + l.solicitada_mil - l.cancelada_mil, 0), resv = lineas.reduce((a, l) => a + l.reservada_mil, 0);
    const despTot = lineas.reduce((a, l) => a + l.despachada_mil, 0), acept = lineas.reduce((a, l) => a + l.aceptada_mil, 0);
    let estado = p.estado_base === 'BORRADOR' ? 'Borrador' : p.estado_base === 'CANCELADO' ? 'Cancelado' : 'Confirmado';
    if (estado === 'Confirmado' && resv + despTot > 0) estado = resv + despTot === sol ? 'Reservado' : 'Reserva parcial';
    if (estado !== 'Borrador' && estado !== 'Cancelado' && (despTot > 0 || acept > 0)) estado = 'En atención'; // RN-45: el estado se decide en el cliente final
    if (p.estado_base === 'CANCELADO' && acept > 0) estado = 'Cerrado parcial';
    else if (estado !== 'Borrador' && sol > 0 && acept === sol) estado = 'Completado';
    const atrasado = !['Cancelado', 'Borrador', 'Completado'].includes(estado) && Date.parse(String(p.ventana_fin)) < Date.parse(ahora) && lineas.some((l) => l.aceptada_mil < l.solicitada_mil - l.cancelada_mil);
    return { pedido_id: String(p.pedido_id), cliente_id: String(p.cliente_id), destino_id: String(p.destino_id), ventana_inicio: String(p.ventana_inicio), ventana_fin: String(p.ventana_fin),
      prioridad: String(p.prioridad), permite_parcial: p.permite_parcial === 1, permite_entregas_divididas: p.permite_entregas_divididas === 1, estado, atrasado,
      responsable_id: p.responsable_id as string | null, importe_cent: lin.filter((l) => l.pedido_id === p.pedido_id).reduce((a, l) => a + Number(l.importe_cent), 0), lineas };
  });
}

// ---------------------------------------------------------------- Reserva FEFO multi-origen (RN-03/04/05/49, AO01–AO07)
export interface ResultadoReserva { pedido_id: string; asignaciones: { pedido_linea_id: string; lote: string; nodo_id: string; q_mil: number }[]; pendientes: { pedido_linea_id: string; q_mil: number }[]; excluidos: { lote: string; nodo_id: string; motivo: string }[]; origen_unico?: string }

function candidatos(repo: Repo, productoId: string, limite: string, vidaMin: number, soloNodo?: string) {
  const fechaMin = sumaDias(limite, vidaMin);
  const ex = existencias(repo).filter((e) => e.producto_id === productoId && e.condicion === 'APTO' && e.tipo_nodo === 'ALMACEN' && (!soloNodo || e.nodo_id === soloNodo));
  const ok: Existencia[] = [], excl: { lote: string; nodo_id: string; motivo: string }[] = [];
  for (const e of ex) {
    if (e.estado_lote !== 'LIBERADO') excl.push({ lote: e.codigo_lote, nodo_id: e.nodo_id, motivo: 'Lote bloqueado' });
    else if (e.fecha_vencimiento < fechaMin) excl.push({ lote: e.codigo_lote, nodo_id: e.nodo_id, motivo: `Vence el ${e.fecha_vencimiento}; se exige vigencia hasta ${fechaMin}` });
    else if (e.disponible_mil > 0) ok.push(e);
  }
  ok.sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento) || a.codigo_lote.localeCompare(b.codigo_lote) || a.nodo_id.localeCompare(b.nodo_id));
  return { ok, excl };
}

/** Texto con lo pedido y lo disponible por almacén, para explicar una reserva rechazada. */
export function resumenDisponible(repo: Repo, lineas: { producto_id: string; pendiente_mil: number }[], limite: string, vidaMin: number, soloNodo?: string) {
  const f = (q: number) => fmtNum(q / 1000, 3).replace(/,?0+$/, '');
  return lineas.map((l) => {
    const porNodo = new Map<string, number>();
    for (const e of candidatos(repo, l.producto_id, limite, vidaMin, soloNodo).ok) porNodo.set(e.nodo_id, (porNodo.get(e.nodo_id) ?? 0) + e.disponible_mil);
    const total = [...porNodo.values()].reduce((a, b) => a + b, 0);
    return `${l.producto_id}: se necesitan ${f(l.pendiente_mil)} y hay ${f(total)} disponibles${porNodo.size ? ' — ' + [...porNodo].map(([n, q]) => `${n} ${f(q)}`).join(', ') : ''}`;
  }).join('; ');
}

export function reservarFefo(repo: Repo, usuario: string, pedidoId: string, commandId = nuevoId('CMD'), opciones: { soloNodo?: string; lineas?: string[] } = {}) {
  return repo.comando<ResultadoReserva>(commandId, 'RESERVAR_FEFO', actor(repo, usuario), () => {
    exigir(repo, usuario, 'RESERVAR');
    const ped = pedidos(repo).find((p) => p.pedido_id === pedidoId);
    if (!ped) throw new Error('Pedido inexistente.');
    if (ped.estado === 'Borrador') throw new Error('Un pedido en borrador no se puede reservar: primero debe confirmarse.');
    if (ped.estado === 'Cancelado') throw new Error('El pedido está cancelado.');
    const vidaMin = repo.num('SELECT vida_util_min_dias FROM destino WHERE destino_id = ?', [ped.destino_id]);
    const limite = ped.ventana_fin.slice(0, 10); // sin plan: aceptación estimada = fin de ventana (RN-04/05)
    const lineas = ped.lineas.filter((l) => l.pendiente_mil > 0 && (!opciones.lineas || opciones.lineas.includes(l.pedido_linea_id)));
    const res: ResultadoReserva = { pedido_id: pedidoId, asignaciones: [], pendientes: [], excluidos: [] };
    const usado = new Map<string, number>();
    const libre = (e: Existencia) => e.disponible_mil - (usado.get(e.lote_id + '|' + e.nodo_id) ?? 0);
    // Sin entregas divididas: todo desde un mismo origen (AO06). Se elige el almacén que cubre más; empate por código.
    let origen = opciones.soloNodo;
    const yaReservado = new Set(ped.lineas.flatMap((l) => l.reservas.map((r) => r.nodo_id)));
    if (!ped.permite_entregas_divididas && !origen) {
      if (yaReservado.size === 1) origen = [...yaReservado][0];
      else {
        const almacenes = repo.todos("SELECT nodo_id FROM nodo WHERE tipo = 'ALMACEN' AND activo = 1 ORDER BY nodo_id").map((n) => String(n.nodo_id));
        // Entre almacenes que cubren todo, se elige el que entrega primero lo que vence antes (FEFO, RN-04); empate por código.
        let mejor = { nodo: '', cubre: -1, completo: false, venc: '9999' };
        for (const n of almacenes) {
          let cubre = 0, completo = true, venc = '9999';
          for (const l of lineas) {
            const ok = candidatos(repo, l.producto_id, limite, vidaMin, n).ok;
            const c = ok.reduce((a, e) => a + e.disponible_mil, 0); cubre += Math.min(c, l.pendiente_mil); if (c < l.pendiente_mil) completo = false;
            if (ok[0] && ok[0].fecha_vencimiento < venc) venc = ok[0].fecha_vencimiento;
          }
          const mejora = completo && !mejor.completo ? true : completo === mejor.completo && (completo ? venc < mejor.venc : cubre > mejor.cubre);
          if (mejora) mejor = { nodo: n, cubre, completo, venc };
        }
        origen = mejor.nodo || undefined;
        if (!mejor.completo && !ped.permite_parcial) {
          const total = lineas.reduce((a, l) => a + candidatos(repo, l.producto_id, limite, vidaMin).ok.reduce((x, e) => x + e.disponible_mil, 0), 0);
          const pend = lineas.reduce((a, l) => a + l.pendiente_mil, 0);
          throw new Error(total >= pend
            ? `Reserva no realizada: entre varios almacenes alcanza, pero el cliente no admite entregas divididas y ningún almacén cubre todo (${resumenDisponible(repo, lineas, limite, vidaMin)}). Requiere consolidar antes con un traslado entre almacenes. No se reservó nada.`
            : `Reserva no realizada: falta stock apto y el pedido no permite atención parcial (${resumenDisponible(repo, lineas, limite, vidaMin)}). No se reservó nada.`);
        }
      }
      res.origen_unico = origen;
    }
    for (const l of lineas) {
      let falta = l.pendiente_mil;
      const c = candidatos(repo, l.producto_id, limite, vidaMin, origen);
      res.excluidos.push(...c.excl);
      for (const e of c.ok) {
        const q = Math.min(libre(e), falta);
        if (q <= 0) continue;
        usado.set(e.lote_id + '|' + e.nodo_id, (usado.get(e.lote_id + '|' + e.nodo_id) ?? 0) + q);
        res.asignaciones.push({ pedido_linea_id: l.pedido_linea_id, lote: e.codigo_lote, nodo_id: e.nodo_id, q_mil: q });
        repo.run('INSERT INTO reserva(reserva_id,pedido_linea_id,lote_id,nodo_id,q_mil,estado,creada_en,command_id) VALUES (?,?,?,?,?,?,?,?)', [nuevoId('RES'), l.pedido_linea_id, e.lote_id, e.nodo_id, q, 'ACTIVA', repo.reloj(), commandId]);
        falta -= q;
        if (falta === 0) break;
      }
      if (falta > 0) res.pendientes.push({ pedido_linea_id: l.pedido_linea_id, q_mil: falta });
    }
    if (res.pendientes.length && !ped.permite_parcial)
      throw new Error(`Reserva no realizada: falta stock apto y el pedido no permite atención parcial (${resumenDisponible(repo, lineas, limite, vidaMin, origen)}). No se reservó nada.`);
    if (!res.asignaciones.length) throw new Error('No hay stock apto disponible para este pedido; queda pendiente sin reserva.');
    verificarInvariantes(repo);
    return res;
  });
}

/** Reserva de todos los pendientes por prioridad visible: URGENTE, luego fin de ventana, luego código (C02). */
export function ordenPrioridad(repo: Repo) {
  return pedidos(repo).filter((p) => (p.estado === 'Confirmado' || p.estado === 'Reserva parcial') && p.lineas.some((l) => l.pendiente_mil > 0))
    .sort((a, b) => (a.prioridad === b.prioridad ? 0 : a.prioridad === 'URGENTE' ? -1 : 1) || a.ventana_fin.localeCompare(b.ventana_fin) || a.pedido_id.localeCompare(b.pedido_id));
}
export function reservarPendientes(repo: Repo, usuario: string) {
  return ordenPrioridad(repo).map((p) => {
    try { const r = reservarFefo(repo, usuario, p.pedido_id).resultado; return { pedido_id: p.pedido_id, prioridad: p.prioridad, ok: true, detalle: `${r.asignaciones.length} asignación(es)${r.pendientes.length ? ', con pendiente' : ''}` }; }
    catch (e) { return { pedido_id: p.pedido_id, prioridad: p.prioridad, ok: false, detalle: (e as Error).message }; }
  });
}

/** Liberar una reserva concreta o todas las del pedido; no crea ingreso físico (D06, AO07). */
export function liberarReservas(repo: Repo, usuario: string, filtro: { pedido_id?: string; reserva_id?: string; nodo_id?: string }, motivo = 'Liberación manual', commandId = nuevoId('CMD')) {
  return repo.comando<{ liberadas: number }>(commandId, 'LIBERAR_RESERVAS', actor(repo, usuario), () => {
    exigir(repo, usuario, 'RESERVAR');
    const ids = repo.todos(`SELECT r.reserva_id FROM reserva r JOIN pedido_linea pl USING (pedido_linea_id) WHERE r.estado = 'ACTIVA'
      AND (? IS NULL OR pl.pedido_id = ?) AND (? IS NULL OR r.reserva_id = ?) AND (? IS NULL OR r.nodo_id = ?)`,
      [filtro.pedido_id ?? null, filtro.pedido_id ?? null, filtro.reserva_id ?? null, filtro.reserva_id ?? null, filtro.nodo_id ?? null, filtro.nodo_id ?? null]);
    if (!filtro.pedido_id && !filtro.reserva_id) throw new Error('Indique el pedido o la reserva a liberar.');
    for (const r of ids) repo.run("UPDATE reserva SET estado = 'LIBERADA', liberada_en = ?, motivo_liberacion = ? WHERE reserva_id = ?", [repo.reloj(), motivo, r.reserva_id]);
    return { liberadas: ids.length };
  });
}

/** Reasignar el origen de lo aún no ejecutado: libera solo lo sustituible y reserva desde otro almacén, en una transacción (AO05). */
export function reasignarOrigen(repo: Repo, usuario: string, pedidoId: string, nodoActual: string, nodoNuevo: string) {
  return repo.transaccion(() => {
    exigir(repo, usuario, 'RESERVAR');
    const ped = pedidos(repo).find((p) => p.pedido_id === pedidoId);
    if (!ped) throw new Error('Pedido inexistente.');
    const lineas = ped.lineas.filter((l) => l.reservas.some((r) => r.nodo_id === nodoActual)).map((l) => l.pedido_linea_id);
    if (!lineas.length) throw new Error(`No hay reservas activas del pedido en ${nodoActual}.`);
    liberarReservas(repo, usuario, { pedido_id: pedidoId, nodo_id: nodoActual }, `Reasignación de origen a ${nodoNuevo}`);
    const r = reservarFefo(repo, usuario, pedidoId, nuevoId('CMD'), { soloNodo: nodoNuevo, lineas });
    if (r.resultado.pendientes.length && !ped.permite_parcial) throw new Error('El nuevo origen no cubre la cantidad liberada; no se cambió nada.');
    return r.resultado;
  });
}

// ---------------------------------------------------------------- Disponibilidad a fecha y propuestas (AP01–AP08, RN-50)
export interface PuntoATP { fecha: string; acumulado_mil: number; prometible_mil: number }
/** ATP acumulado: disponible físico hoy + suministros CONFIRMADOS − compromisos futuros activos; prometible(d) = mín_{t≥d} acumulado(t). */
export function disponibilidadAFecha(repo: Repo, productoId: string, nodoId: string | null, opciones: { incluirNoConfirmados?: boolean; excluirPropuesta?: string } = {}): PuntoATP[] {
  const hoy = hoyDe(repo.reloj());
  const fisico = existencias(repo).filter((e) => e.producto_id === productoId && (!nodoId || e.nodo_id === nodoId)).reduce((a, e) => a + e.disponible_mil, 0);
  const estados = opciones.incluirNoConfirmados ? ['CONFIRMADO', 'NO_CONFIRMADO', 'RETRASADO'] : ['CONFIRMADO'];
  const sum = repo.todos(`SELECT fecha_prevista f, SUM(q_mil) q FROM suministro_esperado WHERE producto_id = ? AND (? IS NULL OR nodo_destino_id = ?) AND estado IN (${estados.map(() => '?').join(',')}) GROUP BY 1`,
    [productoId, nodoId, nodoId, ...estados]);
  const com = repo.todos(`SELECT fecha_compromiso f, SUM(q_mil) q FROM compromiso_futuro WHERE producto_id = ? AND (? IS NULL OR nodo_id = ?) AND estado = 'ACTIVO' AND (? IS NULL OR propuesta_id IS NULL OR propuesta_id <> ?) GROUP BY 1`,
    [productoId, nodoId, nodoId, opciones.excluirPropuesta ?? null, opciones.excluirPropuesta ?? null]);
  const fechas = [...new Set([hoy, ...sum.map((s) => String(s.f) < hoy ? hoy : String(s.f)), ...com.map((c) => (String(c.f) < hoy ? hoy : String(c.f)))])].sort();
  let acc = fisico;
  const serie = fechas.map((f) => {
    acc += sum.filter((s) => (String(s.f) < hoy ? hoy : String(s.f)) === f).reduce((a, s) => a + Number(s.q), 0);
    acc -= com.filter((c) => (String(c.f) < hoy ? hoy : String(c.f)) === f).reduce((a, c) => a + Number(c.q), 0);
    return { fecha: f, acumulado_mil: acc, prometible_mil: 0 };
  });
  let minimo = Infinity;
  for (let i = serie.length - 1; i >= 0; i--) { minimo = Math.min(minimo, serie[i].acumulado_mil); serie[i].prometible_mil = Math.max(0, minimo); }
  return serie;
}
/** Vence propuestas cuyo plazo [inicio, vence) terminó; libera su compromiso temporal una sola vez (AP06). */
export function expirarPropuestas(repo: Repo, instante = repo.reloj()) {
  return repo.transaccion(() => {
    const vencidas = repo.todos("SELECT propuesta_id FROM propuesta_entrega WHERE estado = 'PROPUESTA' AND vence <= ?", [instante]);
    for (const v of vencidas) {
      repo.run("UPDATE propuesta_entrega SET estado = 'EXPIRADA', motivo_estado = 'Venció su plazo', resuelta_en = ? WHERE propuesta_id = ?", [instante, v.propuesta_id]);
      repo.run("UPDATE compromiso_futuro SET estado = 'LIBERADO', resuelto_en = ? WHERE propuesta_id = ? AND estado = 'ACTIVO' AND tipo = 'TEMPORAL'", [instante, v.propuesta_id]);
    }
    return vencidas.length;
  });
}

/** Propone la fecha más temprana factible con disponibilidad a fecha; crea un compromiso TEMPORAL que protege la oferta (AP01–AP03, AP08). */
export function proponerFecha(repo: Repo, usuario: string, pedidoId: string, incluirNoConfirmados = false) {
  expirarPropuestas(repo);
  return repo.transaccion(() => {
    const a = exigir(repo, usuario, 'PROPONER_FECHA');
    const ped = pedidos(repo).find((p) => p.pedido_id === pedidoId);
    if (!ped || !['Confirmado', 'Reserva parcial'].includes(ped.estado)) throw new Error('Solo se proponen fechas para pedidos confirmados con pendiente.');
    if (repo.num("SELECT COUNT(*) FROM propuesta_entrega WHERE pedido_id = ? AND estado = 'PROPUESTA'", [pedidoId])) throw new Error('Ya hay una propuesta vigente para este pedido.');
    const t = repo.reloj(), hoy = hoyDe(t);
    const nodos = ped.permite_entregas_divididas ? [null] : repo.todos("SELECT nodo_id FROM nodo WHERE tipo='ALMACEN' AND activo=1 ORDER BY nodo_id").map((n) => String(n.nodo_id));
    let mejor: { fecha: string; nodo: string | null } | null = null;
    for (const n of nodos) {
      let fechaNodo = hoy;
      let factible = true;
      for (const l of ped.lineas.filter((x) => x.pendiente_mil > 0)) {
        const serie = disponibilidadAFecha(repo, l.producto_id, n, { incluirNoConfirmados });
        const f = serie.find((p) => p.prometible_mil >= l.pendiente_mil);
        if (!f) { factible = false; break; }
        if (f.fecha > fechaNodo) fechaNodo = f.fecha;
      }
      if (factible && (!mejor || fechaNodo < mejor.fecha)) mejor = { fecha: fechaNodo, nodo: n };
    }
    if (!mejor) throw new Error('No existe disponibilidad suficiente en el horizonte conocido (stock + suministros confirmados). No se emitió propuesta.');
    const version = repo.num('SELECT COALESCE(MAX(version),0) FROM propuesta_entrega WHERE pedido_id = ?', [pedidoId]) + 1;
    const ttl = Number(parametro(repo, 'ttl_propuesta_min'));
    const vence = aLima(Date.parse(t) + ttl * 60000);
    const plazoFijo = sumaDias(hoy, Number(parametro(repo, 'plazo_fijo_dias')));
    const deps = repo.todos(`SELECT suministro_id, estado, fecha_prevista FROM suministro_esperado WHERE estado IN ('CONFIRMADO','NO_CONFIRMADO','RETRASADO') AND fecha_prevista <= ? AND producto_id IN (${ped.lineas.map(() => '?').join(',')})`,
      [mejor.fecha, ...ped.lineas.map((l) => l.producto_id)]).filter((d) => mejor!.fecha > hoy && (incluirNoConfirmados || d.estado === 'CONFIRMADO'));
    const id = nuevoId('PRO');
    repo.run('INSERT INTO propuesta_entrega VALUES (?,?,?,?,?,?,?,?,?,?,NULL,?,NULL)', [id, pedidoId, version, mejor.fecha, plazoFijo, t, vence, incluirNoConfirmados ? 1 : 0, JSON.stringify(deps), 'PROPUESTA', t]);
    const almacenRef = mejor.nodo ?? String(repo.uno("SELECT nodo_id FROM nodo WHERE tipo='ALMACEN' AND activo=1 ORDER BY nodo_id")!.nodo_id);
    for (const l of ped.lineas.filter((x) => x.pendiente_mil > 0))
      repo.run('INSERT INTO compromiso_futuro VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)', [nuevoId('COM'), l.pedido_linea_id, l.producto_id, almacenRef, deps[0]?.suministro_id ?? null, id, l.pendiente_mil, mejor.fecha, 'TEMPORAL', 'ACTIVO', t]);
    repo.auditar(a, 'PROPONER_FECHA', null, { id, fecha: mejor.fecha, vence, condicionada: incluirNoConfirmados });
    return { propuesta_id: id, fecha: mejor.fecha, vence, estimacion_plazo_fijo: plazoFijo, dentro_de_ventana: mejor.fecha <= ped.ventana_fin.slice(0, 10), condicionada: incluirNoConfirmados, dependencias: deps.length };
  });
}

/** Aceptar dentro de [inicio, vence): revalida sin contar su propio compromiso; el temporal pasa a FIRME (AP05). */
export function aceptarPropuesta(repo: Repo, usuario: string, propuestaId: string, instante = repo.reloj()) {
  return repo.transaccion(() => {
    const a = exigir(repo, usuario, 'PROPONER_FECHA');
    const p = repo.uno('SELECT * FROM propuesta_entrega WHERE propuesta_id = ?', [propuestaId]);
    if (!p) throw new Error('Propuesta inexistente.');
    if (p.estado !== 'PROPUESTA') throw new Error(`La propuesta está ${String(p.estado).toLowerCase()}; no puede aceptarse.`);
    if (!(Date.parse(instante) >= Date.parse(String(p.inicio)) && Date.parse(instante) < Date.parse(String(p.vence)))) {
      repo.run("UPDATE propuesta_entrega SET estado = 'EXPIRADA', motivo_estado = 'Aceptación fuera de vigencia', resuelta_en = ? WHERE propuesta_id = ?", [instante, propuestaId]);
      repo.run("UPDATE compromiso_futuro SET estado = 'LIBERADO', resuelto_en = ? WHERE propuesta_id = ? AND estado = 'ACTIVO'", [instante, propuestaId]);
      return { aceptada: false, motivo: 'La propuesta venció (vigencia [inicio, vencimiento)). Solicite una nueva.' };
    }
    if (p.condicionada === 1) throw new Error('La propuesta depende de suministros no confirmados: solo sirve como escenario y no puede aceptarse como compromiso firme.');
    for (const c of repo.todos("SELECT * FROM compromiso_futuro WHERE propuesta_id = ? AND estado = 'ACTIVO'", [propuestaId])) {
      const serie = disponibilidadAFecha(repo, String(c.producto_id), null, { excluirPropuesta: propuestaId });
      const f = serie.filter((s) => s.fecha <= String(c.fecha_compromiso)).at(-1);
      if (!f || f.prometible_mil < Number(c.q_mil)) throw new Error('Al revalidar, la disponibilidad ya no alcanza para la fecha propuesta. No se aceptó.');
    }
    repo.run("UPDATE compromiso_futuro SET tipo = 'FIRME' WHERE propuesta_id = ? AND estado = 'ACTIVO'", [propuestaId]);
    repo.run("UPDATE propuesta_entrega SET estado = 'ACEPTADA', resuelta_en = ? WHERE propuesta_id = ?", [instante, propuestaId]);
    repo.auditar(a, 'ACEPTAR_PROPUESTA', null, { propuestaId });
    return { aceptada: true, motivo: 'Aceptada; la fecha comprometida original del pedido no cambia.' };
  });
}

/** Cambio de estado de un suministro esperado: un retraso o cancelación invalida las propuestas que dependen de él (AP04). */
export function actualizarSuministro(repo: Repo, usuario: string, suministroId: string, estado: 'CONFIRMADO' | 'NO_CONFIRMADO' | 'RETRASADO' | 'CANCELADO', nuevaFecha?: string) {
  return repo.transaccion(() => {
    const a = exigir(repo, usuario, 'GESTIONAR_SUMINISTRO');
    const s = repo.uno('SELECT * FROM suministro_esperado WHERE suministro_id = ?', [suministroId]);
    if (!s) throw new Error('Suministro inexistente.');
    if (s.estado === 'RECIBIDO') throw new Error('Ya fue recibido: es un hecho físico y no se modifica.');
    const t = repo.reloj();
    repo.run('UPDATE suministro_esperado SET estado = ?, fecha_prevista = ?, revision = revision + 1, actualizado_en = ? WHERE suministro_id = ?', [estado, nuevaFecha ?? s.fecha_prevista, t, suministroId]);
    const afectadas: string[] = [];
    if (estado === 'RETRASADO' || estado === 'CANCELADO' || (nuevaFecha && nuevaFecha > String(s.fecha_prevista)))
      for (const p of repo.todos("SELECT propuesta_id, pedido_id, dependencias, estado FROM propuesta_entrega WHERE estado IN ('PROPUESTA','ACEPTADA')")) {
        if (!(JSON.parse(String(p.dependencias)) as { suministro_id: string }[]).some((d) => d.suministro_id === suministroId)) continue;
        afectadas.push(String(p.pedido_id));
        repo.run("UPDATE propuesta_entrega SET estado = 'INVALIDADA', motivo_estado = ?, resuelta_en = ? WHERE propuesta_id = ?", [`Dependencia ${suministroId} ${estado.toLowerCase()}`, t, p.propuesta_id]);
        repo.run("UPDATE compromiso_futuro SET estado = 'LIBERADO', resuelto_en = ? WHERE propuesta_id = ? AND estado = 'ACTIVO'", [t, p.propuesta_id]);
      }
    repo.auditar(a, 'ACTUALIZAR_SUMINISTRO', null, { suministroId, estado, nuevaFecha, afectadas });
    return { pedidosAfectados: afectadas };
  });
}

export function registrarSuministro(repo: Repo, usuario: string, s: { producto_id: string; lote_id?: string | null; nodo_destino_id: string; q_mil: number; fecha_prevista: string; estado: 'CONFIRMADO' | 'NO_CONFIRMADO' }) {
  return repo.transaccion(() => {
    exigir(repo, usuario, 'GESTIONAR_SUMINISTRO');
    if (!(s.q_mil > 0)) throw new ErrorValidacion({ cantidad: 'Debe ser positiva.' });
    const id = nuevoId('SUM');
    repo.run('INSERT INTO suministro_esperado VALUES (?,?,?,?,?,?,?,NULL,1,?)', [id, s.producto_id, s.lote_id ?? null, s.nodo_destino_id, s.q_mil, s.fecha_prevista, s.estado, repo.reloj()]);
    return id;
  });
}

/** Tras una cancelación, muestra fechas más tempranas posibles sin cambiar las comprometidas (AP07). */
export function alternativasMasTempranas(repo: Repo) {
  const out: { pedido_id: string; fecha_aceptada: string; fecha_posible: string }[] = [];
  for (const p of repo.todos("SELECT p.propuesta_id, p.pedido_id, p.fecha_propuesta FROM propuesta_entrega p WHERE p.estado = 'ACEPTADA'")) {
    const comp = repo.todos("SELECT producto_id, q_mil FROM compromiso_futuro WHERE propuesta_id = ? AND estado = 'ACTIVO'", [p.propuesta_id]);
    let fecha = hoyDe(repo.reloj());
    for (const c of comp) {
      const f = disponibilidadAFecha(repo, String(c.producto_id), null, { excluirPropuesta: String(p.propuesta_id) }).find((s) => s.prometible_mil >= Number(c.q_mil));
      if (!f) { fecha = '9999'; break; }
      if (f.fecha > fecha) fecha = f.fecha;
    }
    if (fecha < String(p.fecha_propuesta)) out.push({ pedido_id: String(p.pedido_id), fecha_aceptada: String(p.fecha_propuesta), fecha_posible: fecha });
  }
  return out;
}

/** Cola de trabajo sin responsable vigente (BG03). */
export function pedidosSinResponsable(repo: Repo) {
  return repo.todos(`SELECT p.pedido_id, p.responsable_id FROM pedido p LEFT JOIN usuario u ON u.usuario_id = p.responsable_id
    WHERE p.estado_base = 'CONFIRMADO' AND (p.responsable_id IS NULL OR u.activo = 0) ORDER BY p.pedido_id`).map((f) => ({ pedido_id: String(f.pedido_id), responsable_anterior: f.responsable_id as string | null }));
}

/** Diagnóstico para soporte sin datos comerciales (BG08). */
export function diagnostico(repo: Repo) {
  const tablas = ['producto', 'cliente', 'destino', 'nodo', 'lote', 'movimiento', 'pedido', 'reserva', 'auditoria'];
  return { schema: repo.uno("SELECT valor FROM meta WHERE clave='schema_version'")?.valor, migraciones: repo.todos('SELECT version, aplicada_en FROM migracion'),
    conteos: Object.fromEntries(tablas.map((t) => [t, repo.num(`SELECT COUNT(*) FROM ${t}`)])), integridad: repo.uno('PRAGMA integrity_check')?.integrity_check };
}
