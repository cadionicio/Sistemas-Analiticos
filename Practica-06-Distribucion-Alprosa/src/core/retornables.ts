// I04-b: envases y pallets retornables como activos separados del alimento (AR01–AR08).
import type { Repo } from './db';
import { exigir } from './permisos';
import { nuevoId } from './util';

const MOV = 'INSERT INTO movimiento_activo VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)';

/** Entrega activos junto con un pedido: quedan en custodia del cliente con devolución pendiente; la venta del alimento no los vende ni los da de baja (AR01, AR02). */
export function entregarActivos(repo: Repo, usuario: string, p: { activos: string[]; pedido_id: string; etapa_id?: string; documento?: string }, commandId = nuevoId('CMD')) {
  return repo.transaccion(() => {
    exigir(repo, usuario, 'DESPACHAR');
    const ped = repo.uno('SELECT cliente_id FROM pedido WHERE pedido_id = ?', [p.pedido_id]);
    if (!ped) throw new Error('Pedido inexistente.');
    const t = repo.reloj();
    for (const id of p.activos) {
      const a = repo.uno('SELECT * FROM activo_retornable WHERE activo_id = ?', [id]);
      if (!a) throw new Error(`Activo ${id} inexistente.`);
      if (a.ubicacion_tipo !== 'NODO' || a.condicion !== 'DISPONIBLE') throw new Error(`El activo ${id} no está disponible en un nodo (está ${String(a.ubicacion_tipo).toLowerCase()} ${a.ubicacion_id}, ${String(a.condicion).toLowerCase()}).`);
      if (a.propietario !== 'ALPROSA') throw new Error(`El activo ${id} pertenece a ${a.propietario}: no se entrega a clientes como propio (AR06).`);
      repo.run("UPDATE activo_retornable SET ubicacion_tipo = 'CLIENTE', ubicacion_id = ?, actualizado_en = ? WHERE activo_id = ?", [ped.cliente_id, t, id]);
      repo.run(MOV, [nuevoId('MAC'), id, 'ENTREGA', a.ubicacion_id, ped.cliente_id, p.pedido_id, p.etapa_id ?? null, a.condicion, p.documento ?? null, usuario, t, t, commandId]);
    }
    return { entregados: p.activos.length, cliente: String(ped.cliente_id) };
  });
}

/** Retorno: un aviso o comprobante solo ANUNCIA (no cambia la custodia física, AR08); la recepción física devuelve el activo, que queda en REVISIÓN si llega dañado o dudoso (AR03, AR04). Custodia incompatible = conflicto registrado sin duplicar (AR05). */
export function retornarActivo(repo: Repo, usuario: string, p: { activo_id: string; desde_cliente: string; nodo_id: string; recibido: boolean; condicion?: 'DISPONIBLE' | 'REVISION' | 'DANADO'; documento?: string; reportado_por?: string }, commandId = nuevoId('CMD')) {
  return repo.transaccion(() => {
    exigir(repo, usuario, 'DESPACHAR');
    const a = repo.uno('SELECT * FROM activo_retornable WHERE activo_id = ?', [p.activo_id]);
    if (!a) throw new Error('Activo inexistente.');
    const t = repo.reloj(), quien = p.reportado_por || usuario;
    if (a.ubicacion_tipo !== 'CLIENTE' || a.ubicacion_id !== p.desde_cliente) {
      repo.run(MOV, [nuevoId('MAC'), p.activo_id, 'CONFLICTO', p.desde_cliente, p.nodo_id, null, null, null, p.documento ?? null, quien, t, t, commandId]);
      return { estado: 'CONFLICTO', mensaje: `Custodia incompatible: el sistema tiene el activo en ${String(a.ubicacion_tipo).toLowerCase()} ${a.ubicacion_id}. Se registró el reporte para resolver; no se duplica el activo.` };
    }
    if (!p.recibido) {
      repo.run(MOV, [nuevoId('MAC'), p.activo_id, 'RETORNO_ANUNCIADO', p.desde_cliente, p.nodo_id, null, null, null, p.documento ?? null, quien, t, t, commandId]);
      return { estado: 'ANUNCIADO', mensaje: 'Retorno anunciado; el activo sigue en custodia del cliente hasta recibirlo físicamente.' };
    }
    const cond = p.condicion ?? 'REVISION';
    repo.run("UPDATE activo_retornable SET ubicacion_tipo = 'NODO', ubicacion_id = ?, condicion = ?, actualizado_en = ? WHERE activo_id = ?", [p.nodo_id, cond, t, p.activo_id]);
    repo.run(MOV, [nuevoId('MAC'), p.activo_id, 'RETORNO_RECIBIDO', p.desde_cliente, p.nodo_id, null, null, cond, p.documento ?? null, quien, t, t, commandId]);
    return { estado: 'RECIBIDO', condicion: cond };
  });
}

/** Inspección: libera (DISPONIBLE) o da de baja con evidencia; no se reutiliza un activo en revisión (AR04). */
export function inspeccionarActivo(repo: Repo, usuario: string, activoId: string, condicion: 'DISPONIBLE' | 'DANADO' | 'BAJA', evidencia: string) {
  return repo.transaccion(() => {
    exigir(repo, usuario, 'APROBAR_AJUSTE');
    if (!evidencia?.trim()) throw new Error('La inspección exige evidencia.');
    const a = repo.uno('SELECT * FROM activo_retornable WHERE activo_id = ?', [activoId]);
    if (!a || a.ubicacion_tipo !== 'NODO') throw new Error('Solo se inspecciona un activo recibido en un nodo.');
    const t = repo.reloj();
    repo.run('UPDATE activo_retornable SET condicion = ?, actualizado_en = ? WHERE activo_id = ?', [condicion, t, activoId]);
    repo.run(MOV, [nuevoId('MAC'), activoId, 'INSPECCION', a.ubicacion_id, a.ubicacion_id, null, null, condicion, evidencia.trim(), usuario, t, t, nuevoId('CMD')]);
  });
}

/** Saldo por cliente y tipo: entregados, recibidos, anunciados pendientes y en custodia del cliente (AR03); separado por propietario (AR06). */
export function saldoRetornables(repo: Repo) {
  return repo.todos(`SELECT a.tipo, a.propietario, a.ubicacion_tipo, a.ubicacion_id, a.condicion, COUNT(*) n,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM movimiento_activo m WHERE m.activo_id = a.activo_id AND m.tipo = 'RETORNO_ANUNCIADO' AND m.registrado_en > COALESCE((SELECT MAX(registrado_en) FROM movimiento_activo x WHERE x.activo_id = a.activo_id AND x.tipo = 'ENTREGA'), '')) THEN 1 ELSE 0 END) anunciados
    FROM activo_retornable a GROUP BY 1,2,3,4,5 ORDER BY 1,2,3,4`);
}

/** Tara y volumen de activos que viajan de retorno: ocupan capacidad del tramo, pero no son kg vendidos (AR07). */
export function cargaRetornables(repo: Repo, activos: string[]) {
  const f = repo.todos(`SELECT SUM(tara_kg_mil) kg, SUM(dm3) dm3, COUNT(*) n FROM activo_retornable WHERE activo_id IN (${activos.map(() => '?').join(',') || "''"})`, activos)[0];
  return { kg_mil: Number(f?.kg ?? 0), dm3: Number(f?.dm3 ?? 0), unidades: Number(f?.n ?? 0), kg_vendidos_mil: 0 };
}
