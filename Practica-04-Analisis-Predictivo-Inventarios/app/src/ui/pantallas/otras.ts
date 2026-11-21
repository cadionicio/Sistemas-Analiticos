/** Pantallas 8–14 · Copiloto IA, Informes, Mejores prácticas, Alertas, Configuración, Bitácora y ayuda, Acerca de. */
import { registrar, estado, repintar, aplicarTema, trasCambioDeDatos, analisisCompleto } from '../app';
import { llamar, type InfoMotor } from '../motor';
import { tarjeta, tabla, vacio, insignia, insigniaEstado, esc, fmtNum, fmtPct, fechaPE, trasPintar, hallazgos, avisar, confirmar, exportarExcel } from '../componentes';
import { elegirArchivos, guardarArchivo, esEXE, modo, configurarHost } from '../host';
import { MODELO_DEFECTO, clave, fijarClave, llmActivo } from '../llm';

// =============================== MEJORES PRÁCTICAS (RF-10) ===============================
registrar({ id: 'practicas', icono: '📚', menu: 'Mejores prácticas', titulo: 'Mejores prácticas de abastecimiento', pregunta: '¿Qué herramientas metodológicas aplican a estos datos y por qué? (sugerencia del docente, RF-10)',
  pintar() {
    const R = estado.R;
    const dv = R?.dv?.result, dk = R?.dk?.result, gk = R?.gk?.result, pr = R?.pr?.result;
    const movs = estado.info?.datasets.filter((d) => d.tipo === 'kardex').at(-1)?.filas_validas ?? 0;
    const ira = gk && movs ? 1 - gk.conciliacion.saldosNoCuadran / movs : null;
    const cuenta = (m?: Record<string, number>) => (m ? Object.entries(m).map(([k, v]) => `${k.replace(/_/g, ' ').toLowerCase()} ${v}`).join(' · ') : 'tras el análisis');
    type Fila = { h: string; que: string; v: string; k: string; ev: string; est: string };
    const filas: Fila[] = [
      { h: 'Clasificación ABC-XYZ', que: 'Prioriza el control según valor (ABC) y variabilidad (XYZ).', v: 'Sí', k: 'Sí (ABC por volumen)', ev: dv ? `Ventas: ABC ${cuenta(dv.abc)}; matriz ${cuenta(dv.matriz)}` : '—', est: 'IMPLEMENTADO' },
      { h: 'Clasificación de demanda Syntetos-Boylan', que: 'Elige el método de pronóstico según ADI y CV².', v: 'Sí', k: 'Sí', ev: dk ? `Kardex: ${cuenta(dk.patrones)}` : '—', est: 'IMPLEMENTADO' },
      { h: 'Políticas de reposición (s,Q) / (R,S) / min-máx', que: 'Define cuándo y cuánto pedir por producto.', v: 'No (no hay stock de ventas)', k: 'Sí', ev: pr ? `Políticas asignadas: ${cuenta(pr.resumenPoliticas)}` : '—', est: 'IMPLEMENTADO' },
      { h: 'EOQ (lote económico)', que: 'Equilibra costo de ordenar y de mantener.', v: 'No', k: 'Sí (con costos SUPUESTOS)', ev: pr ? `${pr.politicas.filter((p) => p.eoq > 0).length} productos con EOQ; costo de orden y tasa de mantener editables` : '—', est: 'IMPLEMENTADO' },
      { h: 'Stock de seguridad con variabilidad de demanda y plazo', que: 'SS = z·√(LT·σd² + d̄²·σLT²) protege ante incertidumbre.', v: 'No', k: 'Sí', ev: pr ? `LT = ${pr.parametros.LT} días, σLT = ${pr.parametros.sLT} días (SUPUESTO: el Kardex no registra fechas de pedido)` : '—', est: 'IMPLEMENTADO' },
      { h: 'Conciliación de Kardex y exactitud de inventario (IRA)', que: 'Verifica que el saldo del sistema coincida con el físico.', v: 'No', k: 'Sí (prioritario)', ev: gk ? `${gk.conciliacion.saldosNoCuadran} saldos no cuadran · ${gk.conciliacion.stockNegativo} stocks negativos · ${fmtPct(ira, 1)} de los movimientos con saldo que cuadra, pero ${gk.conciliacion.bloquesDescuadrados} bloques de producto descuadrados: falta conteo físico para medir la exactitud real (IRA)` : '—', est: 'IMPLEMENTADO' },
      { h: 'Pronóstico probabilístico con backtesting', que: 'Mide el error real antes de confiar en un modelo; da rangos, no un solo número.', v: 'Sí', k: 'Sí', ev: R?.pv ? `${R.pv.result.series.length} series de ventas + ${R.pk?.result.productos.length ?? 0} productos; selección por MASE` : '—', est: 'IMPLEMENTADO' },
      { h: 'S&OP (planificación integrada de ventas y operaciones)', que: 'Reunión mensual que alinea pronóstico comercial, producción, compras y finanzas.', v: 'Sí', k: 'Sí', ev: 'El dashboard, el pronóstico a 6 meses y el plan de compras son los insumos del ciclo S&OP mensual.', est: 'RECOMENDADO' },
      { h: 'Matriz de Kraljic (compras)', que: 'Segmenta insumos por impacto en utilidad y riesgo de suministro.', v: 'No', k: 'Parcial', ev: 'Impacto aproximable con ABC; el riesgo requiere datos de proveedores que no están en los Excel (A VERIFICAR).', est: 'RECOMENDADO' },
      { h: 'FEFO / FIFO', que: 'Rotación por fecha de vencimiento o de ingreso para evitar mermas.', v: 'No', k: 'Sí, si hay lotes', ev: dk ? `${dk.sinSalidas.length} productos sin salidas y ${dk.coberturaMayor180} con cobertura > 180 días: riesgo de envejecimiento; el Kardex no registra lotes ni vencimientos.` : '—', est: 'RECOMENDADO' },
      { h: 'MRP (planificación de requerimientos de materiales)', que: 'Calcula insumos a partir del plan de producción y la lista de materiales.', v: 'No', k: 'Sí (parte industrial)', ev: gk ? `Consumo de producción vs. ingreso de producto terminado: r = ${fmtNum(gk.produccion.correlacionConsumoVsIngresoPT, 2)}; falta la lista de materiales (BOM).` : '—', est: 'RECOMENDADO' },
    ];
    return `${R?.dv || R?.dk ? '' : `<div class="tarjeta" style="margin-bottom:14px">${insignia('Sin análisis', 'info')} Ejecute el análisis completo para ver la evidencia de cada herramienta con los datos cargados. <button class="btn chico" id="mp-1clic">▶ Análisis completo</button></div>`}
      ${tarjeta('Herramientas metodológicas evaluadas con los datos', tabla(filas as never[], [
        { k: 'h', t: 'Herramienta', f: (v) => `<b>${esc(v)}</b>` }, { k: 'que', t: '¿Qué resuelve?' }, { k: 'v', t: 'Ventas' }, { k: 'k', t: 'Kardex' }, { k: 'ev', t: 'Evidencia en los datos', f: (v) => `<span class="nota">${esc(v)}</span>` },
        { k: 'est', t: 'En el sistema', f: (v) => (v === 'IMPLEMENTADO' ? insignia('Implementado', 'ok') : insignia('Recomendado', 'info')) }], { nombre: 'mejores_practicas', alto: 700 }))}
      <div class="mt">${hallazgos([
        { t: 'S', texto: '<b>Primero la exactitud del inventario</b>: sin un Kardex conciliado, cualquier política de reposición parte de saldos erróneos. Conteo cíclico de clase A (mensual), B (trimestral) y C (semestral).' },
        { t: 'S', texto: 'Luego, <b>políticas diferenciadas</b> por ABC-XYZ y patrón de demanda: (s,Q) para A estables, (R,S) para intermitentes, min-máx para C.' },
        { t: 'S', texto: 'Institucionalizar un <b>ciclo S&OP mensual</b> con el pronóstico P10–P50–P90 del sistema como insumo y seguimiento de los KPI de las recomendaciones.' },
      ], 'Hoja de ruta recomendada por el agente')}</div>`
      + (trasPintar(() => document.getElementById('mp-1clic')?.addEventListener('click', analisisCompleto)), '');
  },
});

// =============================== ALERTAS ===============================
registrar({ id: 'alertas', icono: '🔔', menu: 'Alertas', titulo: 'Centro de alertas', pregunta: 'Quiebre inminente, sobrestock, stock inmovilizado, inconsistencias del Kardex y margen negativo', separador: true,
  async pintar() {
    const al = estado.R?.pr ? await llamar<{ tipo: string; severidad: string; entidad: string; mensaje: string; creada_en: string }[]>('alertas') : [];
    const ds = estado.info?.datasets ?? [];
    const cal = (await Promise.all(ds.slice(-2).map((d) => llamar<{ tipo: string; reglas: { regla: string; severidad: string; detalle: string }[] }>('calidad', d.id))))
      .flatMap((q) => q.reglas.filter((r) => r.severidad === 'CRITICA' || r.severidad === 'ALTA').map((r) => ({ tipo: `Calidad de datos (${q.tipo})`, severidad: r.severidad === 'CRITICA' ? 'ALTA' : 'MEDIA', entidad: r.regla, mensaje: r.detalle, creada_en: '' })));
    const todas = [...al, ...cal];
    if (!todas.length) return vacio('🔔', 'Sin alertas', 'Las alertas se generan al importar datos (calidad) y al ejecutar el análisis completo (inventario y margen).');
    const por = (s: string) => todas.filter((a) => a.severidad === s).length;
    const tipos = [...new Set(todas.map((a) => a.tipo))];
    return `<div class="fila" style="margin-bottom:12px">${insignia(`Alta: ${por('ALTA')}`, 'crit')} ${insignia(`Media: ${por('MEDIA')}`, 'warn')} ${insignia(`Baja/Info: ${todas.length - por('ALTA') - por('MEDIA')}`, 'info')}
        <span class="nota">· ${tipos.length} tipos: ${tipos.map(esc).join(', ')}</span></div>
      ${tarjeta('Alertas priorizadas', tabla(todas as never[], [
        { k: 'severidad', t: 'Severidad', f: (v) => insigniaEstado(v === 'ALTA' ? 'CRITICA' : v === 'MEDIA' ? 'MEDIA' : 'INFO', String(v).toLowerCase().replace(/^./, (c) => c.toUpperCase())) },
        { k: 'tipo', t: 'Tipo' }, { k: 'entidad', t: 'Entidad' }, { k: 'mensaje', t: 'Mensaje' }, { k: 'creada_en', t: 'Creada', f: (v) => fechaPE(v as string) }], { nombre: 'alertas', alto: 600 }),
        { sub: 'Escriba en el filtro (p. ej. «quiebre», «sobrestock», un código) para acotar la lista' })}`;
  },
});

// =============================== CONFIGURACIÓN ===============================
registrar({ id: 'configuracion', icono: '⚙', menu: 'Configuración', titulo: 'Configuración', pregunta: 'Parámetros (supuestos editables), apariencia, respaldo de la base de datos e IA opcional',
  async pintar() {
    const ps = await llamar<{ clave: string; valor: string; unidad: string; es_supuesto: number; descripcion: string; actualizado_en: string }[]>('parametros');
    const cfg = estado.cfg;
    trasPintar(() => {
      document.querySelectorAll<HTMLInputElement>('input[name=tema]').forEach((r) => r.addEventListener('change', async () => {
        await llamar('guardarConfiguracion', 'tema', r.value); estado.cfg.tema = r.value; aplicarTema(r.value); repintar();
      }));
      document.querySelectorAll<HTMLButtonElement>('button[data-par]').forEach((b) => b.addEventListener('click', async () => {
        const i = document.querySelector<HTMLInputElement>(`input[data-par="${b.dataset.par}"]`)!;
        try { await llamar('guardarParametro', b.dataset.par, i.value.trim()); await trasCambioDeDatos(); avisar(`✔ Parámetro <b>${esc(b.dataset.par)}</b> actualizado. Vuelva a ejecutar el análisis completo para recalcular.`, 'ok'); repintar(); }
        catch (e) { avisar(esc((e as Error).message), 'error'); }
      }));
      document.getElementById('bd-guardar')!.addEventListener('click', async () => {
        const b = await llamar<Uint8Array>('exportarBD');
        await guardarArchivo(`SADPGI_respaldo_${new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 16).replace(/[-:T]/g, '')}.sqlite`, b, 'application/vnd.sqlite3');
        await llamar('registrarUso', 'Guardar respaldo de BD', 'Configuración', `${fmtNum(b.length / 1024, 0)} KB`, Date.now());
      });
      document.getElementById('bd-abrir')!.addEventListener('click', async () => {
        const [f] = await elegirArchivos('.sqlite,.db'); if (!f) return;
        try { estado.info = await llamar<InfoMotor>('abrirBD', f.datos); estado.R = null; await trasCambioDeDatos(); avisar(`✔ Base de datos abierta: ${estado.info.datasets.length} datasets. Ejecute el análisis completo para ver resultados.`, 'ok'); repintar(); }
        catch (e) { avisar(esc((e as Error).message), 'error'); }
      });
      document.getElementById('bd-nueva')!.addEventListener('click', async () => {
        if (!(await confirmar('Se creará una base de datos vacía. Los datos actuales se pierden si no guardó un respaldo. ¿Continuar?'))) return;
        estado.info = await llamar<InfoMotor>('nuevaBD'); estado.R = null; estado.filtros = {}; await trasCambioDeDatos(); avisar('Base de datos nueva y vacía.', 'info'); repintar();
      });
      document.getElementById('f-llm')!.addEventListener('submit', async (e) => {
        e.preventDefault(); const d = new FormData(e.target as HTMLFormElement);
        const g = async (k: string, v: string) => { await llamar('guardarConfiguracion', k, v); estado.cfg[k] = v; };
        await g('llm_proveedor', String(d.get('p'))); await g('llm_modelo', String(d.get('m') ?? '').trim()); await g('llm_endpoint', String(d.get('e') ?? '').trim());
        const k = String(d.get('k') ?? '').trim(); if (k) fijarClave(k);
        const recordar = d.get('r') === 'on'; await g('llm_recordar_clave', recordar ? '1' : '0');
        if (recordar && clave()) await g('llm_clave', clave()); else if (!recordar) { await g('llm_clave', ''); }
        await llamar('registrarUso', 'Configurar LLM del copiloto', 'Configuración', `${d.get('p')} · clave ${recordar ? 'guardada en la BD' : 'solo en memoria'}`, Date.now());
        await trasCambioDeDatos(); avisar(llmActivo() ? `✔ LLM activo (${esc(String(d.get('p')))}). Pruebe en el Copiloto.` : 'LLM desactivado: el copiloto responde solo con el motor.', 'ok'); repintar();
      });
      document.getElementById('sin-rastro')?.addEventListener('change', async (e) => { const on = (e.target as HTMLInputElement).checked; await llamar('guardarConfiguracion', 'modo_sin_rastro', on ? '1' : '0'); estado.cfg.modo_sin_rastro = on ? '1' : '0'; await configurarHost({ sinRastro: on }); await trasCambioDeDatos(); avisar(on ? 'Modo sin rastro activado: al cerrar se borrarán el perfil web, las cachés y los registros (la BD se conserva).' : 'Modo sin rastro desactivado.', 'info'); });
    });
    return `<div class="grid g2">
      ${tarjeta('Apariencia', `<div class="fila">${[['claro', '☀ Claro'], ['oscuro', '🌙 Oscuro'], ['sistema', '🖥 Según Windows']].map(([v, t]) => `<label><input type="radio" name="tema" value="${v}" ${(cfg.tema ?? 'claro') === v ? 'checked' : ''}/> ${t}</label>`).join('')}</div>
        <p class="nota">La preferencia se guarda en la base de datos (no en el navegador).</p>`)}
      ${tarjeta('Base de datos', `<dl class="kv"><dt>Modo de ejecución</dt><dd>${modo()}</dd><dt>Ubicación</dt><dd>${esEXE() ? 'Carpeta oculta <code>07_Sistema_Analisis_Predictivo_Inventarios_datos</code> junto al EXE (guardado automático)' : 'En memoria (la versión HTML no deja rastro en el navegador: use «Guardar respaldo»)'}</dd></dl>
        <div class="fila mt"><button class="btn primario" id="bd-guardar">💾 Guardar respaldo (.sqlite)</button><button class="btn" id="bd-abrir">📂 Abrir base de datos</button><button class="btn peligro" id="bd-nueva">🗑 Nueva BD vacía</button></div>
        ${esEXE() ? `<label class="mt" style="display:block"><input type="checkbox" id="sin-rastro" ${cfg.modo_sin_rastro === '1' ? 'checked' : ''}/> Modo sin rastro: al cerrar, borrar perfil web, cachés y registros (se conserva la BD)</label>` : ''}`)}
    </div>
    <div class="mt">${tarjeta('Parámetros del modelo', `<div class="tabla-caja" style="max-height:520px"><table class="t"><thead><tr><th>Parámetro</th><th>Descripción</th><th class="n">Valor</th><th>Unidad</th><th>Tipo</th><th>Actualizado</th><th></th></tr></thead><tbody>
      ${ps.map((p) => `<tr><td><code>${esc(p.clave)}</code></td><td>${esc(p.descripcion)}</td><td class="n"><input type="text" data-par="${esc(p.clave)}" value="${esc(p.valor)}" size="9" style="text-align:right"/></td><td>${esc(p.unidad)}</td>
        <td>${p.es_supuesto ? insignia('SUPUESTO', 'warn') : insignia('Dato', 'ok')}</td><td class="nota">${fechaPE(p.actualizado_en)}</td><td><button class="btn chico" data-par="${esc(p.clave)}">Guardar</button></td></tr>`).join('')}</tbody></table></div>`,
      { sub: 'Los SUPUESTOS se declaran en cada resultado y en los informes. Cada cambio queda en la auditoría y marca los resultados como desactualizados.' })}</div>
    <div class="mt">${tarjeta('Inteligencia artificial opcional (LLM) para el copiloto', `<p style="margin-top:0">El sistema funciona <b>completo sin conexión</b>: todas las cifras las calcula el motor determinístico. Si lo desea, el copiloto puede usar un modelo de lenguaje solo para <b>redactar</b> las respuestas con los hechos del motor; el Evaluador verifica cada cifra. <b>Nunca</b> se usa búsqueda web.</p>
      <form id="f-llm" class="fila"><label class="campo">Proveedor<select name="p">${[['ninguno', 'Ninguno (solo motor)'], ['anthropic', 'Anthropic (Claude)'], ['openai', 'Compatible con OpenAI']].map(([v, t]) => `<option value="${v}" ${(cfg.llm_proveedor ?? 'ninguno') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="campo">Modelo<input type="text" name="m" value="${esc(cfg.llm_modelo ?? '')}" placeholder="${MODELO_DEFECTO.anthropic} / ${MODELO_DEFECTO.openai}" size="22"/></label>
        <label class="campo">Endpoint (solo compatible con OpenAI)<input type="text" name="e" value="${esc(cfg.llm_endpoint ?? '')}" placeholder="https://api.openai.com/v1" size="26"/></label>
        <label class="campo">Clave de API<input type="password" name="k" placeholder="${clave() ? '•••••• (cargada)' : 'pegue su clave'}" size="22" autocomplete="off"/></label>
        <label style="font-size:12.5px"><input type="checkbox" name="r" ${cfg.llm_recordar_clave === '1' ? 'checked' : ''}/> Recordar la clave en la BD</label>
        <button class="btn primario">Guardar</button></form>
      <p class="nota">Por defecto la clave vive solo en memoria y se borra al cerrar. Si marca «Recordar», se guarda dentro de la base de datos del sistema (no la comparta ni la incluya en respaldos que vaya a entregar).</p>`)}</div>`;
  },
});

// =============================== BITÁCORA Y AYUDA ===============================
registrar({ id: 'bitacora', icono: '🕒', menu: 'Bitácora y ayuda', titulo: 'Bitácora y ayuda', pregunta: 'Registro con marca de tiempo de cada acción, ejecuciones del agente y guía de uso',
  async pintar() {
    const [b, ej] = await Promise.all([llamar<Record<string, unknown>[]>('bitacora'), llamar<Record<string, unknown>[]>('ejecuciones')]);
    trasPintar(() => document.getElementById('bit-xlsx')?.addEventListener('click', () => exportarExcel('bitacora_de_uso', [{ nombre: 'Bitacora', filas: b.map((r) => ({ ID: r.id, Inicio: r.ts_inicio, Fin: r.ts_fin, 'Duración (s)': ((r.duracion_ms as number) ?? 0) / 1000, Pantalla: r.pantalla, Acción: r.accion, Detalle: r.detalle })) }, { nombre: 'Ejecuciones del agente', filas: ej }])));
    return `<div class="grid g21">
      ${tarjeta('Bitácora de uso', tabla([...b].reverse() as never[], [{ k: 'id', t: 'ID', n: true, f: (v) => String(v) }, { k: 'ts_inicio', t: 'Inicio', f: (v) => fechaPE(v as string) }, { k: 'duracion_ms', t: 'Duración', n: true, f: (v) => `${fmtNum(((v as number) ?? 0) / 1000, 1)} s` },
        { k: 'pantalla', t: 'Pantalla' }, { k: 'accion', t: 'Acción' }, { k: 'detalle', t: 'Detalle', f: (v) => `<span class="nota">${esc(v)}</span>` }], { nombre: 'bitacora', alto: 520 }),
        { sub: 'Fuente del tiempo por actividad (Pregunta 02)', acciones: '<button class="btn chico" id="bit-xlsx">⬇ Excel (bitácora + ejecuciones)</button>' })}
      ${tarjeta('Guía rápida', `<ol class="prose"><li><b>Datos</b> → «Cargar datos de la práctica» o arrastre sus Excel.</li><li>Pulse <b>▶ Análisis completo en 1 clic</b> (arriba a la derecha).</li><li>Revise <b>Dashboard</b> y las pantallas de análisis; cada una responde una pregunta.</li><li>Pruebe escenarios en <b>Simulación</b>.</li><li>Apruebe la propuesta en <b>Prescriptivo</b>.</li><li>Genere informes y la presentación en <b>Informes</b>.</li><li>Guarde un respaldo en <b>Configuración</b>.</li></ol>
        <h4 class="mt">Glosario de indicadores</h4><dl class="kv" style="font-size:12.5px"><dt>Margen</dt><dd>utilidad ÷ ventas</dd><dt>MASE</dt><dd>error absoluto medio ÷ error del pronóstico ingenuo (&lt; 1 es mejor)</dd><dt>P10–P90</dt><dd>80 % de probabilidad</dd><dt>Fill rate</dt><dd>unidades atendidas ÷ demandadas</dd><dt>SS</dt><dd>z·√(LT·σd² + d̄²·σLT²)</dd><dt>ROP</dt><dd>d̄·LT + SS</dd><dt>EOQ</dt><dd>√(2·D·S ÷ H)</dd><dt>ADI / CV²</dt><dd>intervalo medio entre demandas / variabilidad al cuadrado</dd></dl>`)}
    </div>
    <div class="mt">${tarjeta('Ejecuciones del Super Agente (contrato transversal)', ej.length ? tabla(ej as never[], [{ k: 'run_id', t: 'run_id', f: (v) => `<code>${String(v).slice(0, 8)}</code>` }, { k: 'skill', t: 'Skill' }, { k: 'skill_version', t: 'Versión' }, { k: 'cutoff', t: 'Corte' },
      { k: 'status', t: 'Estado', f: (v) => insigniaEstado(v as string) }, { k: 'estado_flujo', t: 'Flujo', f: (v) => insigniaEstado(v as string) }, { k: 'inicio', t: 'Inicio', f: (v) => fechaPE(v as string) }], { nombre: 'ejecuciones', alto: 360 }) : '<p class="nota">Sin ejecuciones.</p>')}</div>`;
  },
});

// =============================== ACERCA DE ===============================
registrar({ id: 'acerca', icono: 'ℹ', menu: 'Acerca de', titulo: 'Acerca de', pregunta: 'Sistema, versión, autor y tecnologías',
  pintar() {
    return `<div class="grid g2">
      ${tarjeta('Sistema de Análisis de Datos y Predictivo de Gestión de Inventarios', `<dl class="kv"><dt>Versión</dt><dd>1.0 · Super Agente IA</dd><dt>Modo</dt><dd>${modo()}</dd>
        <dt>Alumno</dt><dd><b>Dionicio Achachagua Cesar Alonso</b></dd><dt>Código UNI</dt><dd>20192589B</dd><dt>Curso</dt><dd>GE803U · Sistemas Analíticos</dd><dt>Facultad</dt><dd>Facultad de Ingeniería Industrial y de Sistemas · Universidad Nacional de Ingeniería</dd>
        <dt>Evaluación</dt><dd>Práctica Calificada 04 · 2026-2</dd></dl>`)}
      ${tarjeta('Arquitectura y tecnologías', `<ul class="prose"><li><b>Un núcleo, dos envoltorios:</b> la misma aplicación web corre como HTML autocontenido y como EXE nativo de Windows (WebView2), sin instalación ni ventana de consola.</li>
        <li>Motor analítico en TypeScript (Web Worker): 9 modelos de pronóstico con backtesting, bootstrap de 10 000 trayectorias, Monte Carlo, optimización.</li><li>Base de datos SQLite (sql.js/WebAssembly), 24 tablas.</li>
        <li>Gráficos: Apache ECharts · Excel: SheetJS · Compilación: Vite + TypeScript · EXE: Go + WebView2.</li><li>Sin motores de búsqueda web; la IA generativa es opcional y nunca inventa cifras.</li></ul>
        <p class="nota">Licencias de terceros: sql.js (MIT), SheetJS Community (Apache-2.0), Apache ECharts (Apache-2.0), go-webview2 (MIT).</p>`)}
    </div>`;
  },
});
