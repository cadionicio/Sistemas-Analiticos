// Simula el puente del EXE con transferencia por bloques (hostDbInfo / hostDbLoadChunk / hostDbSaveBegin /
// hostDbSaveChunk / hostDbSaveCommit / hostExportCommit) con una base grande: cargar la demostración,
// cerrar, reabrir y comprobar que todo se conserva. Registra el tamaño máximo de cada mensaje.
const { chromium } = require("playwright"); const path = require("path"); const fs = require("fs");
(async () => {
  const file = "file://" + path.resolve(process.argv[2]);
  const dir = "/tmp/claude-0/exe_bloques"; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const dbFile = dir + "/costeo.sqlite";
  const res = { mensajeMaximo: 0 };
  for (const ronda of [1, 2]) {
    const b = await chromium.launch(); const page = await (await b.newContext({ offline: true, acceptDownloads: true })).newPage();
    const errs = []; page.on("pageerror", (e) => errs.push(e.message)); page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
    let carga = null; const bufs = {};
    const nota = (s) => { res.mensajeMaximo = Math.max(res.mensajeMaximo, s.length); return s; };
    await page.exposeFunction("__info", () => { if (!fs.existsSync(dbFile)) { carga = null; return { exists: false, size: 0 }; } carga = fs.readFileSync(dbFile); return { exists: true, size: carga.length }; });
    await page.exposeFunction("__chunk", (off, len) => nota(carga ? carga.subarray(off, off + len).toString("base64") : ""));
    await page.exposeFunction("__begin", () => { const id = String(Date.now() + Math.random()); bufs[id] = []; return id; });
    await page.exposeFunction("__schunk", (id, b64) => { nota(b64); if (!bufs[id]) return false; bufs[id].push(Buffer.from(b64, "base64")); return true; });
    await page.exposeFunction("__commit", (id) => { const d = Buffer.concat(bufs[id] || []); delete bufs[id]; if (d.subarray(0, 15).toString() !== "SQLite format 3") return { ok: false, error: "inválido" }; fs.writeFileSync(dbFile, d); return { ok: true, bytes: d.length, path: dbFile, at: new Date().toISOString() }; });
    await page.exposeFunction("__save", (b64) => { nota(b64); const d = Buffer.from(b64, "base64"); fs.writeFileSync(dbFile, d); return { ok: true, bytes: d.length, path: dbFile, at: new Date().toISOString() }; });
    await page.exposeFunction("__expc", (id, n) => { const d = Buffer.concat(bufs[id] || []); delete bufs[id]; fs.writeFileSync(dir + "/" + n, d); return { ok: true, path: dir + "\\" + n }; });
    await page.exposeFunction("__exp", (n, b64) => { nota(b64); fs.writeFileSync(dir + "/" + n, Buffer.from(b64, "base64")); return { ok: true, path: dir + "\\" + n }; });
    await page.addInitScript(() => {
      window.hostInfo = async () => ({ host: "EXE", dbPath: "C:\\Users\\X\\AppData\\Local\\CosteoCadenaSuministro\\data\\costeo.sqlite" });
      window.hostDbLoad = async () => { throw new Error("no debe usarse la carga en un solo mensaje"); };
      window.hostDbInfo = () => window.__info(); window.hostDbLoadChunk = (o, l) => window.__chunk(o, l);
      window.hostDbSaveBegin = () => window.__begin(); window.hostDbSaveChunk = (i, b) => window.__schunk(i, b); window.hostDbSaveCommit = (i) => window.__commit(i);
      window.hostDbSave = (b) => window.__save(b); window.hostExport = (n, b) => window.__exp(n, b); window.hostExportCommit = (i, n) => window.__expc(i, n);
    });
    const t0 = Date.now(); await page.goto(file); await page.waitForSelector(".topnav", { timeout: 120000 });
    const msAbrir = Date.now() - t0;
    const r = { msAbrir, errores: errs };
    if (ronda === 1) {
      await page.click('[data-act="demo-cargar"]');
      await page.waitForFunction(() => /Demostración cargada|No se pudo/.test(document.querySelector(".toast")?.textContent || ""), null, { timeout: 300000 });
      r.toast = await page.textContent(".toast");
      await page.waitForFunction(() => !window.__pc05.store.dirty, null, { timeout: 60000 });
      await page.click('[data-tab="inicio"]'); await page.click('[data-act="backup"]'); await page.waitForFunction(() => /espaldo/.test(document.querySelector(".toast")?.textContent || ""), null, { timeout: 60000 }).catch(() => {}); r.toastRespaldo = await page.textContent(".toast");
      r.respaldo = fs.readdirSync(dir).filter((x) => x.endsWith(".sqlite") && x !== "costeo.sqlite").map((x) => ({ x, bytes: fs.statSync(dir + "/" + x).size }));
    } else {
      r.corridas = await page.evaluate(() => window.__pc05.store.one("SELECT COUNT(*) n FROM corrida").n);
      await page.click('[data-tab="resultados"]'); await page.waitForTimeout(800);
      r.kpi = await page.$eval("main .kpi .val", (e) => e.textContent);
      r.boot = await page.evaluate(() => !!document.getElementById("boot"));
    }
    r.bytesEnDisco = fs.existsSync(dbFile) ? fs.statSync(dbFile).size : 0;
    res["ronda" + ronda] = r; await b.close();
  }
  console.log(JSON.stringify(res, null, 1));
})();
