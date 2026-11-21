# -*- coding: utf-8 -*-
"""
vistas_plan.py - Módulo PLAN ESTRATÉGICO.

Pestañas: Identidad · Diagnóstico · Estrategias · Escenarios y simulación ·
Documento del plan · Aprobación.
Patrón en cada pestaña: [Proponer con IA] → revisar/editar → [Guardar] → flujo de aprobación.
"""
from __future__ import annotations

import json

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

import config
import db
import finanzas as fz
import motor_ia as ia
import simulador as sim
import ui

C = config.COLOR
TABLAS_PLAN = ["identidad", "diagnostico", "estrategias", "escenarios", "supuestos_mc", "documento_plan"]


def _empresa(e: str) -> dict:
    emp = ui.leer("empresas")
    return emp[emp["empresa_id"] == e].iloc[0].to_dict()


def _guardar(tabla: str, df: pd.DataFrame, e: str, mensaje: str) -> None:
    try:
        n = db.reemplazar(tabla, df, e, ui.usuario()["usuario"])
        _marcar_borrador(e, "plan")
        ui.refrescar()
        st.session_state["_toast"] = f"{mensaje}: {n} registros guardados."
        st.rerun()
    except ValueError as ex:
        st.error(f"No se guardó. {ex}")


def _marcar_borrador(e: str, entidad: str) -> None:
    """Regla RN09: editar un elemento aprobado abre una nueva versión en Borrador."""
    est = db.estado_flujo(e, entidad)
    if est["estado"] in ("Aprobado", "Rechazado"):
        db.cambiar_estado(e, entidad, "Borrador", ui.usuario()["usuario"], "Edición posterior a la aprobación")


# ============================================================ Página
def pagina_plan() -> None:
    ui.mostrar_toast()
    ui.encabezado("Plan Estratégico", "Formulación, propuesta IA, simulación y aprobación", entidad="plan")
    e = ui.requiere_empresa()
    if not e:
        return
    tabs = st.tabs(["🪪 Identidad", "🔎 Diagnóstico", "♟️ Estrategias", "🎲 Escenarios y simulación",
                    "📄 Documento del plan", "✅ Aprobación"])
    with tabs[0]:
        _identidad(e)
    with tabs[1]:
        _diagnostico(e)
    with tabs[2]:
        _estrategias(e)
    with tabs[3]:
        _escenarios(e)
    with tabs[4]:
        _documento(e)
    with tabs[5]:
        panel_aprobacion(e, "plan", TABLAS_PLAN, "Plan Estratégico")


# ============================================================ Identidad
def _identidad(e: str) -> None:
    emp = _empresa(e)
    df = ui.leer("identidad", e)
    ident = df.iloc[0].to_dict() if not df.empty else {"empresa_id": e}
    st.markdown("La misión se formula como **propuesta de valor** con seis componentes (guía 2027, p. 7). "
                "Complete los componentes y pida a la IA alternativas; usted elige y ajusta.")
    with st.form("form_identidad"):
        a, b = st.columns(2)
        v = {}
        etiquetas = {"cliente_prioritario": "¿A quién? (cliente prioritario)", "necesidad_critica": "¿Qué problema? (necesidad crítica)",
                     "oferta_diferenciada": "¿Qué ofrecemos? (oferta diferenciada)", "resultado_verificable": "¿Qué resultado? (verificable)",
                     "capacidades_distintivas": "¿Por qué nosotros? (capacidades)", "principios_limites": "¿Bajo qué principios? (límites)"}
        for i, k in enumerate(ia.COMPONENTES_MISION):
            v[k] = (a if i % 2 == 0 else b).text_area(etiquetas[k], ia._txt(ident.get(k)), height=80)
        v["mision"] = st.text_area("Misión", ia._txt(ident.get("mision")), height=100)
        c1, c2 = st.columns(2)
        v["vision"] = c1.text_area("Visión (objetivo desafiante + nicho + horizonte)", ia._txt(ident.get("vision")), height=100)
        v["valores"] = c2.text_area("Valores (separados por ;)", ia._txt(ident.get("valores")), height=100)
        guardar = st.form_submit_button("💾 Guardar identidad", type="primary", disabled=not ui.puede("editar"))
    if guardar:
        _guardar("identidad", pd.DataFrame([{**v, "empresa_id": e, "estado": "Borrador"}]), e, "Identidad")

    st.markdown("#### 🤖 Propuesta IA")
    c1, c2 = st.columns([1, 3])
    if c1.button("Proponer misión, visión y valores", disabled=not ui.puede("editar")):
        st.session_state[f"prop_mision_{e}"] = {
            "misiones": ia.proponer_misiones({**ident}), "vision": ia.proponer_vision(emp, ident),
            "valores": ia.proponer_valores(ident)}
    prop = st.session_state.get(f"prop_mision_{e}")
    if not prop:
        c2.caption("La IA usa solo los componentes registrados; los que faltan se marcan entre corchetes.")
        return
    if prop["misiones"][0]["componentes_faltantes"]:
        st.warning("Componentes sin completar: " + ", ".join(prop["misiones"][0]["componentes_faltantes"]))
    opciones = [f"{m['enfoque']} ({m['palabras']} palabras)" for m in prop["misiones"]]
    elegida = st.radio("Alternativas de misión", range(len(opciones)), format_func=lambda i: opciones[i])
    m = prop["misiones"][elegida]
    st.info(m["mision"])
    st.dataframe(pd.DataFrame(m["evaluacion"]), hide_index=True, width="stretch")
    st.caption(m["riesgo"])
    st.markdown(f"**Visión sugerida:** {prop['vision']}  \n**Valores sugeridos:** {prop['valores']}")
    if st.button("Usar esta propuesta (misión, visión y valores)", type="primary", disabled=not ui.puede("editar")):
        nuevo = {**{k: ia._txt(ident.get(k)) for k in ia.COMPONENTES_MISION}, "empresa_id": e, "mision": m["mision"],
                 "vision": prop["vision"], "valores": prop["valores"], "estado": "Propuesto"}
        st.session_state.pop(f"prop_mision_{e}", None)
        db.auditar(ui.usuario()["usuario"], e, "identidad", "PROPUESTA_IA_ACEPTADA", m["enfoque"])
        _guardar("identidad", pd.DataFrame([nuevo]), e, "Identidad propuesta por IA")


# ============================================================ Diagnóstico
def _diagnostico(e: str) -> None:
    diag = ui.leer("diagnostico", e)
    r = ia.resumen_diagnostico(diag)
    k = st.columns(4)
    k[0].metric("Hechos críticos", r["hechos"])
    k[1].metric("Factores PESTEL", f"{r['pestel']} / 6")
    k[2].metric("Elementos FODA", sum(r["foda"].values()) if r["foda"] else 0)
    k[3].metric("Impacto alto", r["alto_impacto"])
    if r["brechas"]:
        st.warning("**Brechas del diagnóstico (IA):** " + " · ".join(r["brechas"]))
    filtro = st.segmented_control("Ver", ["Todos", "HECHO", "PESTEL", "FODA"], default="Todos", key=f"fdiag_{e}")
    vista = diag if filtro in (None, "Todos") else diag[diag["tipo"] == filtro]
    st.caption("Formato de hecho crítico: hecho → evidencia → impacto → decisión que exige. Sin fuente es hipótesis.")
    editado = st.data_editor(
        vista.drop(columns=["id", "empresa_id"], errors="ignore").reset_index(drop=True), num_rows="dynamic", width="stretch", height=380,
        key=f"ed_diag_{e}_{filtro}", hide_index=True, disabled=not ui.puede("editar"),
        column_config={
            "tipo": st.column_config.SelectboxColumn("tipo", options=["HECHO", "PESTEL", "FODA"], required=True),
            "categoria": st.column_config.SelectboxColumn("categoria", options=[
                "Cliente", "Operación", "Finanzas", "Oferta", "Capacidades", "Mercado", "Político", "Económico", "Social",
                "Tecnológico", "Ecológico", "Legal", "Fortaleza", "Debilidad", "Oportunidad", "Amenaza"]),
            "impacto": st.column_config.SelectboxColumn("impacto", options=["Alto", "Medio", "Bajo"]),
            "descripcion": st.column_config.TextColumn("descripcion", width="large"),
            "implicancia_decision": st.column_config.TextColumn("implicancia_decision", width="large")})
    c1, c2, _ = st.columns([1, 1.4, 2])
    if c1.button("💾 Guardar diagnóstico", type="primary", disabled=not ui.puede("editar")):
        resto = diag if filtro in (None, "Todos") else diag[diag["tipo"] != filtro]
        total = pd.concat([resto.drop(columns=["id"], errors="ignore"), editado.assign(empresa_id=e)], ignore_index=True)
        _guardar("diagnostico", total, e, "Diagnóstico")
    if c2.button("🤖 Completar con plantilla PESTEL/FODA", disabled=not ui.puede("editar"),
                 help="Agrega factores genéricos del entorno peruano; valide y ajuste con evidencia."):
        base = ia.proponer_diagnostico_base(e)
        existentes = set(zip(diag["tipo"], diag["categoria"]))
        nuevos = base[[(t, c) not in existentes for t, c in zip(base["tipo"], base["categoria"])]]
        total = pd.concat([diag.drop(columns=["id"], errors="ignore"), nuevos], ignore_index=True)
        db.auditar(ui.usuario()["usuario"], e, "diagnostico", "PROPUESTA_IA", f"{len(nuevos)} factores de plantilla")
        _guardar("diagnostico", total, e, "Diagnóstico completado")


# ============================================================ Estrategias
def _estrategias(e: str) -> None:
    emp = _empresa(e)
    diag = ui.leer("diagnostico", e)
    est = ui.leer("estrategias", e)
    g, razon = ia.generica_sugerida(diag, ia._txt(emp.get("tipo")))
    st.info(f"**Estrategia genérica sugerida (Kaplan y Norton):** {g}  \n{razon}")
    c1, c2 = st.columns([1, 3])
    if c1.button("🤖 Proponer estrategias (FODA cruzado)", disabled=not ui.puede("editar")):
        st.session_state[f"prop_est_{e}"] = ia.proponer_estrategias(e, diag, ia._txt(emp.get("tipo")))
    prop = st.session_state.get(f"prop_est_{e}")
    if prop is not None:
        st.markdown("##### Propuesta IA (revise y edite antes de aceptar)")
        prop_ed = st.data_editor(prop.drop(columns=["empresa_id"]), num_rows="dynamic", width="stretch",
                                 key=f"ed_prop_est_{e}", hide_index=True, column_config=_cfg_estrategias())
        a, b, _ = st.columns([1, 1, 3])
        if a.button("✅ Aceptar propuesta", type="primary"):
            st.session_state.pop(f"prop_est_{e}", None)
            db.auditar(ui.usuario()["usuario"], e, "estrategias", "PROPUESTA_IA_ACEPTADA", f"{len(prop_ed)} estrategias")
            _guardar("estrategias", prop_ed.assign(empresa_id=e), e, "Estrategias")
        if b.button("Descartar"):
            st.session_state.pop(f"prop_est_{e}", None)
            st.rerun()
        return
    c2.caption("Tipos: FO, DO, FA, DA, Apuesta (dónde competir y cómo ganar) y Renuncia (qué no hacer).")
    if est.empty:
        st.info("Aún no hay estrategias. Use la propuesta IA o agregue filas.")
    editado = st.data_editor(est.drop(columns=["id", "empresa_id"], errors="ignore"), num_rows="dynamic",
                             width="stretch", key=f"ed_est_{e}", hide_index=True, column_config=_cfg_estrategias(),
                             disabled=not ui.puede("editar"))
    if st.button("💾 Guardar estrategias", type="primary", disabled=not ui.puede("editar")):
        _guardar("estrategias", editado.assign(empresa_id=e), e, "Estrategias")


def _cfg_estrategias() -> dict:
    return {"tipo": st.column_config.SelectboxColumn("tipo", options=["FO", "DO", "FA", "DA", "Apuesta", "Renuncia"], required=True),
            "descripcion": st.column_config.TextColumn("descripcion", width="large"),
            "estado": st.column_config.SelectboxColumn("estado", options=config.ESTADOS_FLUJO),
            "prioridad": st.column_config.NumberColumn("prioridad", min_value=1, max_value=10, step=1)}


# ============================================================ Escenarios y simulación
def _escenarios(e: str) -> None:
    c = ui.ctx()
    anio = c["anio"]
    esc_all = ui.leer("escenarios", e)
    st.markdown(f"##### Escenarios {anio} (multi-escenario)")
    esc = esc_all[esc_all["anio"] == anio]
    edit = st.data_editor(
        esc.drop(columns=["id", "empresa_id", "anio"], errors="ignore").reset_index(drop=True), num_rows="dynamic", width="stretch",
        key=f"ed_esc_{e}_{anio}", hide_index=True, disabled=not ui.puede("editar"),
        column_config={"margen_ebit": st.column_config.NumberColumn("margen_ebit", format="%.3f", help="Fracción: 11.5% = 0.115"),
                       "wacc": st.column_config.NumberColumn("wacc", format="%.3f"),
                       "tasa_ir": st.column_config.NumberColumn("tasa_ir", format="%.3f"),
                       "probabilidad": st.column_config.NumberColumn("probabilidad", format="%.2f", min_value=0.0, max_value=1.0),
                       "supuestos": st.column_config.TextColumn("supuestos", width="large")})
    if st.button("💾 Guardar escenarios del año", disabled=not ui.puede("editar")):
        otros = esc_all[esc_all["anio"] != anio].drop(columns=["id"], errors="ignore")
        _guardar("escenarios", pd.concat([otros, edit.assign(empresa_id=e, anio=anio)], ignore_index=True), e, "Escenarios")
    tabla = fz.tabla_escenarios(edit.dropna(subset=["ventas", "margen_ebit", "capital_invertido", "wacc", "tasa_ir"]).assign(anio=anio))
    if tabla.empty:
        st.info("Registre al menos un escenario con ventas, margen, capital, WACC y tasa.")
        return
    if abs(tabla["probabilidad"].fillna(0).sum() - 1) > 0.01:
        st.warning(f"Las probabilidades suman {tabla['probabilidad'].fillna(0).sum():.0%}; el EVA esperado se normaliza.")

    st.markdown("##### Resultado económico por escenario")
    vista = tabla[["escenario", "probabilidad", "ventas", "ebit", "nopat", "capital_invertido", "wacc", "cargo_capital", "roic", "spread", "eva"]]
    st.dataframe(vista.style.format({"probabilidad": "{:.0%}", "ventas": "{:,.2f}", "ebit": "{:,.3f}", "nopat": "{:,.3f}",
                                     "capital_invertido": "{:,.2f}", "wacc": "{:.2%}", "cargo_capital": "{:,.3f}",
                                     "roic": "{:.2%}", "spread": "{:+.2%}", "eva": "{:,.3f}"})
                 .map(lambda x: f"color:{C['rojo']};font-weight:600" if isinstance(x, float) and x < 0 else "", subset=["eva", "spread"]),
                 hide_index=True, width="stretch")
    k = st.columns(3)
    k[0].metric("EVA esperado (ponderado)", fz.fmt_monto(fz.eva_esperado(tabla)))
    k[1].metric("Escenarios con EVA < 0", int((tabla["eva"] < 0).sum()))
    k[2].metric("ROIC − WACC (rango)", f"{tabla['spread'].min() * 100:+.2f} a {tabla['spread'].max() * 100:+.2f} pp")

    t1, t2, t3, t4 = st.tabs(["📊 Comparación y cascada", "🌪️ Sensibilidad", "🎲 Monte Carlo", "📈 Multiperiodo"])
    with t1:
        _grafico_comparacion(tabla)
    base_row = tabla[tabla["escenario"] == c["escenario"]]
    base_row = base_row.iloc[0] if not base_row.empty else tabla.iloc[0]
    base = {v: float(base_row[v]) for v in sim.VARIABLES}
    with t2:
        _sensibilidad(base, base_row["escenario"])
    with t3:
        mc = _montecarlo(e, anio, tabla)
    with t4:
        _multiperiodo(e, anio, base, esc_all)
    st.markdown("##### 🤖 Narrativa ejecutiva")
    st.markdown(ia.narrativa_escenarios(tabla, st.session_state.get(f"mc_{e}_{anio}"), ui.nombre_empresa(e), anio))


def _grafico_comparacion(tabla: pd.DataFrame) -> None:
    a, b = st.columns(2)
    fig = go.Figure()
    fig.add_bar(x=tabla["escenario"], y=tabla["nopat"], name="NOPAT", marker_color=C["marca"])
    fig.add_bar(x=tabla["escenario"], y=tabla["cargo_capital"], name="Cargo de capital", marker_color=C["gris"])
    fig.add_scatter(x=tabla["escenario"], y=tabla["eva"], name="EVA", mode="markers+text", marker=dict(size=14, color=C["accion"]),
                    text=[f"{v:,.2f}" for v in tabla["eva"]], textposition="top center")
    fig.update_layout(barmode="group", height=340, title="NOPAT vs cargo de capital (S/ m)", plot_bgcolor="white",
                      margin=dict(l=10, r=10, t=40, b=10), legend=dict(orientation="h", y=-0.15))
    a.plotly_chart(fig, width="stretch")
    esc = b.selectbox("Cascada del escenario", tabla["escenario"].tolist(), key="cascada_esc")
    r = tabla[tabla["escenario"] == esc].iloc[0]
    impuestos = r["ebit"] - r["nopat"]
    fig2 = go.Figure(go.Waterfall(
        x=["EBIT", "Impuestos", "NOPAT", "Cargo de capital", "EVA"],
        measure=["absolute", "relative", "total", "relative", "total"],
        y=[r["ebit"], -impuestos, 0, -r["cargo_capital"], 0],
        text=[f"{v:,.2f}" for v in [r["ebit"], -impuestos, r["nopat"], -r["cargo_capital"], r["eva"]]],
        connector={"line": {"color": C["borde"]}}, increasing={"marker": {"color": C["accion"]}},
        decreasing={"marker": {"color": C["rojo"]}}, totals={"marker": {"color": C["marca"]}}))
    fig2.update_layout(height=340, title=f"De EBIT a EVA — {esc} (S/ m)", plot_bgcolor="white", margin=dict(l=10, r=10, t=40, b=10))
    b.plotly_chart(fig2, width="stretch")


def _sensibilidad(base: dict, nombre: str) -> None:
    var = st.slider("Variación de cada palanca (±%)", 1, 30, 10, key="sens_var") / 100
    t = sim.sensibilidad(base, var)
    fig = go.Figure()
    fig.add_bar(y=t["variable"], x=t["eva_baja"] - t["eva_base"], orientation="h", name=f"−{var:.0%}", marker_color=C["rojo"])
    fig.add_bar(y=t["variable"], x=t["eva_alta"] - t["eva_base"], orientation="h", name=f"+{var:.0%}", marker_color=C["accion"])
    fig.update_layout(barmode="overlay", height=330, plot_bgcolor="white", title=f"Tornado: cambio en EVA vs {nombre} (S/ m)",
                      margin=dict(l=10, r=10, t=40, b=10), legend=dict(orientation="h", y=-0.2))
    st.plotly_chart(fig, width="stretch")
    st.caption(f"La palanca de mayor impacto es **{t.iloc[-1]['variable']}**: ±{var:.0%} mueve el EVA "
               f"S/ {t.iloc[-1]['impacto'] / 2:,.2f} m en cada sentido.")


def _montecarlo(e: str, anio: str, tabla: pd.DataFrame) -> dict | None:
    sup = ui.leer("supuestos_mc", e)
    sup_a = sup[sup["anio"] == anio]
    origen = "Supuestos Monte Carlo registrados"
    if sup_a.empty:
        sup_a = sim.supuestos_desde_escenarios(tabla)
        origen = "Derivados de los escenarios (mín / Base / máx)"
    st.caption(f"Fuente de supuestos: {origen}. Distribución triangular (mínimo, moda, máximo).")
    sup_ed = st.data_editor(sup_a[["variable", "distribucion", "minimo", "moda", "maximo"]].reset_index(drop=True),
                            width="stretch", key=f"ed_mc_{e}_{anio}", hide_index=True, disabled=["variable"],
                            column_config={"distribucion": st.column_config.SelectboxColumn(
                                "distribucion", options=["Triangular", "Uniforme", "Fija"])})
    a, b, c_, d = st.columns([1, 1, 1, 1])
    n = a.number_input("Iteraciones", 1000, 100_000, config.MC_ITERACIONES, 1000)
    semilla = b.number_input("Semilla", 0, 999_999, config.MC_SEMILLA)
    if c_.button("▶ Ejecutar Monte Carlo", type="primary"):
        try:
            st.session_state[f"mc_{e}_{anio}"] = sim.montecarlo(sup_ed, int(n), int(semilla))
            st.session_state[f"mc_sup_{e}_{anio}"] = sup_ed
        except ValueError as ex:
            st.error(str(ex))
    if d.button("💾 Guardar supuestos", disabled=not ui.puede("editar")):
        otros = sup[sup["anio"] != anio].drop(columns=["id"], errors="ignore")
        _guardar("supuestos_mc", pd.concat([otros, sup_ed.assign(empresa_id=e, anio=anio)], ignore_index=True), e, "Supuestos")
    mc = st.session_state.get(f"mc_{e}_{anio}")
    if not mc:
        return None
    k = st.columns(5)
    k[0].metric("EVA P10", fz.fmt_monto(mc["p10"]))
    k[1].metric("EVA P50", fz.fmt_monto(mc["p50"]))
    k[2].metric("EVA P90", fz.fmt_monto(mc["p90"]))
    k[3].metric("P(EVA > 0)", f"{mc['prob_eva_pos']:.1%}", delta="Alerta" if mc["alerta"] else "OK",
                delta_color="inverse" if mc["alerta"] else "normal")
    k[4].metric("ROIC P50", f"{mc['roic_p50']:.2%}")
    x, y = st.columns([1.6, 1])
    fig = go.Figure(go.Histogram(x=mc["eva"], nbinsx=60, marker_color=C["accion"], opacity=0.85))
    for val, nom in [(mc["p10"], "P10"), (mc["p50"], "P50"), (mc["p90"], "P90")]:
        fig.add_vline(x=val, line_dash="dash", line_color=C["marca"], annotation_text=nom)
    fig.add_vline(x=0, line_color=C["rojo"])
    fig.update_layout(height=320, plot_bgcolor="white", title="Distribución del EVA (S/ m)", margin=dict(l=10, r=10, t=40, b=10))
    x.plotly_chart(fig, width="stretch")
    contrib = pd.DataFrame(list(mc["contribucion"].items()), columns=["Variable", "Contribución a la varianza"])
    y.dataframe(contrib.style.format({"Contribución a la varianza": "{:.0%}"}), hide_index=True, width="stretch")
    if y.button("💾 Guardar corrida", disabled=not ui.puede("editar")):
        sup_g = st.session_state.get(f"mc_sup_{e}_{anio}", sup_ed)
        esc_base = tabla[tabla["escenario"] == "Base"]
        db.guardar_simulacion({
            "empresa_id": e, "usuario": ui.usuario()["usuario"], "tipo": "Monte Carlo", "anio": anio,
            "escenario": "Distribución", "parametros_json": {"n": mc["n"], "semilla": mc["semilla"],
                                                             "supuestos": sup_g.to_dict("records")},
            "eva_det": float(esc_base["eva"].iloc[0]) if not esc_base.empty else None,
            "p10": mc["p10"], "p50": mc["p50"], "p90": mc["p90"], "prob_eva_pos": mc["prob_eva_pos"],
            "resultado_json": {"media": mc["media"], "desv": mc["desv"], "contribucion": mc["contribucion"]}})
        st.toast("Corrida guardada (ver Auditoría → Simulaciones).", icon="✅")
    return mc


def _multiperiodo(e: str, anio: str, base: dict, esc_all: pd.DataFrame) -> None:
    st.caption("Proyección de varios años desde el escenario seleccionado, con tasas anuales constantes.")
    a, b, c_, d, f = st.columns(5)
    n = a.number_input("Años adicionales", 1, 10, 3)
    cv = b.number_input("Crec. ventas %/año", -20.0, 50.0, 5.0, 0.5) / 100
    dm = c_.number_input("Δ margen pp/año", -5.0, 5.0, 0.3, 0.1)
    cc = d.number_input("Crec. capital %/año", -20.0, 50.0, 2.0, 0.5) / 100
    dw = f.number_input("Δ WACC pp/año", -3.0, 3.0, 0.0, 0.1)
    proy = sim.proyeccion_multiperiodo(base, int(anio), int(n), cv, dm, cc, dw)
    inicial = pd.DataFrame([{"anio": anio, **sim.evaluar(base), "margen_ebit": base["margen_ebit"]}])
    serie = pd.concat([inicial, proy], ignore_index=True)
    reales = fz.tabla_escenarios(esc_all[esc_all["escenario"] == "Real"])
    fig = go.Figure()
    if not reales.empty:
        fig.add_bar(x=reales["anio"], y=reales["eva"], name="EVA real", marker_color=C["gris"])
    fig.add_bar(x=serie["anio"], y=serie["eva"], name="EVA proyectado", marker_color=C["accion"])
    fig.add_scatter(x=serie["anio"], y=serie["roic"] * 100, name="ROIC %", yaxis="y2", line=dict(color=C["marca"]))
    fig.add_scatter(x=serie["anio"], y=serie["wacc"] * 100, name="WACC %", yaxis="y2", line=dict(color=C["rojo"], dash="dot"))
    fig.update_layout(height=340, plot_bgcolor="white", margin=dict(l=10, r=10, t=30, b=10),
                      yaxis=dict(title="EVA S/ m"), yaxis2=dict(title="%", overlaying="y", side="right"),
                      legend=dict(orientation="h", y=-0.2))
    st.plotly_chart(fig, width="stretch")
    st.dataframe(serie[["anio", "ventas", "margen_ebit", "nopat", "capital", "roic", "wacc", "eva"]]
                 .style.format({"ventas": "{:,.2f}", "margen_ebit": "{:.2%}", "nopat": "{:,.3f}", "capital": "{:,.2f}",
                                "roic": "{:.2%}", "wacc": "{:.2%}", "eva": "{:,.3f}"}), hide_index=True, width="stretch")
    if st.button("💾 Guardar años proyectados como escenario «Proyección»", disabled=not ui.puede("editar")):
        filas = pd.DataFrame([{"empresa_id": e, "anio": r.anio, "escenario": "Proyección", "ventas": r.ventas,
                               "margen_ebit": r.margen_ebit, "capital_invertido": r.capital, "wacc": r.wacc,
                               "tasa_ir": base["tasa_ir"], "probabilidad": 1.0,
                               "supuestos": f"Proyección desde {anio}: ventas {cv:+.1%}/año, margen {dm:+.1f} pp/año, capital {cc:+.1%}/año"}
                              for r in proy.itertuples()])
        resto = esc_all[~((esc_all["escenario"] == "Proyección") & esc_all["anio"].isin(filas["anio"]))].drop(columns=["id"], errors="ignore")
        _guardar("escenarios", pd.concat([resto, filas], ignore_index=True), e, "Proyección multiperiodo")


# ============================================================ Documento del plan
def _documento(e: str) -> None:
    c = ui.ctx()
    doc = ui.leer("documento_plan", e).sort_values("orden") if not ui.leer("documento_plan", e).empty else ui.leer("documento_plan", e)
    st.markdown("Contenido mínimo del plan estratégico anual (12 secciones, guía 2027 p. 34).")
    if st.button("🤖 Redactar / actualizar documento con IA", disabled=not ui.puede("editar")):
        emp = _empresa(e)
        ident_df = ui.leer("identidad", e)
        esc = ui.leer("escenarios", e)
        nuevo = ia.documento_plan(emp, ident_df.iloc[0].to_dict() if not ident_df.empty else {}, ui.leer("diagnostico", e),
                                  ui.leer("estrategias", e), fz.tabla_escenarios(esc[esc["anio"] == c["anio"]]),
                                  ui.leer("objetivos", e), ui.leer("kpis", e), ui.leer("iniciativas", e),
                                  ui.leer("riesgos", e), c["anio"])
        db.auditar(ui.usuario()["usuario"], e, "documento_plan", "PROPUESTA_IA", "12 secciones")
        _guardar("documento_plan", nuevo, e, "Documento del plan")
    if doc.empty:
        st.info("Sin documento. Pulse el botón para que la IA lo redacte con los datos registrados.")
        return
    with st.form("form_doc"):
        textos = {}
        for r in doc.itertuples():
            textos[r.seccion] = st.text_area(r.seccion, r.contenido, height=110)
        ok = st.form_submit_button("💾 Guardar documento", type="primary", disabled=not ui.puede("editar"))
    if ok:
        _guardar("documento_plan", doc.assign(contenido=doc["seccion"].map(textos), origen="Usuario"), e, "Documento")
    md = f"# Plan Estratégico {c['anio']} — {ui.nombre_empresa(e)}\n\n" + "\n\n".join(
        f"## {r.seccion}\n\n{r.contenido}" for r in doc.itertuples())
    st.download_button("⬇️ Descargar plan (Markdown)", md, file_name=f"Plan_Estrategico_{e}_{c['anio']}.md")


# ============================================================ Aprobación (reutilizable)
def panel_aprobacion(e: str, entidad: str, tablas: list[str], nombre: str, validacion: pd.DataFrame | None = None) -> None:
    est = db.estado_flujo(e, entidad)
    st.markdown(f"Estado actual: {ui.chip_estado(est['estado'])} · versión **{est['version']}** · "
                f"{est['actualizado'] or 'sin movimientos'} {('· ' + est['usuario']) if est['usuario'] else ''}",
                unsafe_allow_html=True)
    if est["comentario"]:
        st.caption(f"Último comentario: {est['comentario']}")
    st.markdown("**Flujo:** Borrador → Propuesto → En revisión → Aprobado / Rechazado. "
                "Editar después de aprobar crea una nueva versión en Borrador.")
    errores = 0 if validacion is None else int((validacion["nivel"] == "ERROR").sum())
    if errores:
        st.error(f"Hay {errores} errores de coherencia: corríjalos antes de aprobar.")
    coment = st.text_input("Comentario", key=f"com_{entidad}_{e}")
    a, b, c_, d = st.columns(4)
    usuario = ui.usuario()["usuario"]
    if a.button("📨 Enviar a revisión", key=f"rev_{entidad}", disabled=not ui.puede("editar") or est["estado"] == "En revisión"):
        db.cambiar_estado(e, entidad, "En revisión", usuario, coment)
        ui.refrescar(); st.rerun()
    if b.button("✅ Aprobar", key=f"apr_{entidad}", type="primary", disabled=not ui.puede("aprobar") or errores > 0):
        db.cambiar_estado(e, entidad, "Aprobado", usuario, coment or f"{nombre} aprobado", db.snapshot(e, tablas))
        ui.refrescar()
        st.session_state["_toast"] = f"{nombre} aprobado."
        st.rerun()
    if c_.button("↩️ Rechazar", key=f"rch_{entidad}", disabled=not ui.puede("aprobar")):
        if not coment:
            st.warning("Indique el motivo del rechazo en el comentario.")
        else:
            db.cambiar_estado(e, entidad, "Rechazado", usuario, coment)
            ui.refrescar(); st.rerun()
    if d.button("✏️ Volver a borrador", key=f"bor_{entidad}", disabled=not ui.puede("editar")):
        db.cambiar_estado(e, entidad, "Borrador", usuario, coment)
        ui.refrescar(); st.rerun()
    if not ui.puede("aprobar"):
        st.caption("Su rol no permite aprobar (roles Aprobador o Administrador).")
    ver = db.leer("versiones", e, "entidad = ?", (entidad,), orden="id DESC")
    if not ver.empty:
        st.markdown("##### Historial")
        st.dataframe(ver[["version", "estado", "usuario", "fecha", "comentario"]], hide_index=True, width="stretch")
        aprob = ver[ver["snapshot_json"].notna()]
        if not aprob.empty:
            snap = json.loads(aprob.iloc[0]["snapshot_json"])
            st.caption(f"Última versión aprobada (v{aprob.iloc[0]['version']}): "
                       + ", ".join(f"{k}: {len(v)} registros" for k, v in snap.items()))
