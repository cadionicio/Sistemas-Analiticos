// Pestaña 12 «Simulación»: Escenarios, Variables, Monte Carlo, Comparativo, Alternativas y EVA.
import { Host } from "./pages2";
import { esc, money, num, neg } from "./comun";
import * as SIM from "../app/simulacion";
import { VARIABLES, variablePorId } from "../domain/simulacion";
import { histograma, rangos, barrasH, COL, colorSerie } from "./graficos";
import { fmtNum } from "../domain/formato";

type H = Host & { esModeloCompleto(): boolean; simEstado: { pct: number; esc: string; n: number; total: number } | null };
const f2 = (v: number | null | undefined) => (v === null || v === undefined || !isFinite(v) ? "—" : fmtNum(v, 2));
const pc = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !isFinite(v) ? "—" : fmtNum(v * 100, d) + " %");
const kpi = (l: string, v: string, s: string) => `<div class="kpi"><div class="lbl">${esc(l)}</div><div class="val">${v}</div><div class="src">${s}</div></div>`;

export function pSimulacion(h: H): string {
  const c = h.ctx!;
  const sub = h.st.sub.simulacion || "escenarios";
  const tabs = h.subtabs("simulacion", [
    { id: "escenarios", label: "Escenarios" }, { id: "variables", label: "Variables" }, { id: "montecarlo", label: "Monte Carlo" },
    { id: "comparativo", label: "Comparativo" }, { id: "alternativas", label: "Alternativas" }, { id: "eva", label: "EVA" },
  ]);
  const head = h.title("Simulación", "Escenarios y Monte Carlo sobre el período base: cada iteración pasa por el mismo motor ABC. Una simulación nunca modifica los costos reales ni las corridas guardadas.");
  if (!h.esModeloCompleto()) return head + tabs + `<div class="alert info">Este modelo solo contiene P3 (verificación). Abre un modelo completo (M01, M02 o M03) en «Modelo de Costeo».</div>`;
  const escs = SIM.escenarios(h.s, c);
  const per = h.s.one("SELECT nombre FROM periodo WHERE id=?", [c.periodoId])?.nombre;
  const run = h.s.one("SELECT id, params_hash FROM corrida WHERE version_id=? AND periodo_id=? AND etapa='ABC' ORDER BY creado_en DESC LIMIT 1", [c.versionId, c.periodoId]);
  const ctxLine = `<p class="muted" style="margin:0 0 10px">Período base: <b>${esc(per)}</b> (se cambia en la barra gris, selector «Período») · corrida base: ${run ? esc(run.id) : '<span class="pill err">sin corrida</span>'} · escenario activo: <b>${esc(h.st.simEsc || "Base")}</b></p>`;
  if (!escs.length && sub !== "eva")
    return head + tabs + ctxLine + `<div class="empty"><h3>Este modelo no tiene escenarios</h3><p>Crea el escenario Base para definir variables y simular.</p><button class="btn primary" data-act="sim-crear-base">Crear escenario «Base»</button></div>`;
  if (!h.st.simEsc || !escs.includes(h.st.simEsc)) h.st.simEsc = escs[0] || "Base";
  const body =
    sub === "variables" ? variables(h) : sub === "montecarlo" ? montecarlo(h) : sub === "comparativo" ? comparativo(h, escs) : sub === "alternativas" ? alternativas(h) : sub === "eva" ? evaPage(h) : escenariosPage(h, escs);
  return head + tabs + ctxLine + body;
}

function selectorEsc(h: H, escs: string[]) {
  return `<label>Escenario activo<select data-edit="sim-esc">${escs.map((e) => `<option ${e === h.st.simEsc ? "selected" : ""}>${esc(e)}</option>`).join("")}</select></label>`;
}

// ---------------- Escenarios ----------------
function escenariosPage(h: H, escs: string[]) {
  const c = h.ctx!;
  const ult = SIM.ultimasPorEscenario(h.s, c);
  const filas = escs.map((e) => {
    const vs = SIM.variablesEscenario(h.s, c, e);
    const u = ult.get(e);
    return `<tr class="${e === h.st.simEsc ? "sel" : ""}"><td><b>${esc(e)}</b></td><td class="num">${vs.filter((v) => !v.heredada).length}</td><td class="num">${vs.filter((v) => v.heredada).length}</td>
      <td class="wrap">${vs.map((v) => `${esc(variablePorId(v.variable)?.nombre || v.variable)} [${f2(v.minimo)}; ${f2(v.moda)}; ${f2(v.maximo)}]${v.heredada ? " (Base)" : ""}`).join("<br>")}</td>
      <td>${u ? `<span class="pill ok">${esc(u.id)}</span>` : '<span class="pill none">Sin simular</span>'}</td>
      <td><button class="btn small" data-act="sim-usar" data-esc="${esc(e)}">Usar</button> <button class="btn small" data-act="sim-duplicar" data-esc="${esc(e)}">Duplicar</button></td></tr>`;
  }).join("");
  return `<section class="panel"><h3>Escenarios del modelo</h3>
    <p class="lead">Cada escenario define factores multiplicativos (triangular: mínimo, moda, máximo) sobre los datos del período base. Un escenario que no define una variable usa la de Base («heredada»). Escenario ≠ simulación: la simulación es una corrida Monte Carlo de un escenario con una semilla.</p>
    <div class="matrix-wrap"><table class="matrix"><thead><tr><th>Escenario</th><th>Variables propias</th><th>Heredadas de Base</th><th>Distribuciones (factor mín.; moda; máx.)</th><th>Última simulación (período base)</th><th>Acciones</th></tr></thead><tbody>${filas}</tbody></table></div>
    <div class="form-row" style="margin-top:12px"><label>Nombre del nuevo escenario<input id="sim-nuevo" placeholder="Ej. Plan de mejora 2027"></label><button class="btn primary" data-act="sim-crear">Crear escenario (copia de Base)</button></div></section>`;
}

// ---------------- Variables ----------------
function variables(h: H) {
  const c = h.ctx!;
  const e = h.st.simEsc;
  const vs = SIM.variablesEscenario(h.s, c, e);
  const faltan = VARIABLES.filter((v) => !vs.some((x) => x.variable === v.id && !x.heredada));
  const filas = vs.map((v) => {
    const d = variablePorId(v.variable);
    const inp = (k: "minimo" | "moda" | "maximo") => `<input data-edit="sim-var" data-v="${esc(v.variable)}" data-f="${k}" data-key="sv-${esc(v.variable)}-${k}" value="${fmtNum(v[k], 3)}" inputmode="decimal" style="width:80px" aria-label="${k} de ${esc(d?.nombre || v.variable)}">`;
    return `<tr><td><b>${esc(d?.nombre || v.variable)}</b><div class="muted small mono">${esc(v.variable)}</div></td><td>${v.heredada ? '<span class="pill none">Heredada de Base</span>' : '<span class="pill calc">Propia</span>'}</td><td>Triangular</td>
      <td>${inp("minimo")}</td><td>${inp("moda")}</td><td>${inp("maximo")}</td><td class="num">${f2((v.minimo + v.moda + v.maximo) / 3)}</td>
      <td class="wrap small">${esc(d?.efecto || "Sin efecto definido: no se simula")}</td>
      <td>${v.heredada ? "" : `<button class="btn small danger" data-act="sim-quitar" data-v="${esc(v.variable)}">${e === "Base" ? "Quitar" : "Volver a Base"}</button>`}</td></tr>`;
  }).join("");
  return `<div class="form-row">${selectorEsc(h, SIM.escenarios(h.s, c))}</div>
    <section class="panel"><h3>Variables aleatorias · ${esc(e)}</h3>
    <p class="lead">Factores sobre el período base (1 = sin cambio; 1,05 = +5 %). Supuesto declarado: variables independientes (no hay correlaciones estimadas). Editar una variable heredada crea la versión propia del escenario.</p>
    <div class="matrix-wrap"><table class="matrix"><thead><tr><th>Variable</th><th>Origen</th><th>Distribución</th><th>Mínimo</th><th>Moda</th><th>Máximo</th><th>Media del factor</th><th>Efecto sobre el modelo</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>
    ${faltan.length ? `<div class="form-row" style="margin-top:12px"><label>Agregar variable<select id="sim-addvar">${faltan.map((v) => `<option value="${v.id}">${esc(v.nombre)}</option>`).join("")}</select></label><button class="btn" data-act="sim-agregar">Agregar (factor 1; 1; 1)</button></div>` : ""}</section>`;
}

// ---------------- Monte Carlo ----------------
function montecarlo(h: H) {
  const c = h.ctx!;
  const e = h.st.simEsc;
  const corriendo = h.simEstado;
  const controles = `<div class="form-row">${selectorEsc(h, SIM.escenarios(h.s, c))}
    <label>Semilla<input id="sim-semilla" value="${esc(h.st.simSemilla ?? 20261105)}" inputmode="numeric" style="width:120px" ${corriendo ? "disabled" : ""}></label>
    <label>Iteraciones<input id="sim-iter" value="${esc(h.st.simIter ?? 2000)}" inputmode="numeric" style="width:100px" ${corriendo ? "disabled" : ""}></label>
    ${corriendo ? `<button class="btn danger" data-act="sim-cancelar">Cancelar simulación</button>` : `<button class="btn primary" data-act="sim-correr">Simular</button>`}</div>
    ${corriendo ? `<div class="progress" role="progressbar" aria-valuenow="${Math.round(corriendo.pct)}" aria-valuemin="0" aria-valuemax="100"><div id="sim-bar" style="width:${corriendo.pct}%"></div></div><p class="muted" id="sim-txt">Simulando «${esc(corriendo.esc)}»: ${corriendo.n} de ${corriendo.total} iteraciones. El resultado se guarda solo al terminar.</p>` : ""}`;
  const u = SIM.ultimasPorEscenario(h.s, c).get(e);
  if (!u) return controles + `<div class="empty"><h3>«${esc(e)}» aún no tiene simulación para este período base</h3><p>Pulsa «Simular». Con la misma semilla y los mismos datos el resultado se repite exactamente.</p></div>`;
  const r: SIM.ResumenSim = u.r;
  const refs = [{ valor: r.costo.p5, label: "P5", color: COL.s2 }, { valor: r.costo.p50, label: "P50", color: COL.ink }, { valor: r.costo.p95, label: "P95", color: COL.s2 }];
  if (r.ppto !== null) refs.push({ valor: r.ppto, label: "Presupuesto", color: COL.ppto, estilo: "guion" } as any);
  const hist = histograma(`Distribución del costo de la cadena · ${e} · ${r.validas} iteraciones`, r.costo.hist, refs as any, f2, 1200, "S/ por mes");
  const tor = rangos("Sensibilidad: costo con cada variable en su mínimo y máximo (las demás en su moda)", r.sensibilidad.filas.map((f) => ({ label: variablePorId(f.variable)?.nombre || f.variable, lo: f.costoMin, hi: f.costoMax, tip: `${variablePorId(f.variable)?.nombre}\nfactor ${f2(f.minimo)} → S/ ${f2(f.costoMin)}\nfactor ${f2(f.maximo)} → S/ ${f2(f.costoMax)}\nrango S/ ${f2(f.rango)}` })), { valor: r.sensibilidad.costoModa, label: "Todas en moda" }, f2, 1200, "S/ por mes");
  const conv = `<div class="matrix-wrap"><table class="matrix"><thead><tr><th>Iteraciones usadas</th><th>Media (S/)</th><th>P50 (S/)</th><th>P95 (S/)</th></tr></thead><tbody>${r.convergencia.map((x) => `<tr><td>${x.n} (${pc(x.fraccion, 0)})</td><td class="num">${f2(x.media)}</td><td class="num">${f2(x.p50)}</td><td class="num">${f2(x.p95)}</td></tr>`).join("")}</tbody></table></div>`;
  const evaK = r.eva ? kpi("EVA anual P50", money(r.eva.p50), `P5 ${money(r.eva.p5)} · P95 ${money(r.eva.p95)} · P(EVA < 0) ${pc(r.eva.probNegativo)}`) : kpi("EVA", "No calculable", "Ver subpestaña EVA");
  return controles +
    `<div class="alert ok">Simulación guardada ${esc(u.id)} · semilla ${esc(u.semilla)} · ${esc(u.iteraciones)} iteraciones · ${fmtNum(u.ms / 1000, 1)} s · corrida base ${esc(u.base_run_id)}${r.bloqueadas ? ` · <b>${r.bloqueadas} iteraciones bloqueadas excluidas</b>` : ""}</div>
    <div class="grid g4" style="margin-bottom:14px">
      ${kpi("Costo P50 (mediana)", money(r.costo.p50), `Media ${money(r.costo.media)} · base determinista ${money(r.costoBase)}`)}
      ${kpi("Rango P5 – P95", `${money(r.costo.p5)} – ${money(r.costo.p95)}`, `Desviación estándar ${money(r.costo.sd)}`)}
      ${kpi("Probabilidad de superar el presupuesto", r.ppto !== null ? pc(r.costo.probSupera) : "—", r.ppto !== null ? `Presupuesto del período ${money(r.ppto)}` : "Sin presupuesto cargado")}
      ${kpi("Costo por pedido P50", money(r.unitario.p50), `P5 ${money(r.unitario.p5)} · P95 ${money(r.unitario.p95)}`)}
      ${evaK}
    </div>
    <section class="panel">${hist}</section>
    <section class="panel">${tor}<details class="viz-table"><summary>Ver tabla de datos</summary><div class="matrix-wrap"><table class="matrix"><thead><tr><th>Variable</th><th>Factor mínimo</th><th>Factor máximo</th><th>Costo en mínimo (S/)</th><th>Costo en máximo (S/)</th><th>Rango (S/)</th><th>EVA en mínimo</th><th>EVA en máximo</th></tr></thead><tbody>${r.sensibilidad.filas.map((f) => `<tr><td>${esc(variablePorId(f.variable)?.nombre || f.variable)}</td><td class="num">${fmtNum(f.minimo, 3)}</td><td class="num">${fmtNum(f.maximo, 3)}</td><td class="num">${num(f.costoMin)}</td><td class="num">${num(f.costoMax)}</td><td class="num">${num(f.rango)}</td><td class="num${f.evaMin !== null ? neg(f.evaMin) : ""}">${f.evaMin === null ? "—" : num(f.evaMin)}</td><td class="num${f.evaMax !== null ? neg(f.evaMax) : ""}">${f.evaMax === null ? "—" : num(f.evaMax)}</td></tr>`).join("")}</tbody></table></div></details><p class="muted">Ordenado por amplitud del rango: la primera variable es la que más mueve el costo. Cálculo con el motor ABC real (no por fórmula aproximada).</p></section>
    <section class="panel"><h3>Estabilidad (convergencia aproximada)</h3>${conv}<p class="muted">Si la media y el P50 cambian poco al usar más iteraciones, el número de iteraciones es suficiente para este uso. Más iteraciones no hacen «exacto» el resultado: dependen de los supuestos de las distribuciones.</p></section>`;
}

// ---------------- Comparativo ----------------
function comparativo(h: H, escs: string[]) {
  const ult = SIM.ultimasPorEscenario(h.s, h.ctx!);
  const xs = escs.filter((e) => ult.has(e)).map((e) => ({ e, u: ult.get(e) }));
  if (!xs.length) return `<div class="empty"><h3>No hay simulaciones para comparar en este período base</h3><p>Simula al menos un escenario en «Monte Carlo».</p></div>`;
  const ppto = xs[0].u.r.ppto;
  const chart = rangos("Costo de la cadena por escenario: P5 – P95 (barra) y P50 (punto)", xs.map(({ e, u }, i) => ({ label: e, lo: u.r.costo.p5, hi: u.r.costo.p95, centro: u.r.costo.p50, color: colorSerie(i), tip: `${e}\nP5 ${f2(u.r.costo.p5)}\nP50 ${f2(u.r.costo.p50)}\nP95 ${f2(u.r.costo.p95)}\nP(> presupuesto) ${pc(u.r.costo.probSupera)}` })), ppto !== null ? { valor: ppto, label: "Presupuesto" } : null, f2, 1200, "S/ por mes");
  const t = `<div class="matrix-wrap"><table class="matrix"><thead><tr><th>Escenario</th><th>Simulación</th><th>Semilla</th><th>Iteraciones</th><th>P5</th><th>P50</th><th>P95</th><th>Media</th><th>P(&gt; presupuesto)</th><th>Costo/pedido P50</th><th>EVA P50</th><th>P(EVA &lt; 0)</th></tr></thead><tbody>${xs
    .map(({ e, u }) => `<tr><td><b>${esc(e)}</b></td><td class="mono small">${esc(u.id)}</td><td class="num">${esc(u.semilla)}</td><td class="num">${esc(u.r.validas)}</td><td class="num">${num(u.r.costo.p5)}</td><td class="num">${num(u.r.costo.p50)}</td><td class="num">${num(u.r.costo.p95)}</td><td class="num">${num(u.r.costo.media)}</td><td class="num">${pc(u.r.costo.probSupera)}</td><td class="num">${num(u.r.unitario.p50)}</td><td class="num${u.r.eva ? neg(u.r.eva.p50) : ""}">${u.r.eva ? num(u.r.eva.p50) : "—"}</td><td class="num">${u.r.eva ? pc(u.r.eva.probNegativo) : "—"}</td></tr>`)
    .join("")}</tbody></table></div>`;
  const faltan = escs.filter((e) => !ult.has(e));
  return `<section class="panel">${chart}</section><section class="panel"><h3>Comparativo de escenarios · mismo período base</h3>${t}
    ${faltan.length ? `<p class="muted">Sin simular en este período: ${esc(faltan.join(", "))}.</p>` : ""}<p class="muted">Para comparar en igualdad de condiciones usa la misma semilla y el mismo número de iteraciones en todos los escenarios.</p></section>`;
}

// ---------------- Alternativas ----------------
function alternativas(h: H) {
  const c = h.ctx!;
  const A = SIM.alternativas(h.s, c, h.st.propPct || {});
  const ev = A.ev;
  if (!A.props.length) return `<div class="alert info">No hay propuestas: requieren corridas de varios meses (ver Resultados → Prescriptivo).</div>`;
  const filas = A.props.map((p) => `<tr><td class="wrap"><b>${esc(p.titulo)}</b><div class="muted small">${esc(p.id)}</div></td><td class="num">${pc(p.pct)}</td><td class="num">${num(p.ahorroAnual)}</td><td class="num">${num(p.inversion)}</td>
    <td class="num">${p.dNopat === null ? "—" : num(p.dNopat)}</td><td class="num">${p.dCargo === null ? "—" : num(p.dCargo)}</td><td class="num${p.dEva !== null ? neg(p.dEva) : ""}"><b>${p.dEva === null ? "—" : num(p.dEva)}</b></td>
    <td>${p.conviene === null ? '<span class="pill none">EVA no calculable</span>' : p.conviene ? '<span class="pill ok">Crea valor</span>' : '<span class="pill err">Destruye valor</span>'}</td><td class="wrap small">${esc(p.supuesto)}</td></tr>`).join("");
  const ult = SIM.ultimasPorEscenario(h.s, c);
  const conPlan = [...ult.entries()].map(([e, u]) => `<tr><td><b>${esc(e)}</b></td><td class="num">${num(u.r.costo.p50)}</td><td class="num">${num(u.r.costo.p50 - A.plan.ahorroMensual)}</td><td class="num">${pc(u.r.costo.probSupera)}</td><td class="num">${u.r.ppto !== null ? pc(probConAhorro(u.r, A.plan.ahorroMensual)) : "—"}</td></tr>`).join("");
  const chart = barrasH("ΔEVA anual por propuesta", A.props.filter((p) => p.dEva !== null).map((p) => ({ label: p.titulo, valor: Math.max(0, p.dEva!), color: p.dEva! > 0 ? COL.s1 : COL.desf, nota: p.dEva! <= 0 ? `ΔEVA ${f2(p.dEva)} (no conviene)` : "" })).sort((a, b) => b.valor - a.valor), f2, undefined, "S/ por año", 1200);
  return `<div class="alert info">Plan prescriptivo heurístico (no es una optimización matemática): se incluyen las propuestas con ΔEVA &gt; 0. Ahorro y reducción son supuestos editables en Resultados → Prescriptivo; la inversión se suma al capital invertido y no se modela depreciación (supuesto).</div>
    <div class="grid g4" style="margin-bottom:14px">
      ${kpi("Propuestas en el plan", `${A.plan.ids.length} de ${A.props.length}`, esc(A.plan.ids.join(", ")) || "—")}
      ${kpi("Ahorro anual del plan", money(A.plan.ahorroAnual), `Mensual ${money(A.plan.ahorroMensual)}`)}
      ${kpi("Inversión del plan", money(A.plan.inversion), "Supuesta; aumenta el capital invertido")}
      ${kpi("ΔEVA del plan", A.plan.dEva === null ? "—" : money(A.plan.dEva), A.plan.evaAlt === null ? "EVA no calculable" : `EVA base ${money(ev.eva)} → con plan ${money(A.plan.evaAlt)}`)}
    </div>
    <section class="panel">${chart}</section>
    <section class="panel"><h3>Evaluación de alternativas</h3><div class="matrix-wrap"><table class="matrix"><thead><tr><th>Propuesta</th><th>Reducción supuesta</th><th>Ahorro anual (S/)</th><th>Inversión (S/)</th><th>ΔNOPAT = ahorro × (1 − T)</th><th>Δ cargo de capital = WACC × inversión</th><th>ΔEVA</th><th>Resultado</th><th>Supuesto</th></tr></thead><tbody>${filas}</tbody></table></div></section>
    <section class="panel"><h3>El plan frente a la incertidumbre (escenarios simulados)</h3>${conPlan ? `<div class="matrix-wrap"><table class="matrix"><thead><tr><th>Escenario</th><th>Costo P50 sin plan</th><th>Costo P50 con plan</th><th>P(&gt; presupuesto) sin plan</th><th>P(&gt; presupuesto) con plan</th></tr></thead><tbody>${conPlan}</tbody></table></div><p class="muted">Supuesto: el ahorro mensual del plan es aditivo e independiente de los factores simulados.</p>` : "<p class='muted'>Simula escenarios en «Monte Carlo» para ver el efecto del plan sobre la probabilidad de superar el presupuesto.</p>"}</section>`;
}

function probConAhorro(r: SIM.ResumenSim, ahorro: number) {
  // con el histograma guardado: fracción de iteraciones con costo − ahorro > presupuesto (interpolación lineal dentro del intervalo)
  const umbral = (r.ppto as number) + ahorro;
  const tot = r.costo.hist.reduce((a, b) => a + b.n, 0);
  let sobre = 0;
  for (const b of r.costo.hist) {
    if (b.desde >= umbral) sobre += b.n;
    else if (b.hasta > umbral) sobre += (b.n * (b.hasta - umbral)) / (b.hasta - b.desde || 1);
  }
  return tot ? sobre / tot : NaN;
}

// ---------------- EVA ----------------
function evaPage(h: H) {
  const ev = SIM.evaBase(h.s, h.ctx!);
  if (!ev.calculable) return `<div class="alert warn"><b>EVA no calculable con los datos actuales.</b><br>${ev.motivos.map(esc).join("<br>")}</div><p class="muted">El sistema no afirma un EVA sin NOPAT, WACC y capital invertido sustentados (MT-33).</p>`;
  const A = SIM.alternativas(h.s, h.ctx!, h.st.propPct || {});
  return `${ev.sintetico ? '<div class="alert warn"><b>EVA ILUSTRATIVO — DATOS SINTÉTICOS.</b> Ventas, balance y costos de capital son ficticios; el cálculo es real, las cifras no describen una empresa real.</div>' : ""}
    <div class="grid g4" style="margin-bottom:14px">
      ${kpi("NOPAT anual", money(ev.nopat), `${esc(ev.meses![0])} – ${esc(ev.meses![11])}`)}
      ${kpi("WACC", pc(ev.wacc, 2), `Ke ${pc(ev.ke, 1)} · Kd ${pc(ev.kd, 1)} · T ${pc(ev.t, 1)}`)}
      ${kpi("Capital invertido", money(ev.capital), "Hoja «ParametrosEVA» del Excel de datos")}
      ${kpi("EVA anual base", `<span class="${ev.eva! < 0 ? "neg" : ""}">${money(ev.eva)}</span>`, ev.eva! < 0 ? "La operación no cubre el costo del capital" : "Crea valor sobre el costo del capital")}
      ${kpi("EVA con el plan", A.plan.evaAlt === null ? "—" : money(A.plan.evaAlt), A.plan.dEva === null ? "" : `ΔEVA ${money(A.plan.dEva)} · capital ${money(A.plan.capitalAlt)}`)}
    </div>
    <div class="grid g2"><section class="panel"><h3>NOPAT (12 meses)</h3><div class="formula">Ventas                              ${money(ev.ventas)}
− Costo de ventas (sin logística)   ${money(ev.costoVentas)}
− Costo logístico (corridas ABC)    ${money(ev.costoLogistico)}
− Otros gastos operativos           ${money(ev.otrosGastos)}
= Utilidad operativa                ${money(ev.utilidadOperativa)}
− Impuesto (${pc(ev.t, 1)})                 ${money(ev.impuesto)}
= NOPAT                             ${money(ev.nopat)}</div>
      <p class="muted">El costo logístico es la suma de las corridas ABC guardadas de los 12 meses. El costo del capital no se suma al costo logístico: se cuenta solo en el cargo de capital.</p></section>
    <section class="panel"><h3>WACC y EVA</h3><div class="formula">E / (D + E) = ${num(ev.patrimonio)} / ${num(ev.deuda! + ev.patrimonio!)} = ${pc(ev.pesoE, 2)}
D / (D + E) = ${num(ev.deuda)} / ${num(ev.deuda! + ev.patrimonio!)} = ${pc(ev.pesoD, 2)}
WACC = Ke × E/V + Kd × (1 − T) × D/V
     = ${pc(ev.ke, 2)} × ${pc(ev.pesoE, 2)} + ${pc(ev.kd, 2)} × (1 − ${pc(ev.t, 1)}) × ${pc(ev.pesoD, 2)} = ${pc(ev.wacc, 3)}

Cargo de capital = WACC × Capital = ${pc(ev.wacc, 3)} × ${num(ev.capital)} = ${money(ev.cargoCapital)}
EVA = NOPAT − Cargo de capital = ${money(ev.nopat)} − ${money(ev.cargoCapital)} = ${money(ev.eva)}</div>
      <p class="muted">Periodicidad anual. ΔEVA de cada alternativa en «Alternativas»; distribución del EVA por escenario en «Monte Carlo» y «Comparativo».</p></section></div>`;
}
