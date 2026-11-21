// Pruebas I1.3: analítica, simulación reproducible, exportaciones conciliadas y navegación al detalle (HTML final sin red).
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { execFileSync } = require('child_process');
const path = require('path'); const fs = require('fs'); const os = require('os');
const HTML = path.resolve(process.argv[2]);
const res = []; const red = [];
const anota = (caso, ok, obs) => { res.push({ caso, resultado: ok ? 'PASA' : 'FALLA', observado: obs }); console.log((ok ? 'PASA ' : 'FALLA') + ' · ' + caso + ' · ' + obs); };
const num = t => Number(String(t).replace(/[^0-9.\-]/g, ''));
let pg;
const recalcular = (f, refs) => JSON.parse(execFileSync('python3', ['pruebas/recalcular.py', f, path.join(os.tmpdir(), 'recalc'), ...refs], { encoding: 'utf8' }));
const bajar = async (sel, dir) => { const [d] = await Promise.all([pg.waitForEvent('download'), pg.click(sel)]); const f = path.join(dir, d.suggestedFilename()); await d.saveAs(f); return f; };
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpr13-'));
  const ctx = await chromium.launchPersistentContext(dir, { executablePath: '/usr/bin/google-chrome', headless: true, viewport: { width: 1366, height: 768 }, acceptDownloads: true, locale: 'es-PE' });
  ctx.on('request', r => { if (!/^(file|data|blob):/.test(r.url())) red.push(r.url()); });
  await ctx.route(/^https?:/, r => r.abort());
  pg = ctx.pages()[0] || await ctx.newPage();
  pg.on('pageerror', e => red.push('ERROR ' + e.message));
  await pg.goto('file://' + HTML); await pg.click('#b-ingresar');
  await pg.click('#b-demo'); await pg.click('.dialogo button:has-text("Confirmar carga")'); await pg.waitForSelector('.capa-progreso', { state: 'detached' }); await pg.waitForTimeout(150); await pg.waitForSelector('#conteos');
  await pg.click('.pestana:has-text("Indicadores")'); await pg.waitForSelector('#kpis-ind');
  const kTot = await pg.textContent('#ki-total'), kEsp = await pg.textContent('#ki-espera'), kMtbf = await pg.textContent('#ki-mtbf'), kCump = await pg.textContent('#ki-cump'), kEi = await pg.textContent('#ki-esp-int');
  anota('Tablero integrado con indicadores y denominadores', /h$/.test(kTot.trim()) && /%/.test(kCump), `parada ${kTot} · espera ${kEsp} · espera/intervención ${kEi} · cumplimiento ${kCump} · MTBF ${kMtbf}`);
  const hall = await pg.$$eval('#hallazgos li', ls => ls.map(l => l.className + ':' + l.querySelector('.h-txt').textContent));
  anota('Hallazgos priorizados con acción', hall.length >= 4 && hall[0].startsWith('h-error') && hall.some(h => /TP-01/.test(h)) && hall.some(h => /0103/.test(h)), hall.slice(0, 4).join(' | '));
  // Cuatro analíticas
  const pest = {};
  for (const a of ['descriptiva', 'diagnostica', 'predictiva', 'prescriptiva', 'acciones']) { await pg.click(`[data-a="${a}"]`); await pg.waitForTimeout(200); pest[a] = (await pg.textContent('#analisis')).replace(/\s+/g, ' '); }
  anota('Cuatro analíticas interpretables', Object.values(pest).every(t => t.length > 60) && /Pareto|Contribución/.test(pest.diagnostica) && /Validación/.test(pest.predictiva) && /recomendada|Política/i.test(pest.prescriptiva), Object.entries(pest).map(([k, v]) => k + ': ' + v.slice(0, 70)).join(' | '));
  const estAcc = await pg.$$eval('#tabla-acciones tr[data-accion]', ts => ts.map(t => t.dataset.accion + '=' + t.dataset.estado));
  anota('Acciones con seguimiento y «pendiente de verificación»', estAcc.some(x => /AC-02=Pendiente de verificación/.test(x)), estAcc.join(' · '));
  // Navegación: Pareto → parada
  await pg.click('[data-a="diagnostica"]'); await pg.click('#tabla-pareto tr[data-modo="MF-02"]');
  await pg.click('#tabla-pareto tr.detalle button[data-ir-parada="PAR-0008"]'); await pg.waitForSelector('#det-PAR-0008');
  const detTxt = (await pg.textContent('#det-PAR-0008')).replace(/\s+/g, ' ');
  await pg.click('#det-PAR-0008 [data-ir-orden]'); await pg.waitForSelector('#tabla-consumos');
  const consTxt = (await pg.textContent('#tabla-consumos')).replace(/\s+/g, ' ');
  anota('Del resultado analítico a la parada, la orden y la pieza', /Lectura de vibración/.test(detTxt) && /0103/.test(consTxt), `Pareto MF-02 → PAR-0008 (evidencia visible) → orden con consumo ${consTxt.slice(0, 80)}`);
  // Período vacío
  await pg.click('.pestana:has-text("Indicadores")');
  await pg.fill('#fi-desde', '2026-01-01T00:00'); await pg.fill('#fi-hasta', '2026-02-01T00:00'); await pg.dispatchEvent('#fi-hasta', 'change'); await pg.waitForTimeout(250);
  const vacio = (await pg.textContent('#kpis-ind')).replace(/\s+/g, ' ');
  await pg.click('[data-a="descriptiva"]'); const vacDesc = await pg.textContent('#analisis');
  anota('Analítica con período vacío', /sin base de cálculo/.test(vacio) && /sin base de cálculo/.test(vacDesc), vacio.slice(0, 200));
  await pg.click('[data-r="todo"]'); await pg.waitForTimeout(200);
  const kTot2 = (await pg.textContent('#ki-total')).trim(), kEsp2 = (await pg.textContent('#ki-espera')).trim();
  // Exportaciones 07 y 08 con conciliación
  const f07 = await bajar('#b-x07', dir); const f08 = await bajar('#b-x08', dir);
  const r07 = recalcular(f07, ['Totales!B2', 'Totales!B3', 'Totales!B4']);
  const r08 = recalcular(f08, ['Indicadores!B2', 'Indicadores!B4', 'Indicadores!E4', 'META!B13', 'META!B15']);
  anota('Excel 07 recalculado concilia con la pantalla', !r07.errores.length && Math.abs(r07.valores['Totales!B2'] - num(kTot2)) < 0.005 && Math.abs(r07.valores['Totales!B3'] - num(kEsp2)) < 0.005, `${path.basename(f07)} · pantalla ${kTot2}/${kEsp2} · Excel ${r07.valores['Totales!B2'].toFixed(2)}/${r07.valores['Totales!B3'].toFixed(2)} · ${r07.valores['Totales!B4']} paradas · errores ${r07.errores.length} · hojas ${r07.hojas.join(',')}`);
  anota('Excel 08 recalculado con META y SHA-256 del 06', !r08.errores.length && Math.abs(r08.valores['Indicadores!B2'] - num(kTot2)) < 0.005 && /^[0-9a-f]{64}$/.test(r08.valores['META!B15']), `horas ${r08.valores['Indicadores!B2'].toFixed(2)} · % espera (fórmula) ${Number(r08.valores['Indicadores!B4']).toFixed(1)} · corrida ${r08.valores['META!B13']} · SHA06 ${String(r08.valores['META!B15']).slice(0, 12)}… · errores ${r08.errores.length}`);
  // Simulación reproducible y exportación 09
  await pg.click('.pestana:has-text("Simulación")');
  await pg.click('#b-simular'); await pg.waitForSelector('#sim-res');
  const s1 = { id: await pg.textContent('#sim-id'), A: await pg.textContent('[data-costo="A"]'), B: await pg.textContent('[data-costo="B"]') };
  await pg.click('#b-simular'); await pg.waitForTimeout(300); await pg.waitForSelector('#sim-res');
  const s2 = { id: await pg.textContent('#sim-id'), A: await pg.textContent('[data-costo="A"]'), B: await pg.textContent('[data-costo="B"]') };
  const avRep = (await pg.textContent('#avisos')).replace(/\s+/g, ' ');
  anota('Simulación reproducible con la misma semilla', JSON.stringify(s1) === JSON.stringify(s2) && /no se duplicó/.test(avRep), `${s1.id}: A ${s1.A} · B ${s1.B} (repetición idéntica; la corrida no se duplica)`);
  await pg.click('.pestana:has-text("Indicadores")'); await pg.click('[data-a="prescriptiva"]'); await pg.waitForTimeout(300);
  const pr0103 = await pg.$eval('#tabla-prescr tr[data-pieza="0103"]', t => [t.cells[2].textContent, t.cells[3].textContent]);
  anota('Prescriptiva y Simulación dan las mismas cifras', num(pr0103[0]).toFixed(2) === num(s1.A).toFixed(2) && num(pr0103[1]).toFixed(2) === num(s1.B).toFixed(2), `Prescriptiva 0103: A ${pr0103[0]} · B ${pr0103[1]} = Simulación A ${s1.A} · B ${s1.B}`);
  await pg.click('.pestana:has-text("Simulación")'); await pg.waitForSelector('#sim-res');
  const f09 = await bajar('#b-x09', dir);
  const r09 = recalcular(f09, ['META!B13', 'META!B18', 'META!B22', 'META!B23', 'Escenarios!B2', 'Escenarios!C2', 'Escenarios!B20', 'Escenarios!C20']);
  const v = r09.valores;
  anota('Excel 09: horizonte, política, semilla y conciliación', !r09.errores.length && v['META!B13'] === s1.id && String(v['META!B22']) === '20261119' && Math.abs(v['Escenarios!B20'] - num(s1.A)) < 0.01 && Math.abs(v['Escenarios!C20'] - num(s1.B)) < 0.01,
    `corrida ${v['META!B13']} · horizonte ${v['META!B18']} días · semilla ${v['META!B22']} · repeticiones ${v['META!B23']} · costo A pantalla ${s1.A} = promedio de réplicas ${v['Escenarios!B20'].toFixed(2)} · errores ${r09.errores.length}`);
  await pg.check('#p-inmediata'); await pg.click('#b-simular'); await pg.waitForTimeout(300); await pg.waitForSelector('#sim-res');
  const eA = await pg.textContent('[data-espera="A"]'), eB = await pg.textContent('[data-espera="B"]');
  anota('Reposición inmediata: espera por suministro cero', eA.trim() === '0.00 h' && eB.trim() === '0.00 h', `espera A ${eA} · espera B ${eB}`);
  // Denominador con Excel de prueba
  await pg.click('.pestana:has-text("Inicio")');
  const [fc] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('#b-excel')]);
  await fc.setFiles(path.resolve('datos/prueba_06_denominador.xlsx')); await pg.click('.dialogo button:has-text("Confirmar carga")'); await pg.waitForSelector('.capa-progreso', { state: 'detached' }); await pg.waitForTimeout(150); await pg.waitForTimeout(300);
  await pg.click('.pestana:has-text("Indicadores")'); await pg.click('[data-r="todo"]'); await pg.waitForTimeout(200);
  await pg.fill('#fi-desde', '2026-10-01T00:00'); await pg.dispatchEvent('#fi-desde', 'change'); await pg.waitForTimeout(200);
  const ei = (await pg.textContent('#ki-esp-int')).trim(), eiTxt = (await pg.$eval('#ki-esp-int', e => e.nextElementSibling.textContent));
  anota('Denominador: espera media por intervención que requirió la pieza', ei === '2.00 h' && /4\.00 h de espera \/ 2 intervenciones/.test(eiTxt), `${ei} = ${eiTxt} (la primera intervención tiene 2 líneas de consumo y no cambia el denominador)`);
  anota('Sin solicitudes de red ni errores de página', red.length === 0, red.join(' ; ') || '0');
  await ctx.close();
  for (const f of [f07, f08, f09]) fs.copyFileSync(f, path.join('pruebas', path.basename(f)));
  fs.writeFileSync('pruebas/resultado_i13_html.json', JSON.stringify({ html: HTML, fecha: new Date().toISOString(), casos: res }, null, 1));
  process.exit(res.some(r => r.resultado === 'FALLA') ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
