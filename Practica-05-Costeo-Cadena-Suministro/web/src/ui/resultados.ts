// Pestaña Resultados: dashboard + analítica descriptiva, diagnóstica, predictiva, prescriptiva y relevancia.
// La interfaz no calcula: muestra lo que devuelve app/analitica (corridas guardadas del motor).
import { Host } from "./pages2";
import { esc, money, num, pct, neg } from "./comun";
import { construirAnalitica, Analitica } from "../app/analitica";
import { lineas, barrasH, columnasDiv, COL, colorSerie, leyenda } from "./graficos";
import { fmtNum } from "../domain/formato";

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const mesCorto = (p: string) => {
  const m = /^(\d{4})-(\d{2})$/.exec(p);
  return m ? `${MES[+m[2] - 1]}-${m[1].slice(2)}` : p;
};
const f2 = (v: number) => fmtNum(v, 2);
const f0 = (v: number) => fmtNum(v, 0);
const pctTxt = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !isFinite(v) ? "—" : fmtNum(v * 100, d) + " %");

let cache: { key: string; A: Analitica | null } | null = null;
export function analitica(h: Host): Analitica | null {
  const c = h.ctx!;
  const key = `${c.versionId}|${h.s.rev}`;
  if (cache && cache.key === key) return cache.A;
  const A = construirAnalitica(h.s, c);
  cache = { key, A };
  return A;
}
export function invalidarAnalitica() { cache = null; }

const CLASE_COL: Record<string, string> = { AV: COL.s1, NAVN: COL.s2, NAVI: COL.s3 };
const CLASE_TXT: Record<string, string> = { AV: "Agrega valor (AV)", NAVN: "No agrega valor, necesaria (NAVN)", NAVI: "No agrega valor, innecesaria (NAVI)" };

export function pResultados(h: Host & { esModeloCompleto(): boolean }): string {
  const sub = h.st.sub.resultados || "dashboard";
  const tabs = h.subtabs("resultados", [
    { id: "dashboard", label: "Dashboard" }, { id: "descriptivo", label: "Descriptivo" }, { id: "diagnostico", label: "Diagnóstico" },
    { id: "predictivo", label: "Predictivo" }, { id: "prescriptivo", label: "Prescriptivo" }, { id: "relevancia", label: "Relevancia" },
  ]);
  const head = h.title("Resultados", "Costos conciliados y las cuatro analíticas sobre las corridas guardadas del motor. Histórico, actual, presupuestado y pronosticado se distinguen siempre.");
  if (!h.esModeloCompleto()) return head + tabs + `<div class="alert info">Este modelo solo contiene P3 (verificación). La analítica requiere un modelo completo: abre un modelo completo en «Modelo de Costeo».</div>`;
  const A = analitica(h);
  if (!A || !A.filas.length)
    return head + tabs + `<div class="empty"><h3>Aún no hay corridas guardadas</h3><p>La analítica usa únicamente resultados calculados y guardados por el motor (con su run_id). Ejecuta el costeo de todos los períodos.</p><button class="btn primary" data-act="run-abc-todos">Ejecutar costeo de todos los períodos</button></div>`;
  let avisos = "";
  if (A.faltantes.length) avisos += `<div class="alert warn">Faltan corridas en ${A.faltantes.length} período(s): ${esc(A.faltantes.slice(0, 6).join(", "))}${A.faltantes.length > 6 ? "…" : ""}. La analítica solo usa los períodos calculados. <button class="btn small" data-act="run-abc-todos">Ejecutar todos</button></div>`;
  if (A.desactualizados.length) avisos += `<div class="alert warn">Los datos de ${A.desactualizados.length} período(s) cambiaron después de su corrida (${esc(A.desactualizados.slice(0, 4).join(", "))}…). Las cifras mostradas son las recalculadas con los datos actuales; vuelve a ejecutar el costeo para dejar corridas vigentes. <button class="btn small" data-act="run-abc-todos">Recalcular todos</button></div>`;
  const ctxLine = `<p class="muted" style="margin:0 0 10px">Período actual del análisis: <b>${esc(A.ultima.nombre)}</b> (último mes con corrida · run_id ${esc(A.ultima.runId)}). Meses analizados: ${A.filas.length}.</p>`;
  const body =
    sub === "descriptivo" ? descriptivo(A) : sub === "diagnostico" ? diagnostico(A) : sub === "predictivo" ? predictivo(h, A) : sub === "prescriptivo" ? prescriptivo(h, A) : sub === "relevancia" ? relevancia(A) : dashboard(A);
  return head + tabs + avisos + ctxLine + body;
}

function kpi(lbl: string, val: string, sub: string, cls = "") {
  return `<div class="kpi ${cls}"><div class="lbl">${esc(lbl)}</div><div class="val">${val}</div><div class="src">${sub}</div></div>`;
}

function serieTotal(A: Analitica, campo: "total" | "unitario" | "volumen", pronIdx: number, titulo: string, fmt: (v: number) => string, unidad: string) {
  const P = A.pronosticos[pronIdx];
  const nh = A.filas.length, nf = P ? P.futuro.length : 0;
  const xs = [...A.filas.map((f) => mesCorto(f.periodo)), ...(P ? P.futuro.map((f) => mesCorto(f.periodo)) : [])];
  const hist = [...A.filas.map((f) => (f[campo] as number | null)), ...Array(nf).fill(null)];
  const ppto = campo === "total" ? [...A.filas.map((f) => f.ppto), ...Array(nf).fill(null)] : campo === "volumen" ? [...A.filas.map((f) => f.pptoVol), ...Array(nf).fill(null)] : [...A.filas.map((f) => (f.ppto && f.pptoVol ? f.ppto / f.pptoVol : null)), ...Array(nf).fill(null)];
  const pron = P ? [...Array(nh - 1).fill(null), hist[nh - 1], ...P.futuro.map((f) => f.central)] : [];
  const series: any[] = [{ id: "h", label: "Histórico (real)", color: COL.s1, valores: hist }];
  if (ppto.some((v) => v !== null)) series.push({ id: "p", label: "Presupuestado", color: COL.ppto, estilo: "guion", valores: ppto });
  if (P) series.push({ id: "f", label: "Pronosticado", color: COL.s2, estilo: "punto", valores: pron });
  const banda = P && P.futuro.some((f) => isFinite(f.bajo)) ? { bajo: [...Array(nh).fill(null), ...P.futuro.map((f) => f.bajo)], alto: [...Array(nh).fill(null), ...P.futuro.map((f) => f.alto)], color: COL.s2, label: "Banda aprox. 80 %" } : undefined;
  return lineas({ titulo, xs, series, banda, actual: nh - 1, fmt, unidad, ancho: 1200, alto: 300, leyendaExtra: `<p class="viz-note">El punto marcado es el período actual (${esc(A.ultima.nombre)}). El pronóstico usa ${P ? esc(P.elegidoNombre) : "—"}, elegido por backtesting.</p>` });
}

// ---------------- Dashboard ----------------
function dashboard(A: Analitica): string {
  const u = A.ultima;
  const vp = A.varPpto.find((v) => v.periodo === u.periodo);
  const P0 = A.pronosticos[0];
  const totN = A.filas.reduce((s, f) => s + f.total, 0);
  const naviN = A.filas.reduce((s, f) => s + f.navi, 0);
  const kpis = `<div class="grid g4" style="margin-bottom:14px">
    ${kpi("Costo de la cadena · " + u.nombre, money(u.total), A.crecimientoInteranual !== null ? `${pctTxt(A.crecimientoInteranual)} frente al mismo mes del año anterior` : "Sin mes comparable del año anterior")}
    ${kpi("Costo por pedido", u.unitario !== null ? money(u.unitario) : "—", `${f0(u.volumen)} pedidos en el mes`)}
    ${kpi("Real vs presupuesto", vp ? `${money(vp.variacion)}` : "—", vp ? `${pctTxt(vp.pct)} · ${vp.variacion > 0 ? "por encima (desfavorable)" : "por debajo (favorable)"}` : "Sin presupuesto cargado")}
    ${kpi("NAVI innecesarias", pctTxt(naviN / (totN || 1)), `${money(naviN)} acumulados en ${A.filas.length} meses`)}
    ${kpi("Capacidad no utilizada", money(u.capacidad), "Horas de personal pagadas no imputadas (mes actual)")}
    ${kpi("Pronóstico próximo mes", P0 && P0.futuro[0] ? money(P0.futuro[0].central) : "—", P0 && P0.futuro[0] && isFinite(P0.futuro[0].bajo) ? `${esc(P0.futuro[0].nombre)} · banda ${money(P0.futuro[0].bajo)} – ${money(P0.futuro[0].alto)}` : "Histórico insuficiente para banda")}
  </div>`;
  const comp = barrasH(`Composición del costo · ${u.nombre}`, [
    { label: "Material directo (CMD · P1)", valor: u.cmd, color: COL.s1 }, { label: "Servicio directo (CSD · P2)", valor: u.csd, color: COL.s1 },
    { label: "Personal directo (CPD · P3)", valor: u.cpd, color: COL.s1 }, { label: "Indirectos asignados (CI · P4a-P4b)", valor: u.ci, color: COL.s1 },
  ].map((x) => ({ ...x, nota: pctTxt(x.valor / (u.cmd + u.csd + u.cpd + u.ci || 1)) })), f2, undefined, "S/", 1200);
  const objs = A.objetos.map((o, i) => ({ o, i, d: u.objetos[o.codigo] }));
  const tablaObj = `<div class="matrix-wrap"><table class="matrix"><thead><tr><th>Objeto de costo</th><th>Costo del mes (S/)</th><th>Cantidad</th><th>Costo unitario (S/)</th><th>Participación</th></tr></thead><tbody>${objs
    .map(({ o, d }) => `<tr><td>${esc(o.codigo)} · ${esc(o.nombre)}</td><td class="num">${money(d?.costo)}</td><td class="num">${d?.cantidad != null ? f0(d.cantidad) : "—"}</td><td class="num">${d?.unitario != null ? money(d.unitario) : "—"}</td><td class="num">${pctTxt((d?.costo || 0) / (u.total || 1))}</td></tr>`)
    .join("")}<tr class="total"><td>Total</td><td class="num">${money(u.total)}</td><td class="num">${f0(u.volumen)}</td><td class="num">${u.unitario !== null ? money(u.unitario) : "—"}</td><td class="num">100,0 %</td></tr></tbody></table></div>`;
  const hall = A.hallazgos.slice(0, 4).map((x) => `<li><span class="pill ${x.tipo === "HECHO" ? "ok" : x.tipo === "ASOCIACIÓN" ? "calc" : "warn"}">${esc(x.tipo)}</span> ${esc(x.texto)}</li>`).join("");
  return kpis +
    `<section class="panel">${serieTotal(A, "total", 0, "Costo total de la cadena: histórico, presupuesto y pronóstico a 6 meses", f2, "S/ por mes")}</section>
    <section class="panel">${comp}</section>
    <section class="panel"><h3>Costo por objeto · ${esc(u.nombre)}</h3>${tablaObj}</section>
    <section class="panel"><h3>Hallazgos principales</h3><ul class="hallazgos">${hall}</ul><p class="muted">Ver todos en «Diagnóstico». Un hecho es una cifra verificable; una asociación es estadística (no causal); una hipótesis requiere evidencia adicional.</p></section>`;
}

// ---------------- Descriptivo ----------------
function descriptivo(A: Analitica): string {
  const filas = A.filas;
  const xs = filas.map((f) => mesCorto(f.periodo));
  // Con pocos objetos se ve la evolución de cada uno; con muchos (p. ej. 47 clientes) un gráfico de líneas sería
  // ilegible: se muestra el ranking del mes actual y la tabla completa queda en «Costo por objeto» del Dashboard.
  const u = A.ultima, TOP = 12;
  const obj = A.objetos.length <= 6
    ? lineas({
        titulo: "Costo unitario por objeto de costo", xs, fmt: f2, unidad: "S/ por unidad de la magnitud",
        series: A.objetos.map((o, i) => ({ id: o.codigo, label: `${o.codigo} ${o.nombre}`, color: colorSerie(i), valores: filas.map((f) => f.objetos[o.codigo]?.unitario ?? null), etiquetaFinal: true })),
      })
    : (() => {
        const orden = A.objetos.map((o) => ({ o, d: u.objetos[o.codigo] })).filter((x) => x.d).sort((a, b) => (b.d!.costo || 0) - (a.d!.costo || 0));
        const top = orden.slice(0, TOP), resto = orden.slice(TOP).reduce((s, x) => s + (x.d!.costo || 0), 0);
        const items = top.map(({ o, d }) => ({ label: `${o.codigo} ${o.nombre}`, valor: d!.costo, color: COL.s1, nota: pctTxt(d!.costo / (u.total || 1)),
          tip: `${o.codigo} ${o.nombre}\nCosto del mes: S/ ${f2(d!.costo)}\nCantidad: ${d!.cantidad != null ? f0(d!.cantidad) : "—"}\nCosto unitario: ${d!.unitario != null ? "S/ " + f2(d!.unitario) : "—"}` }));
        return barrasH(`Costo por objeto de costo · ${u.nombre} · ${TOP} de mayor costo de ${orden.length}`, items, f2, undefined, "S/", 640) +
          `<p class="viz-note">Los otros ${orden.length - TOP} objetos suman S/ ${f2(resto)} (${pctTxt(resto / (u.total || 1))} del mes). Pasa el mouse sobre una barra para ver cantidad y costo unitario; el detalle de los ${orden.length} objetos está en «Dashboard» → «Costo por objeto».</p>`;
      })();
  const comp = lineas({
    titulo: "Costo por componente", xs, fmt: f2, unidad: "S/ por mes",
    series: [
      { id: "cmd", label: "Material (CMD)", color: COL.s1, valores: filas.map((f) => f.cmd), etiquetaFinal: true },
      { id: "csd", label: "Servicio (CSD)", color: COL.s2, valores: filas.map((f) => f.csd), etiquetaFinal: true },
      { id: "cpd", label: "Personal (CPD)", color: COL.s3, valores: filas.map((f) => f.cpd), etiquetaFinal: true },
      { id: "ci", label: "Indirectos (CI)", color: COL.s4, valores: filas.map((f) => f.ci), etiquetaFinal: true },
    ],
  });
  const tabla = `<div class="matrix-wrap"><table class="matrix"><thead><tr><th class="frz">Período</th><th>run_id</th><th>CMD</th><th>CSD</th><th>CPD</th><th>CI</th><th>Total cadena</th><th>Pedidos</th><th>Costo / pedido</th><th>AV</th><th>NAVN</th><th>NAVI</th><th>Capacidad no utilizada</th><th>Fuera de alcance</th></tr></thead><tbody>${filas
    .map((f) => `<tr><td class="frz">${esc(f.nombre)}${f.vigente ? "" : ' <span class="pill warn">desactualizada</span>'}</td><td class="mono small">${esc(f.runId)}</td>${[f.cmd, f.csd, f.cpd, f.ci, f.total].map((v) => `<td class="num${neg(v)}">${num(v)}</td>`).join("")}<td class="num">${f0(f.volumen)}</td><td class="num">${f.unitario !== null ? num(f.unitario) : "—"}</td>${[f.av, f.nav, f.navi, f.capacidad, f.fuera].map((v) => `<td class="num">${num(v)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;
  const tot = filas.reduce((s, f) => s + f.total, 0), vol = filas.reduce((s, f) => s + f.volumen, 0);
  const media = tot / filas.length;
  const min = filas.reduce((a, f) => (f.total < a.total ? f : a)), max = filas.reduce((a, f) => (f.total > a.total ? f : a));
  return `<section class="panel"><h3>Qué pasó</h3><div class="grid g4" style="margin-bottom:14px">
      ${kpi("Costo acumulado", money(tot), `${filas.length} meses`)}${kpi("Promedio mensual", money(media), `Mín. ${esc(min.nombre)} ${money(min.total)} · Máx. ${esc(max.nombre)} ${money(max.total)}`)}
      ${kpi("Costo medio por pedido", money(tot / (vol || 1)), `${f0(vol)} pedidos`)}</div></section>
    <section class="panel">${serieTotal(A, "unitario", 2, "Costo por pedido: histórico, presupuesto y pronóstico", f2, "S/ por pedido")}</section>
    <div class="grid g2"><section class="panel">${comp}</section><section class="panel">${obj}</section></div>
    <section class="panel"><h3>Serie mensual (cifras de las corridas guardadas)</h3>${tabla}</section>`;
}

// ---------------- Diagnóstico ----------------
function diagnostico(A: Analitica): string {
  const vp = A.varPpto;
  const div = vp.length
    ? columnasDiv("Variación real − presupuesto por mes (S/)", vp.map((v) => mesCorto(v.periodo)), vp.map((v) => v.variacion), f2, undefined,
        vp.map((v) => `${v.nombre}\nVariación: ${f2(v.variacion)} (${pctTxt(v.pct)})\nEfecto volumen: ${f2(v.efVol)}\nEfecto costo unitario: ${f2(v.efCosto)}`), 1200)
    : `<div class="alert info">No hay presupuesto cargado para este modelo.</div>`;
  const tvp = vp.length ? `<div class="matrix-wrap"><table class="matrix"><thead><tr><th>Período</th><th>Real (S/)</th><th>Presupuesto (S/)</th><th>Variación</th><th>%</th><th>Efecto volumen</th><th>Efecto costo unitario</th><th>Costo/pedido real</th><th>Costo/pedido ppto.</th></tr></thead><tbody>${vp
    .map((v) => { const f = A.filas.find((x) => x.periodo === v.periodo)!; return `<tr><td>${esc(v.nombre)}</td><td class="num">${num(f.total)}</td><td class="num">${num(f.ppto)}</td><td class="num${neg(v.variacion)}">${num(v.variacion)}</td><td class="num${neg(v.pct)}">${pctTxt(v.pct)}</td><td class="num${neg(v.efVol)}">${num(v.efVol)}</td><td class="num${neg(v.efCosto)}">${num(v.efCosto)}</td><td class="num">${num(v.cR)}</td><td class="num">${num(v.cP)}</td></tr>`; })
    .join("")}</tbody></table></div><p class="muted">Variación = efecto volumen + efecto costo unitario (suma exacta). Efecto volumen = (pedidos reales − presupuestados) × costo/pedido presupuestado. Efecto costo = (costo/pedido real − presupuestado) × pedidos reales. Negativo = favorable.</p>` : "";
  const cm = A.cambioMensual.length ? `<div class="matrix-wrap"><table class="matrix"><thead><tr><th>Componente</th><th>Mes anterior</th><th>Mes actual</th><th>Cambio</th></tr></thead><tbody>${A.cambioMensual.map((x) => `<tr><td>${esc(x.componente)}</td><td class="num">${num(x.anterior)}</td><td class="num">${num(x.actual)}</td><td class="num${neg(x.delta)}">${num(x.delta)}</td></tr>`).join("")}</tbody></table></div>` : "<p class='muted'>Se necesita al menos un mes anterior.</p>";
  const ca = A.cambioActividades.length ? `<div class="matrix-wrap"><table class="matrix"><thead><tr><th>Actividad</th><th>Mes anterior</th><th>Mes actual</th><th>Cambio</th></tr></thead><tbody>${A.cambioActividades.map((x) => `<tr><td>${esc(x.codigo)} · ${esc(x.nombre)}</td><td class="num">${num(x.anterior)}</td><td class="num">${num(x.actual)}</td><td class="num${neg(x.delta)}">${num(x.delta)}</td></tr>`).join("")}</tbody></table></div>` : "<p class='muted'>Se necesita al menos un mes anterior.</p>";
  const rg = A.regresionVolumen;
  const an = A.anomalias.length ? `<div class="matrix-wrap"><table class="matrix"><thead><tr><th>Objeto</th><th>Período</th><th>Costo unitario</th><th>Puntaje z</th></tr></thead><tbody>${A.anomalias.map((x) => `<tr><td>${esc(x.objeto)}</td><td>${esc(x.nombre)}</td><td class="num">${num(x.valor)}</td><td class="num">${fmtNum(x.z, 2)}</td></tr>`).join("")}</tbody></table></div>` : "<p class='muted'>No hay valores con |z| ≥ 2 en el costo unitario de los objetos.</p>";
  const hall = A.hallazgos.map((x) => `<tr><td><span class="pill ${x.tipo === "HECHO" ? "ok" : x.tipo === "ASOCIACIÓN" ? "calc" : "warn"}">${esc(x.tipo)}</span></td><td class="wrap">${esc(x.texto)}</td><td class="wrap muted">${esc(x.evidencia)}</td></tr>`).join("");
  return `<section class="panel"><h3>Por qué pasó · real vs presupuesto</h3>${div}${tvp}</section>
    <div class="grid g2"><section class="panel"><h3>Cambio frente al mes anterior · componentes</h3>${cm}</section><section class="panel"><h3>Actividades con mayor cambio</h3>${ca}</section></div>
    <div class="grid g2"><section class="panel"><h3>Asociación costo ~ volumen</h3>
      ${A.filas.length < 6 ? `<p class="muted">Se necesitan al menos 6 meses con corrida para estimar la asociación (hay ${A.filas.length}).</p>` : `<div class="formula">Costo mensual ≈ a + b × pedidos
a = S/ ${f2(rg.a)}  (componente que no varía con el volumen)
b = S/ ${f2(rg.b)} por pedido
r = ${fmtNum(rg.r, 3)} · R² = ${fmtNum(rg.r2, 3)} · n = ${A.filas.length} meses</div>
      <p class="muted">Regresión lineal por mínimos cuadrados sobre las corridas mensuales. Correlación no implica causalidad: el volumen explica el ${pctTxt(rg.r2)} de la variación del costo; el resto se debe a otros factores (precios, estacionalidad, mezcla de canales).</p>`}</section>
      <section class="panel"><h3>Valores atípicos (costo unitario)</h3>${an}<p class="muted">Se marcan, no se eliminan. Puntaje z = (valor − media) / desviación estándar de la serie del objeto.</p></section></div>
    <section class="panel"><h3>Hallazgos</h3><div class="matrix-wrap"><table class="matrix"><thead><tr><th>Tipo</th><th>Hallazgo</th><th>Evidencia</th></tr></thead><tbody>${hall}</tbody></table></div></section>`;
}

// ---------------- Predictivo ----------------
function predictivo(h: Host, A: Analitica): string {
  if (!A.pronosticos.length) return `<div class="alert info">Se necesitan al menos 2 meses con corrida para pronosticar.</div>`;
  const sel = Math.min(Number(h.st.resSerie || 0), A.pronosticos.length - 1);
  const P = A.pronosticos[sel];
  const selector = `<div class="form-row"><label>Serie a pronosticar<select data-edit="res-serie">${A.pronosticos.map((p, i) => `<option value="${i}" ${i === sel ? "selected" : ""}>${esc(p.serie)}</option>`).join("")}</select></label></div>`;
  const nh = A.filas.length;
  const histVals = A.filas.map((f) => {
    if (sel === 0) return f.total;
    if (sel === 1) return f.volumen;
    if (sel === 2) return f.unitario;
    const o = A.objetos[sel - 3];
    return f.objetos[o.codigo]?.costo ?? null;
  });
  const fmt = sel === 1 ? f0 : f2;
  const xs = [...A.filas.map((f) => mesCorto(f.periodo)), ...P.futuro.map((f) => mesCorto(f.periodo))];
  const bt = P.backtest.find((b) => b.id === P.elegido);
  const series: any[] = [{ id: "h", label: "Histórico (real)", color: COL.s1, valores: [...histVals, ...Array(P.futuro.length).fill(null)] }];
  if (bt?.pron && P.hold) series.push({ id: "b", label: "Backtest (sin ver esos meses)", color: COL.s3, estilo: "guion", valores: [...Array(nh - P.hold).fill(null), ...bt.pron, ...Array(P.futuro.length).fill(null)] });
  series.push({ id: "f", label: "Pronosticado", color: COL.s2, estilo: "punto", valores: [...Array(nh - 1).fill(null), histVals[nh - 1], ...P.futuro.map((f) => f.central)] });
  const banda = P.futuro.some((f) => isFinite(f.bajo)) ? { bajo: [...Array(nh).fill(null), ...P.futuro.map((f) => f.bajo)], alto: [...Array(nh).fill(null), ...P.futuro.map((f) => f.alto)], color: COL.s2, label: "Banda aprox. 80 %" } : undefined;
  const chart = lineas({ titulo: P.serie, xs, series, banda, actual: nh - 1, fmt, ancho: 1200, alto: 300 });
  const tbt = `<div class="matrix-wrap"><table class="matrix"><thead><tr><th>Método</th><th>sMAPE</th><th>MAE</th><th>RMSE</th><th>MAPE</th><th>Estado</th></tr></thead><tbody>${P.backtest
    .map((b) => `<tr class="${b.id === P.elegido ? "sel" : ""}"><td>${esc(b.nombre)}</td>${b.elegible ? `<td class="num">${fmtNum(b.smape!, 2)} %</td><td class="num">${fmt(b.mae!)}</td><td class="num">${fmt(b.rmse!)}</td><td class="num">${isFinite(b.mape!) ? fmtNum(b.mape!, 2) + " %" : "—"}</td>` : `<td colspan="4" class="muted">${esc(b.motivo)}</td>`}<td>${b.id === P.elegido ? '<span class="pill ok">Elegido (menor sMAPE)</span>' : b.elegible ? '<span class="pill none">Evaluado</span>' : '<span class="pill warn">No elegible</span>'}</td></tr>`)
    .join("")}</tbody></table></div>`;
  const tf = `<div class="matrix-wrap"><table class="matrix"><thead><tr><th>Período</th><th>Pronóstico central</th><th>Límite inferior</th><th>Límite superior</th></tr></thead><tbody>${P.futuro
    .map((f) => `<tr><td>${esc(f.nombre)}</td><td class="num">${fmt(f.central)}</td><td class="num">${isFinite(f.bajo) ? fmt(f.bajo) : "—"}</td><td class="num">${isFinite(f.alto) ? fmt(f.alto) : "—"}</td></tr>`)
    .join("")}</tbody></table></div>`;
  return selector + (P.advertencia ? `<div class="alert warn">${esc(P.advertencia)}</div>` : "") +
    `<section class="panel">${chart}</section>
    <div class="grid g2 apilado"><section class="panel"><h3>Backtesting temporal</h3><p class="lead">Entrenamiento: primeros ${P.n - P.hold} meses · validación: últimos ${P.hold} meses (los métodos nunca ven los meses de validación). Se elige el menor sMAPE y luego se reajusta con los ${P.n} meses.</p>${tbt}
      <p class="muted">Parámetros del método elegido: ${Object.entries(P.params).map(([k, v]) => `${esc(k)} = ${esc(typeof v === "number" ? fmtNum(v, 2) : v)}`).join(" · ") || "ninguno"}.</p></section>
    <section class="panel"><h3>Pronóstico a 6 meses</h3>${tf}<p class="muted">Banda aproximada al 80 %: central ± 1,2816 × RMSE del backtest × √(h / 3,5). Es una aproximación empírica, no un intervalo de confianza exacto; el límite inferior no baja de 0.</p></section></div>`;
}

// ---------------- Prescriptivo ----------------
function prescriptivo(h: Host, A: Analitica): string {
  const pp: Record<string, number> = h.st.propPct || {};
  const filas = A.propuestas.map((p) => {
    const pc = pp[p.id] ?? p.pct;
    const ah = p.base * pc;
    const payback = ah > 0 ? p.inversion / ah : NaN;
    return { p, pc, ah, payback, anual: ah * 12 - p.inversion };
  });
  const tot = filas.reduce((s, f) => s + f.ah, 0);
  const chart = barrasH("Ahorro mensual estimado por propuesta", filas.map((f) => ({ label: f.p.titulo, valor: f.ah, color: COL.s1, nota: isFinite(f.payback) ? `inversión recuperada en ${fmtNum(f.payback, 1)} meses` : "" })).sort((a, b) => b.valor - a.valor), f2, undefined, "S/ por mes", 1200);
  const t = `<div class="matrix-wrap"><table class="matrix"><thead><tr><th>Propuesta</th><th>Causa</th><th>Acción</th><th>Base mensual (S/)</th><th>Reducción supuesta (%)</th><th>Ahorro mensual (S/)</th><th>Inversión (S/)</th><th>Recuperación (meses)</th><th>Beneficio neto 12 meses</th><th>Responsable</th><th>KPI</th><th>Riesgo</th></tr></thead><tbody>${filas
    .map((f) => `<tr><td class="wrap"><b>${esc(f.p.titulo)}</b><div class="muted small">${esc(f.p.id)} · ${esc(f.p.actividad)}</div></td><td class="wrap">${esc(f.p.causa)}</td><td class="wrap">${esc(f.p.accion)}</td><td class="num">${num(f.p.base)}</td>
      <td><input data-edit="prop-pct" data-id="${esc(f.p.id)}" data-key="pp-${esc(f.p.id)}" value="${fmtNum(f.pc * 100, 1)}" inputmode="decimal" style="width:70px" aria-label="Reducción supuesta de ${esc(f.p.titulo)}"></td>
      <td class="num">${num(f.ah)}</td><td class="num">${num(f.p.inversion)}</td><td class="num">${isFinite(f.payback) ? fmtNum(f.payback, 1) : "—"}</td><td class="num${neg(f.anual)}">${num(f.anual)}</td><td>${esc(f.p.responsable)}</td><td>${esc(f.p.kpi)}</td><td>${esc(f.p.riesgo)}</td></tr>`)
    .join("")}</tbody></table></div>`;
  return `<div class="alert info">Evaluación de alternativas con supuestos explícitos y editables; no es una optimización global. Los porcentajes de reducción y las inversiones son <b>supuestos</b> de referencia: cámbialos para ver el efecto. La evaluación con incertidumbre (Monte Carlo) y el impacto en EVA de estas propuestas están en la pestaña 12 «Simulación» (Alternativas y EVA).</div>
    <div class="grid g4" style="margin-bottom:14px">${kpi("Ahorro mensual del conjunto", money(tot), "Suma de las propuestas con los supuestos actuales")}${kpi("Ahorro anual", money(tot * 12), "Sin descontar")}${kpi("Inversión total", money(filas.reduce((s, f) => s + f.p.inversion, 0)), "Supuesta")}</div>
    <section class="panel">${chart}</section>
    <section class="panel"><h3>Propuestas</h3>${t}<p class="muted">Base mensual = promedio de los últimos 12 meses del costo afectado (corridas guardadas). Ahorro = base × reducción supuesta. Recuperación = inversión / ahorro mensual.</p></section>`;
}

// ---------------- Relevancia ----------------
function relevancia(A: Analitica): string {
  const pa = A.paretoAct.filter((x: any) => x.valor > 0.004);
  const chart = barrasH(`Pareto de actividades de la cadena · costo acumulado de ${A.filas.length} meses`, pa.map((x: any) => ({ label: `${x.item.codigo} ${x.item.nombre}`, valor: x.valor, color: CLASE_COL[x.item.clase] || COL.ppto, nota: `${pctTxt(x.acumulado)} acum.`, tip: `${x.item.codigo} ${x.item.nombre}\n${f2(x.valor)} (${pctTxt(x.pct)})\nAcumulado ${pctTxt(x.acumulado)} · clase ${x.clase}\n${CLASE_TXT[x.item.clase] || "Sin clase de valor"}` })), f2,
    Object.entries(CLASE_TXT).map(([k, v]) => ({ label: v, color: CLASE_COL[k] })), "S/", 1200);
  const tabla = (rows: any[], conClase: boolean) => `<div class="matrix-wrap"><table class="matrix"><thead><tr><th>#</th><th>Código</th><th>Nombre</th>${conClase ? "<th>Valor</th>" : ""}<th>Costo (S/)</th><th>%</th><th>% acumulado</th><th>Clase ABC</th></tr></thead><tbody>${rows
    .map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.item.codigo)}</td><td>${esc(x.item.nombre)}</td>${conClase ? `<td>${esc(x.item.clase || "—")}</td>` : ""}<td class="num">${num(x.valor)}</td><td class="num">${pctTxt(x.pct, 2)}</td><td class="num">${pctTxt(x.acumulado, 2)}</td><td><span class="pill ${x.clase === "A" ? "err" : x.clase === "B" ? "warn" : "none"}">${x.clase}</span></td></tr>`)
    .join("")}</tbody></table></div>`;
  const ec = A.paretoEC.filter((x: any) => x.valor > 0.004);
  return `<section class="panel">${chart}<p class="muted">Clase A: acumulado previo &lt; 80 % (concentran el costo; prioridad de gestión). Clase B: hasta 95 %. Clase C: resto.</p></section>
    <div class="grid g2"><section class="panel"><h3>Actividades</h3>${tabla(pa, true)}</section>
    <section class="panel"><h3>Elementos de costo indirecto (P4a)</h3>${tabla(ec, false)}</section></div>`;
}
