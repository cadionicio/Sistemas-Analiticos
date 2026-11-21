// E2E de los Pasos 10 y 11: copiloto (sin LLM y con un LLM simulado) + informes Word/PDF versionados + presentación PPTX.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
const OUT = 'tests/e2e/paso10_11'; mkdirSync(`${OUT}/salidas`, { recursive: true });
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true }); const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push('pageerror: ' + e.message)); p.on('console', (m) => m.type() === 'error' && !/api\.anthropic\.com|status of 5/.test(m.text()) && errs.push(m.text()));
const r = { copiloto: {}, llm: {}, archivos: {} };
const ir = async (h) => { await p.evaluate((x) => { location.hash = x; }, h); await p.waitForTimeout(700); };
await p.goto('file://' + process.cwd() + '/dist/index.html'); await p.waitForSelector('#d-practica');
await p.click('#d-practica'); await p.waitForFunction(() => !document.querySelector('.velo') && document.querySelector('#kpi-ventas'), null, { timeout: 120000 });
await p.click('#btn-1clic'); await p.waitForTimeout(800); await p.waitForFunction(() => !document.querySelector('.velo'), null, { timeout: 300000 });

// ---------- Paso 10: copiloto sin LLM ----------
await ir('#/copiloto');
const preguntar = async (q) => {
  const n = await p.locator('.burbuja.a').count();
  await p.fill('#q', q); await p.press('#q', 'Enter');
  await p.waitForFunction((k) => document.querySelectorAll('.burbuja.a').length > k && !document.getElementById('pensando'), n, { timeout: 60000 });
  return (await p.locator('.burbuja.a').last().innerText());
};
for (const q of ['¿Cómo va el negocio?', '¿Por qué bajó el margen?', '¿Qué debo comprar el próximo mes?', '¿Cuánto venderemos en junio?', '¿Qué debo hacer?', 'Dime todo sobre MATPRIMA-003', '¿Quién ganó el mundial?']) {
  const t = await preguntar(q); r.copiloto[q] = t.split('\n')[0].slice(0, 140);
}
await p.evaluate(() => document.querySelector('.avisos')?.remove());
await p.screenshot({ path: `${OUT}/01_copiloto_sin_llm.png` });

// ---------- Paso 10: copiloto con LLM simulado (intercepta la API; no sale a internet) ----------
let modo = 'bien';
await p.route('https://api.anthropic.com/**', async (route) => {
  const body = JSON.parse(route.request().postData() ?? '{}');
  r.llm.herramientas = body.tools ?? 'ninguna'; r.llm.system_sin_web = /No tienes acceso a internet/.test(body.system);
  const hechos = body.messages[0].content;
  const ventas = hechos.match(/Ventas de los últimos 12 meses \([^)]*\): \*\*(S\/ [\d,.]+ M)\*\*/)?.[1] ?? '?';
  const texto = modo === 'bien' ? `Según el motor, las ventas de los últimos 12 meses suman ${ventas} [describir_operacion].` : 'Las ventas de los últimos 12 meses suman S/ 1,999.9 M y el margen es 7.77 %.';
  await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ content: [{ type: 'text', text: texto }] }) });
});
await ir('#/configuracion');
await p.selectOption('#f-llm [name=p]', 'anthropic'); await p.fill('#f-llm [name=k]', 'clave-de-prueba'); await p.click('#f-llm button'); await p.waitForTimeout(800);
await p.screenshot({ path: `${OUT}/02_configuracion_llm.png` });
await ir('#/copiloto');
r.llm.verificada = await preguntar('¿Cómo va el negocio?');
modo = 'mal';
r.llm.rechazada = await preguntar('¿Cómo va el negocio?');
await p.evaluate(() => document.querySelector('.avisos')?.remove());
await p.screenshot({ path: `${OUT}/03_copiloto_llm_evaluador.png` });
await ir('#/configuracion'); await p.selectOption('#f-llm [name=p]', 'ninguno'); await p.click('#f-llm button'); await p.waitForTimeout(500);

// ---------- Paso 11: informes y presentación ----------
const bajar = async (sel, nombre) => {
  const t0 = Date.now();
  const [d] = await Promise.all([p.waitForEvent('download', { timeout: 120000 }), p.click(sel)]);
  const f = `${OUT}/salidas/${d.suggestedFilename()}`; await d.saveAs(f); r.archivos[nombre] = { archivo: d.suggestedFilename(), ms: Date.now() - t0 };
  await p.waitForTimeout(900);
};
await ir('#/informes');
await bajar('button[data-acc=gen][data-tipo=tecnico][data-fmt=docx]', 'tecnico_docx');
await bajar('button[data-acc=gen][data-tipo=tecnico][data-fmt=pdf]', 'tecnico_pdf');
await bajar('button[data-acc=gen][data-tipo=ejecutivo][data-fmt=docx]', 'ejecutivo_v1');
// v2: el usuario cambia un supuesto y vuelve a analizar
await ir('#/configuracion'); await p.fill('input[data-par="costo_operacion_anual"]', '250000'); await p.click('button[data-par="costo_operacion_anual"]'); await p.waitForTimeout(700);
await p.click('#btn-1clic'); await p.waitForTimeout(800); await p.waitForFunction(() => !document.querySelector('.velo'), null, { timeout: 300000 });
await ir('#/informes');
await bajar('button[data-acc=gen][data-tipo=ejecutivo][data-fmt=docx]', 'ejecutivo_v2');
// v3: aportes del usuario
await p.fill('#ap-texto', 'Aporte del usuario (prueba E2E): priorizar la conciliación del Kardex en la planta principal y validar con Finanzas el costo real de operación antes de aprobar el presupuesto.');
await p.click('#ap-guardar'); await p.waitForTimeout(500);
await bajar('button[data-acc=gen][data-tipo=ejecutivo][data-fmt=pdf]', 'ejecutivo_v3');
await bajar('button[data-acc=cons][data-fmt=docx]', 'ejecutivo_consolidado_docx');
await bajar('button[data-acc=cons][data-fmt=pdf]', 'ejecutivo_consolidado_pdf');
await bajar('button[data-acc=gen][data-tipo=presentacion]', 'presentacion');
await bajar('button[data-acc=desc][data-tipo=ejecutivo][data-ver="1"][data-fmt=pdf]', 'redescarga_v1_pdf');
await p.evaluate(() => document.querySelector('.avisos')?.remove());
await p.screenshot({ path: `${OUT}/04_informes.png` });
await p.locator('#contenido').evaluate((c) => c.scrollTo(0, c.scrollHeight)); await p.waitForTimeout(300);
await p.screenshot({ path: `${OUT}/05_informes_versiones.png` });
r.cambios_v2v3 = await p.evaluate(() => [...document.querySelectorAll('#inf-raiz table.t tbody tr')].map((tr) => tr.innerText.replace(/\s+/g, ' ').slice(0, 260)));
r.errores = errs;
console.log(JSON.stringify(r, null, 1));
const ok = errs.length === 0 && /cifras verificadas/.test(r.llm.verificada) && /rechazó/.test(r.llm.rechazada) && r.llm.herramientas === 'ninguna' && Object.keys(r.archivos).length === 9;
console.log(ok ? 'E2E PASOS 10-11: OK' : 'E2E PASOS 10-11: FALLA'); await b.close(); process.exit(ok ? 0 : 1);
