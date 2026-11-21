// Adaptador de entrada: Excel 06 · contrato C06-1.0
// Lee por nombre de hoja y de encabezado. Valida todo antes de cargar (todo o nada).
import { textoLocalAIso, textoFechaValida, serialExcelAIso, serialExcelAFecha, ahoraIso } from '../nucleo/fechas.js';
import { sha256Hex } from '../nucleo/sha256.js';
import { transaccion, ejecutar } from '../nucleo/bd.js';
import { TABLAS_DATOS } from '../nucleo/esquema.js';

export const CONTRATO = 'C06-1.0';
const TRAMOS = ['ESPERA_ATENCION', 'DIAGNOSTICO', 'ESPERA_REPUESTO', 'REPARACION', 'VERIFICACION', 'SIN_CLASIFICAR'];

// Tipos: cod (código texto), txt, fh (fecha y hora), f (fecha), ent (entero >= 0), ent1 (entero > 0), dec (decimal >= 0), num (número)
// Sufijo '?' = opcional. enum: valores permitidos. ref: hoja referida.
const H = {
  Equipos: { pk: 'codigo_equipo', cols: { codigo_equipo: 'cod', nombre: 'txt', tipo_equipo: 'txt', area: 'txt', criticidad: { t: 'txt', enum: ['ALTA', 'MEDIA', 'BAJA'] }, horas_plan_dia: 'dec' } },
  Piezas: { pk: 'codigo_pieza', cols: { codigo_pieza: 'cod', nombre: 'txt', unidad: 'txt', costo_unitario_soles: 'dec', plazo_normal_dias: 'ent', plazo_urgente_horas: 'ent', stock_minimo: 'ent', codigo_equipo: { t: 'cod', ref: 'Equipos' } } },
  Modos_Falla: { pk: 'codigo_modo', cols: { codigo_modo: 'cod', nombre: 'txt', tipo_equipo: 'txt' } },
  Horas_Operacion: { cols: { codigo_equipo: { t: 'cod', ref: 'Equipos' }, fecha: 'f', horas_efectivas: 'dec' } },
  Paradas: { pk: 'codigo_parada', cols: { codigo_parada: 'cod', codigo_equipo: { t: 'cod', ref: 'Equipos' }, inicio: 'fh', fin: 'fh', registro: 'fh', sintoma: 'txt', codigo_modo: { t: 'cod?', ref: 'Modos_Falla' }, estado_causa: { t: 'txt', enum: ['PENDIENTE', 'HIPOTESIS', 'CONFIRMADA'] }, causa: 'txt?', evidencia_causa: 'txt?', reportado_por: 'txt', verificado_por: 'txt?', reincidencia_de: { t: 'cod?', ref: 'Paradas' }, estado_reincidencia: { t: 'txt?', enum: ['', 'PENDIENTE', 'CONFIRMADA', 'DESCARTADA'] } } },
  Tramos: { cols: { codigo_parada: { t: 'cod', ref: 'Paradas' }, secuencia: 'ent1', tipo_tramo: { t: 'txt', enum: TRAMOS }, inicio: 'fh', fin: 'fh', evidencia: 'txt?' } },
  Verificaciones: { pk: 'codigo_verificacion', cols: { codigo_verificacion: 'cod', codigo_parada: { t: 'cod', ref: 'Paradas' }, fecha_hora: 'fh', resultado: { t: 'txt', enum: ['APTO', 'NO_APTO'] }, verificado_por: 'txt', observacion: 'txt?' } },
  Ordenes: { pk: 'codigo_orden', cols: { codigo_orden: 'cod', tipo_orden: { t: 'txt', enum: ['CORRECTIVA', 'PREVENTIVA'] }, codigo_equipo: { t: 'cod', ref: 'Equipos' }, codigo_parada: { t: 'cod?', ref: 'Paradas' }, codigo_tarea: { t: 'cod?', ref: 'Tareas_Preventivas' }, apertura: 'fh', cierre: 'fh?', estado: { t: 'txt', enum: ['ABIERTA', 'CERRADA', 'ANULADA'] }, responsable: 'txt', descripcion: 'txt' } },
  Intervenciones: { pk: 'codigo_intervencion', cols: { codigo_intervencion: 'cod', codigo_orden: { t: 'cod', ref: 'Ordenes' }, inicio: 'fh', fin: 'fh?', tecnico: 'txt', descripcion: 'txt', requirio_pieza: { t: 'txt', enum: ['SI', 'NO'] }, codigo_pieza: { t: 'cod?', ref: 'Piezas' } } },
  Consumos: { pk: 'codigo_consumo', cols: { codigo_consumo: 'cod', codigo_orden: { t: 'cod', ref: 'Ordenes' }, codigo_pieza: { t: 'cod', ref: 'Piezas' }, cantidad: 'ent1', fecha_efectiva: 'fh', fecha_registro: 'fh', responsable: 'txt' } },
  Movimientos: { pk: 'codigo_movimiento', cols: { codigo_movimiento: 'cod', codigo_pieza: { t: 'cod', ref: 'Piezas' }, tipo_movimiento: { t: 'txt', enum: ['SALDO_INICIAL', 'INGRESO', 'AJUSTE_POSITIVO', 'AJUSTE_NEGATIVO'] }, cantidad: 'ent', fecha_efectiva: 'fh', fecha_registro: 'fh', codigo_orden: { t: 'cod?', ref: 'Ordenes' }, referencia: 'txt?', responsable: 'txt', motivo: 'txt?' } },
  Reservas: { pk: 'codigo_reserva', cols: { codigo_reserva: 'cod', codigo_orden: { t: 'cod', ref: 'Ordenes' }, codigo_pieza: { t: 'cod', ref: 'Piezas' }, cantidad: 'ent1', fecha: 'fh', estado: { t: 'txt', enum: ['VIGENTE'] } } },
  Tareas_Preventivas: { pk: 'codigo_tarea', cols: { codigo_tarea: 'cod', codigo_equipo: { t: 'cod', ref: 'Equipos' }, codigo_modo: { t: 'cod', ref: 'Modos_Falla' }, descripcion: 'txt', frecuencia_dias: 'ent1', justificacion: 'txt', responsable: 'txt', critica: { t: 'txt', enum: ['SI', 'NO'] }, criterio_aceptacion: 'txt', primer_vencimiento: 'f' } },
  Ejecuciones_Preventivas: { pk: 'codigo_ejecucion', cols: { codigo_ejecucion: 'cod', codigo_tarea: { t: 'cod', ref: 'Tareas_Preventivas' }, codigo_orden: { t: 'cod?', ref: 'Ordenes' }, fecha_vencimiento: 'f', fecha_ejecucion: 'fh?', resultado: { t: 'txt', enum: ['CONFORME', 'NO_CONFORME', 'PENDIENTE'] }, evidencia: 'txt?' } },
  Mant_Programado: { pk: 'codigo_periodo', cols: { codigo_periodo: 'cod', codigo_equipo: { t: 'cod', ref: 'Equipos' }, inicio: 'fh', fin: 'fh', codigo_orden: { t: 'cod?', ref: 'Ordenes' }, descripcion: 'txt' } },
  Acciones: { pk: 'codigo_accion', cols: { codigo_accion: 'cod', problema: 'txt', accion: 'txt', tipo_accion: { t: 'txt', enum: ['TECNICA', 'ALMACEN'] }, responsable: 'txt', fecha: 'f', objetivo: 'txt', indicador: 'txt', revision_desde: 'f', revision_hasta: 'f', resultado: 'txt?', codigo_parada: { t: 'cod?', ref: 'Paradas' }, codigo_pieza: { t: 'cod?', ref: 'Piezas' }, codigo_modo: { t: 'cod?', ref: 'Modos_Falla' } } },
  Parametros: { pk: 'clave', cols: { clave: 'cod', valor: 'num', unidad: 'txt', descripcion: 'txt' } },
};
export const HOJAS = Object.keys(H);
const PARAM_REQ = ['ventana_reincidencia_dias', 'costo_hora_parada_soles', 'costo_posesion_anual_pct', 'recargo_urgencia_pct', 'horas_plan_dia', 'semilla_defecto', 'repeticiones_defecto', 'horizonte_defecto_dias'];
const LEEME_REQ = ['Empresa', 'Rotulo', 'Version_contrato', 'Periodo_desde', 'Periodo_hasta', 'Zona_horaria', 'Formato_fecha', 'Unidades'];

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const letra = c => globalThis.XLSX.utils.encode_col(c);

export function leerLibro(bytes, nombreArchivo) {
  const X = globalThis.XLSX;
  const errores = [];
  const err = (hoja, fila, columna, motivo) => { if (errores.length < 1000) errores.push({ hoja, fila, columna, motivo }); };
  const sha256 = sha256Hex(bytes);
  let wb;
  try { wb = X.read(bytes, { type: 'array', cellDates: false, cellNF: false, cellText: false }); }
  catch (e) { return { errores: [{ hoja: '—', fila: '—', columna: '—', motivo: 'El archivo no es un libro de Excel legible (' + e.message + ')' }], sha256, nombreArchivo, conteos: {}, datos: {} }; }
  const porNombre = {};
  wb.SheetNames.forEach(n => { porNombre[norm(n)] = n; });

  // LEEME
  const meta = {};
  const leeme = porNombre[norm('LEEME')];
  let conteosEsperados = null;
  if (!leeme) err('LEEME', '—', '—', 'Falta la hoja LEEME');
  else {
    const ws = wb.Sheets[leeme];
    const rg = X.utils.decode_range(ws['!ref'] || 'A1:A1');
    // Bloques: clave/valor, «Unidades por columna» y «Conteos esperados» (cada tabla con su fila de encabezados)
    let modo = 'meta', filaTitulo = -1, hayTablaUnidades = false, filasUnidades = 0;
    for (let r = rg.s.r; r <= rg.e.r; r++) {
      const a = ws[X.utils.encode_cell({ r, c: 0 })], b = ws[X.utils.encode_cell({ r, c: 1 })];
      const ka = a ? String(a.v).trim() : '';
      if (ka === 'Unidades por columna') { modo = 'unidades'; filaTitulo = r; hayTablaUnidades = true; continue; }
      if (ka === 'Conteos esperados') { modo = 'conteos'; filaTitulo = r; conteosEsperados = {}; continue; }
      if (!ka || r === filaTitulo + 1 && modo !== 'meta') continue;
      if (modo === 'unidades') filasUnidades++;
      else if (modo === 'conteos' && b) conteosEsperados[ka] = Number(b.v);
      else if (modo === 'meta' && ka !== 'Clave') meta[ka] = b ? String(b.v).trim() : '';
    }
    LEEME_REQ.forEach(k => { if (!meta[k]) err('LEEME', '—', 'A', `Falta la clave «${k}» o su valor`); });
    if (meta.Version_contrato && meta.Version_contrato !== CONTRATO) err('LEEME', '—', 'B', `Versión de contrato «${meta.Version_contrato}»; se esperaba «${CONTRATO}»`);
    if (!hayTablaUnidades || filasUnidades === 0) err('LEEME', '—', 'A', 'Falta la tabla «Unidades por columna» o está vacía');
    ['Periodo_desde', 'Periodo_hasta'].forEach(k => { if (meta[k] && !textoFechaValida(meta[k])) err('LEEME', '—', 'B', `«${k}» debe tener formato AAAA-MM-DD`); });
    if (meta.Periodo_desde && meta.Periodo_hasta && meta.Periodo_desde > meta.Periodo_hasta) err('LEEME', '—', 'B', 'Periodo_desde es posterior a Periodo_hasta');
  }

  // Hojas de datos
  const datos = {};
  for (const hoja of HOJAS) {
    const spec = H[hoja];
    const real = porNombre[norm(hoja)];
    datos[hoja] = [];
    if (!real) { err(hoja, '—', '—', 'Falta la hoja'); continue; }
    const ws = wb.Sheets[real];
    const rg = X.utils.decode_range(ws['!ref'] || 'A1:A1');
    const idx = {};
    for (let c = rg.s.c; c <= rg.e.c; c++) {
      const cel = ws[X.utils.encode_cell({ r: rg.s.r, c })];
      if (cel) idx[norm(cel.v)] = c;
    }
    const faltan = Object.keys(spec.cols).filter(k => idx[norm(k)] === undefined);
    if (faltan.length) { faltan.forEach(k => err(hoja, rg.s.r + 1, '—', `Falta la columna «${k}»`)); continue; }
    for (let r = rg.s.r + 1; r <= rg.e.r; r++) {
      const fila = r + 1;
      const obj = { _fila: fila };
      let vacia = true;
      for (const [col, def] of Object.entries(spec.cols)) {
        const d = typeof def === 'string' ? { t: def } : def;
        const c = idx[norm(col)];
        const cel = ws[X.utils.encode_cell({ r, c })];
        const ref = `${letra(c)} (${col})`;
        const opcional = d.t.endsWith('?');
        const t = d.t.replace('?', '');
        const vacio = !cel || cel.v === null || cel.v === undefined || String(cel.v).trim() === '';
        if (!vacio) vacia = false;
        if (vacio) {
          if (!opcional) obj._faltan = (obj._faltan || []).concat([[ref, 'Valor obligatorio vacío']]);
          obj[col] = t === 'txt' ? '' : null;
          continue;
        }
        let v = cel.v;
        switch (t) {
          case 'cod':
            if (cel.t !== 's') { err(hoja, fila, ref, `El código debe ser texto (se leyó el número ${v}); use formato texto para conservar ceros iniciales`); v = null; }
            else v = String(v).trim();
            break;
          case 'txt': v = String(v).trim(); break;
          case 'fh': {
            const iso = cel.t === 'n' ? serialExcelAIso(v) : textoLocalAIso(v);
            if (!iso) { err(hoja, fila, ref, `Fecha y hora inválida «${v}»; use AAAA-MM-DD HH:MM`); v = null; } else v = iso;
            break;
          }
          case 'f': {
            const fe = cel.t === 'n' ? serialExcelAFecha(v) : textoFechaValida(v);
            if (!fe) { err(hoja, fila, ref, `Fecha inválida «${v}»; use AAAA-MM-DD`); v = null; } else v = fe;
            break;
          }
          case 'ent': case 'ent1': {
            const n = typeof v === 'number' ? v : Number(String(v).trim());
            if (!Number.isInteger(n) || n < (t === 'ent1' ? 1 : 0)) { err(hoja, fila, ref, `Debe ser un entero ${t === 'ent1' ? 'mayor que 0' : 'mayor o igual que 0'} (se leyó «${v}»)`); v = null; } else v = n;
            break;
          }
          case 'dec': case 'num': {
            const n = typeof v === 'number' ? v : Number(String(v).trim());
            if (!Number.isFinite(n) || (t === 'dec' && n < 0)) { err(hoja, fila, ref, `Debe ser un número${t === 'dec' ? ' no negativo' : ''} (se leyó «${v}»)`); v = null; } else v = n;
            break;
          }
        }
        if (v !== null && d.enum && !d.enum.includes(v)) { err(hoja, fila, ref, `Valor «${v}» no permitido; use: ${d.enum.filter(Boolean).join(', ')}`); v = null; }
        obj[col] = v;
      }
      if (vacia) continue;
      (obj._faltan || []).forEach(([ref, m]) => err(hoja, fila, ref, m));
      delete obj._faltan;
      datos[hoja].push(obj);
    }
  }
  const conteos = Object.fromEntries(HOJAS.map(h => [h, datos[h].length]));
  if (!errores.length) validarRelaciones(datos, err);
  if (conteosEsperados) {
    HOJAS.forEach(h => {
      if (conteosEsperados[h] !== undefined && conteosEsperados[h] !== conteos[h]) err('LEEME', '—', 'Conteos esperados', `La hoja ${h} tiene ${conteos[h]} filas y LEEME declara ${conteosEsperados[h]}`);
    });
  }
  return { errores, meta, datos, conteos, conteosEsperados, sha256, nombreArchivo };
}

function validarRelaciones(D, err) {
  const col = (h, c) => { const cols = Object.keys(H[h].cols); const i = cols.indexOf(c); return `${letra(i)} (${c})`; };
  const idx = {};
  // Claves únicas
  for (const h of HOJAS) {
    const pk = H[h].pk;
    if (!pk) continue;
    idx[h] = new Map();
    D[h].forEach(o => {
      if (o[pk] === null) return;
      if (idx[h].has(o[pk])) err(h, o._fila, col(h, pk), `Código «${o[pk]}» repetido (también en la fila ${idx[h].get(o[pk])._fila})`);
      else idx[h].set(o[pk], o);
    });
  }
  const vistos = new Set();
  D.Horas_Operacion.forEach(o => {
    const k = o.codigo_equipo + '|' + o.fecha;
    if (vistos.has(k)) err('Horas_Operacion', o._fila, col('Horas_Operacion', 'fecha'), `Fecha ${o.fecha} repetida para ${o.codigo_equipo}`);
    vistos.add(k);
    if (o.horas_efectivas > 24) err('Horas_Operacion', o._fila, col('Horas_Operacion', 'horas_efectivas'), 'No puede superar 24 horas en un día');
  });
  // Referencias
  for (const h of HOJAS) {
    for (const [c, def] of Object.entries(H[h].cols)) {
      if (typeof def !== 'object' || !def.ref) continue;
      D[h].forEach(o => {
        if (o[c] && !idx[def.ref].has(o[c])) err(h, o._fila, col(h, c), `Referencia «${o[c]}» no existe en la hoja ${def.ref}`);
      });
    }
  }
  const tipos = new Set(D.Equipos.map(e => e.tipo_equipo));
  D.Modos_Falla.forEach(m => { if (!tipos.has(m.tipo_equipo)) err('Modos_Falla', m._fila, col('Modos_Falla', 'tipo_equipo'), `Tipo de equipo «${m.tipo_equipo}» no existe en Equipos`); });
  // Paradas
  const porEquipo = {};
  D.Paradas.forEach(p => {
    if (!p.inicio || !p.fin) return;
    if (p.fin <= p.inicio) err('Paradas', p._fila, col('Paradas', 'fin'), 'El fin debe ser posterior al inicio');
    if (p.registro && p.registro < p.inicio) err('Paradas', p._fila, col('Paradas', 'registro'), 'La hora de registro no puede ser anterior al hecho');
    if (p.reincidencia_de && !p.estado_reincidencia) err('Paradas', p._fila, col('Paradas', 'estado_reincidencia'), 'Indique PENDIENTE, CONFIRMADA o DESCARTADA');
    if (p.reincidencia_de === p.codigo_parada) err('Paradas', p._fila, col('Paradas', 'reincidencia_de'), 'Una parada no puede ser antecedente de sí misma');
    (porEquipo[p.codigo_equipo] ||= []).push(p);
  });
  Object.values(porEquipo).forEach(lista => {
    lista.sort((a, b) => a.inicio < b.inicio ? -1 : 1);
    for (let i = 1; i < lista.length; i++) {
      if (lista[i].inicio < lista[i - 1].fin) err('Paradas', lista[i]._fila, col('Paradas', 'inicio'), `Se superpone con ${lista[i - 1].codigo_parada}: un equipo solo puede tener una parada en un mismo instante`);
    }
  });
  // Tramos contiguos que cubren toda la parada
  const tramos = {};
  D.Tramos.forEach(t => { (tramos[t.codigo_parada] ||= []).push(t); if (t.inicio && t.fin && t.fin <= t.inicio) err('Tramos', t._fila, col('Tramos', 'fin'), 'El fin del tramo debe ser posterior a su inicio'); });
  D.Paradas.forEach(p => {
    const ts = (tramos[p.codigo_parada] || []).sort((a, b) => a.secuencia - b.secuencia);
    if (!ts.length) { err('Paradas', p._fila, col('Paradas', 'codigo_parada'), 'La parada no tiene tramos en la hoja Tramos'); return; }
    ts.forEach((t, i) => {
      if (t.secuencia !== i + 1) err('Tramos', t._fila, col('Tramos', 'secuencia'), `Secuencia ${t.secuencia}; se esperaba ${i + 1}`);
      const esperado = i === 0 ? p.inicio : ts[i - 1].fin;
      if (t.inicio !== esperado) err('Tramos', t._fila, col('Tramos', 'inicio'), i === 0 ? 'El primer tramo debe empezar con la parada' : 'Debe empezar donde termina el tramo anterior (sin huecos ni solapes)');
    });
    if (ts[ts.length - 1].fin !== p.fin) err('Tramos', ts[ts.length - 1]._fila, col('Tramos', 'fin'), 'El último tramo debe terminar con la parada');
  });
  // Verificaciones: dentro de la parada; el cierre exige verificación APTO
  const ver = {};
  D.Verificaciones.forEach(v => {
    const p = idx.Paradas.get(v.codigo_parada);
    if (p && (v.fecha_hora < p.inicio || v.fecha_hora > p.fin)) err('Verificaciones', v._fila, col('Verificaciones', 'fecha_hora'), 'Debe estar dentro de la parada');
    (ver[v.codigo_parada] ||= []).push(v);
  });
  D.Paradas.forEach(p => {
    const ok = (ver[p.codigo_parada] || []).some(v => v.resultado === 'APTO' && v.fecha_hora === p.fin);
    if (!ok) err('Paradas', p._fila, col('Paradas', 'fin'), 'La parada cerrada requiere una verificación APTO de Producción a la hora de fin');
  });
  // Órdenes
  D.Ordenes.forEach(o => {
    if (o.tipo_orden === 'CORRECTIVA' && !o.codigo_parada) err('Ordenes', o._fila, col('Ordenes', 'codigo_parada'), 'Una orden correctiva requiere la parada que atiende');
    const p = o.codigo_parada && idx.Paradas.get(o.codigo_parada);
    if (p && p.codigo_equipo !== o.codigo_equipo) err('Ordenes', o._fila, col('Ordenes', 'codigo_equipo'), `No coincide con el equipo de la parada (${p.codigo_equipo})`);
    if (o.estado === 'CERRADA' && !o.cierre) err('Ordenes', o._fila, col('Ordenes', 'cierre'), 'Una orden cerrada requiere hora de cierre');
    if (o.estado === 'ABIERTA' && o.cierre) err('Ordenes', o._fila, col('Ordenes', 'cierre'), 'Una orden abierta no lleva hora de cierre');
    if (o.cierre && o.apertura && o.cierre < o.apertura) err('Ordenes', o._fila, col('Ordenes', 'cierre'), 'El cierre no puede ser anterior a la apertura');
  });
  D.Intervenciones.forEach(i => {
    if (i.requirio_pieza === 'SI' && !i.codigo_pieza) err('Intervenciones', i._fila, col('Intervenciones', 'codigo_pieza'), 'Indique la pieza requerida');
    if (i.fin && i.inicio && i.fin <= i.inicio) err('Intervenciones', i._fila, col('Intervenciones', 'fin'), 'El fin debe ser posterior al inicio');
  });
  D.Consumos.forEach(c => {
    const o = idx.Ordenes.get(c.codigo_orden);
    if (o && o.estado === 'ANULADA') err('Consumos', c._fila, col('Consumos', 'codigo_orden'), 'No se puede consumir en una orden anulada');
  });
  // Movimientos: cantidad 0 solo para un saldo inicial conocido; un saldo inicial por pieza
  const conSaldo = new Set();
  D.Movimientos.forEach(m => {
    if (m.cantidad === 0 && m.tipo_movimiento !== 'SALDO_INICIAL') err('Movimientos', m._fila, col('Movimientos', 'cantidad'), 'Solo un SALDO_INICIAL puede tener cantidad 0');
    if (m.tipo_movimiento === 'SALDO_INICIAL') {
      if (conSaldo.has(m.codigo_pieza)) err('Movimientos', m._fila, col('Movimientos', 'tipo_movimiento'), `La pieza ${m.codigo_pieza} ya tiene saldo inicial`);
      conSaldo.add(m.codigo_pieza);
    }
  });
  // Existencias: nunca negativas en el tiempo (ingresos antes que salidas en el mismo instante)
  const ev = [];
  D.Movimientos.forEach(m => ev.push({ f: m.fecha_efectiva, p: m.codigo_pieza, d: m.tipo_movimiento === 'AJUSTE_NEGATIVO' ? -m.cantidad : m.cantidad, h: 'Movimientos', o: m, c: 'cantidad' }));
  D.Consumos.forEach(c => ev.push({ f: c.fecha_efectiva, p: c.codigo_pieza, d: -c.cantidad, h: 'Consumos', o: c, c: 'cantidad' }));
  ev.sort((a, b) => a.f < b.f ? -1 : a.f > b.f ? 1 : b.d - a.d);
  for (let i = ev.length - 1; i >= 0; i--) if (!idx.Piezas.has(ev[i].p)) ev.splice(i, 1); // referencia ya reportada
  const saldo = {};
  ev.forEach(e => {
    saldo[e.p] = (saldo[e.p] || 0) + e.d;
    if (saldo[e.p] < 0) { err(e.h, e.o._fila, col(e.h, e.c), `La existencia de ${e.p} quedaría en ${saldo[e.p]} el ${e.f.slice(0, 16).replace('T', ' ')}`); saldo[e.p] = 0; }
  });
  const reservado = {};
  D.Reservas.forEach(r => {
    reservado[r.codigo_pieza] = (reservado[r.codigo_pieza] || 0) + r.cantidad;
    const o = idx.Ordenes.get(r.codigo_orden);
    if (o && o.estado !== 'ABIERTA') err('Reservas', r._fila, col('Reservas', 'codigo_orden'), 'Solo se reserva para una orden abierta');
    if (reservado[r.codigo_pieza] > (saldo[r.codigo_pieza] || 0)) err('Reservas', r._fila, col('Reservas', 'cantidad'), `La reserva supera la existencia física de ${r.codigo_pieza} (${saldo[r.codigo_pieza] || 0})`);
  });
  D.Mant_Programado.forEach(m => {
    if (m.fin <= m.inicio) err('Mant_Programado', m._fila, col('Mant_Programado', 'fin'), 'El fin debe ser posterior al inicio');
    (porEquipo[m.codigo_equipo] || []).forEach(p => {
      if (m.inicio < p.fin && p.inicio < m.fin) err('Mant_Programado', m._fila, col('Mant_Programado', 'inicio'), `Se superpone con la parada ${p.codigo_parada}`);
    });
  });
  D.Acciones.forEach(a => { if (a.revision_hasta < a.revision_desde) err('Acciones', a._fila, col('Acciones', 'revision_hasta'), 'Debe ser posterior a revision_desde'); });
  const claves = new Set(D.Parametros.map(p => p.clave));
  PARAM_REQ.forEach(k => { if (!claves.has(k)) err('Parametros', '—', col('Parametros', 'clave'), `Falta el parámetro «${k}»`); });
}

// Inserción transaccional: reemplaza todos los datos o no cambia nada.
export function aplicarCarga(lectura, origen, usuario) {
  const D = lectura.datos;
  const sn = v => (v === '' || v === undefined ? null : v);
  const cent = x => Math.round(x * 100);
  return transaccion(() => {
    TABLAS_DATOS.forEach(t => ejecutar(`DELETE FROM ${t}`));
    new Set(D.Equipos.map(e => e.tipo_equipo)).forEach(t => ejecutar('INSERT INTO tipo_equipo(codigo) VALUES (?)', [t]));
    D.Equipos.forEach(e => ejecutar('INSERT INTO equipo VALUES (?,?,?,?,?,?)', [e.codigo_equipo, e.nombre, e.tipo_equipo, e.area, e.criticidad, Math.round(e.horas_plan_dia * 60)]));
    D.Modos_Falla.forEach(m => ejecutar('INSERT INTO modo_falla VALUES (?,?,?)', [m.codigo_modo, m.nombre, m.tipo_equipo]));
    D.Piezas.forEach(p => ejecutar('INSERT INTO pieza VALUES (?,?,?,?,?,?,?,?)', [p.codigo_pieza, p.nombre, p.unidad, cent(p.costo_unitario_soles), p.plazo_normal_dias, p.plazo_urgente_horas, p.stock_minimo, p.codigo_equipo]));
    D.Horas_Operacion.forEach(h => ejecutar('INSERT INTO horas_operacion VALUES (?,?,?)', [h.codigo_equipo, h.fecha, Math.round(h.horas_efectivas * 60)]));
    D.Paradas.forEach(p => ejecutar(`INSERT INTO parada(codigo, equipo_codigo, inicio, fin, registro, sintoma, modo_codigo, estado_causa, causa, evidencia_causa, reportado_por, verificado_por, reincidencia_de, estado_reincidencia, estado)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'CERRADA')`, [p.codigo_parada, p.codigo_equipo, p.inicio, p.fin, p.registro, p.sintoma, sn(p.codigo_modo), p.estado_causa, p.causa || '', p.evidencia_causa || '', p.reportado_por, p.verificado_por || '', sn(p.reincidencia_de), p.estado_reincidencia || '']));
    D.Tramos.forEach(t => ejecutar('INSERT INTO tramo(parada_codigo, secuencia, tipo, inicio, fin, evidencia, autor, registro) VALUES (?,?,?,?,?,?,?,?)', [t.codigo_parada, t.secuencia, t.tipo_tramo, t.inicio, t.fin, t.evidencia || '', 'Carga Excel 06', t.fin]));
    D.Verificaciones.forEach(v => ejecutar('INSERT INTO verificacion VALUES (?,?,?,?,?,?)', [v.codigo_verificacion, v.codigo_parada, v.fecha_hora, v.resultado, v.verificado_por, v.observacion || '']));
    D.Tareas_Preventivas.forEach(t => ejecutar('INSERT INTO tarea_preventiva VALUES (?,?,?,?,?,?,?,?,?,?)', [t.codigo_tarea, t.codigo_equipo, t.codigo_modo, t.descripcion, t.frecuencia_dias, t.justificacion, t.responsable, t.critica === 'SI' ? 1 : 0, t.criterio_aceptacion, t.primer_vencimiento]));
    D.Ordenes.forEach(o => ejecutar('INSERT INTO orden(codigo, tipo, equipo_codigo, parada_codigo, tarea_codigo, apertura, cierre, estado, responsable, descripcion) VALUES (?,?,?,?,?,?,?,?,?,?)', [o.codigo_orden, o.tipo_orden, o.codigo_equipo, sn(o.codigo_parada), sn(o.codigo_tarea), o.apertura, sn(o.cierre), o.estado, o.responsable, o.descripcion]));
    D.Intervenciones.forEach(i => ejecutar('INSERT INTO intervencion VALUES (?,?,?,?,?,?,?,?)', [i.codigo_intervencion, i.codigo_orden, i.inicio, sn(i.fin), i.tecnico, i.descripcion, i.requirio_pieza === 'SI' ? 1 : 0, sn(i.codigo_pieza)]));
    D.Movimientos.forEach(m => ejecutar('INSERT INTO movimiento(codigo, pieza_codigo, tipo, cantidad, signo, fecha_efectiva, fecha_registro, orden_codigo, referencia, responsable, motivo) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [m.codigo_movimiento, m.codigo_pieza, m.tipo_movimiento, m.cantidad, m.tipo_movimiento === 'AJUSTE_NEGATIVO' ? -1 : 1, m.fecha_efectiva, m.fecha_registro, sn(m.codigo_orden), m.referencia || '', m.responsable, m.motivo || '']));
    D.Consumos.forEach(c => {
      const mc = 'MC-' + c.codigo_consumo;
      ejecutar('INSERT INTO movimiento(codigo, pieza_codigo, tipo, cantidad, signo, fecha_efectiva, fecha_registro, orden_codigo, referencia, responsable, motivo) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [mc, c.codigo_pieza, 'CONSUMO', c.cantidad, -1, c.fecha_efectiva, c.fecha_registro, c.codigo_orden, c.codigo_consumo, c.responsable, 'Consumo en orden']);
      ejecutar('INSERT INTO consumo(codigo, orden_codigo, pieza_codigo, cantidad, fecha_efectiva, fecha_registro, responsable, movimiento_codigo) VALUES (?,?,?,?,?,?,?,?)',
        [c.codigo_consumo, c.codigo_orden, c.codigo_pieza, c.cantidad, c.fecha_efectiva, c.fecha_registro, c.responsable, mc]);
    });
    D.Reservas.forEach(r => ejecutar('INSERT INTO reserva(codigo, orden_codigo, pieza_codigo, cantidad, fecha, estado) VALUES (?,?,?,?,?,?)', [r.codigo_reserva, r.codigo_orden, r.codigo_pieza, r.cantidad, r.fecha, r.estado]));
    D.Ejecuciones_Preventivas.forEach(e => ejecutar('INSERT INTO ejecucion_preventiva VALUES (?,?,?,?,?,?,?)', [e.codigo_ejecucion, e.codigo_tarea, sn(e.codigo_orden), e.fecha_vencimiento, sn(e.fecha_ejecucion), e.resultado, e.evidencia || '']));
    D.Mant_Programado.forEach(m => ejecutar('INSERT INTO mant_programado VALUES (?,?,?,?,?,?)', [m.codigo_periodo, m.codigo_equipo, m.inicio, m.fin, sn(m.codigo_orden), m.descripcion]));
    D.Acciones.forEach(a => ejecutar('INSERT INTO accion VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [a.codigo_accion, a.problema, a.accion, a.tipo_accion, a.responsable, a.fecha, a.objetivo, a.indicador, a.revision_desde, a.revision_hasta, a.resultado || '', sn(a.codigo_parada), sn(a.codigo_pieza), sn(a.codigo_modo)]));
    D.Parametros.forEach(p => ejecutar('INSERT INTO parametro VALUES (?,?,?,?)', [p.clave, String(p.valor), p.unidad, p.descripcion]));
    ejecutar('INSERT INTO carga(instante, origen, archivo, sha256, contrato, empresa, periodo_desde, periodo_hasta, conteos_json, usuario) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [ahoraIso(), origen, lectura.nombreArchivo, lectura.sha256, lectura.meta.Version_contrato, lectura.meta.Empresa, lectura.meta.Periodo_desde, lectura.meta.Periodo_hasta, JSON.stringify(lectura.conteos), usuario]);
  }, { tipo: 'CARGA_EXCEL06', referencia: lectura.nombreArchivo, detalle: `SHA-256 ${lectura.sha256}`, usuario });
}
