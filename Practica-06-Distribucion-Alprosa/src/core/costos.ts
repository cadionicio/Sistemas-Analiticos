// I04-b: cargos reales de transporte, tarifas con mínimo y recargo de espera, imputación determinista y costo estimado vs real (AZ01–AZ08, H07, V08, DEC-I01-D8).
import type { Repo } from './db';
import { exigir } from './permisos';
import { nuevoId } from './util';

/** Reparte un importe entero en centavos por pesos, con resto determinista: mayor fracción y luego ID estable (AZ04: S/0,01 entre tres suma S/0,01). */
export function repartirCentavos(total: number, pesos: { id: string; peso: number }[]) {
  const suma = pesos.reduce((a, p) => a + p.peso, 0);
  if (!suma) return pesos.map((p) => ({ id: p.id, cent: 0 }));
  const base = pesos.map((p) => { const x = (total * p.peso) / suma; return { id: p.id, cent: Math.floor(x), resto: x - Math.floor(x) }; });
  let falta = total - base.reduce((a, b) => a + b.cent, 0);
  for (const b of [...base].sort((x, y) => y.resto - x.resto || x.id.localeCompare(y.id))) { if (!falta) break; b.cent++; falta--; }
  return base.map(({ id, cent }) => ({ id, cent }));
}

/** Tarifa contractual: el flete es el MAYOR entre el mínimo y la tasa variable (no se suman), más el fijo; la espera se cobra por hora o fracción solo DESPUÉS de la franquicia (igualdad = sin recargo) (AZ01, AZ02). */
export function calcularTarifa(t: { fijo_cent: number; tasa_kg_p4: number; minimo_cent?: number; franquicia_espera_min?: number; recargo_hora_cent?: number }, kg_mil: number, espera_min = 0) {
  const variable = Math.round((kg_mil / 1000) * t.tasa_kg_p4 / 100);
  const flete = Math.max(t.minimo_cent ?? 0, variable);
  const exceso = Math.max(0, espera_min - (t.franquicia_espera_min ?? 0));
  const horas = exceso > 0 ? Math.ceil(exceso / 60) : 0;
  const espera = horas * (t.recargo_hora_cent ?? 0);
  return { fijo_cent: t.fijo_cent, variable_cent: variable, minimo_cent: t.minimo_cent ?? 0, flete_cent: flete, aplica_minimo: flete > variable, horas_espera_cobradas: horas, espera_cent: espera, total_cent: t.fijo_cent + flete + espera,
    regla: 'Flete = máx(mínimo, kg × tasa); espera cobrada por hora o fracción iniciada después de la franquicia; en la frontera no se cobra.' };
}

/** Registra un cargo real con identidad de documento: el mismo comprobante y concepto no se cargan dos veces aunque llegue en otro archivo (AZ08); un concepto incluido en la tarifa integral no se suma (AZ05). */
export function registrarCargo(repo: Repo, usuario: string, c: { documento_ref: string; concepto: string; servicio_id: string; importe_cent: number; moneda?: string; tasa_pen_p6?: number; incluido_en_tarifa?: boolean; no_reembolsable?: boolean; ocurrido_en?: string; archivo_hash?: string }) {
  return repo.transaccion(() => {
    exigir(repo, usuario, 'PLANIFICAR');
    if (!c.documento_ref?.trim()) throw new Error('Indique el número del comprobante o documento del cargo.');
    if (!Number.isSafeInteger(c.importe_cent) || c.importe_cent < 0) throw new Error('Importe inválido.');
    if (!repo.uno('SELECT 1 FROM servicio WHERE servicio_id = ?', [c.servicio_id])) throw new Error('Salida inexistente.');
    const dup = repo.uno('SELECT cargo_id, archivo_hash FROM cargo_transporte WHERE documento_ref = ? AND concepto = ? AND servicio_id = ?', [c.documento_ref.trim(), c.concepto, c.servicio_id]);
    if (dup) throw new Error(`El cargo ${c.documento_ref} (${c.concepto}) ya está registrado (${dup.cargo_id}); no se duplica el gasto aunque venga en otro archivo.`);
    const moneda = c.moneda ?? 'PEN';
    if (moneda !== 'PEN' && !c.tasa_pen_p6) throw new Error('Un cargo en moneda extranjera necesita su tipo de cambio a soles, con fecha y fuente; no se consulta en internet.');
    const tasa = moneda === 'PEN' ? 1000000 : c.tasa_pen_p6!;
    const pen = Math.round((c.importe_cent * tasa) / 1000000), t = repo.reloj(), id = nuevoId('CAR');
    repo.run('INSERT INTO cargo_transporte VALUES (?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,?)', [id, c.documento_ref.trim(), c.concepto, c.servicio_id, c.importe_cent, moneda, tasa, pen,
      c.incluido_en_tarifa ? 1 : 0, c.no_reembolsable ? 1 : 0, c.ocurrido_en || t, t, c.archivo_hash ?? null, usuario]);
    return { cargo_id: id, importe_pen_cent: pen, suma_al_costo: !c.incluido_en_tarifa };
  });
}

/** Costo de una salida: estimado (tarifa planificada) y real (cargos devengados, incluidos los no reembolsables de una salida cancelada, AZ03), con variación por concepto (AZ07, H07). */
export function costoServicio(repo: Repo, servicioId: string) {
  const s = repo.uno('SELECT * FROM servicio WHERE servicio_id = ?', [servicioId])!;
  const etapas = repo.todos("SELECT etapa_id, kg_bruto_mil FROM etapa WHERE servicio_id = ? AND estado <> 'CANCELADA' ORDER BY etapa_id", [servicioId]);
  const kg = etapas.reduce((a, e) => a + Number(e.kg_bruto_mil), 0);
  const estimado = Number(s.tarifa_fija_cent) + Math.round((kg / 1000) * Number(s.costo_kg_p4) / 100);
  const cargos = repo.todos('SELECT concepto, SUM(importe_pen_cent) c, SUM(CASE WHEN incluido_en_tarifa = 1 THEN importe_pen_cent ELSE 0 END) inc FROM cargo_transporte WHERE servicio_id = ? GROUP BY 1 ORDER BY 1', [servicioId]);
  const real = cargos.reduce((a, c) => a + Number(c.c) - Number(c.inc), 0);
  return { servicio_id: servicioId, estado: String(s.estado), kg_mil: kg, estimado_cent: estimado, real_cent: cargos.length ? real : null, variacion_cent: cargos.length ? real - estimado : null,
    por_concepto: cargos.map((c) => ({ concepto: String(c.concepto), real_cent: Number(c.c) - Number(c.inc), incluido_en_tarifa_cent: Number(c.inc) })),
    imputacion: repartirCentavos(cargos.length ? real : estimado, etapas.map((e) => ({ id: String(e.etapa_id), peso: Number(e.kg_bruto_mil) }))) };
}

/** Costo logístico de un pedido = suma de lo imputado a sus etapas (real si existe, si no estimado) + transbordos estimados; costo por kg aceptado (DEC-I01-D8). */
export function costoPedido(repo: Repo, pedidoId: string) {
  const servicios = repo.todos("SELECT DISTINCT e.servicio_id FROM etapa e JOIN itinerario i USING (itinerario_id) WHERE i.pedido_id = ? AND e.estado <> 'CANCELADA'", [pedidoId]).map((x) => String(x.servicio_id));
  const misEtapas = new Set(repo.todos('SELECT e.etapa_id FROM etapa e JOIN itinerario i USING (itinerario_id) WHERE i.pedido_id = ?', [pedidoId]).map((x) => String(x.etapa_id)));
  let real = 0, estimado = 0, conReal = 0;
  for (const sid of servicios) {
    const c = costoServicio(repo, sid);
    const peso = repartirCentavos(c.estimado_cent, repo.todos("SELECT etapa_id, kg_bruto_mil FROM etapa WHERE servicio_id = ? AND estado <> 'CANCELADA'", [sid]).map((e) => ({ id: String(e.etapa_id), peso: Number(e.kg_bruto_mil) })));
    estimado += peso.filter((x) => misEtapas.has(x.id)).reduce((a, x) => a + x.cent, 0);
    if (c.real_cent !== null) { conReal++; real += c.imputacion.filter((x) => misEtapas.has(x.id)).reduce((a, x) => a + x.cent, 0); }
    else real += peso.filter((x) => misEtapas.has(x.id)).reduce((a, x) => a + x.cent, 0);
  }
  const aceptado = repo.num('SELECT COALESCE(SUM(d.aceptado_mil),0) FROM entrega_detalle d JOIN entrega e USING (entrega_id) WHERE e.pedido_id = ?', [pedidoId]);
  return { pedido_id: pedidoId, estimado_cent: estimado, devengado_cent: real, salidas: servicios.length, salidas_con_cargo_real: conReal,
    costo_por_kg_aceptado_cent: aceptado ? Math.round(real / (aceptado / 1000)) : null, base: conReal === servicios.length ? 'real' : conReal ? 'mixta (real + estimado)' : 'estimada' };
}
