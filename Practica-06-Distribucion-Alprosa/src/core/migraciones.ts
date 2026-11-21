// Migraciones de esquema idempotentes, transaccionales y verificables (RN-63, AM05, AM06, AM08, BC01, BC06).
// v1 (prueba técnica I02) → v2 (nodos unificados DEC-I01-D2 y maestros completos).
import type { Repo } from './db';
import { DDL_V2, DDL_V3_TRANSPORTE, DDL_V4_OPERACION, DDL_V5_ANALITICA, DDL_V6_SIMULACION, DDL_V7_CONTINUIDAD } from './schema';
import { ahoraLima } from './util';

type Saldo = Record<string, number>;
function saldosV1(r: Repo): Saldo {
  const out: Saldo = {};
  for (const f of r.todos(`SELECT lote_id, ubicacion_destino_id u, condicion c, SUM(q_mil) q FROM movimiento WHERE ubicacion_destino_id IS NOT NULL GROUP BY 1,2,3
    UNION ALL SELECT lote_id, ubicacion_origen_id, condicion, -SUM(q_mil) FROM movimiento WHERE ubicacion_origen_id IS NOT NULL GROUP BY 1,2,3`))
    out[`${f.lote_id}|${f.u}|${f.c}`] = (out[`${f.lote_id}|${f.u}|${f.c}`] ?? 0) + Number(f.q);
  return out;
}
function saldosV2(r: Repo): Saldo {
  const out: Saldo = {};
  for (const f of r.todos(`SELECT lote_id, nodo_destino_id u, condicion c, SUM(q_mil) q FROM movimiento WHERE nodo_destino_id IS NOT NULL GROUP BY 1,2,3
    UNION ALL SELECT lote_id, nodo_origen_id, condicion, -SUM(q_mil) FROM movimiento WHERE nodo_origen_id IS NOT NULL GROUP BY 1,2,3`))
    out[`${f.lote_id}|${f.u}|${f.c}`] = (out[`${f.lote_id}|${f.u}|${f.c}`] ?? 0) + Number(f.q);
  return out;
}

export interface Pendiente { entidad: string; id: string; campo: string; regla: string }

function v1a2(r: Repo): Pendiente[] {
  const pend: Pendiente[] = [];
  const antes = saldosV1(r);
  const t = ahoraLima();
  for (const tb of ['producto', 'ubicacion', 'lote', 'movimiento', 'pedido', 'pedido_linea', 'reserva', 'comando', 'carga', 'auditoria'])
    r.db.exec(`ALTER TABLE ${tb} RENAME TO v1_${tb}`);
  r.db.exec('DROP TABLE meta');
  r.db.exec(DDL_V2);
  // Usuario técnico para atribuir la historia previa sin suplantar a nadie (BG06)
  r.run("INSERT INTO usuario VALUES ('LEGADO','Registros de la versión de prueba I02',0,0,?,?)", [t, 'Usuario técnico de migración; no opera']);
  for (const p of r.todos('SELECT * FROM v1_producto')) {
    r.run('INSERT INTO producto VALUES (?,?,?,?,?,?,?,?,1)', [p.producto_id, p.nombre_generico, p.familia, p.unidad_base, p.peso_kg_por_unidad_mil, 1, 0, p.activo]);
    pend.push({ entidad: 'producto', id: String(p.producto_id), campo: 'vol_cm3_por_unidad', regla: 'Desconocido en legado: valor provisional 1 cm³; completar antes de planificar transporte' });
    pend.push({ entidad: 'producto', id: String(p.producto_id), campo: 'fraccionable', regla: 'Desconocido en legado: se asume NO fraccionable (criterio conservador)' });
    r.run('INSERT INTO presentacion VALUES (?,?,?,?,1,1)', [`${p.producto_id}-BASE`, p.producto_id, 'Unidad base', 1000]);
  }
  for (const u of r.todos('SELECT * FROM v1_ubicacion'))
    r.run("INSERT INTO nodo(nodo_id,nombre,tipo,region,alias_legado,activo,fuente_dato) VALUES (?,?,?,?,?,?,?)", [u.ubicacion_id, u.nombre, u.tipo, 'SIN_REGION', 'UB:' + u.ubicacion_id, u.activa, 'MIGRADO_V1']);
  for (const p of r.todos('SELECT DISTINCT cliente_id FROM v1_pedido')) r.run('INSERT INTO cliente VALUES (?,?,1,1)', [p.cliente_id, 'Cliente migrado ' + p.cliente_id]);
  for (const d of r.todos('SELECT DISTINCT destino_id, cliente_id FROM v1_pedido')) {
    r.run("INSERT INTO nodo(nodo_id,nombre,tipo,region,alias_legado,activo,fuente_dato) VALUES (?,?,'DESTINO','SIN_REGION',?,1,'MIGRADO_V1')", ['N-' + d.destino_id, 'Destino ' + d.destino_id, 'DE:' + d.destino_id]);
    r.run("INSERT INTO destino(destino_id,cliente_id,nombre_ficticio,region,precision_geografica,nodo_id,acepta_anticipadas,vida_util_min_dias,activo) VALUES (?,?,?,?, 'DESCONOCIDA', ?, 0, 0, 1)",
      [d.destino_id, d.cliente_id, 'Destino migrado ' + d.destino_id, 'SIN_REGION', 'N-' + d.destino_id]);
    pend.push({ entidad: 'destino', id: String(d.destino_id), campo: 'region/código territorial/coordenadas', regla: 'No existían en v1: quedan SIN_REGION y precisión DESCONOCIDA' });
  }
  r.db.exec('INSERT INTO lote SELECT * FROM v1_lote');
  r.db.exec(`INSERT INTO movimiento(movimiento_id,lote_id,nodo_origen_id,nodo_destino_id,condicion,q_mil,ocurrido_en,registrado_en,tipo,transfer_id,motivo,usuario_id,command_id)
    SELECT movimiento_id,lote_id,ubicacion_origen_id,ubicacion_destino_id,condicion,q_mil,ocurrido_en,registrado_en,tipo,NULL,NULL,'LEGADO',command_id FROM v1_movimiento`);
  for (const p of r.todos('SELECT * FROM v1_pedido')) {
    r.run(`INSERT INTO pedido(pedido_id,cliente_id,destino_id,fecha_pedido,ventana_inicio,ventana_fin,prioridad,permite_parcial,permite_entregas_divididas,estado_base)
      VALUES (?,?,?,?,?,?,'NORMAL',?,0,?)`, [p.pedido_id, p.cliente_id, p.destino_id, p.fecha_pedido, p.ventana_inicio, p.ventana_fin, p.permite_parcial, p.estado_importado]);
    pend.push({ entidad: 'pedido', id: String(p.pedido_id), campo: 'prioridad/permite_entregas_divididas', regla: 'No existían en v1: NORMAL y NO (criterio conservador)' });
  }
  for (const l of r.todos('SELECT pl.*, pr.nombre_generico FROM v1_pedido_linea pl JOIN v1_producto pr USING (producto_id)')) {
    const q = Number(l.q_solicitada_mil), p4 = Number(l.precio_neto_base_cent) * 100;
    r.run('INSERT INTO pedido_linea VALUES (?,?,?,?,?,?,?,?,?,0,?)', [l.pedido_linea_id, l.pedido_id, l.producto_id, `${l.producto_id}-BASE`, q, 1000, q, p4, Math.round((q * p4) / 1e5), l.nombre_generico]);
  }
  r.db.exec(`INSERT INTO reserva(reserva_id,pedido_linea_id,lote_id,nodo_id,q_mil,estado,creada_en,command_id) SELECT reserva_id,pedido_linea_id,lote_id,ubicacion_id,q_mil,estado,creada_en,command_id FROM v1_reserva`);
  r.db.exec('INSERT INTO comando SELECT * FROM v1_comando');
  r.db.exec("INSERT INTO carga SELECT *, 'LEGADO' FROM v1_carga");
  r.db.exec("INSERT INTO auditoria(registrado_en,usuario_id,roles,accion,command_id,detalle) SELECT registrado_en,'LEGADO',perfil,accion,command_id,detalle FROM v1_auditoria");
  for (const tb of ['auditoria', 'carga', 'comando', 'reserva', 'pedido_linea', 'pedido', 'movimiento', 'lote', 'ubicacion', 'producto']) r.db.exec(`DROP TABLE v1_${tb}`);
  const despues = saldosV2(r);
  const claves = new Set([...Object.keys(antes), ...Object.keys(despues)]);
  for (const k of claves) if ((antes[k] ?? 0) !== (despues[k] ?? 0)) throw new Error('Migración abortada: el balance cambió en ' + k);
  return pend;
}

/** v2 → v3: nodos con manipulación/horario, movimiento con tipos de entrega y tablas de transporte (I04). */
function v2a3(r: Repo) {
  const antes = saldosV2(r);
  for (const [c, def] of [['manipulacion_min', "INTEGER NOT NULL DEFAULT 30"], ['abre', "TEXT NOT NULL DEFAULT '00:00'"], ['cierra', "TEXT NOT NULL DEFAULT '23:59'"]])
    if (!r.todos('PRAGMA table_info(nodo)').some((f) => f.name === c)) r.db.exec(`ALTER TABLE nodo ADD COLUMN ${c} ${def}`);
  r.db.exec('ALTER TABLE movimiento RENAME TO v2_movimiento');
  r.db.exec('DROP INDEX IF EXISTS ix_mov_lote; DROP INDEX IF EXISTS ix_mov_transfer;');
  const ddlMov = DDL_V2.slice(DDL_V2.indexOf('CREATE TABLE IF NOT EXISTS movimiento'), DDL_V2.indexOf('CREATE TABLE IF NOT EXISTS pedido ('));
  r.db.exec(ddlMov);
  r.db.exec('INSERT INTO movimiento SELECT * FROM v2_movimiento; DROP TABLE v2_movimiento;');
  r.db.exec(DDL_V3_TRANSPORTE);
  const despues = saldosV2(r);
  for (const k of new Set([...Object.keys(antes), ...Object.keys(despues)])) if ((antes[k] ?? 0) !== (despues[k] ?? 0)) throw new Error('Migración v3 abortada: el balance cambió en ' + k);
}

export function migrar(r: Repo, desde: number) {
  if (desde === 6) {
    r.db.exec('BEGIN IMMEDIATE');
    try {
      r.db.exec(DDL_V7_CONTINUIDAD);
      r.run("UPDATE meta SET valor = '7' WHERE clave = 'schema_version'");
      r.run('INSERT INTO migracion VALUES (?,?,?)', [7, ahoraLima(), 'v6→v7: eventos técnicos y ensayos de restauración (solo agrega)']);
      r.db.exec('COMMIT');
    } catch (e) { r.db.exec('ROLLBACK'); throw e; }
    return;
  }
  if (desde === 5) {
    r.db.exec('BEGIN IMMEDIATE');
    try {
      r.db.exec(DDL_V6_SIMULACION);
      r.run("UPDATE meta SET valor = '6' WHERE clave = 'schema_version'");
      r.run('INSERT INTO migracion VALUES (?,?,?)', [6, ahoraLima(), 'v5→v6: modelos y corridas de simulación, supuestos y corridas económicas, escenarios de demanda (solo agrega)']);
      r.db.exec('COMMIT');
    } catch (e) { r.db.exec('ROLLBACK'); throw e; }
    migrar(r, 6);
    return;
  }
  if (desde === 4) {
    r.db.exec('BEGIN IMMEDIATE');
    try {
      r.db.exec(DDL_V5_ANALITICA);
      r.run("UPDATE meta SET valor = '5' WHERE clave = 'schema_version'");
      r.run('INSERT INTO migracion VALUES (?,?,?)', [5, ahoraLima(), 'v4→v5: pronóstico diario de lluvia en clima y tablas de analítica (solo agrega)']);
      r.db.exec('COMMIT');
    } catch (e) { r.db.exec('ROLLBACK'); throw e; }
    migrar(r, 5);
    return;
  }
  if (desde === 3) {
    r.db.exec('BEGIN IMMEDIATE');
    try {
      r.db.exec(DDL_V4_OPERACION);
      r.run("UPDATE meta SET valor = '4' WHERE clave = 'schema_version'");
      r.run('INSERT INTO migracion VALUES (?,?,?)', [4, ahoraLima(), 'v3→v4: incidencias, retornos, calidad y retiro, conteos, alertas, cargos, transbordos y retornables (solo tablas nuevas)']);
      r.db.exec('COMMIT');
    } catch (e) { r.db.exec('ROLLBACK'); throw e; }
    migrar(r, 4);
    return;
  }
  if (desde === 2) {
    r.db.exec('PRAGMA foreign_keys = OFF;');
    r.db.exec('BEGIN IMMEDIATE');
    try {
      v2a3(r);
      r.run("UPDATE meta SET valor = '3' WHERE clave = 'schema_version'");
      r.run('INSERT INTO migracion VALUES (?,?,?)', [3, ahoraLima(), 'v2→v3: transporte multimodal, custodia, entregas y lecturas de clima; balances verificados']);
      if (r.todos('PRAGMA foreign_key_check').length) throw new Error('Migración v3 abortada: referencias huérfanas.');
      r.db.exec('COMMIT');
    } catch (e) { r.db.exec('ROLLBACK'); throw e; } finally { r.db.exec('PRAGMA foreign_keys = ON;'); }
    migrar(r, 3);
    return;
  }
  if (desde === 1) {
    r.db.exec('PRAGMA foreign_keys = OFF;');
    r.db.exec('BEGIN IMMEDIATE');
    try {
      const pend = v1a2(r);
      r.run("INSERT INTO meta(clave, valor) VALUES ('schema_version','2')");
      r.run("INSERT INTO meta(clave, valor) VALUES ('pendientes_migracion', ?)", [JSON.stringify(pend)]);
      r.run('INSERT INTO migracion VALUES (?,?,?)', [2, ahoraLima(), `v1→v2: nodos unificados con alias UB:/DE:, ${pend.length} datos pendientes declarados, balances verificados`]);
      if (r.todos('PRAGMA foreign_key_check').length) throw new Error('Migración abortada: referencias huérfanas.');
      r.db.exec('COMMIT');
    } catch (e) {
      r.db.exec('ROLLBACK');
      throw e;
    } finally {
      r.db.exec('PRAGMA foreign_keys = ON;');
    }
    migrar(r, 2);
  }
}
