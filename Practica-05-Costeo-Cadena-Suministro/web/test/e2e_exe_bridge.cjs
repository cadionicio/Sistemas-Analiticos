// Simula el puente del host Go (hostInfo/hostDbLoad/hostDbSave/hostExport) para probar el adaptador EXE.
const { chromium } = require("playwright"); const path = require("path"); const fs = require("fs");
(async () => {
  const file = "file://" + path.resolve(process.argv[2]);
  const dbFile = "/tmp/claude-0/exe_sim/pc05.sqlite"; fs.mkdirSync(path.dirname(dbFile), { recursive: true }); try { fs.unlinkSync(dbFile); } catch {}
  const res = {};
  for (const ronda of [1, 2]) {
    const b = await chromium.launch(); const page = await (await b.newContext({ offline: true })).newPage();
    const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    await page.exposeFunction("__load", () => (fs.existsSync(dbFile) ? fs.readFileSync(dbFile).toString("base64") : ""));
    await page.exposeFunction("__save", (b64) => { const d = Buffer.from(b64, "base64"); fs.writeFileSync(dbFile, d); return { ok: true, bytes: d.length, path: dbFile, at: new Date().toISOString() }; });
    await page.addInitScript(() => { window.hostInfo = async () => ({ host: "EXE", dbPath: "C:\\Users\\X\\AppData\\Local\\PC05\\data\\pc05.sqlite" }); window.hostDbLoad = () => window.__load(); window.hostDbSave = (b) => window.__save(b); window.hostExport = async (n) => ({ ok: true, path: "C:\\Users\\X\\Documents\\PC05_Exportaciones\\" + n }); });
    await page.goto(file); await page.waitForSelector(".topnav");
    if (ronda === 1) { await page.click('[data-act="seed"]'); await page.click('[data-tab="asignacion"]'); await page.click('[data-act="run-p3"]'); await page.waitForTimeout(500); }
    else { await page.click('[data-tab="asignacion"]'); }
    res["ronda" + ronda] = { estado: await page.textContent(".ctxbar .pill"), pie: await page.textContent("footer"), errores: errs, bytes_en_disco: fs.existsSync(dbFile) ? fs.statSync(dbFile).size : 0 };
    if (ronda === 2) await page.screenshot({ path: "/tmp/claude-0/e2e/08_modo_exe_simulado.png" });
    await b.close();
  }
  console.log(JSON.stringify(res, null, 1));
})();
