// E2E I2: importar M01, M02 y 05 desde la interfaz, ejecutar costeo, recorrer todas las pestañas y matrices.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const [, , html, outDir, refDir, datos] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
(async () => {
  const userDir = fs.mkdtempSync("/tmp/claude-0/pw2-");
  const ctx = await chromium.launchPersistentContext(userDir, { viewport: { width: 1600, height: 900 }, offline: true, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [], requests = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "Clon de prueba T-clonación" : undefined));
  page.on("request", (r) => !/^(file|data|blob):/.test(r.url()) && requests.push(r.url()));
  const res = { modelos: {} };
  await page.goto("file://" + path.resolve(html));
  await page.waitForSelector(".topnav");
  const toast = async () => (await page.$(".toast")) ? (await page.textContent(".toast")) : "";
  const importar = async (sel, file) => {
    await page.click('[data-tab="modelo"]');
    await page.click('[data-sub="gestion"]');
    await page.setInputFiles(`input[data-edit="${sel}"]`, file);
    await page.waitForTimeout(2500);
    return toast();
  };
  const ejecutar = async () => {
    await page.click('[data-tab="asignacion"]');
    await page.click('[data-act="run-abc"]');
    await page.waitForTimeout(1200);
    return { toast: await toast(), estado: await page.textContent(".ctxbar .pill") };
  };
  const recorrer = async (cod) => {
    const shots = {};
    for (const sub of ["p1", "p2", "p3", "p4a", "p4b", "resumen", "p4c", "conciliacion"]) {
      await page.click('[data-tab="asignacion"]');
      await page.click(`[data-sub="${sub}"]`);
      await page.waitForTimeout(200);
      if (["p3", "p4b", "resumen", "conciliacion", "p4a", "p4c"].includes(sub)) {
        const f = `${outDir}/${cod}_${sub}.png`;
        await page.screenshot({ path: f });
        shots[sub] = f;
      }
    }
    const conc = await page.$$eval("table.matrix tbody tr", (r) => r.map((x) => Array.from(x.cells).map((c) => c.textContent.trim()).join(" | ")));
    for (const t of ["maestros", "procesos", "estructuras", "recursos", "personas", "inductores", "modelo"]) {
      await page.click(`[data-tab="${t}"]`);
      await page.waitForTimeout(150);
    }
    await page.click('[data-tab="inductores"]');
    await page.click('[data-sub="catalogo"]');
    await page.screenshot({ path: `${outDir}/${cod}_inductores_catalogo.png` });
    const first = await page.$('[data-act="m2-lab"]');
    if (first) { await first.click(); await page.waitForTimeout(200); await page.screenshot({ path: `${outDir}/${cod}_laboratorio.png`, fullPage: false }); }
    return { conciliacion: conc.slice(0, 16) };
  };
  // M01
  res.modelos.M01 = { importar: await importar("m2-import-profesor", path.join(refDir, "SUPPLY_CHAIN_COSTING_PLANTILLA_PROFESOR.xlsx")) };
  Object.assign(res.modelos.M01, await ejecutar(), await recorrer("M01"));
  // M02
  res.modelos.M02 = { importar: await importar("m2-import-profesor", path.join(refDir, "MODELO_EJEMPLO_APLICATIVO.xlsx")) };
  Object.assign(res.modelos.M02, await ejecutar(), await recorrer("M02"));
  await page.click('[data-tab="modelo"]'); await page.click('[data-sub="comparacion"]'); await page.waitForTimeout(300);
  res.modelos.M02.comparacion = await page.textContent(".alert");
  await page.screenshot({ path: `${outDir}/M02_comparacion_excel.png` });
  // 05
  res.modelos.M03 = { importar: await importar("m2-import-pc05", path.resolve(datos)) };
  Object.assign(res.modelos.M03, await ejecutar(), await recorrer("M03"));
  await page.click('[data-tab="modelo"]'); await page.click('[data-sub="diagrama"]'); await page.waitForTimeout(300);
  await page.screenshot({ path: `${outDir}/M03_diagrama.png`, fullPage: true });
  await page.click('[data-tab="inicio"]');
  await page.screenshot({ path: `${outDir}/M03_inicio.png` });
  res.kpis = await page.$$eval(".kpi", (k) => k.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  // clonar y verificar aislamiento
  await page.click('[data-tab="modelo"]'); await page.click('[data-sub="gestion"]');
  const btn = await page.$$('[data-act="m2-clonar"]');
  await btn[btn.length - 1].click();
  await page.waitForTimeout(1500);
  res.clon = { toast: await toast(), modelos: await page.$$eval("table.matrix tbody tr", (r) => r.map((x) => x.cells[0].textContent + " " + x.cells[1].textContent)) };
  // persistencia tras recarga
  await page.reload(); await page.waitForSelector(".topnav");
  await page.click('[data-tab="modelo"]');
  res.tras_recarga = await page.$$eval("table.matrix tbody tr", (r) => r.length);
  res.errores = errors; res.red = requests;
  await ctx.close();
  console.log(JSON.stringify(res, null, 1));
})();
