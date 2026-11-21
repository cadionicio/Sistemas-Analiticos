// Planificación multimodal por etapas, ejecución física y custodia (I04-a).
// Reglas: RN-09/10/11/12 (capacidad, recursos, red, ventanas), RN-28..RN-37 (itinerario completo, servicio compartido, reserva única,
// bultos, conexión temporal, calendarios, recepción, accesibilidad, modos), RN-13/RN-45 (entrega final y estado de extremo a extremo), RN-53 (facultad y evidencia).
import type { Repo, Fila } from './db';
import { exigir, actor } from './permisos';
import { nuevoId, aLima } from './util';
import { verificarInvariantes, parametro, ErrorValidacion } from './dominio';

const ms = (iso: string) => Date.parse(iso);
const fecha = (iso: string) => iso.slice(0, 10);
const sumaDias = (f: string, n: number) => new Date(Date.parse(f + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);

// ------------------------------------------------------------------ Estado de acceso con vigencia (RN-36, Z/U/W)
export function estadoEnlace(repo: Repo, enlaceId: string, desde: string, hasta: string): { estado: string; motivo: string; fuente: string } {
  const e = repo.uno('SELECT estado_acceso, fuente FROM enlace WHERE enlace_id = ?', [enlaceId])!;
  const conds = repo.todos('SELECT * FROM condicion_acceso WHERE enlace_id = ? ORDER BY registrado_en', [enlaceId])
    .filter((c) => ms(String(c.vigente_desde)) < ms(hasta) && ms(String(c.vigente_hasta)) > ms(desde));
  if (!conds.length) return { estado: String(e.estado_acceso), motivo: 'Estado base del enlace', fuente: String(e.fuente) };
  const peor = ['INTERRUMPIDO', 'DESCONOCIDO', 'RESTRINGIDO', 'NORMAL'].find((s) => conds.some((c) => c.estado === s))!;
  const c = conds.filter((x) => x.estado === peor).at(-1)!;
  return { estado: peor, motivo: String(c.motivo), fuente: String(c.fuente) };
}

export function registrarCondicion(repo: Repo, usuario: string, c: { enlace_id: string; estado: string; motivo: string; desde: string; hasta: string; fuente: string }) {
  return repo.transaccion(() => {
    const a = exigir(repo, usuario, 'PLANIFICAR');
    if (!c.motivo?.trim() || !c.fuente?.trim()) throw new Error('Indique motivo y fuente de la condición de acceso.');
    if (!(ms(c.hasta) > ms(c.desde))) throw new Error('La vigencia debe terminar después de empezar.');
    const id = nuevoId('CAC');
    repo.run('INSERT INTO condicion_acceso VALUES (?,?,?,?,?,?,?,?,?)', [id, c.enlace_id, c.estado, c.motivo.trim(), c.desde, c.hasta, repo.reloj(), c.fuente.trim(), usuario]);
    repo.auditar(a, 'CONDICION_ACCESO', null, { id, ...c });
    // Planes confirmados que usan ese enlace en el intervalo quedan señalados para replanificar (no se mueven solos).
    return { condicion_id: id, afectados: itinerariosAfectados(repo, c.enlace_id, c.desde, c.hasta) };
  });
}
export function itinerariosAfectados(repo: Repo, enlaceId: string, desde: string, hasta: string) {
  return repo.todos(`SELECT DISTINCT i.itinerario_id, i.pedido_id FROM etapa e JOIN servicio s USING (servicio_id) JOIN itinerario i USING (itinerario_id)
    WHERE s.enlace_id = ? AND e.estado = 'PLANIFICADA' AND i.estado IN ('CONFIRMADO','EN_EJECUCION')`, [enlaceId])
    .filter((f) => { const s = repo.uno("SELECT salida, llegada FROM servicio s JOIN etapa e USING (servicio_id) WHERE e.itinerario_id = ? AND s.enlace_id = ? LIMIT 1", [f.itinerario_id, enlaceId])!; return ms(String(s.salida)) < ms(hasta) && ms(String(s.llegada)) > ms(desde); })
    .map((f) => ({ itinerario_id: String(f.itinerario_id), pedido_id: String(f.pedido_id) }));
}

// ------------------------------------------------------------------ Carga a planificar
export interface ItemCarga { pedido_linea_id: string; lote_id: string; producto_id: string; q_mil: number; paso_mil: number; kg_por_mil: number; cm3_por_mil: number; bulto_kg_mil: number; fraccionable: boolean; vencimiento: string }

/** Reservas activas de un pedido en un almacén que todavía no están en un itinerario vigente (RN-30: reserva única en origen). */
export function cargaPorOrigen(repo: Repo, pedidoId: string): Map<string, ItemCarga[]> {
  const filas = repo.todos(`SELECT r.pedido_linea_id, r.lote_id, r.nodo_id, SUM(r.q_mil) q, p.producto_id, p.unidad_base, p.peso_kg_por_unidad_mil peso, p.vol_cm3_por_unidad vol, p.fraccionable, l.fecha_vencimiento
    FROM reserva r JOIN pedido_linea pl USING (pedido_linea_id) JOIN producto p ON p.producto_id = pl.producto_id JOIN lote l ON l.lote_id = r.lote_id
    WHERE pl.pedido_id = ? AND r.estado = 'ACTIVA' GROUP BY r.pedido_linea_id, r.lote_id, r.nodo_id ORDER BY r.nodo_id, l.fecha_vencimiento, r.lote_id`, [pedidoId]);
  const enPlan = repo.todos(`SELECT ec.pedido_linea_id, ec.lote_id, e.nodo_origen_id, SUM(ec.q_mil) q FROM etapa_carga ec JOIN etapa e USING (etapa_id) JOIN itinerario i USING (itinerario_id)
    WHERE i.pedido_id = ? AND i.estado IN ('CONFIRMADO','EN_EJECUCION') AND e.tramo = 1 AND e.estado = 'PLANIFICADA' GROUP BY 1,2,3`, [pedidoId]);
  const out = new Map<string, ItemCarga[]>();
  for (const f of filas) {
    const planificado = Number(enPlan.find((x) => x.pedido_linea_id === f.pedido_linea_id && x.lote_id === f.lote_id && x.nodo_origen_id === f.nodo_id)?.q ?? 0);
    const q = Number(f.q) - planificado;
    if (q <= 0) continue;
    const frac = f.fraccionable === 1;
    const paso = frac ? 1 : 1000; // granel: gramo; bulto cerrado: una unidad entera
    const it: ItemCarga = { pedido_linea_id: String(f.pedido_linea_id), lote_id: String(f.lote_id), producto_id: String(f.producto_id), q_mil: q, paso_mil: paso,
      kg_por_mil: Number(f.peso) / 1000, cm3_por_mil: Number(f.vol) / 1000, bulto_kg_mil: frac ? 1 : Number(f.peso), fraccionable: frac, vencimiento: String(f.fecha_vencimiento) };
    if (!out.has(String(f.nodo_id))) out.set(String(f.nodo_id), []);
    out.get(String(f.nodo_id))!.push(it);
  }
  return out;
}

/** Carga de un pedido en custodia en nodos intermedios que no tiene una etapa siguiente planificada (tras reemplazar un itinerario o recibir en un nodo de contingencia). */
export function custodiaSinPlan(repo: Repo, pedidoId: string): Map<string, ItemCarga[]> {
  const filas = repo.todos(`WITH et AS (SELECT e.etapa_id FROM etapa e JOIN itinerario i USING (itinerario_id) WHERE i.pedido_id = ?),
      m AS (SELECT m.lote_id, n.nodo_id, SUM(CASE WHEN m.nodo_destino_id = n.nodo_id THEN m.q_mil ELSE -m.q_mil END) q
        FROM movimiento m JOIN nodo n ON n.nodo_id IN (m.nodo_destino_id, m.nodo_origen_id)
        WHERE m.transfer_id IN (SELECT etapa_id FROM et) AND m.condicion = 'APTO' AND n.tipo NOT IN ('TRANSITO','DESTINO') AND m.tipo IN ('RECEPCION','DESPACHO','RECLASIFICACION','PERDIDA','RETORNO')
        GROUP BY 1,2),
      pl AS (SELECT ec.lote_id, e.nodo_origen_id nodo_id, SUM(ec.q_mil) q FROM etapa_carga ec JOIN etapa e USING (etapa_id) JOIN itinerario i USING (itinerario_id)
        WHERE i.pedido_id = ? AND i.estado IN ('CONFIRMADO','EN_EJECUCION') AND e.estado = 'PLANIFICADA' GROUP BY 1,2)
    SELECT m.lote_id, m.nodo_id, m.q - COALESCE(pl.q,0) q, (SELECT ec.pedido_linea_id FROM etapa_carga ec JOIN etapa e USING (etapa_id) JOIN itinerario i USING (itinerario_id) WHERE i.pedido_id = ? AND ec.lote_id = m.lote_id LIMIT 1) linea,
      p.producto_id, p.peso_kg_por_unidad_mil peso, p.vol_cm3_por_unidad vol, p.fraccionable, l.fecha_vencimiento
    FROM m LEFT JOIN pl USING (lote_id, nodo_id) JOIN lote l ON l.lote_id = m.lote_id JOIN producto p ON p.producto_id = l.producto_id
    WHERE m.q - COALESCE(pl.q,0) > 0 AND m.nodo_id NOT IN (SELECT nodo_id FROM nodo WHERE tipo = 'ALMACEN')`, [pedidoId, pedidoId, pedidoId]);
  const out = new Map<string, ItemCarga[]>();
  for (const f of filas) {
    const frac = f.fraccionable === 1;
    const it: ItemCarga = { pedido_linea_id: String(f.linea), lote_id: String(f.lote_id), producto_id: String(f.producto_id), q_mil: Number(f.q), paso_mil: frac ? 1 : 1000,
      kg_por_mil: Number(f.peso) / 1000, cm3_por_mil: Number(f.vol) / 1000, bulto_kg_mil: frac ? 1 : Number(f.peso), fraccionable: frac, vencimiento: String(f.fecha_vencimiento) };
    if (!out.has(String(f.nodo_id))) out.set(String(f.nodo_id), []);
    out.get(String(f.nodo_id))!.push(it);
  }
  return out;
}

/** Orígenes planificables de un pedido: reservas en almacén y carga en custodia sin plan. */
export function origenesPlanificables(repo: Repo, pedidoId: string) {
  const r = [...cargaPorOrigen(repo, pedidoId)].map(([origen, items]) => ({ origen, items, tipo: 'RESERVA' as const }));
  const c = [...custodiaSinPlan(repo, pedidoId)].map(([origen, items]) => ({ origen, items, tipo: 'CUSTODIA' as const }));
  return [...r, ...c];
}

// ------------------------------------------------------------------ Planificación
export interface ViajePlan { servicio_id: string; recurso: string; salida: string; llegada: string; kg_mil: number; dm3: number; bultos: number; costo_cent: number; items: { pedido_linea_id: string; lote_id: string; q_mil: number }[] }
export interface TramoPlan { enlace_id: string; modo: string; origen: string; destino: string; espera_min: number; transbordo_cent: number; viajes: ViajePlan[] }
export interface Alternativa { clave: string; nodos: string[]; tramos: TramoPlan[]; salida: string; llegada: string; entrega_prevista: string; costo_cent: number; dentro_ventana: boolean; factible: boolean; motivo: string }
export interface ResultadoPlan { pedido_id: string; origen: string; alternativas: Alternativa[]; rutas_exploradas: number; limite_alcanzado: boolean; motivo_global?: string }

const MAX_TRAMOS = 6, MAX_RUTAS = 300, MAX_VIAJES_TRAMO = 30;

function rutasSimples(repo: Repo, origen: string, destino: string) {
  const enl = repo.todos('SELECT e.*, n.activo nact FROM enlace e JOIN nodo n ON n.nodo_id = e.nodo_destino_id WHERE e.activo = 1');
  const rutas: Fila[][] = [];
  let limite = false;
  const dfs = (n: string, visit: Set<string>, camino: Fila[]) => {
    if (rutas.length >= MAX_RUTAS) { limite = true; return; }
    if (n === destino) { rutas.push([...camino]); return; }
    if (camino.length >= MAX_TRAMOS) return;
    for (const e of enl.filter((x) => x.nodo_origen_id === n && x.nact === 1)) {
      const d = String(e.nodo_destino_id);
      if (visit.has(d)) continue; // evita ciclos sin eliminar retornos legítimos (P07)
      visit.add(d); camino.push(e); dfs(d, visit, camino); camino.pop(); visit.delete(d);
    }
  };
  dfs(origen, new Set([origen]), []);
  return { rutas, limite };
}

/** Capacidad ya comprometida en un servicio por otras cargas (RN-29: un servicio físico, varias cargas). */
function usoServicio(repo: Repo, servicioId: string) {
  const f = repo.uno("SELECT COALESCE(SUM(kg_bruto_mil),0) kg, COALESCE(SUM(dm3),0) dm3 FROM etapa WHERE servicio_id = ? AND estado <> 'CANCELADA'", [servicioId])!;
  return { kg: Number(f.kg), dm3: Number(f.dm3) };
}

/** Planifica todas las alternativas desde un origen hasta el destino final del pedido (RN-11/12/28/32/33/36/37, P–AD). */
export function planificar(repo: Repo, pedidoId: string, origen: string, items: ItemCarga[], ahora = repo.reloj()): ResultadoPlan {
  const p = repo.uno('SELECT p.*, d.nodo_id dnodo, d.acepta_anticipadas, d.vida_util_min_dias FROM pedido p JOIN destino d USING (destino_id) WHERE pedido_id = ?', [pedidoId])!;
  const destinoNodo = String(p.dnodo);
  const prep = Number(parametro(repo, 'preparacion_min'));
  const listo = aLima(ms(ahora) + prep * 60000);
  const { rutas, limite } = rutasSimples(repo, origen, destinoNodo);
  const res: ResultadoPlan = { pedido_id: pedidoId, origen, alternativas: [], rutas_exploradas: rutas.length, limite_alcanzado: limite };
  if (!rutas.length) { res.motivo_global = `No existe ninguna cadena de enlaces habilitados desde ${origen} hasta el destino final (${destinoNodo}). El pedido queda pendiente; no se usa distancia cero ni se marca atendido al llegar a un nodo intermedio.`; return res; }
  const productos = [...new Set(items.map((i) => i.producto_id))];
  for (const ruta of rutas) {
    const alt: Alternativa = { clave: '', nodos: [origen, ...ruta.map((e) => String(e.nodo_destino_id))], tramos: [], salida: '', llegada: '', entrega_prevista: '', costo_cent: 0, dentro_ventana: false, factible: false, motivo: '' };
    let t = listo; let motivo = '';
    const reservado = new Map<string, { kg: number; dm3: number }>(); // capacidad usada por esta misma alternativa
    for (let k = 0; k < ruta.length && !motivo; k++) {
      const e = ruta[k];
      const nodoSalida = repo.uno('SELECT * FROM nodo WHERE nodo_id = ?', [e.nodo_origen_id])!;
      const modo = repo.uno('SELECT * FROM modo_transporte WHERE modo_id = ?', [e.modo_id]);
      if (!modo || modo.activo !== 1) { motivo = `Modo ${e.modo_id} no habilitado.`; break; }
      for (const pr of productos) { const c = repo.uno('SELECT * FROM compatibilidad WHERE producto_id = ? AND modo_id = ?', [pr, e.modo_id]); if (c && c.permitido === 0) motivo = `Producto ${pr} incompatible con ${e.modo_id}: ${c.motivo}`; }
      if (motivo) break;
      // Transbordo configurado (nodo, medio que llega → medio que sale): su duración reemplaza la manipulación genérica y su costo se suma una vez por tramo.
      const regla = k > 0 ? repo.uno('SELECT * FROM regla_transbordo WHERE nodo_id = ? AND modo_entrada_id = ? AND modo_salida_id = ?', [e.nodo_origen_id, ruta[k - 1].modo_id, e.modo_id]) : undefined;
      const minSalida = k === 0 ? t : aLima(ms(t) + Number(regla ? regla.duracion_min : nodoSalida.manipulacion_min) * 60000); // RN-33: llegada + manipulación/transbordo
      const servicios = repo.todos("SELECT s.*, r.capacidad_kg_mil ckg, r.capacidad_dm3 cdm3, r.max_bulto_kg_mil mb, r.nombre rnom, r.activo ract FROM servicio s JOIN recurso r USING (recurso_id) WHERE s.enlace_id = ? AND s.estado = 'PROGRAMADO' AND s.salida >= ? ORDER BY s.salida",
        [e.enlace_id, minSalida]).filter((s) => ms(String(s.salida)) >= ms(minSalida));
      const tramo: TramoPlan = { enlace_id: String(e.enlace_id), modo: String(e.modo_id), origen: String(e.nodo_origen_id), destino: String(e.nodo_destino_id), espera_min: 0, transbordo_cent: 0, viajes: [] };
      const pend = items.map((i) => ({ ...i }));
      const restante = () => pend.reduce((a, i) => a + i.q_mil, 0);
      const razones = new Set<string>();
      for (const s of servicios) {
        if (!restante() || tramo.viajes.length >= MAX_VIAJES_TRAMO) break;
        if (s.ract !== 1) { razones.add(`recurso ${s.recurso_id} inactivo`); continue; }
        const acc = estadoEnlace(repo, String(e.enlace_id), String(s.salida), String(s.llegada));
        if (acc.estado === 'INTERRUMPIDO') { razones.add(`enlace interrumpido (${acc.motivo})`); continue; }
        if (acc.estado === 'DESCONOCIDO') { razones.add(`estado de acceso desconocido (${acc.motivo}); no se confirma como normal`); continue; }
        if (e.max_kg_recurso_mil !== null && Number(s.ckg) > Number(e.max_kg_recurso_mil)) { razones.add(`restricción del enlace: recurso de ${Number(s.ckg) / 1000} kg supera el máximo de ${Number(e.max_kg_recurso_mil) / 1000} kg`); continue; }
        // Espera nocturna en el nodo (W08/R04)
        if (k > 0 && fecha(String(s.salida)) > fecha(t) && nodoSalida.permite_espera_nocturna !== 1) { razones.add(`la conexión exige pernoctar en ${nodoSalida.nodo_id}, que no lo permite`); break; }
        const usado = usoServicio(repo, String(s.servicio_id)); const propio = reservado.get(String(s.servicio_id)) ?? { kg: 0, dm3: 0 };
        let libreKg = Number(s.ckg) - usado.kg - propio.kg, libreDm3 = Number(s.cdm3) - usado.dm3 - propio.dm3;
        const v: ViajePlan = { servicio_id: String(s.servicio_id), recurso: String(s.rnom), salida: String(s.salida), llegada: String(s.llegada), kg_mil: 0, dm3: 0, bultos: 0, costo_cent: 0, items: [] };
        for (const it of pend) {
          if (!it.q_mil) continue;
          if (s.mb !== null && !it.fraccionable && it.bulto_kg_mil > Number(s.mb)) { razones.add(`bulto de ${it.bulto_kg_mil / 1000} kg supera el máximo por bulto del recurso (${Number(s.mb) / 1000} kg); no se parte un bulto cerrado`); continue; }
          const porPasoKg = it.kg_por_mil * it.paso_mil, porPasoDm3 = (it.cm3_por_mil * it.paso_mil) / 1000;
          const pasos = Math.min(Math.floor(it.q_mil / it.paso_mil), porPasoKg > 0 ? Math.floor(libreKg / porPasoKg) : Infinity, porPasoDm3 > 0 ? Math.floor(libreDm3 / porPasoDm3) : Infinity);
          let q = pasos * it.paso_mil;
          if (q <= 0) continue;
          if (q + it.paso_mil > it.q_mil && it.q_mil - q < it.paso_mil) q = it.q_mil === q ? q : q; // sin resto parcial
          const kg = Math.round(q * it.kg_por_mil), dm3 = Math.ceil((q * it.cm3_por_mil) / 1000);
          v.items.push({ pedido_linea_id: it.pedido_linea_id, lote_id: it.lote_id, q_mil: q });
          v.kg_mil += kg; v.dm3 += dm3; v.bultos += it.fraccionable ? 0 : q / 1000; libreKg -= kg; libreDm3 -= dm3; it.q_mil -= q;
        }
        if (!v.items.length) { if (libreKg <= 0 || libreDm3 <= 0) razones.add('salida sin capacidad libre'); continue; }
        const otros = usado.kg;
        v.costo_cent = Math.round((Number(s.tarifa_fija_cent) * v.kg_mil) / Math.max(v.kg_mil + otros, 1)) + Math.round((v.kg_mil / 1000) * Number(s.costo_kg_p4) / 100);
        reservado.set(v.servicio_id, { kg: propio.kg + v.kg_mil, dm3: propio.dm3 + v.dm3 });
        tramo.viajes.push(v);
      }
      if (restante() > 0) { motivo = `Tramo ${k + 1} (${e.nodo_origen_id}→${e.nodo_destino_id}, ${e.modo_id}): ${tramo.viajes.length ? 'capacidad insuficiente en las salidas disponibles' : 'ninguna salida factible'}${razones.size ? ' — ' + [...razones].join('; ') : servicios.length ? '' : ' — no hay salidas programadas después de ' + minSalida.slice(0, 16).replace('T', ' ')}.`; break; }
      if (regla) {
        if (regla.fraccionamiento_permitido === 0 && tramo.viajes.length > alt.tramos[k - 1].viajes.length) { motivo = `Transbordo en ${e.nodo_origen_id}: la regla no permite fraccionar la carga y el medio siguiente exige ${tramo.viajes.length} viajes.`; break; }
        const kgTot = tramo.viajes.reduce((a, v) => a + v.kg_mil, 0);
        tramo.transbordo_cent = Number(regla.costo_fijo_cent) + Math.round((kgTot / 1000) * Number(regla.costo_kg_p4) / 100);
        alt.costo_cent += tramo.transbordo_cent;
      }
      tramo.espera_min = Math.round((ms(tramo.viajes[0].salida) - ms(t)) / 60000);
      if (k === 0) alt.salida = tramo.viajes[0].salida;
      t = tramo.viajes.reduce((a, v) => (ms(v.llegada) > ms(a) ? v.llegada : a), tramo.viajes[0].llegada); // se consolida en el nodo antes de seguir
      alt.tramos.push(tramo);
      alt.costo_cent += tramo.viajes.reduce((a, v) => a + v.costo_cent, 0);
    }
    alt.clave = alt.tramos.map((tr) => tr.viajes.map((v) => v.servicio_id).join('+')).join('>');
    if (!motivo) {
      alt.llegada = t;
      alt.entrega_prevista = p.acepta_anticipadas !== 1 && ms(t) < ms(String(p.ventana_inicio)) ? String(p.ventana_inicio) : t; // RN-12: espera a la ventana
      alt.dentro_ventana = ms(alt.entrega_prevista) <= ms(String(p.ventana_fin)); // comparación inclusiva (R08)
      const ultimo = alt.tramos.at(-1)!;
      const minVig = sumaDias(fecha(alt.entrega_prevista), Number(p.vida_util_min_dias));
      const vencido = items.find((i) => i.vencimiento < minVig);
      if (vencido) motivo = `El lote ${vencido.lote_id} vence el ${vencido.vencimiento}, antes de la aceptación final prevista con vida útil mínima (${minVig}). Requiere otro lote.`;
      else if (ultimo.viajes.length > 1 && p.permite_entregas_divididas !== 1) motivo = `La última milla exige ${ultimo.viajes.length} recepciones y el cliente no admite entregas divididas.`;
      else if (!alt.dentro_ventana) motivo = `Llegaría el ${alt.entrega_prevista.slice(0, 16).replace('T', ' ')}, después del fin de la ventana comprometida.`;
    }
    alt.factible = !motivo; alt.motivo = motivo;
    res.alternativas.push(alt);
  }
  // Criterio declarado: factibles primero; luego entrega más temprana, menor costo y menos tramos (RN-56: no se afirma óptimo global).
  res.alternativas.sort((a, b) => Number(b.factible) - Number(a.factible) || (a.entrega_prevista && b.entrega_prevista ? ms(a.entrega_prevista) - ms(b.entrega_prevista) : 0) || a.costo_cent - b.costo_cent || a.tramos.length - b.tramos.length);
  return res;
}

export function planificarPedido(repo: Repo, pedidoId: string) {
  const ped = repo.uno('SELECT estado_base FROM pedido WHERE pedido_id = ?', [pedidoId]);
  if (!ped || ped.estado_base !== 'CONFIRMADO') throw new Error('Solo se planifican pedidos confirmados.');
  const origenes = origenesPlanificables(repo, pedidoId);
  if (!origenes.length) throw new Error('El pedido no tiene cantidades reservadas pendientes de planificar. Reserve primero (o ya tiene un itinerario vigente).');
  return origenes.map((o) => ({ ...planificar(repo, pedidoId, o.origen, o.items), tipo_origen: o.tipo }));
}

/** Confirma la alternativa elegida revalidando capacidad y condiciones en la misma transacción (E01, AC01, RN-29/30). */
export function confirmarItinerario(repo: Repo, usuario: string, pedidoId: string, origen: string, clave: string) {
  return repo.transaccion(() => {
    const a = exigir(repo, usuario, 'PLANIFICAR');
    const o = origenesPlanificables(repo, pedidoId).find((x) => x.origen === origen);
    if (!o) throw new Error('No hay carga reservada ni en custodia pendiente desde ese origen.');
    const items = o.items;
    const alt = planificar(repo, pedidoId, origen, items).alternativas.find((x) => x.clave === clave);
    if (!alt) throw new Error('La alternativa ya no está disponible (cambió la capacidad o el acceso). Vuelva a planificar.');
    if (!alt.factible) throw new Error('La alternativa no es factible: ' + alt.motivo);
    const id = nuevoId('ITI'), t = repo.reloj();
    const version = repo.num('SELECT COALESCE(MAX(version),0) FROM itinerario WHERE pedido_id = ?', [pedidoId]) + 1;
    const previo = o.tipo === 'CUSTODIA' ? repo.uno("SELECT itinerario_id FROM itinerario WHERE pedido_id = ? AND estado = 'REEMPLAZADO' ORDER BY version DESC LIMIT 1", [pedidoId]) : undefined;
    repo.run('INSERT INTO itinerario VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [id, pedidoId, origen, version, 'CONFIRMADO', alt.nodos.join(' → '), alt.salida, alt.llegada, alt.entrega_prevista, alt.costo_cent,
      'Factible; entrega más temprana, luego menor costo y menos tramos (búsqueda acotada, no óptimo global)', t, usuario, o.tipo, previo?.itinerario_id ?? null]);
    alt.tramos.forEach((tr, k) => tr.viajes.forEach((v, j) => {
      const eid = `${id}-T${k + 1}V${j + 1}`;
      repo.run('INSERT INTO etapa VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL)', [eid, id, k + 1, j + 1, v.servicio_id, tr.origen, tr.destino, v.kg_mil, v.dm3, v.bultos, k === alt.tramos.length - 1 ? 1 : 0, 'PLANIFICADA']);
      for (const it of v.items) repo.run('INSERT INTO etapa_carga VALUES (?,?,?,?)', [eid, it.pedido_linea_id, it.lote_id, it.q_mil]);
    }));
    repo.auditar(a, 'CONFIRMAR_ITINERARIO', null, { id, pedidoId, ruta: alt.nodos, entrega: alt.entrega_prevista });
    return id;
  });
}

/** Cancelar un itinerario aún no despachado libera la capacidad de sus servicios; la reserva de stock se mantiene (R07, AD08). */
export function cancelarItinerario(repo: Repo, usuario: string, itinerarioId: string, motivo: string) {
  return repo.transaccion(() => {
    const a = exigir(repo, usuario, 'PLANIFICAR');
    if (repo.num("SELECT COUNT(*) FROM etapa WHERE itinerario_id = ? AND estado <> 'PLANIFICADA'", [itinerarioId])) throw new Error('El itinerario ya tiene etapas ejecutadas: solo se replanifica lo pendiente (I04-b).');
    repo.run("UPDATE etapa SET estado = 'CANCELADA' WHERE itinerario_id = ?", [itinerarioId]);
    repo.run("UPDATE itinerario SET estado = 'CANCELADO' WHERE itinerario_id = ?", [itinerarioId]);
    repo.auditar(a, 'CANCELAR_ITINERARIO', null, { itinerarioId, motivo });
  });
}

/** Reemplaza lo pendiente de un itinerario en ejecución: conserva los hechos y deja la carga en su custodia real para replanificar desde allí (H05, BN03, BN07). */
export function reemplazarItinerario(repo: Repo, usuario: string, itinerarioId: string, motivo: string) {
  return repo.transaccion(() => {
    const a = exigir(repo, usuario, 'PLANIFICAR');
    if (!motivo?.trim()) throw new Error('Indique el motivo del reemplazo.');
    const i = repo.uno('SELECT * FROM itinerario WHERE itinerario_id = ?', [itinerarioId]);
    if (!i || !['CONFIRMADO', 'EN_EJECUCION'].includes(String(i.estado))) throw new Error('Solo se reemplaza un itinerario vigente.');
    if (repo.num("SELECT COUNT(*) FROM etapa WHERE itinerario_id = ? AND estado = 'DESPACHADA'", [itinerarioId])) throw new Error('Hay carga en camino: regístrela recibida (en el nodo previsto o en uno de contingencia) antes de reemplazar el itinerario. No se mueve carga retroactivamente.');
    const n = repo.num("SELECT COUNT(*) FROM etapa WHERE itinerario_id = ? AND estado = 'PLANIFICADA'", [itinerarioId]);
    repo.run("UPDATE etapa SET estado = 'CANCELADA' WHERE itinerario_id = ? AND estado = 'PLANIFICADA'", [itinerarioId]);
    repo.run(`UPDATE itinerario SET estado = ? WHERE itinerario_id = ?`, [repo.num("SELECT COUNT(*) FROM etapa WHERE itinerario_id = ? AND estado <> 'CANCELADA'", [itinerarioId]) ? 'REEMPLAZADO' : 'CANCELADO', itinerarioId]);
    repo.auditar(a, 'REEMPLAZAR_ITINERARIO', null, { itinerarioId, motivo, etapas_canceladas: n });
    return { etapas_canceladas: n };
  });
}

// ------------------------------------------------------------------ Ejecución física y custodia
function transito(repo: Repo) { return String(repo.uno("SELECT nodo_id FROM nodo WHERE tipo = 'TRANSITO' AND activo = 1 ORDER BY nodo_id LIMIT 1")!.nodo_id); }
export function enTransitoEtapa(repo: Repo, etapaId: string) {
  const tr = transito(repo);
  return repo.todos(`SELECT lote_id, SUM(CASE WHEN nodo_destino_id = ? THEN q_mil ELSE -q_mil END) q FROM movimiento WHERE transfer_id = ? AND (nodo_destino_id = ? OR nodo_origen_id = ?) GROUP BY lote_id`, [tr, etapaId, tr, tr])
    .map((f) => ({ lote_id: String(f.lote_id), q_mil: Number(f.q) })).filter((f) => f.q_mil > 0);
}

/** Despacho de una etapa: mueve la carga física a tránsito una sola vez (F01, F04, RN-08, AG01, AG04). */
export function despacharEtapa(repo: Repo, usuario: string, etapaId: string, commandId = nuevoId('CMD')) {
  return repo.comando(commandId, 'DESPACHAR_ETAPA', actor(repo, usuario), () => {
    exigir(repo, usuario, 'DESPACHAR');
    const e = repo.uno('SELECT e.*, i.estado iest, i.pedido_id, i.origen_tipo FROM etapa e JOIN itinerario i USING (itinerario_id) WHERE etapa_id = ?', [etapaId]);
    if (!e) throw new Error('Etapa inexistente.');
    if (!['CONFIRMADO', 'EN_EJECUCION'].includes(String(e.iest))) throw new Error('El itinerario no está vigente.');
    if (e.estado !== 'PLANIFICADA') throw new Error('La etapa ya fue despachada.');
    const s = repo.uno('SELECT * FROM servicio WHERE servicio_id = ?', [e.servicio_id])!;
    if (s.estado === 'CANCELADO') throw new Error('El servicio fue cancelado: replanifique esta etapa.');
    if (Number(e.tramo) > 1 && repo.num("SELECT COUNT(*) FROM etapa WHERE itinerario_id = ? AND tramo = ? AND estado NOT IN ('RECIBIDA')", [e.itinerario_id, Number(e.tramo) - 1]))
      throw new Error('La etapa depende de la recepción del tramo anterior, que aún no se registra. No se despacha carga que no llegó (AG04).');
    const t = repo.reloj(), tr = transito(repo);
    const carga = repo.todos('SELECT * FROM etapa_carga WHERE etapa_id = ?', [etapaId]);
    // ESC-F03: al despachar se revalida cada lote (estado, bloqueo y vigencia al destino); no basta lo que se validó al reservar
    const ped = repo.uno('SELECT d.vida_util_min_dias vmin, i.entrega_prevista FROM etapa e JOIN itinerario i USING (itinerario_id) JOIN pedido p ON p.pedido_id = i.pedido_id JOIN destino d ON d.destino_id = p.destino_id WHERE e.etapa_id = ?', [etapaId]);
    for (const c of carga) {
      const l = repo.uno('SELECT lote_id, estado_lote, fecha_vencimiento FROM lote WHERE lote_id = ?', [c.lote_id])!;
      if (bloqueoActivo(repo, String(c.lote_id))) throw new Error(`El lote ${c.lote_id} está bloqueado por calidad: no se despacha. Libere el bloqueo o replanifique con otro lote (FEFO).`);
      if (String(l.estado_lote) !== 'LIBERADO') throw new Error(`El lote ${c.lote_id} ya no está LIBERADO (${String(l.estado_lote)}): revalide la reserva FEFO.`);
      const minVig = ped ? sumaDias(String(ped.entrega_prevista).slice(0, 10), Number(ped.vmin ?? 0)) : t.slice(0, 10);
      if (String(l.fecha_vencimiento) < minVig) throw new Error(`El lote ${c.lote_id} vence el ${String(l.fecha_vencimiento)} y no cumple la vida útil mínima en el destino (hasta ${minVig}): revalide FEFO y replanifique con otro lote.`);
    }
    for (const c of carga) {
      if (Number(e.tramo) === 1 && e.origen_tipo !== 'CUSTODIA') {
        // Consume la reserva una sola vez (RN-08): la reserva ACTIVA se reduce y se registra la parte CONSUMIDA.
        let falta = Number(c.q_mil);
        for (const r of repo.todos("SELECT * FROM reserva WHERE pedido_linea_id = ? AND lote_id = ? AND nodo_id = ? AND estado = 'ACTIVA' ORDER BY creada_en", [c.pedido_linea_id, c.lote_id, e.nodo_origen_id])) {
          if (!falta) break;
          const q = Math.min(falta, Number(r.q_mil));
          if (q === Number(r.q_mil)) repo.run("UPDATE reserva SET estado = 'CONSUMIDA' WHERE reserva_id = ?", [r.reserva_id]);
          else { repo.run('UPDATE reserva SET q_mil = q_mil - ? WHERE reserva_id = ?', [q, r.reserva_id]); repo.run("INSERT INTO reserva(reserva_id,pedido_linea_id,lote_id,nodo_id,q_mil,estado,creada_en,command_id) VALUES (?,?,?,?,?,'CONSUMIDA',?,?)", [nuevoId('RES'), c.pedido_linea_id, c.lote_id, e.nodo_origen_id, q, t, commandId]); }
          falta -= q;
        }
        if (falta) throw new Error('La reserva ya no cubre la carga planificada; revise la reserva antes de despachar.');
      } else {
        const disp = repo.num(`SELECT COALESCE(SUM(CASE WHEN nodo_destino_id = ? THEN q_mil ELSE -q_mil END),0) FROM movimiento WHERE lote_id = ? AND condicion = 'APTO' AND (nodo_destino_id = ? OR nodo_origen_id = ?)`, [e.nodo_origen_id, c.lote_id, e.nodo_origen_id, e.nodo_origen_id]);
        if (disp < Number(c.q_mil)) throw new Error(`En ${e.nodo_origen_id} solo hay ${disp / 1000} aptos del lote; la recepción anterior tuvo diferencia. Use «Reemplazar itinerario» y replanifique desde ese nodo con la cantidad real.`);
      }
      repo.run('INSERT INTO movimiento VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [nuevoId('MOV'), c.lote_id, e.nodo_origen_id, tr, 'APTO', c.q_mil, t, t, 'DESPACHO', etapaId, `Etapa ${e.tramo}.${e.viaje} servicio ${e.servicio_id}`, usuario, commandId]);
    }
    repo.run("UPDATE etapa SET estado = 'DESPACHADA', despachada_en = ? WHERE etapa_id = ?", [t, etapaId]);
    repo.run("UPDATE servicio SET estado = 'EN_CURSO', salida_real = COALESCE(salida_real, ?) WHERE servicio_id = ?", [t, e.servicio_id]);
    repo.run("UPDATE itinerario SET estado = 'EN_EJECUCION' WHERE itinerario_id = ?", [e.itinerario_id]);
    verificarInvariantes(repo);
    return { etapa_id: etapaId, lotes: carga.length };
  });
}

/** Recepción en un nodo intermedio: solo lo recibido apto queda disponible para la siguiente etapa; la diferencia sigue en tránsito en investigación (S01–S08, RN-35, 14.1.1-#5). */
export const bloqueoActivo = (repo: Repo, loteId: string) => repo.uno("SELECT * FROM bloqueo_lote WHERE lote_id = ? AND estado = 'ACTIVO'", [loteId]);

/**
 * Recepción en un nodo: solo lo recibido apto queda disponible para la siguiente etapa; la diferencia sigue en tránsito en investigación (S01–S08, RN-35, 14.1.1-#5).
 * Con `nodoReal` distinto del previsto (avería, cierre): la carga queda en ese nodo de contingencia, el resto del itinerario se reemplaza y se replanifica desde la ubicación real (AC05, H04, BN03).
 */
export function recibirEtapa(repo: Repo, usuario: string, etapaId: string, recibido: { lote_id: string; apta_mil: number; cuarentena_mil: number; danada_mil: number }[], receptor: string, evidencia: string | null, commandId = nuevoId('CMD'), nodoReal?: string) {
  return repo.comando(commandId, 'RECIBIR_ETAPA', actor(repo, usuario), () => {
    exigir(repo, usuario, 'DESPACHAR');
    const e0 = repo.uno('SELECT * FROM etapa WHERE etapa_id = ?', [etapaId]);
    if (!e0) throw new Error('Etapa inexistente.');
    const contingencia = !!nodoReal && nodoReal !== e0.nodo_destino_id;
    if (contingencia) {
      const n = repo.uno('SELECT tipo FROM nodo WHERE nodo_id = ? AND activo = 1', [nodoReal]);
      if (!n || !['ALMACEN', 'TRANSBORDO'].includes(String(n.tipo))) throw new Error('El nodo de contingencia debe ser un almacén o punto de transbordo activo con custodia.');
    } else if (e0.final === 1) throw new Error('Es la etapa final: registre la entrega al cliente, no una recepción intermedia.');
    const e = Object.assign({}, e0, { nodo_destino_id: contingencia ? nodoReal! : e0.nodo_destino_id });
    // Lote con retiro activo: lo que llega no puede quedar apto (BM02, AA07)
    recibido = recibido.map((r) => bloqueoActivo(repo, r.lote_id) ? { ...r, apta_mil: 0, cuarentena_mil: r.cuarentena_mil + r.apta_mil } : r);
    if (e.estado !== 'DESPACHADA') throw new Error('Solo se recibe una etapa despachada y aún no recibida.');
    if (!receptor?.trim()) throw new Error('Identifique a quien recibe (custodio del nodo).');
    const tr = transito(repo), t = repo.reloj();
    const enviado = enTransitoEtapa(repo, etapaId);
    let env = 0, rec = 0, apt = 0, cua = 0, dan = 0;
    for (const r of recibido) {
      const q = enviado.find((x) => x.lote_id === r.lote_id)?.q_mil ?? 0;
      const tot = r.apta_mil + r.cuarentena_mil + r.danada_mil;
      if ([r.apta_mil, r.cuarentena_mil, r.danada_mil].some((x) => !Number.isSafeInteger(x) || x < 0)) throw new Error('Cantidades inválidas.');
      if (tot > q) throw new Error(`Se registra más de lo que viaja del lote (${q / 1000}); no se crean existencias (S03).`);
      // La carga viaja APTA; lo que llega en cuarentena o dañado se recibe y se reclasifica en el nodo (par RECLASIFICACION que no altera el balance).
      if (tot > 0) repo.run('INSERT INTO movimiento VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [nuevoId('MOV'), r.lote_id, tr, e.nodo_destino_id, 'APTO', tot, t, t, 'RECEPCION', etapaId, `Recibe ${receptor}`, usuario, commandId]);
      for (const [cond, cant] of [['CUARENTENA', r.cuarentena_mil], ['DANADO', r.danada_mil]] as const) if (cant > 0) {
        repo.run('INSERT INTO movimiento VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [nuevoId('MOV'), r.lote_id, e.nodo_destino_id, null, 'APTO', cant, t, t, 'RECLASIFICACION', etapaId, `Llega ${cond.toLowerCase()}`, usuario, commandId]);
        repo.run('INSERT INTO movimiento VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [nuevoId('MOV'), r.lote_id, null, e.nodo_destino_id, cond, cant, t, t, 'RECLASIFICACION', etapaId, `Llega ${cond.toLowerCase()}`, usuario, commandId]);
      }
      env += q; rec += tot; apt += r.apta_mil; cua += r.cuarentena_mil; dan += r.danada_mil;
    }
    for (const x of enviado) if (!recibido.some((r) => r.lote_id === x.lote_id)) env += x.q_mil;
    repo.run('INSERT INTO transferencia VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [nuevoId('TRA'), etapaId, e.nodo_destino_id, `Servicio ${e.servicio_id}`, receptor.trim(), env, apt, cua, dan, env - rec, t, t, evidencia, commandId]);
    repo.run("UPDATE etapa SET estado = 'RECIBIDA', recibida_en = ? WHERE etapa_id = ?", [t, etapaId]);
    if (!repo.num("SELECT COUNT(*) FROM etapa WHERE servicio_id = ? AND estado IN ('PLANIFICADA','DESPACHADA')", [e.servicio_id])) repo.run("UPDATE servicio SET estado = 'FINALIZADO', llegada_real = ? WHERE servicio_id = ?", [t, e.servicio_id]);
    if (contingencia) {
      repo.run("UPDATE etapa SET estado = 'CANCELADA' WHERE itinerario_id = ? AND estado = 'PLANIFICADA'", [e.itinerario_id]);
      repo.run("UPDATE itinerario SET estado = 'REEMPLAZADO' WHERE itinerario_id = ?", [e.itinerario_id]);
      const n = repo.uno('SELECT tipo FROM nodo WHERE nodo_id = ?', [nodoReal])!;
      if (n.tipo === 'ALMACEN') // vuelve a almacén: queda reservada para el mismo pedido, sin volverse vendible a otros
        for (const r of recibido) if (r.apta_mil > 0) {
          const linea = repo.uno('SELECT pedido_linea_id FROM etapa_carga WHERE etapa_id = ? AND lote_id = ?', [etapaId, r.lote_id])!.pedido_linea_id;
          repo.run("INSERT INTO reserva(reserva_id,pedido_linea_id,lote_id,nodo_id,q_mil,estado,creada_en,command_id) VALUES (?,?,?,?,?,'ACTIVA',?,?)", [nuevoId('RES'), linea, r.lote_id, nodoReal, r.apta_mil, t, commandId]);
        }
    }
    verificarInvariantes(repo);
    return { enviado_mil: env, apto_mil: apt, cuarentena_mil: cua, danado_mil: dan, diferencia_en_investigacion_mil: env - rec, contingencia, nodo: e.nodo_destino_id };
  });
}

export function receptoresVigentes(repo: Repo, destinoId: string, instante: string) {
  return repo.todos('SELECT * FROM receptor_autorizado WHERE destino_id = ? AND vigente_desde <= ? AND (vigente_hasta IS NULL OR vigente_hasta > ?) AND (revocado_en IS NULL OR revocado_en > ?)', [destinoId, instante, instante, instante]);
}

/** Entrega al cliente final: acepta solo con receptor facultado y evidencia; si no, queda en custodia externa en verificación (G01–G08, AB, AS, RN-13, DEC-I01-D4). */
export function registrarEntrega(repo: Repo, usuario: string, etapaId: string, p: { ocurrido_en?: string; receptor_id?: string | null; receptor_nombre?: string | null; metodo_evidencia?: string | null; evidencia_ref?: string | null; motivo?: string | null; lineas: { pedido_linea_id: string; lote_id: string; entregado_mil: number; rechazado_mil: number }[] }, commandId = nuevoId('CMD')) {
  return repo.comando(commandId, 'REGISTRAR_ENTREGA', actor(repo, usuario), () => {
    exigir(repo, usuario, 'DESPACHAR');
    const e = repo.uno('SELECT e.*, i.pedido_id, p.destino_id FROM etapa e JOIN itinerario i USING (itinerario_id) JOIN pedido p ON p.pedido_id = i.pedido_id WHERE etapa_id = ?', [etapaId]);
    if (!e) throw new Error('Etapa inexistente.');
    if (e.final !== 1) throw new Error('Llegar a un nodo intermedio no es entregar al cliente: registre una recepción intermedia (P03, V02).');
    if (!['DESPACHADA', 'ENTREGADA'].includes(String(e.estado))) throw new Error('La etapa final aún no fue despachada.');
    const t = repo.reloj(), ocurrido = p.ocurrido_en || t;
    for (const l of p.lineas) { // retiro de calidad: lo despachado antes del bloqueo no se entrega comercialmente (BM02, AA07)
      const b = l.entregado_mil > 0 ? bloqueoActivo(repo, l.lote_id) : undefined;
      if (b && String(e.despachada_en) < String(b.registrado_en)) throw new Error(`El lote ${l.lote_id} está en retiro de calidad (${b.motivo}): no se entrega. Registre «entregado 0» con motivo y luego el retorno a cuarentena.`);
    }
    const tr = transito(repo), destinoNodo = String(e.nodo_destino_id);
    const viaja = enTransitoEtapa(repo, etapaId);
    const intento = repo.num('SELECT COUNT(*) FROM entrega WHERE etapa_id = ?', [etapaId]) + 1;
    let receptorValido = false;
    if (p.receptor_id) receptorValido = receptoresVigentes(repo, String(e.destino_id), ocurrido).some((r) => r.receptor_id === p.receptor_id);
    const conEvidencia = !!(p.metodo_evidencia?.trim() && p.evidencia_ref?.trim());
    const confirma = receptorValido && conEvidencia;
    let entregado = 0, rechazado = 0;
    const id = nuevoId('ENT');
    repo.run('INSERT INTO entrega VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?)', [id, e.pedido_id, etapaId, intento, ocurrido, t, p.receptor_nombre ?? null, receptorValido ? (p.receptor_id ?? null) : null, p.metodo_evidencia ?? null, p.evidencia_ref ?? null, p.motivo ?? null, 'FALLIDO', commandId]);
    for (const l of p.lineas) {
      const q = viaja.find((x) => x.lote_id === l.lote_id)?.q_mil ?? 0;
      if (l.entregado_mil < 0 || l.rechazado_mil < 0 || l.entregado_mil + l.rechazado_mil > q) throw new Error(`No se puede entregar ni rechazar más de lo que viaja del lote (${q / 1000}); no se acepta mercadería ajena al despacho (G08/AB08).`);
      if (!repo.uno('SELECT 1 FROM etapa_carga WHERE etapa_id = ? AND pedido_linea_id = ? AND lote_id = ?', [etapaId, l.pedido_linea_id, l.lote_id])) throw new Error('La línea o el lote no corresponden a esta etapa.');
      if (l.entregado_mil > 0) {
        // Aceptado: sale del sistema hacia el cliente. Sin facultad/evidencia: queda en custodia externa en verificación, sin venta (RN-53).
        repo.run('INSERT INTO movimiento VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [nuevoId('MOV'), l.lote_id, tr, confirma ? null : destinoNodo, 'APTO', l.entregado_mil, ocurrido, t, confirma ? 'ACEPTACION' : 'ENTREGA_FISICA', etapaId, confirma ? 'Aceptado por receptor facultado' : 'Dejado con receptor; pendiente de verificación', usuario, commandId]);
      }
      repo.run('INSERT INTO entrega_detalle VALUES (?,?,?,?,?,?)', [id, l.pedido_linea_id, l.lote_id, confirma ? l.entregado_mil : 0, l.rechazado_mil, confirma ? 0 : l.entregado_mil]);
      entregado += l.entregado_mil; rechazado += l.rechazado_mil;
    }
    const totalViaja = viaja.reduce((a, x) => a + x.q_mil, 0);
    const estado = entregado === 0 ? 'FALLIDO' : !confirma ? 'EN_VERIFICACION' : entregado === totalViaja ? 'TOTAL' : 'PARCIAL';
    if (estado === 'FALLIDO' && !p.motivo?.trim()) throw new Error('Un intento fallido requiere motivo (por ejemplo, receptor ausente).');
    repo.run('UPDATE entrega SET estado = ? WHERE entrega_id = ?', [estado, id]);
    if (entregado + rechazado > 0) repo.run("UPDATE etapa SET estado = 'ENTREGADA', recibida_en = ? WHERE etapa_id = ?", [t, etapaId]);
    cerrarItinerarioSiCorresponde(repo, String(e.itinerario_id));
    verificarInvariantes(repo);
    return { entrega_id: id, estado, intento, aceptado_mil: confirma ? entregado : 0, en_verificacion_mil: confirma ? 0 : entregado, rechazado_en_transito_mil: rechazado,
      motivo: !confirma && entregado ? (!receptorValido ? 'Receptor sin facultad vigente a la hora del hecho' : 'Falta evidencia (método y referencia)') : '' };
  });
}

/** Confirmación comercial posterior de una entrega en verificación: conserva la hora física original (AB05, DEC-I01-D4). */
export function verificarEntrega(repo: Repo, usuario: string, entregaId: string, receptorId: string, metodo: string, ref: string, commandId = nuevoId('CMD')) {
  return repo.comando(commandId, 'VERIFICAR_ENTREGA', actor(repo, usuario), () => {
    exigir(repo, usuario, 'DESPACHAR');
    const en = repo.uno('SELECT en.*, p.destino_id, e.nodo_destino_id, e.itinerario_id FROM entrega en JOIN pedido p USING (pedido_id) JOIN etapa e USING (etapa_id) WHERE entrega_id = ?', [entregaId]);
    if (!en || en.estado !== 'EN_VERIFICACION') throw new Error('La entrega no está pendiente de verificación.');
    if (!receptoresVigentes(repo, String(en.destino_id), String(en.ocurrido_en)).some((r) => r.receptor_id === receptorId)) throw new Error('El receptor indicado no tenía facultad vigente a la hora de la entrega.');
    if (!metodo?.trim() || !ref?.trim()) throw new Error('Registre método y referencia de la evidencia.');
    const t = repo.reloj();
    for (const d of repo.todos('SELECT * FROM entrega_detalle WHERE entrega_id = ? AND en_verificacion_mil > 0', [entregaId])) {
      repo.run('INSERT INTO movimiento VALUES (?,?,?,NULL,?,?,?,?,?,?,?,?,?)', [nuevoId('MOV'), d.lote_id, en.nodo_destino_id, 'APTO', d.en_verificacion_mil, en.ocurrido_en, t, 'ACEPTACION', en.etapa_id, 'Confirmación comercial de entrega física previa', usuario, commandId]);
      repo.run('UPDATE entrega_detalle SET aceptado_mil = aceptado_mil + en_verificacion_mil, en_verificacion_mil = 0 WHERE entrega_id = ? AND pedido_linea_id = ? AND lote_id = ?', [entregaId, d.pedido_linea_id, d.lote_id]);
    }
    const viajaba = repo.num('SELECT COALESCE(SUM(aceptado_mil + rechazado_mil),0) FROM entrega_detalle WHERE entrega_id = ?', [entregaId]);
    const acept = repo.num('SELECT COALESCE(SUM(aceptado_mil),0) FROM entrega_detalle WHERE entrega_id = ?', [entregaId]);
    repo.run('UPDATE entrega SET estado = ?, receptor_id = ?, metodo_evidencia = ?, evidencia_ref = ?, verificada_en = ?, verificada_por = ? WHERE entrega_id = ?', [acept === viajaba ? 'TOTAL' : 'PARCIAL', receptorId, metodo, ref, t, usuario, entregaId]);
    cerrarItinerarioSiCorresponde(repo, String(en.itinerario_id));
    verificarInvariantes(repo);
    return { aceptado_mil: acept, hora_fisica: String(en.ocurrido_en) };
  });
}

function cerrarItinerarioSiCorresponde(repo: Repo, itinerarioId: string) {
  const pend = repo.num("SELECT COUNT(*) FROM etapa WHERE itinerario_id = ? AND estado NOT IN ('ENTREGADA','RECIBIDA','CANCELADA')", [itinerarioId]);
  const verif = repo.num("SELECT COUNT(*) FROM entrega en JOIN etapa e USING (etapa_id) WHERE e.itinerario_id = ? AND en.estado = 'EN_VERIFICACION'", [itinerarioId]);
  if (!pend && !verif) repo.run("UPDATE itinerario SET estado = 'COMPLETADO' WHERE itinerario_id = ?", [itinerarioId]);
}

/** Vista de itinerarios con sus etapas para la línea horizontal (§12). */
export type EtapaVista = Record<string, any> & { carga: Record<string, any>[]; en_transito: { lote_id: string; q_mil: number }[]; entregas: Record<string, any>[] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ItinerarioVista = Record<string, any> & { etapas: EtapaVista[] };
export function itinerarios(repo: Repo, pedidoId?: string): ItinerarioVista[] {
  return repo.todos(`SELECT * FROM itinerario ${pedidoId ? 'WHERE pedido_id = ?' : ''} ORDER BY creado_en DESC`, pedidoId ? [pedidoId] : []).map((i) => ({
    ...i,
    etapas: repo.todos(`SELECT e.*, s.salida, s.llegada, s.enlace_id, s.recurso_id, en.modo_id, r.nombre recurso FROM etapa e JOIN servicio s USING (servicio_id) JOIN enlace en ON en.enlace_id = s.enlace_id JOIN recurso r ON r.recurso_id = s.recurso_id
      WHERE e.itinerario_id = ? ORDER BY e.tramo, e.viaje`, [i.itinerario_id]).map((e) => ({ ...e, carga: repo.todos('SELECT ec.*, l.codigo_lote FROM etapa_carga ec JOIN lote l USING (lote_id) WHERE etapa_id = ?', [e.etapa_id]), en_transito: enTransitoEtapa(repo, String(e.etapa_id)), entregas: repo.todos('SELECT * FROM entrega WHERE etapa_id = ? ORDER BY intento', [e.etapa_id]) })),
  }));
}

// ------------------------------------------------------------------ Lecturas de clima persistentes (Z01, Z06; observación del estudiante)
export function guardarLecturaClima(repo: Repo, l: { referencia: string; latitud: number; longitud: number; ok: boolean; texto: string; observado_en?: string | null; temperatura_c?: number | null; precipitacion_mm?: number | null; lluvia_hoy_mm?: number | null; prob_lluvia_pct?: number | null; viento_kmh?: number | null }) {
  const vig = Number(parametro(repo, 'clima_vigencia_min'));
  const t = repo.reloj();
  return repo.transaccion(() => {
    const id = nuevoId('CLI');
    repo.run(`INSERT INTO lectura_clima (lectura_id, referencia, latitud, longitud, observado_en, consultado_en, vigente_hasta, temperatura_c, precipitacion_mm, viento_kmh, texto, fuente, resultado, lluvia_hoy_mm, prob_lluvia_pct)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id, l.referencia, l.latitud, l.longitud, l.observado_en ?? null, t, aLima(ms(t) + vig * 60000), l.temperatura_c ?? null, l.precipitacion_mm ?? null, l.viento_kmh ?? null, l.texto, 'Open-Meteo (pronóstico; no prueba transitabilidad)', l.ok ? 'OK' : 'ERROR', l.lluvia_hoy_mm ?? null, l.prob_lluvia_pct ?? null]);
    return id;
  });
}
export function ultimaLecturaVigente(repo: Repo, referencia: string, instante = repo.reloj()) {
  return repo.uno("SELECT * FROM lectura_clima WHERE referencia = ? AND resultado = 'OK' AND vigente_hasta > ? ORDER BY consultado_en DESC LIMIT 1", [referencia, instante]);
}

/** Cancelación de una salida programada (R07, V03, Y06, Z07): invalida itinerarios no ejecutados que la usan y señala los que ya tienen hechos. */
export function cancelarServicio(repo: Repo, usuario: string, servicioId: string, motivo: string) {
  return repo.transaccion(() => {
    const a = exigir(repo, usuario, 'PLANIFICAR');
    if (!motivo?.trim()) throw new Error('Indique el motivo de la cancelación de la salida.');
    const s = repo.uno('SELECT * FROM servicio WHERE servicio_id = ?', [servicioId]);
    if (!s) throw new Error('Salida inexistente.');
    if (s.estado !== 'PROGRAMADO') throw new Error('Solo se cancela una salida programada; una salida en curso exige registrar una incidencia.');
    repo.run("UPDATE servicio SET estado = 'CANCELADO' WHERE servicio_id = ?", [servicioId]);
    const its = repo.todos("SELECT DISTINCT i.itinerario_id, i.pedido_id FROM etapa e JOIN itinerario i USING (itinerario_id) WHERE e.servicio_id = ? AND e.estado = 'PLANIFICADA' AND i.estado IN ('CONFIRMADO','EN_EJECUCION')", [servicioId]);
    const anulados: string[] = [], aReplanificar: string[] = [];
    for (const i of its) {
      const ejecutadas = repo.num("SELECT COUNT(*) FROM etapa WHERE itinerario_id = ? AND estado NOT IN ('PLANIFICADA','CANCELADA')", [i.itinerario_id]);
      if (!ejecutadas) {
        repo.run("UPDATE etapa SET estado = 'CANCELADA' WHERE itinerario_id = ?", [i.itinerario_id]);
        repo.run("UPDATE itinerario SET estado = 'CANCELADO' WHERE itinerario_id = ?", [i.itinerario_id]);
        anulados.push(String(i.pedido_id));
      } else aReplanificar.push(String(i.pedido_id)); // los hechos ya ocurridos se conservan; la carga queda en su custodia real
    }
    repo.auditar(a, 'CANCELAR_SERVICIO', null, { servicioId, motivo, anulados, aReplanificar });
    return { anulados, aReplanificar };
  });
}

/** Imputación del costo de una salida compartida: el fijo se reconoce UNA vez y se reparte por kg (resto al menor ID estable) (V08, U07, AC01, §14.1.1-#3). */
export function imputacionServicio(repo: Repo, servicioId: string) {
  const s = repo.uno('SELECT * FROM servicio WHERE servicio_id = ?', [servicioId])!;
  const et = repo.todos("SELECT etapa_id, kg_bruto_mil FROM etapa WHERE servicio_id = ? AND estado <> 'CANCELADA' ORDER BY etapa_id", [servicioId]);
  const fijo = Number(s.tarifa_fija_cent), tot = et.reduce((a, e) => a + Number(e.kg_bruto_mil), 0);
  const base = et.map((e) => { const exacto = tot ? (fijo * Number(e.kg_bruto_mil)) / tot : 0; return { etapa_id: String(e.etapa_id), kg_mil: Number(e.kg_bruto_mil), fijo_cent: Math.floor(exacto), resto: exacto - Math.floor(exacto), variable_cent: Math.round((Number(e.kg_bruto_mil) / 1000) * Number(s.costo_kg_p4) / 100) }; });
  let falta = tot ? fijo - base.reduce((a, b) => a + b.fijo_cent, 0) : 0;
  for (const b of [...base].sort((x, y) => y.resto - x.resto || x.etapa_id.localeCompare(y.etapa_id))) { if (!falta) break; b.fijo_cent++; falta--; }
  return { servicio_id: servicioId, fijo_cent: tot ? fijo : 0, lineas: base.map(({ resto: _r, ...x }) => x) };
}

// ---------------------------------------------------------------- BB04 (auditoría RC1 n.º 10): cambio de capacidad con impacto previo
/** Servicios futuros/en curso del recurso cuya carga comprometida supera la capacidad propuesta. */
export function impactoCapacidadRecurso(repo: Repo, recursoId: string, nuevaKgMil: number) {
  return repo.todos(`SELECT s.servicio_id, s.salida, SUM(e.kg_bruto_mil) kg_mil, COUNT(*) etapas, GROUP_CONCAT(DISTINCT i.pedido_id) pedidos
    FROM servicio s JOIN etapa e USING (servicio_id) JOIN itinerario i USING (itinerario_id)
    WHERE s.recurso_id = ? AND e.estado IN ('PLANIFICADA','DESPACHADA') GROUP BY s.servicio_id HAVING SUM(e.kg_bruto_mil) > ? ORDER BY s.salida`, [recursoId, nuevaKgMil])
    .map((r) => ({ servicio_id: String(r.servicio_id), salida: String(r.salida), kg_mil: Number(r.kg_mil), etapas: Number(r.etapas), pedidos: String(r.pedidos) }));
}
/** Activa una nueva capacidad solo si ningún compromiso vigente la excede; si los hay, bloquea y los lista para resolverlos antes. */
export function cambiarCapacidadRecurso(repo: Repo, usuario: string, recursoId: string, nuevaKgMil: number, motivo: string) {
  return repo.transaccion(() => {
    const a = actor(repo, usuario); exigir(repo, usuario, 'EDITAR_MAESTROS');
    const r = repo.uno('SELECT * FROM recurso WHERE recurso_id = ?', [recursoId]);
    if (!r) throw new Error('Recurso inexistente.');
    if (!Number.isSafeInteger(nuevaKgMil) || nuevaKgMil <= 0) throw new ErrorValidacion({ v: 'La capacidad debe ser mayor que 0.' });
    if (!motivo?.trim() || motivo.trim().length < 5) throw new ErrorValidacion({ m: 'Indique el motivo del cambio.' });
    const imp = impactoCapacidadRecurso(repo, recursoId, nuevaKgMil);
    if (imp.length) throw new Error(`No se activa: ${imp.length} servicio(s) ya tienen más carga comprometida que ${nuevaKgMil / 1000} kg — ${imp.map((x) => `${x.servicio_id} (${x.salida.slice(0, 16).replace('T', ' ')}: ${x.kg_mil / 1000} kg; pedidos ${x.pedidos})`).join('; ')}. Replanifique o libere esas cargas y vuelva a intentarlo.`);
    repo.run('UPDATE recurso SET capacidad_kg_mil = ? WHERE recurso_id = ?', [nuevaKgMil, recursoId]);
    repo.auditar(a, 'CAMBIAR_CAPACIDAD_RECURSO', recursoId, { antes_kg: Number(r.capacidad_kg_mil) / 1000, despues_kg: nuevaKgMil / 1000, motivo });
    return { recurso_id: recursoId, antes_kg_mil: Number(r.capacidad_kg_mil), despues_kg_mil: nuevaKgMil };
  });
}
