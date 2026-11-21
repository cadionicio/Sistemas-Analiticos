# -*- coding: utf-8 -*-
"""
vistas_control.py - Ejecución y control.

Páginas: Seguimiento de iniciativas · Dashboard (proyectado vs real) · Gantt ·
Simulador EVA · Reportes PPT.
"""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

import config
import db
import finanzas as fz
import motor_ia as ia
import reporte_ppt
import simulador as sim
import ui
from vistas_bsc import figura_mapa, semaforo_objetivos
from vistas_plan import _empresa, panel_aprobacion

C = config.COLOR
ORDEN_SEM = {"ROJO": 0, "AMBAR": 1, "GRIS": 2, "VERDE": 3, "N/A": 4}


def _layout(fig, alto=320, titulo=None, **kw):
    fig.update_layout(height=alto, plot_bgcolor="white", margin=dict(l=10, r=10, t=40 if titulo else 10, b=10),
                      title=titulo, legend=dict(orientation="h", y=-0.2), **kw)
    fig.update_yaxes(gridcolor="#EEF1F5", zerolinecolor="#C8D2E0")
    return fig


def _guardar(tabla, df, e, msg):
    try:
        n = db.reemplazar(tabla, df, e, ui.usuario()["usuario"])
        ui.refrescar()
        st.session_state["_toast"] = f"{msg}: {n} registros guardados."
        st.rerun()
    except ValueError as ex:
        st.error(f"No se guardó. {ex}")


# ============================================================ Datos de control compartidos
def datos_control(e: str) -> dict:
    c = ui.ctx()
    return calcular_control(e, c["anio"], c["escenario"], c["periodo_id"], ui.leer, ui.nombre_empresa(e))


def calcular_control(e: str, anio: str, escenario: str, per: str, leer=db.leer, nombre: str = "") -> dict:
    """Consolida KPI, finanzas, iniciativas y gatillos del periodo de control (sin interfaz)."""
    c = {"escenario": escenario}
    kpis, vals, obj = leer("kpis", e), leer("kpi_valores", e), leer("objetivos", e)
    ev = fz.evaluar_kpis(kpis, vals, per)
    ev = ev.merge(obj[["objetivo_id", "perspectiva"]], on="objetivo_id", how="left")
    pron = ia.pronostico_kpis(ev, vals, anio) if not ev.empty else pd.DataFrame(columns=["kpi_id"])
    fin = leer("financieros", e)
    fin = fin[(fin["escenario"] == c["escenario"]) & fin["periodo_id"].astype(str).str.startswith(anio)]
    fin = fz.tabla_financiera_mensual(fin) if not fin.empty else fin
    eva_meta = eva_real = None
    if not fin.empty:
        m, r = fin[(fin["tipo_valor"] == "Meta") & (fin["periodo_id"] <= per)], fin[(fin["tipo_valor"] == "Real") & (fin["periodo_id"] <= per)]
        eva_meta = float(m["eva"].sum()) if not m.empty else None
        eva_real = float(r["eva"].sum()) if not r.empty else None
    ini, seg = leer("iniciativas", e), leer("seguimiento", e)
    sp = seg[seg["periodo_id"] == per]
    ini_s = ini.merge(sp[["iniciativa_id", "avance_plan", "avance_real", "gasto_plan", "gasto_real", "beneficio_validado", "comentario"]],
                      on="iniciativa_id", how="left")
    ini_s["semaforo"] = [fz.semaforo_iniciativa(a, b) for a, b in zip(ini_s["avance_plan"], ini_s["avance_real"])]
    gat = ia.evaluar_gatillos(leer("gatillos", e), ev, vals, db.leer("simulaciones", e), kpis)
    esc = leer("escenarios", e)
    tabla = fz.tabla_escenarios(esc[esc["anio"] == anio])
    rojas = ini_s.loc[ini_s["semaforo"] == "ROJO", "iniciativa_id"].tolist()
    activos = gat.loc[gat["estado"] == "ACTIVADO", "gatillo"].tolist() if not gat.empty else []
    narr = ia.narrativa_control(nombre or e, per, ev, eva_meta, eva_real, rojas, activos, pron)
    return {"ev": ev, "pron": pron, "fin": fin, "eva_meta": eva_meta, "eva_real": eva_real, "ini": ini_s,
            "seg": seg, "gat": gat, "tabla": tabla, "kpis": kpis, "vals": vals, "obj": obj, "rojas": rojas,
            "activos": activos, "narrativa": narr}


# ============================================================ Seguimiento
def pagina_seguimiento() -> None:
    ui.mostrar_toast()
    ui.encabezado("Seguimiento de iniciativas", "Control del portafolio: avance, gasto, beneficio y alertas")
    e = ui.requiere_empresa()
    if not e:
        return
    c = ui.ctx()
    d = datos_control(e)
    ini = d["ini"]
    if ini.empty:
        st.info("No hay iniciativas. Genérelas en Mapa y BSC → Iniciativas.")
        return
    k = st.columns(5)
    cnt = ini["semaforo"].value_counts().to_dict()
    k[0].metric("Iniciativas", len(ini))
    k[1].metric("En verde", cnt.get("VERDE", 0))
    k[2].metric("En ámbar", cnt.get("AMBAR", 0))
    k[3].metric("En rojo", cnt.get("ROJO", 0))
    gasto = ini["gasto_real"].sum()
    k[4].metric("Gasto real vs plan", fz.fmt_monto(gasto), f"{(gasto / ini['gasto_plan'].sum() - 1):+.1%}" if ini["gasto_plan"].sum() else None,
                delta_color="inverse")
    t1, t2, t3, t4 = st.tabs(["📋 Portafolio", f"✍️ Registrar avance {c['periodo_id']}", "📈 Evolución", "🚨 Alertas"])
    with t1:
        vista = ini.assign(estado_sem=ini["semaforo"].map(ui.ETIQUETA_SEMAFORO),
                           brecha=ini["avance_real"] - ini["avance_plan"])
        cols = ["iniciativa_id", "nombre", "tipo", "objetivo_id", "responsable", "puerta", "estado", "avance_plan",
                "avance_real", "brecha", "gasto_plan", "gasto_real", "beneficio_validado", "semaforo"]
        st.dataframe(ui.estilo_semaforo(vista[cols]).format({"avance_plan": "{:.0%}", "avance_real": "{:.0%}", "brecha": "{:+.0%}",
                                                            "gasto_plan": "{:,.3f}", "gasto_real": "{:,.3f}",
                                                            "beneficio_validado": "{:,.3f}"}, na_rep="—"),
                     hide_index=True, width="stretch")
        st.markdown("##### Actualizar estado y puerta")
        ed = st.data_editor(ini[["iniciativa_id", "nombre", "estado", "puerta"]], hide_index=True, width="stretch",
                            key=f"ed_estado_{e}", disabled=["iniciativa_id", "nombre"] if ui.puede("seguimiento") else True,
                            column_config={"estado": st.column_config.SelectboxColumn("estado", options=config.ESTADOS_INICIATIVA),
                                           "puerta": st.column_config.SelectboxColumn("puerta", options=config.PUERTAS)})
        if st.button("💾 Guardar estados", disabled=not ui.puede("seguimiento")):
            base = ui.leer("iniciativas", e).drop(columns=["empresa_id"]).set_index("iniciativa_id")
            base.update(ed.set_index("iniciativa_id")[["estado", "puerta"]])
            _guardar("iniciativas", base.reset_index().assign(empresa_id=e), e, "Estados de iniciativas")
    with t2:
        _registrar_avance(e, c["periodo_id"], ui.leer("iniciativas", e), d["seg"])
    with t3:
        seg = d["seg"]
        if seg.empty:
            st.info("Sin registros de seguimiento.")
        else:
            sel = st.multiselect("Iniciativas", ini["iniciativa_id"].tolist(), default=ini["iniciativa_id"].tolist()[:4])
            fig = go.Figure()
            paleta = ["#1F3A5F", "#0E7C86", "#3F6FB5", "#6A8E3A", "#B26B00", "#7B4DA0", "#C62828", "#5A6B7F"]
            for i, iid in enumerate(sel):
                s_ = seg[seg["iniciativa_id"] == iid].sort_values("periodo_id")
                col = paleta[i % len(paleta)]
                fig.add_scatter(x=s_["periodo_id"], y=s_["avance_plan"], name=f"{iid} plan", line=dict(color=col, dash="dot"))
                fig.add_scatter(x=s_["periodo_id"], y=s_["avance_real"], name=f"{iid} real", line=dict(color=col))
            fig.update_yaxes(tickformat=".0%")
            st.plotly_chart(_layout(fig, 380, "Curva S de avance: plan (punteado) vs real"), width="stretch")
            g = seg.groupby("periodo_id")[["gasto_plan", "gasto_real", "beneficio_validado"]].sum().cumsum().reset_index()
            fig2 = go.Figure()
            fig2.add_scatter(x=g["periodo_id"], y=g["gasto_plan"], name="Gasto plan acumulado", line=dict(color=C["gris"], dash="dot"))
            fig2.add_scatter(x=g["periodo_id"], y=g["gasto_real"], name="Gasto real acumulado", line=dict(color=C["marca"]))
            fig2.add_bar(x=g["periodo_id"], y=g["beneficio_validado"], name="Beneficio validado acumulado", marker_color=C["accion"], opacity=0.6)
            st.plotly_chart(_layout(fig2, 320, "Gasto y beneficio del portafolio (S/ m)"), width="stretch")
    with t4:
        alertas = []
        for r in ini.itertuples():
            if r.semaforo == "ROJO":
                alertas.append(("ROJO", r.iniciativa_id, f"Retraso de {abs(r.avance_real - r.avance_plan):.0%} frente al plan", r.responsable))
            elif r.semaforo == "AMBAR":
                alertas.append(("ÁMBAR", r.iniciativa_id, f"Retraso leve de {abs(r.avance_real - r.avance_plan):.0%}", r.responsable))
            if pd.notna(r.gasto_plan) and r.gasto_plan and pd.notna(r.gasto_real) and r.gasto_real > r.gasto_plan * 1.10:
                alertas.append(("ÁMBAR", r.iniciativa_id, f"Sobrecosto de {r.gasto_real / r.gasto_plan - 1:.0%}", r.responsable))
            if r.estado == "No iniciada" and pd.notna(r.fecha_inicio) and str(r.fecha_inicio) < f"{c['periodo_id']}-01":
                alertas.append(("ROJO", r.iniciativa_id, "Debió iniciar y no ha iniciado", r.responsable))
            if isinstance(r.comentario, str) and r.comentario.strip():
                alertas.append(("INFO", r.iniciativa_id, r.comentario, r.responsable))
        if alertas:
            st.dataframe(pd.DataFrame(alertas, columns=["nivel", "iniciativa", "alerta", "responsable"]), hide_index=True, width="stretch")
        else:
            st.success("Sin alertas en el periodo.")


def _registrar_avance(e, per, ini, seg) -> None:
    st.caption("El avance planificado se propone en forma lineal según las fechas de la iniciativa; ajústelo si el plan es distinto. "
               "Avance como fracción (0.45 = 45 %). Montos en S/ millones.")
    actual = seg[seg["periodo_id"] == per].set_index("iniciativa_id")
    filas = []
    for r in ini.itertuples():
        if r.iniciativa_id in actual.index:
            a = actual.loc[r.iniciativa_id]
            filas.append({"iniciativa_id": r.iniciativa_id, "nombre": r.nombre, "avance_plan": a["avance_plan"],
                          "avance_real": a["avance_real"], "gasto_plan": a["gasto_plan"], "gasto_real": a["gasto_real"],
                          "beneficio_validado": a["beneficio_validado"], "comentario": a["comentario"]})
        else:
            ap = ia.avance_planificado(r.fecha_inicio, r.fecha_fin, per)
            filas.append({"iniciativa_id": r.iniciativa_id, "nombre": r.nombre, "avance_plan": ap, "avance_real": None,
                          "gasto_plan": round((r.presupuesto or 0) * ap, 4), "gasto_real": None,
                          "beneficio_validado": None, "comentario": ""})
    df = pd.DataFrame(filas)
    ed = st.data_editor(df, hide_index=True, width="stretch", key=f"ed_seg_{e}_{per}", disabled=["iniciativa_id", "nombre"]
                        if ui.puede("seguimiento") else True,
                        column_config={"avance_plan": st.column_config.NumberColumn("avance plan", min_value=0.0, max_value=1.0, step=0.05, format="%.2f"),
                                       "avance_real": st.column_config.NumberColumn("avance real", min_value=0.0, max_value=1.0, step=0.05, format="%.2f"),
                                       "comentario": st.column_config.TextColumn("comentario", width="large")})
    if st.button("💾 Guardar avance del periodo", type="primary", disabled=not ui.puede("seguimiento")):
        nuevos = ed.drop(columns=["nombre"]).assign(empresa_id=e, periodo_id=per).dropna(subset=["avance_real"])
        resto = seg[seg["periodo_id"] != per].drop(columns=["id"], errors="ignore")
        if nuevos.empty:
            st.warning("Registre al menos un avance real.")
        else:
            _guardar("seguimiento", pd.concat([resto, nuevos], ignore_index=True), e, f"Seguimiento {per}")


# ============================================================ Dashboard
def pagina_dashboard() -> None:
    ui.mostrar_toast()
    c = ui.ctx()
    ui.encabezado("Dashboard de control estratégico", f"KPI proyectados vs reales · corte {c['periodo_id']} · escenario {c['escenario']}")
    e = ui.requiere_empresa()
    if not e:
        return
    d = datos_control(e)
    ev = d["ev"].merge(d["pron"], on="kpi_id", how="left") if not d["pron"].empty else d["ev"]
    if ev.empty:
        st.info("No hay KPI registrados. Genere el BSC en Mapa y BSC.")
        return
    f1, f2, f3 = st.columns([2, 1.2, 1])
    persp = f1.multiselect("Perspectivas", config.PERSPECTIVAS, default=config.PERSPECTIVAS)
    tipos = f2.multiselect("Tipo de KPI", ["Resultado", "Inductor"], default=["Resultado", "Inductor"])
    solo = f3.toggle("Solo desvíos", value=False)
    v = ev[ev["perspectiva"].isin(persp) & (ev["kpi_id"].isin(d["kpis"][d["kpis"]["tipo"].isin(tipos)]["kpi_id"]))]
    if solo:
        v = v[v["semaforo"].isin(["ROJO", "AMBAR"])]

    cnt = ev["semaforo"].value_counts().to_dict()
    k = st.columns(5)
    with k[0]:
        brecha = (d["eva_real"] or 0) - (d["eva_meta"] or 0)
        ui.tarjeta("EVA acumulado real", fz.fmt_monto(d["eva_real"]), f"Trayectoria {fz.fmt_monto(d['eva_meta'])} ({brecha:+.2f})",
                   C["verde"] if brecha >= 0 else C["ambar"])
    with k[1]:
        fila = d["tabla"][d["tabla"]["escenario"] == c["escenario"]]
        ui.tarjeta(f"EVA plan {c['anio']}", fz.fmt_monto(fila["eva"].iloc[0]) if not fila.empty else "—",
                   f"ROIC {fila['roic'].iloc[0]:.2%}" if not fila.empty else "", C["marca"])
    with k[2]:
        ui.tarjeta("KPI en verde", f"{cnt.get('VERDE', 0)} / {len(ev)}", f"{cnt.get('AMBAR', 0)} ámbar · {cnt.get('ROJO', 0)} rojo · {cnt.get('GRIS', 0)} gris", C["verde"])
    with k[3]:
        riesgo = int((ev.get("logra_meta") == "En riesgo").sum()) if "logra_meta" in ev else 0
        ui.tarjeta("KPI en riesgo al cierre", str(riesgo), "Pronóstico Holt vs meta anual", C["ambar"] if riesgo else C["verde"])
    with k[4]:
        ui.tarjeta("Gatillos activados", str(len(d["activos"])), f"Iniciativas en rojo: {len(d['rojas'])}",
                   C["rojo"] if d["activos"] or d["rojas"] else C["verde"])

    t1, t2, t3, t4, t5 = st.tabs(["📊 KPI proyectado vs real", "📈 Tendencias", "🗺️ Objetivos", "🚀 Iniciativas", "🤖 Alertas y narrativa"])
    with t1:
        a, b = st.columns([1.35, 1])
        with a:
            tabla = pd.DataFrame({
                "KPI": v["kpi_id"] + " " + v["nombre"].str.slice(0, 26),
                "Meta año": [fz.fmt_valor(x, u) for x, u in zip(v["meta"], v["unidad"])],
                "Proyectado": [fz.fmt_valor(x, u) for x, u in zip(v["meta_periodo"], v["unidad"])],
                "Real": [fz.fmt_valor(x, u) for x, u in zip(v["real"], v["unidad"])],
                "Cumpl.": v["cumplimiento"], "Estado": v["semaforo"],
                "Cierre pron.": [fz.fmt_valor(x, u) for x, u in zip(v.get("cierre_pronosticado", pd.Series([None] * len(v))), v["unidad"])]})
            st.dataframe(ui.estilo_semaforo(tabla, "Estado").format({"Cumpl.": "{:.0%}"}, na_rep="—"), hide_index=True,
                         width="stretch", height=520, column_config={"KPI": st.column_config.TextColumn(width="medium")})
        with b:
            fig = go.Figure(go.Bar(y=v["kpi_id"], x=v["cumplimiento"].fillna(0) * 100, orientation="h",
                                   marker_color=[config.COLOR_SEMAFORO.get(s_, C["gris"]) for s_ in v["semaforo"]],
                                   text=[f"{x * 100:.0f}%" if pd.notna(x) else "—" for x in v["cumplimiento"]], textposition="outside",
                                   hovertext=v["nombre"]))
            fig.add_vline(x=100, line_dash="dash", line_color=C["marca"])
            _layout(fig, 520, "Cumplimiento vs trayectoria (100 % = en meta; tope 150 %)", xaxis_title="%")
            fig.update_xaxes(range=[0, 175])
            fig.update_yaxes(autorange="reversed")
            st.plotly_chart(fig, width="stretch")
        st.markdown("##### Mapa de calor: semáforo mensual")
        _mapa_calor(v, d["kpis"], d["vals"], c["anio"])
    with t2:
        a, b = st.columns([1, 1])
        with a:
            sel = st.selectbox("KPI", v["kpi_id"], format_func=lambda x: f"{x} · {v.set_index('kpi_id').loc[x, 'nombre']}")
            _tendencia_kpi(sel, d["kpis"], d["vals"], c["anio"])
        with b:
            _grafico_eva(d["fin"])
    with t3:
        st.plotly_chart(figura_mapa(d["obj"], ui.leer("relaciones", e), semaforo_objetivos(e, c["periodo_id"]), alto=560), width="stretch")
        so = ev.assign(_o=ev["semaforo"].map(ORDEN_SEM)).sort_values("_o").groupby("objetivo_id").agg(
            semaforo=("semaforo", "first"), kpis=("kpi_id", ", ".join), cumplimiento=("cumplimiento", "mean")).reset_index()
        so = d["obj"][["objetivo_id", "perspectiva", "nombre", "responsable"]].merge(so, on="objetivo_id", how="left")
        st.dataframe(ui.estilo_semaforo(so.fillna({"semaforo": "N/A"})).format({"cumplimiento": "{:.0%}"}, na_rep="—"),
                     hide_index=True, width="stretch")
    with t4:
        ini = d["ini"]
        if ini.empty:
            st.info("Sin iniciativas.")
        else:
            fig = go.Figure()
            fig.add_bar(y=ini["iniciativa_id"], x=ini["avance_plan"].fillna(0), name="Plan", orientation="h", marker_color="#B8C4D6")
            fig.add_bar(y=ini["iniciativa_id"], x=ini["avance_real"].fillna(0), name="Real", orientation="h",
                        marker_color=[config.COLOR_SEMAFORO.get(s_, C["accion"]) for s_ in ini["semaforo"]])
            fig.update_xaxes(tickformat=".0%", range=[0, 1.05])
            fig.update_yaxes(autorange="reversed")
            _layout(fig, 420, f"Avance de iniciativas al {c['periodo_id']}", barmode="group")
            a, b = st.columns([1.3, 1])
            a.plotly_chart(fig, width="stretch")
            por_tipo = ini.groupby("tipo").agg(n=("iniciativa_id", "count"), presupuesto=("presupuesto", "sum"),
                                                 beneficio=("beneficio_bruto_anual", "sum"), costo=("costo_anual", "sum")).reset_index()
            fig2 = go.Figure(go.Pie(labels=por_tipo["tipo"], values=por_tipo["presupuesto"], hole=0.55,
                                    marker_colors=[C["accion"], C["marca"]]))
            b.plotly_chart(_layout(fig2, 300, "Presupuesto por tipo de iniciativa"), width="stretch")
            b.dataframe(por_tipo.assign(neto=por_tipo["beneficio"] - por_tipo["costo"]).round(3), hide_index=True, width="stretch")
    with t5:
        st.markdown(d["narrativa"])
        st.markdown("##### Gatillos")
        if d["gat"].empty:
            st.info("No hay gatillos registrados.")
        else:
            col = {"ACTIVADO": C["rojo"], "OK": C["verde"], "SIN DATO": C["gris"]}
            st.dataframe(d["gat"].style.map(lambda x: f"color:{col.get(x, '#000')};font-weight:700", subset=["estado"]),
                         hide_index=True, width="stretch")
        st.caption("Cadencia recomendada: control operativo semanal, revisión BSC mensual (90 min), revisión estratégica trimestral.")


def _mapa_calor(v, kpis, vals, anio) -> None:
    meses = list(fz.serie_meses(int(anio)))
    z, texto = [], []
    for r in v.itertuples():
        fila_z, fila_t = [], []
        for m in meses:
            ev_m = fz.evaluar_kpis(kpis[kpis["kpi_id"] == r.kpi_id], vals, m)
            s_ = ev_m["semaforo"].iloc[0] if not ev_m.empty else "N/A"
            if pd.isna(ev_m["real"].iloc[0]) if not ev_m.empty else True:
                s_ = "N/A"
            fila_z.append({"ROJO": 0, "AMBAR": 1, "VERDE": 2, "GRIS": 3, "N/A": 4}[s_])
            fila_t.append(ui.ETIQUETA_SEMAFORO[s_])
        z.append(fila_z)
        texto.append(fila_t)
    escala = [[0, C["rojo"]], [0.2, C["rojo"]], [0.2, C["ambar"]], [0.4, C["ambar"]], [0.4, C["verde"]], [0.6, C["verde"]],
              [0.6, C["gris"]], [0.8, C["gris"]], [0.8, "#EEF1F5"], [1, "#EEF1F5"]]
    fig = go.Figure(go.Heatmap(z=z, x=[m[-2:] for m in meses], y=list(v["kpi_id"]), text=texto, hovertemplate="%{y} · mes %{x}: %{text}<extra></extra>",
                               colorscale=escala, zmin=0, zmax=4, showscale=False, xgap=2, ygap=2))
    fig.update_yaxes(autorange="reversed")
    st.plotly_chart(_layout(fig, max(260, 26 * len(v) + 60), xaxis_title="Mes"), width="stretch")


def _tendencia_kpi(kid, kpis, vals, anio) -> None:
    f = kpis.set_index("kpi_id").loc[kid]
    d = vals[(vals["kpi_id"] == kid) & vals["periodo_id"].astype(str).str.startswith(anio)]
    meta = d[d["tipo_valor"] == "Meta"].sort_values("periodo_id")
    real = d[d["tipo_valor"] == "Real"].sort_values("periodo_id")
    fig = go.Figure()
    fig.add_scatter(x=meta["periodo_id"], y=meta["valor"], name="Proyectado (meta)", line=dict(color=C["marca"], dash="dot"))
    fig.add_scatter(x=real["periodo_id"], y=real["valor"], name="Real", mode="lines+markers", line=dict(color=C["accion"], width=3))
    if len(real) >= 2:
        ult = int(real["periodo_id"].iloc[-1][-2:])
        xs, ys = [real["periodo_id"].iloc[-1]], [real["valor"].iloc[-1]]
        for h in range(1, 13 - ult):
            xs.append(f"{anio}-{ult + h:02d}")
            ys.append(ia.pronostico_cierre(real["valor"].tolist(), h))
        fig.add_scatter(x=xs, y=ys, name="Pronóstico (Holt)", line=dict(color=C["ambar"], dash="dash"))
    fig.add_hline(y=f.meta, line_color=C["verde"], annotation_text="Meta anual", annotation_position="top left")
    if f.unidad == "%":
        fig.update_yaxes(tickformat=".0%")
    st.plotly_chart(_layout(fig, 360, f"{kid} · {f.nombre}"), width="stretch")
    st.caption(f"Fórmula: {f.formula} · Fuente: {f.fuente} · Responsable: {f.responsable} · Sentido: {f.sentido}")


def _grafico_eva(fin) -> None:
    if fin is None or fin.empty:
        st.info("Sin financieros mensuales para el escenario.")
        return
    m, r = fin[fin["tipo_valor"] == "Meta"], fin[fin["tipo_valor"] == "Real"]
    fig = go.Figure()
    fig.add_bar(x=m["periodo_id"], y=m["eva"], name="EVA mensual proyectado", marker_color="#B8C4D6")
    fig.add_bar(x=r["periodo_id"], y=r["eva"], name="EVA mensual real", marker_color=C["accion"])
    fig.add_scatter(x=m["periodo_id"], y=m["eva_acum"], name="Acumulado proyectado", yaxis="y2", line=dict(color=C["marca"], dash="dot"))
    fig.add_scatter(x=r["periodo_id"], y=r["eva_acum"], name="Acumulado real", yaxis="y2", line=dict(color=C["marca"], width=3))
    _layout(fig, 360, "EVA mensual y acumulado (S/ m)", barmode="group",
            yaxis2=dict(overlaying="y", side="right", showgrid=False))
    st.plotly_chart(fig, width="stretch")
    if not r.empty:
        u = r.iloc[-1]
        mm = m[m["periodo_id"] == u["periodo_id"]]
        comp = pd.DataFrame({
            "Concepto": ["Ventas", "Margen EBIT", "NOPAT", "Capital invertido", "ROIC anualizado", "EVA del mes"],
            "Proyectado": [mm["ventas"].sum(), mm["margen_ebit"].mean(), mm["nopat"].sum(), mm["capital_invertido"].mean(),
                           mm["roic_anualizado"].mean(), mm["eva"].sum()] if not mm.empty else [None] * 6,
            "Real": [u["ventas"], u["margen_ebit"], u["nopat"], u["capital_invertido"], u["roic_anualizado"], u["eva"]]})
        pct = comp["Concepto"].isin(["Margen EBIT", "ROIC anualizado"])
        for col in ("Proyectado", "Real"):
            comp[col] = [("—" if x is None or pd.isna(x) else (f"{x:.2%}" if p else f"{x:,.3f}")) for x, p in zip(comp[col], pct)]
        st.caption(f"Puente de valor del mes {u['periodo_id']} (S/ m)")
        st.dataframe(comp, hide_index=True, width="stretch")


# ============================================================ Gantt
def pagina_gantt() -> None:
    ui.mostrar_toast()
    ui.encabezado("Diagrama de Gantt", "Propuesta de implementación del plan a través del BSC, edición y aprobación", entidad="gantt")
    e = ui.requiere_empresa()
    if not e:
        return
    c = ui.ctx()
    g, ini = ui.leer("gantt_tareas", e), ui.leer("iniciativas", e)
    val = ia.validar_gantt(g, ini) if not g.empty else pd.DataFrame([("INFO", "—", "Sin tareas")], columns=["nivel", "tarea", "detalle"])
    t1, t2, t3, t4, t5 = st.tabs(["📅 Diagrama", "✏️ Edición", "🤖 Propuesta IA", f"🧪 Validación ({int((val['nivel'].isin(['ERROR', 'ALERTA'])).sum())})", "✅ Aprobación"])
    with t1:
        if g.empty:
            st.info("No hay tareas. Use la pestaña Propuesta IA.")
        else:
            st.plotly_chart(figura_gantt(g, ini, c["periodo_id"]), width="stretch")
            a = ia.analizar_gantt(g)
            k = st.columns(4)
            k[0].metric("Tareas", len(g))
            k[1].metric("En ruta crítica", int(a["critica"].sum()))
            k[2].metric("Avance ponderado", f"{np.average(g['avance'].fillna(0), weights=a['duracion'].clip(lower=1)):.0%}")
            k[3].metric("Fin del proyecto", str(pd.to_datetime(g["fecha_fin"]).max().date()))
    with t2:
        cfg = {"fecha_inicio": st.column_config.TextColumn("inicio (AAAA-MM-DD)"), "fecha_fin": st.column_config.TextColumn("fin (AAAA-MM-DD)"),
               "avance": st.column_config.NumberColumn("avance", min_value=0.0, max_value=1.0, step=0.05, format="%.2f"),
               "estado": st.column_config.SelectboxColumn("estado", options=config.ESTADOS_FLUJO + ["En ejecución", "Completada"]),
               "iniciativa_id": st.column_config.SelectboxColumn("iniciativa", options=["FASE"] + ini["iniciativa_id"].tolist()),
               "tarea": st.column_config.TextColumn("tarea", width="large"),
               "dependencia": st.column_config.TextColumn("dependencia", help="Código(s) de tarea predecesora, separados por coma")}
        ed = st.data_editor(g.drop(columns=["empresa_id"]), num_rows="dynamic", hide_index=True, width="stretch", height=460,
                            key=f"ed_gantt_{e}", column_config=cfg, disabled=not ui.puede("editar"))
        if st.button("💾 Guardar cronograma", type="primary", disabled=not ui.puede("editar")):
            v2 = ia.validar_gantt(ed, ini)
            if (v2["nivel"] == "ERROR").any():
                st.error("Corrija los errores antes de guardar:")
                st.dataframe(v2[v2["nivel"] == "ERROR"], hide_index=True)
            else:
                if db.estado_flujo(e, "gantt")["estado"] == "Aprobado":
                    db.cambiar_estado(e, "gantt", "Borrador", ui.usuario()["usuario"], "Edición posterior a la aprobación")
                _guardar("gantt_tareas", ed.assign(empresa_id=e), e, "Cronograma")
    with t3:
        st.markdown("La IA arma la **hoja de ruta de 12 meses** (guía 2027: estrategia, datos, cockpit, casos IA, escalamiento, "
                    "beneficios y gobierno) y descompone cada iniciativa en fases: puertas **G0–G3** para IA y "
                    "diseño → implementación → cierre para las tradicionales, con dependencias.")
        if st.button("🤖 Proponer Gantt desde las iniciativas", disabled=not ui.puede("editar") or ini.empty):
            st.session_state[f"prop_gantt_{e}"] = ia.proponer_gantt(e, ini, c["anio"])
        prop = st.session_state.get(f"prop_gantt_{e}")
        if prop is not None:
            st.plotly_chart(figura_gantt(prop, ini, c["periodo_id"]), width="stretch")
            pe = st.data_editor(prop.drop(columns=["empresa_id"]), hide_index=True, width="stretch", key="ed_prop_gantt", num_rows="dynamic")
            conservar = st.checkbox("Conservar el avance registrado de tareas con el mismo código", value=True)
            a, b, _ = st.columns([1, 1, 3])
            if a.button("✅ Aceptar propuesta", type="primary"):
                nuevo = pe.assign(empresa_id=e)
                if conservar and not g.empty:
                    av = dict(zip(g["tarea_id"], g["avance"]))
                    nuevo["avance"] = [av.get(t, x) for t, x in zip(nuevo["tarea_id"], nuevo["avance"])]
                st.session_state.pop(f"prop_gantt_{e}", None)
                db.cambiar_estado(e, "gantt", "Propuesto", ui.usuario()["usuario"], "Gantt propuesto por IA")
                _guardar("gantt_tareas", nuevo, e, "Gantt propuesto")
            if b.button("Descartar"):
                st.session_state.pop(f"prop_gantt_{e}", None)
                st.rerun()
    with t4:
        col = {"ERROR": C["rojo"], "ALERTA": C["ambar"], "INFO": C["accion"], "OK": C["verde"]}
        st.dataframe(val.style.map(lambda x: f"color:{col.get(x, '#000')};font-weight:700", subset=["nivel"]), hide_index=True, width="stretch")
        if not g.empty:
            a = ia.analizar_gantt(g)
            st.markdown("##### Holgura y ruta crítica")
            st.dataframe(a[["tarea_id", "tarea", "fecha_inicio", "fecha_fin", "dependencia", "duracion", "holgura", "critica"]],
                         hide_index=True, width="stretch")
    with t5:
        err = val[val["nivel"] == "ERROR"].rename(columns={"tarea": "regla"})
        panel_aprobacion(e, "gantt", ["gantt_tareas"], "Gantt de implementación", err)


def figura_gantt(g: pd.DataFrame, ini: pd.DataFrame, periodo: str) -> go.Figure:
    a = ia.analizar_gantt(g).copy()
    a["ini"], a["fin"] = pd.to_datetime(a["fecha_inicio"], errors="coerce"), pd.to_datetime(a["fecha_fin"], errors="coerce")
    a = a.dropna(subset=["ini", "fin"])
    a["grupo"] = a["iniciativa_id"].where(a["iniciativa_id"] != "FASE", "Hoja de ruta")
    a = a.sort_values(["grupo", "ini"], key=lambda s: s.map(lambda x: "0" if x == "Hoja de ruta" else str(x)) if s.name == "grupo" else s)
    etiquetas = [f"{t} · {str(n)[:46]}" for t, n in zip(a["tarea_id"], a["tarea"])]
    paleta = ["#0E7C86", "#3F6FB5", "#6A8E3A", "#B26B00", "#7B4DA0", "#1F7A5A", "#8E5A3C", "#4A6FA5", "#9C3D54", "#5A6B7F", "#2E8FA0", "#6D5BA8"]
    grupos = list(dict.fromkeys(a["grupo"]))
    color = {gr: (C["marca"] if gr == "Hoja de ruta" else paleta[i % len(paleta)]) for i, gr in enumerate(grupos)}
    fig = go.Figure()
    ms = 86_400_000
    for gr in grupos:
        d = a[a["grupo"] == gr]
        et = [x for x, m in zip(etiquetas, a["grupo"] == gr) if m]
        dur = ((d["fin"] - d["ini"]).dt.days + 1) * ms
        fig.add_bar(y=et, x=dur, base=d["ini"], orientation="h", name=gr, marker_color=color[gr], opacity=0.35,
                    marker_line_color=[C["rojo"] if c_ else color[gr] for c_ in d["critica"]],
                    marker_line_width=[2.5 if c_ else 0 for c_ in d["critica"]],
                    hovertext=[f"{r.tarea}<br>{r.fecha_inicio} → {r.fecha_fin}<br>Avance {r.avance or 0:.0%} · holgura {r.holgura} d"
                               for r in d.itertuples()], hoverinfo="text")
        fig.add_bar(y=et, x=dur * d["avance"].fillna(0), base=d["ini"], orientation="h", showlegend=False,
                    marker_color=color[gr], hoverinfo="skip")
    try:
        corte = pd.Timestamp(periodo + "-01") + pd.offsets.MonthEnd(0)
        fig.add_vline(x=corte, line_color=C["rojo"], line_dash="dash")
        fig.add_annotation(x=corte, y=1, yref="paper", text=f"corte {periodo}", showarrow=False, font=dict(color=C["rojo"], size=11))
    except ValueError:
        pass
    fig.update_layout(barmode="overlay", height=max(380, 24 * len(a) + 120), plot_bgcolor="white",
                      margin=dict(l=10, r=10, t=30, b=10), legend=dict(orientation="h", y=-0.08),
                      xaxis=dict(type="date", gridcolor="#EEF1F5", side="top"))
    fig.update_yaxes(autorange="reversed", tickfont=dict(size=11))
    return fig


# ============================================================ Simulador EVA
def pagina_simulador() -> None:
    ui.mostrar_toast()
    ui.encabezado("Simulador EVA", "Qué pasaría si: palancas de valor, comparación multi-periodo y multi-escenario")
    e = ui.requiere_empresa()
    if not e:
        return
    c = ui.ctx()
    esc = ui.leer("escenarios", e)
    if esc.empty:
        st.info("Registre escenarios en Plan Estratégico.")
        return
    tabla = fz.tabla_escenarios(esc)
    t1, t2, t3 = st.tabs(["🎚️ Qué pasaría si", "🧮 Multi-periodo × multi-escenario", "🗂️ Corridas guardadas"])
    with t1:
        base_df = tabla[(tabla["anio"] == c["anio"]) & (tabla["escenario"] == c["escenario"])]
        if base_df.empty:
            st.info("No existe el escenario seleccionado para el año.")
        else:
            b = base_df.iloc[0]
            st.caption(f"Punto de partida: escenario **{c['escenario']} {c['anio']}**. Mueva las palancas (variación relativa o en puntos).")
            x1, x2, x3, x4 = st.columns(4)
            dv = x1.slider("Ventas (%)", -20, 20, 0, 1)
            dm = x2.slider("Margen EBIT (pp)", -3.0, 3.0, 0.0, 0.1)
            dc = x3.slider("Capital invertido (%)", -15, 15, 0, 1)
            dw = x4.slider("WACC (pp)", -2.0, 2.0, 0.0, 0.1)
            p = {"ventas": b["ventas"] * (1 + dv / 100), "margen_ebit": b["margen_ebit"] + dm / 100,
                 "capital_invertido": b["capital_invertido"] * (1 + dc / 100), "wacc": b["wacc"] + dw / 100, "tasa_ir": b["tasa_ir"]}
            r = sim.evaluar(p)
            k = st.columns(5)
            k[0].metric("NOPAT", fz.fmt_monto(r["nopat"]), f"{r['nopat'] - b['nopat']:+.3f}")
            k[1].metric("Cargo de capital", fz.fmt_monto(r["cargo_capital"]), f"{r['cargo_capital'] - b['cargo_capital']:+.3f}", delta_color="inverse")
            k[2].metric("ROIC", f"{r['roic']:.2%}", f"{(r['roic'] - b['roic']) * 100:+.2f} pp")
            k[3].metric("Spread ROIC−WACC", f"{r['spread'] * 100:+.2f} pp")
            k[4].metric("EVA", fz.fmt_monto(r["eva"]), f"{r['eva'] - b['eva']:+.3f}")
            fig = go.Figure(go.Waterfall(
                x=["EVA base", "Ventas", "Margen", "Capital", "WACC", "EVA simulado"],
                measure=["absolute", "relative", "relative", "relative", "relative", "total"],
                y=[b["eva"], *_descomponer(b, dv, dm, dc, dw), 0],
                text=None, connector={"line": {"color": C["borde"]}},
                increasing={"marker": {"color": C["accion"]}}, decreasing={"marker": {"color": C["rojo"]}},
                totals={"marker": {"color": C["marca"]}}))
            st.plotly_chart(_layout(fig, 340, "Puente de EVA: contribución de cada palanca (S/ m)"), width="stretch")
            # Punto de equilibrio: margen mínimo para EVA = 0
            m_eq = p["wacc"] * p["capital_invertido"] / (p["ventas"] * (1 - p["tasa_ir"]))
            v_eq = p["wacc"] * p["capital_invertido"] / (p["margen_ebit"] * (1 - p["tasa_ir"]))
            st.info(f"**Umbrales de creación de valor:** con estas palancas el EVA es cero si el margen EBIT cae a **{m_eq:.2%}** "
                    f"o si las ventas caen a **S/ {v_eq:,.1f} m**.")
            if st.button("💾 Guardar escenario simulado", disabled=not ui.puede("editar")):
                db.guardar_simulacion({"empresa_id": e, "usuario": ui.usuario()["usuario"], "tipo": "Qué pasaría si", "anio": c["anio"],
                                       "escenario": c["escenario"], "parametros_json": {"dv": dv, "dm": dm, "dc": dc, "dw": dw, **p},
                                       "eva_det": r["eva"], "resultado_json": r})
                st.toast("Simulación guardada.", icon="✅")
    with t2:
        orden_esc = [x for x in ["Real", "Protección", "Base", "Expansión", "Proyección"] if x in set(tabla["escenario"])]
        orden_esc += sorted(set(tabla["escenario"]) - set(orden_esc))
        piv = tabla.pivot_table(index="escenario", columns="anio", values="eva", aggfunc="first").reindex(orden_esc)
        fig = go.Figure(go.Heatmap(z=piv.values, x=list(piv.columns), y=list(piv.index), colorscale="RdYlGn", zmid=0,
                                   text=[[f"{v:,.2f}" if pd.notna(v) else "" for v in fila] for fila in piv.values],
                                   texttemplate="%{text}", hovertemplate="%{y} %{x}: EVA %{z:.2f}<extra></extra>"))
        fig.update_xaxes(type="category")
        fig.update_yaxes(autorange="reversed")
        st.plotly_chart(_layout(fig, 300, "EVA (S/ m) por escenario y año"), width="stretch")
        fig2 = go.Figure()
        col_esc = {"Real": C["gris"], "Protección": C["ambar"], "Base": C["marca"], "Expansión": C["verde"], "Proyección": C["accion"]}
        for nom in orden_esc:
            d = tabla[tabla["escenario"] == nom].sort_values("anio")
            fig2.add_scatter(x=d["anio"], y=d["roic"] * 100, name=f"ROIC {nom}", mode="lines+markers",
                             line=dict(color=col_esc.get(nom, C["texto2"])))
        w = tabla.sort_values("anio").groupby("anio")["wacc"].mean()
        fig2.add_scatter(x=w.index, y=w.values * 100, name="WACC promedio", line=dict(color=C["rojo"], dash="dot"))
        fig2.update_xaxes(type="category")
        st.plotly_chart(_layout(fig2, 320, "ROIC vs WACC (%)"), width="stretch")
        st.dataframe(tabla[["anio", "escenario", "probabilidad", "ventas", "margen_ebit", "nopat", "capital_invertido", "wacc", "roic", "eva"]]
                     .sort_values(["anio", "escenario"]).style.format({"probabilidad": "{:.0%}", "ventas": "{:,.1f}", "margen_ebit": "{:.2%}",
                                                                     "nopat": "{:,.3f}", "capital_invertido": "{:,.1f}", "wacc": "{:.2%}",
                                                                     "roic": "{:.2%}", "eva": "{:,.3f}"}),
                     hide_index=True, width="stretch")
    with t3:
        sims = db.leer("simulaciones", e, orden="id DESC")
        if sims.empty:
            st.info("Aún no hay corridas guardadas (Plan Estratégico → Monte Carlo, Mapa y BSC → Simulación, o esta página).")
        else:
            st.dataframe(sims.drop(columns=["id", "empresa_id", "parametros_json", "resultado_json"]), hide_index=True, width="stretch")
            mc = sims[sims["tipo"] == "Monte Carlo"].sort_values("id")
            if len(mc):
                fig = go.Figure()
                fig.add_scatter(x=mc["fecha"], y=mc["p50"], name="P50", mode="lines+markers",
                                error_y=dict(type="data", symmetric=False, array=mc["p90"] - mc["p50"], arrayminus=mc["p50"] - mc["p10"]))
                st.plotly_chart(_layout(fig, 300, "Evolución de las corridas Monte Carlo (P10–P50–P90, S/ m)"), width="stretch")


def _descomponer(b, dv, dm, dc, dw):
    """Contribución secuencial de cada palanca al cambio de EVA."""
    p = {k: float(b[k]) for k in ("ventas", "margen_ebit", "capital_invertido", "wacc", "tasa_ir")}
    pasos, eva_prev = [], sim.evaluar(p)["eva"]
    for k, nuevo in (("ventas", p["ventas"] * (1 + dv / 100)), ("margen_ebit", p["margen_ebit"] + dm / 100),
                     ("capital_invertido", p["capital_invertido"] * (1 + dc / 100)), ("wacc", p["wacc"] + dw / 100)):
        p[k] = nuevo
        eva_n = sim.evaluar(p)["eva"]
        pasos.append(eva_n - eva_prev)
        eva_prev = eva_n
    return pasos


# ============================================================ Reportes PPT
def construir_contexto_reporte(e: str) -> dict:
    c = ui.ctx()
    return contexto_reporte(e, c["anio"], c["escenario"], c["periodo_id"], ui.usuario()["nombre"], ui.leer, datos_control(e))


def contexto_reporte(e, anio, escenario, per, usuario, leer=db.leer, d=None) -> dict:
    """Contexto completo para reporte_ppt.generar (sin interfaz)."""
    emp = leer("empresas")
    empresa = emp[emp["empresa_id"] == e].iloc[0].to_dict()
    d = d or calcular_control(e, anio, escenario, per, leer, empresa["razon_social"])
    c = {"anio": anio, "escenario": escenario, "periodo_id": per}
    decisiones = []
    if d["rojas"]:
        decisiones.append(f"Reasignar recursos a iniciativas en rojo ({', '.join(d['rojas'])})")
    if d["activos"]:
        decisiones.append(f"Aprobar acciones de gatillos {', '.join(d['activos'])}")
    riesgo = d["pron"][d["pron"]["logra_meta"] == "En riesgo"]["kpi_id"].tolist() if not d["pron"].empty else []
    if riesgo:
        decisiones.append(f"Planes de acción para KPI en riesgo al cierre ({', '.join(riesgo[:6])})")
    return {"empresa": empresa, "anio": c["anio"], "escenario": c["escenario"], "periodo_id": c["periodo_id"],
            "objetivos": d["obj"], "relaciones": leer("relaciones", e), "kpis": d["kpis"], "kpi_valores": d["vals"],
            "evaluacion": d["ev"].drop(columns=["perspectiva"], errors="ignore"), "pronostico": d["pron"],
            "financieros": d["fin"], "escenarios": d["tabla"], "iniciativas": leer("iniciativas", e), "seguimiento": d["seg"],
            "gantt": leer("gantt_tareas", e), "gatillos": d["gat"], "riesgos": leer("riesgos", e),
            "narrativa": d["narrativa"], "usuario": usuario, "n_ini_rojas": len(d["rojas"]),
            "decisiones": decisiones}


def pagina_reportes() -> None:
    ui.mostrar_toast()
    c = ui.ctx()
    ui.encabezado("Reportes PPT", "Presentación automática de avance del BSC: real vs proyectado")
    e = ui.requiere_empresa()
    if not e:
        return
    st.markdown(f"Se generará la presentación de **{ui.nombre_empresa(e)}** · plan **{c['anio']}** · escenario **{c['escenario']}** · "
                f"corte **{c['periodo_id']}** (cambie estos valores en el menú lateral).")
    st.markdown("""
| # | Diapositiva | Contenido |
|---|---|---|
| 1 | Portada | Empresa, plan, escenario y corte |
| 2 | Resumen ejecutivo | EVA real vs trayectoria, EVA del plan, KPI por color, iniciativas en rojo y narrativa |
| 3 | Mapa estratégico | Objetivos por perspectiva con semáforo y relaciones causa-efecto |
| 4–7 | Una por perspectiva | Tabla base · meta · proyectado · real · estado · cierre pronosticado y gráfico de cumplimiento |
| 8 | Creación de valor | EVA acumulado proyectado vs real y escenarios |
| 9 | Iniciativas | Avance plan vs real y estado |
| 10 | Hoja de ruta | Gantt resumido con línea de corte |
| 11 | Alertas y decisiones | Gatillos, riesgos principales y decisiones requeridas |
""")
    nombre = f"Reporte_BSC_{e}_{c['periodo_id']}.pptx"
    if st.button("🎞️ Generar presentación", type="primary"):
        with st.spinner("Generando PPTX…"):
            datos = reporte_ppt.generar(construir_contexto_reporte(e))
        try:
            config.ruta(nombre).write_bytes(datos)
            ubic = f"Guardado en la carpeta del sistema: {nombre}"
        except OSError as ex:
            ubic = f"No se pudo guardar en la carpeta del sistema ({ex}); use el botón de descarga."
        db.registrar_reporte(e, c["periodo_id"], c["escenario"], nombre, ui.usuario()["usuario"])
        st.session_state["_ppt"] = (nombre, datos, ubic)
    if st.session_state.get("_ppt"):
        nom, datos, ubic = st.session_state["_ppt"]
        st.success(f"Presentación lista ({len(datos) / 1024:,.0f} KB). {ubic}")
        st.download_button("⬇️ Descargar PPTX", datos, file_name=nom,
                           mime="application/vnd.openxmlformats-officedocument.presentationml.presentation")
    rep = db.leer("reportes", e, orden="id DESC")
    if not rep.empty:
        st.markdown("##### Reportes generados")
        st.dataframe(rep.drop(columns=["id"]), hide_index=True, width="stretch")
