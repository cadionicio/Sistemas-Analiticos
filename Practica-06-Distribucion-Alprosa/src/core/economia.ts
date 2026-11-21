// I06: proyección económica de la UNIDAD DEMOSTRATIVA de distribución (NutriDemo), alternativas de mejora y EVA (§10, L01–L08, AI01–AI08, AV01–AV08, BO01–BO10).
// No es el EVA de Alprosa ni un cálculo tributario oficial: tasas, tarifas e inversiones son supuestos sintéticos editables.
import type { Repo } from './db';
import { nuevoId, fmtNum } from './util';
import { exigir } from './permisos';
import type { PedidoH } from './kpi';
import { indicadores } from './kpi';
import { pronosticar } from './pronostico';
import type { ResultadoSim } from './simulacion';

export const VERSION_MOTOR_ECO = 'ECO-1.0';

// ------------------------------------------------------------------ Supuestos
export interface Supuesto { clave: string; valor: number | null; unidad: string; descripcion: string; fuente: string }
export const SUPUESTOS_DEFECTO: Supuesto[] = [
  { clave: 'precio_neto_kg', valor: 5.29, unidad: 'S/ por kg', descripcion: 'Precio neto medio de venta (importe / kg de los pedidos de demostración)', fuente: 'Calculado de PedidoDetalle (NutriDemo)' },
  { clave: 'costo_producto_kg', valor: 4.1, unidad: 'S/ por kg', descripcion: 'Costo del producto reconocido al aceptarse', fuente: 'Supuesto de demostración' },
  { clave: 'merma_pct', valor: 1.5, unidad: '%', descripcion: 'Producto perdido por vencimiento o daño (se repone a costo)', fuente: 'Supuesto de demostración' },
  { clave: 'costo_logistico_kg', valor: 0.22, unidad: 'S/ por kg', descripcion: 'Costo logístico atribuible por kg aceptado', fuente: 'Historia: indicador «costo logístico por kg» de 52 semanas' },
  { clave: 'participacion_fijo_pct', valor: 60, unidad: '%', descripcion: 'Parte del costo logístico que depende del número de viajes (fijo por salida)', fuente: 'Supuesto; se reemplaza por la proporción del plan simulado si hay corrida' },
  { clave: 'otros_gastos_mes', valor: 9000, unidad: 'S/ por mes', descripcion: 'Otros gastos operativos de la unidad de distribución', fuente: 'Supuesto de demostración' },
  { clave: 'activos_flota_propia', valor: 180000, unidad: 'S/', descripcion: 'Activos fijos netos de la flota propia al inicio', fuente: 'Supuesto de demostración' },
  { clave: 'vida_util_flota_anios', valor: 6, unidad: 'años', descripcion: 'Vida útil restante de la flota propia (depreciación lineal)', fuente: 'Supuesto de demostración' },
  { clave: 'inventario_dias', valor: 30, unidad: 'días', descripcion: 'Cobertura de inventario operativo (a costo)', fuente: 'Supuesto de demostración' },
  { clave: 'cxc_dias', valor: 20, unidad: 'días', descripcion: 'Días de cobro a clientes', fuente: 'Supuesto de demostración' },
  { clave: 'cxp_dias', valor: 25, unidad: 'días', descripcion: 'Días de pago a proveedores (pasivo operativo sin interés)', fuente: 'Supuesto de demostración' },
  { clave: 'tasa_impuesto', valor: 0.3, unidad: 'fracción 0–1', descripcion: 'Tasa del impuesto operativo modelado (no es cálculo tributario oficial)', fuente: 'Supuesto de prueba matemática §14' },
  { clave: 'wacc_anual', valor: 0.12, unidad: 'fracción 0–<1', descripcion: 'Costo de capital anual (no es una tasa fiscal)', fuente: 'Supuesto de prueba matemática §14' },
  { clave: 'variacion_tarifa_pct', valor: 0, unidad: '%', descripcion: 'Cambio de tarifa de transporte a partir del mes indicado', fuente: 'Escenario editable' },
  { clave: 'variacion_tarifa_desde_mes', valor: 7, unidad: 'mes 1–12', descripcion: 'Mes desde el que rige el cambio de tarifa', fuente: 'Escenario editable' },
  { clave: 'penalizacion_no_atencion_kg', valor: 2, unidad: 'S/ por kg', descripcion: 'Penalización del comparador por kg no atendido (no negativa)', fuente: 'Política de demostración' },
  { clave: 'otif_minimo_pct', valor: 70, unidad: '%', descripcion: 'Restricción dura: OTIF esperado mínimo aceptable', fuente: 'Política de demostración' },
  // Alternativas
  { clave: 'cons_merma_extra_pct', valor: 0.2, unidad: 'puntos %', descripcion: 'Consolidación: merma adicional por mayor espera (vida útil)', fuente: 'Supuesto' },
  { clave: 'ter_tarifa_kg', valor: 0.26, unidad: 'moneda del tercero por kg', descripcion: 'Tercerización: tarifa por kg del operador', fuente: 'Cotización sintética' },
  { clave: 'ter_en_usd', valor: 0, unidad: '0 = PEN, 1 = USD', descripcion: 'Moneda de la cotización del tercero', fuente: 'Cotización sintética' },
  { clave: 'tipo_cambio_pen_usd', valor: null, unidad: 'S/ por USD', descripcion: 'Tipo de cambio de la cotización (obligatorio si la cotización es en USD)', fuente: 'Debe indicar fecha y fuente' },
  { clave: 'fefo_inventario_dias', valor: 22, unidad: 'días', descripcion: 'Mejora FEFO/stock: nueva cobertura de inventario', fuente: 'Supuesto' },
  { clave: 'fefo_merma_pct', valor: 0.8, unidad: '%', descripcion: 'Mejora FEFO/stock: nueva merma', fuente: 'Supuesto' },
  { clave: 'fefo_implementacion', valor: 6000, unidad: 'S/ (una vez)', descripcion: 'Mejora FEFO/stock: costo de implementación (gasto del mes 1)', fuente: 'Supuesto' },
  { clave: 'nodo_inversion', valor: 120000, unidad: 'S/', descripcion: 'Nodo de apoyo regional: inversión (activo fijo)', fuente: 'Supuesto' },
  { clave: 'nodo_vida_util_anios', valor: 10, unidad: 'años', descripcion: 'Nodo de apoyo: vida útil', fuente: 'Supuesto' },
  { clave: 'nodo_costo_mes', valor: 3500, unidad: 'S/ por mes', descripcion: 'Nodo de apoyo: costo de operación', fuente: 'Supuesto' },
  { clave: 'nodo_recupera_no_atendido_pct', valor: 50, unidad: '%', descripcion: 'Nodo de apoyo: parte de la demanda no atendida que pasa a atenderse', fuente: 'Supuesto (no simulado)' },
  { clave: 'nodo_mejora_otif_pp', valor: 3, unidad: 'puntos %', descripcion: 'Nodo de apoyo: mejora supuesta de OTIF', fuente: 'Supuesto (no simulado)' },
  { clave: 'oper_costo_kg_remoto', valor: 0.9, unidad: 'S/ por kg remoto', descripcion: 'Operador local de última milla: costo adicional', fuente: 'Supuesto' },
  { clave: 'oper_mejora_otif_pp', valor: 4, unidad: 'puntos %', descripcion: 'Operador local: mejora supuesta de OTIF', fuente: 'Supuesto (no simulado)' },
  { clave: 'oper_recupera_no_atendido_pct', valor: 25, unidad: '%', descripcion: 'Operador local: parte de la demanda no atendida que pasa a atenderse', fuente: 'Supuesto (no simulado)' },
  { clave: 'participacion_remota_pct', valor: 12, unidad: '%', descripcion: 'Parte de los kg que va a destinos remotos', fuente: 'Historia NutriDemo (aprox.)' },
];
export function supuestos(repo: Repo): Record<string, number | null> {
  const filas = repo.todos('SELECT clave, valor FROM supuesto_economico');
  const m: Record<string, number | null> = Object.fromEntries(SUPUESTOS_DEFECTO.map((s) => [s.clave, s.valor]));
  for (const f of filas) m[String(f.clave)] = f.valor === null ? null : Number(f.valor);
  return m;
}
export function asegurarSupuestos(repo: Repo) {
  for (const s of SUPUESTOS_DEFECTO) if (!repo.uno('SELECT 1 FROM supuesto_economico WHERE clave = ?', [s.clave]))
    repo.run('INSERT INTO supuesto_economico VALUES (?,?,?,?,?)', [s.clave, s.valor, s.unidad, s.descripcion, s.fuente]);
}
/** Dominios (L06, AV07): tasa operativa [0,1]; WACC [0,1); penalización ≥ 0. */
export function validarSupuestos(s: Record<string, number | null>): string[] {
  const e: string[] = [];
  const t = s.tasa_impuesto, w = s.wacc_anual;
  if (t === null || !(t >= 0 && t <= 1)) e.push('Tasa de impuesto operativo: debe estar entre 0 y 1 (por ejemplo 0,30).');
  if (w === null || !(w >= 0 && w < 1)) e.push('WACC anual: debe estar entre 0 (incluido) y 1 (excluido), por ejemplo 0,12.');
  if (s.penalizacion_no_atencion_kg === null || s.penalizacion_no_atencion_kg! < 0) e.push('La penalización por no atención no puede ser negativa: dejar demanda sin atender no puede volverse atractivo.');
  for (const k of ['precio_neto_kg', 'costo_producto_kg', 'costo_logistico_kg', 'otros_gastos_mes']) if (s[k] === null || s[k]! < 0) e.push(`«${k}»: valor obligatorio y no negativo.`);
  return e;
}
export function guardarSupuesto(repo: Repo, usuario: string, clave: string, valor: number | null) {
  return repo.transaccion(() => {
    exigir(repo, usuario, 'EVALUAR_ECONOMIA');
    const prueba = { ...supuestos(repo), [clave]: valor };
    const e = validarSupuestos(prueba);
    if (e.length) throw new Error(e.join(' '));
    repo.run('UPDATE supuesto_economico SET valor = ? WHERE clave = ?', [valor, clave]);
  });
}

// ------------------------------------------------------------------ Fórmulas puras (§10, prueba §14-8)
export const nopat = (ebit: number, tasa: number) => ebit - Math.max(ebit, 0) * tasa; // sin crédito fiscal automático con pérdidas (L05)
export const evaAnual = (nopatAnual: number, wacc: number, capital: number) => nopatAnual - wacc * capital;
/** Tasa efectiva de un período de d días (convención de 365 días). */
export const tasaPeriodo = (wacc: number, dias: number) => (1 + wacc) ** (dias / 365) - 1;

// ------------------------------------------------------------------ Demanda proyectada
export interface Mes { mes: string; dias: number; kg_demanda: number; extension: boolean }
/** Meses calendario desde el primer mes completo posterior al corte. La demanda semanal se reparte por días (conserva el total). */
/** Fracción no atendida sobre la demanda original del plan (universo común; sin doble denominador). */
export function porcentajeNoAtendido(pl: { kg_plan: number; kg_demanda?: number; kg_no_atendido: { media: number } }) { const d = pl.kg_demanda ?? pl.kg_plan; return d > 0 ? Math.min(1, pl.kg_no_atendido.media / d) : 0; }
export function primerMesCompleto(corte: string) { const c = new Date(corte); let a = c.getUTCFullYear(), m = c.getUTCMonth() + 2; if (m > 12) { m -= 12; a++; } return `${a}-${String(m).padStart(2, '0')}`; }
export function sumarMeses(mes: string, n: number) { const [a, m] = mes.split('-').map(Number); const t = a * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; }
export function difMeses(a: string, b: string) { const [x, y] = a.split('-').map(Number), [z, w] = b.split('-').map(Number); return (z * 12 + w) - (x * 12 + y); }
export function demandaMensual(repo: Repo, hechos: PedidoH[], corte: string, meses: number, escenarioId?: string | null): { meses: Mes[]; nota: string; escenario: string } {
  const prods = repo.todos('SELECT producto_id, peso_kg_por_unidad_mil w FROM producto WHERE activo = 1');
  const semanas = Math.ceil((meses * 31 + 40) / 7);
  const porDia = new Map<string, number>();
  let ultimaValidada = '';
  const esc = escenarioId ? repo.uno('SELECT * FROM escenario_demanda WHERE escenario_id = ?', [escenarioId]) : null;
  if (escenarioId && !esc) throw new Error('Escenario de demanda inexistente.');
  for (const p of prods) {
    const r = pronosticar(repo, hechos, { producto: String(p.producto_id), corte, horizonte: semanas });
    for (const x of r.prediccion) {
      if (x.tipo === 'VALIDADO' && x.semana > ultimaValidada) ultimaValidada = x.semana;
      for (let d = 0; d < 7; d++) {
        const dia = new Date(Date.parse(x.semana + 'T12:00:00Z') + d * 86400000).toISOString().slice(0, 10);
        let kg = (x.valor * Number(p.w)) / 1e6 / 7;
        if (esc && (!esc.producto_id || esc.producto_id === p.producto_id) && dia >= String(esc.desde) && dia < String(esc.hasta)) kg *= 1 + Number(esc.aumento_pct) / 100;
        porDia.set(dia, (porDia.get(dia) ?? 0) + kg);
      }
    }
  }
  const c = new Date(corte);
  let a = c.getUTCFullYear(), m = c.getUTCMonth() + 2; // primer mes completo posterior
  if (m > 12) { m -= 12; a++; }
  const out: Mes[] = [];
  const finValid = new Date(Date.parse(ultimaValidada + 'T12:00:00Z') + 7 * 86400000).toISOString().slice(0, 10);
  for (let i = 0; i < meses; i++) {
    const ini = `${a}-${String(m).padStart(2, '0')}`;
    const dias = new Date(Date.UTC(a, m, 0)).getUTCDate();
    let kg = 0;
    for (let d = 1; d <= dias; d++) kg += porDia.get(`${ini}-${String(d).padStart(2, '0')}`) ?? 0;
    out.push({ mes: ini, dias, kg_demanda: kg, extension: `${ini}-${String(dias).padStart(2, '0')}` >= finValid });
    m++; if (m > 12) { m = 1; a++; }
  }
  return { meses: out, escenario: esc ? `${esc.nombre} (+${esc.aumento_pct} % del ${esc.desde} al ${esc.hasta}${esc.producto_id ? ', ' + esc.producto_id : ''})` : 'Pronóstico base',
    nota: `Demanda SOLICITADA pronosticada por producto al corte ${corte.slice(0, 10)} y repartida por días (se conserva el total). Las semanas posteriores al ${finValid} son EXTENSIÓN por hipótesis de nivel constante, sin validación.` };
}

// ------------------------------------------------------------------ Alternativas
export type AltId = 'BASE' | 'CONSOLIDACION' | 'TERCERIZACION' | 'FEFO_STOCK' | 'NODO_APOYO' | 'OPERADOR_LOCAL' | 'ELIMINAR_REMOTOS';
export const ALTERNATIVAS: { id: AltId; nombre: string; descripcion: string }[] = [
  { id: 'BASE', nombre: 'Base (operación actual)', descripcion: 'Despacho por pedido, flota propia, cobertura de inventario y merma actuales.' },
  { id: 'CONSOLIDACION', nombre: 'Consolidación de despachos', descripcion: 'Agrupar pedidos por destino: menos viajes (medido en la simulación), más espera y algo más de merma por vida útil.' },
  { id: 'TERCERIZACION', nombre: 'Tercerizar la flota', descripcion: 'Vender la flota propia (libera capital, sin depreciación) y pagar una tarifa por kg al operador.' },
  { id: 'FEFO_STOCK', nombre: 'Mejorar FEFO y stock', descripcion: 'Menos días de inventario y menos merma; costo de implementación una vez. La liberación de inventario reduce capital, no es ganancia operativa.' },
  { id: 'NODO_APOYO', nombre: 'Nodo de apoyo regional', descripcion: 'Inversión en un nodo cercano a destinos remotos: capital y depreciación, costo de operación, mejora supuesta de servicio.' },
  { id: 'OPERADOR_LOCAL', nombre: 'Operador local de última milla', descripcion: 'Contratar un operador local en zonas remotas: costo por kg remoto, mejora supuesta de servicio.' },
  { id: 'ELIMINAR_REMOTOS', nombre: 'Dejar de atender destinos remotos', descripcion: 'Elimina los destinos costosos: baja el costo pero pierde ingreso y deja demanda sin atender. Se muestra para no esconder ese efecto.' },
];
const INCOMPATIBLES: [AltId, AltId][] = [['ELIMINAR_REMOTOS', 'NODO_APOYO'], ['ELIMINAR_REMOTOS', 'OPERADOR_LOCAL']];

/** Palancas físicas de un escenario (todo efecto económico se explica primero como cambio físico). */
interface Palancas { factorViajes: number; mermaPct: number; tercerizada: boolean; tarifaTerceroKg: number | null; inventarioDias: number; activosFlota: number; inversion: number; vidaInversionAnios: number;
  costoExtraMes: number; costoKgRemotoExtra: number; implementacion: number; recuperaNoAtendidoPct: number; mejoraOtifPp: number; sinRemotos: boolean; cambios: string[]; noCalculable: string | null; fuenteServicio: string }

export interface Servicio { otif_pct: number; retraso_p95_h: number; no_atendido_pct: number; fuente: string }
export interface FilaMes { mes: string; kg_demanda: number; kg_aceptado: number; ingresos: number; costo_producto: number; costo_logistico: number; otros: number; depreciacion: number; implementacion: number;
  ebit: number; impuesto: number; nopat: number; capital_cierre: number; viajes_rel: number; extension: boolean }
export interface Escenario {
  id: string; nombre: string; descripcion: string; cambios: string[]; meses: FilaMes[]; capital_apertura: number; capital_cierre: number; capital_promedio: number;
  ingresos: number; costo_logistico: number; ebit: number; nopat: number; cargo_capital: number; eva: number | null; estado: 'CALCULADO' | 'NO_CALCULABLE'; motivo: string | null;
  delta_eva: number | null; inversion: number; caja_liberada: number; servicio: Servicio; kg_no_atendido: number; puente_costo?: { volumen: number; tarifa: number };
}

function palancas(ids: AltId[], s: Record<string, number | null>, sim: ResultadoSim | null): Palancas {
  const p: Palancas = { factorViajes: 1, mermaPct: s.merma_pct ?? 0, tercerizada: false, tarifaTerceroKg: null, inventarioDias: s.inventario_dias ?? NaN, activosFlota: s.activos_flota_propia ?? NaN,
    inversion: 0, vidaInversionAnios: 1, costoExtraMes: 0, costoKgRemotoExtra: 0, implementacion: 0, recuperaNoAtendidoPct: 0, mejoraOtifPp: 0, sinRemotos: false, cambios: [], noCalculable: null, fuenteServicio: 'Simulación (despacho por pedido)' };
  for (const id of ids) {
    if (id === 'CONSOLIDACION') {
      const ref = sim?.planes.find((x) => x.criterio === 'POR_PEDIDO'), con = sim?.planes.find((x) => x.criterio === 'CONSOLIDADO');
      const f = ref && con && ref.servicios ? con.servicios / ref.servicios : 0.8;
      p.factorViajes *= f;
      p.mermaPct += s.cons_merma_extra_pct ?? 0;
      p.cambios.push(`Viajes × ${f.toFixed(3)} (${ref && con ? `${con.servicios} servicios consolidados frente a ${ref.servicios} por pedido, medido en la simulación` : 'supuesto 0,8 sin simulación'}); merma +${s.cons_merma_extra_pct} pp por mayor espera.`);
      if (con) p.fuenteServicio = 'Simulación (despacho consolidado)';
    }
    if (id === 'TERCERIZACION') {
      p.tercerizada = true;
      const usd = (s.ter_en_usd ?? 0) === 1;
      if (usd && !(s.tipo_cambio_pen_usd && s.tipo_cambio_pen_usd > 0)) p.noCalculable = 'La cotización del tercero está en USD y no hay tipo de cambio con fecha y fuente: no se calcula un total convertido (AZ06/BO02).';
      p.tarifaTerceroKg = usd && !(s.tipo_cambio_pen_usd && s.tipo_cambio_pen_usd > 0) ? NaN : (s.ter_tarifa_kg ?? 0) * (usd ? s.tipo_cambio_pen_usd! : 1); // sin tipo de cambio: N/D, nunca 0
      p.activosFlota = 0;
      p.cambios.push(`Se vende la flota (activos ${fmt(s.activos_flota_propia ?? 0)} → 0; sin depreciación); el transporte pasa a ${usd ? `USD ${s.ter_tarifa_kg} × ${s.tipo_cambio_pen_usd ?? '¿?'}` : `S/ ${s.ter_tarifa_kg}`} por kg.`);
    }
    if (id === 'FEFO_STOCK') {
      p.inventarioDias = s.fefo_inventario_dias ?? p.inventarioDias;
      p.mermaPct = Math.min(p.mermaPct, s.fefo_merma_pct ?? p.mermaPct) + (ids.includes('CONSOLIDACION') ? s.cons_merma_extra_pct ?? 0 : 0);
      p.implementacion += s.fefo_implementacion ?? 0;
      p.cambios.push(`Inventario ${s.inventario_dias} → ${s.fefo_inventario_dias} días (reduce capital, no es ingreso); merma ${s.merma_pct} % → ${s.fefo_merma_pct} %; implementación S/ ${fmt(s.fefo_implementacion ?? 0)} en el mes 1.`);
    }
    if (id === 'NODO_APOYO') {
      p.inversion += s.nodo_inversion ?? 0; p.vidaInversionAnios = s.nodo_vida_util_anios ?? 10; p.costoExtraMes += s.nodo_costo_mes ?? 0;
      p.recuperaNoAtendidoPct = Math.max(p.recuperaNoAtendidoPct, s.nodo_recupera_no_atendido_pct ?? 0); p.mejoraOtifPp = Math.max(p.mejoraOtifPp, s.nodo_mejora_otif_pp ?? 0);
      p.cambios.push(`Inversión S/ ${fmt(s.nodo_inversion ?? 0)} (activo, ${s.nodo_vida_util_anios} años); operación S/ ${fmt(s.nodo_costo_mes ?? 0)}/mes; recupera ${s.nodo_recupera_no_atendido_pct} % de la demanda no atendida y +${s.nodo_mejora_otif_pp} pp OTIF (SUPUESTO, no simulado).`);
    }
    if (id === 'OPERADOR_LOCAL') {
      p.costoKgRemotoExtra += s.oper_costo_kg_remoto ?? 0;
      p.recuperaNoAtendidoPct = Math.max(p.recuperaNoAtendidoPct, s.oper_recupera_no_atendido_pct ?? 0); p.mejoraOtifPp = Math.max(p.mejoraOtifPp, s.oper_mejora_otif_pp ?? 0);
      p.cambios.push(`Costo +S/ ${s.oper_costo_kg_remoto} por kg remoto; recupera ${s.oper_recupera_no_atendido_pct} % de la demanda no atendida y +${s.oper_mejora_otif_pp} pp OTIF (SUPUESTO, no simulado).`);
    }
    if (id === 'ELIMINAR_REMOTOS') { p.sinRemotos = true; p.cambios.push(`Se deja de atender el ${s.participacion_remota_pct} % de los kg (destinos remotos): baja costo, baja ingreso y sube la demanda no atendida.`); }
  }
  if (!ids.length) p.cambios.push('Sin cambios: referencia de la comparación.');
  if (!Number.isFinite(p.inventarioDias) || !Number.isFinite(p.activosFlota) || s.cxc_dias === null || s.cxp_dias === null) p.noCalculable = p.noCalculable ?? 'Falta un dato del capital operativo (inventario, cuentas por cobrar/pagar o activos): EVA NO CALCULABLE; no se rellena con cero (BO10).';
  return p;
}
const fmt = (n: number) => fmtNum(n, 0);

function calcular(id: string, nombre: string, descripcion: string, ids: AltId[], s: Record<string, number | null>, dem: Mes[], sim: ResultadoSim | null, base: Servicio, mods: { demanda?: number; tarifa?: number; wacc?: number } = {}): Escenario {
  const p = palancas(ids, s, sim);
  const wacc = (s.wacc_anual ?? 0) + (mods.wacc ?? 0), tasa = s.tasa_impuesto ?? 0;
  const precio = s.precio_neto_kg ?? 0, cprod = s.costo_producto_kg ?? 0, clog = (s.costo_logistico_kg ?? 0) * (1 + (mods.tarifa ?? 0));
  const fijoPct = (s.participacion_fijo_pct ?? 60) / 100, remota = (s.participacion_remota_pct ?? 0) / 100;
  // Servicio = NIVEL HISTÓRICO + EFECTO RELATIVO SIMULADO del plan (misma iteración, mismos shocks); nodo/operador suman efectos SUPUESTOS explícitos
  const ref = sim?.planes.find((x) => x.criterio === 'POR_PEDIDO');
  const planSim = ids.includes('CONSOLIDACION') ? sim?.planes.find((x) => x.criterio === 'CONSOLIDADO') : ref;
  // Universo común = demanda original del plan (todos los envíos); lo que falla después NO se suma al denominador (auditoría RC2 n.º 24)
  const pctNoAt = porcentajeNoAtendido;
  const deltaOtif = planSim && ref ? planSim.a_tiempo.media - ref.a_tiempo.media : 0;
  const deltaNoAt = planSim && ref ? pctNoAt(planSim) - pctNoAt(ref) : 0;
  const noAtBase = Math.max(0, base.no_atendido_pct / 100);
  let noAt = Math.max(0, noAtBase + deltaNoAt) * (1 - p.recuperaNoAtendidoPct / 100);
  if (p.sinRemotos) noAt = noAt + remota * (1 - noAt);
  const servicio: Servicio = {
    otif_pct: Math.max(0, Math.min(100, base.otif_pct + deltaOtif + p.mejoraOtifPp)),
    retraso_p95_h: planSim ? planSim.retraso_h.p95 : base.retraso_p95_h,
    no_atendido_pct: noAt * 100,
    fuente: `OTIF histórico ${base.otif_pct.toFixed(1)} %` + (planSim && ref ? ` ${deltaOtif >= 0 ? '+' : '−'} ${Math.abs(deltaOtif).toFixed(2)} pp (efecto simulado del plan)` : ' (sin corrida de simulación)') + (p.mejoraOtifPp ? ` + ${p.mejoraOtifPp} pp SUPUESTOS` : ''),
  };
  const depFlota = p.activosFlota > 0 ? (s.activos_flota_propia ?? 0) / ((s.vida_util_flota_anios ?? 1) * 12) : 0;
  const depInv = p.inversion > 0 ? p.inversion / (p.vidaInversionAnios * 12) : 0;
  const meses: FilaMes[] = [];
  let activos = p.activosFlota + p.inversion; // la inversión se registra al inicio del mes 1
  const tarifaDesde = s.variacion_tarifa_desde_mes ?? 13, tarifaVar = (s.variacion_tarifa_pct ?? 0) / 100;
  let volEfecto = 0, tarEfecto = 0;
  const capitalDe = (ingDia: number, cprodDia: number, clogDia: number, invDias: number, act: number) => cprodDia * invDias + ingDia * (s.cxc_dias ?? 0) - (cprodDia + clogDia) * (s.cxp_dias ?? 0) + act;
  dem.forEach((m, i) => {
    const kgDem = m.kg_demanda * (1 + (mods.demanda ?? 0));
    const kgAc = kgDem * (1 - noAt);
    const ingresos = kgAc * precio;
    const costoProducto = kgAc * cprod * (1 + p.mermaPct / 100);
    const factorTarifa = i + 1 >= tarifaDesde ? 1 + tarifaVar : 1;
    let costoLog: number;
    if (p.tercerizada) costoLog = kgAc * (p.tarifaTerceroKg ?? 0) * factorTarifa;
    else costoLog = kgAc * clog * (fijoPct * p.factorViajes + (1 - fijoPct)) * factorTarifa;
    costoLog += kgAc * remota * p.costoKgRemotoExtra;
    // BO01: separar efecto de tarifa del de volumen respecto de la base sin cambio de tarifa
    tarEfecto += costoLog - costoLog / factorTarifa;
    volEfecto += costoLog / factorTarifa;
    const otros = (s.otros_gastos_mes ?? 0) + p.costoExtraMes;
    const dep = depFlota + depInv;
    const impl = i === 0 ? p.implementacion : 0;
    const ebit = ingresos - costoProducto - costoLog - otros - dep - impl;
    const imp = Math.max(ebit, 0) * tasa;
    activos -= dep;
    const capital = capitalDe(ingresos / m.dias, costoProducto / m.dias, costoLog / m.dias, p.inventarioDias, activos);
    meses.push({ mes: m.mes, kg_demanda: kgDem, kg_aceptado: kgAc, ingresos, costo_producto: costoProducto, costo_logistico: costoLog, otros, depreciacion: dep, implementacion: impl, ebit, impuesto: imp, nopat: ebit - imp, capital_cierre: capital, viajes_rel: p.factorViajes, extension: m.extension });
  });
  // Capital de APERTURA: situación actual (inventario/flota de la base) con el ritmo del primer mes, igual para todos los escenarios
  const m1 = dem[0];
  const kg1 = m1.kg_demanda * (1 + (mods.demanda ?? 0)) * (1 - noAtBase);
  const apertura = capitalDe(kg1 * precio / m1.dias, kg1 * cprod * (1 + (s.merma_pct ?? 0) / 100) / m1.dias, kg1 * clog / m1.dias, s.inventario_dias ?? NaN, s.activos_flota_propia ?? NaN);
  const cierre = meses.at(-1)!.capital_cierre;
  const dias = dem.reduce((a, m) => a + m.dias, 0);
  const promedio = (apertura + cierre) / 2;
  const tasaCargo = dem.length === 12 ? wacc : tasaPeriodo(wacc, dias);
  const sum = (k: keyof FilaMes) => meses.reduce((a, f) => a + Number(f[k]), 0);
  const nop = sum('nopat');
  const noCalc = p.noCalculable;
  // Liberación de caja: menor inventario o venta de activos reduce capital; se informa aparte, NO en EBIT (L04, AI05)
  const cajaLib = Math.max(0, (s.activos_flota_propia ?? 0) - p.activosFlota) + Math.max(0, ((s.inventario_dias ?? 0) - p.inventarioDias) * (kg1 * cprod / m1.dias));
  return { id, nombre, descripcion, cambios: p.cambios, meses, capital_apertura: apertura, capital_cierre: cierre, capital_promedio: promedio,
    ingresos: sum('ingresos'), costo_logistico: sum('costo_logistico'), ebit: sum('ebit'), nopat: nop, cargo_capital: tasaCargo * promedio,
    eva: noCalc ? null : nop - tasaCargo * promedio, estado: noCalc ? 'NO_CALCULABLE' : 'CALCULADO', motivo: noCalc, delta_eva: null, inversion: p.inversion, caja_liberada: cajaLib,
    servicio, kg_no_atendido: sum('kg_demanda') - sum('kg_aceptado'), puente_costo: tarifaVar ? { volumen: volEfecto, tarifa: tarEfecto } : undefined };
}

// ------------------------------------------------------------------ Comparador (AV01–AV08)
export interface Pesos { eva: number; otif: number; retraso: number; costo: number; no_atendido: number }
export const PESOS_DEFECTO: Pesos = { eva: 0.35, otif: 0.25, retraso: 0.1, costo: 0.15, no_atendido: 0.15 };
export interface FilaComparador { id: string; nombre: string; factible: boolean; motivo: string; valores: Record<keyof Pesos, number | null>; normalizados: Record<keyof Pesos, number>; puntaje: number | null; dominada_por: string | null }
export function comparar(esc: Escenario[], pesos: Pesos, s: Record<string, number | null>) {
  const suma = Object.values(pesos).reduce((a, b) => a + b, 0);
  if (Object.values(pesos).some((w) => w < 0)) throw new Error('Los pesos no pueden ser negativos.');
  if (Math.abs(suma - 1) > 1e-6) throw new Error(`Los pesos deben sumar 1 (100 %). Suman ${(suma * 100).toFixed(1)} %.`);
  const pen = s.penalizacion_no_atencion_kg ?? 0;
  if (pen < 0) throw new Error('La penalización por no atención no puede ser negativa (AV07).');
  const otifMin = s.otif_minimo_pct ?? 0;
  const base = esc[0];
  // Criterios en sus propias unidades; el costo incluye la penalización por kg no atendido; la normalización es min–max sobre la MISMA cohorte (AV01, AV06)
  const val = (e: Escenario): Record<keyof Pesos, number | null> => ({ eva: e.eva, otif: e.servicio.otif_pct, retraso: e.servicio.retraso_p95_h, costo: e.costo_logistico + e.kg_no_atendido * pen, no_atendido: e.kg_no_atendido });
  const dir: Record<keyof Pesos, 1 | -1> = { eva: 1, otif: 1, retraso: -1, costo: -1, no_atendido: -1 };
  const filas: FilaComparador[] = esc.map((e) => {
    const v = val(e);
    let motivo = '';
    if (e.estado === 'NO_CALCULABLE') motivo = e.motivo ?? 'No calculable.';
    else if (e.servicio.otif_pct < otifMin) motivo = `OTIF esperado ${e.servicio.otif_pct.toFixed(1)} % < mínimo ${otifMin} % (restricción dura: un peso no la anula).`;
    else if (e.kg_no_atendido > base.kg_no_atendido * 1.0001 && e.id !== base.id) motivo = 'Deja más demanda sin atender que la base: la cobertura es una restricción, no un ahorro.';
    return { id: e.id, nombre: e.nombre, factible: !motivo, motivo, valores: v, normalizados: { eva: 0, otif: 0, retraso: 0, costo: 0, no_atendido: 0 }, puntaje: null, dominada_por: null };
  });
  const claves = Object.keys(pesos) as (keyof Pesos)[];
  const cohorte = filas.filter((f) => f.factible);
  const rango: Record<string, [number, number]> = {};
  for (const k of claves) { const xs = cohorte.map((f) => f.valores[k]!).filter((x) => x !== null); rango[k] = [Math.min(...xs), Math.max(...xs)]; }
  const puntuar = (w: Pesos) => {
    for (const f of cohorte) {
      let p = 0;
      for (const k of claves) {
        const [mn, mx] = rango[k], x = f.valores[k]!;
        const n = mx === mn ? 1 : dir[k] === 1 ? (x - mn) / (mx - mn) : (mx - x) / (mx - mn);
        f.normalizados[k] = n; p += w[k] * n;
      }
      f.puntaje = p;
    }
    return [...cohorte].sort((a, b) => b.puntaje! - a.puntaje! || a.valores.retraso! - b.valores.retraso! || b.valores.otif! - a.valores.otif!);
  };
  const orden = puntuar(pesos);
  // Dominancia (AV04): peor o igual en todos los criterios y peor en alguno que otra factible
  for (const f of cohorte) for (const g of cohorte) {
    if (f === g || f.dominada_por) continue;
    const peorIgual = claves.every((k) => dir[k] * (g.valores[k]! - f.valores[k]!) >= 0), peor = claves.some((k) => dir[k] * (g.valores[k]! - f.valores[k]!) > 1e-9);
    if (peorIgual && peor) f.dominada_por = g.nombre;
  }
  const empate = orden.length > 1 && Math.abs(orden[0].puntaje! - orden[1].puntaje!) < 1e-3;
  // Sensibilidad de pesos (AV05): ±0,05 en cada peso, renormalizado
  const fragil: string[] = [];
  for (const k of claves) for (const d of [-0.05, 0.05]) {
    const w = { ...pesos, [k]: Math.max(0, pesos[k] + d) }; const t = Object.values(w).reduce((a, b) => a + b, 0);
    for (const kk of claves) w[kk] /= t;
    const o = puntuar(w)[0];
    if (o && o.id !== orden[0]?.id) fragil.push(`${k} ${d > 0 ? '+' : '−'}0,05 → gana «${o.nombre}»`);
  }
  puntuar(pesos);
  const ganador = orden[0];
  const dGan = ganador ? esc.find((e) => e.id === ganador.id)!.delta_eva : null;
  const mejora = !!ganador && ganador.id !== base.id;
  return {
    filas, orden: orden.map((f) => f.id), rango, empate, fragil, cohorte_id: cohorte.map((f) => f.id).join('|'),
    conclusion: !cohorte.length ? 'Ninguna alternativa cumple las restricciones: no se recomienda un cambio.'
      : !mejora ? 'Ninguna alternativa mejora de forma defendible a la base con los criterios y restricciones elegidos: se mantiene la operación actual (AI07).'
      : `Mayor puntaje: «${ganador.nombre}» (ΔEVA ${dGan === null ? 'N/D' : 'S/ ' + fmtNum(dGan, 0)}${dGan !== null && dGan < 0 ? ': mejora el servicio a costa de valor económico; decidir con ese intercambio a la vista' : ''})${empate ? '. EMPATE técnico con la segunda; desempate declarado: menor retraso P95 y luego mayor OTIF' : ''}.${fragil.length ? ' Recomendación FRÁGIL: cambia con pequeños ajustes de pesos (' + fragil.join('; ') + ').' : ' La elección se mantiene con ajustes de ±0,05 en cada peso.'}`,
    advertencia: 'El puntaje combina criterios normalizados (0–1) dentro de esta cohorte; no suma soles con horas. Agregar o quitar una alternativa cambia los mínimos y máximos, por eso se recalcula todo.',
  };
}

// ------------------------------------------------------------------ Evaluación completa
export interface Evaluacion {
  version_motor: string; corte: string; horizonte_meses: number; convencion: string; demanda: { meses: Mes[]; nota: string; escenario: string };
  supuestos: Record<string, number | null>; escenarios: Escenario[]; combinacion: { ids: AltId[]; escenario: Escenario; suma_individual: number | null; solapamiento: number | null; explicacion: string } | null;
  sensibilidad: { id: string; nombre: string; base: number | null; demanda_menos10: number | null; demanda_mas10: number | null; tarifa_mas10: number | null; tarifa_menos10: number | null; wacc_mas2: number | null; wacc_menos2: number | null }[];
  comparador: ReturnType<typeof comparar>; sim_run_id: string | null; limitaciones: string[];
}
export function evaluar(repo: Repo, hechos: PedidoH[], o: { corte: string; meses?: number; desdeMes?: string; hastaMes?: string; sim?: ResultadoSim | null; simRunId?: string | null; combinar?: AltId[]; pesos?: Pesos; escenarioDemanda?: string | null; supuestosExtra?: Record<string, number | null> }): Evaluacion {
  const s = { ...supuestos(repo), ...(o.supuestosExtra ?? {}) };
  const e = validarSupuestos(s);
  if (e.length) throw new Error(e.join(' '));
  // Intervalo libre por meses completos: [desdeMes, hastaMes] (AAAA-MM), sin tope; los meses fuera de la ventana validada del pronóstico se rotulan EXTENSIÓN.
  const primero = primerMesCompleto(o.corte);
  const desdeMes = o.desdeMes ?? primero;
  const hastaMes = o.hastaMes ?? sumarMeses(desdeMes, (o.meses ?? 12) - 1);
  if (!/^\d{4}-\d{2}$/.test(desdeMes) || !/^\d{4}-\d{2}$/.test(hastaMes)) throw new Error('Indique el intervalo como meses AAAA-MM.');
  if (desdeMes < primero) throw new Error(`La proyección empieza en el primer mes completo posterior al corte (${primero}).`);
  if (hastaMes < desdeMes) throw new Error('«Hasta» no puede ser anterior a «Desde».');
  const total = difMeses(primero, hastaMes) + 1;
  const dem0 = demandaMensual(repo, hechos, o.corte, total, o.escenarioDemanda);
  const dem = { ...dem0, meses: dem0.meses.filter((m) => m.mes >= desdeMes && m.mes <= hastaMes) };
  const nMeses = dem.meses.length;
  const ind = indicadores(hechos, { desde: new Date(Date.parse(o.corte) - 364 * 86400000).toISOString(), hasta: o.corte, corte: o.corte });
  const otifHist = ind.find((k) => k.id === 'otif')?.valor ?? 0;
  const baseServ: Servicio = { otif_pct: otifHist, retraso_p95_h: 0, no_atendido_pct: 100 - (ind.find((k) => k.id === 'fill_rate')?.valor ?? 100), fuente: 'Historia' };
  const sim = o.sim ?? null;
  const calc = (ids: AltId[], mods = {}) => {
    const a = ids.length === 1 ? ALTERNATIVAS.find((x) => x.id === ids[0])! : ids.length === 0 ? ALTERNATIVAS[0] : { id: 'COMBINACION', nombre: 'Combinación: ' + ids.map((i) => ALTERNATIVAS.find((x) => x.id === i)!.nombre).join(' + '), descripcion: 'Cambios físicos aplicados juntos; el ahorro común se cuenta una sola vez.' };
    return calcular(a.id, a.nombre, a.descripcion, ids, s, dem.meses, sim, baseServ, mods);
  };
  const ids: AltId[][] = [[], ['CONSOLIDACION'], ['TERCERIZACION'], ['FEFO_STOCK'], ['NODO_APOYO'], ['OPERADOR_LOCAL'], ['ELIMINAR_REMOTOS']];
  const escenarios = ids.map((x) => calc(x));
  const base = escenarios[0];
  for (const x of escenarios) x.delta_eva = x.eva !== null && base.eva !== null ? x.eva - base.eva : null;
  let combinacion: Evaluacion['combinacion'] = null;
  if (o.combinar && o.combinar.length >= 2) {
    for (const [a, b] of INCOMPATIBLES) if (o.combinar.includes(a) && o.combinar.includes(b)) throw new Error(`No se pueden combinar «${ALTERNATIVAS.find((x) => x.id === a)!.nombre}» y «${ALTERNATIVAS.find((x) => x.id === b)!.nombre}»: son incompatibles.`);
    const c = calc(o.combinar);
    c.delta_eva = c.eva !== null && base.eva !== null ? c.eva - base.eva : null;
    const indiv = o.combinar.map((i) => escenarios.find((x) => x.id === i)!.delta_eva);
    const suma = indiv.some((x) => x === null) ? null : indiv.reduce((a, b) => a! + b!, 0)!;
    combinacion = { ids: o.combinar, escenario: c, suma_individual: suma, solapamiento: suma !== null && c.delta_eva !== null ? suma - c.delta_eva : null,
      explicacion: 'La combinación se calcula aplicando todos los cambios físicos a la vez (no sumando ahorros). La diferencia entre la suma de los ΔEVA individuales y el ΔEVA conjunto es el solapamiento: ahorro que dos alternativas reclamaban sobre el mismo costo.' };
    escenarios.push(c);
  }
  const sens = escenarios.map((x) => {
    const altIds = x.id === 'BASE' ? [] : x.id === 'COMBINACION' ? o.combinar! : [x.id as AltId];
    const d = (mods: { demanda?: number; tarifa?: number; wacc?: number }) => { const b = calc([], mods), a = calc(altIds, mods); return a.eva !== null && b.eva !== null ? a.eva - b.eva : null; };
    return { id: x.id, nombre: x.nombre, base: x.delta_eva, demanda_menos10: d({ demanda: -0.1 }), demanda_mas10: d({ demanda: 0.1 }), tarifa_mas10: d({ tarifa: 0.1 }), tarifa_menos10: d({ tarifa: -0.1 }), wacc_mas2: d({ wacc: 0.02 }), wacc_menos2: d({ wacc: -0.02 }) };
  });
  const comparador = comparar(escenarios, o.pesos ?? PESOS_DEFECTO, s);
  return {
    version_motor: VERSION_MOTOR_ECO, corte: o.corte, horizonte_meses: nMeses, demanda: dem, supuestos: s, escenarios, combinacion, sensibilidad: sens, comparador, sim_run_id: o.simRunId ?? null,
    convencion: `Intervalo ${desdeMes} a ${hastaMes}. ` + (nMeses === 12
      ? 'EVA ANUAL = NOPAT de los 12 meses − WACC anual × capital operativo promedio (promedio aritmético del capital de apertura y del cierre del mes 12). Impuesto modelado = máx(EBIT, 0) × tasa; sin crédito por pérdidas.'
      : `EVA DEL PERÍODO (${nMeses} meses, ${dem.meses.reduce((a, m) => a + m.dias, 0)} días) = NOPAT del período − r × capital promedio, con r = (1 + WACC)^(días/365) − 1 (convención de 365 días). No se compara con un EVA anual sin homologar.`),
    limitaciones: [
      'Unidad demostrativa de distribución con datos sintéticos (NutriDemo): no es el EVA de Alprosa.',
      'El capital de apertura es el mismo para todas las alternativas (situación actual); cada alternativa cambia el capital durante el horizonte.',
      'Los efectos de nodo de apoyo y operador local sobre el servicio son SUPUESTOS editables, no resultados simulados.',
      'La demanda es la misma para todas las alternativas (misma cohorte); una alternativa no puede «ahorrar» atendiendo menos sin que se vea en la demanda no atendida.',
    ],
  };
}

export function guardarEvaluacion(repo: Repo, usuario: string, ev: Evaluacion) {
  return repo.transaccion(() => {
    exigir(repo, usuario, 'EVALUAR_ECONOMIA');
    const id = nuevoId('EVA');
    repo.run('INSERT INTO corrida_economica VALUES (?,?,?,?,?,?,?,?,?)', [id, repo.reloj(), usuario, ev.sim_run_id, JSON.stringify(ev.supuestos), ev.demanda.escenario, ev.horizonte_meses, JSON.stringify(ev), VERSION_MOTOR_ECO]);
    return id;
  });
}
export function evaluaciones(repo: Repo) {
  return repo.todos('SELECT run_id, creada_en, creada_por, sim_run_id, escenario_demanda, horizonte_meses FROM corrida_economica ORDER BY creada_en DESC, run_id DESC');
}
export function evaluacionGuardada(repo: Repo, runId: string): Evaluacion | null {
  const r = repo.uno('SELECT resultados FROM corrida_economica WHERE run_id = ?', [runId]);
  return r ? (JSON.parse(String(r.resultados)) as Evaluacion) : null;
}

// ------------------------------------------------------------------ Escenarios de demanda (AU06)
export function crearEscenarioDemanda(repo: Repo, usuario: string, e: { nombre: string; producto_id: string | null; desde: string; hasta: string; aumento_pct: number; fuente: string }) {
  return repo.transaccion(() => {
    exigir(repo, usuario, 'SIMULAR');
    if (!e.nombre.trim() || !e.fuente.trim()) throw new Error('Indique nombre y fuente del supuesto (quién comunicó la promoción).');
    if (!(e.hasta > e.desde)) throw new Error('La fecha «hasta» debe ser posterior a «desde».');
    if (!(e.aumento_pct > -100 && e.aumento_pct <= 500)) throw new Error('El cambio de demanda va de −99 % a +500 %.');
    const id = nuevoId('ESC');
    repo.run('INSERT INTO escenario_demanda VALUES (?,?,?,?,?,?,?,?,?)', [id, e.nombre.trim(), e.producto_id, e.desde, e.hasta, e.aumento_pct, e.fuente.trim(), repo.reloj(), usuario]);
    return id;
  });
}
export const escenariosDemanda = (repo: Repo) => repo.todos('SELECT * FROM escenario_demanda ORDER BY creado_en DESC');
