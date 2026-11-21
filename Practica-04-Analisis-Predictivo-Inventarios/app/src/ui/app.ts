/**
 * Estructura de la aplicación: barra lateral (14 pantallas), barra superior con el sello de actualización
 * y el botón "Análisis completo en 1 clic", enrutador por hash y estado compartido de la interfaz.
 */
import { llamar, alProgresar, iniciarMotor, type InfoMotor } from './motor';
import type { Resultados } from '../worker/motor.worker';
import { avisar, esc, fechaPE, insignia, montar } from './componentes';
import { liberarGraficos } from './graficos';
import { cargarBDPersistida, esEXE, persistirBD, infoHost, avisarCierreListo } from './host';
import ventasUrl from '../datos-practica/TABLA DATOS MOVIMIENTOS VENTAS Y UTILIDAD.xlsx?url';
import kardexUrl from '../datos-practica/KARDEX MOVIMIENTOS ALMACEN.xls?url';

export interface Filtros { departamento?: string; desde?: string; hasta?: string }
export const estado: { info: InfoMotor | null; R: Resultados | null; filtros: Filtros; cfg: Record<string, string>; ocupado: boolean } =
  { info: null, R: null, filtros: {}, cfg: {}, ocupado: false };

export interface Pantalla { id: string; icono: string; menu: string; titulo: string; pregunta: string; pintar: () => Promise<string> | string; separador?: boolean }
const pantallas: Pantalla[] = [];
export const registrar = (p: Pantalla) => pantallas.push(p);

const ESTADOS_FLUJO = ['RECIBIDO', 'DATOS_VALIDADOS', 'ANALIZADO', 'EVALUADO', 'PROPUESTO', 'APROBADO'];
const ETIQ_FLUJO: Record<string, string> = { RECIBIDO: 'Recibido', DATOS_VALIDADOS: 'Datos validados', ANALIZADO: 'Analizado', EVALUADO: 'Evaluado', PROPUESTO: 'Propuesto', APROBADO: 'Aprobado' };
export function flujoHTML(actual: string | null): string {
  const i = actual ? ESTADOS_FLUJO.indexOf(actual) : -1;
  return `<div class="flujo" title="Máquina de estados del Super Agente">${ESTADOS_FLUJO.map((e, k) => `<span class="${k <= i ? 'hecho' : ''}">${k <= i ? '✔ ' : ''}${ETIQ_FLUJO[e]}</span>`).join('<b>›</b>')}</div>`;
}
export const estadoFlujoActual = () => {
  const s = estado.R; if (!s?.generadoEn) return estado.info?.datasets.length ? 'DATOS_VALIDADOS' : null;
  return [s.dv, s.pr, s.sm].some((r) => r?.estado_flujo === 'APROBADO') ? 'APROBADO' : 'PROPUESTO';
};

// ---------------- Arranque ----------------
export async function iniciarApp(raiz: HTMLElement): Promise<void> {
  raiz.innerHTML = `<div class="shell">
    <nav class="lateral" aria-label="Navegación principal">
      <div class="marca"><b>Sistema de Análisis de Datos y Predictivo de Gestión de Inventarios</b><small>Super Agente IA · v1.0</small></div>
      <div class="menu">${pantallas.map((p) => `${p.separador ? '<div class="sep"></div>' : ''}<a href="#/${p.id}" data-id="${p.id}"><span class="ic">${p.icono}</span>${esc(p.menu)}</a>`).join('')}</div>
      <div class="pie-lateral">D. Achachagua C. A. · 20192589B<br/>GE803U · Sistemas Analíticos · UNI-FIIS</div>
    </nav>
    <main class="principal">
      <div class="barra"><div class="titulo"><h1 id="titulo"></h1><div class="pregunta" id="pregunta"></div></div>
        <span class="chip" id="chip-datos" title="Datasets cargados en la base de datos"></span>
        <span class="chip" id="chip-sello" title="Hora de Lima del último cálculo"></span>
        <button class="btn primario" id="btn-1clic" title="El Coordinador ejecuta: validar → describir → diagnosticar → Evaluador → pronosticar → prescribir → simular">▶ Análisis completo en 1 clic</button>
      </div>
      <div class="contenido" id="contenido" tabindex="-1"></div>
    </main></div>`;
  document.getElementById('btn-1clic')!.addEventListener('click', () => analisisCompleto());
  window.addEventListener('hashchange', () => navegar());
  estado.info = await iniciarMotor(await cargarBDPersistida());
  estado.cfg = await llamar('configuracion');
  aplicarTema(estado.cfg.tema ?? 'claro');
  if (estado.info.hayResultados) estado.R = await llamar('resultados');
  actualizarBarra();
  navegar();
  if (esEXE()) {
    const ih = await infoHost();
    if (ih?.soloLectura) {
      const b = document.createElement('div');
      b.className = 'chip aviso'; b.style.cssText = 'position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:70;font-size:13px';
      b.textContent = '⚠ Está ejecutando el sistema desde dentro del ZIP o desde una carpeta de solo lectura: extraiga el ZIP para guardar su información.';
      document.body.appendChild(b);
    }
    // Cierre ordenado: el EXE avisa antes de cerrar; se guarda la BD y se confirma (máx. 4 s).
    (window as unknown as { __sadpgiAntesDeCerrar: () => Promise<void> }).__sadpgiAntesDeCerrar = async () => {
      try { clearTimeout(tGuardar); await persistirBD(await llamar<Uint8Array>('exportarBD')); } finally { await avisarCierreListo(); }
    };
  }
}

export function aplicarTema(t: string): void {
  const oscuro = t === 'oscuro' || (t === 'sistema' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.tema = oscuro ? 'oscuro' : 'claro';
}

let actual = '';
/** Las navegaciones se encadenan (nunca se intercalan): así cada pantalla monta solo sus propios controles. */
let cadena: Promise<void> = Promise.resolve();
export function navegar(forzar = false): Promise<void> {
  cadena = cadena.then(() => navegarAhora(forzar), () => navegarAhora(forzar));
  return cadena;
}
async function navegarAhora(forzar: boolean): Promise<void> {
  const id = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const p = pantallas.find((x) => x.id === id) ?? pantallas[0];
  const t0 = Date.now();
  if (p.id !== actual || forzar) {
    if (p.id !== actual) document.getElementById('contenido')!.scrollTop = 0;
    actual = p.id;
    document.querySelectorAll('.menu a').forEach((a) => a.classList.toggle('activo', (a as HTMLElement).dataset.id === p.id));
    document.getElementById('titulo')!.textContent = p.titulo;
    document.getElementById('pregunta')!.textContent = p.pregunta;
  }
  const c = document.getElementById('contenido')!;
  liberarGraficos();
  try {
    c.innerHTML = await p.pintar();
    montar();
  } catch (e) {
    console.error(e);
    c.innerHTML = `<div class="tarjeta">${insignia('Error', 'crit')} ${esc((e as Error).message)}</div>`;
  }
  if (!forzar) llamar('registrarUso', `Abrir pantalla`, p.menu, '', t0).catch(() => undefined);
}
export const repintar = () => navegar(true);

export function actualizarBarra(): void {
  const ds = estado.info?.datasets ?? [];
  const chip = document.getElementById('chip-datos')!;
  chip.textContent = ds.length ? `🗄 ${ds.map((d) => (d.tipo === 'ventas' ? 'Ventas ' : 'Kardex ') + (d.fecha_min ?? '').slice(0, 4) + '–' + (d.fecha_max ?? '').slice(0, 4)).join(' · ')}` : '🗄 Sin datos cargados';
  const sello = document.getElementById('chip-sello')!;
  const R = estado.R;
  sello.className = `chip ${R?.desactualizado ? 'aviso' : ''}`;
  sello.textContent = R?.generadoEn ? `${R.desactualizado ? '⚠ Resultados desactualizados · ' : '⟳ Actualizado: '}${fechaPE(R.generadoEn)}` : '⟳ Sin análisis ejecutado';
}

/** Tras cualquier cambio de datos: refresca la información del motor y persiste la BD (solo EXE). */
export async function trasCambioDeDatos(): Promise<void> {
  const info = await llamar<InfoMotor>('info');
  estado.info = info;
  if (estado.R) estado.R.desactualizado = info.desactualizado;
  actualizarBarra();
  guardarSiEXE();
}
let tGuardar: ReturnType<typeof setTimeout> | undefined;
export function guardarSiEXE(): void {
  if (!esEXE()) return;
  clearTimeout(tGuardar);
  tGuardar = setTimeout(async () => { await persistirBD(await llamar<Uint8Array>('exportarBD')); }, 800);
}

// ---------------- Datos de la práctica (embebidos) ----------------
export async function cargarDatosPractica(): Promise<void> {
  if (estado.ocupado) return;
  estado.ocupado = true;
  const v = velo('Cargando los datos de la práctica', 'Se leen los dos Excel embebidos (el archivo original no se modifica) y se validan con las reglas de calidad V00–V12 y K01–K11.');
  try {
    for (const [url, nombre, pct] of [[ventasUrl, 'TABLA DATOS MOVIMIENTOS VENTAS Y UTILIDAD.xlsx', 30], [kardexUrl, 'KARDEX MOVIMIENTOS ALMACEN.xls', 75]] as const) {
      v.avance(pct - 25, `Importando ${nombre}…`);
      const datos = new Uint8Array(await (await fetch(url)).arrayBuffer());
      const r = await llamar<{ tipo: string; resumen: { filasValidas?: number; movimientos?: number; indiceCalidad: number } }>('importar', datos, nombre);
      v.linea(`✔ ${nombre}: ${r.tipo === 'ventas' ? `${r.resumen.filasValidas} filas` : `${r.resumen.movimientos} movimientos`} · índice de calidad ${(r.resumen.indiceCalidad * 100).toFixed(1)} %`);
    }
    v.avance(100, 'Datos listos');
    await trasCambioDeDatos();
    avisar('✔ Datos de la práctica cargados. Siguiente paso: <b>▶ Análisis completo en 1 clic</b>.', 'ok');
  } catch (e) { avisar(`No se pudieron cargar los datos: ${esc((e as Error).message)}`, 'error', 9000); }
  finally { v.cerrar(); estado.ocupado = false; }
  await repintar();
}

// ---------------- "Análisis completo en 1 clic" ----------------
export async function analisisCompleto(): Promise<void> {
  if (estado.ocupado) return;
  if (!estado.info?.datasets.length) { avisar('Primero cargue datos: pantalla <b>Datos</b> o botón <b>Cargar datos de la práctica</b>.', 'warn'); location.hash = '#/datos'; return; }
  estado.ocupado = true;
  const v = velo('Super Agente IA · Análisis completo', 'El Coordinador ejecuta las skills en orden; el Evaluador independiente verifica las cifras. Los cálculos corren en segundo plano: la ventana no se congela.', true);
  const quitar = alProgresar((p) => { v.flujo(p.paso); v.avance(p.pct, p.detalle); v.linea(`${new Date(Date.now() - 5 * 3600e3).toISOString().slice(11, 19)} · ${p.paso} · ${p.detalle}`); });
  try {
    await llamar('analisisCompleto', {});
    estado.R = await llamar('resultados');
    await trasCambioDeDatos();
    const skills = [estado.R!.dv, estado.R!.gv, estado.R!.pv, estado.R!.dk, estado.R!.gk, estado.R!.pk, estado.R!.pr, estado.R!.sm].filter(Boolean);
    const rev = skills.filter((s) => s!.status !== 'OK');
    avisar(`✔ Análisis completo: ${skills.length} resultados guardados en la BD${rev.length ? ` · ${rev.length} con estado PROVISIONAL/REVISAR (ver detalle en cada pantalla)` : ''}. Estado: <b>PROPUESTO</b>, pendiente de su aprobación en Prescriptivo.`, 'ok', 8000);
  } catch (e) { avisar(`El análisis se detuvo: ${esc((e as Error).message)}`, 'error', 10000); }
  finally { quitar(); v.cerrar(); estado.ocupado = false; }
  await repintar();
}

/** Ventana de progreso con la máquina de estados visible. */
export function velo(titulo: string, texto: string, conFlujo = false) {
  const d = document.createElement('div'); d.className = 'velo'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-live', 'polite');
  d.innerHTML = `<div class="caja"><h3>${esc(titulo)}</h3><p class="nota" style="margin:4px 0 0">${esc(texto)}</p>
    ${conFlujo ? `<div class="pasos">${ESTADOS_FLUJO.map((e) => `<div class="p" data-e="${e}"><i></i>${ETIQ_FLUJO[e]}</div>`).join('')}</div>` : '<div style="height:12px"></div>'}
    <div class="barra-pct"><i style="width:2%"></i></div><div class="nota" id="velo-det" style="margin-top:6px">Iniciando…</div><div class="bitacora-agente"></div></div>`;
  document.body.appendChild(d);
  const log = d.querySelector('.bitacora-agente') as HTMLElement;
  return {
    avance(pct: number, det: string) { (d.querySelector('.barra-pct i') as HTMLElement).style.width = `${Math.max(2, pct)}%`; d.querySelector('#velo-det')!.textContent = `${pct.toFixed(0)} % · ${det}`; },
    linea(t: string) { log.insertAdjacentHTML('beforeend', `<div>${esc(t)}</div>`); log.scrollTop = log.scrollHeight; },
    flujo(e: string) {
      const i = ESTADOS_FLUJO.indexOf(e);
      d.querySelectorAll<HTMLElement>('.pasos .p').forEach((p, k) => { p.classList.toggle('hecho', k < i || (k === i && e !== 'ANALIZADO' && e !== 'EVALUADO' && e !== 'PROPUESTO')); p.classList.toggle('actual', k === i); });
    },
    cerrar() { d.remove(); },
  };
}
