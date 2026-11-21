/** Pantalla 8 · Copiloto IA del Super Agente: "Pregúntale a tus datos" (sin búsqueda web; cifras verificadas). */
import { registrar, estado, analisisCompleto } from '../app';
import { llamar } from '../motor';
import { tarjeta, insignia, esc, trasPintar, avisar } from '../componentes';
import { llmActivo, redactar, proveedor } from '../llm';
import type { Respuesta } from '../../core/agentes/copiloto';

interface Mensaje { de: 'u' | 'a'; html: string; meta?: string }
const historial: Mensaje[] = [];
const SUGERENCIAS = ['¿Cómo va el negocio?', '¿Por qué bajó el margen?', '¿Qué productos pierden dinero?', '¿Cuánto venderemos en los próximos 6 meses?', '¿Qué debo comprar el próximo mes?',
  '¿Qué productos están por quebrar stock?', '¿El Kardex cuadra?', '¿Qué debo hacer?', '¿Cuál es el impacto económico?', '¿Qué escenarios hay?', '¿Qué tan confiable es el pronóstico?', '¿Cuáles son los supuestos?'];

/** Markdown mínimo y seguro: escapa todo y luego aplica **negrita** y saltos de línea. */
export const md = (t: string) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br/>');
const burbuja = (m: Mensaje) => `<div class="burbuja ${m.de}">${m.html}${m.meta ? `<div class="nota" style="margin-top:6px">${m.meta}</div>` : ''}</div>`;

async function preguntar(texto: string): Promise<void> {
  texto = texto.trim(); if (!texto) return;
  const chat = document.getElementById('chat')!;
  historial.push({ de: 'u', html: esc(texto) });
  chat.insertAdjacentHTML('beforeend', burbuja(historial.at(-1)!) + '<div class="burbuja a" id="pensando">⏳ El Super Agente consulta los resultados…</div>');
  chat.scrollTop = chat.scrollHeight;
  const r = await llamar<Respuesta>('preguntar', texto);
  const fuentes = r.fuentes.length ? `Fuente: ${r.fuentes.map((f) => `${esc(f.skill)} <code>${f.run_id.slice(0, 8)}</code>`).join(' · ')}` : 'Fuente: consulta a la base de datos';
  let m: Mensaje = { de: 'a', html: md(r.texto), meta: `${insignia('Motor determinístico · sin LLM', 'info')} ${fuentes}` };
  if (llmActivo() && r.cifras.length) {
    try {
      const t = await redactar(texto, r.hechos, r.texto);
      const v = await llamar<{ ok: boolean; noVerificadas: string[] }>('verificarTexto', t.replace(/\*\*/g, ''), r.cifras);
      m = v.ok ? { de: 'a', html: md(t), meta: `${insignia(`Redactado por LLM (${proveedor()}) · cifras verificadas por el Evaluador`, 'ok')} ${fuentes}` }
        : { ...m, meta: `${insignia(`El Evaluador rechazó la redacción del LLM (cifras no verificables: ${v.noVerificadas.slice(0, 4).join(', ')}); se muestra la respuesta del motor`, 'warn')} ${fuentes}` };
      await llamar('registrarUso', v.ok ? 'Respuesta LLM verificada' : 'Respuesta LLM rechazada por el Evaluador', 'Copiloto IA', v.ok ? r.intencion : v.noVerificadas.join(', '), Date.now());
    } catch (e) {
      m = { ...m, meta: `${insignia(`LLM no disponible (${esc((e as Error).message)}); respuesta del motor`, 'warn')} ${fuentes}` };
    }
  }
  historial.push(m);
  document.getElementById('pensando')?.remove();
  chat.insertAdjacentHTML('beforeend', burbuja(m));
  const sug = document.getElementById('sug-dinamicas');
  if (sug && r.sugerencias.length) sug.innerHTML = r.sugerencias.map((s) => `<button class="btn chico sug">${esc(s)}</button>`).join(' ');
  chat.scrollTop = chat.scrollHeight;
}

registrar({ id: 'copiloto', icono: '🤖', menu: 'Copiloto IA (Super Agente)', titulo: 'Copiloto IA · Pregúntale a tus datos', pregunta: 'Conversación con el Super Agente: responde solo con cifras calculadas por el sistema (sin búsqueda web)', separador: true,
  pintar() {
    const sinR = !estado.R?.generadoEn;
    const bienvenida = `👋 Hola, soy el <b>Super Agente</b>. Respondo con las cifras calculadas y guardadas por el sistema, citando la skill y el <code>run_id</code> de origen. No busco en internet y no invento cifras.${sinR ? '<br/><br/>⚠ Aún no hay resultados: pulse <b>▶ Análisis completo en 1 clic</b> para que pueda responder sobre pronósticos, recomendaciones y escenarios.' : ''}`;
    trasPintar(() => {
      const f = document.getElementById('f-chat') as HTMLFormElement, i = document.getElementById('q') as HTMLInputElement;
      f.addEventListener('submit', async (e) => { e.preventDefault(); const t = i.value; i.value = ''; i.disabled = true; try { await preguntar(t); } catch (er) { avisar(esc((er as Error).message), 'error'); } finally { i.disabled = false; i.focus(); } });
      document.getElementById('copiloto-raiz')!.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button.sug'); if (b) { i.value = b.textContent ?? ''; f.requestSubmit(); } });
      document.getElementById('c-1clic')?.addEventListener('click', analisisCompleto);
      document.getElementById('c-limpiar')!.addEventListener('click', () => { historial.length = 0; document.getElementById('chat')!.innerHTML = `<div class="burbuja a">${bienvenida}</div>`; });
      const c = document.getElementById('chat')!; c.scrollTop = c.scrollHeight; i.focus();
    });
    return `<div class="grid g21" id="copiloto-raiz">
      <div class="tarjeta" style="display:flex;flex-direction:column;min-height:560px">
        <div class="chat" id="chat" style="flex:1;overflow-y:auto;max-height:560px;padding-right:4px"><div class="burbuja a">${bienvenida}</div>${historial.map(burbuja).join('')}</div>
        <div class="fila mt" id="sug-dinamicas"></div>
        <form class="fila mt" id="f-chat" autocomplete="off"><input type="text" id="q" style="flex:1" maxlength="500" placeholder="Escriba su pregunta… (p. ej. ¿Qué debo comprar el próximo mes?)" aria-label="Pregunta al copiloto"/>
          <button class="btn primario">Enviar</button><button type="button" class="btn" id="c-limpiar" title="Borrar la conversación">🧹</button></form>
      </div>
      <div class="grid" style="align-content:start">
        ${tarjeta('Preguntas frecuentes', `<div class="fila" style="gap:6px">${SUGERENCIAS.map((s) => `<button class="btn chico sug">${esc(s)}</button>`).join('')}</div>
          <p class="nota mt">También puede escribir un código de producto (p. ej. <code>K00401</code> o <code>MATPRIMA-003</code>) o un mes (p. ej. «¿cuánto venderemos en junio?»).</p>${sinR ? '<button class="btn primario mt" id="c-1clic">▶ Análisis completo en 1 clic</button>' : ''}`)}
        ${tarjeta('Cómo responde', `<ul class="prose" style="font-size:12.5px;margin:0"><li><b>Motor (siempre):</b> un intérprete de 20 intenciones consulta los resultados de las skills y la BD.</li>
          <li><b>LLM (opcional):</b> ${llmActivo() ? `${insignia(`Activo · ${proveedor()}`, 'ok')} redacta la respuesta solo con los HECHOS del motor.` : `${insignia('Desactivado', 'gris')} actívelo en <a href="#/configuracion">Configuración</a> con su propia clave.`}</li>
          <li><b>Evaluador:</b> cada cifra redactada por el LLM se verifica contra el motor; si alguna no coincide, se muestra la respuesta del motor.</li>
          <li><b>Prohibido:</b> búsqueda web, cifras inventadas y escrituras en la BD.</li></ul>`)}
      </div></div>`;
  },
});
