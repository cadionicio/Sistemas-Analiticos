/**
 * Pruebas del Paso 10: copiloto del Super Agente (intérprete de intenciones sin LLM) y Evaluador de textos.
 * Se ejecuta el pipeline completo sobre los Excel reales (con menos trayectorias para acelerar).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { BaseDatos } from '../src/core/db/db';
import { importarVentas } from '../src/core/ingesta/ventas';
import { importarKardex } from '../src/core/ingesta/kardex';
import { describirVentas, describirKardex } from '../src/core/analitica/descriptivo';
import { diagnosticarVentas, diagnosticarKardex } from '../src/core/analitica/diagnostico';
import { proyectarVentas, proyectarKardex } from '../src/core/analitica/predictivo';
import { optimizarPlan, asegurarParametros } from '../src/core/analitica/prescriptivo';
import { simularEscenarios } from '../src/core/analitica/montecarlo';
import { responder, verificarCifras } from '../src/core/agentes/copiloto';
import type { Resultados } from '../src/core/agentes/resultados';

let bd: BaseDatos; const R: Resultados = {};
beforeAll(async () => {
  bd = await BaseDatos.abrir(); asegurarParametros(bd);
  const v = (await importarVentas(bd, readFileSync('tests/fixtures/ventas.xlsx'), 'ventas.xlsx')).datasetId;
  const k = (await importarKardex(bd, readFileSync('tests/fixtures/kardex.xls'), 'kardex.xls')).datasetId;
  R.dv = describirVentas(bd, v); R.gv = diagnosticarVentas(bd, v, R.dv.result); R.pv = proyectarVentas(bd, v, { trayectorias: 2000 });
  R.dk = describirKardex(bd, k); R.gk = diagnosticarKardex(bd, k, R.dk.result); R.pk = proyectarKardex(bd, k, { trayectorias: 1000 });
  R.pr = optimizarPlan(bd, k, R.dk.result, R.pk.result, v, R.dv.result, R.gv.result);
  R.sm = simularEscenarios(bd, R.pr.result, k, v, { iteraciones: 1000 });
}, 240_000);

const CASOS: [string, string][] = [
  ['¿Cómo va el negocio?', 'resumen'], ['¿Por qué bajó el margen?', 'por_que'], ['¿Qué productos pierden dinero?', 'perdidas'],
  ['¿Cuánto venderemos en los próximos 6 meses?', 'pronostico'], ['¿Cuánto venderemos en junio?', 'pronostico'], ['¿Qué debo comprar el próximo mes?', 'comprar'],
  ['¿Qué productos están por quebrar stock?', 'quiebres'], ['¿Qué debo hacer?', 'recomendaciones'], ['¿Cuál es el impacto económico?', 'impacto'],
  ['¿Qué escenarios hay?', 'escenarios'], ['¿Qué variable es la más sensible?', 'sensibilidad'], ['¿Qué tan confiable es el modelo?', 'modelo'],
  ['Muéstrame la clasificación ABC', 'abc'], ['¿Qué productos tienen demanda intermitente?', 'patrones'], ['¿Cuáles son los supuestos?', 'supuestos'],
  ['¿Qué departamento tiene peor margen?', 'departamentos'], ['¿Cómo está Cusco?', 'departamentos'], ['¿El Kardex cuadra?', 'kardex'],
  ['¿Hay stock inmovilizado u obsoleto?', 'sobrestock'], ['¿Cuál es la probabilidad de perder dinero?', 'pronostico_utilidad'], ['¿Cuánto vendimos?', 'ventas'],
  ['ayuda', 'ayuda'], ['Dime todo sobre K00401', 'producto'], ['¿Cómo está MATPRIMA-003?', 'producto'], ['¿Quién ganó el mundial?', 'desconocida'],
];

describe('T-COP · Copiloto sin LLM', () => {
  it.each(CASOS)('«%s» → intención %s', (q, esperado) => {
    expect(responder({ R, bd }, q).intencion).toBe(esperado);
  });
  it('T-COP-01 anti-alucinación: TODA cifra de cada respuesta existe en los resultados del motor (Evaluador)', () => {
    const fallas = CASOS.map(([q]) => { const r = responder({ R, bd }, q); return { q, nv: verificarCifras(r.texto.replace(/\*\*/g, ''), r.cifras).noVerificadas }; }).filter((x) => x.nv.length);
    expect(fallas).toEqual([]);
  });
  it('T-COP-02 cada respuesta con cifras cita su fuente (skill + run_id)', () => {
    for (const q of ['¿Cómo va el negocio?', '¿Qué debo hacer?', '¿Cuánto venderemos en los próximos 6 meses?']) {
      const r = responder({ R, bd }, q);
      expect(r.fuentes.length).toBeGreaterThan(0);
      expect(r.fuentes.every((f) => /^[0-9a-f-]{36}$/.test(f.run_id))).toBe(true);
    }
  });
  it('T-COP-03 la pregunta por un mes devuelve ese mes del horizonte', () => {
    expect(responder({ R, bd }, '¿Cuánto venderemos en junio?').texto).toMatch(/jun 19/);
  });
  it('T-COP-04 sin resultados, el copiloto pide ejecutar el análisis (no inventa)', () => {
    expect(responder({ R: {}, bd }, '¿Qué debo hacer?').texto).toMatch(/Análisis completo/);
  });
});

describe('T-EVT · Evaluador de textos (verifica redacciones de un LLM)', () => {
  const cifras = [1045594437.12, 0.0265, 27714000.5, -0.051];
  it('acepta cifras copiadas en cualquier presentación', () => {
    expect(verificarCifras('Ventas S/ 1,045.6 M; margen 2.65 %; utilidad S/ 27.7 M (-5.1 %) en 2019.', cifras).ok).toBe(true);
  });
  it('rechaza una cifra inventada o alterada', () => {
    const v = verificarCifras('Ventas S/ 1,145.6 M y margen 3.10 %.', cifras);
    expect(v.ok).toBe(false);
    expect(v.noVerificadas).toEqual(['1,145.6', '3.10']);
  });
});
