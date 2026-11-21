import crypto from 'node:crypto';
// Prueba de extremo a extremo del HTML único (I03): file://, sin red, sin servidor, en 1366×768 y 1920×1080.
// Uso: node tests/e2e_html.mjs <html> <carpetaSalida>
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';

const [html, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const log = [], red = [], consola = [];
const paso = (ok, nombre, det = '') => { log.push({ ok, nombre, det }); console.log((ok ? 'PASA ' : 'FALLA') + ' | ' + nombre + (det ? ' | ' + String(det).slice(0, 220) : '')); };
const perfilDir = fs.mkdtempSync('/tmp/perfil-');
const url = 'file://' + path.resolve(html);
const dialogos = [];
let ctx, page;
async function abrir(viewport) {
  ctx = await chromium.launchPersistentContext(perfilDir, { executablePath: '/usr/bin/google-chrome', headless: true, acceptDownloads: true, offline: true, viewport, locale: 'es-PE', timezoneId: 'America/Lima' });
  ctx.on('request', (r) => { if (!/^(file|data|blob):/.test(r.url())) red.push(r.url()); });
  page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consola.push(m.text()); });
  page.on('pageerror', (e) => consola.push('pageerror: ' + e.message));
  page.on('dialog', (d) => d.accept(dialogos.shift() ?? undefined));
  await page.goto(url);
  await page.waitForSelector('.ingreso, .cabecera');
}
const aviso = async () => (await page.locator('.aviso').first().textContent({ timeout: 20000 })).trim();
const limpiar = async () => { if (await page.locator('.aviso .cerrar').count()) await page.locator('.aviso .cerrar').click(); };
const area = (n) => page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: n }).click();
const sub = (n) => page.getByRole('tab', { name: n }).click();
const PIN = { Ana: '1111', Bruno: '2222', Carla: '3333', Diego: '4444', Elena: '5555', Fabio: '6666', Soporte: '7777' };
/** Cambia de usuario con PIN y, si se indica, navega a un área y pestaña (un ingreso nuevo empieza en la pantalla inicial de su rol). */
let novedadesVistas = false;
const cerrarNov = async () => { const b = page.getByRole('button', { name: 'Entendido' }); if (await b.count()) { novedadesVistas = true; await b.click(); } };
const usuario = async (nombre, a, s) => {
  if (await page.locator('.cabecera').count()) await page.getByRole('button', { name: 'Cambiar de usuario' }).click();
  const corto = nombre.split(' ')[0];
  await page.locator('.tarjeta-usuario', { has: page.locator('strong', { hasText: new RegExp('^' + corto) }) }).first().click();
  await page.getByLabel('PIN').fill(PIN[corto]);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForSelector('.cabecera'); await cerrarNov();
  if (a) await area(a);
  if (s) await sub(s);
};
const descarga = async (fn, nombre) => { const [d] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), fn()]); const p = path.join(out, nombre ?? d.suggestedFilename()); await d.saveAs(p); return { p, sugerido: d.suggestedFilename() }; };
const fila = (id) => page.locator('tbody tr', { has: page.locator('td', { hasText: new RegExp('(^|\\s)' + id + '$') }) }).first();
const boton = (n) => page.getByRole('button', { name: n, exact: true });

try {
await abrir({ width: 1366, height: 768 });
await limpiar();
await usuario('Ana (Datos y administración)');
await page.getByRole('button', { name: 'Cargar demostración' }).click();
paso(/Carga confirmada/.test(await aviso()), 'Inicio: cargar demostración desde estado vacío', await aviso());
paso((await page.locator('.etiqueta-datos').textContent()).includes('DATOS SINTÉTICOS — NutriDemo'), 'Etiqueta de conjunto sintético visible');
paso(await page.locator('.flujo .etapa').count() === 5, 'Inicio muestra el flujo de distribución');

paso(!(await page.getByRole('navigation', { name: 'Secciones' }).textContent()).includes('Operación'), 'Ana (datos y administración) no ve Operación: menú según su rol');
await usuario('Elena (Supervisión)', 'Operación');
await fila('PED-0001').click();
paso(await boton('Reservar (FEFO)').isDisabled(), 'Botón deshabilitado para perfil sin permiso (Supervisión)');
await usuario('Carla (Almacén)', 'Operación');
await fila('PED-0001').click();
await limpiar(); await boton('Reservar (FEFO)').click();
const a1 = await aviso();
const det = await page.locator('.detalle').textContent();
paso(/Reserva realizada/.test(a1) && /A · 40,000/.test(det) && /B · 10,000/.test(det), 'FEFO: PED-0001 toma 40 de A y 10 de B', det.slice(0, 200));
await limpiar(); await fila('PED-0002').click(); await boton('Reservar (FEFO)').click();
paso(/No se reservó nada/.test(await aviso()), 'PED-0002 sin parcialidad e insuficiente: bloqueado', await aviso());

// I04-a: planificar PED-0001 (reservado por Carla) y ejecutarlo hasta la entrega al cliente
await usuario('Diego (Planificación)');
await area('Planificación y entregas');
await fila('PED-0001').getByRole('button', { name: 'Planificar ruta' }).click();
paso(/Alternativas para PED-0001/.test(await page.locator('.detalle').textContent()) && /Factible/.test(await page.locator('.detalle').textContent()), 'Planificación: alternativas con factibilidad para PED-0001');
await limpiar(); await page.getByRole('button', { name: 'Confirmar esta ruta' }).first().click();
paso(/Itinerario confirmado/.test(await aviso()) && await page.locator('.linea-itinerario .etapa-chip').count() >= 1, 'Itinerario confirmado y mostrado como línea de etapas', await aviso());
await usuario('Carla (Almacén)', 'Planificación y entregas');
paso(!(await page.getByRole('tablist').textContent()).includes('Planificar rutas'), 'Almacén no ve «Planificar rutas», sí la ejecución');
await limpiar(); await boton('Despachar').first().click();
paso(/despachada/.test(await aviso()), 'Despacho de la etapa', await aviso());
await limpiar(); await boton('Registrar entrega al cliente').first().click();
const pe = page.getByRole('dialog', { name: 'Registrar entrega al cliente final' });
await pe.locator('label:has-text("referencia") input').fill('CONST-001');
await pe.getByRole('button', { name: 'Registrar' }).click();
const avEnt = await aviso(); await page.getByLabel('Mostrar también completados y reemplazados').check();
paso(/Entrega total aceptada/.test(avEnt) && /Completado/.test(await page.locator('.itinerario').first().textContent()), 'Entrega con receptor facultado y evidencia: pedido completado', await aviso());
await area('Planificación y entregas'); await sub('Red y condiciones de acceso');
paso(/INTERRUMPIDO/.test(await page.locator('table').first().textContent()), 'Red: el tramo con estiaje figura INTERRUMPIDO');
await area('Operación');

await usuario('Bruno (Pedidos)', 'Operación');
paso(!(await page.getByRole('navigation', { name: 'Secciones' }).textContent()).includes('Planificación'), 'Pedidos no ve Planificación ni Datos');
await limpiar(); await boton('Nuevo pedido').click();
const panel = page.getByRole('dialog', { name: 'Nuevo pedido' });
await panel.locator('label:has-text("Destino") select').selectOption({ index: 1 });
await panel.locator('label:has-text("Ventana desde") input').fill('2026-11-20T08:00');
await panel.locator('label:has-text("Ventana hasta") input').fill('2026-11-22T18:00');
await panel.locator('label:has-text("Producto 1") select').selectOption('P03');
await panel.locator('label:has-text("Cantidad") input').fill('1.250,5');
await panel.locator('label:has-text("Precio neto") input').fill('6,4');
await panel.getByRole('button', { name: 'Guardar y confirmar' }).click();
{ const av = await aviso();
  const cod = (av.match(/PED-[0-9A-F-]+/i) ?? [''])[0];
  paso(/creado y confirmado/.test(av) && !!cod, 'Registro directo: nuevo pedido con 1.250,5; el aviso muestra su código', av);
  paso(await page.locator('tr.fila-detalle').count() === 1 && (await page.locator('tr.seleccionada').textContent()).includes(cod), 'El pedido nuevo se abre automáticamente debajo de su fila'); }

// Auditoría RC1 n.º 18: cerrar un formulario con datos escritos pide confirmar; «Cancelar» conserva lo escrito
{ await limpiar(); await boton('Nuevo pedido').click();
  const pn = page.getByRole('dialog', { name: 'Nuevo pedido' });
  await pn.locator('label:has-text("Cantidad") input').fill('7');
  await pn.locator('label:has-text("Cantidad") input').press('Escape');
  const conf = page.getByRole('dialog', { name: 'Hay datos sin guardar' });
  const aparece = await conf.waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
  if (aparece) await conf.getByRole('button', { name: 'Cancelar' }).click();
  const sigue = await pn.isVisible() && (await pn.locator('label:has-text("Cantidad") input').inputValue()) === '7';
  if (aparece) { await pn.getByRole('button', { name: 'Cerrar' }).click(); await page.getByRole('dialog', { name: 'Hay datos sin guardar' }).getByRole('button', { name: 'Descartar y cerrar' }).click(); }
  paso(aparece && sigue && !(await pn.isVisible()), 'RC2: cerrar con datos escritos pide confirmar; Cancelar conserva lo escrito y «Descartar y cerrar» cierra'); }

// Pruebas guiadas 2 y 3 del estudiante (revisión I03): elección FEFO de almacén y mensajes con cantidades
const ids = async () => (await page.locator('tbody tr.clicable td:first-child').allTextContents()).map((t) => t.replace(/[▸▾]\s*/, '').trim());
const pedidoP03 = async (cant, divididas) => {
  const antes = new Set(await ids());
  await limpiar(); await boton('Nuevo pedido').click();
  const pn = page.getByRole('dialog', { name: 'Nuevo pedido' });
  await pn.locator('label:has-text("Destino") select').selectOption({ index: 1 });
  await pn.locator('label:has-text("Ventana desde") input').fill('2026-11-20T08:00');
  await pn.locator('label:has-text("Ventana hasta") input').fill('2026-11-22T18:00');
  if (divididas) await pn.locator('label:has-text("entregas divididas") input').check();
  await pn.locator('label:has-text("Producto 1") select').selectOption('P03');
  await pn.locator('label:has-text("Cantidad") input').fill(cant);
  if (!(await pn.textContent()).includes('(unidad base)')) throw new Error('No se muestra la equivalencia en unidad base');
  await pn.locator('label:has-text("Precio neto") input').fill('6,4');
  await pn.getByRole('button', { name: 'Guardar y confirmar' }).click(); await aviso();
  const nuevoId = (await ids()).find((i) => !antes.has(i));
  return fila(nuevoId);
};
let detalleTrasReserva = { n: 0, texto: '' };
const reservarFila = async (f) => { await usuario('Carla (Almacén)', 'Operación'); await f.click(); await limpiar(); await boton('Reservar (FEFO)').click(); const t = await aviso();
  detalleTrasReserva = { n: await page.locator('tr.fila-detalle').count(), texto: await page.locator('tr.fila-detalle').first().textContent().catch(() => '') };
  await usuario('Bruno (Pedidos)', 'Operación'); return t; };
let f1 = await pedidoP03('1.250,5', false);
let t1 = await reservarFila(f1);
paso(/desde ALM-JUL/.test(t1), 'Prueba guiada 2: 1.250,5 kg sin entregas divididas sale de un solo almacén elegido por FEFO (ALM-JUL)', t1);
paso(detalleTrasReserva.n === 1, 'El detalle se abre justo debajo de la fila seleccionada');
let f2 = await pedidoP03('2.500', false);
let t2 = await reservarFila(f2);
paso(/ningún almacén cubre todo/.test(t2) && /se necesitan 2\.500/.test(t2), 'Prueba guiada 3a: sin entregas divididas, mensaje con cantidades por almacén', t2);
let f3 = await pedidoP03('2.500', true);
let t3 = await reservarFila(f3);
paso(/Reserva realizada/.test(t3) && detalleTrasReserva.texto.match(/ALM-[A-Z]{3} · P03/g)?.length >= 2, 'Prueba guiada 3b: con entregas divididas reserva desde varios almacenes', t3);

const idF3 = (await f3.locator('td').first().textContent()).replace(/[▸▾]\s*/, '').trim();
await limpiar(); await fila(idF3).click(); await boton('Cancelar pedido').click();
{ const d = page.getByRole('dialog', { name: /^Cancelar PED/ });
  await d.getByRole('button', { name: 'Cancelar pedido' }).click();
  paso(/Elija el motivo/.test(await d.textContent()), 'Formulario guiado: no acepta sin elegir el motivo');
  await d.getByLabel('Motivo de la cancelación').selectOption('Cliente desiste del pedido');
  await d.getByRole('button', { name: 'Cancelar pedido' }).click(); }
paso(/Pedido cancelado/.test(await aviso()), 'Cancelar con motivo libera reservas', await aviso());
const posAviso = await page.locator('.aviso').evaluate((e) => getComputedStyle(e).position).catch(() => 'sin aviso');
paso(posAviso === 'fixed', 'El aviso de resultado es flotante y visible aunque se haya bajado en la pantalla', posAviso);

await sub('Disponibilidad y propuestas');
paso(await page.locator('table').first().locator('tbody tr').count() > 0, 'Disponibilidad a fecha visible');
await sub('Pedidos');
await limpiar(); await fila('PED-0004').click(); await boton('Confirmar pedido').click(); await aviso();
await limpiar(); await boton('Proponer fecha').click();
paso(/Fecha factible/.test(await aviso()), 'Propuesta de fecha emitida', await aviso());
await sub('Disponibilidad y propuestas');
await limpiar(); await page.locator('tbody tr', { hasText: 'PED-0004' }).getByRole('button', { name: 'Aceptar' }).click();
paso(/Propuesta aceptada/.test(await aviso()), 'Propuesta aceptada dentro de vigencia', await aviso());

await usuario('Carla (Almacén)', 'Operación', 'Inventario y traslados');
await limpiar(); await boton('Nuevo traslado entre almacenes').click();
const pt = page.getByRole('dialog', { name: 'Nuevo traslado entre almacenes' });
await pt.locator('label:has-text("Lote") select').selectOption({ index: 1 });
await pt.locator('label:has-text("Destino") select').selectOption('ALM-JUL');
await pt.locator('label:has-text("Cantidad") input').fill('5');
await pt.locator('label:has-text("Llegada prevista") input').fill('2026-11-16');
await pt.getByRole('button', { name: 'Registrar salida' }).click();
paso(/en tránsito/.test(await aviso()), 'Traslado registrado en tránsito', await aviso());
await limpiar(); await page.getByRole('button', { name: 'Registrar recepción' }).first().click();
{ const d = page.getByRole('dialog', { name: 'Recepción del traslado' });
  await d.getByLabel('Cantidad que llegó apta').fill('6'); await d.getByRole('button', { name: 'Registrar recepción' }).click();
  paso(/No puede ser mayor que 5/.test(await d.textContent()), 'Formulario guiado: no acepta recibir más de lo enviado');
  await d.getByLabel('Cantidad que llegó apta').fill('5'); await d.getByRole('button', { name: 'Registrar recepción' }).click(); }
paso(/recibido completo/.test(await aviso()), 'Recepción del traslado', await aviso());
paso((await page.locator('.barra .chip').first().textContent()).includes('conciliado'), 'Balance por lote conciliado tras el traslado');
await sub('Ajustes de inventario');
await page.locator('label:has-text("Lote · almacén") select').selectOption({ index: 1 });
await page.locator('label:has-text("Diferencia") input').fill('-1');
await page.locator('label:has-text("Motivo") input').fill('Faltante en conteo físico');
await limpiar(); await boton('Solicitar ajuste').click(); await aviso();
await usuario('Elena (Supervisión)', 'Operación', 'Ajustes de inventario');
await limpiar(); await page.locator('tbody tr', { hasText: 'PENDIENTE' }).getByRole('button', { name: 'Aprobar' }).click();
paso(/aprobado y aplicado/.test(await aviso()), 'Ajuste aprobado por otra persona (Supervisión)', await aviso());

await usuario('Ana (Datos y administración)');
await area('Datos'); await sub('Maestros');
await limpiar(); await boton('Nuevo').click();
const pm = page.getByRole('dialog');
await pm.locator('label:has-text("Código") input').fill('P01');
await pm.getByRole('button', { name: 'Guardar' }).click();
paso(/Revise los/.test(await aviso()) && /Ya existe/.test(await pm.textContent()) && (await pm.locator('.error-campo').count()) > 0, 'Maestro: código duplicado y obligatorios marcados por campo', await aviso());
await pm.getByRole('button', { name: 'Cancelar' }).click();

await ctx.close();
await abrir({ width: 1920, height: 1080 });
await usuario('Bruno (Pedidos)');
await area('Operación');
await page.locator('label.filtro select').first().selectOption('Todos');
paso((await fila(idF3).textContent()).includes('Cancelado') && (await fila('PED-0001').textContent()).includes('Completado'), 'Persistencia tras cerrar y reabrir el navegador (cancelado y completado)');

await usuario('Elena (Supervisión)', 'Resultados');
const xs = await descarga(() => page.getByRole('button', { name: 'Excel', exact: true }).click());
const ds = await descarga(() => page.getByRole('button', { name: 'Informe técnico (Word)' }).click());
const ps = await descarga(() => page.getByRole('button', { name: 'Presentación ejecutiva (PowerPoint)' }).click());
paso(/^Resultados_Distribucion_REEXPRESADA_\d{4}-\d{2}-\d{2}_\d{4}\.xlsx$/.test(xs.sugerido) && /^Informe_Tecnico_/.test(ds.sugerido) && /^Presentacion_Ejecutiva_/.test(ps.sugerido), 'Exportaciones con nombres descriptivos', [xs.sugerido, ds.sugerido, ps.sugerido].join(' · '));

await usuario('Ana (Datos y administración)');
await area('Datos'); await sub('Carga de datos');
const pl = await descarga(() => page.getByRole('button', { name: 'Descargar plantilla' }).click(), 'plantilla.xlsx');
const subir = async (archivo) => {
  await limpiar(); const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Cargar Excel' }).click()]); await fc.setFiles(archivo);
  const dlg = page.getByRole('dialog', { name: /^Cargar «/ });
  if (await dlg.waitFor({ timeout: 3000 }).then(() => true).catch(() => false)) await dlg.getByRole('button', { name: 'Cargar', exact: true }).click();
  return aviso();
};
let t = await subir(pl.p);
paso(/Carga confirmada/.test(t), 'Plantilla descargada se importa', t);
t = await subir(pl.p);
paso(/ya cargado/.test(t), 'Reimportar el mismo archivo no duplica', t);
const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(pl.p);
wb.getWorksheet('Lotes').getCell('B2').value = 'P99';
wb.getWorksheet('MovimientosIniciales').getCell('D3').value = '80';
wb.getWorksheet('Destinos').getCell('E2').value = 2101;
const inv = path.join(out, 'invalido.xlsx'); await wb.xlsx.writeFile(inv);
t = await subir(inv);
const nErr = await page.locator('.errores tbody tr').count();
paso(/No se confirmó ningún registro/.test(t) && nErr === 3, 'Excel inválido: 3 errores exactos con hoja/celda, cero cambios', `${nErr} errores`);

await sub('Respaldo');
const r = await descarga(() => page.getByRole('button', { name: 'Respaldar' }).click(), 'respaldo.sqlite');
const cor = path.join(out, 'corrupto.sqlite'); fs.writeFileSync(cor, Buffer.from('no es una base'.repeat(80)));
const restaurar = async (a) => {
  await limpiar(); const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Restaurar', exact: true }).click()]); await fc.setFiles(a);
  const dlg = page.getByRole('dialog', { name: 'Restaurar una copia' });
  if (await dlg.waitFor({ timeout: 3000 }).then(() => true).catch(() => false)) {
    const txt = await dlg.textContent();
    await dlg.getByLabel('Motivo de la restauración (queda registrado)').selectOption('Volver a un estado de prueba'); await dlg.getByRole('button', { name: 'Restaurar' }).click();
    return txt + ' ' + await aviso();
  }
  return aviso();
};
paso(/rechazad/i.test(await restaurar(cor)), 'Respaldo corrupto rechazado sin alterar datos');
const rv = await restaurar(r.p);
paso(/Copia válida/.test(rv) && /hoy \d+ → copia \d+/.test(rv) && /Restauración completa/.test(rv), 'BD04: vista previa (qué cambia) antes de restaurar, con motivo registrado', rv.slice(0, 200));
// BD09/BD10: ensayo de restauración con metas RTO/RPO (no reemplaza nada)
await limpiar();
{ const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Ensayo de restauración' }).click()]); await fc.setFiles(r.p); }
const en = await aviso();
paso(/Ensayo de restauración: [\d,.]+ s \(meta RTO 60 s: cumple\)/.test(en) && /No se reemplazó nada/.test(en) && await page.locator('table').last().locator('tbody tr').count() >= 1, 'Ensayo de restauración mide duración real y la compara con RTO/RPO', en);
await limpiar();
const port = await descarga(() => page.getByRole('button', { name: 'Exportación portable (JSON)' }).click());
const jp = JSON.parse(fs.readFileSync(port.p, 'utf8'));
paso(jp.formato === 'ALPROSA-PORTABLE' && jp.conteos.pedido > 0 && !('credencial' in jp.datos) && /America\/Lima/.test(jp.convenciones.zona_horaria), 'Exportación portable documentada sin credenciales', port.sugerido);
await limpiar();
const anon = await descarga(() => page.getByRole('button', { name: 'Copia anonimizada para soporte' }).click());
paso(fs.statSync(anon.p).size > 10000 && /anonimizada/.test(await aviso()), 'Copia anonimizada para soporte descargada');
await sub('Estado del sistema');
paso(await page.locator('tbody tr').count() >= 5 && /Recuperabilidad/.test(await page.locator('main').textContent()), 'Estado del sistema: salud por dimensión separada');
const diag = await descarga(() => page.getByRole('button', { name: 'Descargar paquete de diagnóstico' }).click());
paso(!/pin_hash|sal_hex/.test(fs.readFileSync(diag.p, 'utf8')), 'Paquete de diagnóstico sin credenciales');

// I04-b con el usuario de evaluación (modo prueba, sin PIN)
await page.getByRole('button', { name: 'Cambiar de usuario' }).click();
paso(await page.locator('.tarjeta-evaluacion').count() === 1, 'Ingreso: tarjeta destacada de evaluación (modo prueba)');
await page.locator('.tarjeta-evaluacion').click(); await page.waitForSelector('.cabecera'); await cerrarNov();
const navEval = await page.getByRole('navigation', { name: 'Secciones' }).textContent();
paso(await page.locator('.franja-prueba').count() === 1 && ['Operación', 'Planificación', 'Control', 'Resultados', 'Datos'].every((x) => navEval.includes(x)), 'Evaluación entra sin PIN, con franja MODO PRUEBA y todas las secciones', navEval);
await area('Control');
paso(await page.getByRole('tab').count() === 5, 'Control: alertas, calidad, conteos, costos y retornables');
await sub('Calidad, retiros y devoluciones');
await limpiar(); await page.getByRole('button', { name: 'Bloquear un lote (retiro)' }).click();
const pb = page.getByRole('dialog', { name: 'Bloquear lote (retiro de calidad)' });
await pb.locator('label:has-text("Motivo") select').selectOption('Aviso de laboratorio: posible contaminación');
await pb.getByRole('button', { name: 'Bloquear' }).click();
paso(/Lote bloqueado/.test(await aviso()) && await page.getByRole('dialog', { name: /Dónde está el lote/ }).count() === 1, 'Retiro: bloqueo con trazabilidad del lote', await aviso());
await page.getByRole('dialog', { name: /Dónde está el lote/ }).getByRole('button', { name: 'Cerrar' }).click();
paso((await page.locator('table').first().textContent()).includes('En retiro'), 'El lote bloqueado aparece retenido en cuarentena');
await sub('Alertas');
await limpiar(); await page.getByRole('button', { name: 'Evaluar ahora' }).click();
paso(/Evaluadas/.test(await aviso()) && /Retiro de calidad activo/.test(await page.locator('table').first().textContent()), 'Alerta del retiro activo visible', await aviso());
await limpiar(); await page.getByRole('button', { name: 'Silenciar' }).first().click();
{ const d = page.getByRole('dialog', { name: 'Silenciar alerta temporalmente' });
  paso(await d.locator('input[type="datetime-local"]').count() === 1, 'Silenciar: fecha y hora con calendario, no escritas a mano');
  await d.getByLabel('Motivo').selectOption('Investigación en curso'); await d.getByRole('button', { name: '+1 día' }).click();
  await d.getByRole('button', { name: 'Silenciar' }).click(); }
paso(/silenciada/.test(await aviso()), 'Alerta silenciada con atajo «+1 día»', await aviso());
await sub('Conteos');
await page.locator('label:has-text("Cantidad contada") input').fill('1');
await limpiar(); await page.getByRole('button', { name: 'Registrar conteo' }).click();
paso(/recuento/.test(await aviso()), 'Conteo con diferencia pide recuento', await aviso());
await sub('Envases retornables');
paso((await page.locator('table').first().textContent()).includes('CONT-001'), 'Envases retornables listados');

// I05 Analítica (usuario de evaluación)
await area('Analítica');
await page.getByRole('button', { name: '52 semanas' }).click();
paso(await page.locator('.tarjeta-kpi').count() === 12 && /%/.test(await page.locator('.tarjeta-kpi').first().textContent()), 'Analítica: 12 indicadores con valor, numerador/denominador y n', `${await page.locator('.tarjeta-kpi').count()} | ${(await page.locator('.tarjetas-kpi').textContent()).slice(0, 500)} | ${await page.locator('.filtro-resumen').textContent()}`);
paso(/Alertas vigentes en TODO el sistema/.test(await page.locator('.tres-tiempos').textContent()), 'Panel separa Ahora / Próximo y muestra alertas globales aunque haya filtros');
await page.locator('.tarjeta-kpi').first().click();
paso(await page.locator('.detalle table tbody tr').count() > 10 && /Definición/.test(await page.locator('.detalle').textContent()), 'Clic en OTIF: definición, universo y pedidos con causa registrada');
await page.locator('label:has-text("Desde") input[type="date"]').first().fill('2026-10-01'); await page.locator('label:has-text("Hasta") input[type="date"]').first().fill('2026-09-01');
paso(/debe ser anterior o igual/.test(await page.locator('.filtros-analitica').textContent()) && await page.locator('.tarjeta-kpi').count() === 0, 'Rango invertido: se rechaza antes de calcular');
await page.getByRole('button', { name: '52 semanas' }).click();
paso(await page.locator('.chip-periodo.activo').count() === 1 && /52 semanas/.test(await page.locator('.chip-periodo.activo').textContent()), 'Botón de período elegido queda marcado (aspecto de botón y estado activo)');
// Revisión del estudiante: borrar o teclear la fecha «hasta» dejaba la pantalla en blanco
const hasta = page.locator('label:has-text("Hasta") input[type="date"]').first();
await hasta.click(); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
paso(await page.locator('.cabecera').count() === 1 && await page.locator('.tarjeta-kpi').count() === 12 && await page.locator('.aviso-fecha').count() >= 1, 'Fecha a medio borrar: la pantalla no se cae, sigue el último rango válido y se pide completar la fecha');
await hasta.fill('2026-09-30'); await page.locator('label:has-text("Desde") input[type="date"]').first().fill('2026-09-01');
const fracOtif = async () => (await page.locator('.tarjeta-kpi').first().locator('.kpi-frac').textContent());
paso(await page.locator('.cabecera').count() === 1 && /^71 \/ 83/.test(await fracOtif()), 'Tras corregir las fechas (01/09–30/09/2026): OTIF reexpresado 71/83', await fracOtif());
await page.getByRole('button', { name: '52 semanas' }).click();
await page.locator('.mes-completo select').selectOption('2026-09');
await page.locator('label:has-text("Vista") select').first().selectOption('ORIGINAL');
const corte = page.locator('label:has-text("Conocido hasta el") input[type="date"]').first();
await corte.fill('2026-09-30');
paso(/^69 \/ 83/.test(await fracOtif()), 'Mes completo «septiembre 2026» + vista Original al 30/09: OTIF 69/83', await fracOtif());
await page.locator('label:has-text("Vista") select').first().selectOption('REEXPRESADA');
await page.getByRole('button', { name: '52 semanas' }).click();
await sub('Diagnóstico');
paso(/Sin causa registrada/.test(await page.locator('table').first().textContent()) && /En validación/.test(await page.locator('.cadena').first().textContent()), 'Diagnóstico: Pareto con «Sin causa registrada» y cadena causal en validación');
await sub('Pronóstico');
await limpiar(); await page.getByRole('button', { name: 'Calcular pronóstico' }).click();
paso(/Elegido \(menor error medido\)/.test(await page.locator('.detalle').textContent()), 'Pronóstico P01: tres métodos medidos y elección después de medir');
await limpiar(); await page.getByRole('button', { name: 'Guardar esta corrida' }).click();
paso(/Corrida guardada/.test(await aviso()) && /Vigente/.test(await page.locator('table').last().textContent()), 'Corrida de pronóstico guardada (no se sobrescribe)', await aviso());
await sub('Recomendaciones');
await limpiar(); await page.getByRole('button', { name: 'Evaluar reglas ahora' }).click();
paso(/recomendación/.test(await aviso()), 'Recomendaciones evaluadas por reglas', await aviso());

// I06: simulación, alternativas/EVA y exportaciones empresariales
await sub('Simulación');
await limpiar(); await page.getByRole('button', { name: 'Simular los 3 planes' }).click();
await page.waitForSelector('.tarjeta-plan', { timeout: 120000 });
paso(await page.locator('.tarjeta-plan').count() === 3 && /Simulación completa: SIM-/.test(await aviso()), 'Simulación Monte Carlo: 3 planes con OTIF esperado, P5–P95, IC 95 % y costo', await aviso());
const simId1 = (await page.locator('.detalle h2').first().textContent()).match(/SIM-[\w-]+/)[0];
await limpiar(); await page.getByRole('button', { name: 'Simular los 3 planes' }).click();
await page.waitForFunction((id) => !document.querySelector('.detalle h2')?.textContent?.includes(id), simId1, { timeout: 120000 });
paso(/resultados son idénticos/.test(await page.locator('.detalle').first().textContent()), 'Misma semilla y entrada: la segunda corrida es idéntica a la primera (reproducible)');
await sub('Alternativas y EVA');
await limpiar(); await page.getByRole('button', { name: 'Calcular evaluación' }).click();
await page.waitForSelector('.tabla-eva', { timeout: 60000 });
paso(await page.locator('.tabla-eva tbody tr').count() === 8 && /Solapamiento/.test(await page.locator('.detalle').first().textContent()), 'Alternativas: base + 6 alternativas + combinación con solapamiento sin doble conteo');
await limpiar(); await page.getByRole('button', { name: 'Guardar evaluación' }).click();
paso(/Evaluación guardada: EVA-/.test(await aviso()), 'Evaluación económica guardada', await aviso());
// RC4 (defecto 7): intervalo mensual de más de 360 meses elegido desde la interfaz (selector de mes, sin lista fija)
{ await page.locator('input[aria-label="Desde el mes"]').fill('2026-12');
  await page.locator('input[aria-label="Hasta el mes"]').fill('2061-11');
  const nota = await page.locator('.filtros-analitica .nota').first().textContent();
  await limpiar(); await page.getByRole('button', { name: 'Calcular evaluación' }).click();
  await page.waitForFunction(() => /420 meses desde 2026-12/.test(document.querySelector('.detalle h2')?.textContent ?? ''), null, { timeout: 120000 });
  const h2 = await page.locator('.detalle h2').first().textContent();
  paso(/420 meses/.test(nota) && /420 meses desde 2026-12/.test(h2) && await page.locator('.tabla-eva tbody tr').count() === 8, 'RC4: EVA con intervalo 2026-12 a 2061-11 (420 meses) elegido en la interfaz; calcula todas las alternativas', `${nota} · ${h2}`);
  await page.locator('input[aria-label="Desde el mes"]').fill('2026-12'); await page.locator('input[aria-label="Hasta el mes"]').fill('2027-11'); }
await area('Resultados');
for (const [n, ext] of [['Excel', 'xlsx'], ['Informe técnico (Word)', 'docx'], ['Presentación ejecutiva (PowerPoint)', 'pptx']]) {
  await limpiar();
  const d = await descarga(() => page.getByRole('button', { name: n, exact: true }).click());
  paso(d.sugerido.endsWith('.' + ext) && /REEXPRESADA/.test(d.sugerido) && fs.statSync(d.p).size > 5000, `Exportación ${ext.toUpperCase()} desde Resultados con rótulo de vista`, d.sugerido);
  if (ext === 'xlsx') { const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(d.p); const m = JSON.stringify(wb.getWorksheet('Metadatos').getSheetValues()); paso(/SIM-/.test(m) && /EVA-/.test(m) && /RUN-/.test(m) && wb.getWorksheet('AlternativasEVA').rowCount > 5, 'Excel con RUN-ID, corrida de simulación y evaluación incluidas'); }
}
// I08: libros de entregables 08 y 09 desde Resultados
for (const [n, nom, hoja] of [['Libro de analítica', '08_Resultados_Analitica.xlsx', 'Indicadores'], ['Libro de proyecciones y alternativas', '09_Proyecciones_Alternativas_Mejora.xlsx', 'Alternativas']]) {
  await limpiar();
  const d = await descarga(() => page.getByRole('button', { name: n, exact: true }).click());
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(d.p);
  const meta = {}; wb.getWorksheet('Metadatos').eachRow((r, i) => { if (i > 1) meta[String(r.getCell(1).value)] = String(r.getCell(2).value); });
  const metaOk = hoja === 'Indicadores' ? /\[\d{4}-\d\d-\d\d, \d{4}-\d\d-\d\d\)/.test(meta['Rango analizado'] ?? '') && !!meta['Vista de la analítica'] && !!meta['Alcance del libro'] && !!wb.getWorksheet('Evidencias') : !!meta['Alcance del libro'];
  paso(d.sugerido === nom && wb.getWorksheet('LEEME') && wb.getWorksheet(hoja).rowCount > 5 && metaOk, `I08/RC2: ${nom} con índice, hoja ${hoja} con datos y metadatos de la selección`, `${d.sugerido} · ${wb.worksheets.length} hojas · rango ${meta['Rango analizado'] ?? '—'}`);
}
// I07: teclado, parámetros con vigencia futura y conflicto entre pestañas
if (await page.locator('.cabecera').count()) await page.getByRole('button', { name: 'Cambiar de usuario' }).click();
await page.locator('.tarjeta-evaluacion').click(); await page.waitForSelector('.cabecera'); await cerrarNov();
paso(novedadesVistas, 'BP06: al abrir una versión nueva se muestran sus novedades una vez');
await area('Datos'); await sub('Parámetros');
const filaP = page.locator('tbody tr', { hasText: 'alerta_plazo_h' }).first();
await filaP.getByRole('button', { name: 'Cambiar', exact: true }).focus(); await page.keyboard.press('Enter');
const dlgP = page.getByRole('dialog', { name: /Nueva versión de «alerta_plazo_h»/ });
await dlgP.waitFor(); await page.waitForTimeout(250);
paso(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')), 'BA01/BA02: el formulario se abre con teclado y el foco entra al primer campo');
await page.keyboard.press('Control+A'); await page.keyboard.type('abc'); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
const errTxt = await dlgP.textContent();
paso(/campo|número|Escriba|válid/i.test(errTxt) && await page.evaluate(() => !!document.activeElement?.closest('.con-error')), 'BA05: error junto al campo y el foco va al campo con error', errTxt.slice(0, 160));
await page.keyboard.press('Escape'); await page.waitForTimeout(250);
paso(await dlgP.count() === 0 && await page.evaluate(() => document.activeElement?.textContent === 'Cambiar'), 'BA02: Escape cancela sin ejecutar y el foco vuelve al botón de origen');
await filaP.getByRole('button', { name: 'Cambiar', exact: true }).click();
await dlgP.getByLabel('Nuevo valor (h)').fill('6');
await dlgP.getByLabel('Vigente desde').fill('2027-01-04');
await dlgP.getByLabel('Motivo').selectOption('Nueva política de la empresa');
await limpiar(); await dlgP.getByRole('button', { name: 'Guardar versión' }).click();
paso(/Versión programada: rige desde 2027-01-04/.test(await aviso()) && (await page.locator('main').textContent()).includes('Versiones programadas'), 'BB05: versión con fecha futura queda Programada y no rige aún', await aviso());
paso((await filaP.textContent()).includes('8'), 'BB05: el valor vigente hoy sigue siendo el anterior (8 h)');
// AG03/BB03: dos pestañas sobre la misma base del navegador
const p2 = await ctx.newPage(); p2.on('pageerror', (e) => consola.push(e.message));
await p2.goto(url); await p2.locator('.tarjeta-evaluacion').click(); await p2.waitForSelector('.cabecera');
{ const b = p2.getByRole('button', { name: 'Entendido' }); if (await b.count()) await b.click(); }
await p2.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Datos' }).click(); await p2.getByRole('tab', { name: 'Parámetros' }).click();
// La pestaña nueva (p2) cambia un parámetro; la pestaña anterior (page) queda desactualizada
await p2.locator('tbody tr', { hasText: 'clima_vigencia_min' }).first().getByRole('button', { name: 'Cambiar', exact: true }).click();
await p2.getByLabel('Nuevo valor (min)').fill('90'); await p2.getByLabel('Motivo').selectOption('Ajuste operativo acordado'); await p2.getByRole('button', { name: 'Guardar versión' }).click();
await p2.locator('.aviso').first().waitFor();
await page.waitForSelector('text=Otra pestaña o ventana guardó cambios', { timeout: 5000 }).catch(() => {});
paso(await page.locator('text=Otra pestaña o ventana guardó cambios').count() === 1, 'AG03: la otra pestaña recibe aviso de cambios externos');
await page.locator('tbody tr', { hasText: 'ttl_propuesta_min' }).first().getByRole('button', { name: 'Cambiar', exact: true }).click();
await page.getByLabel('Nuevo valor (min)').fill('45'); await page.getByLabel('Motivo').selectOption('Ajuste operativo acordado'); await page.getByRole('button', { name: 'Guardar versión' }).click();
const c2 = (await page.locator('.aviso.error').first().textContent({ timeout: 10000 })).trim();
paso(/Conflicto: otra pestaña guardó cambios/.test(c2), 'AG03/BB03: el cambio desde una pestaña desactualizada se rechaza; no gana el último en silencio', c2);
paso((await page.locator('tbody tr', { hasText: 'clima_vigencia_min' }).first().textContent()).includes('90') && (await page.locator('tbody tr', { hasText: 'ttl_propuesta_min' }).first().textContent()).includes('30'), 'Tras el conflicto la pestaña muestra los datos actuales y el cambio rechazado no se aplicó');
if (await page.getByRole('button', { name: 'Recargar datos' }).count()) await page.getByRole('button', { name: 'Recargar datos' }).click();
await p2.close();
await usuario('Soporte técnico');
paso((await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button').count()) === 1 && JSON.stringify(await page.getByRole('tab').allTextContents()) === JSON.stringify(['Estado del sistema', 'Diagnóstico']), 'Soporte solo ve Estado del sistema y Diagnóstico, sin datos comerciales', JSON.stringify(await page.getByRole('tab').allTextContents()));

// I08: recorrido operativo de demostración y libro 07
await usuario('Ana (Datos y administración)', 'Datos', 'Carga de datos');
// RC3 (auditoría n.º 21/1/15): el recorrido integral se hace con el ARCHIVO 06 real (sus bytes, su hash), no con el recurso empaquetado
const ARCHIVO_06 = process.env.ARCHIVO_06;
const hash06 = ARCHIVO_06 ? crypto.createHash('sha256').update(fs.readFileSync(ARCHIVO_06)).digest('hex') : null;
if (ARCHIVO_06) { const t06 = await subir(ARCHIVO_06); paso(/Carga confirmada/.test(t06), 'RC3: el Excel 06 real se importa sin errores', `SHA-256 ${hash06} · ${t06}`); }
else { await limpiar(); await page.getByRole('button', { name: 'Cargar demostración' }).click();
  { const dlg = page.getByRole('dialog', { name: 'Cargar demostración' }); if (await dlg.waitFor({ timeout: 3000 }).then(() => true).catch(() => false)) await dlg.getByRole('button', { name: 'Cargar', exact: true }).click(); }
  await page.locator('.aviso').first().waitFor(); }
await limpiar();
await page.getByRole('button', { name: 'Ejecutar recorrido de demostración' }).click();
await page.getByRole('dialog', { name: 'Recorrido operativo de demostración' }).getByRole('button', { name: 'Ejecutar', exact: true }).click();
paso(/Recorrido terminado/.test(await aviso()) && /No disponible: Ya hay operación/.test(await page.locator('.grupo', { hasText: 'Recorrido operativo' }).textContent()), 'I08: recorrido de demostración ejecutado una sola vez', await aviso());
await usuario('Elena (Supervisión)', 'Resultados');
{ await limpiar(); const d = await descarga(() => page.getByRole('button', { name: 'Libro de resultados del sistema', exact: true }).click());
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(d.p);
  const conc = wb.getWorksheet('Conciliacion'); const cab = conc.getRow(1).values; const ci = cab.indexOf('conciliado');
  const noCuadra = []; conc.eachRow((r, i) => { if (i > 1 && r.getCell(ci).value !== 'sí') noCuadra.push(i); });
  const meta07 = {}; wb.getWorksheet('Metadatos').eachRow((r, i) => { if (i > 1) meta07[String(r.getCell(1).value)] = String(r.getCell(2).value); });
  if (hash06) paso(meta07['SHA-256 de la carga'] === hash06 && /^NUTRIDEMO-ARCHIVO/.test(meta07['Dataset'] ?? ''), 'RC3: el libro 07 declara el hash del 06 real cargado', `${meta07['Dataset']} · ${meta07['SHA-256 de la carga']}`);
  paso(d.sugerido === '07_Resultados_Sistema.xlsx' && wb.getWorksheet('Entregas').rowCount > 2 && wb.getWorksheet('Retornos').rowCount > 2 && wb.getWorksheet('Incidencias').rowCount > 2 && noCuadra.length === 0, 'I08: Excel 07 con entregas, retornos, incidencias y conciliación cuadrada', `${wb.worksheets.length} hojas; filas sin cuadrar ${noCuadra.length}`); }

for (const vp of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }, { width: 1280, height: 720 }, { width: 1093, height: 614, z: '1366×768 al 125 %' }]) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  const malas = [];
  for (const u of ['Evaluación', 'Ana', 'Carla']) {
    if (u === 'Evaluación') { if (await page.locator('.cabecera').count()) await page.getByRole('button', { name: 'Cambiar de usuario' }).click(); await page.locator('.tarjeta-evaluacion').click(); await page.waitForSelector('.cabecera'); await cerrarNov(); } else await usuario(u);
    const nav = await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button').allTextContents();
    for (const a of nav) {
      await area(a);
      const tabs = await page.getByRole('tab').allTextContents();
      for (const s of tabs.length ? tabs : [null]) {
        if (s) await sub(s);
        const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        const cabecera = await page.evaluate(() => document.querySelector('.cabecera')?.getBoundingClientRect().height ?? 0);
        if (desborde > 2 || cabecera > (vp.z ? 175 : 140)) malas.push(`${u}:${a}/${s ?? '-'}: desborde ${desborde}px, cabecera ${Math.round(cabecera)}px`);
      }
    }
  }
  paso(malas.length === 0, `Todas las pantallas de cada rol sin desborde horizontal en ${vp.z ?? vp.width + '×' + vp.height}`, malas.join('; '));
}
await page.mouse.wheel(0, 2000);
paso(await page.locator('.cabecera').evaluate((e) => getComputedStyle(e).position === 'sticky' && e.getBoundingClientRect().top === 0), 'La barra superior sigue visible al desplazarse');
} catch (e) { paso(false, 'Ejecución interrumpida', e.message.split('\n').slice(0,8).join(' | ')); }
await ctx?.close().catch(() => {});
paso(red.length === 0, 'Ninguna solicitud de red', red.join(', '));
paso(consola.length === 0, 'Sin errores de consola', consola.join(' || ').slice(0, 400));
fs.writeFileSync(path.join(out, 'resultado_e2e_html.json'), JSON.stringify({ html: path.resolve(html), sha256_html: crypto.createHash('sha256').update(fs.readFileSync(html)).digest('hex'), fecha: new Date().toISOString(), pasos: log, red, consola }, null, 2));
process.exit(log.every((l) => l.ok) ? 0 : 1);
