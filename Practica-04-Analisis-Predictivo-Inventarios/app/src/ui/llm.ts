/**
 * LLM OPCIONAL del copiloto. Solo REDACTA a partir de los HECHOS calculados por el motor; no recibe herramientas,
 * no tiene búsqueda web y su texto pasa por el Evaluador de cifras antes de mostrarse.
 * La clave de API vive solo en memoria (se pierde al cerrar), salvo que el usuario marque "recordar" (se guarda en la BD).
 */
import { PROMPT_COPILOTO } from '../core/agentes/prompts';
import { estado } from './app';

let claveMemoria = '';
export const fijarClave = (k: string) => { claveMemoria = k.trim(); };
export const clave = () => claveMemoria || estado.cfg.llm_clave || '';
export const proveedor = () => (estado.cfg.llm_proveedor ?? 'ninguno') as 'ninguno' | 'anthropic' | 'openai';
export const llmActivo = () => proveedor() !== 'ninguno' && !!clave();
export const MODELO_DEFECTO = { anthropic: 'claude-sonnet-5', openai: 'gpt-4o-mini' } as const;

export async function redactar(pregunta: string, hechos: unknown, borrador: string): Promise<string> {
  const p = proveedor(), k = clave();
  if (p === 'ninguno' || !k) throw new Error('LLM no configurado');
  const usuario = `PREGUNTA DEL USUARIO:\n${pregunta}\n\nHECHOS DEL MOTOR (JSON, única fuente permitida):\n${JSON.stringify(hechos).slice(0, 12000)}\n\nBORRADOR DEL MOTOR (cifras ya formateadas; puedes reutilizarlas tal cual):\n${borrador}`;
  const modelo = estado.cfg.llm_modelo || MODELO_DEFECTO[p];
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    if (p === 'anthropic') {
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': k, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: modelo, max_tokens: 700, temperature: 0, system: PROMPT_COPILOTO, messages: [{ role: 'user', content: usuario }] }) });
      if (!r.ok) throw new Error(`El proveedor respondió ${r.status}`);
      const j = await r.json() as { content: { type: string; text?: string }[] };
      return j.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    }
    const base = (estado.cfg.llm_endpoint || 'https://api.openai.com/v1').replace(/\/$/, '');
    const r = await fetch(`${base}/chat/completions`, { method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${k}` },
      body: JSON.stringify({ model: modelo, temperature: 0, max_tokens: 700, messages: [{ role: 'system', content: PROMPT_COPILOTO }, { role: 'user', content: usuario }] }) });
    if (!r.ok) throw new Error(`El proveedor respondió ${r.status}`);
    const j = await r.json() as { choices: { message: { content: string } }[] };
    return j.choices[0]?.message.content.trim() ?? '';
  } finally { clearTimeout(t); }
}
