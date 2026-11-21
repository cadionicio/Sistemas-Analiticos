// I05: indicadores con definición, numerador, denominador, unidad y N/D (§8, §8.1, §8.2).
// Universo único: historia sintética cerrada (hist_*) + operación registrada en la aplicación. Rangos semiabiertos [desde, hasta).
import type { Repo } from './db';

export type Vista = 'REEXPRESADA' | 'ORIGINAL';
export type Gran = 'dia' | 'semana' | 'mes';
export interface Filtros { desde: string; hasta: string; granularidad?: Gran; region?: string; destino?: string; cliente?: string; producto?: string; modo?: string; remoto?: boolean; vista?: Vista; corte?: string; evaluadoAl?: string }
export interface LineaH { linea: number; producto: string; sol: number; comp: number; noAt: number; motivoNoAt: string | null; kgMil: number }
export interface EntregaH { id: string; intento: number; ocurrido: string; registrado: string; estado: string; motivo: string | null; linea: number | null; acept: number; rech: number }
export interface EtapaH { id: string; tramo: number; modo: string; origen: string; destino: string; servicio: string; salPlan: string; salReal: string; llePlan: string; lleReal: string; kg: number; cap: number; perdida: boolean; est: number; real: number | null; motivo: string | null }
export interface PedidoH { id: string; fuente: 'HISTORIA' | 'OPERACION'; cliente: string; destino: string; region: string; remoto: boolean; fechaPedido: string; registrado: string; ini: string; fin: string; tipo: string; cancelado: string | null; motivoCancel: string | null; prioridad: string; lineas: LineaH[]; entregas: EntregaH[]; devol: { linea: number; q: number; ocurrido: string; registrado: string; motivo: string | null }[]; etapas: EtapaH[] }

export interface Indicador { id: string; nombre: string; valor: number | null; unidad: string; numerador: number; denominador: number; definicion: string; inclusion: string; n: number }

const t = (s: string) => Date.parse(s);
const kgDe = (q: number, kgMil: number) => (q / 1000) * (kgMil / 1000);

/** Carga todos los hechos (historia + operación). Se cachea por versión de datos en la UI. */
export function cargarHechos(repo: Repo): PedidoH[] {
  const peso = new Map(repo.todos('SELECT producto_id, peso_kg_por_unidad_mil FROM producto').map((p) => [String(p.producto_id), Number(p.peso_kg_por_unidad_mil)]));
  const remotos = new Set(repo.todos("SELECT d.destino_id FROM destino d JOIN nodo n ON n.nodo_id = d.nodo_id WHERE d.precision_geografica IN ('CENTROIDE','DESCONOCIDA') OR CAST(substr(d.destino_id, 5) AS INTEGER) % 5 = 0").map((x) => String(x.destino_id)));
  const regionDe = new Map(repo.todos('SELECT destino_id, region FROM destino').map((d) => [String(d.destino_id), String(d.region)]));
  const out = new Map<string, PedidoH>();
  for (const p of repo.todos('SELECT * FROM hist_pedido')) out.set(String(p.pedido_id), { id: String(p.pedido_id), fuente: 'HISTORIA', cliente: String(p.cliente_id), destino: String(p.destino_id), region: String(p.region), remoto: p.remoto === 1,
    fechaPedido: String(p.fecha_pedido), registrado: String(p.registrado_en), ini: String(p.compromiso_inicio), fin: String(p.compromiso_fin), tipo: String(p.tipo_demanda), cancelado: p.cancelado_en ? String(p.cancelado_en) : null,
    motivoCancel: p.motivo_cancelacion ? String(p.motivo_cancelacion) : null, prioridad: String(p.prioridad), lineas: [], entregas: [], devol: [], etapas: [] });
  for (const l of repo.todos('SELECT * FROM hist_linea')) out.get(String(l.pedido_id))?.lineas.push({ linea: Number(l.linea), producto: String(l.producto_id), sol: Number(l.solicitado_mil), comp: Number(l.comprometido_mil), noAt: Number(l.no_atendido_mil), motivoNoAt: l.motivo_no_atendido ? String(l.motivo_no_atendido) : null, kgMil: peso.get(String(l.producto_id)) ?? 1000 });
  for (const e of repo.todos('SELECT * FROM hist_entrega')) out.get(String(e.pedido_id))?.entregas.push({ id: String(e.entrega_id), intento: Number(e.intento), ocurrido: String(e.ocurrido_en), registrado: String(e.registrado_en), estado: String(e.estado), motivo: e.motivo ? String(e.motivo) : null, linea: e.linea === null ? null : Number(e.linea), acept: Number(e.aceptado_mil), rech: Number(e.rechazado_mil) });
  for (const d of repo.todos('SELECT * FROM hist_devolucion')) out.get(String(d.pedido_id))?.devol.push({ linea: Number(d.linea), q: Number(d.q_mil), ocurrido: String(d.ocurrido_en), registrado: String(d.registrado_en), motivo: d.motivo ? String(d.motivo) : null });
  for (const e of repo.todos('SELECT * FROM hist_etapa ORDER BY pedido_id, tramo')) out.get(String(e.pedido_id))?.etapas.push({ id: String(e.etapa_id), tramo: Number(e.tramo), modo: String(e.modo_id), origen: String(e.nodo_origen_id), destino: String(e.nodo_destino_id), servicio: String(e.servicio_ref),
    salPlan: String(e.salida_plan), salReal: String(e.salida_real), llePlan: String(e.llegada_plan), lleReal: String(e.llegada_real), kg: Number(e.kg_mil) / 1000, cap: Number(e.capacidad_kg_mil) / 1000, perdida: e.conexion_perdida === 1, est: Number(e.costo_estimado_cent), real: e.costo_real_cent === null ? null : Number(e.costo_real_cent), motivo: e.motivo_retraso ? String(e.motivo_retraso) : null });
  // Operación registrada en la aplicación (pedidos confirmados; los borradores no son demanda)
  for (const p of repo.todos("SELECT * FROM pedido WHERE estado_base <> 'BORRADOR' OR cancelado_en IS NOT NULL")) {
    if (p.estado_base === 'BORRADOR') continue;
    const h: PedidoH = { id: String(p.pedido_id), fuente: 'OPERACION', cliente: String(p.cliente_id), destino: String(p.destino_id), region: regionDe.get(String(p.destino_id)) ?? '—', remoto: remotos.has(String(p.destino_id)),
      fechaPedido: String(p.fecha_pedido).length === 10 ? String(p.fecha_pedido) + 'T09:00:00-05:00' : String(p.fecha_pedido), registrado: String(p.confirmado_en ?? p.fecha_pedido), ini: String(p.ventana_inicio), fin: String(p.ventana_fin), tipo: 'FIRME',
      cancelado: p.cancelado_en ? String(p.cancelado_en) : null, motivoCancel: p.motivo_cancelacion ? String(p.motivo_cancelacion) : null, prioridad: String(p.prioridad), lineas: [], entregas: [], devol: [], etapas: [] };
    const lineas = repo.todos('SELECT * FROM pedido_linea WHERE pedido_id = ? ORDER BY pedido_linea_id', [p.pedido_id]);
    const idx = new Map(lineas.map((l, i) => [String(l.pedido_linea_id), i + 1]));
    for (const l of lineas) h.lineas.push({ linea: idx.get(String(l.pedido_linea_id))!, producto: String(l.producto_id), sol: Number(l.q_solicitada_mil), comp: Number(l.q_solicitada_mil) - Number(l.q_cancelada_mil), noAt: 0, motivoNoAt: null, kgMil: peso.get(String(l.producto_id)) ?? 1000 });
    for (const e of repo.todos('SELECT e.*, d.pedido_linea_id, d.aceptado_mil, d.rechazado_mil FROM entrega e LEFT JOIN entrega_detalle d USING (entrega_id) WHERE e.pedido_id = ?', [p.pedido_id]))
      h.entregas.push({ id: String(e.entrega_id), intento: Number(e.intento), ocurrido: String(e.ocurrido_en), registrado: String(e.verificada_en ?? e.registrado_en), estado: String(e.estado), motivo: e.motivo ? String(e.motivo) : null,
        linea: e.pedido_linea_id ? idx.get(String(e.pedido_linea_id)) ?? null : null, acept: Number(e.aceptado_mil ?? 0), rech: Number(e.rechazado_mil ?? 0) });
    for (const r of repo.todos("SELECT * FROM retorno WHERE tipo LIKE 'DEVOLUCION%' AND pedido_linea_id IN (SELECT pedido_linea_id FROM pedido_linea WHERE pedido_id = ?)", [p.pedido_id]))
      h.devol.push({ linea: idx.get(String(r.pedido_linea_id))!, q: Number(r.q_mil), ocurrido: String(r.recibido_en ?? r.anunciado_en), registrado: String(r.recibido_en ?? r.anunciado_en), motivo: String(r.motivo) });
    for (const e of repo.todos(`SELECT e.*, s.salida, s.llegada, s.tarifa_fija_cent, s.costo_kg_p4, r.capacidad_kg_mil, en.modo_id FROM etapa e JOIN itinerario i USING (itinerario_id) JOIN servicio s USING (servicio_id)
        JOIN recurso r ON r.recurso_id = s.recurso_id JOIN enlace en ON en.enlace_id = s.enlace_id WHERE i.pedido_id = ? AND e.estado <> 'CANCELADA' AND i.estado <> 'CANCELADO' ORDER BY e.tramo`, [p.pedido_id])) {
      const inc = repo.uno("SELECT tipo, descripcion FROM incidencia WHERE etapa_id = ? ORDER BY registrado_en LIMIT 1", [e.etapa_id]);
      h.etapas.push({ id: String(e.etapa_id), tramo: Number(e.tramo), modo: String(e.modo_id), origen: String(e.nodo_origen_id), destino: String(e.nodo_destino_id), servicio: String(e.servicio_id),
        salPlan: String(e.salida), salReal: String(e.despachada_en ?? e.salida), llePlan: String(e.llegada), lleReal: String(e.recibida_en ?? e.llegada), kg: Number(e.kg_bruto_mil) / 1000, cap: Number(e.capacidad_kg_mil) / 1000, perdida: false,
        est: Number(e.tarifa_fija_cent) + Math.round((Number(e.kg_bruto_mil) / 1000) * Number(e.costo_kg_p4) / 100), real: null, motivo: inc ? `${String(inc.tipo).toLowerCase()}: ${inc.descripcion}` : null });
    }
    out.set(h.id, h);
  }
  return [...out.values()];
}

// ------------------------------------------------------------------ Universo y reconstrucción
export function validarRango(f: Filtros) {
  if (!f.desde || !f.hasta) throw new Error('Indique fecha desde y hasta.');
  if (t(f.desde) >= t(f.hasta)) throw new Error('La fecha «desde» debe ser anterior a «hasta».');
}
function pasaFiltros(p: PedidoH, f: Filtros) {
  if (f.region && p.region !== f.region) return false;
  if (f.destino && p.destino !== f.destino) return false;
  if (f.cliente && p.cliente !== f.cliente) return false;
  if (f.remoto !== undefined && p.remoto !== f.remoto) return false;
  if (f.producto && !p.lineas.some((l) => l.producto === f.producto)) return false;
  if (f.modo && !p.etapas.some((e) => e.modo === f.modo)) return false;
  return true;
}
/** Lo que se sabía al corte (vista ORIGINAL) o todo lo registrado hasta hoy (REEXPRESADA). */
const conocido = (registrado: string, f: Filtros) => f.vista !== 'ORIGINAL' || !f.corte || t(registrado) <= t(f.corte);

/** Cantidad aceptada neta por línea al cierre de la ventana original (inclusive), reconstruida por eventos (§8). */
export function aceptadoAlCierre(p: PedidoH, f: Filtros) {
  const m = new Map<number, number>();
  for (const e of p.entregas) if (e.linea !== null && e.acept > 0 && t(e.ocurrido) <= t(p.fin) && conocido(e.registrado, f)) m.set(e.linea, (m.get(e.linea) ?? 0) + e.acept);
  for (const d of p.devol) if (t(d.ocurrido) <= t(p.fin) && conocido(d.registrado, f)) m.set(d.linea, (m.get(d.linea) ?? 0) - d.q);
  return m;
}
export function aceptadoTotal(p: PedidoH, f: Filtros) {
  const m = new Map<number, number>();
  for (const e of p.entregas) if (e.linea !== null && e.acept > 0 && conocido(e.registrado, f)) m.set(e.linea, (m.get(e.linea) ?? 0) + e.acept);
  return m;
}
export type Evaluado = PedidoH & { elegible: boolean; motivoExclusion: string | null; otif: boolean | null; causa: string };
/** Universo de OTIF: cohorte por fecha de compromiso ORIGINAL en [desde, hasta), vencida al corte, sin borradores ni cancelaciones anteriores al compromiso. */
export function universoOTIF(hechos: PedidoH[], f: Filtros): Evaluado[] {
  validarRango(f);
  const corte = f.evaluadoAl ?? f.corte ?? new Date().toISOString();
  return hechos.filter((p) => t(p.fin) >= t(f.desde) && t(p.fin) < t(f.hasta) && pasaFiltros(p, f) && conocido(p.registrado, f)).map((p) => {
    let motivo: string | null = null;
    if (p.tipo !== 'FIRME') motivo = p.tipo === 'CONSULTA' ? 'Consulta no confirmada (no es demanda firme)' : 'Duplicado';
    else if (p.cancelado && t(p.cancelado) < t(p.fin) && conocido(p.cancelado, f)) motivo = 'Cancelado antes del compromiso';
    else if (t(p.fin) > t(corte)) motivo = 'Compromiso aún no vencido al corte';
    const ac = aceptadoAlCierre(p, f);
    const otif = motivo ? null : p.lineas.every((l) => (ac.get(l.linea) ?? 0) >= l.comp);
    return { ...p, elegible: !motivo, motivoExclusion: motivo, otif, causa: otif === false ? causaRegistrada(p) : '' };
  });
}
/** Causa registrada de un incumplimiento (no es causa raíz confirmada). */
export function causaRegistrada(p: PedidoH): string {
  const et = p.etapas.find((e) => e.motivo);
  if (et) return et.motivo!;
  const fall = p.entregas.find((e) => e.estado === 'FALLIDO' && e.motivo);
  if (fall) return fall.motivo!;
  const ln = p.lineas.find((l) => l.noAt > 0 && l.motivoNoAt);
  if (ln) return ln.motivoNoAt!;
  if (p.cancelado) return p.motivoCancel ?? 'Cancelado';
  const parc = p.entregas.find((e) => e.rech > 0 && e.motivo);
  if (parc) return parc.motivo!;
  return 'Sin causa registrada';
}

// ------------------------------------------------------------------ Indicadores
const pct = (n: number, d: number) => (d ? (n / d) * 100 : null);
export function indicadores(hechos: PedidoH[], f: Filtros): Indicador[] {
  const U = universoOTIF(hechos, f), E = U.filter((p) => p.elegible);
  const rango = `compromiso original en [${f.desde.slice(0, 10)}, ${f.hasta.slice(0, 10)})`;
  const ok = E.filter((p) => p.otif).length;
  // por intento
  const intentos = new Map<string, { ok: boolean; acept: number }>();
  for (const p of E) for (const e of p.entregas) if (conocido(e.registrado, f)) {
    const k = `${p.id}|${e.id}`; const x = intentos.get(k) ?? { ok: t(e.ocurrido) <= t(p.fin) && t(e.ocurrido) >= t(p.ini) - 7 * 86400000, acept: 0 }; x.acept += e.acept; intentos.set(k, x);
  }
  const conAcept = [...intentos.values()].filter((x) => x.acept > 0), fallidos = [...intentos.values()].filter((x) => x.acept === 0).length;
  // fill rate y kg
  let compKg = 0, aceptKg = 0, noAtKg = 0, devKg = 0, solKg = 0;
  for (const p of E) {
    const ac = aceptadoTotal(p, f);
    for (const l of p.lineas) { compKg += kgDe(l.comp, l.kgMil); solKg += kgDe(l.sol, l.kgMil); aceptKg += kgDe(Math.min(ac.get(l.linea) ?? 0, l.comp), l.kgMil); noAtKg += kgDe(l.noAt, l.kgMil); }
    for (const d of p.devol) if (conocido(d.registrado, f)) devKg += kgDe(d.q, p.lineas.find((l) => l.linea === d.linea)?.kgMil ?? 1000);
  }
  // costos
  let costoReal = 0, costoEst = 0, conReal = 0, etapasN = 0;
  for (const p of E) for (const e of p.etapas) { costoEst += e.est; costoReal += e.real ?? e.est; if (e.real !== null) conReal++; etapasN++; }
  // utilización por salida (cada salida se cuenta una vez) — por fecha de salida en el rango
  const serv = new Map<string, { kg: number; cap: number }>();
  for (const p of hechos) if (pasaFiltros(p, f)) for (const e of p.etapas) if (t(e.salPlan) >= t(f.desde) && t(e.salPlan) < t(f.hasta) && (!f.modo || e.modo === f.modo)) {
    const s = serv.get(e.servicio) ?? { kg: 0, cap: e.cap }; s.kg += e.kg; serv.set(e.servicio, s);
  }
  const kgServ = [...serv.values()].reduce((a, s) => a + s.kg, 0), capServ = [...serv.values()].reduce((a, s) => a + s.cap, 0);
  const transb = E.flatMap((p) => p.etapas.filter((e) => e.tramo > 1)), perdidas = transb.filter((e) => e.perdida).length;
  const leads = E.map((p) => { const pr = p.entregas.filter((e) => e.acept > 0 && conocido(e.registrado, f)).map((e) => t(e.ocurrido)).sort()[0]; return pr ? (pr - t(p.fechaPedido)) / 3600000 : null; }).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const med = leads.length ? (leads.length % 2 ? leads[(leads.length - 1) / 2] : (leads[leads.length / 2 - 1] + leads[leads.length / 2]) / 2) : null;
  const dest = new Map<string, boolean>();
  for (const p of E) dest.set(p.destino, (dest.get(p.destino) ?? false) || [...aceptadoTotal(p, f).values()].some((q) => q > 0));
  const destOk = [...dest.values()].filter(Boolean).length;
  return [
    { id: 'otif', nombre: 'OTIF por pedido', valor: pct(ok, E.length), unidad: '%', numerador: ok, denominador: E.length, n: E.length,
      definicion: 'Pedidos cuyo total comprometido (todas sus líneas) se aceptó a más tardar en la hora original comprometida (inclusive) ÷ pedidos elegibles vencidos. Un reintento tardío no lo vuelve puntual; una devolución posterior al cierre no lo cambia.',
      inclusion: `${rango}; excluye consultas, duplicados, cancelados antes del compromiso y compromisos no vencidos (${U.length - E.length} excluidos).` },
    { id: 'puntualidad_intento', nombre: 'Puntualidad por intento', valor: pct(conAcept.filter((x) => x.ok).length, conAcept.length), unidad: '%', numerador: conAcept.filter((x) => x.ok).length, denominador: conAcept.length, n: conAcept.length,
      definicion: 'Intentos con aceptación positiva ocurridos dentro de la ventana ÷ intentos con aceptación positiva. No reemplaza al OTIF por pedido; los fallidos se miden aparte.', inclusion: `${rango}; ${fallidos} intento(s) fallido(s) aparte.` },
    { id: 'intentos_fallidos', nombre: 'Intentos fallidos', valor: intentos.size ? fallidos : null, unidad: 'intentos', numerador: fallidos, denominador: intentos.size, n: intentos.size, definicion: 'Intentos de entrega sin aceptación (ausencia, rechazo total).', inclusion: rango },
    { id: 'fill_rate', nombre: 'Fill rate (kg)', valor: pct(aceptKg, compKg), unidad: '%', numerador: aceptKg, denominador: compKg, n: E.length,
      definicion: 'kg aceptados ÷ kg comprometidos; cada presentación se convierte a kg con su peso. No usa lo despachado como entregado.', inclusion: `${rango}; pedidos elegibles.` },
    { id: 'costo_kg', nombre: 'Costo logístico por kg aceptado', valor: aceptKg ? costoReal / 100 / aceptKg : null, unidad: 'S/ por kg', numerador: costoReal / 100, denominador: aceptKg, n: etapasN,
      definicion: 'Costo de transporte devengado (real; estimado si no hay comprobante) de las etapas de los pedidos elegibles ÷ kg aceptados. Incluye viajes fallidos; las devoluciones no restan kg.', inclusion: `${rango}; ${conReal} de ${etapasN} etapas con costo real.` },
    { id: 'variacion_costo', nombre: 'Costo real vs estimado', valor: costoEst ? ((costoReal - costoEst) / costoEst) * 100 : null, unidad: '%', numerador: (costoReal - costoEst) / 100, denominador: costoEst / 100, n: etapasN, definicion: '(costo real − estimado) ÷ estimado.', inclusion: rango },
    { id: 'utilizacion', nombre: 'Utilización de capacidad', valor: pct(kgServ, capServ), unidad: '%', numerador: kgServ, denominador: capServ, n: serv.size,
      definicion: 'kg transportados ÷ capacidad de las salidas usadas; cada salida compartida cuenta su capacidad una sola vez.', inclusion: `salidas con fecha en [${f.desde.slice(0, 10)}, ${f.hasta.slice(0, 10)})` },
    { id: 'conexiones_perdidas', nombre: 'Conexiones perdidas', valor: pct(perdidas, transb.length), unidad: '%', numerador: perdidas, denominador: transb.length, n: transb.length, definicion: 'Transbordos en que la carga no alcanzó la salida prevista ÷ transbordos.', inclusion: rango },
    { id: 'lead_time', nombre: 'Lead time mediano', valor: med, unidad: 'horas', numerador: med ?? 0, denominador: leads.length, n: leads.length, definicion: 'Mediana de horas desde el pedido hasta la primera aceptación.', inclusion: rango },
    { id: 'no_atendido', nombre: 'Demanda no atendida (censurada)', valor: solKg ? noAtKg : null, unidad: 'kg', numerador: noAtKg, denominador: solKg, n: E.length, definicion: 'kg solicitados que no se comprometieron por falta de stock. Es demanda censurada: no se resta de la demanda solicitada.', inclusion: rango },
    { id: 'devoluciones', nombre: 'Devoluciones', valor: pct(devKg, aceptKg), unidad: '%', numerador: devKg, denominador: aceptKg, n: E.length, definicion: 'kg devueltos después de aceptar ÷ kg aceptados (categoría excluyente con rechazo en entrega).', inclusion: rango },
    { id: 'cobertura', nombre: 'Cobertura de destinos', valor: pct(destOk, dest.size), unidad: '%', numerador: destOk, denominador: dest.size, n: dest.size, definicion: 'Destinos con al menos una aceptación ÷ destinos con pedidos elegibles.', inclusion: rango },
  ];
}

// ------------------------------------------------------------------ Series (sumas por período; porcentajes desde numerador/denominador)
export function periodo(iso: string, g: Gran) {
  const d = new Date(t(iso) - 5 * 3600000);
  if (g === 'dia') return d.toISOString().slice(0, 10);
  if (g === 'mes') return d.toISOString().slice(0, 7);
  const dow = (d.getUTCDay() + 6) % 7; return new Date(d.getTime() - dow * 86400000).toISOString().slice(0, 10);
}
export function serieOTIF(hechos: PedidoH[], f: Filtros) {
  const g = f.granularidad ?? 'semana', m = new Map<string, { num: number; den: number; fillN: number; fillD: number }>();
  for (const p of universoOTIF(hechos, f)) {
    if (!p.elegible) continue;
    const k = periodo(p.fin, g), x = m.get(k) ?? { num: 0, den: 0, fillN: 0, fillD: 0 };
    x.den++; if (p.otif) x.num++;
    const ac = aceptadoTotal(p, f);
    for (const l of p.lineas) { x.fillD += kgDe(l.comp, l.kgMil); x.fillN += kgDe(Math.min(ac.get(l.linea) ?? 0, l.comp), l.kgMil); }
    m.set(k, x);
  }
  return [...m.entries()].sort().map(([periodo, x]) => ({ periodo, ...x, otif: pct(x.num, x.den), fill: pct(x.fillN, x.fillD) }));
}

// ------------------------------------------------------------------ Diagnóstico descriptivo
/** Pareto de causas registradas de incumplimiento, con «Sin causa registrada» visible y tamaño de muestra (§8). */
export function pareto(hechos: PedidoH[], f: Filtros) {
  const fallas = universoOTIF(hechos, f).filter((p) => p.otif === false);
  const m = new Map<string, string[]>();
  for (const p of fallas) { const c = p.causa || 'Sin causa registrada'; m.set(c, [...(m.get(c) ?? []), p.id]); }
  let acum = 0;
  return { n: fallas.length, filas: [...m.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).map(([causa, ids]) => { acum += ids.length; return { causa, n: ids.length, pct: (ids.length / fallas.length) * 100, acumulado: (acum / fallas.length) * 100, pedidos: ids }; }),
    advertencia: 'El Pareto prioriza causas REGISTRADAS; no confirma causa raíz.' };
}
/** Concentración del incumplimiento por una dimensión (destino, región, modo final o tramo). */
export function concentracion(hechos: PedidoH[], f: Filtros, dim: 'region' | 'destino' | 'modo' | 'remoto') {
  const m = new Map<string, { n: number; fallas: number }>();
  for (const p of universoOTIF(hechos, f).filter((x) => x.elegible)) {
    const k = dim === 'modo' ? (p.etapas.at(-1)?.modo ?? 'sin etapa') : dim === 'remoto' ? (p.remoto ? 'Remotos' : 'No remotos') : p[dim];
    const x = m.get(k) ?? { n: 0, fallas: 0 }; x.n++; if (!p.otif) x.fallas++; m.set(k, x);
  }
  return [...m.entries()].map(([clave, x]) => ({ clave, ...x, otif: pct(x.n - x.fallas, x.n) })).sort((a, b) => (a.otif ?? 0) - (b.otif ?? 0));
}
/** Puente ORIGINAL (lo conocido al corte de emisión) → REEXPRESADA (con registros posteriores) (§8.2, AX01, AX03, AX08). */
export function puenteOTIF(hechos: PedidoH[], f: Filtros, corteEmision: string) {
  const o = universoOTIF(hechos, { ...f, vista: 'ORIGINAL', corte: corteEmision, evaluadoAl: corteEmision }), r = universoOTIF(hechos, { ...f, vista: 'REEXPRESADA', corte: f.corte, evaluadoAl: corteEmision });
  const mo = new Map(o.map((p) => [p.id, p]));
  const cambios = r.filter((p) => { const a = mo.get(p.id); return !a || a.elegible !== p.elegible || a.otif !== p.otif; }).map((p) => {
    const a = mo.get(p.id);
    const motivo = !a ? 'Pedido registrado después del corte de emisión' : a.otif === false && p.otif ? 'Aceptación ocurrida a tiempo pero registrada después del corte' : a.elegible !== p.elegible ? 'Cambio de elegibilidad (cancelación o vencimiento registrado después)' : 'Otro evento registrado después del corte';
    return { pedido_id: p.id, antes: a ? (a.elegible ? (a.otif ? 'OTIF' : 'No OTIF') : 'Excluido') : 'No conocido', despues: p.elegible ? (p.otif ? 'OTIF' : 'No OTIF') : 'Excluido', motivo };
  });
  const val = (u: Evaluado[]) => { const e = u.filter((x) => x.elegible); return { num: e.filter((x) => x.otif).length, den: e.length, valor: pct(e.filter((x) => x.otif).length, e.length) }; };
  return { original: { corte: corteEmision, ...val(o) }, reexpresada: { corte: f.corte ?? 'actual', ...val(r) }, cambios, nota: 'La diferencia se explica por registros tardíos; no es una mejora operativa.' };
}
