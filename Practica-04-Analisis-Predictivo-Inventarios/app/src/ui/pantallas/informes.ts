/** Pantalla 9 · Informes y presentación: técnico y ejecutivo (Word/PDF, versionados) y presentación (.pptx). */
import { registrar, estado, analisisCompleto, trasCambioDeDatos, repintar, velo } from '../app';
import { llamar } from '../motor';
import { tarjeta, tabla, vacio, insignia, esc, fmtNum, fechaPE, trasPintar, avisar } from '../componentes';
import { guardarArchivo, deBase64 } from '../host';
import { construirDocumento, graficosInforme, resumenCifras, type Documento, type Contexto } from '../informes/modelo';
import { aWord } from '../informes/word';
import { aPDF } from '../informes/pdf';
import { aPPTX } from '../informes/presentacion';

type Tipo = 'tecnico' | 'ejecutivo' | 'presentacion';
interface FilaInf { id: number; tipo: Tipo; version: number; generado_en: string; cambios: string; aportes_usuario: string; hash: string; bytes: number }
const NOMBRE: Record<Tipo, string> = { tecnico: 'Informe_Tecnico', ejecutivo: 'Informe_Ejecutivo', presentacion: 'Presentacion_Alta_Direccion' };
const MIME = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
const b64 = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };

async function contexto(tipo: Tipo, version: number, fecha: string, cambios: string[]): Promise<Contexto> {
  const ds = estado.info?.datasets ?? [];
  const ult = ['ventas', 'kardex'].map((t) => [...ds].reverse().find((d) => d.tipo === t)).filter(Boolean);
  const [parametros, calidad, previas] = await Promise.all([
    llamar<Contexto['parametros']>('parametros'),
    Promise.all(ult.map((d) => llamar<{ tipo: string; porSeveridad: Record<string, number> }>('calidad', d!.id))),
    llamar<FilaInf[]>('informes')]);
  const historial = previas.filter((x) => x.tipo === tipo).sort((a, b) => a.version - b.version).map((x) => ({ version: x.version, generado_en: x.generado_en, cambios: x.cambios }));
  historial.push({ version, generado_en: fecha, cambios: cambios.join('\n') });
  return { R: estado.R!, parametros, calidad, datasets: ult as never, aportes: estado.cfg.aportes_usuario ?? '', version, fecha, historial };
}

/** Genera una NUEVA versión (control de cambios automático) y descarga el archivo. */
async function generar(tipo: Tipo, formato: 'docx' | 'pdf' | 'pptx'): Promise<void> {
  const v = velo(`Generando ${tipo === 'presentacion' ? 'la presentación' : `el informe ${tipo}`}`, 'Skill redactar_informe / generar_ppt: todas las cifras salen de los resultados del Super Agente; los gráficos se dibujan en memoria.');
  try {
    const R = estado.R!, aportes = estado.cfg.aportes_usuario ?? '';
    v.avance(10, 'Control de cambios respecto a la versión anterior…');
    const resumen = resumenCifras(R);
    const { version, cambios, fecha } = await llamar<{ version: number; cambios: string[]; fecha: string }>('cambiosInforme', tipo, resumen, aportes);
    v.linea(`Versión v${version}: ${cambios.length} cambio(s)`);
    let bytes: Uint8Array, contenido: string;
    if (tipo === 'presentacion') {
      v.avance(40, 'Diapositivas con gráficos nativos de PowerPoint…');
      bytes = await aPPTX(R, { version, fecha, aportes });
      contenido = JSON.stringify({ resumen, pptx: b64(bytes) });
    } else {
      v.avance(30, 'Dibujando gráficos…');
      await new Promise((r) => setTimeout(r, 30));
      const g = graficosInforme(R);
      v.avance(55, 'Redactando secciones…');
      const doc = construirDocumento(tipo, await contexto(tipo, version, fecha, cambios), g);
      v.avance(75, formato === 'pdf' ? 'Componiendo el PDF…' : 'Componiendo el Word…');
      bytes = formato === 'pdf' ? aPDF([doc]) : await aWord([doc]);
      contenido = JSON.stringify(doc);
    }
    v.avance(92, 'Guardando la versión en la base de datos…');
    const hash = await llamar<string>('guardarInforme', tipo, version, fecha, cambios, aportes, contenido);
    await trasCambioDeDatos();
    v.cerrar();
    await guardarArchivo(`${NOMBRE[tipo]}_v${version}.${formato}`, bytes, MIME[formato]);
    avisar(`✔ ${NOMBRE[tipo].replace(/_/g, ' ')} <b>v${version}</b> generado (${fmtNum(bytes.length / 1024, 0)} KB · huella ${hash.slice(0, 12)}).`, 'ok', 7000);
    repintar();
  } catch (e) { v.cerrar(); console.error(e); avisar(`No se pudo generar: ${esc((e as Error).message)}`, 'error', 9000); }
}

/** Vuelve a descargar una versión guardada, exactamente como se generó. */
async function descargar(tipo: Tipo, version: number, formato: 'docx' | 'pdf' | 'pptx'): Promise<void> {
  const r = await llamar<{ contenido_json: string } | null>('informeContenido', tipo, version);
  if (!r) return;
  const c = JSON.parse(r.contenido_json);
  const bytes = tipo === 'presentacion' ? deBase64(c.pptx) : formato === 'pdf' ? aPDF([c as Documento]) : await aWord([c as Documento]);
  await guardarArchivo(`${NOMBRE[tipo]}_v${version}.${formato}`, bytes, MIME[formato]);
  await llamar('registrarUso', `Descargar ${NOMBRE[tipo]} v${version} (${formato})`, 'Informes y presentación', '', Date.now());
}

/** Un solo documento con TODAS las versiones del informe ejecutivo y su control de cambios (Pregunta 02). */
async function consolidado(formato: 'docx' | 'pdf'): Promise<void> {
  const vs = (await llamar<FilaInf[]>('informes')).filter((x) => x.tipo === 'ejecutivo').sort((a, b) => a.version - b.version);
  if (!vs.length) { avisar('Primero genere al menos una versión del informe ejecutivo.', 'warn'); return; }
  const docs: Documento[] = [];
  for (const x of vs) docs.push(JSON.parse((await llamar<{ contenido_json: string }>('informeContenido', 'ejecutivo', x.version)).contenido_json));
  const prefacio = [
    { t: 'h1' as const, texto: `Informe ejecutivo · control de versiones (v1–v${vs.length})` },
    { t: 'p' as const, texto: 'Este documento reúne todas las versiones del informe ejecutivo generadas por el Sistema de Análisis de Datos y Predictivo de Gestión de Inventarios, en orden cronológico. Cada versión conserva exactamente su contenido original; la tabla resume qué cambió entre versiones.' },
    { t: 'tabla' as const, cols: ['Versión', 'Fecha', 'Cambios respecto a la anterior', 'Huella SHA-256'], anchos: [9, 16, 55, 20], filas: vs.map((x) => [`v${x.version}`, x.generado_en.replace('T', ' '), x.cambios, x.hash.slice(0, 16)]) },
  ];
  const bytes = formato === 'pdf' ? aPDF(docs, prefacio) : await aWord(docs, prefacio);
  await guardarArchivo(`Informe_Ejecutivo_Versiones_v1-v${vs.length}.${formato}`, bytes, MIME[formato]);
  await llamar('registrarUso', `Descargar informe ejecutivo con ${vs.length} versiones (${formato})`, 'Informes y presentación', '', Date.now());
  avisar(`✔ Informe ejecutivo con las ${vs.length} versiones descargado.`, 'ok');
}

registrar({ id: 'informes', icono: '📄', menu: 'Informes y presentación', titulo: 'Informes y presentación', pregunta: 'Informe técnico, informe ejecutivo (versiones con control de cambios) y presentación para la alta dirección, generados por el sistema',
  async pintar() {
    const inf = await llamar<FilaInf[]>('informes');
    const hayR = !!estado.R?.generadoEn;
    trasPintar(() => {
      const raiz = document.getElementById('inf-raiz')!;
      raiz.addEventListener('click', async (e) => {
        const b = (e.target as HTMLElement).closest('button[data-acc]') as HTMLButtonElement | null; if (!b) return;
        const { acc, tipo, fmt, ver } = b.dataset as { acc: string; tipo: Tipo; fmt: 'docx' | 'pdf' | 'pptx'; ver?: string };
        b.disabled = true;
        try {
          if (acc === 'gen') await generar(tipo, fmt);
          else if (acc === 'desc') await descargar(tipo, Number(ver), fmt);
          else if (acc === 'cons') await consolidado(fmt as 'docx' | 'pdf');
        } finally { b.disabled = false; }
      });
      document.getElementById('i-1clic')?.addEventListener('click', analisisCompleto);
      document.getElementById('ap-guardar')!.addEventListener('click', async () => {
        const v = (document.getElementById('ap-texto') as HTMLTextAreaElement).value;
        await llamar('guardarConfiguracion', 'aportes_usuario', v); estado.cfg.aportes_usuario = v;
        await llamar('registrarUso', 'Guardar aportes del usuario', 'Informes y presentación', `${v.length} caracteres`, Date.now());
        await trasCambioDeDatos(); avisar('✔ Aportes guardados en la BD; se incluirán en la próxima versión del informe y de la presentación.', 'ok');
      });
    });
    const cuenta = (t: Tipo) => inf.filter((x) => x.tipo === t).length;
    const btn = (acc: string, tipo: Tipo, fmt: string, texto: string, prim = false, ver?: number) => `<button class="btn ${prim ? 'primario' : 'chico'}" data-acc="${acc}" data-tipo="${tipo}" data-fmt="${fmt}" ${ver ? `data-ver="${ver}"` : ''} ${hayR || acc !== 'gen' ? '' : 'disabled'}>${texto}</button>`;
    const aviso = hayR ? (estado.R?.desactualizado ? `<div class="tarjeta" style="margin-bottom:14px">${insignia('Resultados desactualizados', 'warn')} Los datos o parámetros cambiaron: ejecute el análisis completo antes de generar una nueva versión. <button class="btn chico" id="i-1clic">▶ Análisis completo</button></div>` : '')
      : vacio('📄', 'Primero ejecute el análisis', 'Los informes y la presentación se redactan con los resultados del Super Agente.', '<button class="btn primario" id="i-1clic">▶ Análisis completo en 1 clic</button>');
    return `<div id="inf-raiz">${aviso}
      <div class="grid g3">
        ${tarjeta('Informe técnico', `<p class="nota" style="margin-top:0">Completo (Pregunta 01): resumen, datos y calidad, los cuatro análisis, simulación, propuestas por problema crítico, plan de implementación, impacto económico con sensibilidad del ROI, conclusiones, supuestos, aportes y trazabilidad.</p>
          <div class="fila">${btn('gen', 'tecnico', 'docx', '📝 Nueva versión · Word', true)}${btn('gen', 'tecnico', 'pdf', '📕 Nueva versión · PDF')}</div><p class="nota">${cuenta('tecnico')} versión(es) guardada(s)</p>`)}
        ${tarjeta('Informe ejecutivo', `<p class="nota" style="margin-top:0">Resumido para la dirección (Pregunta 02) con control de versiones automático (qué cambió entre v1, v2, v3…) y la sección «Aportes del usuario».</p>
          <div class="fila">${btn('gen', 'ejecutivo', 'docx', '📝 Nueva versión · Word', true)}${btn('gen', 'ejecutivo', 'pdf', '📕 Nueva versión · PDF')}</div>
          <div class="fila mt">${btn('cons', 'ejecutivo', 'docx', `📚 Todas las versiones en un Word (${cuenta('ejecutivo')})`)}${btn('cons', 'ejecutivo', 'pdf', 'PDF')}</div>`)}
        ${tarjeta('Presentación ejecutiva', `<p class="nota" style="margin-top:0">12 diapositivas para la alta dirección con gráficos nativos (editables) de PowerPoint: situación, margen, causas, inventario, pronóstico, escenarios, recomendaciones, impacto, plan, decisiones y trazabilidad.</p>
          <div class="fila">${btn('gen', 'presentacion', 'pptx', '📊 Nueva versión · PowerPoint', true)}</div><p class="nota">${cuenta('presentacion')} versión(es) guardada(s)</p>`)}
      </div>
      <div class="grid g12 mt">
        ${tarjeta('Aportes del usuario', `<textarea id="ap-texto" rows="12" style="width:100%" placeholder="Escriba aquí sus observaciones, correcciones o decisiones sobre el análisis del Super Agente. Se incluyen en el informe (sección «Aportes del usuario») y en la presentación.">${esc(estado.cfg.aportes_usuario ?? '')}</textarea>
          <div class="fila mt"><button class="btn primario" id="ap-guardar">Guardar aportes</button><span class="nota">Al cambiar los aportes, la siguiente versión lo registra en su control de cambios.</span></div>`, { sub: 'Exigido por la Pregunta 02' })}
        ${tarjeta('Versiones generadas', inf.length ? tabla(inf as never[], [
          { k: 'tipo', t: 'Documento', f: (v) => ({ tecnico: 'Informe técnico', ejecutivo: 'Informe ejecutivo', presentacion: 'Presentación' } as Record<string, string>)[v as string] },
          { k: 'version', t: 'Versión', n: true, f: (v) => `v${v}` }, { k: 'generado_en', t: 'Generado', f: (v) => fechaPE(String(v).replace('T', ' ')) },
          { k: 'cambios', t: 'Cambios', f: (v) => `<span class="nota">${esc(v).replace(/\n/g, '<br/>')}</span>` },
          { k: 'hash', t: 'Descargar', f: (_v, r) => { const x = r as unknown as FilaInf; return x.tipo === 'presentacion' ? btn('desc', x.tipo, 'pptx', 'PPTX', false, x.version) : btn('desc', x.tipo, 'docx', 'Word', false, x.version) + ' ' + btn('desc', x.tipo, 'pdf', 'PDF', false, x.version); } }],
          { nombre: 'versiones_informes', alto: 420 }) : '<p class="nota">Aún no hay versiones. Cada versión queda guardada en la BD con su fecha, sus cambios respecto a la anterior y su huella SHA-256, y se puede volver a descargar idéntica.</p>')}
      </div></div>`;
  },
});
