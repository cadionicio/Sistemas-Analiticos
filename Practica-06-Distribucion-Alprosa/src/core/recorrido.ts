// Recorrido operativo de demostración (I08): ejecuta, con las MISMAS reglas y permisos de la interfaz,
// un día de operación sobre los pedidos de demostración para que el libro 07 contenga operación real registrada.
// Cada paso lo firma el usuario del rol que corresponde (almacén, planificación, supervisión) y queda en la bitácora;
// el lanzamiento lo pide el administrador y se registra como evento técnico «RECORRIDO_DEMO».
import type { Repo } from './db';
import * as D from './dominio';
import * as P from './permisos';
import * as T from './transporte';
import * as O from './operacion';
import * as C from './costos';
import * as R from './retornables';
import { registrarEvento } from './continuidad';

export const ROLES_RECORRIDO = { almacen: 'U03', planificacion: 'U04', supervision: 'U05' } as const;
export interface PasoRecorrido { pedido: string; paso: string; resultado: 'OK' | 'OMITIDO'; detalle: string }
export interface ResultadoRecorrido { pasos: PasoRecorrido[]; pedidos: Record<string, string>; resumen: string }

/** Guion: qué le pasa a cada pedido procesado. */
const GUION = ['ENTREGA_COMPLETA', 'RECHAZO_PARCIAL', 'INCIDENCIA_RETRASO', 'ENTREGA_COMPLETA', 'EN_TRANSITO', 'SOLO_PLANIFICADO'] as const;
type Guion = typeof GUION[number];

export function puedeRecorrer(repo: Repo): { ok: boolean; motivo: string } {
  if (!repo.num('SELECT COUNT(*) FROM pedido')) return { ok: false, motivo: 'No hay pedidos cargados.' };
  if (repo.num("SELECT COUNT(*) FROM movimiento WHERE tipo LIKE '%DESPACHO%'")) return { ok: false, motivo: 'Ya hay operación registrada (despachos): el recorrido solo se ejecuta sobre datos recién cargados.' };
  if (!/^NUTRIDEMO/.test(String(repo.uno("SELECT valor FROM meta WHERE clave = 'dataset_id'")?.valor ?? ''))) return { ok: false, motivo: 'El recorrido solo se ejecuta sobre el conjunto sintético NutriDemo (botón «Cargar demostración» o un Excel cuyo LEEME declara la empresa NutriDemo — DATOS SINTÉTICOS).' };
  return { ok: true, motivo: '' };
}

export function recorridoDemostracion(repo: Repo, solicitante: string, maxPedidos = GUION.length): ResultadoRecorrido {
  P.exigir(repo, solicitante, 'CARGAR_DATOS');
  const v = puedeRecorrer(repo);
  if (!v.ok) throw new Error(v.motivo);
  const { almacen: ALM, planificacion: PLA, supervision: SUP } = ROLES_RECORRIDO;
  const pasos: PasoRecorrido[] = [], pedidos: Record<string, string> = {};
  const ok = (pedido: string, paso: string, detalle = '') => pasos.push({ pedido, paso, resultado: 'OK', detalle });
  const omit = (pedido: string, paso: string, detalle: string) => pasos.push({ pedido, paso, resultado: 'OMITIDO', detalle });
  const etapas = (iti: string) => T.itinerarios(repo).find((i) => i.itinerario_id === iti)!.etapas;
  const candidatos = D.pedidos(repo).filter((p) => p.estado === 'Confirmado').sort((a, b) => a.ventana_fin.localeCompare(b.ventana_fin) || a.pedido_id.localeCompare(b.pedido_id));
  let k = 0; const usados: { id: string; guion: Guion; itis: string[] }[] = [];
  for (const p of candidatos) {
    if (k >= Math.min(maxPedidos, GUION.length)) break;
    const g = GUION[k];
    try {
      repo.transaccion(() => {
        D.reservarFefo(repo, ALM, p.pedido_id);
        const itis: string[] = [];
        for (const r of T.planificarPedido(repo, p.pedido_id)) {
          // En pedidos alternos se toma la alternativa multimodal factible (si existe) para mostrar custodia en nodos intermedios
          const a = (k % 2 === 1 ? r.alternativas.find((x) => x.factible && x.tramos.length > 1) : undefined) ?? r.alternativas.find((x) => x.factible);
          if (!a) throw new Error(`sin alternativa factible desde ${r.origen}: ${r.motivo_global ?? r.alternativas[0]?.motivo ?? ''}`);
          itis.push(T.confirmarItinerario(repo, PLA, p.pedido_id, r.origen, a.clave));
        }
        if (!itis.length) throw new Error('sin itinerario planificable');
        usados.push({ id: p.pedido_id, guion: g, itis });
      });
      ok(p.pedido_id, 'Reserva FEFO e itinerario confirmado', `${GUION[k]}`);
      k++;
    } catch (e) { omit(p.pedido_id, 'Reserva/planificación', (e as Error).message); }
  }
  let activosUsados = false, cargo = false;
  for (const u of usados) {
    pedidos[u.id] = u.guion;
    if (u.guion === 'SOLO_PLANIFICADO') continue;
    for (const iti of u.itis) {
      const tramos = Math.max(...etapas(iti).map((e) => Number(e.tramo)));
      for (let t = 1; t <= tramos; t++) {
        const del = etapas(iti).filter((x) => Number(x.tramo) === t);
        if (u.guion === 'INCIDENCIA_RETRASO' && t === 1) {
          O.registrarIncidencia(repo, ALM, { tipo: 'RETRASO', etapa_id: String(del[0].etapa_id), descripcion: 'Demora en la salida por congestión en el acceso (demostración).', retraso_min: 180, costo_cent: 15000, ubicacion: String(del[0].nodo_origen_id), custodio: 'Transportista de demostración' });
          ok(u.id, 'Incidencia de retraso registrada', '180 min, S/ 150');
        }
        for (const e of del) T.despacharEtapa(repo, ALM, String(e.etapa_id));
        ok(u.id, `Despacho tramo ${t}`, del.map((e) => e.etapa_id).join(', '));
        if (!cargo) { C.registrarCargo(repo, PLA, { documento_ref: 'F001-DEMO-0001', concepto: 'PEAJE', servicio_id: String(del[0].servicio_id), importe_cent: 8500 }); cargo = true; ok(u.id, 'Cargo de transporte registrado', 'S/ 85,00'); }
        if (u.guion === 'EN_TRANSITO') break; // queda en tránsito en el primer tramo
        for (const e of etapas(iti).filter((x) => Number(x.tramo) === t)) {
          if (!e.final) {
            T.recibirEtapa(repo, ALM, String(e.etapa_id), e.en_transito.map((x) => ({ lote_id: x.lote_id, apta_mil: x.q_mil, cuarentena_mil: 0, danada_mil: 0 })), 'Custodio de demostración', null);
            ok(u.id, `Recepción en nodo intermedio (tramo ${t})`, String(e.nodo_destino_id));
            continue;
          }
          const destino = String(repo.uno('SELECT destino_id FROM pedido WHERE pedido_id = ?', [u.id])!.destino_id);
          const rec = T.receptoresVigentes(repo, destino, repo.reloj())[0];
          const rechazo = u.guion === 'RECHAZO_PARCIAL';
          const lineas = e.carga.map((c, i) => {
            const q = e.en_transito.find((x) => x.lote_id === c.lote_id)!.q_mil;
            const rech = rechazo && i === 0 ? Math.round(q * 0.2 / 1000) * 1000 || Math.min(q, 1000) : 0;
            return { pedido_linea_id: String(c.pedido_linea_id), lote_id: String(c.lote_id), entregado_mil: q - rech, rechazado_mil: rech };
          });
          T.registrarEntrega(repo, ALM, String(e.etapa_id), { receptor_id: rec ? String(rec.receptor_id) : null, receptor_nombre: rec ? null : 'Receptor de demostración', metodo_evidencia: 'Firma y DNI ficticio', evidencia_ref: 'GR-DEMO-' + u.id, motivo: rechazo ? 'Envase dañado en parte de la carga' : null, lineas });
          ok(u.id, 'Entrega al cliente final', rechazo ? 'con rechazo parcial' : 'completa');
          if (rechazo) {
            const l = lineas.find((x) => x.rechazado_mil > 0)!;
            O.registrarRetorno(repo, ALM, { etapa_id: String(e.etapa_id), lote_id: l.lote_id, q_mil: l.rechazado_mil, nodo_destino_id: String(etapas(iti)[0].nodo_origen_id), condicion: 'CUARENTENA', motivo: 'Rechazo por envase dañado', documento: 'NC-DEMO-01' });
            ok(u.id, 'Retorno del rechazo a cuarentena', `${l.rechazado_mil / 1000}`);
            const nodo = String(etapas(iti)[0].nodo_origen_id);
            const enCuarentena = repo.num("SELECT COALESCE(SUM(CASE WHEN nodo_destino_id = ? THEN q_mil ELSE -q_mil END),0) FROM movimiento WHERE lote_id = ? AND condicion = 'CUARENTENA' AND (nodo_destino_id = ? OR nodo_origen_id = ?)", [nodo, l.lote_id, nodo, nodo]);
            if (enCuarentena > 0) { O.decidirCalidad(repo, SUP, { lote_id: l.lote_id, nodo_id: nodo, q_mil: enCuarentena, hacia: 'DANADO', evidencia: 'Acta de inspección DEMO-01' }); ok(u.id, 'Decisión de calidad (supervisión)', 'Cuarentena → Dañado'); }
            else omit(u.id, 'Decisión de calidad', 'el retorno aún no llegó físicamente al nodo');
          }
          if (u.guion === 'ENTREGA_COMPLETA' && !activosUsados) {
            const act = repo.todos("SELECT activo_id FROM activo_retornable WHERE condicion = 'DISPONIBLE' AND ubicacion_tipo = 'NODO' AND ubicacion_id = ? LIMIT 2", [String(etapas(iti)[0].nodo_origen_id)]).map((x) => String(x.activo_id));
            if (act.length) {
              try {
                R.entregarActivos(repo, ALM, { activos: act, pedido_id: u.id, etapa_id: String(e.etapa_id), documento: 'GR-DEMO-' + u.id });
                const cli = String(repo.uno('SELECT cliente_id FROM pedido WHERE pedido_id = ?', [u.id])!.cliente_id);
                R.retornarActivo(repo, ALM, { activo_id: act[0], desde_cliente: cli, nodo_id: String(etapas(iti)[0].nodo_origen_id), recibido: true, condicion: 'DISPONIBLE', documento: 'DEV-DEMO-01' });
                activosUsados = true; ok(u.id, 'Retornables entregados y uno devuelto', act.join(', '));
              } catch (x) { omit(u.id, 'Retornables', (x as Error).message); }
            } else omit(u.id, 'Retornables', 'no hay activos disponibles en el nodo de origen');
          }
        }
      }
    }
  }
  // Conteo cíclico en un nodo de origen (sin diferencia) para que el libro muestre el control de inventario
  const ex = D.existencias(repo).find((x) => x.condicion === 'APTO' && x.fisico_mil > 0);
  if (ex) { O.registrarConteo(repo, ALM, { nodo_id: ex.nodo_id, lote_id: ex.lote_id, contado_mil: ex.fisico_mil }); ok('—', 'Conteo cíclico', `${ex.lote_id} en ${ex.nodo_id}`); }
  const resumen = `Recorrido de demostración: ${usados.length} pedidos procesados (${Object.entries(pedidos).map(([p, g]) => `${p} ${g}`).join('; ')}); ${pasos.filter((x) => x.resultado === 'OK').length} pasos registrados, ${pasos.filter((x) => x.resultado === 'OMITIDO').length} omitidos con motivo.`;
  registrarEvento(repo, { nivel: 'INFO', etapa: 'OPERACION', codigo: 'RECORRIDO_DEMO', mensaje: `${resumen} Solicitado por ${solicitante}; pasos firmados por ${ALM} (almacén), ${PLA} (planificación) y ${SUP} (supervisión).` });
  repo.run("INSERT OR REPLACE INTO meta (clave, valor) VALUES ('recorrido_demo', ?)", [repo.reloj()]);
  return { pasos, pedidos, resumen };
}
