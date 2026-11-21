# -*- coding: utf-8 -*-
"""
vistas_bsc.py - Módulo MAPA ESTRATÉGICO Y BALANCED SCORECARD.

Pestañas: Generar desde el plan · Objetivos y mapa · KPI y metas · Iniciativas ·
Validación · Simulación BSC · Aprobación.
"""
from __future__ import annotations

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

import config
import db
import finanzas as fz
import motor_ia as ia
import simulador as sim
import ui
from vistas_plan import _empresa, _marcar_borrador, panel_aprobacion

C = config.COLOR
TABLAS_BSC = ["objetivos", "relaciones", "kpis", "kpi_valores", "iniciativas", "criterios"]
ORDEN_SEM = {"ROJO": 0, "AMBAR": 1, "GRIS": 2, "VERDE": 3, "N/A": 4}


def _guardar(tabla, df, e, msg, global_=False):
    try:
        n = db.reemplazar(tabla, df, None if global_ else e, ui.usuario()["usuario"])
        _marcar_borrador(e, "bsc")
        ui.refrescar()
        st.session_state["_toast"] = f"{msg}: {n} registros guardados."
        st.rerun()
    except ValueError as ex:
        st.error(f"No se guardó. {ex}")


def pagina_bsc() -> None:
    ui.mostrar_toast()
    ui.encabezado("Mapa Estratégico y Balanced Scorecard", "Generación automática desde el plan, edición, simulación y aprobación",
                  entidad="bsc")
    e = ui.requiere_empresa()
    if not e:
        return
    obj, rel, kpis, ini = (ui.leer(t, e) for t in ("objetivos", "relaciones", "kpis", "iniciativas"))
    val = ia.validar_bsc(obj, rel, kpis, ini)
    tabs = st.tabs(["🤖 Generar desde el plan", "🗺️ Objetivos y mapa", "📏 KPI y metas", "🚀 Iniciativas",
                    f"🧪 Validación ({int((val['nivel'] != 'OK').sum())})", "🎛️ Simulación BSC", "✅ Aprobación"])
    with tabs[0]:
        _generar(e)
    with tabs[1]:
        _objetivos_mapa(e, obj, rel, kpis)
    with tabs[2]:
        _kpis(e, obj, kpis)
    with tabs[3]:
        _iniciativas(e, obj, ini)
    with tabs[4]:
        _validacion(val)
    with tabs[5]:
        _simulacion(e, obj, kpis)
    with tabs[6]:
        panel_aprobacion(e, "bsc", TABLAS_BSC, "Balanced Scorecard", val)


# ============================================================ Generar
def _generar(e: str) -> None:
    c = ui.ctx()
    emp = _empresa(e)
    plan = db.estado_flujo(e, "plan")
    if plan["estado"] != "Aprobado":
        st.warning(f"El Plan Estratégico está en estado **{plan['estado']}**. Se recomienda aprobarlo antes de generar el BSC "
                   "(la propuesta igualmente puede generarse para revisión).")
    diag, est, esc = ui.leer("diagnostico", e), ui.leer("estrategias", e), ui.leer("escenarios", e)
    st.markdown(f"La IA traduce el diagnóstico, las estrategias y el escenario **{c['escenario']} {c['anio']}** en objetivos "
                "de las cuatro perspectivas, relaciones causa-efecto, KPI con ficha técnica, metas con trayectoria mensual "
                "e iniciativas priorizadas.")
    cols = st.columns(4)
    cupo = {p: cols[i].number_input(f"Objetivos {p}", 2, 4, 3, key=f"cupo_{p}") for i, p in enumerate(config.PERSPECTIVAS)}
    if st.button("🤖 Generar propuesta de BSC", type="primary", disabled=not ui.puede("editar")):
        if esc[esc["anio"] == c["anio"]].empty:
            st.error(f"No hay escenarios para {c['anio']}. Regístrelos en Plan Estratégico → Escenarios.")
        else:
            st.session_state[f"prop_bsc_{e}"] = ia.propuesta_bsc(emp, diag, est, esc, c["anio"], c["escenario"], cupo)
    prop = st.session_state.get(f"prop_bsc_{e}")
    if not prop:
        return
    g, razon = prop["generica"]
    st.success(f"Propuesta generada: {len(prop['objetivos'])} objetivos · {len(prop['relaciones'])} relaciones · "
               f"{len(prop['kpis'])} KPI · {len(prop['iniciativas'])} iniciativas. Estrategia genérica: **{g}**.")
    val = ia.validar_bsc(prop["objetivos"], prop["relaciones"], prop["kpis"], prop["iniciativas"])
    t1, t2, t3, t4, t5 = st.tabs(["Mapa", "Objetivos", "Relaciones", "KPI y metas", "Iniciativas"])
    with t1:
        st.plotly_chart(figura_mapa(prop["objetivos"], prop["relaciones"]), width="stretch")
        _validacion(val, compacto=True)
    with t2:
        o = st.data_editor(prop["objetivos"].drop(columns=["empresa_id"]), width="stretch", key="pe_obj", hide_index=True, num_rows="dynamic",
                           column_config=_cfg_obj())
    with t3:
        r = st.data_editor(prop["relaciones"].drop(columns=["empresa_id"]), width="stretch", key="pe_rel", hide_index=True, num_rows="dynamic")
    with t4:
        k = st.data_editor(prop["kpis"].drop(columns=["empresa_id"]), width="stretch", key="pe_kpi", hide_index=True, num_rows="dynamic",
                           column_config=_cfg_kpi())
    with t5:
        i = st.data_editor(prop["iniciativas"].drop(columns=["empresa_id"]), width="stretch", key="pe_ini", hide_index=True, num_rows="dynamic",
                           disabled=["puntaje"], column_config=_cfg_ini())
    st.warning("Al aceptar se **reemplazan** objetivos, relaciones, KPI, metas e iniciativas de esta empresa.")
    conservar = st.checkbox("Conservar valores reales y seguimiento cuyos códigos coincidan", value=False)
    a, b, _ = st.columns([1.2, 1, 3])
    if a.button("✅ Aceptar propuesta", type="primary"):
        try:
            aplicar_propuesta(e, c["anio"], o, r, k, i, conservar)
            st.session_state.pop(f"prop_bsc_{e}", None)
            st.session_state["_toast"] = "BSC propuesto guardado (estado: Propuesto)."
            st.rerun()
        except ValueError as ex:
            st.error(f"No se guardó. {ex}")
    if b.button("Descartar propuesta"):
        st.session_state.pop(f"prop_bsc_{e}", None)
        st.rerun()


def aplicar_propuesta(e, anio, obj, rel, kpis, ini, conservar=False, usuario=None) -> None:
    """Persiste la propuesta del BSC (todas las validaciones se hacen antes de borrar)."""
    usuario = usuario or ui.usuario()["usuario"]
    obj, rel, kpis = obj.assign(empresa_id=e), rel.assign(empresa_id=e), kpis.assign(empresa_id=e)
    ini = ini.drop(columns=["puntaje"], errors="ignore").assign(empresa_id=e)
    k_tray = kpis.copy()
    tray = ia.trayectorias(k_tray.assign(_fin=None), anio)
    for t, d in (("objetivos", obj), ("relaciones", rel), ("kpis", kpis), ("iniciativas", ini)):
        errs = db.validar_tabla(t, db._limpiar(d, t))
        if errs:
            raise ValueError("; ".join(errs[:5]))
    vals = db.leer("kpi_valores", e)
    ids_k = set(kpis["kpi_id"])
    reales = vals[(vals["tipo_valor"] == "Real") & vals["kpi_id"].isin(ids_k)] if conservar else vals.iloc[0:0]
    metas_otros = vals[(vals["tipo_valor"] == "Meta") & ~vals["periodo_id"].astype(str).str.startswith(str(anio))
                       & vals["kpi_id"].isin(ids_k)] if conservar else vals.iloc[0:0]
    seg, gan = db.leer("seguimiento", e), db.leer("gantt_tareas", e)
    ids_i = set(ini["iniciativa_id"])
    seg = seg[seg["iniciativa_id"].isin(ids_i)] if conservar else seg.iloc[0:0]
    gan = gan[gan["iniciativa_id"].isin(ids_i) | gan["iniciativa_id"].isin(["FASE"])] if conservar else gan[gan["iniciativa_id"] == "FASE"]
    db.reemplazar("objetivos", obj, e, usuario, "Propuesta IA del BSC")
    db.reemplazar("relaciones", rel, e, usuario)
    db.reemplazar("kpis", kpis, e, usuario)
    db.reemplazar("kpi_valores", pd.concat([tray, reales.drop(columns=["id"]), metas_otros.drop(columns=["id"])], ignore_index=True),
                  e, usuario)
    db.reemplazar("iniciativas", ini, e, usuario)
    db.reemplazar("seguimiento", seg.drop(columns=["id"]), e, usuario)
    db.reemplazar("gantt_tareas", gan, e, usuario)
    db.cambiar_estado(e, "bsc", "Propuesto", usuario, "BSC generado por IA desde el plan")
    db.auditar(usuario, e, "bsc", "PROPUESTA_IA_ACEPTADA", f"{len(obj)} objetivos, {len(kpis)} KPI, {len(ini)} iniciativas")
    try:
        ui.refrescar()
    except Exception:
        pass


# ============================================================ Mapa
def figura_mapa(obj: pd.DataFrame, rel: pd.DataFrame, semaforo: dict | None = None, alto: int = 640) -> go.Figure:
    """Mapa estratégico: carriles por perspectiva (arriba Financiera) y flechas causa-efecto."""
    fig = go.Figure()
    y_de = {p: 3 - i for i, p in enumerate(config.PERSPECTIVAS)}
    pos = {}
    persp = dict(zip(obj["objetivo_id"], obj["perspectiva"]))
    # Relaciones dentro del mismo carril: el destino se dibuja más arriba para que la flecha no cruce las cajas
    destinos_mismo = {r.objetivo_destino for r in rel.itertuples()
                      if persp.get(r.objetivo_origen) and persp.get(r.objetivo_origen) == persp.get(r.objetivo_destino)} if not rel.empty else set()
    for p in config.PERSPECTIVAS:
        d = obj[obj["perspectiva"] == p].sort_values("orden") if "orden" in obj else obj[obj["perspectiva"] == p]
        altos = [r for r in d.itertuples() if r.objetivo_id in destinos_mismo]
        bajos = [r for r in d.itertuples() if r.objetivo_id not in destinos_mismo]
        for fila, dy in ((bajos, -0.16 if altos else 0.0), (altos, 0.24)):
            for j, r in enumerate(fila):
                pos[r.objetivo_id] = ((j + 1) / (len(fila) + 1), y_de[p] + dy, r.nombre)
        fig.add_shape(type="rect", x0=0, x1=1, y0=y_de[p] - 0.42, y1=y_de[p] + 0.42, line=dict(width=0),
                      fillcolor=config.COLOR_PERSPECTIVA[p], opacity=0.07, layer="below")
        fig.add_annotation(x=0.005, y=y_de[p] + 0.36, text=f"<b>{p.upper()}</b>", showarrow=False, xanchor="left",
                           font=dict(size=11, color=config.COLOR_PERSPECTIVA[p]))
    # Cajas primero; luego flechas recortadas al borde de cada caja (cabeza visible)
    PX_X, PX_Y = 1000.0, (alto - 15) / 4.0          # píxeles aproximados por unidad
    tam = {}
    for oid, (x, y, nombre) in pos.items():
        sem = (semaforo or {}).get(oid)
        borde = config.COLOR_SEMAFORO.get(sem, config.COLOR_PERSPECTIVA[persp[oid]])
        lineas = _partir(f"{oid} {nombre}", 22)
        tam[oid] = ((max(len(x_) for x_ in lineas) * 3.4 + 12) / PX_X, (len(lineas) * 8 + 10) / PX_Y)
        fig.add_annotation(x=x, y=y, text="<br>".join(lineas), showarrow=False, font=dict(size=11, color="#1A1A1A"),
                           bgcolor="white", bordercolor=borde, borderwidth=3 if sem else 2, borderpad=6)
    for r in rel.itertuples() if not rel.empty else []:
        if r.objetivo_origen in pos and r.objetivo_destino in pos:
            x0, y0, _ = pos[r.objetivo_origen]
            x1, y1, _ = pos[r.objetivo_destino]
            sx0, sy0 = _borde(x0, y0, x1, y1, *tam[r.objetivo_origen], PX_X, PX_Y)
            sx1, sy1 = _borde(x1, y1, x0, y0, *tam[r.objetivo_destino], PX_X, PX_Y)
            fig.add_annotation(x=sx1, y=sy1, ax=sx0, ay=sy0, xref="x", yref="y", axref="x", ayref="y",
                               showarrow=True, arrowhead=2, arrowsize=1.2, arrowwidth=1.4,
                               arrowcolor="rgba(90,107,127,.7)", text="")
    fig.add_scatter(x=[p[0] for p in pos.values()], y=[p[1] for p in pos.values()], mode="markers",
                    marker=dict(size=1, color="rgba(0,0,0,0)"), hoverinfo="text",
                    hovertext=[f"{k}: {v[2]}" + (f" · {ui.ETIQUETA_SEMAFORO.get((semaforo or {}).get(k), '')}" if semaforo else "")
                               for k, v in pos.items()], showlegend=False)
    fig.update_layout(height=alto, plot_bgcolor="white", margin=dict(l=5, r=5, t=10, b=5),
                      xaxis=dict(visible=False, range=[0, 1]), yaxis=dict(visible=False, range=[-0.5, 3.5]))
    return fig


def _borde(x, y, hx, hy, w, h, px, py):
    """Punto donde el segmento (x,y)->(hx,hy) sale del rectángulo centrado en (x,y) de semiejes w,h (con margen)."""
    dx, dy = (hx - x) * px, (hy - y) * py
    if dx == 0 and dy == 0:
        return x, y
    # Recorte por la altura de la caja (la escala vertical es fija; la horizontal depende del ancho de pantalla)
    wp, hp = w * px + 4, h * py + 4
    t = hp / abs(dy) if abs(dy) > 1 else wp / abs(dx)
    t = min(t, 0.45)
    return x + (hx - x) * t, y + (hy - y) * t


def _partir(t: str, n: int) -> list[str]:
    palabras, lineas, actual = t.split(), [], ""
    for p in palabras:
        if len(actual) + len(p) + 1 > n and actual:
            lineas.append(actual)
            actual = p
        else:
            actual = f"{actual} {p}".strip()
    return lineas + ([actual] if actual else [])


def semaforo_objetivos(e: str, periodo: str) -> dict:
    ev = fz.evaluar_kpis(ui.leer("kpis", e), ui.leer("kpi_valores", e), periodo)
    if ev.empty:
        return {}
    ev = ev.assign(_o=ev["semaforo"].map(ORDEN_SEM))
    return ev.sort_values("_o").groupby("objetivo_id")["semaforo"].first().to_dict()


def _cfg_obj() -> dict:
    return {"perspectiva": st.column_config.SelectboxColumn("perspectiva", options=config.PERSPECTIVAS, required=True),
            "estado": st.column_config.SelectboxColumn("estado", options=config.ESTADOS_FLUJO),
            "nombre": st.column_config.TextColumn("nombre", width="medium"),
            "descripcion": st.column_config.TextColumn("descripcion", width="large")}


def _objetivos_mapa(e, obj, rel, kpis) -> None:
    c = ui.ctx()
    if obj.empty:
        st.info("No hay objetivos. Genere la propuesta en la primera pestaña o agréguelos aquí.")
    ver_sem = st.toggle(f"Colorear por semáforo de KPI al {c['periodo_id']}", value=True)
    st.plotly_chart(figura_mapa(obj, rel, semaforo_objetivos(e, c["periodo_id"]) if ver_sem else None), width="stretch")
    st.caption("Lectura de abajo hacia arriba: Aprendizaje → Procesos → Clientes → Financiera. "
               "Las relaciones son hipótesis causales entre objetivos.")
    a, b = st.columns([1.3, 1])
    with a:
        st.markdown("##### Objetivos estratégicos")
        o = st.data_editor(obj.drop(columns=["empresa_id"]), num_rows="dynamic", width="stretch", key=f"ed_obj_{e}", hide_index=True,
                           column_config=_cfg_obj(), disabled=not ui.puede("editar"))
        if st.button("💾 Guardar objetivos", disabled=not ui.puede("editar")):
            _guardar("objetivos", o.assign(empresa_id=e), e, "Objetivos")
    with b:
        st.markdown("##### Relaciones causa-efecto")
        ids = obj["objetivo_id"].tolist()
        r = st.data_editor(rel.drop(columns=["id", "empresa_id"], errors="ignore"), num_rows="dynamic", width="stretch",
                           key=f"ed_rel_{e}", disabled=not ui.puede("editar"),
                           column_config={"objetivo_origen": st.column_config.SelectboxColumn("origen", options=ids, required=True),
                                          "objetivo_destino": st.column_config.SelectboxColumn("destino", options=ids, required=True),
                                          "peso": st.column_config.NumberColumn("peso", min_value=0.0, max_value=1.0, step=0.1)})
        if st.button("💾 Guardar relaciones", disabled=not ui.puede("editar")):
            _guardar("relaciones", r.assign(empresa_id=e), e, "Relaciones")


# ============================================================ KPI
def _cfg_kpi() -> dict:
    return {"sentido": st.column_config.SelectboxColumn("sentido", options=config.SENTIDOS, required=True),
            "tipo": st.column_config.SelectboxColumn("tipo", options=["Resultado", "Inductor"]),
            "frecuencia": st.column_config.SelectboxColumn("frecuencia", options=["Diaria", "Semanal", "Mensual", "Trimestral", "Anual"]),
            "unidad": st.column_config.SelectboxColumn("unidad", options=["%", "S/ m", "pp", "x", "n", "días", "horas"]),
            "tolerancia_ambar": st.column_config.NumberColumn("tolerancia", format="%.2f", min_value=0.0, max_value=1.0),
            "formula": st.column_config.TextColumn("formula", width="medium"),
            "nombre": st.column_config.TextColumn("nombre", width="medium")}


def _kpis(e, obj, kpis) -> None:
    c = ui.ctx()
    st.markdown("##### Indicadores (ficha técnica)")
    cfg = _cfg_kpi()
    cfg["objetivo_id"] = st.column_config.SelectboxColumn("objetivo", options=obj["objetivo_id"].tolist(), required=True)
    k = st.data_editor(kpis.drop(columns=["empresa_id"]), num_rows="dynamic", width="stretch", key=f"ed_kpi_{e}", hide_index=True,
                       column_config=cfg, disabled=not ui.puede("editar"), height=360)
    if st.button("💾 Guardar KPI", disabled=not ui.puede("editar")):
        _guardar("kpis", k.assign(empresa_id=e), e, "KPI")
    if kpis.empty:
        return
    a, b = st.columns([1, 1.6])
    with a:
        sel = st.selectbox("Ficha técnica de", kpis["kpi_id"], format_func=lambda x: f"{x} · {kpis.set_index('kpi_id').loc[x, 'nombre']}")
        f = kpis.set_index("kpi_id").loc[sel]
        o = obj.set_index("objetivo_id")
        st.markdown(f"""
| Campo | Detalle |
|---|---|
| Objetivo | {f.objetivo_id} · {o.loc[f.objetivo_id, 'nombre'] if f.objetivo_id in o.index else '—'} |
| Fórmula | {f.formula} |
| Unidad / sentido | {f.unidad} · {f.sentido} |
| Línea base → meta | {fz.fmt_valor(f.linea_base, f.unidad)} → {fz.fmt_valor(f.meta, f.unidad)} |
| Umbral ámbar | ±{f.tolerancia_ambar:.0%} de la trayectoria |
| Frecuencia · fuente | {f.frecuencia} · {f.fuente} |
| Tipo · responsable | {f.tipo} · {f.responsable} |
""")
    with b:
        vals = ui.leer("kpi_valores", e)
        v = vals[(vals["kpi_id"] == sel) & vals["periodo_id"].astype(str).str.startswith(c["anio"])]
        fig = go.Figure()
        for tv, col, modo in (("Meta", C["marca"], "lines+markers"), ("Real", C["accion"], "lines+markers")):
            d = v[v["tipo_valor"] == tv].sort_values("periodo_id")
            fig.add_scatter(x=d["periodo_id"], y=d["valor"], name=tv, mode=modo,
                            line=dict(color=col, dash="dot" if tv == "Meta" else "solid"))
        fig.update_layout(height=300, plot_bgcolor="white", title=f"Trayectoria {c['anio']} — {f.nombre}",
                          margin=dict(l=10, r=10, t=40, b=10), legend=dict(orientation="h", y=-0.25))
        st.plotly_chart(fig, width="stretch")

    st.markdown(f"##### Metas mensuales {c['anio']} (trayectoria editable)")
    vals = ui.leer("kpi_valores", e)
    meses = list(fz.serie_meses(int(c["anio"])))
    metas = vals[(vals["tipo_valor"] == "Meta") & vals["periodo_id"].isin(meses)]
    ancho = metas.pivot_table(index="kpi_id", columns="periodo_id", values="valor", aggfunc="last").reindex(
        index=kpis["kpi_id"], columns=meses)
    ancho.index.name = "kpi_id"
    ed = st.data_editor(ancho.reset_index(), width="stretch", key=f"ed_tray_{e}_{c['anio']}", disabled=["kpi_id"],
                        column_config={m: st.column_config.NumberColumn(m[-2:], format="%.4f") for m in meses})
    x, y, _ = st.columns([1, 1.3, 2])
    if x.button("💾 Guardar metas", disabled=not ui.puede("editar")):
        largo = ed.melt(id_vars="kpi_id", var_name="periodo_id", value_name="valor").dropna(subset=["valor"])
        _reemplazar_metas(e, c["anio"], largo.assign(empresa_id=e, tipo_valor="Meta", calidad_dato="Certificado"), vals)
    if y.button("↺ Recalcular trayectoria lineal", disabled=not ui.puede("editar")):
        _reemplazar_metas(e, c["anio"], ia.trayectorias(kpis.assign(_fin=None), c["anio"]), vals)


def _reemplazar_metas(e, anio, nuevas, vals) -> None:
    resto = vals[~((vals["tipo_valor"] == "Meta") & vals["periodo_id"].astype(str).str.startswith(str(anio)))]
    _guardar("kpi_valores", pd.concat([resto.drop(columns=["id"]), nuevas], ignore_index=True), e, "Metas")


# ============================================================ Iniciativas
def _cfg_ini() -> dict:
    cfg = {"tipo": st.column_config.SelectboxColumn("tipo", options=config.TIPOS_INICIATIVA, required=True),
           "estado": st.column_config.SelectboxColumn("estado", options=config.ESTADOS_INICIATIVA),
           "puerta": st.column_config.SelectboxColumn("puerta", options=config.PUERTAS),
           "nombre": st.column_config.TextColumn("nombre", width="medium"),
           "puntaje": st.column_config.NumberColumn("puntaje", format="%.2f")}
    for p in db.PUNTAJES:
        cfg[p] = st.column_config.NumberColumn(p.replace("p_", ""), min_value=1, max_value=5, step=1)
    return cfg


def _iniciativas(e, obj, ini) -> None:
    crit = ui.leer("criterios")
    pesos = dict(zip(db.PUNTAJES, crit.sort_values("criterio_id")["peso"])) if len(crit) == 6 else config.PESOS_PRIORIZACION
    d = ini.copy()
    if not d.empty:
        d["puntaje"] = [fz.puntaje_priorizacion(r, pesos) for r in d[db.PUNTAJES].to_dict("records")]
        d["beneficio_neto"] = d["beneficio_bruto_anual"] - d["costo_anual"]
        d = d.sort_values("puntaje", ascending=False)
    k = st.columns(4)
    k[0].metric("Iniciativas", f"{len(d)} ({int((d['tipo'] == 'IA').sum()) if len(d) else 0} de IA)")
    k[1].metric("Presupuesto (STRATEX)", fz.fmt_monto(d["presupuesto"].sum() if len(d) else 0))
    k[2].metric("Beneficio neto anual", fz.fmt_monto(d["beneficio_neto"].sum() if len(d) else 0))
    k[3].metric("Capital liberado", fz.fmt_monto(d["capital_liberado"].sum() if len(d) else 0))
    cfg = _cfg_ini()
    cfg["objetivo_id"] = st.column_config.SelectboxColumn("objetivo", options=obj["objetivo_id"].tolist(), required=True)
    cfg["beneficio_neto"] = st.column_config.NumberColumn("benef. neto", format="%.2f")
    ed = st.data_editor(d.drop(columns=["empresa_id"]).reset_index(drop=True), num_rows="dynamic", width="stretch", key=f"ed_ini_{e}", hide_index=True,
                        column_config=cfg, disabled=["puntaje", "beneficio_neto"] if ui.puede("editar") else True, height=380)
    if st.button("💾 Guardar iniciativas", disabled=not ui.puede("editar")):
        _guardar("iniciativas", ed.drop(columns=["puntaje", "beneficio_neto"], errors="ignore").assign(empresa_id=e), e, "Iniciativas")
    a, b = st.columns([1.4, 1])
    with a:
        if len(d):
            fig = go.Figure()
            for tp, col in (("IA", C["accion"]), ("Tradicional", C["marca"])):
                x = d[d["tipo"] == tp]
                fig.add_scatter(x=x["puntaje"], y=x["beneficio_neto"], mode="markers+text", name=tp, text=x["iniciativa_id"],
                                textposition="top center", marker=dict(size=(x["presupuesto"].fillna(0) * 60 + 10), color=col, opacity=0.7),
                                hovertext=x["nombre"])
            fig.add_vline(x=3.5, line_dash="dot", line_color=C["gris"], annotation_text="umbral 3.5")
            fig.update_layout(height=340, plot_bgcolor="white", title="Matriz de priorización (tamaño = presupuesto)",
                              xaxis_title="Puntaje ponderado (1–5)", yaxis_title="Beneficio neto anual (S/ m)",
                              margin=dict(l=10, r=10, t=40, b=10))
            st.plotly_chart(fig, width="stretch")
    with b:
        st.markdown("##### Pesos de priorización")
        ce = st.data_editor(crit.sort_values("criterio_id"), hide_index=True, width="stretch", key="ed_crit",
                            disabled=["criterio_id", "escala_1_5"] if ui.puede("editar") else True,
                            column_config={"peso": st.column_config.NumberColumn("peso", format="%.2f", min_value=0.0, max_value=1.0)})
        s = ce["peso"].sum()
        st.caption(f"Suma de pesos: **{s:.0%}** " + ("✅" if fz.validar_pesos(dict(enumerate(ce["peso"]))) else "❌ debe ser 100%"))
        if st.button("💾 Guardar pesos", disabled=not (ui.puede("editar") and abs(s - 1) < 1e-6)):
            _guardar("criterios", ce, e, "Criterios", global_=True)
        st.caption("Puertas: G0 problema · G1 datos · G2 piloto · G3 producción · G4 escala.")


# ============================================================ Validación
def _validacion(val: pd.DataFrame, compacto: bool = False) -> None:
    color = {"ERROR": C["rojo"], "ALERTA": C["ambar"], "INFO": C["accion"], "OK": C["verde"]}
    resumen = val["nivel"].value_counts().to_dict()
    st.markdown(" ".join(ui.chip(f"{k}: {resumen.get(k, 0)}", color[k] + "1A", color[k]) for k in color), unsafe_allow_html=True)
    if compacto and not (val["nivel"] != "OK").any():
        return
    st.dataframe(val.style.map(lambda v: f"color:{color.get(v, '#000')};font-weight:700", subset=["nivel"]),
                 hide_index=True, width="stretch")
    if not compacto:
        st.caption("Reglas: 10–15 objetivos; 15–25 KPI; 1–2 KPI por objetivo; cuatro perspectivas; responsables; "
                   "objetivos con verbo; causalidad de abajo hacia arriba; ficha técnica completa; metas retadoras.")


# ============================================================ Simulación BSC
def _simulacion(e, obj, kpis) -> None:
    c = ui.ctx()
    if kpis.empty or obj.empty:
        st.info("Se requiere un BSC con objetivos y KPI.")
        return
    emp = _empresa(e)
    esc = ui.leer("escenarios", e)
    bf, mf = ia._base_meta_financiera(emp, esc, c["anio"], c["escenario"])
    if not bf:
        st.info("Registre escenarios para simular.")
        return
    st.markdown("Ajuste el **logro esperado** de cada KPI (0 % = se queda en la línea base, 100 % = alcanza la meta). "
                "El modelo causal traslada el logro de Aprendizaje → Procesos → Clientes → Financiera al EVA.")
    modo = st.radio("Punto de partida", ["Todas las metas al 100 %", "Logro real al periodo de control"], horizontal=True)
    logro_ini = {}
    if modo.startswith("Logro real"):
        ev = fz.evaluar_kpis(kpis, ui.leer("kpi_valores", e), c["periodo_id"])
        logro_ini = {r.kpi_id: max(0.0, min(1.5, r.cumplimiento)) for r in ev.itertuples() if r.cumplimiento is not None and not pd.isna(r.cumplimiento)}
    d = kpis.merge(obj[["objetivo_id", "perspectiva"]], on="objetivo_id", how="left")
    logros = {}
    cols = st.columns(4)
    for i, p in enumerate(config.PERSPECTIVAS):
        with cols[i]:
            st.markdown(f"**{p}**")
            for r in d[d["perspectiva"] == p].itertuples():
                logros[r.kpi_id] = st.slider(f"{r.kpi_id} {r.nombre[:28]}", 0, 150, int(round(logro_ini.get(r.kpi_id, 1.0) * 100)),
                                             5, key=f"sl_{e}_{r.kpi_id}_{modo[:5]}") / 100
    with st.expander("Pesos del modelo causal (hipótesis editables)"):
        w = dict(sim.PESOS_BSC_DEFECTO)
        a, b, c_ = st.columns(3)
        w["ventas_por_clientes"] = a.slider("Ventas ← Clientes", 0.0, 1.0, w["ventas_por_clientes"], 0.05)
        w["ventas_por_financiera"] = 1 - w["ventas_por_clientes"]
        w["margen_por_procesos"] = b.slider("Margen ← Procesos", 0.0, 1.0, w["margen_por_procesos"], 0.05)
        w["margen_por_financiera"] = 1 - w["margen_por_procesos"]
        w["efecto_aprendizaje"] = c_.slider("Dependencia Procesos ← Aprendizaje", 0.0, 1.0, w["efecto_aprendizaje"], 0.05)
    lp = sim.logro_por_perspectiva(kpis, logros, obj)
    res = sim.simular_bsc(bf, mf, lp, w)
    r = res["resultado"]
    k = st.columns(5)
    for i, p in enumerate(config.PERSPECTIVAS):
        k[i].metric(f"Logro {p}", f"{lp[p]:.0%}")
    k[4].metric("Logro Procesos efectivo", f"{res['logro_procesos_efectivo']:.0%}")
    comp = pd.DataFrame([
        {"Concepto": "Ventas (S/ m)", "Base": bf["ventas"], "Meta plan": mf["ventas"], "Simulado": r["ventas"]},
        {"Concepto": "Margen EBIT", "Base": bf["margen_ebit"], "Meta plan": mf["margen_ebit"], "Simulado": res["parametros"]["margen_ebit"]},
        {"Concepto": "NOPAT (S/ m)", "Base": bf["nopat"], "Meta plan": mf["nopat"], "Simulado": r["nopat"]},
        {"Concepto": "Capital (S/ m)", "Base": bf["capital"], "Meta plan": mf["capital"], "Simulado": r["capital"]},
        {"Concepto": "ROIC", "Base": bf["roic"], "Meta plan": mf["roic"], "Simulado": r["roic"]},
        {"Concepto": "EVA (S/ m)", "Base": bf["eva"], "Meta plan": mf["eva"], "Simulado": r["eva"]},
    ])
    a, b = st.columns([1, 1.2])
    es_pct = comp["Concepto"].isin(["Margen EBIT", "ROIC"])
    for col in ("Base", "Meta plan", "Simulado"):
        comp[col] = [f"{v:.2%}" if p else f"{v:,.3f}" for v, p in zip(comp[col], es_pct)]
    a.dataframe(comp, hide_index=True, width="stretch")
    fig = go.Figure(go.Bar(x=["Base", "Meta plan", "Simulado"], y=[bf["eva"], mf["eva"], r["eva"]],
                           marker_color=[C["gris"], C["marca"], C["accion"] if r["eva"] >= 0 else C["rojo"]],
                           text=[f"{v:,.2f}" for v in [bf["eva"], mf["eva"], r["eva"]]], textposition="outside"))
    fig.update_layout(height=300, plot_bgcolor="white", title="EVA (S/ m)", margin=dict(l=10, r=10, t=40, b=10))
    b.plotly_chart(fig, width="stretch")
    brecha = mf["eva"] - r["eva"]
    st.info(f"**Lectura IA:** con el logro indicado el EVA sería {fz.fmt_monto(r['eva'])}"
            + (f", {fz.fmt_monto(brecha)} por debajo de la meta. La perspectiva con menor logro es "
               f"**{min(lp, key=lp.get)}**: priorice sus iniciativas." if brecha > 0.005 else ", en línea o por encima de la meta."))
    if st.button("💾 Guardar simulación BSC", disabled=not ui.puede("editar")):
        db.guardar_simulacion({"empresa_id": e, "usuario": ui.usuario()["usuario"], "tipo": "Simulación BSC",
                               "anio": c["anio"], "escenario": c["escenario"],
                               "parametros_json": {"logros": logros, "pesos": w, "logro_perspectiva": lp},
                               "eva_det": r["eva"], "resultado_json": r})
        st.toast("Simulación guardada.", icon="✅")
