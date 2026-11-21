// Exportación del entregable 06_Resultados_Sistema.xlsx desde una corrida real del motor.
// Vistas matriciales compatibles con los Excel de referencia + hojas normalizadas para auditoría.
import { Store, APP_VERSION } from "../db/store";
import { Contexto } from "./usecases";
import { cargarInput, ultimaCorridaABC, periodosEmpresa } from "./modelos";
import { costearModelo, ResultadoModelo } from "../domain/motor";
import { NOMBRE_OFICIAL_EXPORT } from "./nombres";

const FMT_S = '#,##0.00;[Red]-#,##0.00';
const FMT_N = '#,##0.00;[Red]-#,##0.00';
const FMT_T = '#,##0.000000;[Red]-#,##0.000000';

function colL(c: number) {
  let s = "";
  while (c > 0) {
    const m = (c - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    c = Math.floor((c - 1) / 26);
  }
  return s;
}

export interface Export06Info { nombre: string; bytes: Uint8Array; hojas: string[]; runId: string }

export async function exportar06(ExcelJS: any, s: Store, c: Contexto, incluirPeriodos = true): Promise<Export06Info> {
  const run = ultimaCorridaABC(s, c);
  if (!run) throw new Error("No hay corrida de costeo para este modelo y período. Ejecuta el costeo antes de exportar (no se exportan datos sin calcular).");
  const inp = cargarInput(s, c);
  const R: ResultadoModelo = costearModelo(inp);
  const emp = s.one("SELECT * FROM empresa WHERE id=?", [c.empresaId])!;
  const mod = s.one("SELECT * FROM modelo WHERE id=?", [c.modeloId])!;
  const ver = s.one("SELECT * FROM modelo_version WHERE id=?", [c.versionId])!;
  const per = s.one("SELECT * FROM periodo WHERE id=?", [c.periodoId])!;
  const ori = s.one("SELECT * FROM modelo_origen WHERE modelo_id=?", [c.modeloId]);
  const nm = new Map<string, any>();
  for (const t of ["centro", "actividad", "objeto_costo", "elemento_costo", "material", "persona"]) for (const r of s.all(`SELECT id, codigo, nombre FROM ${t} WHERE version_id=?`, [c.versionId])) nm.set(r.id, r);
  const wb = new ExcelJS.Workbook();
  wb.creator = NOMBRE_OFICIAL_EXPORT;
  wb.created = new Date();
  wb.calcProperties = { fullCalcOnLoad: true };
  const cab = (ws: any, titulo: string, nota = "") => {
    ws.getCell("A1").value = titulo;
    ws.getCell("A1").font = { bold: true, size: 13, color: { argb: "FF1D2E50" } };
    ws.getCell("A2").value = `Modelo ${mod.codigo} · ${mod.nombre} · v${ver.numero} · Período ${per.nombre} · Corrida ${run.id} · ${new Date(run.creado_en).toLocaleString("es-PE")}${emp.sintetico ? " · DATOS SINTÉTICOS" : ""}`;
    ws.getCell("A2").font = { size: 9, color: { argb: "FF5B6B88" } };
    if (nota) {
      ws.getCell("A3").value = nota;
      ws.getCell("A3").font = { italic: true, size: 9, color: { argb: "FF5B6B88" } };
    }
  };
  const encabezado = (ws: any, fila: number, cols: string[], desde = 1) => {
    cols.forEach((t, i) => {
      const cell = ws.getCell(fila, desde + i);
      cell.value = t;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6554C8" } };
      cell.alignment = { wrapText: true, vertical: "middle" };
      cell.border = { bottom: { style: "thin", color: { argb: "FFDFE4F0" } } };
    });
    ws.getRow(fila).height = 32;
  };
  const totalFila = (ws: any, fila: number) => {
    ws.getRow(fila).font = { bold: true };
    ws.getRow(fila).eachCell((cl: any) => (cl.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F2FA" } }));
  };
  const anchos = (ws: any, w: number[]) => w.forEach((x, i) => (ws.getColumn(i + 1).width = x));
  const hojas: string[] = [];
  const nueva = (n: string) => {
    hojas.push(n);
    return wb.addWorksheet(n, { views: [{ state: "frozen", xSplit: 2, ySplit: 5 }] });
  };

  // ---------- Portada ----------
  const P = wb.addWorksheet("Portada");
  hojas.push("Portada");
  P.getColumn(1).width = 34;
  P.getColumn(2).width = 110;
  P.getCell("A1").value = "Resultados del costeo ABC";
  P.getCell("A1").font = { bold: true, size: 15 };
  const filasP: [string, any][] = [
    ["Sistema", NOMBRE_OFICIAL_EXPORT], ["Empresa", emp.nombre], ["Datos", emp.sintetico ? "SINTÉTICOS: no representan una empresa real" : "Según archivo de origen"],
    ["Modelo", `${mod.codigo} · ${mod.nombre}`], ["Versión del modelo", `v${ver.numero} (${ver.estado})`], ["Período", `${per.codigo} · ${per.nombre}`],
    ["Corrida (run_id)", run.id], ["Fecha y hora del cálculo", new Date(run.creado_en).toLocaleString("es-PE")], ["Estado de la corrida", run.estado],
    ["Hash de parámetros", run.params_hash], ["Variante y versión de la aplicación", `${run.host} · ${run.app_version} (exportado con ${APP_VERSION})`],
    ["Archivo de origen del modelo", ori ? `${ori.archivo} · SHA-256 ${ori.sha256}` : "Registrado en el sistema"],
    ["Total de origen (S/)", R.totalFuente], ["Asignado a objetos de costo (S/)", R.objetos.reduce((a, o) => a + o.costo, 0)], ["Conciliación", R.cuadra ? "CUADRA" : "NO CUADRA"],
    ["Criterios aplicados", "Costo empresa por componentes · horas contractuales · capacidad no utilizada visible · personal indirecto por persona · servicios directos opcionales · centros fuera de la cadena · otras actividades · sin normalización silenciosa · IGV recuperable excluido · objetos de costo separados de los KPI · inductores estimados rotulados"],
    ["Formato numérico", "Miles con punto, decimales con coma según la configuración regional; negativos en rojo"],
    ["Advertencia", "Los importes de las matrices de reparto son los del motor (redondeo a céntimos con ajuste de mayor residuo). Las columnas de total y tasa contienen fórmulas de Excel para verificación."],
  ];
  filasP.forEach(([k, v], i) => {
    P.getCell(i + 3, 1).value = k;
    P.getCell(i + 3, 1).font = { bold: true };
    P.getCell(i + 3, 2).value = v;
    if (typeof v === "number") P.getCell(i + 3, 2).numFmt = FMT_S;
    P.getCell(i + 3, 2).alignment = { wrapText: true };
  });

  // ---------- P1 ----------
  {
    const ws = nueva("P1_CMD");
    cab(ws, "P1 CMD: costo del material directo por actividad", "COSTO = COSTO UNITARIO × CANTIDAD (costo unitario sin IGV recuperable)");
    const mats = s.all("SELECT * FROM material WHERE version_id=? ORDER BY codigo", [c.versionId]);
    const n = mats.length;
    encabezado(ws, 5, ["Código", "Actividad", "Centro", ...mats.map((m) => `Cantidad ${m.nombre} (${m.unidad_consumo})`), ...mats.map((m) => `Costo ${m.nombre} S/`), "Total CMD S/"]);
    ws.getCell(4, 3).value = "Costo unitario S/ →";
    mats.forEach((m, j) => {
      const cl = ws.getCell(4, 4 + n + j);
      cl.value = R.unitMat.get(m.id)?.costoUnit ?? 0;
      cl.numFmt = FMT_T;
    });
    let f = 6;
    for (const x of R.resumen) {
      const row = ws.getRow(f);
      row.getCell(1).value = x.act.codigo;
      row.getCell(2).value = x.act.nombre;
      row.getCell(3).value = nm.get(x.act.centroId)?.nombre;
      mats.forEach((m, j) => {
        const q = R.p1.find((p) => p.actividadId === x.act.id && p.materialId === m.id);
        if (q) {
          row.getCell(4 + j).value = q.cantidad;
          row.getCell(4 + j).numFmt = FMT_N;
          const cq = `${colL(4 + j)}${f}`, cu = `${colL(4 + n + j)}$4`;
          row.getCell(4 + n + j).value = { formula: `ROUND(${cq}*${cu},2)`, result: q.importe };
          row.getCell(4 + n + j).numFmt = FMT_S;
        }
      });
      row.getCell(4 + 2 * n).value = { formula: `SUM(${colL(4 + n)}${f}:${colL(3 + 2 * n)}${f})`, result: R.cmd.get(x.act.id) || 0 };
      row.getCell(4 + 2 * n).numFmt = FMT_S;
      f++;
    }
    ws.getCell(f, 2).value = "Total";
    for (let j = 4; j <= 4 + 2 * n; j++) {
      ws.getCell(f, j).value = { formula: `SUM(${colL(j)}6:${colL(j)}${f - 1})` };
      ws.getCell(f, j).numFmt = FMT_S;
    }
    totalFila(ws, f);
    anchos(ws, [10, 42, 24, ...Array(2 * n + 1).fill(16)]);
    ws.autoFilter = { from: "A5", to: `${colL(4 + 2 * n)}5` };
  }
  // ---------- P2 ----------
  {
    const ws = nueva("P2_CSD");
    cab(ws, "P2 CSD: costo del servicio directo por actividad", R.p2.length ? "Costo = base consumida × tarifa vigente" : "No aplica en este período: sin servicios directos (importe 0,00)");
    encabezado(ws, 5, ["Código", "Actividad", "Servicio", "Proveedor", "Cantidad", "Unidad", "Tarifa S/", "Costo directo S/"]);
    let f = 6;
    for (const x of R.p2) {
      const a = nm.get(x.servicio.actividadId);
      ws.getRow(f).values = [a?.codigo, a?.nombre, x.servicio.servicio, x.servicio.proveedor, x.servicio.cantidad, x.servicio.unidad, x.servicio.tarifa];
      ws.getCell(f, 8).value = { formula: `ROUND(E${f}*G${f},2)`, result: x.importe };
      [5, 7, 8].forEach((k) => (ws.getCell(f, k).numFmt = FMT_S));
      f++;
    }
    ws.getCell(f, 2).value = "Total CSD";
    ws.getCell(f, 8).value = { formula: `SUM(H6:H${Math.max(6, f - 1)})` };
    ws.getCell(f, 8).numFmt = FMT_S;
    totalFila(ws, f);
    anchos(ws, [10, 40, 36, 30, 12, 12, 14, 16]);
  }
  // ---------- P3 ----------
  {
    const ws = nueva("P3_CPD_Persona");
    cab(ws, "P3 CPD: costo de personal directo por persona y actividad", "Tarifa = costo empresa del período ÷ horas efectivas; CPD = tarifa × horas imputadas. No se promedia por puesto.");
    encabezado(ws, 5, ["Código actividad", "Actividad", "Centro", "PersonaID", "Persona", "Cargo", "Horas efectivas del período", "Horas imputadas", "Costo empresa S/", "Tarifa S/ por hora", "Costo asignado S/", "Estado"]);
    let f = 6;
    for (const x of R.resumen) {
      for (const p of R.p3) {
        const a = p.r.porActividad.find((z) => z.actividadId === x.act.id);
        if (!a) continue;
        ws.getRow(f).values = [x.act.codigo, x.act.nombre, nm.get(x.act.centroId)?.nombre, p.persona.codigo, p.persona.nombre, p.persona.puesto, p.persona.horas, a.horas, p.persona.costo];
        ws.getCell(f, 10).value = { formula: `IF(G${f}>0,I${f}/G${f},0)`, result: p.r.tasa ?? 0 };
        ws.getCell(f, 11).value = { formula: `ROUND(J${f}*H${f},2)`, result: a.importe };
        ws.getCell(f, 12).value = p.r.estado;
        [7, 8, 9, 11].forEach((k) => (ws.getCell(f, k).numFmt = FMT_S));
        ws.getCell(f, 10).numFmt = "#,##0.0000;[Red]-#,##0.0000";
        f++;
      }
    }
    ws.getCell(f, 2).value = "Total CPD";
    ws.getCell(f, 11).value = { formula: `SUM(K6:K${Math.max(6, f - 1)})` };
    ws.getCell(f, 11).numFmt = FMT_S;
    totalFila(ws, f);
    f += 2;
    encabezado(ws, f, ["PersonaID", "Persona", "Cargo", "Costo empresa S/", "Horas disponibles", "Horas imputadas", "Horas restantes", "Tarifa S/ por hora", "Costo aplicado S/", "Capacidad no utilizada S/", "Estado"]);
    f++;
    for (const p of R.p3) {
      ws.getRow(f).values = [p.persona.codigo, p.persona.nombre, p.persona.puesto, p.persona.costo, p.r.horasDisponibles, p.r.horasImputadas, p.r.horasRestantes, p.r.tasa ?? 0, p.r.costoAplicado, p.r.capacidadNoUtilizada, p.r.estado];
      [4, 5, 6, 7, 9, 10].forEach((k) => (ws.getCell(f, k).numFmt = FMT_S));
      ws.getCell(f, 8).numFmt = "#,##0.0000;[Red]-#,##0.0000";
      f++;
    }
    anchos(ws, [12, 40, 24, 12, 38, 26, 14, 14, 16, 14, 16, 22]);
  }
  // ---------- P4a / P4b / P4c ----------
  const matrizReparto = (ws: any, titulo: string, nota: string, grupos: typeof R.p4a, destinos: any[], etiquetaOrigen: string) => {
    cab(ws, titulo, nota);
    const n = destinos.length;
    const cols = ["Código", etiquetaOrigen, "Costo a repartir S/", "Inductor", "Tipo de base", ...destinos.map((d) => `Base ${d.codigo} ${d.nombre}`), "Total base", "Tasa", ...destinos.map((d) => `Asignado ${d.codigo} S/`), "Total asignado S/", "Saldo S/", "Estado"];
    encabezado(ws, 5, cols);
    ws.getCell(4, 6).value = "Matriz 1 · configuración y valores del inductor";
    ws.getCell(4, 8 + n).value = "Matriz 2 · cálculo del reparto";
    ws.getCell(4, 6).font = ws.getCell(4, 8 + n).font = { bold: true, color: { argb: "FF6554C8" } };
    let f = 6;
    for (const g of grupos) {
      const o = nm.get(g.origenId);
      const vb = g.regla ? new Map(s.all("SELECT destino_id, valor FROM valor_base WHERE regla_id=? AND periodo_id=?", [g.regla.id, c.periodoId]).map((v) => [v.destino_id, v.valor])) : new Map();
      const row = ws.getRow(f);
      row.getCell(1).value = o?.codigo;
      row.getCell(2).value = o?.nombre;
      row.getCell(3).value = g.pool;
      row.getCell(3).numFmt = FMT_S;
      row.getCell(4).value = g.regla?.inductor || "Sin regla";
      row.getCell(5).value = g.regla?.tipo || "";
      destinos.forEach((d, j) => {
        const v = vb.get(d.id);
        if (v !== undefined && v !== null) {
          row.getCell(6 + j).value = v;
          row.getCell(6 + j).numFmt = g.regla?.tipo === "porcentaje" ? "0.0000;[Red]-0.0000" : FMT_N;
        }
      });
      const sumB = `SUM(${colL(6)}${f}:${colL(5 + n)}${f})`;
      row.getCell(6 + n).value = { formula: sumB, result: g.r?.denominador ?? 0 };
      row.getCell(6 + n).numFmt = FMT_N;
      row.getCell(7 + n).value = g.regla?.tipo === "cantidad" ? { formula: `IF(${colL(6 + n)}${f}>0,C${f}/${colL(6 + n)}${f},0)`, result: g.r?.tasa ?? 0 } : g.r?.tasa ?? null;
      row.getCell(7 + n).numFmt = FMT_T;
      destinos.forEach((d, j) => {
        const l = g.r?.lineas.find((z) => z.destinoId === d.id);
        if (l && l.importe) {
          row.getCell(8 + n + j).value = l.importe;
          row.getCell(8 + n + j).numFmt = FMT_S;
        }
      });
      row.getCell(8 + 2 * n).value = { formula: `SUM(${colL(8 + n)}${f}:${colL(7 + 2 * n)}${f})`, result: g.r?.asignado ?? 0 };
      row.getCell(9 + 2 * n).value = { formula: `C${f}-${colL(8 + 2 * n)}${f}`, result: g.r ? g.r.saldo : g.pool };
      row.getCell(10 + 2 * n).value = g.r ? g.r.estado : "PENDIENTE (sin regla)";
      [8 + 2 * n, 9 + 2 * n].forEach((k) => (row.getCell(k).numFmt = FMT_S));
      f++;
    }
    ws.getCell(f, 2).value = "Total";
    for (const k of [3, ...destinos.map((_, j) => 8 + n + j), 8 + 2 * n, 9 + 2 * n]) {
      ws.getCell(f, k).value = { formula: `SUM(${colL(k)}6:${colL(k)}${Math.max(6, f - 1)})` };
      ws.getCell(f, k).numFmt = FMT_S;
    }
    totalFila(ws, f);
    anchos(ws, [10, 38, 16, 34, 12, ...Array(n).fill(13), 13, 13, ...Array(n).fill(14), 16, 14, 18]);
  };
  const centros = s.all("SELECT * FROM centro WHERE version_id=? ORDER BY codigo", [c.versionId]);
  matrizReparto(nueva("P4a_EC-CA"), "P4a: elementos de costo indirecto → centros de actividad", "Tasa = costo ÷ Σ base; importe = tasa × base. Sin normalización silenciosa: la diferencia queda como saldo.", R.p4a, centros, "Elemento de costo indirecto");
  for (const ce of centros) {
    if (ce.participacion === "NO_PARTICIPA") continue;
    const gs = R.p4b.filter((g) => g.centroId === ce.id);
    const acts = s.all("SELECT * FROM actividad WHERE version_id=? AND centro_id=? ORDER BY orden", [c.versionId, ce.id]);
    const nombre = `P4b_${ce.codigo}-AC`;
    matrizReparto(nueva(nombre), `P4b: ${ce.codigo} ${ce.nombre} → actividades`, `${ce.participacion === "PARCIAL" ? `Centro con participación parcial ${Math.round((ce.pct_participacion || 0) * 100)} %. ` : ""}Incluye otras actividades del centro.`, gs, acts, "Elemento indirecto en el centro");
  }
  // ---------- Resumen ----------
  {
    const ws = nueva("Resumen_Costos_AC");
    cab(ws, "Hoja resumen de costos totales por actividad", "Total actividad = CMD + CSD + CPD + CI");
    encabezado(ws, 5, ["Código", "Actividad", "Centro", "Alcance", "Clase", "CMD S/", "CSD S/", "CPD S/", "CI asignado S/", "Total actividad S/", "% participación"]);
    let f = 6;
    const ini = f;
    for (const x of R.resumen) {
      ws.getRow(f).values = [x.act.codigo, x.act.nombre, nm.get(x.act.centroId)?.nombre, x.act.alcance, x.act.clase || "", x.cmd, x.csd, x.cpd, x.ci];
      ws.getCell(f, 10).value = { formula: `SUM(F${f}:I${f})`, result: x.total };
      f++;
    }
    for (let r = ini; r < f; r++) {
      ws.getCell(r, 11).value = { formula: `IF($J$${f}>0,J${r}/$J$${f},0)`, result: R.resumen[r - ini].pct };
      ws.getCell(r, 11).numFmt = "0.00%;[Red]-0.00%";
      for (const k of [6, 7, 8, 9, 10]) ws.getCell(r, k).numFmt = FMT_S;
    }
    ws.getCell(f, 2).value = "Total";
    for (const k of [6, 7, 8, 9, 10]) {
      ws.getCell(f, k).value = { formula: `SUM(${colL(k)}${ini}:${colL(k)}${f - 1})` };
      ws.getCell(f, k).numFmt = FMT_S;
    }
    totalFila(ws, f);
    anchos(ws, [10, 42, 26, 12, 8, 14, 14, 14, 16, 18, 14]);
    ws.autoFilter = { from: "A5", to: "K5" };
  }
  const objs = s.all("SELECT * FROM objeto_costo WHERE version_id=? ORDER BY codigo", [c.versionId]);
  matrizReparto(nueva("P4c_AC-OC"), "P4c: actividades → objetos de costo", "Solo actividades de la cadena (las excluidas se informan como otras actividades).", R.p4c, objs, "Actividad");
  {
    const ws = nueva("Costo_Objetos");
    cab(ws, "Costo total y unitario por objeto de costo", "Costo unitario = costo asignado ÷ magnitud del período");
    encabezado(ws, 5, ["Código", "Objeto de costo", "Clase", "Costo asignado S/", "Magnitud", "Cantidad", "Costo unitario S/"]);
    let f = 6;
    for (const o of R.objetos) {
      ws.getRow(f).values = [o.obj.codigo, o.obj.nombre, o.obj.clase, o.costo, o.obj.magnitud, o.obj.cantidad];
      ws.getCell(f, 7).value = { formula: `IF(N(F${f})>0,D${f}/F${f},"sin dato")`, result: o.unitario ?? "sin dato" };
      [4, 6, 7].forEach((k) => (ws.getCell(f, k).numFmt = FMT_S));
      f++;
    }
    ws.getCell(f, 2).value = "Total";
    ws.getCell(f, 4).value = { formula: `SUM(D6:D${f - 1})` };
    ws.getCell(f, 4).numFmt = FMT_S;
    totalFila(ws, f);
    anchos(ws, [10, 40, 18, 18, 30, 14, 16]);
  }
  // ---------- Conciliación y saldos ----------
  {
    const ws = nueva("Conciliacion");
    cab(ws, "Conciliación global: costo de origen = asignado + capacidad no utilizada + fuera de alcance + saldos");
    encabezado(ws, 5, ["Signo", "Concepto", "Monto S/"]);
    let f = 6;
    for (const x of R.conciliacion) {
      ws.getRow(f).values = [x.signo > 0 ? "+" : "−", x.concepto, x.monto];
      ws.getCell(f, 3).numFmt = FMT_S;
      f++;
    }
    const ini = 6, fin = f - 1;
    ws.getCell(f, 2).value = "Total de origen";
    ws.getCell(f, 3).value = { formula: `SUMIF(A${ini}:A${fin},"+",C${ini}:C${fin})`, result: R.totalFuente };
    ws.getCell(f + 1, 2).value = "Total explicado";
    ws.getCell(f + 1, 3).value = { formula: `SUMIF(A${ini}:A${fin},"−",C${ini}:C${fin})`, result: R.totalExplicado };
    ws.getCell(f + 2, 2).value = "Diferencia (debe ser 0,00)";
    ws.getCell(f + 2, 3).value = { formula: `ROUND(C${f}-C${f + 1},2)`, result: Math.round((R.totalFuente - R.totalExplicado) * 100) / 100 };
    [f, f + 1, f + 2].forEach((r) => (ws.getCell(r, 3).numFmt = FMT_S));
    totalFila(ws, f + 2);
    f += 5;
    encabezado(ws, f, ["Etapa", "Causa", "Monto S/", "Tipo"]);
    f++;
    for (const z of R.saldos) {
      ws.getRow(f).values = [z.etapa, z.causa, z.monto, z.tipo];
      ws.getCell(f, 3).numFmt = FMT_S;
      f++;
    }
    anchos(ws, [8, 90, 16, 16]);
  }
  // ---------- Normalizado ----------
  {
    const ws = nueva("Normalizado_Asignaciones");
    cab(ws, "Tabla normalizada de asignaciones de la corrida (una fila por reparto)", "Para auditoría, comparación y reimportación");
    encabezado(ws, 5, ["run_id", "Etapa", "Origen tipo", "Origen código", "Origen nombre", "Destino tipo", "Destino código", "Destino nombre", "Base", "Denominador", "Tasa", "Importe S/", "Regla"]);
    const rows = s.all("SELECT * FROM asignacion WHERE corrida_id=? ORDER BY id", [run.id]);
    let f = 6;
    for (const a of rows) {
      const o = nm.get(a.origen_id), d = nm.get(a.destino_id);
      ws.getRow(f).values = [run.id, a.etapa, a.origen_tipo, o?.codigo, o?.nombre, a.destino_tipo, d?.codigo, d?.nombre, a.base, a.denominador, a.tasa, a.importe, a.detalle ? JSON.parse(a.detalle).regla || "" : ""];
      ws.getCell(f, 12).numFmt = FMT_S;
      f++;
    }
    ws.autoFilter = { from: "A5", to: "M5" };
    anchos(ws, [30, 7, 12, 10, 34, 11, 10, 34, 12, 12, 12, 14, 14]);
  }
  // ---------- Serie de períodos (corridas guardadas) ----------
  if (incluirPeriodos) {
    const ps = periodosEmpresa(s, c.empresaId);
    if (ps.length > 1) {
      const ws = nueva("Resumen_por_Periodo");
      cab(ws, "Resultados de las corridas guardadas por período", "Solo períodos con corrida ejecutada; los demás se marcan «sin corrida».");
      encabezado(ws, 5, ["Período", "Nombre", "run_id", "Estado", "Asignado a objetos S/", ...objs.map((o) => `${o.codigo} S/`)]);
      let f = 6;
      for (const p of ps) {
        const rr = s.one("SELECT * FROM corrida WHERE version_id=? AND periodo_id=? AND etapa='ABC' ORDER BY creado_en DESC LIMIT 1", [c.versionId, p.id]);
        ws.getRow(f).values = [p.codigo, p.nombre, rr?.id || "sin corrida", rr?.estado || ""];
        if (rr) {
          const tot = s.one("SELECT COALESCE(SUM(importe),0) t FROM asignacion WHERE corrida_id=? AND etapa='P4c'", [rr.id])!.t;
          ws.getCell(f, 5).value = tot;
          ws.getCell(f, 5).numFmt = FMT_S;
          objs.forEach((o, j) => {
            ws.getCell(f, 6 + j).value = s.one("SELECT COALESCE(SUM(importe),0) t FROM asignacion WHERE corrida_id=? AND etapa='P4c' AND destino_id=?", [rr.id, o.id])!.t;
            ws.getCell(f, 6 + j).numFmt = FMT_S;
          });
        }
        f++;
      }
      anchos(ws, [10, 18, 30, 24, 18, ...objs.map(() => 16)]);
    }
  }
  // ---------- Advertencias ----------
  {
    const ws = nueva("Advertencias");
    cab(ws, "Advertencias, bloqueos y supuestos de la corrida");
    encabezado(ws, 5, ["Tipo", "Detalle"]);
    let f = 6;
    const adv = ori ? JSON.parse(ori.advertencias || "[]") : [];
    for (const a of adv) ws.getRow(f++).values = ["Importación", a];
    for (const b of R.bloqueos) ws.getRow(f++).values = ["Bloqueo", b];
    for (const a of R.advertencias) ws.getRow(f++).values = ["Motor", a];
    if (f === 6) ws.getRow(f).values = ["—", "Sin advertencias"];
    anchos(ws, [18, 140]);
  }
  const buf = await wb.xlsx.writeBuffer();
  const nombre = `Resultados_Sistema_${mod.codigo}_${per.codigo}_${run.id}.xlsx`;
  s.audit("EXPORTAR_06", "corrida", run.id, null, { archivo: nombre, hojas });
  return { nombre, bytes: new Uint8Array(buf), hojas, runId: run.id };
}
