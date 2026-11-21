# -*- coding: utf-8 -*-
"""
CANVAS MODEL IA - Reportes (reports.py)
---------------------------------------
- Cálculo consolidado del portafolio (SPI, CPI, semáforos, predicciones).
- Generación automática del PPTX de avance de proyectos del Canvas TO BE
  (real vs proyectado), con gráficos nativos editables de PowerPoint.

Los archivos se guardan en ./Entregable/
"""
from __future__ import annotations

import io
import re
from datetime import datetime

import pandas as pd
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN
from pptx.util import Emu, Inches, Pt

import db
import forecast as fc

AZUL = RGBColor(0x0B, 0x3C, 0x5D)
AZUL2 = RGBColor(0x1D, 0x70, 0xB8)
GRIS_FONDO = RGBColor(0xF5, 0xF7, 0xFA)
TEXTO = RGBColor(0x1F, 0x29, 0x37)
TEXTO2 = RGBColor(0x6B, 0x72, 0x80)
BLANCO = RGBColor(0xFF, 0xFF, 0xFF)
SEM = {"Verde": RGBColor(0x16, 0xA3, 0x4A), "Ámbar": RGBColor(0xF5, 0x9E, 0x0B),
       "Rojo": RGBColor(0xDC, 0x26, 0x26), "Gris": RGBColor(0x9C, 0xA3, 0xAF)}
ESTADOS_CONTROL = ("Aprobado", "En ejecución", "En pausa", "Cerrado")


# ----------------------------------------------------------------------------
# Datos consolidados
# ----------------------------------------------------------------------------
def portafolio(org_id: str | None = None, corte: str | None = None) -> pd.DataFrame:
    """Proyectos aprobados con avance y costo al último periodo con dato real."""
    sql = "SELECT * FROM proyecto WHERE estado IN ('Aprobado','En ejecución','En pausa','Cerrado')"
    params: tuple = ()
    if org_id:
        sql += " AND org_id=?"
        params = (org_id,)
    p = db.q(sql + " ORDER BY proyecto_id", params)
    if p.empty:
        return p
    verde = float(db.param("SEMAFORO_PROY_VERDE", "0.95"))
    ambar = float(db.param("SEMAFORO_PROY_AMBAR", "0.85"))
    filas = []
    for r in p.to_dict("records"):
        av = db.q("""SELECT * FROM avance_mensual WHERE proyecto_id=? AND avance_real_pct IS NOT NULL
                     {} ORDER BY periodo""".format("AND periodo<=?" if corte else ""),
                  (r["proyecto_id"], corte) if corte else (r["proyecto_id"],))
        if av.empty:
            ult = {"periodo": None, "avance_plan_pct": None, "avance_real_pct": None, "costo_plan_pen": None, "costo_real_pen": None}
        else:
            ult = av.iloc[-1].to_dict()
        e = fc.evm(ult["avance_real_pct"], ult["avance_plan_pct"], ult["costo_real_pen"], r["presupuesto_pen"])
        riesgos = db.q1("SELECT COUNT(*) n FROM riesgo WHERE proyecto_id=? AND estado<>'Cerrado' AND probabilidad*impacto>=12",
                        (r["proyecto_id"],))["n"]
        filas.append({**r, "periodo_corte": ult["periodo"], "avance_plan": ult["avance_plan_pct"],
                      "avance_real": ult["avance_real_pct"], "costo_plan": ult["costo_plan_pen"],
                      "costo_real": ult["costo_real_pen"], "spi": e["spi"], "cpi": e["cpi"],
                      "semaforo": fc.semaforo_proyecto(e["spi"], e["cpi"], verde, ambar),
                      "riesgos_altos": riesgos})
    return pd.DataFrame(filas)


def predicciones_org(org_id: str, escenario: dict | None = None) -> pd.DataFrame:
    """Predicción del mes +1 para todos los KPI de la organización."""
    kpis = db.q("SELECT * FROM kpi WHERE org_id=? ORDER BY kpi_id", (org_id,))
    min_obs = int(float(db.param("MIN_OBS_PREDICCION", "6")))
    filas = []
    for k in kpis.to_dict("records"):
        s = db.q("SELECT periodo, valor_real, valor_plan FROM kpi_observacion WHERE kpi_id=? ORDER BY periodo", (k["kpi_id"],))
        if s.empty:
            continue
        o = fc.predecir(s, k, escenario, min_obs)
        ult = s.dropna(subset=["valor_real"])
        filas.append({"kpi_id": k["kpi_id"], "kpi": k["nombre"], "unidad": k["unidad"], "proyecto_id": k["proyecto_id"],
                      "sentido": k["sentido"], "meta": k["meta"],
                      "ultimo_real": float(ult["valor_real"].iloc[-1]) if len(ult) else None,
                      "plan_ultimo": float(ult["valor_plan"].iloc[-1]) if len(ult) and pd.notna(ult["valor_plan"].iloc[-1]) else None,
                      **{c: o[c] for c in ("fecha_corte", "periodo_objetivo", "modelo", "n_obs", "p10", "p50", "p90", "mae",
                                           "wape", "sesgo", "mejora_vs_naive", "semaforo", "advertencia", "dataset_hash",
                                           "plan_objetivo", "confianza")}})
    return pd.DataFrame(filas)


def fmt(v, unidad: str = "", dec: int = 1) -> str:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return "—"
    if unidad in ("S/", "PEN"):
        return f"S/ {v:,.0f}"
    if unidad == "%":
        return f"{v:,.{dec}f} %"
    if abs(v) >= 1000:
        return f"{v:,.0f}"
    return f"{v:,.{dec}f}"


# ----------------------------------------------------------------------------
# Utilidades de dibujo
# ----------------------------------------------------------------------------
def _texto(slide, x, y, w, h, texto, size=12, bold=False, color=TEXTO, align=PP_ALIGN.LEFT):
    tb = slide.shapes.add_textbox(x, y, w, h)
    tf = tb.text_frame
    tf.word_wrap = True
    lineas = texto if isinstance(texto, list) else [texto]
    for i, linea in enumerate(lineas):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        r = p.add_run()
        r.text = str(linea)
        r.font.size = Pt(size)
        r.font.bold = bold
        r.font.color.rgb = color
        r.font.name = "Calibri"
    return tb


def _rect(slide, x, y, w, h, color, forma=MSO_SHAPE.RECTANGLE):
    s = slide.shapes.add_shape(forma, x, y, w, h)
    s.fill.solid()
    s.fill.fore_color.rgb = color
    s.line.fill.background()
    return s


def _encabezado(slide, titulo, subtitulo, prs):
    _rect(slide, 0, 0, prs.slide_width, Inches(0.95), AZUL)
    _texto(slide, Inches(0.4), Inches(0.12), Inches(10.5), Inches(0.5), titulo, 24, True, BLANCO)
    _texto(slide, Inches(0.4), Inches(0.55), Inches(12), Inches(0.35), subtitulo, 12, False, RGBColor(0xC7, 0xD7, 0xE6))


def _pie(slide, prs, texto):
    _texto(slide, Inches(0.4), prs.slide_height - Inches(0.4), Inches(12.5), Inches(0.3), texto, 9, False, TEXTO2)


def _tarjeta(slide, x, y, w, etiqueta, valor, color=AZUL2):
    _rect(slide, x, y, w, Inches(1.05), GRIS_FONDO)
    _rect(slide, x, y, Inches(0.08), Inches(1.05), color)
    _texto(slide, x + Inches(0.2), y + Inches(0.08), w - Inches(0.3), Inches(0.3), etiqueta, 11, False, TEXTO2)
    _texto(slide, x + Inches(0.2), y + Inches(0.4), w - Inches(0.3), Inches(0.55), valor, 24, True, TEXTO)


def _tabla(slide, x, y, w, df: pd.DataFrame, anchos: list[float] | None = None, col_semaforo: str | None = None,
           size: int = 10, alto_fila: float = 0.32):
    filas, cols = len(df) + 1, len(df.columns)
    shp = slide.shapes.add_table(filas, cols, x, y, w, Inches(alto_fila * filas))
    t = shp.table
    if anchos:
        tot = sum(anchos)
        for i, a in enumerate(anchos):
            t.columns[i].width = Emu(int(w * a / tot))
    for j, c in enumerate(df.columns):
        cell = t.cell(0, j)
        cell.text = str(c)
        cell.fill.solid()
        cell.fill.fore_color.rgb = AZUL
        para = cell.text_frame.paragraphs[0]
        para.runs[0].font.size = Pt(size)
        para.runs[0].font.bold = True
        para.runs[0].font.color.rgb = BLANCO
    for i, fila in enumerate(df.itertuples(index=False), start=1):
        for j, v in enumerate(fila):
            cell = t.cell(i, j)
            cell.text = "" if v is None else str(v)
            cell.fill.solid()
            cell.fill.fore_color.rgb = BLANCO if i % 2 else GRIS_FONDO
            run = cell.text_frame.paragraphs[0].runs[0] if cell.text_frame.paragraphs[0].runs else None
            if run is not None:
                run.font.size = Pt(size)
                run.font.color.rgb = TEXTO
            if col_semaforo and df.columns[j] == col_semaforo and str(v) in SEM:
                cell.fill.fore_color.rgb = SEM[str(v)]
                if run is not None:
                    run.font.color.rgb = BLANCO
                    run.font.bold = True
    return shp


def _grafico_lineas(slide, x, y, w, h, categorias, series: dict, titulo: str, fmt_num: str = '0'):
    cd = CategoryChartData()
    cd.categories = categorias
    for nombre, valores in series.items():
        cd.add_series(nombre, [None if (v is None or pd.isna(v)) else float(v) for v in valores])
    gf = slide.shapes.add_chart(XL_CHART_TYPE.LINE_MARKERS, x, y, w, h, cd)
    ch = gf.chart
    ch.has_title = True
    ch.chart_title.text_frame.text = titulo
    ch.chart_title.text_frame.paragraphs[0].runs[0].font.size = Pt(12)
    ch.chart_title.text_frame.paragraphs[0].runs[0].font.bold = True
    ch.has_legend = True
    ch.legend.position = XL_LEGEND_POSITION.BOTTOM
    ch.legend.include_in_layout = False
    ch.legend.font.size = Pt(9)
    ch.value_axis.tick_labels.font.size = Pt(9)
    ch.value_axis.tick_labels.number_format = fmt_num
    ch.value_axis.tick_labels.number_format_is_linked = False
    ch.value_axis.major_gridlines.format.line.color.rgb = RGBColor(0xE5, 0xE7, 0xEB)
    ch.category_axis.tick_labels.font.size = Pt(8)
    colores = [RGBColor(0x9C, 0xA3, 0xAF), AZUL2, RGBColor(0xF5, 0x9E, 0x0B)]
    for i, s in enumerate(ch.series):
        s.format.line.color.rgb = colores[i % len(colores)]
        s.format.line.width = Pt(2.25)
        s.smooth = False
        s.marker.format.fill.solid()
        s.marker.format.fill.fore_color.rgb = colores[i % len(colores)]
        s.marker.size = 5
        if i == 0:
            s.format.line.dash_style = 4  # guiones para el plan
    return gf


def _grafico_barras(slide, x, y, w, h, categorias, series: dict, titulo: str):
    cd = CategoryChartData()
    cd.categories = categorias
    for nombre, valores in series.items():
        cd.add_series(nombre, [None if (v is None or pd.isna(v)) else float(v) for v in valores])
    gf = slide.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, x, y, w, h, cd)
    ch = gf.chart
    ch.has_title = True
    ch.chart_title.text_frame.text = titulo
    ch.chart_title.text_frame.paragraphs[0].runs[0].font.size = Pt(12)
    ch.chart_title.text_frame.paragraphs[0].runs[0].font.bold = True
    ch.has_legend = True
    ch.legend.position = XL_LEGEND_POSITION.BOTTOM
    ch.legend.include_in_layout = False
    ch.legend.font.size = Pt(9)
    ch.value_axis.tick_labels.font.size = Pt(9)
    ch.value_axis.tick_labels.number_format = '#,##0'
    ch.value_axis.tick_labels.number_format_is_linked = False
    ch.value_axis.major_gridlines.format.line.color.rgb = RGBColor(0xE5, 0xE7, 0xEB)
    ch.category_axis.tick_labels.font.size = Pt(8)
    for i, s in enumerate(ch.series):
        s.format.fill.solid()
        s.format.fill.fore_color.rgb = [RGBColor(0x9C, 0xA3, 0xAF), AZUL][i % 2]
    ch.plots[0].gap_width = 60
    return gf


# ----------------------------------------------------------------------------
# PPTX
# ----------------------------------------------------------------------------
def generar_pptx(org_id: str, usuario: str, escenario_id: str | None = None, guardar_archivo: bool = True) -> tuple[bytes, str]:
    """Genera el PPTX de avance real vs proyectado de los proyectos del Canvas TO BE."""
    org = db.q1("SELECT * FROM organizacion WHERE org_id=?", (org_id,))
    esc = db.q1("SELECT * FROM escenario WHERE escenario_id=?", (escenario_id,)) if escenario_id else None
    port = portafolio(org_id)
    preds = predicciones_org(org_id, esc)
    corte = port["periodo_corte"].dropna().max() if not port.empty else None
    fecha = datetime.now().strftime("%d/%m/%Y %H:%M")
    pie = f"CANVAS MODEL IA · {org['razon_social']} · Corte {corte or '—'} · Generado {fecha} por {usuario}"

    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
    blank = prs.slide_layouts[6]

    # 1. Portada
    s = prs.slides.add_slide(blank)
    _rect(s, 0, 0, prs.slide_width, prs.slide_height, AZUL)
    _rect(s, Inches(0.8), Inches(2.2), Inches(0.12), Inches(2.4), RGBColor(0xF5, 0x9E, 0x0B))
    _texto(s, Inches(1.1), Inches(2.1), Inches(11), Inches(0.6), "CANVAS MODEL IA", 20, True, RGBColor(0xC7, 0xD7, 0xE6))
    _texto(s, Inches(1.1), Inches(2.7), Inches(11), Inches(1.2),
           "Avance de proyectos del Canvas TO BE: real vs proyectado", 36, True, BLANCO)
    _texto(s, Inches(1.1), Inches(4.0), Inches(11), Inches(0.5),
           f"{org['razon_social']} · Sector {org['sector']} · {org['tamano']} empresa", 18, False, BLANCO)
    _texto(s, Inches(1.1), Inches(4.5), Inches(11), Inches(0.5),
           f"Fecha de corte: {corte or '—'}   |   Escenario de predicción: {esc['nombre'] if esc else 'Base (sin ajuste)'}",
           14, False, RGBColor(0xC7, 0xD7, 0xE6))
    _texto(s, Inches(1.1), Inches(6.6), Inches(11), Inches(0.4), f"Generado automáticamente el {fecha} · Usuario: {usuario}",
           11, False, RGBColor(0xC7, 0xD7, 0xE6))

    # 2. Resumen ejecutivo
    s = prs.slides.add_slide(blank)
    _encabezado(s, "Resumen ejecutivo del portafolio", "Proyectos aprobados derivados de las brechas del Canvas TO BE", prs)
    if port.empty:
        _texto(s, Inches(0.5), Inches(1.5), Inches(12), Inches(1), "No hay proyectos aprobados para esta organización.", 18)
    else:
        n = len(port)
        pres = port["presupuesto_pen"].sum()
        creal = port["costo_real"].fillna(0).sum()
        spi = port["spi"].dropna().mean()
        cpi = port["cpi"].dropna().mean()
        w = Inches(2.95)
        _tarjeta(s, Inches(0.4), Inches(1.2), w, "Proyectos en control", f"{n}")
        _tarjeta(s, Inches(0.4) + (w + Inches(0.2)), Inches(1.2), w, "Presupuesto total", f"S/ {pres:,.0f}")
        _tarjeta(s, Inches(0.4) + 2 * (w + Inches(0.2)), Inches(1.2), w, "SPI promedio (plazo)", f"{spi:.2f}",
                 SEM[fc.semaforo_proyecto(spi, None)])
        _tarjeta(s, Inches(0.4) + 3 * (w + Inches(0.2)), Inches(1.2), w, "CPI promedio (costo)", f"{cpi:.2f}",
                 SEM[fc.semaforo_proyecto(None, cpi)])
        tab = pd.DataFrame({
            "ID": port["proyecto_id"], "Proyecto": port["nombre"].str.slice(0, 48), "Estado": port["estado"],
            "Avance plan": port["avance_plan"].map(lambda v: fmt(v, "%")),
            "Avance real": port["avance_real"].map(lambda v: fmt(v, "%")),
            "Costo real": port["costo_real"].map(lambda v: fmt(v, "S/")),
            "SPI": port["spi"].map(lambda v: fmt(v, "", 2)), "CPI": port["cpi"].map(lambda v: fmt(v, "", 2)),
            "Semáforo": port["semaforo"]})
        _tabla(s, Inches(0.4), Inches(2.5), Inches(12.5), tab, [0.7, 4, 1.4, 1.2, 1.2, 1.4, 0.8, 0.8, 1.1], "Semáforo", 10)
        rojos = port[port["semaforo"] == "Rojo"]["proyecto_id"].tolist()
        ambar = port[port["semaforo"] == "Ámbar"]["proyecto_id"].tolist()
        msg = f"Alertas: {len(rojos)} en rojo ({', '.join(rojos) or '—'}), {len(ambar)} en ámbar ({', '.join(ambar) or '—'}). " \
              f"Costo real acumulado S/ {creal:,.0f} ({creal / pres * 100 if pres else 0:.1f} % del presupuesto)."
        _texto(s, Inches(0.4), Inches(2.6) + Inches(0.32 * (n + 1)) + Inches(0.15), Inches(12.5), Inches(0.5), msg, 12, True, TEXTO)
    _pie(s, prs, pie)

    # 3. Una diapositiva por proyecto
    for r in port.to_dict("records") if not port.empty else []:
        s = prs.slides.add_slide(blank)
        _encabezado(s, f"{r['proyecto_id']} · {r['nombre'][:70]}",
                    f"{r['tipo']} · Responsable: {r['responsable'] or '—'} · {r['fecha_inicio']} → {r['fecha_fin']} · "
                    f"Brecha {r['brecha_id'] or '—'}", prs)
        av = db.q("SELECT * FROM avance_mensual WHERE proyecto_id=? ORDER BY periodo", (r["proyecto_id"],))
        if not av.empty:
            cats = av["periodo"].tolist()
            _grafico_lineas(s, Inches(0.3), Inches(1.1), Inches(6.3), Inches(3.3), cats,
                            {"Avance proyectado (%)": av["avance_plan_pct"], "Avance real (%)": av["avance_real_pct"]},
                            "Avance físico acumulado: real vs proyectado", '0"%"')
            _grafico_barras(s, Inches(6.75), Inches(1.1), Inches(6.3), Inches(3.3), cats,
                            {"Costo proyectado (S/)": av["costo_plan_pen"], "Costo real (S/)": av["costo_real_pen"]},
                            "Costo acumulado: real vs proyectado")
        # Panel de indicadores
        color = SEM.get(r["semaforo"], SEM["Gris"])
        _rect(s, Inches(0.3), Inches(4.6), Inches(3.0), Inches(2.3), GRIS_FONDO)
        _rect(s, Inches(0.3), Inches(4.6), Inches(3.0), Inches(0.45), color)
        _texto(s, Inches(0.4), Inches(4.64), Inches(2.8), Inches(0.4), f"Semáforo: {r['semaforo']}", 14, True, BLANCO)
        _texto(s, Inches(0.45), Inches(5.15), Inches(2.8), Inches(1.7), [
            f"Avance plan: {fmt(r['avance_plan'], '%')}",
            f"Avance real: {fmt(r['avance_real'], '%')}",
            f"SPI: {fmt(r['spi'], '', 2)}   CPI: {fmt(r['cpi'], '', 2)}",
            f"Presupuesto: {fmt(r['presupuesto_pen'], 'S/')}",
            f"Riesgos altos abiertos: {r['riesgos_altos']}"], 11)
        # KPI del proyecto
        kp = preds[preds["proyecto_id"] == r["proyecto_id"]] if not preds.empty else pd.DataFrame()
        if not kp.empty:
            tab = pd.DataFrame({
                "KPI": kp["kpi"], "Último real": [fmt(v, u) for v, u in zip(kp["ultimo_real"], kp["unidad"])],
                "Plan": [fmt(v, u) for v, u in zip(kp["plan_ultimo"], kp["unidad"])],
                f"Mes +1 ({kp['periodo_objetivo'].iloc[0]}) P50": [fmt(v, u) for v, u in zip(kp["p50"], kp["unidad"])],
                "Rango P10–P90": [f"{fmt(a, u)} – {fmt(b, u)}" for a, b, u in zip(kp["p10"], kp["p90"], kp["unidad"])],
                "Plan mes +1": [fmt(v, u) for v, u in zip(kp["plan_objetivo"], kp["unidad"])],
                "Semáforo": kp["semaforo"]})
            _tabla(s, Inches(3.5), Inches(4.6), Inches(9.5), tab, [2.2, 1.2, 1.2, 1.4, 2.2, 1.2, 1.0], "Semáforo", 10)
            y_txt = Inches(4.6) + Inches(0.32 * (len(kp) + 1)) + Inches(0.1)
        else:
            y_txt = Inches(4.7)
            _texto(s, Inches(3.5), y_txt, Inches(9.5), Inches(0.4), "Proyecto sin KPI asociado.", 11, False, TEXTO2)
            y_txt += Inches(0.4)
        hitos = db.q("SELECT tarea, fecha_fin, avance_real_pct FROM hito WHERE proyecto_id=? ORDER BY fecha_inicio",
                     (r["proyecto_id"],))
        hoy = datetime.now().strftime("%Y-%m-%d")
        venc = hitos[(hitos["fecha_fin"] < hoy) & (hitos["avance_real_pct"].fillna(0) < 100)] if not hitos.empty else hitos
        prox = hitos[(hitos["fecha_fin"] >= hoy)].head(1) if not hitos.empty else hitos
        lineas = [f"Objetivo: {r['objetivo'] or '—'}",
                  f"Hitos vencidos sin completar: {len(venc)}" + (f" ({', '.join(venc['tarea'].head(3))})" if len(venc) else ""),
                  f"Próximo hito: {prox['tarea'].iloc[0]} (fin {prox['fecha_fin'].iloc[0]})" if len(prox) else "Próximo hito: —",
                  f"Criterio de parada: {r['criterio_parada'] or '—'}"]
        _texto(s, Inches(3.5), y_txt, Inches(9.5), Inches(1.4), lineas, 10, False, TEXTO)
        _pie(s, prs, pie)

    # 4. KPI y predicción mes +1
    s = prs.slides.add_slide(blank)
    _encabezado(s, "Indicadores y predicción del mes +1",
                "Estimación puntual (P50) e intervalo P10–P90 con backtesting walk-forward; Gris = datos insuficientes", prs)
    if preds.empty:
        _texto(s, Inches(0.5), Inches(1.5), Inches(12), Inches(1), "No hay KPI con observaciones.", 18)
    else:
        tab = pd.DataFrame({
            "KPI": preds["kpi_id"] + " " + preds["kpi"], "Sentido": preds["sentido"].str.replace(" es mejor", ""),
            "Último real": [fmt(v, u) for v, u in zip(preds["ultimo_real"], preds["unidad"])],
            "P10": [fmt(v, u) for v, u in zip(preds["p10"], preds["unidad"])],
            "P50": [fmt(v, u) for v, u in zip(preds["p50"], preds["unidad"])],
            "P90": [fmt(v, u) for v, u in zip(preds["p90"], preds["unidad"])],
            "Plan / meta": [fmt(p if p is not None and not pd.isna(p) else m, u)
                            for p, m, u in zip(preds["plan_objetivo"], preds["meta"], preds["unidad"])],
            "Modelo": preds["modelo"].str.slice(0, 28), "n": preds["n_obs"], "Semáforo": preds["semaforo"]})
        _tabla(s, Inches(0.4), Inches(1.2), Inches(12.5), tab, [2.6, 0.8, 1.2, 1.1, 1.1, 1.1, 1.2, 2.2, 0.5, 1.0], "Semáforo", 10)
    _pie(s, prs, pie)

    # 5. Trazabilidad Canvas TO BE -> proyectos
    s = prs.slides.add_slide(blank)
    _encabezado(s, "Trazabilidad: brecha del Canvas → proyecto", "Diagnosticar AS IS → Diseñar TO BE → Priorizar → Ejecutar → Predecir", prs)
    br = db.q("""SELECT b.brecha_id, b.bloque, b.as_is, b.to_be, b.tipo_cambio, b.score, b.prioridad,
                        COALESCE(b.proyecto_id, '—') proyecto, COALESCE(p.estado, b.justificacion, '—') estado
                 FROM brecha b LEFT JOIN proyecto p ON p.proyecto_id=b.proyecto_id WHERE b.org_id=? ORDER BY b.score DESC""",
              (org_id,))
    if not br.empty:
        br["as_is"] = br["as_is"].fillna("").str.slice(0, 38)
        br["to_be"] = br["to_be"].fillna("").str.slice(0, 45)
        br["estado"] = br["estado"].astype(str).str.slice(0, 32)
        br.columns = ["Brecha", "Bloque", "AS IS", "TO BE", "Cambio", "Score", "Prioridad", "Proyecto", "Estado / justificación"]
        _tabla(s, Inches(0.4), Inches(1.2), Inches(12.5), br.head(14), [0.8, 0.6, 2.6, 3.0, 0.9, 0.6, 0.9, 0.8, 2.3], None, 9, 0.36)
    _pie(s, prs, pie)

    # 6. Conclusiones automáticas
    s = prs.slides.add_slide(blank)
    _encabezado(s, "Conclusiones y acciones recomendadas", "Generadas por reglas del sistema; requieren validación de la gerencia", prs)
    lineas = []
    for r in port.to_dict("records") if not port.empty else []:
        if r["semaforo"] == "Rojo":
            lineas.append(f"• {r['proyecto_id']} en ROJO (SPI {fmt(r['spi'], '', 2)}, CPI {fmt(r['cpi'], '', 2)}): "
                          "escalar al sponsor, activar acción correctiva y re-planificar solo con aprobación.")
        elif r["semaforo"] == "Ámbar":
            lineas.append(f"• {r['proyecto_id']} en ÁMBAR: revisar supuestos, hitos y plan de respuesta.")
    for p in preds.to_dict("records") if not preds.empty else []:
        if p["semaforo"] == "Rojo":
            lineas.append(f"• KPI {p['kpi_id']} ({p['kpi']}): la predicción P50 {fmt(p['p50'], p['unidad'])} incumple el plan/meta; "
                          "revisar la hipótesis asociada.")
        elif p["semaforo"] == "Gris":
            lineas.append(f"• KPI {p['kpi_id']} ({p['kpi']}): datos insuficientes ({p['n_obs']} obs.); no decidir automáticamente.")
    if not lineas:
        lineas = ["• Todos los proyectos y KPI se encuentran dentro de lo planificado."]
    _texto(s, Inches(0.6), Inches(1.3), Inches(12.2), Inches(5.5), lineas[:14], 14)
    _pie(s, prs, pie)

    buf = io.BytesIO()
    prs.save(buf)
    datos = buf.getvalue()
    nombre = f"Reporte_Avance_{org_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pptx"
    if guardar_archivo:
        db.asegurar_directorio()
        with open(db.BASE_DIR + re.sub(r"[^\w.\-]", "_", nombre), "wb") as f:
            f.write(datos)
    with db.get_conn() as conn:
        conn.execute("INSERT INTO reporte(org_id, tipo, archivo, usuario) VALUES (?,?,?,?)", (org_id, "PPTX", nombre, usuario))
        db.auditar(conn, usuario, "reporte", nombre, "GENERAR_PPTX", None, {"org_id": org_id, "diapositivas": len(prs.slides)})
    return datos, nombre
