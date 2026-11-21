// I04-b: alertas internas con ciclo de vida (AW01–AW07). Se evalúan dentro del aplicativo; nunca envían mensajes externos.
import type { Repo } from './db';
import { exigir } from './permisos';
import { nuevoId, aLima } from './util';
import { pedidos, parametro } from './dominio';

export interface Hecho { regla: string; entidad: string; entidad_id: string; grupo: string; severidad: 'ALTA' | 'MEDIA' | 'BAJA'; mensaje: string; umbral?: string; version_parametro?: number }

const versionParam = (repo: Repo, clave: string) => repo.num('SELECT COALESCE(MAX(version),0) FROM parametro WHERE clave = ?', [clave]);

/** Hechos vigentes que ameritan alerta. Cada uno tiene una clave estable (regla + entidad) para no duplicar (AW02). */
export function detectarHechos(repo: Repo, ahora = repo.reloj()): Hecho[] {
  const h: Hecho[] = [];
  for (const p of pedidos(repo, ahora)) if (p.atrasado) h.push({ regla: 'PEDIDO_ATRASADO', entidad: 'pedido', entidad_id: p.pedido_id, grupo: p.pedido_id, severidad: p.prioridad === 'URGENTE' ? 'ALTA' : 'MEDIA', mensaje: `${p.pedido_id} superó su ventana sin aceptación completa.` });
  const horas = Number(parametro(repo, 'alerta_verificacion_h') ?? 24);
  for (const e of repo.todos("SELECT entrega_id, pedido_id, ocurrido_en FROM entrega WHERE estado = 'EN_VERIFICACION'"))
    if (Date.parse(ahora) - Date.parse(String(e.ocurrido_en)) >= horas * 3600000)
      h.push({ regla: 'VERIFICACION_DEMORADA', entidad: 'entrega', entidad_id: String(e.entrega_id), grupo: String(e.pedido_id), severidad: 'MEDIA', mensaje: `Entrega de ${e.pedido_id} lleva más de ${horas} h en verificación.`, umbral: `${horas} h`, version_parametro: versionParam(repo, 'alerta_verificacion_h') });
  for (const t of repo.todos(`SELECT t.etapa_id, i.pedido_id, t.q_diferencia_mil FROM transferencia t JOIN etapa e USING (etapa_id) JOIN itinerario i USING (itinerario_id) WHERE t.q_diferencia_mil > 0`)) {
    const pend = repo.num(`SELECT COALESCE(SUM(CASE WHEN nodo_destino_id = (SELECT nodo_id FROM nodo WHERE tipo='TRANSITO' LIMIT 1) THEN q_mil ELSE -q_mil END),0) FROM movimiento WHERE transfer_id = ?
      AND (nodo_destino_id = (SELECT nodo_id FROM nodo WHERE tipo='TRANSITO' LIMIT 1) OR nodo_origen_id = (SELECT nodo_id FROM nodo WHERE tipo='TRANSITO' LIMIT 1))`, [t.etapa_id]);
    if (pend > 0) h.push({ regla: 'DIFERENCIA_EN_TRANSITO', entidad: 'etapa', entidad_id: String(t.etapa_id), grupo: String(t.pedido_id), severidad: 'ALTA', mensaje: `Diferencia de ${pend / 1000} sin conciliar en la etapa ${t.etapa_id}.` });
  }
  for (const b of repo.todos("SELECT bloqueo_id, lote_id, motivo FROM bloqueo_lote WHERE estado = 'ACTIVO'"))
    h.push({ regla: 'RETIRO_ACTIVO', entidad: 'lote', entidad_id: String(b.lote_id), grupo: String(b.lote_id), severidad: 'ALTA', mensaje: `Retiro de calidad activo del lote ${b.lote_id}: ${b.motivo}.` });
  for (const c of repo.todos("SELECT conteo_id, nodo_id, lote_id, diferencia_mil FROM conteo WHERE estado IN ('RECUENTO','PENDIENTE')"))
    h.push({ regla: 'CONTEO_CON_DIFERENCIA', entidad: 'conteo', entidad_id: String(c.conteo_id), grupo: `${c.nodo_id}/${c.lote_id}`, severidad: 'MEDIA', mensaje: `Conteo de ${c.lote_id} en ${c.nodo_id} con diferencia ${Number(c.diferencia_mil) / 1000} sin resolver.` });
  for (const i of repo.todos(`SELECT i.incidencia_id, i.tipo, it.pedido_id FROM incidencia i JOIN etapa e USING (etapa_id) JOIN itinerario it USING (itinerario_id) WHERE i.estado = 'ABIERTA'`))
    h.push({ regla: 'INCIDENCIA_ABIERTA', entidad: 'incidencia', entidad_id: String(i.incidencia_id), grupo: String(i.pedido_id), severidad: i.tipo === 'AVERIA' || i.tipo === 'DETENCION' ? 'ALTA' : 'MEDIA', mensaje: `Incidencia ${String(i.tipo).toLowerCase()} abierta en ${i.pedido_id}.` });
  return h;
}

/**
 * Sincroniza alertas con los hechos: crea las nuevas, conserva las vigentes (sin duplicar), reactiva silencios vencidos si la causa sigue, resuelve automáticamente
 * las que perdieron su causa y abre un nuevo episodio enlazado si la causa reaparece tras resolverse (AW01, AW04, AW06). Escala las vencidas o sin responsable (AW03).
 */
export function evaluarAlertas(repo: Repo, ahora = repo.reloj()) {
  return repo.transaccion(() => {
    const hechos = detectarHechos(repo, ahora);
    const plazoH = Number(parametro(repo, 'alerta_plazo_h') ?? 8);
    const claves = new Set<string>();
    let nuevas = 0;
    for (const h of hechos) {
      const clave = `${h.regla}:${h.entidad}:${h.entidad_id}`; claves.add(clave);
      const viva = repo.uno("SELECT * FROM alerta WHERE clave = ? AND estado IN ('ABIERTA','RECONOCIDA','SILENCIADA') ORDER BY episodio DESC LIMIT 1", [clave]);
      if (viva) {
        if (viva.estado === 'SILENCIADA' && String(viva.silencio_hasta) <= ahora) cambiar(repo, String(viva.alerta_id), 'ABIERTA', null, 'Fin del silencio: la causa continúa');
        continue;
      }
      const previa = repo.uno("SELECT alerta_id, episodio FROM alerta WHERE clave = ? AND estado IN ('RESUELTA','DESCARTADA') ORDER BY episodio DESC LIMIT 1", [clave]);
      const id = nuevoId('ALE');
      repo.run(`INSERT INTO alerta VALUES (?,?,?,?,?,?,?,?,?,?,'ABIERTA',NULL,?,?,0,NULL,NULL,?,?,NULL,NULL)`, [id, h.regla, clave, h.entidad, h.entidad_id, h.grupo, h.severidad, h.mensaje, h.umbral ?? null, h.version_parametro ?? null,
        ahora, aLima(Date.parse(ahora) + plazoH * 3600000), previa ? Number(previa.episodio) + 1 : 1, previa?.alerta_id ?? null]);
      repo.run('INSERT INTO alerta_historial VALUES (?,?,NULL,NULL,?,?)', [id, ahora, 'ABIERTA', previa ? `Reaparece la causa (episodio anterior ${previa.alerta_id})` : 'Detectada']);
      nuevas++;
    }
    let resueltas = 0;
    for (const a of repo.todos("SELECT alerta_id, clave FROM alerta WHERE estado IN ('ABIERTA','RECONOCIDA','SILENCIADA')"))
      if (!claves.has(String(a.clave))) { cambiar(repo, String(a.alerta_id), 'RESUELTA', null, 'La causa ya no está presente'); resueltas++; }
    const escaladas = repo.todos("SELECT alerta_id FROM alerta WHERE estado IN ('ABIERTA','RECONOCIDA') AND escalada = 0 AND (plazo <= ? OR (responsable_id IS NULL AND severidad = 'ALTA'))", [ahora]);
    for (const a of escaladas) { repo.run('UPDATE alerta SET escalada = 1 WHERE alerta_id = ?', [a.alerta_id]); repo.run("INSERT INTO alerta_historial VALUES (?,?,NULL,NULL,'ESCALADA','Plazo vencido o sin responsable: visible para supervisión')", [a.alerta_id, ahora]); }
    return { hechos: hechos.length, nuevas, resueltas, escaladas: escaladas.length };
  });
}

function cambiar(repo: Repo, id: string, a: string, usuario: string | null, motivo: string) {
  const prev = repo.uno('SELECT estado FROM alerta WHERE alerta_id = ?', [id])!;
  const t = repo.reloj(), cierre = a === 'RESUELTA' || a === 'DESCARTADA';
  repo.run(`UPDATE alerta SET estado = ?, motivo = COALESCE(?, motivo) ${cierre ? ', cerrada_en = ?, cerrada_por = ?' : ''} WHERE alerta_id = ?`, cierre ? [a, motivo, t, usuario, id] : [a, motivo, id]);
  repo.run('INSERT INTO alerta_historial VALUES (?,?,?,?,?,?)', [id, t, usuario, prev.estado, a, motivo]);
}

/** Acciones del operador: reconocer (no resuelve, AW01), asignar, silenciar con motivo y fin (AW04), descartar con evidencia (AW05). */
export function accionAlerta(repo: Repo, usuario: string, alertaId: string, accion: 'RECONOCER' | 'ASIGNAR' | 'SILENCIAR' | 'DESCARTAR', p: { motivo?: string; hasta?: string; responsable?: string } = {}) {
  return repo.transaccion(() => {
    exigir(repo, usuario, 'VER_NEGOCIO');
    const a = repo.uno('SELECT * FROM alerta WHERE alerta_id = ?', [alertaId]);
    if (!a || !['ABIERTA', 'RECONOCIDA', 'SILENCIADA'].includes(String(a.estado))) throw new Error('La alerta ya está cerrada.');
    if (accion === 'RECONOCER') return cambiar(repo, alertaId, 'RECONOCIDA', usuario, p.motivo || 'Recibida; la causa sigue activa');
    if (accion === 'ASIGNAR') {
      if (!p.responsable) throw new Error('Indique el responsable.');
      repo.run('UPDATE alerta SET responsable_id = ? WHERE alerta_id = ?', [p.responsable, alertaId]);
      return repo.run('INSERT INTO alerta_historial VALUES (?,?,?,?,?,?)', [alertaId, repo.reloj(), usuario, a.estado, a.estado, `Asignada a ${p.responsable}`]);
    }
    if (accion === 'SILENCIAR') {
      if (!p.motivo?.trim() || !p.hasta) throw new Error('Silenciar exige motivo y fecha de fin.');
      if (p.hasta <= repo.reloj()) throw new Error('La fecha de fin del silencio debe ser futura.');
      repo.run('UPDATE alerta SET silencio_hasta = ? WHERE alerta_id = ?', [p.hasta, alertaId]);
      return cambiar(repo, alertaId, 'SILENCIADA', usuario, p.motivo.trim());
    }
    if (!p.motivo?.trim() || p.motivo.trim().length < 10) throw new Error('Descartar exige un motivo con evidencia (mínimo 10 caracteres).');
    return cambiar(repo, alertaId, 'DESCARTADA', usuario, p.motivo.trim());
  });
}

export function alertas(repo: Repo, soloVivas = true) {
  return repo.todos(`SELECT * FROM alerta ${soloVivas ? "WHERE estado IN ('ABIERTA','RECONOCIDA','SILENCIADA')" : ''} ORDER BY CASE severidad WHEN 'ALTA' THEN 0 WHEN 'MEDIA' THEN 1 ELSE 2 END, creada_en DESC`)
    .map((a) => Object.assign({}, a, { relacionadas: repo.num("SELECT COUNT(*) FROM alerta WHERE grupo = ? AND alerta_id <> ? AND estado IN ('ABIERTA','RECONOCIDA','SILENCIADA')", [a.grupo, a.alerta_id]) }) as Record<string, any> & { relacionadas: number });
}
