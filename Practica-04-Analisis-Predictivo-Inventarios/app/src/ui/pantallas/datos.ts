/** Pantalla 2 · Datos: carga de Excel (arrastrar y soltar), mapeo asistido, calidad de datos y registro manual. */
import { registrar, estado, cargarDatosPractica, trasCambioDeDatos, repintar, velo } from '../app';
import { llamar } from '../motor';
import { tarjeta, tabla, insignia, insigniaEstado, esc, fmtNum, fmtPct, fechaPE, avisar, trasPintar, hallazgos } from '../componentes';
import { elegirArchivos } from '../host';

interface Calidad { datasetId: number; nombre: string; tipo: string; filas: number; estado: string; reglas: { regla: string; severidad: string; detalle: string }[]; porSeveridad: Record<string, number> }
const CAMPOS = ['fecha', 'sku', 'soles', 'volumen', 'utilidad', 'ruc', 'cliente', 'direccion', 'departamento', 'n_origen'];
const ETQ: Record<string, string> = { fecha: 'Fecha *', sku: 'Código de producto *', soles: 'Venta S/ *', volumen: 'Volumen', utilidad: 'Utilidad operativa S/ *', ruc: 'RUC', cliente: 'Cliente', direccion: 'Dirección', departamento: 'Departamento', n_origen: 'N.º correlativo' };

async function importar(archivos: { nombre: string; datos: Uint8Array }[]): Promise<void> {
  if (!archivos.length) return;
  const v = velo('Importando archivos', 'Detección automática del tipo (ventas o Kardex), del encabezado y de las columnas; validación de calidad.');
  try {
    for (const [i, a] of archivos.entries()) {
      v.avance((i / archivos.length) * 100 + 5, a.nombre);
      try {
        const r = await llamar<{ tipo: string; resumen: { filasValidas?: number; movimientos?: number; indiceCalidad: number; estado: string; faltantes?: string[] } }>('importar', a.datos, a.nombre);
        v.linea(`✔ ${a.nombre} → ${r.tipo} · ${fmtNum(r.resumen.filasValidas ?? r.resumen.movimientos ?? 0)} registros · calidad ${fmtPct(r.resumen.indiceCalidad, 1)}`);
        avisar(`✔ <b>${esc(a.nombre)}</b> importado como <b>${r.tipo}</b> (${r.resumen.estado.replace('_', ' ').toLowerCase()}).${r.resumen.faltantes?.length ? ` Faltan columnas: ${r.resumen.faltantes.join(', ')} → corrija el mapeo abajo.` : ''}`, r.resumen.estado === 'DATOS_VALIDADOS' ? 'ok' : 'warn', 7000);
      } catch (e) { avisar(`✖ ${esc(a.nombre)}: ${esc((e as Error).message)}`, 'error', 10000); }
    }
  } finally { v.cerrar(); }
  await trasCambioDeDatos();
  await repintar();
}

registrar({ id: 'datos', icono: '🗂', menu: 'Datos', titulo: 'Datos', pregunta: 'Cargar Excel (ventas o Kardex), corregir el mapeo de columnas, revisar la calidad y registrar datos manualmente',
  async pintar() {
    const ds = estado.info?.datasets ?? [];
    let html = `<div class="grid g21">
      ${tarjeta('Cargar datos', `<div class="soltar" id="soltar" tabindex="0" role="button" aria-label="Seleccionar archivos Excel">
          <div class="big">📥</div><b>Arrastre aquí sus archivos Excel (.xlsx, .xls, .csv) o haga clic para elegirlos</b>
          <div class="nota">El sistema detecta si es una tabla de ventas o un Kardex, ubica la fila de encabezados y mapea las columnas con un diccionario de sinónimos. El archivo original nunca se modifica.</div></div>
        <div class="fila mt"><button class="btn primario" id="b-practica">📥 Cargar datos de la práctica</button><button class="btn" id="b-demo" title="Ventas sintéticas rotuladas como DEMO">🧪 Datos de demostración (sintéticos)</button></div>`, { sub: 'Los dos Excel de la práctica vienen incluidos en el sistema' })}
      ${tarjeta('Base de datos', `<dl class="kv"><dt>Motor</dt><dd>SQLite (sql.js/WebAssembly) · ${estado.info?.tablas ?? 0} tablas</dd><dt>Datasets</dt><dd>${ds.length}</dd>
        <dt>Guarda</dt><dd>datos de entrada, parámetros, resultados de cada análisis, pronósticos, simulaciones, recomendaciones, alertas, versiones de informes, bitácora y auditoría</dd></dl>
        <p class="nota">Respaldo y restauración de la BD (.sqlite): pantalla <a href="#/configuracion">Configuración</a>.</p>`)}
    </div>`;
    trasPintar(() => {
      const z = document.getElementById('soltar')!;
      z.addEventListener('click', async () => importar(await elegirArchivos('.xlsx,.xls,.csv', true)));
      z.addEventListener('keydown', async (e) => { if (e.key === 'Enter') importar(await elegirArchivos('.xlsx,.xls,.csv', true)); });
      z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('encima'); });
      z.addEventListener('dragleave', () => z.classList.remove('encima'));
      z.addEventListener('drop', async (e) => { e.preventDefault(); z.classList.remove('encima');
        importar(await Promise.all([...(e.dataTransfer?.files ?? [])].map(async (f) => ({ nombre: f.name, datos: new Uint8Array(await f.arrayBuffer()) })))); });
      document.getElementById('b-practica')!.addEventListener('click', cargarDatosPractica);
      document.getElementById('b-demo')!.addEventListener('click', async () => { await llamar('generarDemo'); await trasCambioDeDatos(); avisar('🧪 Se cargaron <b>ventas sintéticas de demostración</b> (rotuladas DEMO). Los análisis usan siempre el último dataset de cada tipo.', 'warn', 8000); repintar(); });
    });

    if (!ds.length) return html;
    html += `<div class="mt">${tarjeta('Datasets cargados', tabla(ds as never[], [
      { k: 'id', t: 'ID', n: true, f: (v) => String(v) }, { k: 'tipo', t: 'Tipo' }, { k: 'archivo', t: 'Archivo' },
      { k: 'filas_validas', t: 'Registros válidos', n: true, f: (v) => fmtNum(v as number) },
      { k: 'fecha_min', t: 'Desde', f: (v) => fechaPE(v as string) }, { k: 'fecha_max', t: 'Hasta', f: (v) => fechaPE(v as string) },
      { k: 'ultimo_mes_cerrado', t: 'Último mes cerrado' }, { k: 'estado', t: 'Estado', f: (v) => insigniaEstado(v as string) }, { k: 'cargado_en', t: 'Cargado', f: (v) => fechaPE(v as string) },
    ], { nombre: 'datasets', buscar: false }), { sub: 'Los análisis usan el último dataset de cada tipo' })}</div>`;

    // Calidad de datos por dataset (último de cada tipo)
    const ult = ['ventas', 'kardex'].map((t) => [...ds].reverse().find((d) => d.tipo === t)).filter(Boolean);
    const cal = await Promise.all(ult.map((d) => llamar<Calidad>('calidad', d!.id)));
    html += `<div class="grid g2 mt">${cal.map((q) => {
      const ps = q.porSeveridad;
      const idx = 1 - Math.min(1, ((ps.CRITICA ?? 0) * 1 + (ps.ALTA ?? 0) * 0.5 + (ps.MEDIA ?? 0) * 0.2 + (ps.BAJA ?? 0) * 0.05) / Math.max(1, q.filas) * 50);
      return tarjeta(`Calidad de datos · ${q.tipo === 'ventas' ? 'Ventas' : 'Kardex'}`, `<div class="fila" style="margin-bottom:8px">${['CRITICA', 'ALTA', 'MEDIA', 'BAJA', 'INFO'].map((s) => `${insigniaEstado(s, `${s[0]}${s.slice(1).toLowerCase()}: ${ps[s] ?? 0}`)}`).join(' ')}</div>
        ${tabla(q.reglas as never[], [{ k: 'regla', t: 'Regla' }, { k: 'severidad', t: 'Severidad', f: (v) => insigniaEstado(v as string) }, { k: 'detalle', t: 'Detalle' }], { nombre: `calidad_${q.tipo}`, alto: 300 })}`,
        { sub: `${esc(q.nombre)} · ${fmtNum(q.filas)} registros · ${idx >= 0.9 ? insignia('Apto para análisis', 'ok') : insignia('Apto con observaciones', 'warn')}` });
    }).join('')}</div>`;

    // Asistente de mapeo (ventas)
    const dv = ult.find((d) => d!.tipo === 'ventas');
    if (dv) {
      const enc = await llamar<{ archivo: string; hoja: string; fila: number; encabezados: string[]; mapeo: { campo: string; indice: number; columnaOrigen: string; confianza: number }[] } | null>('encabezados', dv.id);
      if (enc) {
        const porIdx = new Map(enc.mapeo.map((m) => [m.indice, m]));
        html += `<div class="mt">${tarjeta('Asistente de mapeo de columnas · Ventas', `<div class="tabla-caja" style="max-height:340px"><table class="t"><thead><tr><th>Columna del Excel</th><th>Campo del sistema</th><th class="n">Confianza</th></tr></thead><tbody>
          ${enc.encabezados.map((h, i) => { const m = porIdx.get(i); return h ? `<tr><td>${esc(h)}</td><td><select data-i="${i}" data-h="${esc(h)}"><option value="">— ignorar —</option>${CAMPOS.map((c) => `<option value="${c}" ${m?.campo === c ? 'selected' : ''}>${ETQ[c]}</option>`).join('')}</select></td>
            <td class="n">${m ? `${fmtNum(m.confianza * 100, 0)} % ${m.confianza >= 0.8 ? insignia('Alta', 'ok') : insignia('Revisar', 'warn')}` : '—'}</td></tr>` : ''; }).join('')}</tbody></table></div>
          <div class="fila mt"><button class="btn primario" id="b-remapear">Aplicar mapeo y reimportar</button><span class="nota">* obligatorio. Al reimportar se crea un nuevo dataset y el cambio queda en la auditoría.</span></div>`,
          { sub: `${esc(enc.archivo)} · hoja «${esc(enc.hoja)}» · encabezado en la fila ${enc.fila}` })}</div>`;
        trasPintar(() => document.getElementById('b-remapear')?.addEventListener('click', async () => {
          const sel = [...document.querySelectorAll<HTMLSelectElement>('select[data-i]')].filter((s) => s.value);
          const mapeo = sel.map((s) => ({ campo: s.value, indice: +s.dataset.i!, columnaOrigen: s.dataset.h!, confianza: 1 }));
          const dup = mapeo.map((m) => m.campo).filter((c, i, a) => a.indexOf(c) !== i);
          if (dup.length) { avisar(`Cada campo solo puede asignarse a una columna (repetido: ${dup.join(', ')}).`, 'warn'); return; }
          const falt = ['fecha', 'sku', 'soles', 'utilidad'].filter((c) => !mapeo.some((m) => m.campo === c));
          if (falt.length) { avisar(`Faltan campos obligatorios: ${falt.map((c) => ETQ[c]).join(', ')}.`, 'warn'); return; }
          try { await llamar('reimportarVentasConMapeo', dv.id, mapeo); await trasCambioDeDatos(); avisar('✔ Mapeo aplicado; se creó un nuevo dataset de ventas.', 'ok'); repintar(); }
          catch (e) { avisar(esc((e as Error).message), 'error'); }
        }));
      }
    }

    // Registro manual
    const ult10 = await llamar<{ ventas: Record<string, unknown>[]; kardex: Record<string, unknown>[] }>('ultimosRegistrosManuales');
    const hayV = ds.some((d) => d.tipo === 'ventas'), hayK = ds.some((d) => d.tipo === 'kardex');
    html += `<div class="grid g2 mt">
      ${tarjeta('Registro manual · Venta', hayV ? `<form id="f-venta" class="fila">
          <label class="campo">Fecha *<input type="date" name="fecha" required></label><label class="campo">Código de producto *<input type="text" name="sku" required size="10"></label>
          <label class="campo">Venta S/ *<input type="number" name="soles" step="0.01" required></label><label class="campo">Utilidad S/ *<input type="number" name="utilidad" step="0.01" required></label>
          <label class="campo">Volumen<input type="number" name="volumen" step="0.001"></label><label class="campo">Departamento<input type="text" name="departamento" size="10"></label>
          <label class="campo">RUC<input type="text" name="ruc" size="11" pattern="\\d{11}" title="11 dígitos"></label>
          <button class="btn primario">Registrar venta</button></form>
          ${ult10.ventas.length ? `<div class="mt">${tabla(ult10.ventas, [{ k: 'id', t: 'ID', n: true, f: (v) => String(v) }, { k: 'fecha', t: 'Fecha', f: (v) => fechaPE(v as string) }, { k: 'sku', t: 'SKU' }, { k: 'soles', t: 'Venta S/', n: true }, { k: 'utilidad', t: 'Utilidad S/', n: true }, { k: 'departamento', t: 'Depto.' }], { nombre: 'ventas_manuales', buscar: false })}</div>` : ''}`
        : '<p class="nota">Cargue primero un Excel de ventas.</p>', { sub: 'Se valida y se guarda en la BD con origen «manual»' })}
      ${tarjeta('Registro manual · Movimiento de Kardex', hayK ? `<form id="f-kardex" class="fila">
          <label class="campo">Fecha *<input type="date" name="fecha" required></label><label class="campo">Código *<input type="text" name="codigo" required size="12" placeholder="MATPRIMA-003"></label>
          <label class="campo">Tipo *<select name="tipo"><option>ENTRADA</option><option selected>SALIDA</option></select></label>
          <label class="campo">Cantidad *<input type="number" name="cantidad" step="0.01" min="0.01" required></label>
          <label class="campo">Motivo *<select name="motivo"><option>Por Produccion en Planta</option><option>Por Venta</option><option>Por Compra</option><option>Por Ingreso de Produccion</option><option>Por Transferencia</option><option>Por Ajuste de Inventario</option></select></label>
          <label class="campo">Documento<input type="text" name="documento" size="10"></label>
          <button class="btn primario">Registrar movimiento</button></form>
          ${ult10.kardex.length ? `<div class="mt">${tabla(ult10.kardex, [{ k: 'id', t: 'ID', n: true, f: (v) => String(v) }, { k: 'fecha', t: 'Fecha', f: (v) => fechaPE(v as string) }, { k: 'codigo', t: 'Código' }, { k: 'entrada', t: 'Entrada', n: true }, { k: 'salida', t: 'Salida', n: true }, { k: 'stock', t: 'Stock', n: true }, { k: 'motivo', t: 'Motivo' }], { nombre: 'kardex_manual', buscar: false })}</div>` : ''}`
        : '<p class="nota">Cargue primero el Kardex.</p>', { sub: 'Recalcula el stock y advierte si queda negativo' })}
    </div>`;
    trasPintar(() => {
      const leer = (f: HTMLFormElement) => Object.fromEntries([...new FormData(f)].map(([k, v]) => [k, String(v).trim()]));
      document.getElementById('f-venta')?.addEventListener('submit', async (e) => {
        e.preventDefault(); const d = leer(e.target as HTMLFormElement);
        try {
          const id = await llamar('ventaManual', { fecha: d.fecha, sku: d.sku, soles: +d.soles, utilidad: +d.utilidad, volumen: d.volumen ? +d.volumen : null, departamento: d.departamento || null, ruc: d.ruc || null });
          await trasCambioDeDatos(); avisar(`✔ Venta registrada (ID ${id}). Los KPI del dashboard ya la incluyen; los análisis quedan marcados como desactualizados.`, 'ok'); repintar();
        } catch (er) { avisar(esc((er as Error).message), 'error'); }
      });
      document.getElementById('f-kardex')?.addEventListener('submit', async (e) => {
        e.preventDefault(); const d = leer(e.target as HTMLFormElement);
        try {
          const r = await llamar<{ id: number; stock: number; advertencias: string[] }>('movimientoManual', { fecha: d.fecha, codigo: d.codigo.toUpperCase(), tipo: d.tipo, cantidad: +d.cantidad, motivo: d.motivo, documento: d.documento || undefined });
          await trasCambioDeDatos(); avisar(`✔ Movimiento registrado (ID ${r.id}); stock resultante ${fmtNum(r.stock, 2)}.${r.advertencias.length ? `<br/>⚠ ${r.advertencias.map(esc).join('<br/>⚠ ')}` : ''}`, r.advertencias.length ? 'warn' : 'ok', 8000); repintar();
        } catch (er) { avisar(esc((er as Error).message), 'error'); }
      });
    });
    html += `<div class="mt">${hallazgos([
      { t: 'E', texto: 'Las reglas de calidad V00–V12 (ventas) y K01–K11 (Kardex) se aplican al importar; los hallazgos CRÍTICOS no detienen la carga, pero se reportan y se excluyen del cálculo cuando corresponde (p. ej., meses incompletos).' },
      { t: 'S', texto: 'Si un Excel propio no se reconoce, corrija el mapeo con el asistente (arriba) o renombre los encabezados; el sistema reconoce sinónimos como «Cant.», «Cantidad», «Unidades», «Importe», «Monto».' },
    ], 'Cómo trabaja el agente de ingesta')}</div>`;
    return html;
  },
});
