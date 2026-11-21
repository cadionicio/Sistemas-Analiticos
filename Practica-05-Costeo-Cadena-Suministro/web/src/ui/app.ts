// Interfaz PC05 — 12 pestañas superiores (V7). La interfaz NO calcula costos:
// solo llama a casos de uso (app/usecases) y muestra lo que devuelve el dominio.
import { Store, APP_VERSION, bytesToB64, b64ToBytes } from "../db/store";
import * as UC from "../app/usecases";
import { COMPONENTES, TipoBase, round2 } from "../domain/abc";

/** Regla de formato: todo importe o cifra negativa se muestra en rojo (celdas numéricas, KPI y totales). */
function marcarNegativos(root: HTMLElement) {
  root.querySelectorAll("main td.num, main .kpi .val, main .num").forEach((el) => {
    if (/^\s*(S\/\s?)?-\d/.test(el.textContent || "")) el.classList.add("neg");
  });
}
const fmtSeg = (ms: number) => (ms / 1000).toFixed(1).replace(".", ",");
export const NOMBRE_OFICIAL = "Sistema Informático Dinámico Inteligente Estocástico Predictivo de Costeo de la Cadena de Suministro Integral";

const TABS: { id: string; label: string }[] = [
  { id: "inicio", label: "Inicio" },
  { id: "maestros", label: "Datos Maestros" },
  { id: "procesos", label: "Procesos" },
  { id: "modelo", label: "Modelo de Costeo" },
  { id: "estructuras", label: "Estructuras" },
  { id: "recursos", label: "Recursos" },
  { id: "personas", label: "Personas" },
  { id: "inductores", label: "Inductores" },
  { id: "asignacion", label: "Asignación" },
  { id: "resultados", label: "Resultados" },
  { id: "reportes", label: "Reportes y Exportación" },
  { id: "simulacion", label: "Simulación" },
];

const PLANIFICADO: Record<string, { it: string; desc: string; items: string[] }> = {
  maestros: { it: "I2", desc: "Catálogos editables que alimentan todas las matrices.", items: ["Productos, materiales, clientes, proveedores", "Unidades, monedas e IGV por material", "Objetos de costo e indicadores separados", "Importación XLSX con previsualización y rechazo por celda"] },
  procesos: { it: "I2", desc: "Mapa de procesos y matriz ASME normalizada.", items: ["Matriz ASME: tiempo efectivo, personas, materiales, servicios", "Clasificación AV / NAVN / NAVI separada del alcance", "Actividades incluidas, excluidas o parciales"] },
  modelo: { it: "I2", desc: "Gestión de N modelos y diagrama conceptual 1–5.", items: ["Modelos de referencia y de demostración", "Crear, clonar, versionar, comparar, archivar", "Diagrama ABC con rutas 1, 2, 3, 4a, 4b, 4c, 5 y puertos anclados"] },
  estructuras: { it: "I2", desc: "Centros de actividad, puestos y organización.", items: ["N centros: participa / no participa / parcial", "Puestos con varias personas y vigencias", "Personal indirecto por centro"] },
  recursos: { it: "I2", desc: "Materiales, equipos, servicios, depreciaciones e indirectos.", items: ["Costo unitario con tratamiento de IGV", "Servicios directos P2 vs indirectos", "Elementos de costo indirecto del período"] },
  resultados: { it: "I3", desc: "Resultados conciliados y las cuatro analíticas.", items: ["Costo por actividad, centro, persona y objeto", "Descriptivo, diagnóstico, predictivo (6 meses) y prescriptivo", "Histórico, actual, presupuestado y pronosticado diferenciados"] },
  reportes: { it: "I2–I5", desc: "Excel de resultados, analítica y proyecciones; informe técnico Word y presentación PPTX.", items: ["Exportación normalizada + vista compatible", "Informe técnico y presentación generados desde una corrida", "Evidencia de inductores y auditoría"] },
  simulacion: { it: "I4", desc: "Escenarios, Monte Carlo reproducible y EVA.", items: ["Variables con distribución, semilla e iteraciones", "Percentiles P5/P50/P95 y probabilidad de exceder presupuesto", "Propuestas, NOPAT, WACC, capital invertido y ΔEVA"] },
};

interface UIState {
  tab: string;
  sub: Record<string, string>;
  poolId: string | null;
  drawer: string | null; // HTML del panel lateral temporal
  toast: { msg: string; err?: boolean } | null;
  demoCargando?: string;
}

import { money, num, neg, esc, parseNum, fechaHora, abrev } from "./comun";
import * as MOD from "../app/modelos";
import * as P2 from "./pages2";
import * as R3 from "./resultados";
import * as SIMUI from "./simulacion";
import * as SIMAPP from "../app/simulacion";
import { exportar08 } from "../app/export08";
import { exportarInformeDocx, exportarPresentacion } from "../app/exportInforme";
import { instalarTooltip } from "./graficos";
import { exportar07 } from "../app/export07";
import { importarProfesor } from "../import/profesor";
import { exportar06 } from "../app/export06";
import { costearModelo, ResultadoModelo } from "../domain/motor";
// @ts-ignore — build UMD de ExcelJS para navegador (sin red)
import ExcelJS from "exceljs/dist/exceljs.min.js";

const DEMO_TAG = "demostración incluida · datos v3";
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  try {
    const d = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return "no-disponible";
  }
}

export class App {
  s: Store;
  root: HTMLElement;
  st: UIState = { tab: "inicio", sub: { personas: "registro", inductores: "laboratorio", asignacion: "p3" }, poolId: null, drawer: null, toast: null };
  storageDesc = "";
  simEstado: { pct: number; esc: string; n: number; total: number } | null = null;
  private simCancel = false;
  private _R: ResultadoModelo | null | undefined = undefined;
  private _inpHash = "";
  abc(): ResultadoModelo | null {
    if (this._R !== undefined) return this._R;
    const c = this.ctx;
    if (!c) return (this._R = null);
    const inp = MOD.cargarInput(this.s, c);
    this._inpHash = MOD.hashInput(inp);
    this._R = costearModelo(inp);
    return this._R;
  }
  esModeloCompleto(): boolean {
    const c = this.ctx;
    return !!c && !!this.s.one("SELECT 1 FROM elemento_costo WHERE version_id=? UNION SELECT 1 FROM material WHERE version_id=? LIMIT 1", [c.versionId, c.versionId]);
  }
  estadoABC(): { cls: string; txt: string; run: any; vivo: boolean } {
    const c = this.ctx;
    if (!c) return { cls: "none", txt: "Sin datos", run: null, vivo: false };
    const R = this.abc()!;
    const run = MOD.ultimaCorridaABC(this.s, c);
    if (!run) return { cls: "none", txt: "Sin calcular", run: null, vivo: false };
    if (run.params_hash !== this._inpHash) return { cls: "warn", txt: "Desactualizado: requiere recálculo", run, vivo: true };
    if (!R.cuadra) return { cls: "err", txt: "No concilia", run, vivo: false };
    if (R.bloqueos.length) return { cls: "err", txt: "Calculado con bloqueos (ver detalle)", run, vivo: false };
    if (R.saldos.some((z) => z.tipo === "PENDIENTE" || z.tipo === "BLOQUEADO")) return { cls: "warn", txt: "Calculado · conciliado con saldos pendientes", run, vivo: false };
    return { cls: "ok", txt: "Calculado y conciliado", run, vivo: false };
  }
  estadoGeneral(): { cls: string; txt: string; run: any } {
    return this.esModeloCompleto() ? this.estadoABC() : this.estadoP3();
  }
  constructor(s: Store, root: HTMLElement) {
    this.s = s;
    this.root = root;
    try {
      const saved = sessionStorage.getItem("pc05_ui");
      if (saved) Object.assign(this.st, JSON.parse(saved), { drawer: null, toast: null });
    } catch {}
    s.onSaved = (i) => {
      if (!i.ok) this.toast("No se pudo guardar: " + (i.error || "error desconocido"), true);
      this.renderCtx();
    };
    root.addEventListener("click", (e) => this.onClick(e));
    root.addEventListener("change", (e) => this.onChange(e));
    instalarTooltip(root);
    root.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape" && this.st.drawer) {
        this.st.drawer = null;
        this.render();
      }
    });
    s.storage.describe().then((d) => {
      this.storageDesc = d;
      this.render();
    });
    this.render();
  }

  get ctx(): UC.Contexto | null {
    return UC.contextoActual(this.s);
  }

  toast(msg: string, err = false) {
    const t = { msg, err };
    this.st.toast = t;
    this.renderToast();
    setTimeout(() => {
      if (this.st.toast !== t) return; // un aviso posterior no lo borra el temporizador de uno anterior
      this.st.toast = null;
      this.renderToast();
    }, err ? 7000 : 3200);
  }

  mutate(fn: () => void, msg?: string) {
    try {
      fn();
      this.s.scheduleSave();
      if (msg) this.toast(msg);
    } catch (e: any) {
      this.toast(e?.message || String(e), true);
    }
    this.render();
  }

  // ---------- render ----------
  render() {
    this._R = undefined;
    try {
      sessionStorage.setItem("pc05_ui", JSON.stringify({ tab: this.st.tab, sub: this.st.sub, poolId: this.st.poolId }));
    } catch {}
    const scroll = (this.root.querySelector(".matrix-wrap") as HTMLElement | null)?.scrollLeft ?? 0;
    const active = document.activeElement as HTMLElement | null;
    const activeKey = active?.getAttribute?.("data-key");
    this.root.innerHTML = `
      ${this.header()}
      ${this.nav()}
      <div id="ctx">${this.ctxbar()}</div>
      <main id="main" tabindex="-1">${this.page()}</main>
      <footer class="app-foot">${esc(NOMBRE_OFICIAL)} · versión ${esc(APP_VERSION)} · ${this.s.storage.kind === "EXE" ? "Aplicación de escritorio (Windows)" : "Aplicación offline (navegador)"}</footer>
      ${this.st.drawer ? `<div class="drawer-back" data-act="close-drawer"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="Detalle">${this.st.drawer}<button class="btn small close" data-act="close-drawer" aria-label="Cerrar">Cerrar</button></aside>` : ""}
      <div id="toast"></div>`;
    marcarNegativos(this.root);
    const mw = this.root.querySelector(".matrix-wrap") as HTMLElement | null;
    if (mw) mw.scrollLeft = scroll;
    if (activeKey) (this.root.querySelector(`[data-key="${activeKey}"]`) as HTMLElement | null)?.focus();
    this.renderToast();
  }
  renderCtx() {
    const el = this.root.querySelector("#ctx");
    if (el) el.innerHTML = this.ctxbar();
  }
  renderToast() {
    const el = this.root.querySelector("#toast");
    if (!el) return;
    el.innerHTML = this.st.toast ? `<div class="toast ${this.st.toast.err ? "err" : ""}" role="status">${esc(this.st.toast.msg)}</div>` : "";
  }

  header() {
    const sint = this.ctx ? this.s.one("SELECT sintetico FROM empresa WHERE id=?", [this.ctx.empresaId])?.sintetico : 0;
    return `<header class="app-header">
      <div class="brand-mark" aria-hidden="true">CS</div>
      <div class="brand"><h1>Costeo de la Cadena de Suministro</h1><p>Costeo basado en actividades (ABC)</p></div>
      <div class="header-right">
        ${sint ? `<span class="synthetic-flag" title="Los datos cargados son sintéticos, no de una empresa real">DATOS SINTÉTICOS</span>` : ""}
        <button class="btn small" data-act="about">Acerca de</button>
      </div></header>`;
  }
  nav() {
    return `<nav class="topnav" aria-label="Navegación principal">
      <button class="navarrow" data-act="nav-left" aria-label="Desplazar pestañas a la izquierda">‹</button>
      <div class="scroller" id="navscroll">${TABS.map(
        (t, i) => `<button class="tab" data-act="tab" data-tab="${t.id}" ${this.st.tab === t.id ? 'aria-current="page"' : ""}><span class="ico">${i + 1}</span>${t.label}</button>`,
      ).join("")}</div>
      <button class="navarrow" data-act="nav-right" aria-label="Desplazar pestañas a la derecha">›</button></nav>`;
  }
  ctxbar() {
    const c = this.ctx;
    const save = this.s.lastSave;
    const saveTxt = save ? (save.ok ? `Guardado ${fechaHora(save.at)}` : "Error al guardar") : this.s.dirty ? "Cambios sin guardar" : "Sin cambios";
    if (!c)
      return `<div class="ctxbar"><span><span class="k">Modelo</span><span class="v">ninguno</span></span><span class="pill none">Sin datos</span><span class="spacer"></span><span class="muted">${esc(this.s.storage.kind)} · ${esc(saveTxt)}</span></div>`;
    const e = this.s.one("SELECT * FROM empresa WHERE id=?", [c.empresaId]);
    const m = this.s.one("SELECT * FROM modelo WHERE id=?", [c.modeloId]);
    const v = this.s.one("SELECT * FROM modelo_version WHERE id=?", [c.versionId]);
    const p = this.s.one("SELECT * FROM periodo WHERE id=?", [c.periodoId]);
    const est = this.estadoGeneral();
    const ms = MOD.listarModelos(this.s).filter((x) => x.estado !== "ARCHIVADO" || x.id === c.modeloId);
    const ps = MOD.periodosEmpresa(this.s, c.empresaId);
    const selCss = 'style="height:30px;border:1px solid var(--input-border);border-radius:7px;background:#fff;font-weight:600;max-width:320px"';
    return `<div class="ctxbar">
      <span><span class="k">Empresa</span><span class="v">${esc(e?.nombre)}</span></span>
      <label><span class="k">Modelo</span><select data-edit="ctx-modelo" ${selCss} aria-label="Modelo activo">${ms.map((x) => `<option value="${x.id}" ${x.id === c.modeloId ? "selected" : ""}>${esc(x.codigo)} · ${esc(x.nombre)}</option>`).join("")}</select></label>
      <span><span class="k">Versión</span><span class="v">v${esc(v?.numero)} (${esc(v?.estado)})</span></span>
      <label><span class="k">Período</span><select data-edit="ctx-periodo" ${selCss} aria-label="Período activo">${ps.map((x) => `<option value="${x.id}" ${x.id === c.periodoId ? "selected" : ""}>${esc(x.nombre)}</option>`).join("")}</select></label>
      <span><span class="k">Moneda</span><span class="v">${esc(e?.moneda)}</span></span>
      <span class="pill ${est.cls}">${est.txt}</span>
      <span class="spacer"></span>
      <span class="muted">Último recálculo: ${est.run ? fechaHora(est.run.creado_en) : "—"} · ${esc(saveTxt)}</span>
    </div>`;
  }
  estadoP3(): { cls: string; txt: string; run: any } {
    const c = this.ctx;
    if (!c) return { cls: "none", txt: "Sin datos", run: null };
    const run = UC.ultimaCorrida(this.s, c, "P3");
    const calc = UC.calcularP3(this.s, c);
    if (calc.bloqueos.length) return { cls: "err", txt: "Incompleto: hay bloqueos", run };
    if (!run) return { cls: "none", txt: "Sin calcular", run };
    if (run.params_hash !== calc.hash) return { cls: "warn", txt: "Desactualizado: requiere recálculo", run };
    return { cls: "ok", txt: "Calculado y conciliado (P3)", run };
  }

  page(): string {
    const t = this.st.tab;
    if (t === "inicio") return this.pInicio();
    if (t === "modelo" && !this.ctx) return P2.pModelo(this as any);
    if (!this.ctx) return this.title(TABS.find((x) => x.id === t)!.label, "") + this.sinDatos();
    if (t === "personas") return this.pPersonas();
    if (t === "inductores") return this.pInductores();
    if (t === "asignacion") return this.pAsignacion();
    if (t === "modelo") return P2.pModelo(this as any);
    if (t === "estructuras") return P2.pEstructuras(this as any);
    if (t === "procesos") return P2.pProcesos(this as any);
    if (t === "recursos") return P2.pRecursos(this as any);
    if (t === "maestros") return P2.pMaestros(this as any);
    if (t === "reportes") return this.pReportes();
    if (t === "resultados") return R3.pResultados(this as any);
    if (t === "simulacion") return SIMUI.pSimulacion(this as any);
    return this.pPlanificado(t);
  }
  title(h: string, p: string, actions = "") {
    return `<div class="page-title"><div><h2>${esc(h)}</h2>${p ? `<p>${p}</p>` : ""}</div>${actions ? `<div class="actions">${actions}</div>` : ""}</div>`;
  }
  sinDatos() {
    return `<div class="empty"><h3>No hay un modelo cargado</h3><p>Ve a Inicio y pulsa «Cargar datos de verificación», o restaura un respaldo .sqlite.</p><button class="btn primary" data-act="tab" data-tab="inicio">Ir a Inicio</button></div>`;
  }
  subtabs(key: string, items: { id: string; label: string; soon?: string }[]) {
    const cur = this.st.sub[key];
    return `<div class="subtabs" role="tablist">${items
      .map((i) =>
        i.soon
          ? `<button role="tab" disabled title="Disponible en una próxima versión">${esc(i.label)}<span class="soon">${i.soon}</span></button>`
          : `<button role="tab" aria-selected="${cur === i.id}" data-act="sub" data-key="${key}" data-sub="${i.id}">${esc(i.label)}</button>`,
      )
      .join("")}</div>`;
  }

  // ---------- 1 Inicio ----------
  pInicio() {
    const c = this.ctx;
    const counts = this.s.counts();
    const nreg = counts.reduce((s, x) => s + (x.tabla === "meta" ? 0 : x.n), 0);
    const est = this.estadoP3();
    let kpis = "";
    if (c && this.esModeloCompleto()) {
      const R = this.abc()!;
      const e2 = this.estadoABC();
      const ok = e2.cls !== "none";
      const k = (lbl: string, val: string, src: string) => `<div class="kpi"><div class="lbl">${lbl}</div><div class="val">${val}</div><div class="src">${src}</div></div>`;
      const cadena = R.resumen.filter((x) => x.act.alcance !== "EXCLUIDA").reduce((s2, x) => s2 + x.total, 0);
      const pend = R.saldos.filter((z) => z.tipo === "PENDIENTE" || z.tipo === "BLOQUEADO").reduce((s2, z) => s2 + z.monto, 0);
      kpis = `<div class="grid g4">
        ${k("Costo asignado a objetos de costo", ok ? money(R.objetos.reduce((s2, o) => s2 + o.costo, 0)) : "—", ok ? `Corrida ${esc(e2.run.id)}` : e2.txt)}
        ${k("Costo de actividades de la cadena", ok ? money(cadena) : "—", ok ? "CMD + CSD + CPD + CI (Resumen)" : e2.txt)}
        ${k("Saldos pendientes o bloqueados", ok ? money(pend) : "—", ok ? "Visibles, sin normalizar" : e2.txt)}
        ${k("Conciliación global", ok ? (R.cuadra ? "Cuadra" : "No cuadra") : "—", ok ? "Origen " + money(R.totalFuente) : e2.txt)}</div>`;
    } else if (c) {
      const calc = UC.calcularP3(this.s, c);
      const valid = est.cls === "ok";
      const k = (lbl: string, val: string, src: string) => `<div class="kpi"><div class="lbl">${lbl}</div><div class="val">${val}</div><div class="src">${src}</div></div>`;
      const nPer = this.s.one("SELECT COUNT(*) n FROM persona WHERE version_id=?", [c.versionId])!.n;
      const nAct = this.s.one("SELECT COUNT(*) n FROM actividad WHERE version_id=?", [c.versionId])!.n;
      kpis = `<div class="grid g4">
        ${k("Costo de personal directo (P3)", valid ? money(calc.totalCPD) : "—", valid ? `Corrida ${esc(est.run.id)}` : est.txt)}
        ${k("Capacidad no utilizada", valid ? money(calc.totalCapacidad) : "—", valid ? "Horas pagadas no imputadas × tasa individual" : est.txt)}
        ${k("Personas registradas", String(nPer), "Registro de personas del modelo")}
        ${k("Actividades del modelo", String(nAct), "Catálogo de actividades")}</div>`;
    }
    return `
      <div class="banner"><div><h2>${c ? "Espacio de trabajo" : "Bienvenido"}</h2>
        <p>${c ? "Costeo ABC completo P1 → P4c con N modelos, N centros y costeo por persona. Importa un Excel de datos o de referencia desde «Modelo de Costeo»; luego revisa Resultados (analítica y pronóstico), Simulación (Monte Carlo y EVA) y Reportes (Excel de resultados, analítica y proyecciones; informe técnico y presentación)." : "Aún no hay datos. Para ver el sistema funcionando de inmediato, pulsa «Cargar demostración en un clic». También puedes importar tu propio Excel desde «Modelo de Costeo», cargar el caso de verificación del motor o restaurar un respaldo."}</p></div>
        <div class="actions">
          <button class="btn" data-act="tab" data-tab="modelo">Gestionar modelos e importar Excel</button>
          ${c ? `<button class="btn primary" data-act="tab" data-tab="asignacion">Ver matrices</button><button class="btn" data-act="tab" data-tab="personas">Personas</button><button class="btn" data-act="tab" data-tab="inductores">Laboratorio de inductores</button>` : `<button class="btn" data-act="seed">Cargar caso de verificación</button>`}
        </div></div>
      ${this.panelDemo()}
      ${kpis}
      <div class="grid g2" style="margin-top:16px">
        <section class="panel"><h3>Persistencia y respaldo</h3><p class="lead">Dónde se guarda la base y cómo recuperarla.</p>
          <dl class="mono" style="display:grid;grid-template-columns:170px 1fr;gap:6px 10px;margin:0 0 14px">
            <dt class="muted">Variante</dt><dd>${this.s.storage.kind === "EXE" ? "EXE (host Windows)" : "HTML offline (navegador)"}</dd>
            <dt class="muted">Almacenamiento</dt><dd>${esc(this.storageDesc || "consultando…")}</dd>
            <dt class="muted">Último guardado</dt><dd>${this.s.lastSave ? (this.s.lastSave.ok ? fechaHora(this.s.lastSave.at) + " · " + num(this.s.lastSave.bytes / 1024, 1) + " KB" : "ERROR: " + esc(this.s.lastSave.error)) : "sin guardar en esta sesión"}</dd>
            <dt class="muted">Registros en la base</dt><dd>${nreg}</dd>
          </dl>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn" data-act="backup">Respaldar base (.sqlite)</button>
            <label class="btn" style="cursor:pointer">Restaurar respaldo<input type="file" accept=".sqlite,.db" data-edit="restore" hidden></label>
            <button class="btn" data-act="diag">Diagnóstico del sistema</button>
          </div></section>
        <section class="panel"><h3>Funciones de esta versión</h3><p class="lead">Todo lo que se ve calculado proviene del motor; nada es maqueta.</p>
          <div class="plan-list">
            <div class="plan-item"><b>Costeo ABC</b>P1, P2, P3 por persona, P4a, P4b (N centros), Resumen, P4c y conciliación; N modelos independientes.</div>
            <div class="plan-item"><b>Analítica</b>Descriptiva, diagnóstica, predictiva (6 meses con backtesting), prescriptiva y relevancia.</div>
            <div class="plan-item"><b>Simulación y EVA</b>Escenarios, Monte Carlo reproducible, sensibilidad, alternativas, NOPAT, WACC, EVA y ΔEVA.</div>
            <div class="plan-item"><b>Reportes</b>Excel de resultados, de analítica y de proyecciones y EVA; informe técnico Word y presentación ejecutiva PowerPoint generados por el sistema.</div>
          </div></section>
      </div>`;
  }

  // ---------- 7 Personas ----------
  pPersonas() {
    const c = this.ctx!;
    const sub = this.st.sub.personas || "registro";
    let body = "";
    const ps = UC.personas(this.s, c);
    if (sub === "registro") {
      const pus = UC.puestos(this.s, c);
      body = `<section class="panel"><h3>Registro de personas y costo empresa del período</h3>
        <p class="lead">Cada persona tiene su propio costo y horas, aunque comparta puesto. El costo empresa y la tasa los calcula el motor.</p>
        <div class="form-row">
          <label>Nombre de la nueva persona<input id="np-nombre" placeholder="Ej. Analista C"></label>
          <label>Puesto<select id="np-puesto">${pus.map((p) => `<option value="${p.id}">${esc(p.codigo)} · ${esc(p.nombre)}</option>`).join("")}</select></label>
          <label>Horas disponibles del mes<input id="np-horas" value="192,00" inputmode="decimal"></label>
          <button class="btn primary" data-act="new-person">Agregar persona</button>
        </div>
        <div class="matrix-wrap"><table class="matrix"><thead>
          <tr><th class="frz1" rowspan="2">Código</th><th class="frz2" rowspan="2">Persona</th><th rowspan="2">Puesto</th><th rowspan="2">Centro</th><th class="group" colspan="${COMPONENTES.length}">Componentes del costo empresa (S/ por mes)</th><th rowspan="2">Costo empresa S/</th><th rowspan="2">Horas disponibles</th><th rowspan="2">Tasa S/ por hora</th><th rowspan="2">Fuente</th><th rowspan="2"></th></tr>
          <tr class="h2">${COMPONENTES.map((k) => `<th>${esc(k.label)}</th>`).join("")}</tr></thead><tbody>
          ${ps
            .map((p) => {
              const tasa = p.horas > 0 ? p.costo / p.horas : null;
              return `<tr><td class="frz1 mono">${esc(p.codigo)}</td>
              <td class="frz2"><input class="txt" data-key="nm-${p.id}" data-edit="person-name" data-id="${p.id}" value="${esc(p.nombre)}" aria-label="Nombre de ${esc(p.codigo)}"></td>
              <td>${esc(p.puesto)}</td><td>${esc(p.centro)}</td>
              ${COMPONENTES.map((k) => `<td><input data-key="c-${p.id}-${k.key}" data-edit="cost" data-id="${p.costoId}" data-field="${k.key}" value="${num(p.comp[k.key])}" inputmode="decimal" aria-label="${esc(k.label)} de ${esc(p.codigo)}"></td>`).join("")}
              <td class="num derived clickable" data-act="explain-rate" data-id="${p.id}">${money(p.costo)}</td>
              <td><input data-key="h-${p.id}" data-edit="cost" data-id="${p.costoId}" data-field="horas_disponibles" value="${num(p.horas)}" inputmode="decimal" aria-label="Horas disponibles de ${esc(p.codigo)}"></td>
              <td class="num derived clickable ${tasa === null ? "blocked" : ""}" data-act="explain-rate" data-id="${p.id}">${tasa === null ? "Sin tasa" : num(tasa, 4)}</td>
              <td>${esc(p.fuente)}</td>
              <td><button class="btn small danger" data-act="del-person" data-id="${p.id}" aria-label="Eliminar ${esc(p.codigo)}">Eliminar</button></td></tr>`;
            })
            .join("")}
          </tbody></table></div>
        <div class="legend"><span class="l-in">Dato editable</span><span class="l-der">Calculado por el motor</span><span class="l-click">Clic: explicar cálculo</span></div></section>`;
    } else if (sub === "horas") {
      const todasActs = UC.actividades(this.s, c);
      const imp = UC.imputaciones(this.s, c);
      const calcTodo = UC.calcularP3(this.s, c);
      const cens = UC.centros(this.s, c);
      // con muchas personas la matriz completa no es legible: se filtra por centro de actividad
      const grande = calcTodo.porPersona.length > 60;
      const fc = this.st.sub.horasCentro ?? (grande ? cens.find((x) => todasActs.some((a: any) => a.centro_id === x.id))?.id || "" : "");
      const centroDe = new Map(this.s.all("SELECT pp.persona_id, pp.centro_id FROM persona_puesto pp JOIN persona p ON p.id=pp.persona_id WHERE p.version_id=? AND pp.hasta IS NULL", [c.versionId]).map((r) => [r.persona_id, r.centro_id]));
      const acts = fc ? todasActs.filter((a: any) => a.centro_id === fc) : todasActs;
      const actIds = new Set(acts.map((a: any) => a.id));
      const calc = fc ? { ...calcTodo, porPersona: calcTodo.porPersona.filter(({ p }: any) => centroDe.get(p.id) === fc || [...imp.keys()].some((k) => k.startsWith(p.id + "|") && actIds.has(k.split("|")[1]))) } : calcTodo;
      body = `<section class="panel"><h3>Horas por actividad — matriz Persona × Actividad</h3>
        <p class="lead">Horas imputadas en ${esc(this.s.one("SELECT nombre FROM periodo WHERE id=?", [c.periodoId])?.nombre)}. Si una persona imputa más horas de las disponibles, su costo se bloquea.</p>
        <div class="form-row"><label>Centro de actividad<select data-edit="horas-centro"><option value="" ${fc ? "" : "selected"}>Todos los centros (${calcTodo.porPersona.length} personas)</option>${cens.map((x) => `<option value="${x.id}" ${x.id === fc ? "selected" : ""}>${esc(x.codigo)} · ${esc(x.nombre)}</option>`).join("")}</select></label>
          <span class="muted">${calc.porPersona.length} personas · ${acts.length} actividades en la vista</span></div>
        <div class="form-row"><label>Nueva actividad<input id="na-nombre" placeholder="Ej. Verificar stock"></label>
          <label>Centro<select id="na-centro">${UC.centros(this.s, c).map((x) => `<option value="${x.id}">${esc(x.codigo)} · ${esc(x.nombre)}</option>`).join("")}</select></label>
          <button class="btn" data-act="new-activity">Agregar actividad</button></div>
        <div class="matrix-wrap"><table class="matrix"><thead><tr><th class="frz1">Código</th><th class="frz2">Persona</th><th>Puesto</th>
          ${acts.map((a) => `<th title="${esc(a.nombre)}">${esc(a.codigo)}<br><span class="muted" style="font-weight:500">${esc(abrev(a.nombre, 28))}</span></th>`).join("")}
          <th>Horas imputadas</th><th>Horas disponibles</th><th>Horas restantes</th><th>Estado</th></tr></thead><tbody>
          ${calc.porPersona
            .map(
              ({ p, r }) => `<tr><td class="frz1 mono">${esc(p.codigo)}</td><td class="frz2">${esc(p.nombre)}</td><td>${esc(p.puesto)}</td>
            ${acts.map((a) => `<td><input data-key="i-${p.id}-${a.id}" data-edit="hours" data-p="${p.id}" data-a="${a.id}" value="${imp.has(p.id + "|" + a.id) ? num(imp.get(p.id + "|" + a.id)!) : ""}" placeholder="0" inputmode="decimal" aria-label="Horas de ${esc(p.codigo)} en ${esc(a.codigo)}"></td>`).join("")}
            <td class="num derived">${num(r.horasImputadas)}</td><td class="num derived">${num(r.horasDisponibles)}</td>
            <td class="num derived ${r.horasRestantes < 0 ? "blocked" : ""}${neg(r.horasRestantes)}">${num(r.horasRestantes)}</td>
            <td>${this.pillPersona(r.estado)}</td></tr>`,
            )
            .join("")}
          </tbody></table></div></section>`;
    } else {
      const calc = UC.calcularP3(this.s, c);
      body = `<section class="panel"><h3>Validación de horas y capacidad no utilizada</h3>
        <p class="lead">Costo empresa = costo aplicado a actividades + capacidad no utilizada. La sobreimputación requiere autorización con justificación.${(() => { const ni = this.s.one("SELECT COUNT(*) n FROM persona p JOIN persona_puesto pp ON pp.persona_id=p.id AND pp.hasta IS NULL JOIN puesto pu ON pu.id=pp.puesto_id WHERE p.version_id=? AND pu.tipo='INDIRECTO'", [c.versionId])?.n || 0; return ni ? ` Se muestran ${calc.porPersona.length} personas directas; las ${ni} personas indirectas no imputan horas: su costo entra a P4a como «Personal indirecto».` : ""; })()}</p>
        ${calc.bloqueos.length ? `<div class="alert err"><b>Cálculo bloqueado.</b><br>${calc.bloqueos.map(esc).join("<br>")}</div>` : `<div class="alert ok">Todas las personas tienen horas dentro de su disponibilidad o una autorización registrada.</div>`}
        <div class="matrix-wrap"><table class="matrix"><thead><tr><th class="frz1">Código</th><th class="frz2">Persona</th><th>Costo empresa S/</th><th>Horas disponibles</th><th>Horas imputadas</th><th>Horas restantes</th><th>Tasa S/ por hora</th><th>Costo aplicado S/</th><th>Capacidad no utilizada S/</th><th>Conciliación</th><th>Estado</th><th>Autorizar sobreimputación</th><th>Justificación</th></tr></thead><tbody>
        ${calc.porPersona
          .map(({ p, r }) => {
            const ok = Math.abs(r.costo - r.costoAplicado - r.capacidadNoUtilizada) <= 0.005;
            return `<tr><td class="frz1 mono">${esc(p.codigo)}</td><td class="frz2">${esc(p.nombre)}</td>
            <td class="num">${money(r.costo)}</td><td class="num">${num(r.horasDisponibles)}</td><td class="num">${num(r.horasImputadas)}</td>
            <td class="num ${r.horasRestantes < 0 ? "blocked" : ""}">${num(r.horasRestantes)}</td><td class="num derived">${r.tasa === null ? "—" : num(r.tasa, 4)}</td>
            <td class="num derived">${money(r.costoAplicado)}</td><td class="num derived${neg(r.capacidadNoUtilizada)}">${money(r.capacidadNoUtilizada)}</td>
            <td>${r.estado === "OK" ? (ok ? '<span class="pill ok">Cuadra</span>' : '<span class="pill err">No cuadra</span>') : '<span class="pill none">N/A</span>'}</td>
            <td>${this.pillPersona(r.estado)}</td>
            <td><input type="checkbox" data-edit="authorize" data-id="${p.costoId}" ${p.autorizada ? "checked" : ""} aria-label="Autorizar sobreimputación de ${esc(p.codigo)}"></td>
            <td><input class="txt" data-key="j-${p.id}" data-edit="justify" data-id="${p.costoId}" value="${esc(p.justificacion || "")}" placeholder="Obligatoria para autorizar"></td></tr>`;
          })
          .join("")}
        <tr class="total"><td class="frz1"></td><td class="frz2">Total</td><td class="num">${money(calc.totalCosto)}</td><td colspan="4"></td><td class="num">${money(calc.totalCPD)}</td><td class="num">${money(calc.totalCapacidad)}</td><td colspan="4"></td></tr>
        </tbody></table></div></section>`;
    }
    if (sub === "historial") {
      const ps = MOD.periodosEmpresa(this.s, c.empresaId).slice(-12);
      const filas = this.s.all(`SELECT p.id, p.codigo, p.nombre, cp.periodo_id, (COALESCE(cp.remuneracion,0)+COALESCE(cp.essalud,0)+COALESCE(cp.gratificacion,0)+COALESCE(cp.cts,0)+COALESCE(cp.vacaciones,0)+COALESCE(cp.bonos,0)+COALESCE(cp.otros,0)) costo, cp.horas_disponibles h
        FROM persona p JOIN costo_persona cp ON cp.persona_id=p.id WHERE p.version_id=? ORDER BY p.codigo`, [c.versionId]);
      const per = new Map<string, any>();
      for (const f of filas) { if (!per.has(f.id)) per.set(f.id, { codigo: f.codigo, nombre: f.nombre, v: new Map() }); per.get(f.id).v.set(f.periodo_id, f); }
      body = `<section class="panel"><h3>Historial por período · tasa individual S/ por hora</h3>
        <p class="lead">Tasa = costo empresa del mes / horas disponibles del mes. Últimos ${ps.length} períodos. Pasa el mouse para ver costo y horas.</p>
        <div class="matrix-wrap"><table class="matrix"><thead><tr><th class="frz1">Código</th><th class="frz2">Persona</th>${ps.map((p) => `<th>${esc(p.nombre)}</th>`).join("")}</tr></thead><tbody>
        ${[...per.values()].map((x) => `<tr><td class="frz1 mono">${esc(x.codigo)}</td><td class="frz2">${esc(x.nombre)}</td>${ps.map((p) => { const f = x.v.get(p.id); return `<td class="num" title="${f ? `Costo ${num(f.costo)} · ${num(f.h)} h` : "Sin registro"}">${f && f.h > 0 ? num(f.costo / f.h, 4) : "—"}</td>`; }).join("")}</tr>`).join("")}
        </tbody></table></div></section>`;
    }
    return (
      this.title("Personas", "Costeo individual: dos trabajadores del mismo puesto pueden tener costo, horas y tasa diferentes.") +
      this.subtabs("personas", [
        { id: "registro", label: "Registro de personas" },
        { id: "horas", label: "Horas por actividad" },
        { id: "validacion", label: "Validación de horas" },
        { id: "historial", label: "Historial por período" },
      ]) +
      body
    );
  }
  pillPersona(e: string) {
    if (e === "OK") return '<span class="pill ok">OK</span>';
    if (e === "SOBREIMPUTADA") return '<span class="pill err">Sobreimputada</span>';
    if (e === "SOBREIMPUTADA_AUTORIZADA") return '<span class="pill warn">Autorizada</span>';
    return '<span class="pill err">Sin tasa</span>';
  }

  // ---------- 8 Inductores ----------
  pInductores() {
    const c = this.ctx!;
    const subI = this.st.sub.inductores || "catalogo";
    const tieneReglas = !!this.s.one("SELECT 1 FROM regla_reparto WHERE version_id=? LIMIT 1", [c.versionId]);
    const tabsI = [
      { id: "catalogo", label: "Catálogo de inductores", ...(tieneReglas ? {} : { soon: "sin reglas" }) },
      { id: "laboratorio", label: "Laboratorio de cálculo" },
    ];
    if (tieneReglas && subI === "laboratorio" && (!this.st.reglaId || !this.s.one("SELECT 1 FROM regla_reparto WHERE id=? AND version_id=?", [this.st.reglaId, c.versionId]))) {
      // sin regla elegida: se abre la primera regla con costo (4a) para que el laboratorio nunca quede vacío
      this.st.reglaId = this.s.one("SELECT id FROM regla_reparto WHERE version_id=? ORDER BY CASE WHEN COALESCE(base_desde,'')<>'' THEN 9 WHEN nivel='EC_CA' THEN 1 WHEN nivel='CA_AC' THEN 2 ELSE 3 END, codigo LIMIT 1", [c.versionId])?.id;
    }
    if (tieneReglas && (subI === "catalogo" || (subI === "laboratorio" && this.st.reglaId))) {
      const cuerpo = subI === "catalogo" ? P2.pInductoresCatalogo(this as any) : P2.labRegla(this as any, this.st.reglaId);
      return this.title("Inductores", "Inductor ≠ cantidad ≠ tasa ≠ costo aplicado. Toda cifra se deriva paso a paso y se puede auditar.") + this.subtabs("inductores", tabsI) + cuerpo;
    }
    const ps = UC.pools(this.s, c);
    if (!ps.length) return this.title("Inductores", "") + this.subtabs("inductores", tabsI) + `<div class="empty"><h3>Elige una regla en el catálogo</h3><p>El laboratorio muestra el cálculo paso a paso de la regla seleccionada.</p></div>`;
    if (!this.st.poolId || !ps.find((p) => p.id === this.st.poolId)) this.st.poolId = ps[0]?.id || null;
    const lab = this.st.poolId ? UC.calcularLab(this.s, c, this.st.poolId) : null;
    let body = `<div class="empty"><h3>No hay costos para repartir</h3></div>`;
    if (lab) {
      const r = lab.r;
      const stCls = r.estado === "CALCULADO" ? "ok" : r.estado === "CON_SALDO" ? "warn" : "err";
      const unidad = lab.pool.unidad;
      body = `<section class="panel">
        <div class="form-row">
          <label>Costo a repartir<select data-edit="pool-select">${ps.map((p) => `<option value="${p.id}" ${p.id === lab.pool.id ? "selected" : ""}>${esc(p.codigo)} · ${esc(p.nombre)}</option>`).join("")}</select></label>
          <label>Monto del período (S/)<input data-key="pool-monto" data-edit="pool-monto" value="${num(lab.pool.monto)}" inputmode="decimal"></label>
          <label>Tipo de base<select data-edit="pool-tipo">${(["cantidad", "porcentaje", "importe", "directo", "plano"] as TipoBase[]).map((t) => `<option value="${t}" ${t === lab.pool.tipo_base ? "selected" : ""}>${t}</option>`).join("")}</select></label>
          <span class="pill ${stCls}" style="margin-bottom:8px">${esc(r.estado === "CALCULADO" ? "Calculado y conciliado" : r.estado === "CON_SALDO" ? "Calculado con saldo no asignado" : r.estado === "PENDIENTE" ? "Pendiente: no calculable" : "Bloqueado")}</span>
        </div>
        <div class="magnitudes" aria-label="Cuatro magnitudes distintas">
          <div class="mag"><div class="t">Inductor</div><div class="v" style="font-size:15px">${esc(lab.pool.inductor)}</div><div class="d">Causa del consumo · unidad: ${esc(unidad)}</div></div>
          <div class="mag"><div class="t">Cantidad total (denominador)</div><div class="v">${r.denominador === null ? "—" : num(r.denominador, 2)} ${esc(lab.pool.tipo_base === "cantidad" ? unidad : "")}</div><div class="d">Σ cantidades válidas de los destinos</div></div>
          <div class="mag"><div class="t">Tasa de asignación</div><div class="v">${r.tasa === null ? "—" : num(r.tasa, 4)}</div><div class="d">${esc(r.unidadTasa)} = pool ÷ denominador</div></div>
          <div class="mag"><div class="t">Costo aplicado</div><div class="v">${money(r.asignado)}</div><div class="d">Saldo no asignado: ${money(r.saldo)}</div></div>
        </div>
        ${r.mensajes.length ? `<div class="alert ${r.estado === "CALCULADO" ? "info" : r.estado === "CON_SALDO" ? "warn" : "err"}">${r.mensajes.map(esc).join("<br>")}</div>` : ""}
        <div class="matrix-wrap"><table class="matrix"><thead><tr><th class="frz1">Código</th><th class="frz2">Destino (objeto de costo)</th><th>Cantidad del inductor (${esc(unidad)})</th><th>Estado del valor</th><th>Método / fuente</th><th>Tasa</th><th>Costo aplicado S/</th><th>% del pool</th></tr></thead><tbody>
          ${lab.destinos
            .map((d, i) => {
              const l = r.lineas[i];
              return `<tr><td class="frz1 mono">${esc(d.objeto.codigo)}</td><td class="frz2">${esc(d.objeto.nombre)}</td>
                <td><input data-key="b-${d.objeto.id}" data-edit="base-valor" data-o="${d.objeto.id}" value="${d.base && d.base.valor !== null ? num(d.base.valor, 4).replace(/,?0+$/, "") : ""}" placeholder="sin dato" inputmode="decimal"></td>
                <td><select data-edit="base-estado" data-o="${d.objeto.id}">${["REAL", "ESTIMADO", "AJUSTADO", "PENDIENTE"].map((e) => `<option ${(d.base?.estado_valor || "PENDIENTE") === e ? "selected" : ""}>${e}</option>`).join("")}</select></td>
                <td><input class="txt" data-key="m-${d.objeto.id}" data-edit="base-metodo" data-o="${d.objeto.id}" value="${esc(d.base?.metodo || "")}" placeholder="Método o fuente del dato"></td>
                <td class="num derived">${r.tasa === null || !l || l.base === 0 ? "—" : num(r.tasa, 4)}</td>
                <td class="num derived clickable" data-act="explain-lab" data-i="${i}">${l ? money(l.importe) : "—"}</td>
                <td class="num derived">${l && lab.pool.monto > 0 ? num((l.importe / lab.pool.monto) * 100, 2) + " %" : "—"}</td></tr>`;
            })
            .join("")}
          <tr class="subtotal"><td class="frz1"></td><td class="frz2">Saldo no asignado</td><td colspan="4"></td><td class="num">${money(r.saldo)}</td><td class="num">${lab.pool.monto > 0 ? num((r.saldo / lab.pool.monto) * 100, 2) + " %" : "—"}</td></tr>
          <tr class="total"><td class="frz1"></td><td class="frz2">Total = pool</td><td class="num">${r.denominador === null ? "—" : num(r.denominador, 2)}</td><td colspan="3"></td><td class="num">${money(round2(r.asignado + r.saldo))}</td><td class="num">${lab.pool.monto > 0 ? num(100) + " %" : "—"}</td></tr>
          </tbody></table></div>
        <div class="form-row" style="margin-top:12px"><label>Nuevo objeto de costo<input id="no-nombre" placeholder="Ej. Objeto C — Pedidos e-commerce"></label><label>Magnitud<input id="no-mag" value="# pedidos"></label><button class="btn" data-act="new-object">Agregar objeto (crea su columna en todas las bases)</button></div>
      </section>
      <section class="panel"><h3>Cálculo paso a paso</h3><p class="lead">${esc(lab.pool.definicion || "")}</p><ol class="steps">${r.pasos.map((p) => `<li>${esc(p.replace(/^\d+\.\s*/, ""))}</li>`).join("")}</ol></section>`;
    }
    return (
      this.title("Inductores", "Inductor ≠ cantidad ≠ tasa ≠ costo aplicado. Toda cifra se deriva paso a paso y se puede auditar.") +
      this.subtabs("inductores", [
        { id: "catalogo", label: "Catálogo de inductores", soon: "sin reglas" },
        { id: "laboratorio", label: "Laboratorio de cálculo" },
      ]) +
      body
    );
  }

  // ---------- 9 Asignación ----------
  pAsignacion() {
    const c = this.ctx!;
    const calc = UC.calcularP3(this.s, c);
    const est = this.esModeloCompleto() ? this.estadoABC() : this.estadoP3();
    const acts = UC.actividades(this.s, c);
    const showCalc = est.cls !== "none" && !(est.cls === "err" && !est.run);
    let rows = "";
    for (const a of acts) {
      const fs = calc.filas.filter((f) => f.actividad.id === a.id);
      if (!fs.length) continue;
      fs.forEach((f, i) => {
        const r = calc.porPersona.find((x) => x.p.id === f.persona.id)!.r;
        rows += `<tr>
          <td class="frz1 mono">${i === 0 ? esc(a.codigo) : ""}</td><td class="frz2">${i === 0 ? esc(a.nombre) : ""}</td>
          <td>${i === 0 ? esc(a.ca_codigo + " " + a.ca_nombre) : ""}</td><td class="mono">${esc(f.persona.codigo)}</td><td>${esc(f.persona.nombre)}</td><td>${esc(f.persona.puesto)}</td>
          <td class="num">${num(f.persona.horas)}</td><td class="num">${num(f.horas)}</td><td class="num">${money(f.persona.costo)}</td>
          <td class="num derived">${f.tasa === null ? "—" : num(f.tasa, 4)}</td>
          <td class="num derived ${f.bloqueada ? "blocked" : showCalc ? "clickable" : ""}" ${showCalc && !f.bloqueada ? `data-act="explain-p3" data-p="${f.persona.id}" data-a="${a.id}"` : ""}>${f.bloqueada ? "Bloqueado" : showCalc ? money(f.importe) : "Sin calcular"}</td>
          <td class="num derived${neg(r.horasRestantes)}">${num(r.horasRestantes)}</td></tr>`;
      });
      rows += `<tr class="subtotal"><td class="frz1"></td><td class="frz2">CPD de ${esc(a.codigo)}</td><td colspan="5"></td><td class="num">${num(fs.reduce((s, f) => s + f.horas, 0))}</td><td colspan="2"></td><td class="num">${showCalc ? money(calc.totalPorActividad.get(a.id) || 0) : "—"}</td><td></td></tr>`;
    }
    const conc = Math.abs(calc.totalCosto - calc.totalCPD - calc.totalCapacidad) <= 0.005;
    const body = `<section class="panel">
      ${calc.bloqueos.length ? `<div class="alert err"><b>No se puede ejecutar P3:</b><br>${calc.bloqueos.map(esc).join("<br>")}</div>` : ""}
      ${est.cls === "warn" ? `<div class="alert warn">Los datos de origen cambiaron después de la corrida ${esc(est.run.id)}. Las cifras mostradas son el recálculo en vivo y aún no están confirmadas: pulsa el botón de ejecutar.</div>` : ""}
      ${est.cls === "none" && !calc.bloqueos.length ? `<div class="alert info">El costeo aún no se ha ejecutado para este período. Pulsa el botón de ejecutar para calcular y guardar la corrida.</div>` : ""}
      <div class="matrix-wrap"><table class="matrix"><thead><tr>
        <th class="frz1">Código</th><th class="frz2">Actividad</th><th>CA</th><th>PersonaID</th><th>Persona</th><th>Cargo</th>
        <th>Horas efectivas del período</th><th>Horas imputadas a la actividad</th><th>Costo empresa persona</th><th>Tarifa S/ por hora</th><th>Costo asignado S/</th><th>Horas restantes de la persona</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="12" class="muted">No hay horas imputadas.</td></tr>`}
        <tr class="total"><td class="frz1"></td><td class="frz2">Total CPD del período</td><td colspan="8"></td><td class="num">${showCalc ? money(calc.totalCPD) : "—"}</td><td></td></tr>
        </tbody></table></div>
      <div class="legend"><span class="l-der">Calculado por el motor</span><span class="l-click">Clic en el importe: explicar cálculo</span></div></section>
      <section class="panel"><h3>Conciliación del costo de personal</h3>
        <div class="matrix-wrap" style="max-height:none"><table class="matrix"><tbody>
          <tr><td class="frz2">Costo empresa total de las personas</td><td class="num">${money(calc.totalCosto)}</td></tr>
          <tr><td class="frz2">(−) Costo aplicado a actividades (CPD)</td><td class="num">${showCalc ? money(calc.totalCPD) : "—"}</td></tr>
          <tr><td class="frz2">(−) Capacidad no utilizada</td><td class="num">${showCalc ? money(calc.totalCapacidad) : "—"}</td></tr>
          <tr class="total"><td class="frz2">Diferencia</td><td class="num${neg(round2(calc.totalCosto - calc.totalCPD - calc.totalCapacidad))}">${showCalc ? (conc ? "S/ 0,00 · cuadra" : money(round2(calc.totalCosto - calc.totalCPD - calc.totalCapacidad)) + " · no cuadra") : "—"}</td></tr>
        </tbody></table></div>
        ${est.run ? `<p class="muted mono" style="margin:10px 0 0">Corrida ${esc(est.run.id)} · ${fechaHora(est.run.creado_en)} · host ${esc(est.run.host)} · versión app ${esc(est.run.app_version)} · hash ${esc(est.run.params_hash)}</p>` : ""}
      </section>`;
    return this.envolverAsignacion(body, calc.bloqueos.length > 0);
  }

  envolverAsignacion(bodyP3: string, bloqP3: boolean) {
    const sub = this.st.sub.asignacion || "p3";
    const completo = this.esModeloCompleto();
    const R = completo ? this.abc() : null;
    const subs = [
      { id: "p1", label: "P1 CMD" }, { id: "p2", label: "P2 CSD" }, { id: "p3", label: "P3 CPD por persona" }, { id: "p4a", label: "P4a EC–CA" },
      { id: "p4b", label: "P4b CA–AC" }, { id: "resumen", label: "Resumen Costos AC" }, { id: "p4c", label: "P4c AC–OC" }, { id: "conciliacion", label: "Conciliación" },
    ].map((x) => (completo || x.id === "p3" ? x : { ...x, soon: "modelo completo" }));
    const acciones = completo
      ? `<button class="btn primary" data-act="run-abc">Ejecutar costeo completo</button>`
      : `<button class="btn primary" data-act="run-p3" ${bloqP3 ? "disabled" : ""}>Ejecutar etapa P3</button>`;
    const est = completo ? this.estadoABC() : null;
    const pie = est && est.run ? `<p class="muted mono" style="margin:10px 0 0">Corrida ${esc(est.run.id)} · ${fechaHora(est.run.creado_en)} · ${esc(est.run.estado)} · host ${esc(est.run.host)} · app ${esc(est.run.app_version)} · hash ${esc(est.run.params_hash)}</p>` : "";
    const cuerpo = sub === "p3" || !completo ? bodyP3 : `<section class="panel">${P2.matriz(this as any, sub)}${pie}</section>`;
    return (
      this.title("Asignación de costos — matrices ABC", "Secuencia P1 → P2 → P3 → P4a → P4b (N centros) → Resumen → P4c → objetos de costo. Clic en un importe: explicar cálculo.", acciones) +
      this.subtabs("asignacion", subs) +
      (R && R.advertencias.length && sub === "p1" ? `<div class="alert warn">${R.advertencias.map(esc).join("<br>")}</div>` : "") +
      cuerpo
    );
  }

  pReportes() {
    const c = this.ctx!;
    const completo = this.esModeloCompleto();
    const est = completo ? this.estadoABC() : null;
    const ps = MOD.periodosEmpresa(this.s, c.empresaId);
    const nRuns = this.s.one("SELECT COUNT(DISTINCT periodo_id) n FROM corrida WHERE version_id=? AND etapa='ABC'", [c.versionId])!.n;
    return (
      this.title("Reportes y exportación", "Archivos generados desde corridas reales del motor, con run_id, versión y período.") +
      this.subtabs("reportes", [{ id: "excel06", label: "Excel de resultados" }, { id: "excel07", label: "Excel de analítica" }, { id: "excel08", label: "Excel de proyecciones y EVA" }, { id: "informe", label: "Informe técnico" }, { id: "ppt", label: "Presentación ejecutiva" }]) +
      ((this.st.sub.reportes || "excel06") === "excel07" ? this.pExcel07(completo, ps.length, nRuns) : (this.st.sub.reportes || "excel06") === "excel08" ? this.pExcel08(completo) : ["informe", "ppt"].includes(this.st.sub.reportes) ? this.pInforme(completo, ps.length, nRuns, this.st.sub.reportes === "ppt") :
      `<section class="panel"><h3>Excel de resultados del costeo</h3>
      <p class="lead">Incluye portada con run_id, P1, P2, P3 por persona, P4a, una hoja P4b por cada centro participante, Resumen, P4c, costo por objeto, conciliación, saldos, tabla normalizada, resumen por período y advertencias.</p>
      ${!completo ? `<div class="alert info">Este modelo solo tiene P3 (verificación). Abre un modelo completo para exportar el Excel de resultados.</div>` : !est!.run ? `<div class="alert warn">No hay corrida para el período activo: ejecuta el costeo antes de exportar.</div>` : est!.vivo ? `<div class="alert warn">Los datos cambiaron después de la última corrida: vuelve a ejecutar el costeo para exportar cifras vigentes.</div>` : `<div class="alert ok">Se exportará la corrida ${esc(est!.run.id)} (${esc(est!.run.estado)}).</div>`}
      <div class="form-row"><button class="btn primary" data-act="exp-06" ${!completo || !est!.run || est!.vivo ? "disabled" : ""}>Generar Excel de resultados</button>
      ${ps.length > 1 ? `<button class="btn" data-act="run-abc-todos">Ejecutar costeo de los ${ps.length} períodos</button><span class="muted">Períodos con corrida: ${nRuns} de ${ps.length}</span>` : ""}</div>
      ${this.dondeExporta()}</section>`)
    );
  }
  demoModelo() {
    return this.s.one(`SELECT id, codigo FROM modelo WHERE descripcion LIKE '%(${DEMO_TAG})%' AND COALESCE(estado,'ACTIVO')<>'ARCHIVADO' ORDER BY creado_en DESC LIMIT 1`);
  }
  panelDemo(compacto = false) {
    const hay = !!document.getElementById("demo-xlsx");
    if (!hay) return "";
    const dm = this.demoModelo();
    const activo = dm && this.ctx && this.s.one("SELECT modelo_id FROM modelo_version WHERE id=?", [this.ctx.versionId])?.modelo_id === dm.id;
    const btn = this.st.demoCargando
      ? `<button class="btn primary big" disabled>Cargando demostración… ${esc(this.st.demoCargando)}</button>`
      : dm
        ? activo
          ? `<button class="btn primary big" data-act="tab" data-tab="resultados">Ver resultados de la demostración</button>`
          : `<button class="btn primary big" data-act="demo-abrir">Abrir la demostración</button>`
        : `<button class="btn primary big" data-act="demo-cargar">Cargar demostración en un clic</button>`;
    return `<section class="panel demo${compacto ? " compacto" : ""}"><div class="demo-txt"><span class="pill info">Demostración incluida</span>
      <h3>Empresa de distribución de gran escala · 24 meses</h3>
      <p class="lead">351 personas, 19 centros de actividad, 56 actividades, 47 clientes, 14 materiales y 18 elementos de costo indirecto (datos sintéticos de una empresa ficticia). El sistema importa los datos y costea los 24 meses automáticamente; después puedes recorrer todas las pestañas, simular y exportar.</p></div>
      <div class="demo-act">${btn}</div></section>`;
  }
  async cargarDemo() {
    const el = document.getElementById("demo-xlsx");
    if (!el) return;
    const paso = async (t: string) => { this.st.demoCargando = t; this.render(); await new Promise((r) => setTimeout(r, 30)); };
    try {
      await paso("leyendo los datos");
      const bytes = b64ToBytes((el.textContent || "").trim());
      const sha = await sha256Hex(bytes);
      const wb = new (ExcelJS as any).Workbook();
      await wb.xlsx.load(bytes.buffer);
      await paso("validando e importando");
      const { importarPC05 } = await import("../import/pc05");
      const P = importarPC05(wb, "Datos_Empresa_Gran_Escala.xlsx", sha);
      P.modelo.descripcion = P.modelo.descripcion + ` (${DEMO_TAG})`;
      // una demostración de una versión anterior se archiva (no se borra) para no confundirla con la actual
      for (const v of this.s.all("SELECT id FROM modelo WHERE descripcion LIKE '%(demostración incluida%' AND COALESCE(estado,'ACTIVO')<>'ARCHIVADO'")) {
        MOD.archivarModelo(this.s, v.id, true);
        const m = this.s.one("SELECT empresa_id, codigo FROM modelo WHERE id=?", [v.id]);
        let cod = `${m.codigo}-ANTERIOR`, n = 1;
        while (this.s.one("SELECT 1 x FROM modelo WHERE empresa_id=? AND codigo=? AND id<>?", [m.empresa_id, cod, v.id])) cod = `${m.codigo}-ANTERIOR-${++n}`;
        this.s.run("UPDATE modelo SET codigo=? WHERE id=?", [cod, v.id]);
      }
      MOD.guardarPaquete(this.s, P);
      const c = this.ctx!;
      const ps = MOD.periodosEmpresa(this.s, c.empresaId);
      let k = 0;
      for (const p of ps) {
        if (k % 6 === 0) await paso(`costeando ${k + 1}–${Math.min(k + 6, ps.length)} de ${ps.length} meses`);
        MOD.ejecutarABC(this.s, { ...c, periodoId: p.id }, this.s.storage.kind);
        k++;
      }
      const ult = ps[ps.length - 1];
      if (ult) UC.guardarContexto(this.s, { ...c, periodoId: ult.id });
      await paso("guardando");
      await this.s.saveNow();
      this.st.demoCargando = undefined;
      this.st.tab = "resultados";
      this.st.sub.resultados = "dashboard";
      this.toast(`Demostración cargada: ${ps.length} meses costeados y conciliados. Estás en Resultados → Dashboard.`);
    } catch (err: any) {
      this.st.demoCargando = undefined;
      this.toast("No se pudo cargar la demostración, la base no cambió: " + (err?.message || err), true);
    }
    this.render();
  }
  dondeExporta() {
    return this.s.storage.kind === "EXE" ? '<p class="muted">En el EXE el archivo se guarda en Documentos\\Costeo_Exportaciones.</p>' : '<p class="muted">En el navegador el archivo se descarga en tu carpeta de descargas.</p>';
  }
  pInforme(completo: boolean, nPer: number, nRuns: number, ppt: boolean) {
    const c = this.ctx!;
    const per = this.s.one("SELECT nombre FROM periodo WHERE id=?", [c.periodoId])?.nombre;
    const nSim = completo ? SIMAPP.ultimasPorEscenario(this.s, c).size : 0;
    const A = completo && nRuns ? R3.analitica(this as any) : null;
    const listo = !!A && A.filas.length > 0 && !A.faltantes.length && !A.desactualizados.length;
    return `<section class="panel"><h3>${ppt ? "Presentación ejecutiva (.pptx)" : "Informe técnico (.docx)"}</h3>
      <p class="lead">${ppt ? "Diapositivas para reunión: indicadores, tendencia y pronóstico, costo por canal, diagnóstico, Pareto, escenarios, propuestas con ΔEVA, EVA, cronograma y supuestos. Gráficos nativos editables en PowerPoint." : "Resumen ejecutivo, metodología, resultados del costeo, diagnóstico y hallazgos, proyección a 6 meses, relevancia, escenarios y Monte Carlo, propuestas y plan de implementación, EVA, conclusiones, supuestos y trazabilidad."} Se genera con los datos del período base <b>${esc(per)}</b> (barra gris, selector «Período»); toda cifra proviene de corridas y simulaciones guardadas.</p>
      ${!completo ? `<div class="alert info">Este modelo solo tiene P3. Abre un modelo completo.</div>` : !listo ? `<div class="alert warn">Faltan corridas vigentes (${nRuns} de ${nPer} períodos). Ejecuta el costeo de todos los períodos.</div>` : `<div class="alert ok">Listo: ${A!.filas.length} corridas vigentes${nSim ? ` y ${nSim} escenario(s) simulado(s)` : " · sin simulaciones (la sección de escenarios lo indicará)"}.</div>`}
      <div class="form-row"><button class="btn primary" data-act="${ppt ? "exp-ppt" : "exp-informe"}" ${listo ? "" : "disabled"}>${ppt ? "Generar presentación (.pptx)" : "Generar informe técnico (.docx)"}</button></div>
      ${this.dondeExporta()}</section>`;
  }
  pExcel08(completo: boolean) {
    const c = this.ctx!;
    const nSim = completo ? SIMAPP.ultimasPorEscenario(this.s, c).size : 0;
    const per = this.s.one("SELECT nombre FROM periodo WHERE id=?", [c.periodoId])?.nombre;
    return `<section class="panel"><h3>Excel de proyecciones, mejoras y EVA</h3>
      <p class="lead">Proyección a 6 meses (de la analítica), escenarios y variables, Monte Carlo (semilla, iteraciones, percentiles, histograma, convergencia), sensibilidad, comparativo, alternativas y plan con ΔEVA, y EVA base y con plan (NOPAT, WACC, capital invertido) con fórmulas visibles.</p>
      ${!completo ? `<div class="alert info">Este modelo solo tiene P3. Abre un modelo completo.</div>` : !nSim ? `<div class="alert warn">No hay simulaciones guardadas para el período base ${esc(per)}. Simula al menos un escenario en Simulación → Monte Carlo.</div>` : `<div class="alert ok">Se exportarán ${nSim} escenario(s) simulado(s) del período base ${esc(per)}.</div>`}
      <div class="form-row"><button class="btn primary" data-act="exp-08" ${completo && nSim ? "" : "disabled"}>Generar Excel de proyecciones</button></div>
      ${this.dondeExporta()}</section>`;
  }
  pExcel07(completo: boolean, nPer: number, nRuns: number) {
    const A = completo && nRuns ? R3.analitica(this as any) : null;
    const listo = !!A && A.filas.length > 0 && !A.faltantes.length && !A.desactualizados.length;
    return `<section class="panel"><h3>Excel de analítica de costos</h3>
      <p class="lead">Serie mensual con run_id, diagnóstico real vs presupuesto (efecto volumen y costo con fórmulas), regresión costo~pedidos, anomalías, pronósticos a 6 meses con backtesting, Pareto de actividades y elementos, hallazgos y propuestas con supuestos editables.</p>
      ${!completo ? `<div class="alert info">Este modelo solo tiene P3. Abre un modelo completo.</div>` : nRuns < nPer ? `<div class="alert warn">Períodos con corrida: ${nRuns} de ${nPer}. Ejecuta el costeo de todos los períodos antes de exportar.</div>` : A && A.desactualizados.length ? `<div class="alert warn">${A.desactualizados.length} corrida(s) desactualizada(s): vuelve a ejecutar el costeo de todos los períodos.</div>` : `<div class="alert ok">Se exportarán ${A ? A.filas.length : 0} corridas vigentes (${A ? esc(A.filas[0].nombre) + " – " + esc(A.ultima.nombre) : ""}).</div>`}
      <div class="form-row"><button class="btn primary" data-act="exp-07" ${listo ? "" : "disabled"}>Generar Excel de analítica</button>
      ${completo && nPer > 1 ? `<button class="btn" data-act="run-abc-todos">Ejecutar costeo de los ${nPer} períodos</button>` : ""}</div>
      ${this.dondeExporta()}</section>`;
  }

  pPlanificado(t: string) {
    const p = PLANIFICADO[t];
    const lbl = TABS.find((x) => x.id === t)!.label;
    return `${this.title(lbl, esc(p.desc))}
      <div class="empty"><h3>Módulo en preparación</h3>
      <p>Esta pestaña existe y navega correctamente; su contenido estará disponible en una próxima versión. No se muestran cifras de maqueta.</p>
      <ul style="text-align:left;display:inline-block;margin:8px auto 0">${p.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>`;
  }

  // ---------- Explicaciones ----------
  explainRate(personaId: string) {
    const p = UC.personas(this.s, this.ctx!).find((x) => x.id === personaId);
    if (!p) return;
    const tasa = p.horas > 0 ? p.costo / p.horas : null;
    this.st.drawer = `<h3>Explicar cálculo · tasa individual</h3><p class="muted">${esc(p.codigo)} · ${esc(p.nombre)} · ${esc(p.puesto)}</p>
      <div class="formula">Costo empresa = ${COMPONENTES.map((k) => esc(k.label)).join(" + ")}
= ${COMPONENTES.map((k) => num(p.comp[k.key])).join(" + ")}
= ${money(p.costo)}

Tasa = Costo empresa / Horas disponibles
     = ${num(p.costo)} / ${num(p.horas)}
     = ${tasa === null ? "no calculable (denominador cero)" : "S/ " + num(tasa, 4) + " por hora"}</div>
      <dl><dt>Unidad</dt><dd>S/ por hora del período</dd><dt>Período</dt><dd>${esc(this.s.one("SELECT nombre FROM periodo WHERE id=?", [this.ctx!.periodoId])?.nombre)}</dd>
      <dt>Fuente</dt><dd>${esc(p.fuente)} · tabla costo_persona</dd><dt>Regla</dt><dd>Costo empresa por componentes · horas contractuales del mes</dd></dl>`;
    this.render();
  }
  explainP3(personaId: string, actividadId: string) {
    const c = this.ctx!;
    const calc = UC.calcularP3(this.s, c);
    const f = calc.filas.find((x) => x.persona.id === personaId && x.actividad.id === actividadId);
    if (!f) return;
    const est = this.estadoP3();
    this.st.drawer = `<h3>Explicar cálculo · P3 CPD</h3><p class="muted">${esc(f.actividad.codigo)} ${esc(f.actividad.nombre)} ← ${esc(f.persona.codigo)} ${esc(f.persona.nombre)}</p>
      <div class="formula">Tarifa_persona = CostoEmpresa / HorasEfectivas
              = ${num(f.persona.costo)} / ${num(f.persona.horas)} = ${num(f.tasa, 4)} S/ por hora

CPD_persona,actividad = Tarifa × HorasImputadas
                      = ${num(f.tasa, 4)} × ${num(f.horas)}
                      = ${money(f.importe)}</div>
      <dl><dt>Persona (origen)</dt><dd>${esc(f.persona.codigo)} · ${esc(f.persona.nombre)}</dd><dt>Puesto</dt><dd>${esc(f.persona.puesto)} (el puesto no promedia tarifas)</dd>
      <dt>Actividad (destino)</dt><dd>${esc(f.actividad.codigo)} · ${esc(f.actividad.nombre)}</dd><dt>Centro</dt><dd>${esc(f.actividad.ca_codigo)} ${esc(f.actividad.ca_nombre)}</dd>
      <dt>Unidades</dt><dd>horas × S/ por hora = S/</dd><dt>Corrida</dt><dd class="mono">${est.run ? esc(est.run.id) : "sin corrida"}</dd>
      <dt>Estado</dt><dd>${esc(est.txt)}</dd><dt>Fuente de horas</dt><dd>tabla imputacion_horas</dd></dl>`;
    this.render();
  }
  explainLab(i: number) {
    const lab = UC.calcularLab(this.s, this.ctx!, this.st.poolId!);
    if (!lab) return;
    const d = lab.destinos[i];
    const l = lab.r.lineas[i];
    this.st.drawer = `<h3>Explicar cálculo · inductor</h3><p class="muted">${esc(lab.pool.nombre)} → ${esc(d.objeto.nombre)}</p>
      <div class="formula">Tasa de asignación = Pool / Σ cantidades
                   = ${num(lab.pool.monto)} / ${lab.r.denominador === null ? "—" : num(lab.r.denominador, 4)}
                   = ${lab.r.tasa === null ? "no calculable" : num(lab.r.tasa, 6)} ${esc(lab.r.unidadTasa)}

Costo aplicado = Tasa × cantidad del destino
               = ${lab.r.tasa === null ? "—" : num(lab.r.tasa, 6)} × ${l ? num(l.base, 4) : "—"}
               = ${l ? money(l.importe) : "—"}</div>
      <dl><dt>Inductor</dt><dd>${esc(lab.pool.inductor)} (${esc(lab.pool.unidad)})</dd><dt>Tipo de base</dt><dd>${esc(lab.pool.tipo_base)}</dd>
      <dt>Estado del valor</dt><dd>${esc(d.base?.estado_valor || "PENDIENTE")}</dd><dt>Método / fuente</dt><dd>${esc(d.base?.metodo || "—")}</dd>
      <dt>Redondeo</dt><dd>Céntimos con ajuste de mayor residuo; Σ asignado + saldo = pool</dd></dl>`;
    this.render();
  }

  // ---------- eventos ----------
  async onClick(e: Event) {
    const el = (e.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
    if (!el) return;
    const a = el.dataset.act!;
    const c = this.ctx;
    if (a === "tab") {
      this.st.tab = el.dataset.tab!;
      this.st.drawer = null;
      this.render();
      (this.root.querySelector("#main") as HTMLElement)?.focus();
      return;
    }
    if (a === "nav-left" || a === "nav-right") {
      this.root.querySelector("#navscroll")?.scrollBy({ left: a === "nav-left" ? -300 : 300, behavior: "smooth" });
      return;
    }
    if (a === "sub") {
      this.st.sub[el.dataset.key!] = el.dataset.sub!;
      this.render();
      return;
    }
    if (a === "close-drawer") {
      this.st.drawer = null;
      this.render();
      return;
    }
    if (a === "demo-cargar") return this.cargarDemo();
    if (a === "demo-abrir") {
      const dm = this.demoModelo();
      if (dm) await this.mutate(() => MOD.activarModelo(this.s, dm.id));
      this.st.tab = "resultados"; this.st.sub.resultados = "dashboard"; this.render();
      return;
    }
    if (a === "seed") return this.mutate(() => UC.cargarVerificacionI1(this.s), "Datos de verificación cargados (sintéticos).");
    if (a === "run-p3" && c) {
      try {
        const { runId } = UC.ejecutarP3(this.s, c, this.s.storage.kind);
        await this.s.saveNow();
        this.toast(`Etapa P3 ejecutada y guardada: ${runId}`);
      } catch (err: any) {
        this.toast(err.message, true);
      }
      this.render();
      return;
    }
    if (a === "new-person" && c) {
      const nombre = (this.root.querySelector("#np-nombre") as HTMLInputElement).value.trim();
      const puesto = (this.root.querySelector("#np-puesto") as HTMLSelectElement).value;
      const horas = parseNum((this.root.querySelector("#np-horas") as HTMLInputElement).value);
      if (!nombre) return this.toast("Escribe el nombre de la persona.", true);
      if (horas === null || Number.isNaN(horas) || horas < 0) return this.toast("Horas disponibles inválidas.", true);
      return this.mutate(() => UC.nuevaPersona(this.s, c, nombre, puesto, horas), `Persona «${nombre}» agregada. Completa sus componentes de costo.`);
    }
    if (a === "del-person" && c) {
      const p = UC.personas(this.s, c).find((x) => x.id === el.dataset.id);
      if (!p) return;
      if (!confirm(`¿Eliminar a ${p.codigo} ${p.nombre}? Se borrarán sus horas imputadas. Las corridas ya guardadas conservan su historial.`)) return;
      return this.mutate(() => UC.eliminarPersona(this.s, p.id), "Persona eliminada.");
    }
    if (a === "new-activity" && c) {
      const nombre = (this.root.querySelector("#na-nombre") as HTMLInputElement).value.trim();
      const centro = (this.root.querySelector("#na-centro") as HTMLSelectElement).value;
      if (!nombre) return this.toast("Escribe el nombre de la actividad.", true);
      return this.mutate(() => UC.nuevaActividad(this.s, c, nombre, centro), "Actividad agregada: ya aparece como columna en la matriz de horas.");
    }
    if (a === "new-object" && c) {
      const nombre = (this.root.querySelector("#no-nombre") as HTMLInputElement).value.trim();
      const mag = (this.root.querySelector("#no-mag") as HTMLInputElement).value.trim();
      if (!nombre) return this.toast("Escribe el nombre del objeto de costo.", true);
      return this.mutate(() => UC.nuevoObjeto(this.s, c, nombre, mag), "Objeto agregado: su cantidad queda Pendiente hasta registrarla.");
    }
    if (a === "run-abc" && c) {
      try {
        const { runId, R } = MOD.ejecutarABC(this.s, c, this.s.storage.kind);
        try { if (!UC.calcularP3(this.s, c).bloqueos.length) UC.ejecutarP3(this.s, c, this.s.storage.kind); } catch {}
        await this.s.saveNow();
        this.toast(`Costeo ejecutado y guardado: ${runId} · ${R.cuadra ? "concilia" : "NO concilia"}${R.bloqueos.length ? " · con bloqueos (ver detalle)" : ""}`, !R.cuadra);
      } catch (err: any) {
        this.toast(err.message, true);
      }
      this.render();
      return;
    }
    if (a === "exp-06" && c) {
      try {
        const r = await exportar06(ExcelJS, this.s, c);
        const where = await this.s.storage.exportFile(r.nombre, r.bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        this.s.scheduleSave();
        this.toast(`Excel de resultados generado (${r.hojas.length} hojas): ${where}`);
      } catch (err: any) {
        this.toast(err.message, true);
      }
      return;
    }
    if (a === "sim-crear-base" && c) return this.mutate(() => SIMAPP.crearEscenario(this.s, c, "Base"), "Escenario «Base» creado con «Volumen de pedidos» en 1; define sus variables en «Variables».");
    if (a === "sim-crear" && c) {
      const nombre = (this.root.querySelector("#sim-nuevo") as HTMLInputElement).value;
      return this.mutate(() => { SIMAPP.crearEscenario(this.s, c, nombre, "Base"); (this.st as any).simEsc = nombre.trim(); }, `Escenario «${nombre.trim()}» creado como copia de Base; ya es el escenario activo.`);
    }
    if (a === "sim-duplicar" && c) {
      const de = el.dataset.esc!;
      const nombre = prompt(`Nombre del escenario duplicado de «${de}»:`, `${de} (copia)`);
      if (!nombre) return;
      return this.mutate(() => { SIMAPP.crearEscenario(this.s, c, nombre, de); (this.st as any).simEsc = nombre.trim(); }, `Escenario duplicado; «${nombre.trim()}» es el escenario activo.`);
    }
    if (a === "sim-usar") { (this.st as any).simEsc = el.dataset.esc; this.render(); return; }
    if (a === "sim-agregar" && c) {
      const v = (this.root.querySelector("#sim-addvar") as HTMLSelectElement).value;
      return this.mutate(() => SIMAPP.agregarVariable(this.s, c, (this.st as any).simEsc, v), "Variable agregada con factor 1; 1; 1 (sin efecto hasta que la edites).");
    }
    if (a === "sim-quitar" && c) return this.mutate(() => SIMAPP.quitarVariable(this.s, c, (this.st as any).simEsc, el.dataset.v!), "Variable quitada del escenario.");
    if (a === "sim-cancelar") { this.simCancel = true; return; }
    if (a === "sim-correr" && c) {
      if (this.simEstado) return;
      const entero = (id: string) => Number(((this.root.querySelector(id) as HTMLInputElement).value || "").replace(/[.\s]/g, ""));
      const semilla = entero("#sim-semilla"), iter = entero("#sim-iter");
      (this.st as any).simSemilla = semilla;
      (this.st as any).simIter = iter;
      let prep: SIMAPP.PreparacionSim;
      try {
        prep = SIMAPP.prepararSimulacion(this.s, c, (this.st as any).simEsc || "Base", semilla, iter);
      } catch (err: any) {
        return this.toast(err.message, true);
      }
      this.simCancel = false;
      this.simEstado = { pct: 0, esc: prep.esc, n: 0, total: iter };
      this.render();
      const paso = async () => {
        if (this.simCancel) {
          this.simEstado = null;
          this.toast("Simulación cancelada: no se guardó ningún resultado; los datos y las corridas no cambiaron.");
          this.render();
          return;
        }
        const t0 = performance.now();
        while (performance.now() - t0 < 45 && !prep.sim.terminado) prep.sim.paso(10);
        const n = prep.sim.muestras.length;
        this.simEstado = { pct: (100 * n) / iter, esc: prep.esc, n, total: iter };
        const bar = this.root.querySelector("#sim-bar") as HTMLElement | null, txt = this.root.querySelector("#sim-txt");
        if (bar) bar.style.width = this.simEstado.pct + "%";
        if (txt) txt.textContent = `Simulando «${prep.esc}»: ${n} de ${iter} iteraciones. El resultado se guarda solo al terminar.`;
        if (prep.sim.terminado) {
          try {
            const g = SIMAPP.guardarSimulacion(this.s, c, prep);
            await this.s.saveNow();
            this.toast(`Simulación ${g.id} guardada: ${iter} iteraciones en ${fmtSeg(g.ms)} s.`);
          } catch (err: any) {
            this.toast(err.message, true);
          }
          this.simEstado = null;
          this.render();
          return;
        }
        setTimeout(paso, 0);
      };
      setTimeout(paso, 0);
      return;
    }
    if ((a === "exp-informe" || a === "exp-ppt") && c) {
      try {
        const r = a === "exp-ppt" ? await exportarPresentacion(this.s, c, (this.st as any).propPct || {}) : await exportarInformeDocx(this.s, c, (this.st as any).propPct || {});
        const mime = a === "exp-ppt" ? "application/vnd.openxmlformats-officedocument.presentationml.presentation" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        const where = await this.s.storage.exportFile(r.nombre, r.bytes, mime);
        this.s.audit(a === "exp-ppt" ? "EXPORTAR_PRESENTACION" : "EXPORTAR_INFORME", "modelo_version", c.versionId, null, { archivo: r.nombre });
        this.s.scheduleSave();
        this.toast(`${a === "exp-ppt" ? "Presentación" : "Informe técnico"} generado: ${where}`);
      } catch (err: any) {
        this.toast(err.message, true);
      }
      return;
    }
    if (a === "exp-08" && c) {
      try {
        const r = await exportar08(ExcelJS, this.s, c, (this.st as any).propPct || {});
        const where = await this.s.storage.exportFile(r.nombre, r.bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        this.s.audit("EXPORTAR_08", "modelo_version", c.versionId, null, { archivo: r.nombre, simulaciones: r.simulaciones });
        this.s.scheduleSave();
        this.toast(`Excel de proyecciones generado (${r.hojas.length} hojas, ${r.simulaciones} simulaciones): ${where}`);
      } catch (err: any) {
        this.toast(err.message, true);
      }
      return;
    }
    if (a === "exp-07" && c) {
      try {
        const r = await exportar07(ExcelJS, this.s, c, (this.st as any).propPct || {});
        const where = await this.s.storage.exportFile(r.nombre, r.bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        this.s.audit("EXPORTAR_07", "modelo_version", c.versionId, null, { archivo: r.nombre, corridas: r.runs });
        this.s.scheduleSave();
        this.toast(`Excel de analítica generado (${r.hojas.length} hojas, ${r.runs} corridas): ${where}`);
      } catch (err: any) {
        this.toast(err.message, true);
      }
      return;
    }
    if (a === "run-abc-todos" && c) {
      const ps = MOD.periodosEmpresa(this.s, c.empresaId);
      let ok = 0, nc = 0;
      try {
        for (const p of ps) {
          const cc = { ...c, periodoId: p.id };
          const { R } = MOD.ejecutarABC(this.s, cc, this.s.storage.kind);
          ok++;
          if (!R.cuadra) nc++;
        }
        await this.s.saveNow();
        this.toast(`Costeo ejecutado en ${ok} períodos${nc ? ` · ${nc} no concilian` : " · todos concilian"}.`, nc > 0);
      } catch (err: any) {
        this.toast(err.message, true);
      }
      this.render();
      return;
    }
    if (a === "m2-activar") return this.mutate(() => MOD.activarModelo(this.s, el.dataset.id!), "Modelo abierto.");
    if (a === "m2-clonar") {
      const m = this.s.one("SELECT * FROM modelo WHERE id=?", [el.dataset.id]);
      const nombre = prompt("Nombre del modelo clonado:", `Copia de ${m?.nombre}`);
      if (!nombre) return;
      return this.mutate(() => { const id = MOD.clonarModelo(this.s, el.dataset.id!, nombre); MOD.activarModelo(this.s, id); }, "Modelo clonado e independiente del original; ya está activo.");
    }
    if (a === "m2-archivar") return this.mutate(() => MOD.archivarModelo(this.s, el.dataset.id!, el.dataset.v === "1"), el.dataset.v === "1" ? "Modelo archivado (no se borró nada)." : "Modelo reactivado.");
    if (a === "comp-abrir") {
      await this.mutate(() => MOD.activarModelo(this.s, el.dataset.id!));
      this.st.tab = "modelo"; this.st.sub.modelo = "comparacion"; this.render();
      return;
    }
    if (a === "m2-lab") {
      this.st.reglaId = el.dataset.id;
      this.st.sub.inductores = "laboratorio";
      this.render();
      return;
    }
    if (a === "m2-exp") {
      this.st.drawer = P2.explicar(this as any, el.dataset.et!, el.dataset.o!, el.dataset.d!, el.dataset.c);
      this.render();
      return;
    }
    if (a === "m2-exp-res") {
      this.st.drawer = P2.explicarResumen(this as any, el.dataset.a!);
      this.render();
      return;
    }
    if (a === "m2-exp-p1" && c) {
      const R = this.abc()!;
      const x = R.p1.find((z) => z.actividadId === el.dataset.a && z.materialId === el.dataset.m)!;
      const u = R.unitMat.get(x.materialId)!;
      const m = this.s.one("SELECT * FROM material WHERE id=?", [x.materialId]);
      this.st.drawer = `<h3>Explicar cálculo · P1 CMD</h3><p class="muted">${esc(m.nombre)}</p><div class="formula">Costo unitario = ${esc(u.formula)}
               = ${num(u.costoUnit, 6)} S/ por ${esc(m.unidad_consumo)}

Costo = cantidad × costo unitario
      = ${num(x.cantidad)} × ${num(u.costoUnit, 6)} = ${money(x.importe)}</div><dl><dt>Fuente del material</dt><dd class="mono" style="font-size:11.5px">${esc(m.fuente || "")}</dd><dt>IGV</dt><dd>${m.incluye_igv ? (m.igv_recuperable ? "excluido (recuperable)" : "incluido (no recuperable)") : "precio sin IGV"}${u.pendiente ? " · tratamiento pendiente de validación" : ""}</dd></dl>`;
      this.render();
      return;
    }
    if (a === "m2-srv-add" && c) {
      const g = (id: string) => (this.root.querySelector("#" + id) as HTMLInputElement).value.trim();
      const cant = parseNum(g("sd-cant")), tar = parseNum(g("sd-tar"));
      if (!g("sd-serv")) return this.toast("Escribe el servicio.", true);
      if (cant === null || Number.isNaN(cant) || tar === null || Number.isNaN(tar)) return this.toast("Cantidad y tarifa deben ser números.", true);
      return this.mutate(() => {
        this.s.run("INSERT INTO servicio_directo(id,version_id,periodo_id,actividad_id,proveedor,servicio,cantidad,unidad,tarifa,documento,fuente) VALUES(?,?,?,?,?,?,?,?,?,?,'MANUAL')", ["sd_" + Date.now().toString(36), c.versionId, c.periodoId, g("sd-act"), g("sd-prov"), g("sd-serv"), cant, g("sd-uni"), tar, g("sd-doc")]);
        this.s.audit("CREAR_SERVICIO_DIRECTO", "servicio_directo", g("sd-serv"), null, { cant, tar });
      }, "Servicio directo agregado a P2.");
    }
    if (a === "m2-srv-del") {
      if (!confirm("¿Eliminar este servicio directo?")) return;
      return this.mutate(() => { this.s.run("DELETE FROM servicio_directo WHERE id=?", [el.dataset.id]); this.s.audit("ELIMINAR_SERVICIO_DIRECTO", "servicio_directo", el.dataset.id!, null, null); }, "Servicio eliminado.");
    }
    if (a === "explain-rate") return this.explainRate(el.dataset.id!);
    if (a === "explain-p3") return this.explainP3(el.dataset.p!, el.dataset.a!);
    if (a === "explain-lab") return this.explainLab(Number(el.dataset.i));
    if (a === "backup") {
      try {
        await this.s.saveNow();
        const d = new Date();
        const p = (x: number) => String(x).padStart(2, "0");
        const nombre = `Costeo_respaldo_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.sqlite`;
        const where = await this.s.storage.exportFile(nombre, this.s.export(), "application/vnd.sqlite3");
        this.s.audit("RESPALDAR_BASE", "base", "-", null, { archivo: nombre });
        this.s.scheduleSave();
        this.toast("Respaldo generado: " + where);
      } catch (err: any) {
        this.toast("No se pudo respaldar: " + err.message, true);
      }
      return;
    }
    if (a === "diag") {
      const counts = this.s.counts();
      const ic = this.s.one("PRAGMA integrity_check") as any;
      const fk = this.s.all("PRAGMA foreign_key_check");
      const meta = this.s.all("SELECT * FROM meta WHERE clave<>'ctx'");
      const aud = this.s.all("SELECT * FROM auditoria ORDER BY id DESC LIMIT 12");
      this.st.drawer = `<h3>Diagnóstico del sistema</h3>
        <dl><dt>Versión de la aplicación</dt><dd>${esc(APP_VERSION)}</dd><dt>Variante</dt><dd>${esc(this.s.storage.kind)}</dd>
        <dt>Almacenamiento</dt><dd>${esc(this.storageDesc)}</dd><dt>Integridad SQLite</dt><dd>${esc(Object.values(ic || {})[0])}</dd>
        <dt>Referencias rotas</dt><dd>${fk.length}</dd>${meta.map((m) => `<dt>${esc(m.clave)}</dt><dd>${esc(m.valor)}</dd>`).join("")}
        <dt>Agente del navegador</dt><dd style="font-size:11px">${esc(navigator.userAgent)}</dd></dl>
        <h3 style="font-size:14px">Registros por tabla</h3><div class="formula">${counts.map((x) => `${x.tabla.padEnd(20)} ${x.n}`).join("\n")}</div>
        <h3 style="font-size:14px;margin-top:14px">Últimos eventos de auditoría</h3><div class="formula" style="font-size:11px">${aud.map((x) => `${fechaHora(x.ts)}  ${esc(x.accion)}  ${esc(x.entidad)}`).join("\n") || "sin eventos"}</div>`;
      this.render();
      return;
    }
    if (a === "about") {
      this.st.drawer = `<h3>Acerca de</h3><p style="font-weight:600;line-height:1.5">${esc(NOMBRE_OFICIAL)}</p>
        <dl><dt>Autor</dt><dd>César Alonso Dionicio Achachagua</dd><dt>Versión</dt><dd>${esc(APP_VERSION)}</dd><dt>Variante</dt><dd>${this.s.storage.kind === "EXE" ? "Aplicación de escritorio (Windows)" : "Aplicación offline (navegador)"}</dd>
        <dt>Construcción</dt><dd>Desarrollo asistido por IA (Claude) bajo dirección y control de calidad del autor</dd>
        <dt>Componentes</dt><dd>SQLite (sql.js, MIT) · WebView2 (Microsoft, solo EXE) · go-webview2 (MIT, solo EXE)</dd>
        <dt>Red</dt><dd>No usa internet ni motores de búsqueda; todo está incluido en el archivo</dd></dl>`;
      this.render();
      return;
    }
  }

  async onChange(e: Event) {
    const el = e.target as HTMLInputElement;
    const k = el.dataset.edit;
    if (!k) return;
    const c = this.ctx;
    if (k === "sim-esc") {
      (this.st as any).simEsc = el.value;
      this.render();
      return;
    }
    if (k === "sim-var" && c) {
      const v = parseNum(el.value);
      if (v === null || Number.isNaN(v)) return this.toast("Factor inválido.", true), this.render();
      return this.mutate(() => SIMAPP.setVariable(this.s, c, (this.st as any).simEsc, el.dataset.v!, el.dataset.f as any, v), "Variable actualizada; vuelve a simular para ver el efecto.");
    }
    if (k === "res-serie") {
      (this.st as any).resSerie = Number(el.value);
      this.render();
      return;
    }
    if (k === "prop-pct") {
      const v = parseNum(el.value);
      if (v === null || Number.isNaN(v) || v < 0 || v > 100) return this.toast("Porcentaje entre 0 y 100.", true), this.render();
      (this.st as any).propPct = { ...((this.st as any).propPct || {}), [el.dataset.id!]: v / 100 };
      this.render();
      return;
    }
    if (k === "restore") {
      const f = el.files?.[0];
      if (!f) return;
      if (!confirm(`¿Restaurar «${f.name}»? Reemplazará la base actual. Te recomiendo respaldar antes.`)) return;
      try {
        await this.s.restore(new Uint8Array(await f.arrayBuffer()));
        this.toast("Respaldo restaurado y verificado (integridad y referencias).");
      } catch (err: any) {
        this.toast("Restauración rechazada, la base actual no cambió: " + err.message, true);
      }
      this.render();
      return;
    }
    if (k === "m2-import-profesor" || k === "m2-import-pc05") {
      const f = el.files?.[0];
      if (!f) return;
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const sha = await sha256Hex(bytes);
        const wb = new (ExcelJS as any).Workbook();
        await wb.xlsx.load(bytes.buffer);
        let P: any;
        if (k === "m2-import-profesor") P = importarProfesor(wb, f.name, sha);
        else {
          const { importarPC05 } = await import("../import/pc05");
          P = importarPC05(wb, f.name, sha);
        }
        MOD.guardarPaquete(this.s, P);
        await this.s.saveNow();
        this.st.sub.modelo = "gestion";
        this.toast(`Modelo ${P.modelo.codigo} importado de «${f.name}» con ${P.advertencias.length} advertencias. Ya está activo: ejecuta el costeo en Asignación.`);
      } catch (err: any) {
        this.toast("Importación rechazada, la base no cambió: " + (err?.message || err), true);
      }
      el.value = "";
      this.render();
      return;
    }
    if (k === "ctx-modelo") return this.mutate(() => MOD.activarModelo(this.s, el.value));
    if (!c) return;
    if (k === "ctx-periodo") return this.mutate(() => UC.guardarContexto(this.s, { ...c, periodoId: el.value }));
    if (k === "m2-centro-part") return this.mutate(() => { const prev = this.s.one("SELECT participacion FROM centro WHERE id=?", [el.dataset.id]); this.s.run("UPDATE centro SET participacion=? WHERE id=?", [el.value, el.dataset.id]); this.s.audit("EDITAR_PARTICIPACION_CENTRO", "centro", el.dataset.id!, prev, { participacion: el.value }); }, "Participación actualizada; vuelve a ejecutar el costeo.");
    if (k === "m2-centro-pct" || k === "m2-act-pct") {
      const v = parseNum(el.value);
      if (v === null || Number.isNaN(v) || v < 0 || v > 100) return this.toast("Porcentaje entre 0 y 100.", true), this.render();
      const t = k === "m2-centro-pct" ? ["centro", "pct_participacion"] : ["actividad", "pct_alcance"];
      return this.mutate(() => { this.s.run(`UPDATE ${t[0]} SET ${t[1]}=? WHERE id=?`, [v / 100, el.dataset.id]); this.s.audit("EDITAR_PORCENTAJE_ALCANCE", t[0], el.dataset.id!, null, { pct: v }); });
    }
    if (k === "m2-act-alc") return this.mutate(() => { const prev = this.s.one("SELECT alcance FROM actividad WHERE id=?", [el.dataset.id]); this.s.run("UPDATE actividad SET alcance=? WHERE id=?", [el.value, el.dataset.id]); this.s.audit("EDITAR_ALCANCE_ACTIVIDAD", "actividad", el.dataset.id!, prev, { alcance: el.value }); }, "Alcance actualizado; vuelve a ejecutar el costeo.");
    if (k === "m2-act-clase") return this.mutate(() => { this.s.run("UPDATE actividad SET clase_valor=? WHERE id=?", [el.value || null, el.dataset.id]); this.s.audit("EDITAR_CLASE_ACTIVIDAD", "actividad", el.dataset.id!, null, { clase: el.value }); });
    if (k === "m2-mat-num") {
      const v = parseNum(el.value);
      if (v === null || Number.isNaN(v) || v < 0 || (el.dataset.f !== "costo_factura" && v === 0)) return this.toast("Valor inválido.", true), this.render();
      const f = el.dataset.f!;
      if (!["costo_factura", "cantidad_factura", "equivalencia"].includes(f)) return;
      return this.mutate(() => { const prev = this.s.one(`SELECT ${f} v FROM material WHERE id=?`, [el.dataset.id]); this.s.run(`UPDATE material SET ${f}=?, fuente=COALESCE(fuente,'')||' · editado' WHERE id=?`, [v, el.dataset.id]); this.s.audit("EDITAR_MATERIAL", "material", el.dataset.id!, prev, { [f]: v }); });
    }
    if (k === "m2-mat-flag") {
      const f = el.dataset.f!;
      if (!["incluye_igv", "igv_recuperable", "tratamiento_validado"].includes(f)) return;
      return this.mutate(() => { this.s.run(`UPDATE material SET ${f}=? WHERE id=?`, [Number(el.value), el.dataset.id]); this.s.audit("EDITAR_TRATAMIENTO_IGV", "material", el.dataset.id!, null, { [f]: el.value }); });
    }
    if (k === "m2-ec-monto") {
      const v = parseNum(el.value);
      if (v === null || Number.isNaN(v) || v < 0) return this.toast("Monto inválido.", true), this.render();
      return this.mutate(() => { this.s.run("INSERT INTO ec_monto(ec_id,periodo_id,monto,fuente) VALUES(?,?,?,'MANUAL') ON CONFLICT(ec_id,periodo_id) DO UPDATE SET monto=excluded.monto, fuente='MANUAL'", [el.dataset.id, c.periodoId, v]); this.s.audit("EDITAR_MONTO_EC", "ec_monto", el.dataset.id!, null, { monto: v }); });
    }
    if (k === "m2-obj-cant") {
      const v = parseNum(el.value);
      if (v !== null && (Number.isNaN(v) || v < 0)) return this.toast("Cantidad inválida.", true), this.render();
      return this.mutate(() => { this.s.run("INSERT INTO objeto_magnitud(objeto_id,periodo_id,cantidad,fuente) VALUES(?,?,?,'MANUAL') ON CONFLICT(objeto_id,periodo_id) DO UPDATE SET cantidad=excluded.cantidad, fuente='MANUAL'", [el.dataset.id, c.periodoId, v]); this.s.audit("EDITAR_MAGNITUD_OBJETO", "objeto_magnitud", el.dataset.id!, null, { cantidad: v }); });
    }
    if (k === "m2-igv") {
      const v = parseNum(el.value);
      if (v === null || Number.isNaN(v) || v < 0 || v >= 100) return this.toast("Tasa de IGV inválida.", true), this.render();
      return this.mutate(() => { this.s.run("UPDATE empresa SET igv_tasa=? WHERE id=?", [v / 100, c.empresaId]); this.s.audit("EDITAR_IGV", "empresa", c.empresaId, null, { igv: v }); }, "Tasa de IGV actualizada.");
    }
    if (k === "m2-p4b-centro") { this.st.sub.p4bCentro = el.value; this.render(); return; }
    if (k === "lab-regla") { this.st.reglaId = el.value; this.render(); return; }
    if (k === "horas-centro") { this.st.sub.horasCentro = el.value; this.render(); return; }
    if (k === "m2-regla-ind" || k === "m2-regla-uni") {
      const f = k === "m2-regla-ind" ? "inductor" : "unidad";
      return this.mutate(() => { this.s.run(`UPDATE regla_reparto SET ${f}=? WHERE id=?`, [el.value.trim(), el.dataset.id]); this.s.audit("EDITAR_REGLA", "regla_reparto", el.dataset.id!, null, { [f]: el.value }); });
    }
    if (k === "m2-regla-tipo") {
      const j = (this.root.querySelector("#rj-" + el.dataset.id) as HTMLInputElement)?.value.trim() || "";
      if (j.length < 10) {
        this.toast("Para cambiar el tipo de base escribe primero la justificación (mín. 10 caracteres).", true);
        this.render();
        return;
      }
      return this.mutate(() => { const prev = this.s.one("SELECT tipo_base FROM regla_reparto WHERE id=?", [el.dataset.id]); this.s.run("UPDATE regla_reparto SET tipo_base=? WHERE id=?", [el.value, el.dataset.id]); this.s.audit("CAMBIAR_TIPO_BASE", "regla_reparto", el.dataset.id!, prev, { tipo_base: el.value, justificacion: j }); }, "Tipo de base cambiado y registrado en auditoría con su justificación.");
    }
    if (k === "m2-vb-valor" || k === "m2-vb-estado" || k === "m2-vb-metodo") {
      const r = el.dataset.r!, d = el.dataset.d!;
      const prev = this.s.one("SELECT * FROM valor_base WHERE regla_id=? AND destino_id=? AND periodo_id=?", [r, d, c.periodoId]);
      let campo = "metodo", v: any = el.value.trim();
      if (k === "m2-vb-valor") {
        campo = "valor";
        v = parseNum(el.value);
        if (v !== null && (Number.isNaN(v) || v < 0)) return this.toast("Valor inválido.", true), this.render();
      } else if (k === "m2-vb-estado") campo = "estado_valor";
      return this.mutate(() => {
        if (!prev) this.s.run("INSERT INTO valor_base(id,regla_id,destino_id,periodo_id,valor,estado_valor,fuente) VALUES(?,?,?,?,NULL,'PENDIENTE','MANUAL')", ["vb_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), r, d, c.periodoId]);
        this.s.run(`UPDATE valor_base SET ${campo}=? WHERE regla_id=? AND destino_id=? AND periodo_id=?`, [v, r, d, c.periodoId]);
        if (campo === "valor") this.s.run("UPDATE valor_base SET estado_valor=CASE WHEN ? IS NULL THEN 'PENDIENTE' WHEN estado_valor='REAL' AND ? THEN 'AJUSTADO' WHEN estado_valor='PENDIENTE' THEN 'REAL' ELSE estado_valor END, fuente=COALESCE(fuente,'')||' · editado' WHERE regla_id=? AND destino_id=? AND periodo_id=?", [v, prev && prev.valor !== v ? 1 : 0, r, d, c.periodoId]);
        this.s.audit("EDITAR_VALOR_INDUCTOR", "valor_base", r + "|" + d, prev ? { valor: prev.valor, estado: prev.estado_valor } : null, { [campo]: v });
      });
    }
    if (k === "person-name") {
      const v = el.value.trim();
      if (!v) return this.toast("El nombre no puede quedar vacío.", true), this.render();
      return this.mutate(() => UC.renombrarPersona(this.s, el.dataset.id!, v));
    }
    if (k === "cost") {
      const v = parseNum(el.value);
      if (v === null || Number.isNaN(v) || v < 0) return this.toast("Valor inválido: usa un número ≥ 0 (formato 4.200,00).", true), this.render();
      return this.mutate(() => UC.setCostoCampo(this.s, el.dataset.id!, el.dataset.field!, v));
    }
    if (k === "hours") {
      const v = parseNum(el.value);
      if (v !== null && (Number.isNaN(v) || v < 0)) return this.toast("Horas inválidas: usa un número ≥ 0.", true), this.render();
      return this.mutate(() => UC.setImputacion(this.s, c, el.dataset.p!, el.dataset.a!, v));
    }
    if (k === "authorize") {
      const row = el.closest("tr")!;
      const just = (row.querySelector('[data-edit="justify"]') as HTMLInputElement).value.trim();
      if (el.checked && just.length < 10) {
        el.checked = false;
        return this.toast("Para autorizar escribe primero una justificación (mínimo 10 caracteres).", true);
      }
      return this.mutate(() => UC.setAutorizacion(this.s, el.dataset.id!, el.checked, just), el.checked ? "Sobreimputación autorizada y registrada en auditoría." : "Autorización retirada.");
    }
    if (k === "justify") {
      const row = el.closest("tr")!;
      const chk = row.querySelector('[data-edit="authorize"]') as HTMLInputElement;
      return this.mutate(() => UC.setAutorizacion(this.s, el.dataset.id!, chk.checked && el.value.trim().length >= 10, el.value.trim()));
    }
    if (k === "pool-select") {
      this.st.poolId = el.value;
      this.render();
      return;
    }
    if (k === "pool-monto") {
      const v = parseNum(el.value);
      if (v === null || Number.isNaN(v) || v < 0) return this.toast("Monto inválido.", true), this.render();
      return this.mutate(() => UC.setPoolCampo(this.s, this.st.poolId!, "monto", v));
    }
    if (k === "pool-tipo") return this.mutate(() => UC.setTipoInductor(this.s, this.st.poolId!, el.value as TipoBase));
    if (k === "base-valor") {
      const v = parseNum(el.value);
      if (v !== null && (Number.isNaN(v) || v < 0)) return this.toast("Cantidad inválida.", true), this.render();
      return this.mutate(() => UC.setBase(this.s, this.st.poolId!, el.dataset.o!, "valor", v));
    }
    if (k === "base-estado") return this.mutate(() => UC.setBase(this.s, this.st.poolId!, el.dataset.o!, "estado_valor", el.value));
    if (k === "base-metodo") return this.mutate(() => UC.setBase(this.s, this.st.poolId!, el.dataset.o!, "metodo", el.value.trim()));
  }
}

export { bytesToB64 };
