// I05: diagnóstico causal trazable (§8.3, DEC-I01-D5) y prescripción por reglas explicables (§9 «Recomendaciones»).
import type { Repo } from './db';
import { exigir, actor } from './permisos';
import { nuevoId } from './util';
import type { PedidoH } from './kpi';
import { planificarPedido } from './transporte';
import { costoServicio } from './costos';

export type EstadoCausa = 'HIPOTESIS_PENDIENTE' | 'EN_VALIDACION' | 'CONFIRMADA' | 'REFUTADA' | 'NO_CONCLUYENTE';
export const NOMBRE_ESTADO: Record<EstadoCausa, string> = { HIPOTESIS_PENDIENTE: 'Hipótesis pendiente', EN_VALIDACION: 'En validación', CONFIRMADA: 'Causa confirmada', REFUTADA: 'Refutada', NO_CONCLUYENTE: 'No concluyente' };

export function crearAnalisis(repo: Repo, usuario: string, a: { indicador: string; entidad: string; entidad_id: string; hecho: string; evento: string; causa_candidata: string; alternativa?: string }) {
  return repo.transaccion(() => {
    exigir(repo, usuario, 'VER_NEGOCIO');
    for (const k of ['hecho', 'evento', 'causa_candidata'] as const) if (!a[k]?.trim()) throw new Error('Complete el hecho, el evento que lo explica y la causa candidata.');
    const id = nuevoId('CAU'), t = repo.reloj();
    repo.run("INSERT INTO causa_analisis VALUES (?,?,?,?,?,?,?,'HIPOTESIS_PENDIENTE',NULL,?,?,?,?,NULL)", [id, a.indicador, a.entidad, a.entidad_id, a.hecho, a.evento, a.causa_candidata, a.alternativa ?? null, usuario, t, t]);
    repo.run("INSERT INTO causa_historial VALUES (?,?,?,NULL,'HIPOTESIS_PENDIENTE','Creado')", [id, t, usuario]);
    return id;
  });
}
export function agregarEvidencia(repo: Repo, usuario: string, analisisId: string, e: { sentido: 'A_FAVOR' | 'EN_CONTRA'; descripcion: string; fuente: string }) {
  return repo.transaccion(() => {
    exigir(repo, usuario, 'VER_NEGOCIO');
    const a = repo.uno('SELECT estado FROM causa_analisis WHERE analisis_id = ?', [analisisId]);
    if (!a) throw new Error('Análisis inexistente.');
    if (['CONFIRMADA', 'REFUTADA'].includes(String(a.estado))) throw new Error('El análisis está cerrado; abra uno nuevo si aparece evidencia nueva.');
    if (!e.descripcion?.trim() || !e.fuente?.trim()) throw new Error('La evidencia necesita descripción y fuente verificable.');
    repo.run('INSERT INTO causa_evidencia VALUES (?,?,?,?,?,?,?)', [nuevoId('EVI'), analisisId, e.sentido, e.descripcion.trim(), e.fuente.trim(), usuario, repo.reloj()]);
  });
}
/** Transiciones: confirmar exige evidencia a favor, ninguna en contra y validación por una persona distinta de quien propuso la hipótesis. */
export function cambiarEstadoCausa(repo: Repo, usuario: string, analisisId: string, a: EstadoCausa, motivo: string, conclusion?: string) {
  return repo.transaccion(() => {
    const act = exigir(repo, usuario, 'VER_NEGOCIO');
    const x = repo.uno('SELECT * FROM causa_analisis WHERE analisis_id = ?', [analisisId]);
    if (!x) throw new Error('Análisis inexistente.');
    const fav = repo.num("SELECT COUNT(*) FROM causa_evidencia WHERE analisis_id = ? AND sentido = 'A_FAVOR'", [analisisId]);
    const con = repo.num("SELECT COUNT(*) FROM causa_evidencia WHERE analisis_id = ? AND sentido = 'EN_CONTRA'", [analisisId]);
    if (['CONFIRMADA', 'REFUTADA'].includes(String(x.estado))) throw new Error('El análisis ya está cerrado.');
    if (a === 'EN_VALIDACION' && fav + con === 0) throw new Error('Para validar, registre al menos una evidencia.');
    if (a === 'CONFIRMADA') {
      if (!fav) throw new Error('No se confirma una causa sin evidencia a favor. El Pareto solo prioriza; no confirma.');
      if (con) throw new Error('Hay evidencia en contra sin resolver: el estado correcto es «No concluyente» o seguir validando.');
      if (x.creado_por === usuario) throw new Error('La confirmación la hace una persona distinta de quien propuso la hipótesis.');
      if (!conclusion?.trim()) throw new Error('Escriba la conclusión.');
    }
    if (a === 'REFUTADA' && !con) throw new Error('Para refutar se necesita evidencia en contra.');
    if (!motivo?.trim()) throw new Error('Indique el motivo del cambio.');
    const t = repo.reloj();
    repo.run('UPDATE causa_analisis SET estado = ?, conclusion = COALESCE(?, conclusion), actualizado_en = ?, validado_por = CASE WHEN ? IN (\'CONFIRMADA\',\'REFUTADA\',\'NO_CONCLUYENTE\') THEN ? ELSE validado_por END WHERE analisis_id = ?', [a, conclusion ?? null, t, a, usuario, analisisId]);
    repo.run('INSERT INTO causa_historial VALUES (?,?,?,?,?,?)', [analisisId, t, usuario, x.estado, a, motivo]);
    // La conclusión queda en la bitácora con su fecha: permite reconstruir lo conocido a un corte (vista ORIGINAL)
    repo.auditar(act, 'CAMBIAR_ESTADO_CAUSA', null, { analisisId, a, conclusion: conclusion?.trim() || null });
  });
}
export function analisis(repo: Repo) {
  return repo.todos('SELECT * FROM causa_analisis ORDER BY creado_en DESC').map((a) => Object.assign({}, a, {
    evidencias: repo.todos('SELECT * FROM causa_evidencia WHERE analisis_id = ? ORDER BY registrado_en', [a.analisis_id]),
    historial: repo.todos('SELECT * FROM causa_historial WHERE analisis_id = ? ORDER BY en', [a.analisis_id]),
  }));
}

/** Cadena demostrativa con datos SINTÉTICOS: conexión perdida en transbordo → hipótesis con evidencia calculada de la historia (§8.3). */
export function sembrarCadenaDemo(repo: Repo, hechos: PedidoH[], usuario: string) {
  if (repo.num('SELECT COUNT(*) FROM causa_analisis')) return null;
  const casos = hechos.filter((p) => p.etapas.some((e) => e.perdida));
  if (!casos.length) return null;
  const ej = casos[0], et = ej.etapas.find((e) => e.perdida)!, previa = ej.etapas.find((e) => e.tramo === et.tramo - 1);
  const porNodo = new Map<string, number>(); for (const p of casos) for (const e of p.etapas) if (e.perdida) porNodo.set(e.origen, (porNodo.get(e.origen) ?? 0) + 1);
  const transb = hechos.flatMap((p) => p.etapas.filter((e) => e.tramo > 1)), totalNodo = transb.filter((e) => e.origen === et.origen).length;
  const id = crearAnalisis(repo, usuario, {
    indicador: 'OTIF por pedido', entidad: 'pedido', entidad_id: ej.id,
    hecho: `${ej.id} (${ej.region}) se aceptó después de su compromiso del ${ej.fin.slice(0, 16).replace('T', ' ')}.`,
    evento: `La etapa ${et.id} (${et.modo}) salió de ${et.origen} el ${et.salReal.slice(0, 16).replace('T', ' ')} en lugar de ${et.salPlan.slice(0, 16).replace('T', ' ')}: conexión perdida tras la llegada del tramo ${et.tramo - 1}${previa ? ` (${previa.lleReal.slice(11, 16)})` : ''}.`,
    causa_candidata: `El margen entre la llegada terrestre y la salida acuática en ${et.origen} es insuficiente cuando el tramo anterior se retrasa.`,
    alternativa: `Programar la salida terrestre una salida antes o reservar la salida acuática siguiente como respaldo en ${et.origen}.`,
  });
  agregarEvidencia(repo, usuario, id, { sentido: 'A_FAVOR', descripcion: `${porNodo.get(et.origen) ?? 0} de ${totalNodo} transbordos en ${et.origen} perdieron la conexión en la historia sintética.`, fuente: 'Historia sintética HistEtapas (conexion_perdida), cálculo del sistema' });
  agregarEvidencia(repo, usuario, id, { sentido: 'A_FAVOR', descripcion: `En ${ej.id} la llegada real del tramo anterior fue posterior a la planificada y la salida perdida se reprogramó al día siguiente.`, fuente: `HistEtapas ${previa?.id ?? ''} y ${et.id}` });
  cambiarEstadoCausa(repo, usuario, id, 'EN_VALIDACION', 'Evidencia inicial reunida; falta revisar horarios de salida con el operador lacustre.');
  return id;
}

// ------------------------------------------------------------------ Prescripción por reglas (el usuario confirma; nada cambia planes cerrados)
interface Prop { regla: string; entidad: string; entidad_id: string; valores: string; alternativa: string; impacto: string; restricciones: string }
export function detectarRecomendaciones(repo: Repo, o: { pronosticosSinHistoria?: string[]; revisionModelo?: { serie: string; wapes: string }[] } = {}): Prop[] {
  const out: Prop[] = [];
  const ahora = repo.reloj();
  // 1. Lote sin vida útil suficiente para el destino
  for (const r of repo.todos(`SELECT r.reserva_id, pl.pedido_id, l.lote_id, l.fecha_vencimiento, p.ventana_fin, d.vida_util_min_dias FROM reserva r JOIN pedido_linea pl USING (pedido_linea_id) JOIN pedido p USING (pedido_id)
      JOIN destino d ON d.destino_id = p.destino_id JOIN lote l ON l.lote_id = r.lote_id WHERE r.estado = 'ACTIVA'`)) {
    const minimo = new Date(Date.parse(String(r.ventana_fin)) + Number(r.vida_util_min_dias) * 86400000).toISOString().slice(0, 10);
    if (String(r.fecha_vencimiento) < minimo) out.push({ regla: 'LOTE_SIN_VIDA_UTIL', entidad: 'pedido', entidad_id: String(r.pedido_id), valores: `Lote ${r.lote_id} vence ${r.fecha_vencimiento}; el destino exige vigencia hasta ${minimo}.`,
      alternativa: 'Liberar esa reserva y reservar un lote con mayor vida útil (FEFO con restricción de destino).', impacto: 'Evita rechazo en destino por vida útil.', restricciones: 'Requiere stock de otro lote del mismo producto.' });
  }
  // 2. Capacidad insuficiente / sin ruta factible
  for (const p of repo.todos(`SELECT DISTINCT pl.pedido_id FROM reserva r JOIN pedido_linea pl USING (pedido_linea_id) WHERE r.estado = 'ACTIVA'`)) {
    try {
      const res = planificarPedido(repo, String(p.pedido_id));
      for (const r of res) if (!r.alternativas.some((a) => a.factible)) out.push({ regla: 'SIN_RUTA_FACTIBLE', entidad: 'pedido', entidad_id: String(p.pedido_id),
        valores: `Desde ${r.origen}: ${r.alternativas[0]?.motivo || r.motivo_global || 'sin alternativa'}`, alternativa: 'Dividir la entrega, reasignar el origen o proponer otra fecha al cliente.',
        impacto: 'Sin acción el pedido no se cumple en su ventana.', restricciones: 'Dividir solo si el cliente acepta entregas divididas; no se parten bultos.' });
    } catch { /* sin carga planificable */ }
  }
  // 3. Riesgo alto de atraso: entrega prevista con menos de 6 h de holgura
  for (const i of repo.todos(`SELECT i.itinerario_id, i.pedido_id, i.entrega_prevista, p.ventana_fin FROM itinerario i JOIN pedido p USING (pedido_id) WHERE i.estado IN ('CONFIRMADO','EN_EJECUCION')`)) {
    const holgura = (Date.parse(String(i.ventana_fin)) - Date.parse(String(i.entrega_prevista))) / 3600000;
    if (holgura < 6) out.push({ regla: 'RIESGO_ATRASO', entidad: 'pedido', entidad_id: String(i.pedido_id), valores: `Holgura ${holgura.toFixed(1)} h entre la entrega prevista y el cierre de la ventana.`,
      alternativa: 'Evaluar una salida anterior o una ruta alternativa; avisar al cliente.', impacto: 'Reduce la probabilidad de incumplir OTIF.', restricciones: 'Sujeto a capacidad disponible en salidas anteriores.' });
  }
  // 4. Ocupación baja en salidas próximas
  for (const s of repo.todos(`SELECT s.servicio_id, s.salida, r.capacidad_kg_mil, SUM(e.kg_bruto_mil) kg FROM servicio s JOIN recurso r USING (recurso_id) JOIN etapa e ON e.servicio_id = s.servicio_id
      WHERE e.estado = 'PLANIFICADA' AND s.salida > ? GROUP BY 1,2,3`, [ahora])) {
    const u = Number(s.kg) / Number(s.capacidad_kg_mil);
    if (u < 0.3) out.push({ regla: 'OCUPACION_BAJA', entidad: 'servicio', entidad_id: String(s.servicio_id), valores: `Ocupación ${(u * 100).toFixed(0)} % de la capacidad.`,
      alternativa: 'Evaluar consolidar con otra salida del mismo tramo.', impacto: 'Menor costo por kg.', restricciones: 'Respetar las ventanas de todos los pedidos consolidados.' });
  }
  // 5. Costo creciente: real > estimado + 10 %
  for (const s of repo.todos('SELECT DISTINCT servicio_id FROM cargo_transporte')) {
    const c = costoServicio(repo, String(s.servicio_id));
    if (c.real_cent !== null && c.estimado_cent > 0 && c.real_cent > c.estimado_cent * 1.1) out.push({ regla: 'COSTO_CRECIENTE', entidad: 'servicio', entidad_id: c.servicio_id,
      valores: `Real S/ ${(c.real_cent / 100).toFixed(2)} vs estimado S/ ${(c.estimado_cent / 100).toFixed(2)} (+${(((c.real_cent - c.estimado_cent) / c.estimado_cent) * 100).toFixed(0)} %).`,
      alternativa: 'Comparar otra modalidad u operador para ese tramo.', impacto: 'Contiene el costo por kg.', restricciones: 'Cambiar de modalidad exige revisar tiempos y capacidad.' });
  }
  // 7. BL03: error predictivo sobre el umbral en dos cortes seguidos → revisión del modelo
  for (const r of o.revisionModelo ?? []) out.push({ regla: 'REVISION_MODELO', entidad: 'serie', entidad_id: r.serie, valores: `WAPE realizado en las dos últimas corridas: ${r.wapes}.`,
    alternativa: 'Revisar causas (cambio de demanda, datos tardíos, atípicos) y comparar otros métodos o segmentos antes de seguir usando la corrida.', impacto: 'Evita planificar con un pronóstico que ya falló dos veces.',
    restricciones: 'La revisión no cambia corridas guardadas: una corrección crea otra corrida enlazada.' });
  // 6. Ausencia de datos
  for (const sId of o.pronosticosSinHistoria ?? []) out.push({ regla: 'DATOS_INSUFICIENTES', entidad: 'serie', entidad_id: sId, valores: 'Menos de 26 semanas de historia o ninguna.', alternativa: 'Usar un escenario explícito y recolectar datos; no confiar en una precisión que no existe.', impacto: 'Evita decisiones sobre una cifra no validada.', restricciones: '—' });
  return out;
}
/** Registra las propuestas nuevas (sin duplicar las ya propuestas para la misma regla y entidad). */
export function actualizarRecomendaciones(repo: Repo, o: { pronosticosSinHistoria?: string[]; revisionModelo?: { serie: string; wapes: string }[] } = {}) {
  return repo.transaccion(() => {
    let nuevas = 0;
    for (const p of detectarRecomendaciones(repo, o)) {
      if (repo.uno("SELECT 1 FROM recomendacion WHERE regla = ? AND entidad_id = ? AND estado = 'PROPUESTA'", [p.regla, p.entidad_id])) continue;
      repo.run("INSERT INTO recomendacion VALUES (?,?,?,?,?,?,?,?,'PROPUESTA',?,NULL,NULL,NULL)", [nuevoId('REC'), p.regla, p.entidad, p.entidad_id, p.valores, p.alternativa, p.impacto, p.restricciones, repo.reloj()]);
      nuevas++;
    }
    return nuevas;
  });
}
export function decidirRecomendacion(repo: Repo, usuario: string, id: string, aceptar: boolean, motivo: string) {
  return repo.transaccion(() => {
    const a = exigir(repo, usuario, 'PLANIFICAR');
    if (!motivo?.trim()) throw new Error('Indique el motivo de la decisión.');
    const r = repo.uno("SELECT estado FROM recomendacion WHERE recomendacion_id = ? AND estado = 'PROPUESTA'", [id]);
    if (!r) throw new Error('La recomendación ya fue decidida.');
    repo.run('UPDATE recomendacion SET estado = ?, decidida_por = ?, decidida_en = ?, motivo = ? WHERE recomendacion_id = ?', [aceptar ? 'ACEPTADA' : 'RECHAZADA', usuario, repo.reloj(), motivo, id]);
    repo.auditar(a, 'DECIDIR_RECOMENDACION', null, { id, aceptar, motivo });
  });
}
export { actor };
