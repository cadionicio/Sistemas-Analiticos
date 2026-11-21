# -*- coding: utf-8 -*-
"""
reporte_ppt.py - Presentación PPTX de avance del BSC (real vs proyectado).

Diapositivas: portada · resumen ejecutivo · mapa estratégico con semáforo · una por
perspectiva (tabla de KPI + gráfico nativo) · puente de valor (EVA) · iniciativas ·
Gantt resumido · alertas y decisiones. Gráficos nativos de PowerPoint (editables).
"""
from __future__ import annotations

import datetime as dt
import io

import pandas as pd
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION, XL_LABEL_POSITION
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Emu, Inches, Pt

import config
import finanzas as fz

FUENTE = "Calibri"


def _rgb(h: str) -> RGBColor:
    return RGBColor.from_string(h.lstrip("#").upper())


MARCA, ACCION, TEXTO2 = _rgb(config.COLOR["marca"]), _rgb(config.COLOR["accion"]), _rgb(config.COLOR["texto2"])
BLANCO, GRIS_F, NEGRO = _rgb("FFFFFF"), _rgb("F3F6FA"), _rgb("1A1A1A")
SEM = {k: _rgb(v) for k, v in config.COLOR_SEMAFORO.items()}
PERSP = {k: _rgb(v) for k, v in config.COLOR_PERSPECTIVA.items()}
ETI = {"VERDE": "Verde", "AMBAR": "Ámbar", "ROJO": "Rojo", "GRIS": "Gris", "N/A": "Sin dato"}


# ------------------------------------------------------------------ utilidades de dibujo
def _texto(slide, x, y, w, h, texto, tam=14, color=NEGRO, negrita=False, alinear=PP_ALIGN.LEFT, ancla=MSO_ANCHOR.TOP):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = ancla
    tf.margin_left = tf.margin_right = Inches(0.02)
    lineas = texto if isinstance(texto, list) else [texto]
    for i, linea in enumerate(lineas):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = alinear
        r = p.add_run()
        r.text = str(linea)
        r.font.size, r.font.bold, r.font.color.rgb, r.font.name = Pt(tam), negrita, color, FUENTE
        p.space_after = Pt(4)
    return tb


def _caja(slide, x, y, w, h, relleno=BLANCO, borde=None, grosor=1.0, forma=MSO_SHAPE.ROUNDED_RECTANGLE):
    s = slide.shapes.add_shape(forma, Inches(x), Inches(y), Inches(w), Inches(h))
    s.fill.solid()
    s.fill.fore_color.rgb = relleno
    if borde is None:
        s.line.fill.background()
    else:
        s.line.color.rgb = borde
        s.line.width = Pt(grosor)
    s.shadow.inherit = False
    if forma == MSO_SHAPE.ROUNDED_RECTANGLE:
        s.adjustments[0] = 0.08
    return s


def _titulo(slide, titulo, subtitulo, pie):
    _caja(slide, 0, 0, 13.333, 0.08, MARCA, forma=MSO_SHAPE.RECTANGLE)
    _texto(slide, 0.5, 0.3, 12.3, 0.6, titulo, 26, MARCA, True)
    if subtitulo:
        _texto(slide, 0.5, 0.88, 12.3, 0.4, subtitulo, 13, TEXTO2)
    _texto(slide, 0.5, 7.05, 12.3, 0.3, pie, 9, TEXTO2)


def _tarjeta(slide, x, y, w, h, etiqueta, valor, sub="", color=MARCA):
    _caja(slide, x, y, w, h, BLANCO, _rgb("D5DEEA"))
    _texto(slide, x + 0.15, y + 0.1, w - 0.3, 0.3, etiqueta.upper(), 10, TEXTO2)
    _texto(slide, x + 0.15, y + 0.38, w - 0.3, 0.6, valor, 26, color, True)
    if sub:
        _texto(slide, x + 0.15, y + h - 0.42, w - 0.3, 0.35, sub, 10, TEXTO2)


def _tabla(slide, x, y, w, df: pd.DataFrame, anchos: list[float], sem_col: str | None = None, tam=10, alto_fila=0.3):
    filas, cols = len(df) + 1, len(df.columns)
    t = slide.shapes.add_table(filas, cols, Inches(x), Inches(y), Inches(w), Inches(alto_fila * filas)).table
    total = sum(anchos)
    for j, a in enumerate(anchos):
        t.columns[j].width = Emu(int(Inches(w) * a / total))
    for j, c in enumerate(df.columns):
        cel = t.cell(0, j)
        cel.fill.solid()
        cel.fill.fore_color.rgb = MARCA
        _celda(cel, c, tam, BLANCO, True)
    for i, fila in enumerate(df.itertuples(index=False), 1):
        for j, v in enumerate(fila):
            cel = t.cell(i, j)
            cel.fill.solid()
            cel.fill.fore_color.rgb = GRIS_F if i % 2 == 0 else BLANCO
            color, negrita = NEGRO, False
            if sem_col and df.columns[j] == sem_col:
                color, negrita = SEM.get(_clave_sem(v), NEGRO), True
            _celda(cel, v, tam, color, negrita)
    return t


def _clave_sem(v):
    return {e: k for k, e in ETI.items()}.get(v, v)


def _celda(cel, v, tam, color, negrita):
    cel.margin_left = cel.margin_right = Inches(0.05)
    cel.margin_top = cel.margin_bottom = Inches(0.02)
    tf = cel.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    r = p.add_run()
    r.text = "" if v is None or (isinstance(v, float) and pd.isna(v)) else str(v)
    r.font.size, r.font.color.rgb, r.font.bold, r.font.name = Pt(tam), color, negrita, FUENTE


def _estilo_grafico(ch, titulo, leyenda=True):
    ch.has_title = True
    ch.chart_title.text_frame.text = titulo
    ch.chart_title.text_frame.paragraphs[0].runs[0].font.size = Pt(12)
    ch.chart_title.text_frame.paragraphs[0].runs[0].font.bold = True
    ch.has_legend = leyenda
    if leyenda:
        ch.legend.position = XL_LEGEND_POSITION.BOTTOM
        ch.legend.include_in_layout = False
        ch.legend.font.size = Pt(10)
    try:
        ch.value_axis.major_gridlines.format.line.color.rgb = _rgb("E3E8EF")
        ch.value_axis.tick_labels.font.size = Pt(9)
        ch.category_axis.tick_labels.font.size = Pt(9)
        ch.value_axis.format.line.fill.background()
    except (AttributeError, ValueError):
        pass


# ------------------------------------------------------------------ generación
def generar(ctx: dict) -> bytes:
    """
    ctx: empresa (dict), anio, escenario, periodo_id, objetivos, relaciones, kpis, kpi_valores,
         evaluacion (evaluar_kpis), pronostico, financieros (tabla_financiera_mensual),
         escenarios (tabla_escenarios del año), iniciativas, seguimiento, gantt, gatillos (evaluados),
         riesgos, narrativa (texto), usuario.
    """
    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
    vacio = prs.slide_layouts[6]
    emp = ctx["empresa"]
    nombre = emp.get("razon_social", "")
    per, anio, esc = ctx["periodo_id"], ctx["anio"], ctx["escenario"]
    pie = f"{nombre} · BSC {anio} · escenario {esc} · corte {per} · GESTIÓN Y CONTROL ESTRATÉGICO IA"
    ev = ctx["evaluacion"].copy()
    obj = ctx["objetivos"]
    ev = ev.merge(obj[["objetivo_id", "perspectiva", "nombre"]].rename(columns={"nombre": "objetivo"}), on="objetivo_id", how="left")

    # 1. Portada
    s = prs.slides.add_slide(vacio)
    _caja(s, 0, 0, 13.333, 7.5, MARCA, forma=MSO_SHAPE.RECTANGLE)
    _caja(s, 0.8, 2.2, 0.12, 2.6, ACCION, forma=MSO_SHAPE.RECTANGLE)
    _texto(s, 1.2, 2.1, 11, 0.5, "REPORTE DE AVANCE DEL BALANCED SCORECARD", 16, _rgb("BFD3EA"), True)
    _texto(s, 1.2, 2.6, 11, 1.2, nombre, 40, BLANCO, True)
    _texto(s, 1.2, 3.8, 11, 0.5, f"Real vs proyectado · Plan {anio} · Escenario {esc} · Corte al {per}", 20, BLANCO)
    _texto(s, 1.2, 6.3, 11, 0.4, f"Generado el {dt.datetime.now():%d/%m/%Y %H:%M} por {ctx.get('usuario', '')} · GESTIÓN Y CONTROL ESTRATÉGICO IA",
           12, _rgb("BFD3EA"))

    # 2. Resumen ejecutivo
    s = prs.slides.add_slide(vacio)
    _titulo(s, "Resumen ejecutivo", f"Situación al {per}", pie)
    fin = ctx["financieros"]
    eva_meta = eva_real = None
    if fin is not None and not fin.empty:
        m = fin[(fin["tipo_valor"] == "Meta") & (fin["periodo_id"] <= per)]
        r = fin[(fin["tipo_valor"] == "Real") & (fin["periodo_id"] <= per)]
        eva_meta = m["eva"].sum() if not m.empty else None
        eva_real = r["eva"].sum() if not r.empty else None
    tab = ctx["escenarios"]
    fila = tab[tab["escenario"] == esc] if tab is not None and not tab.empty else pd.DataFrame()
    cnt = ev["semaforo"].value_counts().to_dict()
    tarjetas = [
        ("EVA acumulado real", fz.fmt_monto(eva_real), f"Trayectoria {fz.fmt_monto(eva_meta)}",
         SEM["VERDE"] if (eva_real or 0) >= (eva_meta or 0) else SEM["AMBAR"]),
        (f"EVA plan {esc}", fz.fmt_monto(fila["eva"].iloc[0]) if not fila.empty else "—",
         f"ROIC {fila['roic'].iloc[0]:.2%} vs WACC {fila['wacc'].iloc[0]:.2%}" if not fila.empty else "", MARCA),
        ("KPI en verde", f"{cnt.get('VERDE', 0)} / {len(ev)}",
         f"Ámbar {cnt.get('AMBAR', 0)} · Rojo {cnt.get('ROJO', 0)} · Gris {cnt.get('GRIS', 0)}", SEM["VERDE"]),
        ("Iniciativas en rojo", str(ctx.get("n_ini_rojas", 0)), f"de {len(ctx['iniciativas'])} en el portafolio",
         SEM["ROJO"] if ctx.get("n_ini_rojas") else SEM["VERDE"]),
    ]
    for i, (a, b, c, col) in enumerate(tarjetas):
        _tarjeta(s, 0.5 + i * 3.1, 1.45, 2.95, 1.55, a, b, c, col)
    parrafos = [p.replace("**", "").replace("_", "") for p in ctx.get("narrativa", "").split("\n\n") if p.strip()]
    _caja(s, 0.5, 3.25, 12.3, 3.6, GRIS_F)
    _texto(s, 0.75, 3.4, 11.8, 3.3, parrafos or ["Sin narrativa."], 13, NEGRO)

    # 3. Mapa estratégico
    s = prs.slides.add_slide(vacio)
    _titulo(s, "Mapa estratégico", "Color del borde = peor semáforo de los KPI del objetivo", pie)
    sem_obj = {}
    for o, g in ev.groupby("objetivo_id"):
        orden = {"ROJO": 0, "AMBAR": 1, "GRIS": 2, "VERDE": 3, "N/A": 4}
        sem_obj[o] = min(g["semaforo"], key=lambda x: orden.get(x, 9))
    pos, cajas = {}, []
    for i, p in enumerate(config.PERSPECTIVAS):          # 1) carriles y posiciones
        y = 1.4 + i * 1.38
        _caja(s, 0.5, y, 12.3, 1.22, _rgb("F5F7FA"), forma=MSO_SHAPE.RECTANGLE)
        _texto(s, 0.6, y + 0.05, 2.0, 0.3, p.upper(), 10, PERSP[p], True)
        d = obj[obj["perspectiva"] == p].sort_values("orden")
        n = len(d)
        for j, r in enumerate(d.itertuples()):
            w = min(2.6, 10.0 / max(n, 1) - 0.25)
            x = 2.2 + (10.4 / n) * j + (10.4 / n - w) / 2
            cajas.append((r, p, x, y, w))
            pos[r.objetivo_id] = (x + w / 2, y + 0.28, y + 1.08)
    rel = ctx["relaciones"]                                # 2) flechas (debajo de las cajas)
    for r in rel.itertuples() if rel is not None and not rel.empty else []:
        if r.objetivo_origen in pos and r.objetivo_destino in pos:
            xo, top_o, _ = pos[r.objetivo_origen]
            xd, _, bot_d = pos[r.objetivo_destino]
            if bot_d <= top_o:
                c = s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(xo), Inches(top_o), Inches(xd), Inches(bot_d))
                c.line.color.rgb = _rgb("9AA7B8")
                c.line.width = Pt(1)
                _flecha(c)
    for r, p, x, y, w in cajas:                            # 3) cajas de objetivos
        b = _caja(s, x, y + 0.28, w, 0.8, BLANCO, SEM.get(sem_obj.get(r.objetivo_id), PERSP[p]), 2.5)
        tf = b.text_frame
        tf.word_wrap = True
        tf.paragraphs[0].alignment = PP_ALIGN.CENTER
        run = tf.paragraphs[0].add_run()
        run.text = f"{r.objetivo_id} {r.nombre}"
        run.font.size, run.font.color.rgb, run.font.name = Pt(10), NEGRO, FUENTE
    x = 0.5
    for k in ["VERDE", "AMBAR", "ROJO", "GRIS"]:
        _caja(s, x, 6.85, 0.18, 0.14, SEM[k], forma=MSO_SHAPE.RECTANGLE)
        _texto(s, x + 0.22, 6.78, 1.0, 0.3, ETI[k], 9, TEXTO2)
        x += 1.1

    # 4-7. Una diapositiva por perspectiva
    pron = ctx.get("pronostico")
    if pron is not None and not pron.empty:
        ev = ev.merge(pron, on="kpi_id", how="left")
    for p in config.PERSPECTIVAS:
        d = ev[ev["perspectiva"] == p]
        s = prs.slides.add_slide(vacio)
        _titulo(s, f"Perspectiva {p}", f"KPI: línea base, trayectoria al {per}, real y pronóstico de cierre", pie)
        if d.empty:
            _texto(s, 0.5, 1.6, 12, 0.5, "Sin indicadores en esta perspectiva.", 14, TEXTO2)
            continue
        vista = pd.DataFrame({
            "KPI": [f"{r.kpi_id} {r.nombre}" for r in d.itertuples()],
            "Base": [fz.fmt_valor(v, u) for v, u in zip(d["linea_base"], d["unidad"])],
            "Meta año": [fz.fmt_valor(v, u) for v, u in zip(d["meta"], d["unidad"])],
            "Trayectoria": [fz.fmt_valor(v, u) for v, u in zip(d["meta_periodo"], d["unidad"])],
            "Real": [fz.fmt_valor(v, u) for v, u in zip(d["real"], d["unidad"])],
            "Estado": [ETI.get(x, x) for x in d["semaforo"]],
            "Cierre": [fz.fmt_valor(v, u) for v, u in zip(d.get("cierre_pronosticado", [None] * len(d)), d["unidad"])],
        })
        _tabla(s, 0.5, 1.45, 7.3, vista, [3.2, 0.9, 0.9, 1.0, 0.9, 0.8, 0.9], "Estado", 10, 0.42)
        datos = CategoryChartData()
        datos.categories = list(d["kpi_id"])
        datos.add_series("Cumplimiento vs trayectoria (%)",
                         [round(float(c) * 100, 1) if c is not None and not pd.isna(c) else 0 for c in d["cumplimiento"]])
        gf = s.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(8.1), Inches(1.45), Inches(4.8), Inches(4.2), datos)
        ch = gf.chart
        _estilo_grafico(ch, "Cumplimiento vs trayectoria (%)", leyenda=False)
        pl = ch.plots[0]
        pl.gap_width = 60
        pl.has_data_labels = True
        pl.data_labels.number_format = '0"%"'
        pl.data_labels.number_format_is_linked = False
        pl.data_labels.position = XL_LABEL_POSITION.OUTSIDE_END
        pl.data_labels.font.size = Pt(9)
        for i, sem in enumerate(d["semaforo"]):
            pt = pl.series[0].points[i]
            pt.format.fill.solid()
            pt.format.fill.fore_color.rgb = SEM.get(sem, SEM["GRIS"])
        rojos = d[d["semaforo"].isin(["ROJO", "AMBAR"])]
        msg = ("Atención: " + "; ".join(f"{r.kpi_id} ({ETI[r.semaforo]}), responsable {r.responsable}" for r in rojos.itertuples())
               if len(rojos) else "Todos los KPI de la perspectiva están en trayectoria o sin dato certificado.")
        _caja(s, 8.1, 5.8, 4.8, 1.1, GRIS_F)
        _texto(s, 8.25, 5.88, 4.5, 1.0, msg, 10, NEGRO)

    # 8. Puente de valor
    s = prs.slides.add_slide(vacio)
    _titulo(s, "Creación de valor (EVA)", "EVA acumulado mensual: trayectoria del plan vs real (S/ millones)", pie)
    if fin is not None and not fin.empty:
        meses = sorted(fin["periodo_id"].unique())
        m = fin[fin["tipo_valor"] == "Meta"].set_index("periodo_id")["eva_acum"]
        r = fin[fin["tipo_valor"] == "Real"].set_index("periodo_id")["eva_acum"]
        datos = CategoryChartData()
        datos.categories = [x[-2:] + "/" + x[2:4] for x in meses]
        datos.add_series("Trayectoria (meta)", [round(float(m.get(x)), 3) if x in m.index else None for x in meses])
        datos.add_series("Real", [round(float(r.get(x)), 3) if x in r.index else None for x in meses])
        gf = s.shapes.add_chart(XL_CHART_TYPE.LINE_MARKERS, Inches(0.5), Inches(1.45), Inches(8.2), Inches(5.4), datos)
        ch = gf.chart
        _estilo_grafico(ch, "EVA acumulado (S/ m)")
        for serie, col in zip(ch.plots[0].series, (MARCA, ACCION)):
            serie.format.line.color.rgb = col
            serie.format.line.width = Pt(2.25)
            serie.marker.format.fill.solid()
            serie.marker.format.fill.fore_color.rgb = col
    if tab is not None and not tab.empty:
        vista = pd.DataFrame({"Escenario": tab["escenario"], "Ventas": tab["ventas"].map("{:,.1f}".format),
                              "ROIC": tab["roic"].map("{:.2%}".format), "WACC": tab["wacc"].map("{:.2%}".format),
                              "EVA": tab["eva"].map("{:,.2f}".format)})
        _texto(s, 9.0, 1.45, 3.9, 0.3, f"Escenarios {anio} (S/ m)", 12, MARCA, True)
        _tabla(s, 9.0, 1.85, 3.9, vista, [1.3, 0.9, 0.8, 0.8, 0.8], None, 10, 0.36)
        _caja(s, 9.0, 4.0, 3.9, 2.85, GRIS_F)
        _texto(s, 9.15, 4.1, 3.6, 2.7, [
            "EVA = NOPAT − WACC × Capital",
            f"Brecha acumulada al {per}: {fz.fmt_monto((eva_real or 0) - (eva_meta or 0))}",
            "Un KPI en verde no equivale a EVA: la atribución requiere línea base y validación de Finanzas."], 11, NEGRO)

    # 9. Iniciativas
    s = prs.slides.add_slide(vacio)
    _titulo(s, "Portafolio de iniciativas", f"Avance plan vs real al {per}", pie)
    seg = ctx["seguimiento"]
    ini = ctx["iniciativas"]
    if not ini.empty:
        sp = seg[seg["periodo_id"] == per] if not seg.empty else seg
        d = ini.merge(sp[["iniciativa_id", "avance_plan", "avance_real", "gasto_plan", "gasto_real"]], on="iniciativa_id", how="left") \
            if not sp.empty else ini.assign(avance_plan=None, avance_real=None, gasto_plan=None, gasto_real=None)
        d["sem"] = [fz.semaforo_iniciativa(a, b) for a, b in zip(d["avance_plan"], d["avance_real"])]
        vista = pd.DataFrame({
            "Iniciativa": [f"{r.iniciativa_id} {str(r.nombre)[:38]}" for r in d.itertuples()], "Tipo": d["tipo"],
            "Responsable": d["responsable"].astype(str).str[:22],
            "Plan": d["avance_plan"].map(lambda v: "—" if pd.isna(v) else f"{v:.0%}"),
            "Real": d["avance_real"].map(lambda v: "—" if pd.isna(v) else f"{v:.0%}"),
            "Estado": [ETI.get(x, x) for x in d["sem"]]})
        _tabla(s, 0.5, 1.45, 7.6, vista.head(12), [3.3, 1.0, 1.7, 0.6, 0.6, 0.8], "Estado", 9, 0.38)
        datos = CategoryChartData()
        datos.categories = list(d["iniciativa_id"].head(12))
        datos.add_series("Plan", [0 if pd.isna(v) else round(float(v) * 100) for v in d["avance_plan"].head(12)])
        datos.add_series("Real", [0 if pd.isna(v) else round(float(v) * 100) for v in d["avance_real"].head(12)])
        gf = s.shapes.add_chart(XL_CHART_TYPE.BAR_CLUSTERED, Inches(8.4), Inches(1.45), Inches(4.5), Inches(5.4), datos)
        ch = gf.chart
        _estilo_grafico(ch, "Avance (%)")
        ch.plots[0].series[0].format.fill.solid()
        ch.plots[0].series[0].format.fill.fore_color.rgb = _rgb("B8C4D6")
        ch.plots[0].series[1].format.fill.solid()
        ch.plots[0].series[1].format.fill.fore_color.rgb = ACCION
        ch.category_axis.reverse_order = True

    # 10. Gantt resumido
    s = prs.slides.add_slide(vacio)
    _titulo(s, "Hoja de ruta de implementación", f"Gantt resumido {anio} · línea vertical = corte {per}", pie)
    g = ctx["gantt"]
    if g is not None and not g.empty:
        g = g.copy()
        g["ini"] = pd.to_datetime(g["fecha_inicio"], errors="coerce")
        g["fin"] = pd.to_datetime(g["fecha_fin"], errors="coerce")
        g = g.dropna(subset=["ini", "fin"]).sort_values(["ini"])
        resumen = g[g["iniciativa_id"] == "FASE"]
        otras = g[g["iniciativa_id"] != "FASE"].groupby("iniciativa_id").agg(ini=("ini", "min"), fin=("fin", "max"), avance=("avance", "mean")).reset_index()
        nombres = dict(zip(ini["iniciativa_id"], ini["nombre"])) if not ini.empty else {}
        barras = [(r.tarea, r.ini, r.fin, r.avance or 0, MARCA) for r in resumen.itertuples()]
        barras += [(f"{r.iniciativa_id} {str(nombres.get(r.iniciativa_id, ''))[:34]}", r.ini, r.fin, r.avance or 0, ACCION) for r in otras.itertuples()]
        barras = barras[:18]
        t0, t1 = pd.Timestamp(f"{anio}-01-01"), pd.Timestamp(f"{anio}-12-31")
        x0, ancho = 4.2, 8.6
        for mnum in range(12):
            xm = x0 + ancho * mnum / 12
            _texto(s, xm, 1.35, ancho / 12, 0.25, ["E", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"][mnum], 9, TEXTO2, alinear=PP_ALIGN.CENTER)
        alto = min(0.3, 5.2 / max(len(barras), 1))
        for i, (nom, a, b, av, col) in enumerate(barras):
            y = 1.65 + i * alto
            _texto(s, 0.5, y - 0.02, 3.6, alto, nom, 9, NEGRO)
            xa = x0 + ancho * max(0, (a - t0).days) / (t1 - t0).days
            xb = x0 + ancho * min((t1 - t0).days, (b - t0).days) / (t1 - t0).days
            _caja(s, xa, y + 0.03, max(0.05, xb - xa), alto * 0.7, _rgb("D5DEEA"), forma=MSO_SHAPE.RECTANGLE)
            if av and av > 0:
                _caja(s, xa, y + 0.03, max(0.03, (xb - xa) * min(1, float(av))), alto * 0.7, col, forma=MSO_SHAPE.RECTANGLE)
        try:
            corte = pd.Timestamp(per + "-01") + pd.offsets.MonthEnd(0)
            xc = x0 + ancho * (corte - t0).days / (t1 - t0).days
            c = s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(xc), Inches(1.6), Inches(xc), Inches(1.65 + len(barras) * alto))
            c.line.color.rgb = SEM["ROJO"]
            c.line.width = Pt(1.5)
        except ValueError:
            pass
    else:
        _texto(s, 0.5, 1.6, 12, 0.5, "Sin cronograma aprobado.", 14, TEXTO2)

    # 11. Alertas y decisiones
    s = prs.slides.add_slide(vacio)
    _titulo(s, "Alertas, riesgos y decisiones requeridas", "Gatillos preacordados y registro de riesgos", pie)
    gat = ctx.get("gatillos")
    if gat is not None and not gat.empty:
        vista = gat[["gatillo", "indicador", "estado", "detalle", "accion", "responsable"]].rename(columns={
            "gatillo": "Gatillo", "indicador": "Indicador", "estado": "Estado", "detalle": "Evidencia",
            "accion": "Acción preacordada", "responsable": "Dueño"})
        _tabla(s, 0.5, 1.45, 12.3, vista, [0.7, 1.6, 1.0, 3.6, 3.2, 1.6], None, 9, 0.4)
    ries = ctx.get("riesgos")
    y = 1.45 + 0.4 * ((len(gat) if gat is not None else 0) + 1) + 0.3
    if ries is not None and not ries.empty:
        r2 = ries.assign(sev=ries["probabilidad_1_5"] * ries["impacto_1_5"]).sort_values("sev", ascending=False).head(5)
        _texto(s, 0.5, y, 12, 0.3, "Riesgos de mayor severidad", 12, MARCA, True)
        vista = pd.DataFrame({"Riesgo": r2["riesgo"], "Señal": r2["senal"], "Control": r2["control_preventivo"],
                              "Severidad": r2["sev"].map(lambda v: f"{v:.0f}"), "Dueño": r2["responsable"]})
        _tabla(s, 0.5, y + 0.35, 12.3, vista, [2.0, 2.6, 4.2, 1.0, 1.8], None, 9, 0.34)
    decisiones = ctx.get("decisiones") or []
    if decisiones:
        _caja(s, 0.5, 6.1, 12.3, 0.85, _rgb("FFF4E5"))
        _texto(s, 0.7, 6.15, 11.9, 0.8, ["Decisiones requeridas: " + " · ".join(decisiones)], 11, NEGRO, True)

    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()


def _flecha(conector):
    """Agrega punta de flecha al final de un conector (XML DrawingML)."""
    from pptx.oxml.ns import qn
    ln = conector.line._get_or_add_ln()
    tail = ln.find(qn("a:tailEnd"))
    if tail is None:
        from lxml import etree
        tail = etree.SubElement(ln, qn("a:tailEnd"))
    tail.set("type", "triangle")
    tail.set("w", "med")
    tail.set("h", "med")
