// Pruebas de aceptación I1.2 (sección 5 del megaprompt) recorriendo la interfaz del HTML final sin red.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path'); const fs = require('fs'); const os = require('os');
const HTML = path.resolve(process.argv[2]);
const res = []; const red = [];
const anota = (caso, ok, obs) => { res.push({ caso, resultado: ok ? 'PASA' : 'FALLA', observado: obs }); console.log((ok ? 'PASA ' : 'FALLA') + ' · ' + caso + ' · ' + obs); };
let pg;
const form = async (vals, boton) => {
  await pg.waitForSelector('form.formulario');
  for (const [k, v] of Object.entries(vals)) {
    const el = await pg.$(`#f-${k}`); const tag = await el.evaluate(e => e.tagName + ':' + e.type);
    if (tag.startsWith('SELECT')) await el.selectOption(String(v)); else if (tag.endsWith('checkbox')) { if (v) await el.check(); } else await el.fill(String(v));
  }
  await pg.click(boton ? `form.formulario button:has-text("${boton}")` : 'form.formulario button[type=submit]');
  await pg.waitForTimeout(350);
};
const ultimoAviso = async () => (await pg.textContent('#avisos .aviso span')).trim();
const pestana = async t => { await pg.click(`.pestana:has-text("${t}")`); await pg.waitForTimeout(150); };
const filtroParadas = async (eq, desde, hasta, corte) => {
  await pg.selectOption('#f-eq', eq);
  await pg.fill('#f-desde', desde); await pg.fill('#f-hasta', hasta); await pg.fill('#f-corte', corte || '');
  await pg.dispatchEvent('#f-corte', 'change'); await pg.waitForTimeout(150);
};
const abrirParada = async cod => { if (!(await pg.$(`#det-${cod}`))) await pg.click(`tr[data-parada="${cod}"]`); await pg.waitForSelector(`#det-${cod}`); };
const tramo = async (cod, tipo, inst, ev = '') => { await abrirParada(cod); await pg.click('#b-tramo'); await form({ tipo, instante: inst, evidencia: ev }); await pg.waitForTimeout(100); };
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpr12-'));
  const lanzar = async () => {
    const ctx = await chromium.launchPersistentContext(dir, { executablePath: '/usr/bin/google-chrome', headless: true, viewport: { width: 1366, height: 768 }, locale: 'es-PE', args: ['--lang=es-PE'] });
    ctx.on('request', r => { if (!/^(file|data|blob):/.test(r.url())) red.push(r.url()); });
    await ctx.route(/^https?:/, r => r.abort());
    const p = ctx.pages()[0] || await ctx.newPage();
    p.on('pageerror', e => red.push('ERROR ' + e.message));
    await p.goto('file://' + HTML); await p.waitForSelector('#b-ingresar'); await p.click('#b-ingresar'); await p.waitForSelector('#vista .tarjeta');
    return [ctx, p];
  };
  let ctx; [ctx, pg] = await lanzar();
  await pg.click('#b-demo'); await pg.click('.dialogo button:has-text("Confirmar carga")'); await pg.waitForSelector('.capa-progreso', { state: 'detached' }); await pg.waitForTimeout(150); await pg.waitForSelector('#conteos');
  anota('Tabla de conteos restituida en Inicio', (await pg.$$('#conteos table tbody tr')).length === 17, 'Tabla Hoja · En la base · En el archivo · Estado (dos columnas)');

  // ---- Tiempo completo y diagnóstico ----
  await pestana('Paradas');
  await pg.click('#b-nueva'); await form({ equipo: 'P-01', inicio: '2026-11-17T08:00', sintoma: 'Patinaje de correa y caída de producción' });
  const avisoReg = await ultimoAviso(); const cod = /PAR-\d{4}/.exec(avisoReg)[0];
  await tramo(cod, 'DIAGNOSTICO', '2026-11-17T08:00');
  await tramo(cod, 'ESPERA_REPUESTO', '2026-11-17T09:00', 'Correa de transmisión sin disponible; pedido urgente');
  await tramo(cod, 'REPARACION', '2026-11-17T13:00');
  await abrirParada(cod); await pg.click('#b-verif'); await form({ resultado: 'APTO', instante: '2026-11-17T14:00', observacion: '' });
  const rechazoVerif = await ultimoAviso();
  anota('Verificación solo después del tramo de verificación', /Verificación/.test(rechazoVerif), rechazoVerif);
  await tramo(cod, 'VERIFICACION', '2026-11-17T15:00');
  await abrirParada(cod); await pg.click('#b-diag'); await form({ modo: 'MF-04', estado_causa: 'HIPOTESIS', causa: 'Correa estirada por tensión insuficiente', evidencia: '' });
  const avDiag = await ultimoAviso();
  await abrirParada(cod); await pg.click('#b-verif'); await form({ resultado: 'APTO', instante: '2026-11-17T16:00', observacion: 'Produce a ritmo nominal' });
  await filtroParadas('P-01', '2026-11-17T00:00', '2026-11-18T00:00', '');
  const kTot = await pg.textContent('#k-total'), kEsp = await pg.textContent('#k-espera');
  const minFecha = await pg.getAttribute('#tabla-fechas tr[data-fecha="2026-11-17"]', 'data-min');
  anota('Tiempo completo (08:00–16:00)', kTot.trim() === '8.00 h' && kEsp.trim() === '4.00 h' && minFecha === '480', `${cod}: total ${kTot}, espera ${kEsp}, minutos del 17/11 = ${minFecha}`);
  await filtroParadas('P-01', '2026-11-17T10:00', '2026-11-17T14:00', '');
  const dist = await pg.$$eval('#distribucion [data-tipo]', ds => Object.fromEntries(ds.map(d => [d.dataset.tipo, Number(d.dataset.min)])));
  const kTot2 = await pg.textContent('#k-total');
  anota('Filtro parcial (10:00–14:00)', kTot2.trim() === '4.00 h' && dist.ESPERA_REPUESTO === 180 && dist.REPARACION === 60 && Object.keys(dist).length === 2, `total ${kTot2}; espera ${dist.ESPERA_REPUESTO} min; reparación ${dist.REPARACION} min`);
  const filaP = await pg.$eval(`tr[data-parada="${cod}"]`, tr => [...tr.cells].map(c => c.textContent.trim()).join(' | '));
  anota('Diagnóstico con hipótesis y posible reincidencia', /PAR-0017/.test(avDiag) && /Hipótesis/.test(filaP) && /Posible, por confirmar/.test(filaP) && /PAR-0017/.test(filaP), `${avDiag} · fila: ${filaP}`);
  // Fecha parcial: se mantiene el filtro anterior
  await pg.fill('#f-desde', ''); await pg.dispatchEvent('#f-desde', 'change'); await pg.waitForTimeout(150);
  const nota = await pg.textContent('#nota-filtro'); const kTot3 = await pg.textContent('#k-total');
  anota('Fecha incompleta conserva el filtro', /se mantiene el filtro anterior/.test(nota) && kTot3.trim() === '4.00 h' && await pg.isVisible('.pestana:has-text("Inicio")'), `${nota} · total sigue ${kTot3}`);

  // ---- Intervalos y corte · Continuidad (equipo E-01) ----
  await pestana('Inicio'); await pestana('Paradas');
  await pg.click('#b-nueva'); await form({ equipo: 'E-01', inicio: '2026-11-17T23:30', sintoma: 'Ventilador detenido' });
  const codE = /PAR-\d{4}/.exec(await ultimoAviso())[0];
  await filtroParadas('E-01', '2026-11-17T00:00', '2026-11-19T00:00', '2026-11-18T00:30');
  const f17 = await pg.getAttribute('#tabla-fechas tr[data-fecha="2026-11-17"]', 'data-min');
  const f18 = await pg.getAttribute('#tabla-fechas tr[data-fecha="2026-11-18"]', 'data-min');
  const kE = await pg.textContent('#k-total');
  anota('Intervalos y corte (23:30, corte 00:30)', f17 === '30' && f18 === '30' && kE.trim() === '1.00 h', `17/11: ${f17} min · 18/11: ${f18} min · total ${kE}`);
  await pg.click('#b-nueva'); await form({ equipo: 'E-01', inicio: '2026-11-18T00:10', sintoma: 'Segundo aviso' });
  const rech = await ultimoAviso();
  anota('Segundo incidente simultáneo rechazado', /ya tiene la parada/.test(rech), rech);
  await filtroParadas('E-01', '2026-11-17T00:00', '2026-11-19T00:00', '');
  await tramo(codE, 'REPARACION', '2026-11-18T01:00');
  await tramo(codE, 'VERIFICACION', '2026-11-18T02:00');
  await abrirParada(codE); await pg.click('#b-verif'); await form({ resultado: 'NO_APTO', instante: '2026-11-18T02:30', observacion: 'Temperatura sigue alta' });
  const sigueAbierta = (await pg.textContent(`tr[data-parada="${codE}"]`)).includes('Abierta');
  await tramo(codE, 'VERIFICACION', '2026-11-18T03:00');
  await abrirParada(codE); await pg.click('#b-verif'); await form({ resultado: 'APTO', instante: '2026-11-18T03:30', observacion: 'Temperatura normal' });
  const nE = await pg.$$eval('tr[data-parada]', t => t.length);
  const ver = await pg.$$eval(`#det-${codE} .bloques-detalle table`, ts => ts.map(t => t.textContent).join(' '));
  anota('Continuidad: retorno fallido y luego apto', sigueAbierta && nE === 1 && /No apto/.test(ver) && /Apto/.test(ver), `tras NO APTO sigue abierta=${sigueAbierta}; paradas de E-01 en el período=${nE}`);

  // ---- Almacén: físico 5, reservado 2 → consumir 2 y reintentar ----
  await pestana('Órdenes y repuestos');
  const antes = await pg.$eval('#tabla-existencias tr[data-pieza="0105"]', t => [t.dataset.fisico, t.dataset.reservado, t.dataset.disponible].join('/'));
  const ot = await pg.$$eval('tr[data-orden]', ts => ts.find(t => t.cells[3].textContent === 'TP-04' && t.cells[6].textContent === '1').dataset.orden);
  await pg.click(`tr[data-orden="${ot}"]`); await pg.click('[data-entregar]');
  await form({ cantidad: 2, fecha_efectiva: '2026-11-18T08:00' }, 'Confirmar entrega');
  await pg.waitForTimeout(150);
  const desp = await pg.$eval('#tabla-existencias tr[data-pieza="0105"]', t => [t.dataset.fisico, t.dataset.reservado, t.dataset.disponible].join('/'));
  await pg.click('#avisos button:has-text("Reintentar envío")'); await pg.waitForTimeout(150);
  const avRe = await ultimoAviso();
  const desp2 = await pg.$eval('#tabla-existencias tr[data-pieza="0105"]', t => [t.dataset.fisico, t.dataset.reservado, t.dataset.disponible].join('/'));
  if (!(await pg.$('#tabla-consumos'))) await pg.click(`tr[data-orden="${ot}"]`);
  const nCons = await pg.$$eval('#tabla-consumos tbody tr', t => t.length);
  anota('Almacén: consumo de reserva', antes === '5/2/3' && desp === '3/0/3', `${ot}: antes ${antes} → después ${desp} (físico/reservado/disponible)`);
  anota('Reintento de consumo sin duplicar', /no se duplicó/.test(avRe) && desp2 === '3/0/3' && nCons === 1, `${avRe} · saldo ${desp2} · consumos en la orden: ${nCons}`);
  // ---- Corte histórico ----
  await pg.fill('#f-corte-ex', '2026-11-17T23:59'); await pg.dispatchEvent('#f-corte-ex', 'change'); await pg.waitForTimeout(100);
  const ayer = await pg.getAttribute('#tabla-existencias tr[data-pieza="0105"]', 'data-fisico');
  await pg.click('#tabla-existencias tr[data-pieza="0105"]');
  const movTxt = await pg.textContent('#tabla-movimientos tbody tr');
  await pg.fill('#f-corte-ex', '2026-04-30T12:00'); await pg.dispatchEvent('#f-corte-ex', 'change'); await pg.waitForTimeout(100);
  const nd = await pg.getAttribute('#tabla-existencias tr[data-pieza="0105"]', 'data-fisico');
  await pg.click('#b-corte-hoy'); await pg.waitForTimeout(100);
  const hoy = await pg.getAttribute('#tabla-existencias tr[data-pieza="0105"]', 'data-fisico');
  anota('Corte histórico', ayer === '5' && hoy === '3' && nd === 'ND' && /CONSUMO|consumo/.test(movTxt), `ayer ${ayer}, hoy ${hoy}; antes del saldo inicial: no disponible; último movimiento: ${movTxt.replace(/\s+/g, ' ').slice(0, 90)}`);

  // ---- Preventivo ----
  await pestana('Preventivo');
  const est1 = await pg.getAttribute('tr[data-tarea="TP-01"]', 'data-estado');
  await pg.click('tr[data-tarea="TP-01"]'); await pg.click('#b-ejec');
  await form({ vencimiento: '2026-11-08', inicio: '2026-11-17T22:00', fin: '2026-11-17T23:00', resultado: 'CONFORME', evidencia: 'Holgura 0.2 mm registrada' });
  const est2 = await pg.getAttribute('tr[data-tarea="TP-01"]', 'data-estado');
  anota('Preventivo: tarea crítica vencida y luego ejecutada', est1 === 'Vencida' && (est2 === 'Al día' || est2 === 'Por vencer'), `TP-01: ${est1} → ${est2}`);

  // ---- Ingreso, responsables con PIN y gestor de usuarios ----
  const salir = async () => { await pg.click('#b-salir'); await pg.waitForSelector('#form-ingreso'); };
  const ingresar = async (cod, pin) => {
    if (cod) { if (await pg.isChecked('#sw-demo')) await pg.click('.interruptor'); await pg.selectOption('#i-usuario', cod); await pg.fill('#i-pin', pin); }
    else if (!(await pg.isChecked('#sw-demo'))) await pg.click('.interruptor');
    await pg.click('#b-ingresar'); await pg.waitForTimeout(250);
  };
  await salir();
  const demoPorDefecto = await pg.isChecked('#sw-demo') && await pg.isHidden('#zona-resp');
  await pg.click('.interruptor'); const listaVisible = await pg.isVisible('#i-usuario');
  await ingresar('ALM-01', '0000'); const malPin = await pg.textContent('#error-ingreso');
  await ingresar('ALM-01', '3333');
  await pestana('Paradas'); const deshab = await pg.$eval('#b-nueva', b => b.disabled + ' · ' + b.title);
  await pestana('Usuarios'); const usrDis = await pg.$eval('#b-nuevo-usuario', b => b.disabled);
  const usr = await pg.textContent('#usuario-actual');
  anota('Pantalla de ingreso: demostración por defecto y responsable con PIN', demoPorDefecto && listaVisible && /incorrecto/.test(malPin) && deshab.startsWith('true') && usrDis && /Jefe de almacén/.test(usr), `demostración activa al abrir=${demoPorDefecto}; al desactivar aparece la lista=${listaVisible}; ${malPin.trim()}; ingresó «${usr.trim()}»; Registrar parada: ${deshab}; Nuevo usuario deshabilitado=${usrDis}`);
  await salir(); await ingresar(null);
  await pestana('Usuarios'); await pg.click('#b-nuevo-usuario');
  await form({ nombre: 'Rosa Quispe', rol: 'PRODUCCION', pin: '5555', pin2: '5555' });
  const avU = await ultimoAviso(); const codU = /USR-\d{4}/.exec(avU)[0];
  await pg.click('#b-nuevo-usuario'); await form({ nombre: 'rosa quispe', rol: 'ALMACEN', pin: '1234', pin2: '1234' });
  const dup = await ultimoAviso();
  await salir(); await ingresar(codU, '5555');
  const usr2 = await pg.textContent('#usuario-actual');
  await pestana('Paradas'); const hab = await pg.$eval('#b-nueva', b => !b.disabled);
  anota('Gestor de usuarios: crear usuario y entrar con su PIN', /creado/.test(avU) && /Ya existe/.test(dup) && /Rosa Quispe · Producción/.test(usr2) && hab, `${avU} · duplicado: ${dup} · ingresó «${usr2.trim()}» · Registrar parada habilitado=${hab}`);
  await salir(); await ingresar('JMT-01', '4444');
  await pestana('Usuarios'); await pg.click(`[data-pin="${codU}"]`); await form({ pin: '7777', pin2: '7777' });
  await pg.click(`[data-estado="${codU}"]`); await pg.waitForTimeout(300);
  const est = await pg.getAttribute(`tr[data-usuario="${codU}"]`, 'data-activo');
  await pg.click('[data-estado="JMT-01"]'); await pg.waitForTimeout(300); const propio = await ultimoAviso();
  await salir(); await pg.click('.interruptor');
  const enLista = await pg.$$eval('#i-usuario option', os => os.map(o => o.value));
  anota('Gestor de usuarios: cambiar PIN, desactivar y protecciones', est === '0' && !enLista.includes(codU) && /propio usuario/.test(propio), `${codU} inactivo=${est === '0'}; ya no aparece para ingresar=${!enLista.includes(codU)}; desactivarse a sí mismo: ${propio}`);
  await ingresar(null);

  // ---- Persistencia ----
  await ctx.close(); [ctx, pg] = await lanzar();
  const n = await pg.getAttribute('#conteos tr[data-hoja="Paradas"]', 'data-n');
  const nc = await pg.getAttribute('#conteos tr[data-hoja="Consumos"]', 'data-n');
  anota('Persistencia de operaciones al reabrir', n === '22' && nc === '17', `paradas ${n}, consumos ${nc}`);
  anota('Sin solicitudes de red ni errores de página', red.length === 0, red.join(' ; ') || '0');
  await pestana('Paradas'); await pg.screenshot({ path: 'pruebas/i12_paradas.png' });
  await ctx.close();
  fs.writeFileSync('pruebas/resultado_i12_html.json', JSON.stringify({ html: HTML, fecha: new Date().toISOString(), casos: res }, null, 1));
  process.exit(res.some(r => r.resultado === 'FALLA') ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
