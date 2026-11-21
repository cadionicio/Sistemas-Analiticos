// Pruebas I2.1: volumen, interfaz a dos resoluciones (sin desbordes), fecha parcial, cancelación y menú operativo.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path'); const fs = require('fs');
const HTML = path.resolve(process.argv[2]);
const res = []; const red = [];
const anota = (caso, ok, obs) => { res.push({ caso, resultado: ok ? 'PASA' : 'FALLA', observado: obs }); console.log((ok ? 'PASA ' : 'FALLA') + ' · ' + caso + ' · ' + obs); };
const PEST = ["Inicio", "Paradas", "Órdenes y repuestos", "Preventivo", "Indicadores", "Simulación", "Exportar resultados", "Usuarios", "Datos y respaldos"];
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
  // ---- Volumen ----
  {
    const ctx = await b.newContext({ viewport: { width: 1366, height: 768 }, locale: 'es-PE' });
    // Registra cada aparición del indicador de progreso (la página puede estar ocupada mientras valida)
    await ctx.addInitScript(() => { window.__progresos = []; new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.classList && n.classList.contains('capa-progreso')) window.__progresos.push(n.querySelector('h2').textContent); }))).observe(document, { childList: true, subtree: true }); });
    const pg = await ctx.newPage(); pg.on('pageerror', e => red.push(e.message));
    await pg.goto('file://' + HTML); await pg.click('#b-ingresar'); await pg.waitForSelector('#b-excel');
    const arch = path.resolve('datos/prueba_06_volumen_5anios.xlsx');
    const t0 = Date.now();
    const [fc] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('#b-excel')]);
    await fc.setFiles(arch);
    await pg.waitForSelector('.dialogo button:has-text("Confirmar carga")', { timeout: 120000 });
    const progLect = (await pg.evaluate(() => window.__progresos)).includes('Leyendo el Excel 06');
    const tVal = Date.now() - t0;
    const t1 = Date.now();
    await pg.click('.dialogo button:has-text("Confirmar carga")');
    await pg.waitForSelector('#conteos', { timeout: 180000 });
    const progEsc = (await pg.evaluate(() => window.__progresos)).includes('Cargando datos');
    const tCarga = Date.now() - t1;
    const nPar = await pg.getAttribute('#conteos tr[data-hoja="Paradas"]', 'data-n'), nTr = await pg.getAttribute('#conteos tr[data-hoja="Tramos"]', 'data-n');
    const t2 = Date.now(); await pg.click('.pestana:has-text("Indicadores")'); await pg.waitForSelector('#hallazgos', { timeout: 120000 }); const tInd = Date.now() - t2;
    const t3 = Date.now(); await pg.click('.pestana:has-text("Paradas")'); await pg.waitForSelector('#tabla-paradas', { timeout: 120000 }); const tPar = Date.now() - t3;
    await pg.click('.pestana:has-text("Simulación")'); await pg.waitForSelector('#b-simular');
    const t4 = Date.now(); await pg.click('#b-simular'); await pg.waitForSelector('#sim-res', { timeout: 120000 }); const progSim = (await pg.evaluate(() => window.__progresos)).includes('Simulación de reposición'); const tSim = Date.now() - t4;
    const kb = Math.round(fs.statSync(arch).size / 1024);
    anota('Volumen: historial sintético de 5 años', nPar === '1957' && nTr === '8038' && progLect && progEsc && progSim,
      `${kb} KB, ${nPar} paradas, ${nTr} tramos · lectura y validación ${tVal} ms · escritura y guardado ${tCarga} ms · Indicadores ${tInd} ms · Paradas ${tPar} ms · simulación 2000 réplicas + sensibilidad ${tSim} ms · progreso visible en lectura/escritura/simulación: ${progLect}/${progEsc}/${progSim} · equipo: contenedor Linux, Chrome sin interfaz`);
    await ctx.close();
  }
  // ---- Interfaz a dos resoluciones ----
  for (const [w, h] of [[1366, 768], [1920, 1080]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, locale: 'es-PE' });
    const pg = await ctx.newPage(); pg.on('pageerror', e => red.push(e.message));
    await pg.goto('file://' + HTML); await pg.click('#b-ingresar');
    await pg.click('#b-demo'); await pg.click('.dialogo button:has-text("Confirmar carga")'); await pg.waitForSelector('#conteos');
    const desb = [];
    fs.mkdirSync('pruebas/pantallas', { recursive: true });
    for (const t of PEST) {
      await pg.click(`.pestana:has-text("${t}")`); await pg.waitForTimeout(250);
      if (t === 'Simulación') { await pg.click('#b-simular'); await pg.waitForSelector('#sim-res'); }
      await pg.evaluate(() => document.querySelectorAll('.aviso').forEach(a => a.remove()));
      const o = await pg.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      if (o.sw > o.cw + 1) desb.push(`${t} (${o.sw}>${o.cw})`);
      await pg.screenshot({ path: `pruebas/pantallas/${w}x${h}_${PEST.indexOf(t) + 1}.png`, fullPage: true });
    }
    anota(`Interfaz a ${w}×${h}: 9 pantallas sin desborde horizontal`, desb.length === 0, desb.length ? desb.join(', ') : '9 pantallas revisadas; imágenes de revisión en pruebas/pantallas');
    if (w === 1366) {
      await pg.click('.pestana:has-text("Indicadores")');
      const antes = await pg.textContent('#ki-total');
      await pg.fill('#fi-desde', ''); await pg.dispatchEvent('#fi-desde', 'change'); await pg.waitForTimeout(200);
      const nota = await pg.textContent('#nota-ind'); const desp = await pg.textContent('#ki-total');
      await pg.click('.pestana:has-text("Inicio")'); await pg.click('#b-demo'); await pg.waitForSelector('.dialogo'); await pg.click('.dialogo button:has-text("Cancelar")');
      const n = await pg.getAttribute('#conteos tr[data-hoja="Paradas"]', 'data-n');
      await pg.click('.pestana:has-text("Preventivo")'); const menu = await pg.isVisible('#tabla-tareas');
      anota('Interfaz: fecha parcial, cancelar demostración y menú operativo', /se mantiene el filtro anterior/.test(nota) && antes === desp && n === '20' && menu, `Indicadores conserva ${desp.trim()} · ${nota.trim()} · tras cancelar la demostración: ${n} paradas · menú operativo: ${menu}`);
    }
    await ctx.close();
  }
  anota('Sin errores de página', red.length === 0, red.join(' ; ') || '0');
  await b.close();
  fs.writeFileSync('pruebas/resultado_i21_html.json', JSON.stringify({ html: HTML, fecha: new Date().toISOString(), casos: res }, null, 1));
  process.exit(res.some(r => r.resultado === 'FALLA') ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
