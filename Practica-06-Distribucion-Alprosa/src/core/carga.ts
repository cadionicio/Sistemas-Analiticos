import { parametrosDesdeFilas } from './simulacion';
// Confirmación atómica de una carga validada (RN-19, B01–B08). Reemplaza el conjunto de datos de negocio;
// conserva usuarios, auditoría, historial de cargas y comandos. Usuarios/roles se actualizan si vienen en el libro.
import type { Repo } from './db';
import type { ConjuntoValidado } from './contrato';
import { exigir } from './permisos';
import { nuevoId } from './util';
import { asegurarParametros, verificarInvariantes } from './dominio';

const BORRAR = ['corrida_economica', 'corrida_simulacion', 'modelo_simulacion', 'supuesto_economico', 'escenario_demanda', 'recomendacion', 'corrida_pronostico', 'causa_historial', 'causa_evidencia', 'causa_analisis', 'hist_sin_datos', 'hist_devolucion', 'hist_etapa', 'hist_entrega', 'hist_linea', 'hist_pedido', 'alerta_historial', 'alerta', 'conteo', 'decision_calidad', 'bloqueo_lote', 'retorno', 'incidencia', 'cargo_transporte', 'movimiento_activo', 'activo_retornable', 'regla_transbordo', 'entrega_detalle', 'entrega', 'transferencia', 'etapa_carga', 'etapa', 'itinerario', 'condicion_acceso', 'servicio', 'compatibilidad', 'receptor_autorizado', 'enlace', 'recurso', 'modo_transporte', 'compromiso_futuro', 'propuesta_entrega', 'reserva', 'solicitud_ajuste', 'movimiento', 'suministro_esperado', 'pedido_linea', 'pedido',
  'lote', 'destino_alias', 'destino', 'limite_region', 'presentacion', 'producto', 'cliente', 'nodo'];

export function cargaPrevia(repo: Repo, hash: string) {
  const actual = repo.uno("SELECT valor FROM meta WHERE clave = 'dataset_hash'");
  return actual && actual.valor === hash ? repo.uno("SELECT * FROM carga WHERE file_hash = ? AND resultado = 'CONFIRMADA' ORDER BY registrado_en DESC", [hash]) : undefined;
}

export function confirmarCarga(repo: Repo, usuario: string, d: ConjuntoValidado, info: { hash: string; nombre: string; bytes: number; datasetId: string }) {
  return repo.transaccion(() => {
    const a = exigir(repo, usuario, 'CARGAR_DATOS');
    const t = repo.reloj();
    for (const tb of BORRAR) repo.run(`DELETE FROM ${tb}`);
    if (d.Usuarios?.length) {
      for (const u of d.Usuarios)
        repo.run(`INSERT INTO usuario(usuario_id, nombre_ficticio, activo, compartida) VALUES (?,?,?,?) ON CONFLICT(usuario_id) DO UPDATE SET nombre_ficticio = excluded.nombre_ficticio, activo = excluded.activo, compartida = excluded.compartida`,
          [u.usuario_id, u.nombre_ficticio, u.activo, u.compartida]);
      if (d.RolesAsignados?.length) {
        const ids = [...new Set(d.Usuarios.map((u) => String(u.usuario_id)))];
        repo.run(`DELETE FROM rol_asignacion WHERE usuario_id IN (${ids.map(() => '?').join(',')})`, ids);
        for (const r of d.RolesAsignados) repo.run('INSERT INTO rol_asignacion VALUES (?,?,?,?,?,?,?)', [nuevoId('ROL'), r.usuario_id, r.rol, r.vigente_desde, r.vigente_hasta, 'CARGA', t]);
      }
      const admins = repo.num(`SELECT COUNT(*) FROM rol_asignacion r JOIN usuario u USING (usuario_id) WHERE r.rol = 'ADMINISTRADOR' AND u.activo = 1 AND r.vigente_desde <= ? AND (r.vigente_hasta IS NULL OR r.vigente_hasta > ?)`, [t, t]);
      if (!admins) throw new Error('La carga dejaría el sistema sin un usuario con rol de Administración vigente. No se confirmó nada.');
    }
    for (const p of d.Parametros ?? []) {
      const act = repo.uno('SELECT * FROM parametro WHERE clave = ? ORDER BY version DESC LIMIT 1', [p.clave]);
      if (!act) throw new Error(`Parámetro desconocido en la hoja Parametros: ${p.clave}. No se confirmó nada.`);
      if (act.valor !== p.valor) repo.run('INSERT INTO parametro VALUES (?,?,?,?,?,?,?,?,?)', [p.clave, Number(act.version) + 1, act.tipo, p.valor, act.unidad, p.vigente_desde, usuario, t, p.motivo]);
    }
    for (const r of d.Productos) repo.run('INSERT INTO producto VALUES (?,?,?,?,?,?,?,?,1)', [r.producto_id, r.nombre_generico, r.familia, r.unidad_base, r.peso_kg_por_unidad, Math.round(Number(r.volumen_m3_por_unidad)), r.fraccionable, r.activo]);
    for (const r of d.Conversiones) repo.run('INSERT INTO presentacion VALUES (?,?,?,?,?,1)', [r.presentacion_id, r.producto_id, r.nombre, r.unidades_base_por_presentacion, r.activo]);
    for (const r of d.Clientes) repo.run('INSERT INTO cliente VALUES (?,?,?,1)', [r.cliente_id, r.nombre_ficticio, r.activo]);
    for (const r of d.NodosLogisticos) repo.run('INSERT INTO nodo(nodo_id,nombre,tipo,region,capacidad_almacen_kg_mil,permite_espera_nocturna,activo,fuente_dato,manipulacion_min) VALUES (?,?,?,?,?,?,?,?,?)',
      [r.nodo_id, r.nombre, r.tipo, r.region, r.capacidad_almacen_kg, r.permite_espera_nocturna, r.activo, r.fuente_dato ?? 'SINTETICO', r.manipulacion_min ?? 30]);
    for (const r of d.Destinos) repo.run(`INSERT INTO destino(destino_id,cliente_id,nombre_ficticio,region,codigo_territorial,catalogo_territorial,version_catalogo,latitud,longitud,precision_geografica,nodo_id,acepta_anticipadas,vida_util_min_dias,activo)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [r.destino_id, r.cliente_id, r.nombre_ficticio, r.region, r.codigo_territorial, r.catalogo_territorial, r.version_catalogo, r.latitud, r.longitud, r.precision_geografica, r.nodo_id, r.acepta_anticipadas, r.vida_util_min_dias, r.activo]);
    for (const r of d.LimitesTerritoriales ?? []) repo.run('INSERT INTO limite_region VALUES (?,?,?,?,?,?)', [r.region, r.lat_min, r.lat_max, r.lon_min, r.lon_max, r.fuente]);
    const h2m = (h: unknown) => Math.round(Number(h) * 60);
    for (const r of d.ModosTransporte ?? []) repo.run('INSERT INTO modo_transporte VALUES (?,?,?,?)', [r.modo_id, r.nombre, r.activo, r.requiere_habilitacion]);
    for (const r of d.Recursos ?? []) repo.run('INSERT INTO recurso VALUES (?,?,?,?,?,?,?,?)', [r.recurso_id, r.nombre, r.modo_id, r.operador, r.capacidad_kg, Math.round(Number(r.capacidad_m3)), r.max_bulto_kg, r.activo]);
    for (const r of d.EnlacesMultimodales ?? []) repo.run('INSERT INTO enlace VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [r.enlace_id, r.nodo_origen_id, r.nodo_destino_id, r.modo_id, r.distancia_km,
      h2m(r.duracion_h), h2m(r.min_h), h2m(r.moda_h), h2m(r.max_h), Math.round(Number(r.prob_incidencia) * 1e6), h2m(r.retraso_incidencia_h), r.corredor_id, r.max_kg_recurso, r.estado_acceso, r.fuente_dato, r.activo]);
    for (const r of d.ServiciosTransporte ?? []) repo.run('INSERT INTO servicio VALUES (?,?,?,?,?,?,?,?,NULL,NULL)', [r.servicio_id, r.enlace_id, r.recurso_id, r.salida, r.llegada, Math.round(Number(r.tarifa_fija) / 100), Math.round(Number(r.costo_por_kg)), r.estado]);
    for (const r of d.HistPedidos ?? []) repo.run('INSERT INTO hist_pedido VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [r.pedido_id, r.cliente_id, r.destino_id, r.region, r.remoto, r.fecha_pedido, r.registrado_en, r.compromiso_inicio, r.compromiso_fin, r.prioridad, r.tipo_demanda, r.cancelado_en ?? null, r.motivo_cancelacion ?? null, r.origen_nodo ?? null, r.modo_final ?? null, r.tramos ?? null]);
    for (const r of d.HistLineas ?? []) repo.run('INSERT INTO hist_linea VALUES (?,?,?,?,?,?,?)', [r.pedido_id, r.linea, r.producto_id, r.solicitado, r.comprometido, r.no_atendido, r.motivo_no_atendido ?? null]);
    for (const r of d.HistEntregas ?? []) repo.run('INSERT INTO hist_entrega VALUES (?,?,?,?,?,?,?,?,?,?)', [r.entrega_id, r.pedido_id, r.intento, r.ocurrido_en, r.registrado_en, r.estado, r.motivo ?? null, r.linea ?? null, r.aceptado ?? 0, r.rechazado ?? 0]);
    for (const r of d.HistEtapas ?? []) repo.run('INSERT INTO hist_etapa VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [r.etapa_id, r.pedido_id, r.tramo, r.modo_id, r.nodo_origen_id, r.nodo_destino_id, r.servicio_ref, r.salida_plan, r.salida_real, r.llegada_plan, r.llegada_real, r.kg, r.capacidad_kg, r.conexion_perdida, r.costo_estimado_cent, r.costo_real_cent ?? null, r.motivo_retraso ?? null]);
    for (const r of d.HistDevoluciones ?? []) repo.run('INSERT INTO hist_devolucion VALUES (?,?,?,?,?,?)', [r.pedido_id, r.linea, r.cantidad, r.ocurrido_en, r.registrado_en, r.motivo ?? null]);
    for (const r of d.HistSinDatos ?? []) repo.run('INSERT INTO hist_sin_datos VALUES (?,?,?)', [r.region, r.semana_inicio, r.motivo]);
    for (const r of d.Transbordos ?? []) repo.run('INSERT INTO regla_transbordo VALUES (?,?,?,?,?,?,?,?)', [r.regla_transbordo_id, r.nodo_id, r.modo_entrada_id, r.modo_salida_id, Math.round(Number(r.duracion_h) * 60), Math.round(Number(r.costo_fijo) / 100), r.costo_por_kg, r.fraccionamiento_permitido]);
    for (const r of d.ActivosRetornables ?? []) repo.run("INSERT INTO activo_retornable VALUES (?,?,?,?,?,?,'NODO',?,?)", [r.activo_id, r.tipo, r.propietario, r.tara_kg, Math.round(Number(r.volumen_m3) / 1000), r.condicion, r.nodo_id, repo.reloj()]);
    for (const r of d.HistRetornables ?? []) {
      repo.run("INSERT INTO movimiento_activo VALUES (?,?,?,?,?,?,NULL,?,?,'HISTORIA',?,?,'CARGA')", [`MAC-H-${r.activo_id}-${r.ocurrido_en}`, r.activo_id, r.tipo_movimiento, r.desde, r.hacia, r.pedido_ref ?? null, r.condicion, r.documento ?? null, r.ocurrido_en, r.registrado_en]);
      if (r.tipo_movimiento === 'ENTREGA') repo.run("UPDATE activo_retornable SET ubicacion_tipo = 'CLIENTE', ubicacion_id = ?, actualizado_en = ? WHERE activo_id = ?", [r.hacia, r.ocurrido_en, r.activo_id]);
      if (r.tipo_movimiento === 'RETORNO_RECIBIDO') repo.run("UPDATE activo_retornable SET ubicacion_tipo = 'NODO', ubicacion_id = ?, condicion = ?, actualizado_en = ? WHERE activo_id = ?", [r.hacia, r.condicion, r.ocurrido_en, r.activo_id]);
    }
    for (const r of d.Compatibilidades ?? []) repo.run('INSERT INTO compatibilidad VALUES (?,?,?,?)', [r.producto_id, r.modo_id, r.permitido, r.motivo]);
    for (const r of d.Lotes) repo.run('INSERT INTO lote VALUES (?,?,?,?,?,?)', [r.lote_id, r.producto_id, r.codigo_lote, r.fecha_fabricacion, r.fecha_vencimiento, r.estado_lote]);
    for (const r of d.HistConteos ?? []) repo.run('INSERT INTO conteo VALUES (?,?,?,?,?,?,?,?,?,?,NULL,?,?,?)', [r.conteo_id, r.nodo_id, r.lote_id, r.condicion, r.corte, r.contado, r.sistema, Number(r.contado) - Number(r.sistema), r.estado, r.recuento_de ?? null, r.registrado_por, r.corte, r.resolucion ?? null]);
    if (d.ParametrosSimulacion?.length) repo.run("INSERT INTO modelo_simulacion VALUES ('MOD-BASE',1,'Modelo base NutriDemo',?,NULL,?,?,'Cargado desde ParametrosSimulacion')", [JSON.stringify(parametrosDesdeFilas(d.ParametrosSimulacion as { parametro: string; valor: number }[])), t, usuario]);
    for (const r of d.SupuestosEconomicos ?? []) repo.run('INSERT INTO supuesto_economico VALUES (?,?,?,?,?)', [r.clave, r.valor ?? null, r.unidad, r.descripcion, r.fuente]);
    for (const r of d.EscenariosDemanda ?? []) repo.run('INSERT INTO escenario_demanda VALUES (?,?,?,?,?,?,?,?,?)', [r.escenario_id, r.nombre, r.producto_id ?? null, r.desde, r.hasta, r.aumento_pct, r.fuente, t, usuario]);
    const cmd = 'CARGA-' + info.hash.slice(0, 12);
    for (const r of d.MovimientosIniciales) repo.run('INSERT INTO movimiento VALUES (?,?,NULL,?,?,?,?,?,?,NULL,?,?,?)',
      [r.movimiento_id, r.lote_id, r.nodo_id, r.condicion, r.cantidad_base, r.fecha + 'T00:00:00-05:00', t, 'SALDO_APERTURA', 'Saldo de apertura importado', usuario, cmd]);
    for (const r of d.ReceptoresAutorizados ?? []) repo.run('INSERT INTO receptor_autorizado VALUES (?,?,?,?,?,NULL)', [r.receptor_id, r.destino_id, r.nombre_ficticio, r.vigente_desde, r.vigente_hasta]);
    for (const r of d.CondicionesAcceso ?? []) repo.run('INSERT INTO condicion_acceso VALUES (?,?,?,?,?,?,?,?,NULL)', [r.condicion_id, r.enlace_id, r.estado, r.motivo, r.vigente_desde, r.vigente_hasta, r.registrado_en, r.fuente]);
    for (const r of d.SuministrosEsperados ?? []) repo.run('INSERT INTO suministro_esperado VALUES (?,?,?,?,?,?,?,NULL,1,?)', [r.suministro_id, r.producto_id, r.lote_id, r.nodo_destino_id, r.cantidad_base, r.fecha_prevista, r.estado, t]);
    for (const r of d.Pedidos) {
      if (r.responsable_id && !repo.uno('SELECT 1 FROM usuario WHERE usuario_id = ?', [r.responsable_id])) throw new Error(`Pedidos fila ${r.__fila}: el responsable ${r.responsable_id} no existe. No se confirmó nada.`);
      repo.run(`INSERT INTO pedido(pedido_id,cliente_id,destino_id,fecha_pedido,ventana_inicio,ventana_fin,prioridad,permite_parcial,permite_entregas_divididas,estado_base,confirmado_en,responsable_id,snapshot_destino) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [r.pedido_id, r.cliente_id, r.destino_id, r.fecha_pedido, r.ventana_inicio, r.ventana_fin, r.prioridad, r.permite_parcial, r.permite_entregas_divididas, r.estado,
          r.estado === 'CONFIRMADO' ? t : null, r.responsable_id, r.estado === 'CONFIRMADO' ? JSON.stringify(d.Destinos.find((x) => x.destino_id === r.destino_id)) : null]);
    }
    const conv = new Map(d.Conversiones.map((c) => [String(c.presentacion_id), c]));
    const prods = new Map(d.Productos.map((p) => [String(p.producto_id), p]));
    for (const r of d.PedidoDetalle) {
      const f = Number(conv.get(String(r.presentacion_id))!.unidades_base_por_presentacion);
      const q = Number((BigInt(Number(r.cantidad_presentacion)) * BigInt(f)) / 1000n);
      const imp = Math.round((q * Number(r.precio_neto_base)) / 1e5);
      repo.run('INSERT INTO pedido_linea VALUES (?,?,?,?,?,?,?,?,?,0,?)', [r.pedido_linea_id, r.pedido_id, r.producto_id, r.presentacion_id, r.cantidad_presentacion, f, q, r.precio_neto_base, imp, prods.get(String(r.producto_id))!.nombre_generico]);
    }
    asegurarParametros(repo);
    verificarInvariantes(repo);
    const cargaId = nuevoId('CARGA');
    repo.run('INSERT INTO carga VALUES (?,?,?,?,?,?,?,?)', [cargaId, info.hash, info.nombre, info.bytes, t, 'CONFIRMADA', info.datasetId, usuario]);
    for (const [k, v] of [['dataset_id', info.datasetId], ['dataset_hash', info.hash], ['dataset_nombre', info.nombre]])
      repo.run('INSERT INTO meta(clave, valor) VALUES (?,?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor', [k, v]);
    repo.auditar(a, 'CARGA_CONFIRMADA', cargaId, { hash: info.hash, nombre: info.nombre, filas: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.length])) });
    return cargaId;
  });
}
