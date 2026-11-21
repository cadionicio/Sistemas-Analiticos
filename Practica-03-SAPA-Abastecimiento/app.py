"""Torre de Control WES - Sistema Analitico Predictivo de Abastecimiento.

Interfaz de operacion del superagente. Tres consolas:

    1. Orquestacion y E-Procurement   - estado del sistema, ejecucion del
       pipeline y segmentacion estrategica (matriz de Kraljic).
    2. Inteligencia Logistica         - indicadores del agente descriptivo y
       atribucion de causa raiz del agente diagnostico.
    3. Gemelo Digital                 - panel de simulacion que reconfigura la
       politica y vuelve a ejecutar los agentes predictivo y prescriptivo.

Principio de diseno de la consola 3: los controles GOBIERNAN EL CALCULO, no la
presentacion. Mover el nivel de servicio cambia z, cambia el stock de
seguridad, cambia la necesidad neta y cambia la canasta. Un panel cuyos
deslizadores solo filtran una tabla ya calculada es una demostracion, no un
gemelo digital.

Este archivo se ejecuta bajo el runtime de Streamlit. No debe invocarse con
`python app.py`; el punto de entrada del aplicativo es `run_app.py`.
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

# Cuando Streamlit ejecuta este script, el directorio del proyecto puede no
# estar en sys.path. Bajo Nuitka los paquetes ya vienen compilados dentro del
# binario y esta insercion es inocua.
_RAIZ = Path(__file__).resolve().parent
if str(_RAIZ) not in sys.path:
    sys.path.insert(0, str(_RAIZ))

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from agents.core_agent import ContextoEjecucion, SuperAgenteCoordinador
from agents.registro import agentes_completos
from config import settings
from ui import datos as dd
from ui import tema
from ui.carga import consola_carga

# =============================================================================
# CONFIGURACION DE PAGINA
# =============================================================================
st.set_page_config(
    page_title=f"{settings.APP_NOMBRE} · Torre de Control WES",
    page_icon="◧",
    layout="wide",
    initial_sidebar_state="expanded",
)
tema.aplicar_tema()

_PEN = "S/ "


def _fmt(v: float, dec: int = 0, pref: str = "", suf: str = "") -> str:
    """Formatea un numero con separador de miles y decimales fijos."""
    try:
        return f"{pref}{v:,.{dec}f}{suf}"
    except (TypeError, ValueError):
        return "—"


def _pct(v: float, dec: int = 1) -> str:
    """Formatea una fraccion como porcentaje."""
    try:
        return f"{v * 100:,.{dec}f}%"
    except (TypeError, ValueError):
        return "—"


# =============================================================================
# EJECUCION DEL SUPERAGENTE
# =============================================================================
def construir_coordinador() -> SuperAgenteCoordinador:
    """Registra los cinco especialistas en un coordinador nuevo."""
    coord = SuperAgenteCoordinador(db=dd.gestor())
    coord.registrar_varios(agentes_completos(dd.gestor()))
    return coord


def ejecutar_pipeline(
    fecha_corte: str, horizonte: int, parametros: dict | None = None,
    etiqueta: str = "UI",
) -> str | None:
    """Ejecuta el pipeline completo mostrando el avance en pantalla.

    Args:
        fecha_corte: ultimo dia con informacion completa.
        horizonte: meses a planificar.
        parametros: overrides de politica para esta corrida.
        etiqueta: prefijo del identificador de corrida.

    Returns:
        str | None: identificador de la corrida, o None si fallo al abrirla.
    """
    coord = construir_coordinador()
    ctx = ContextoEjecucion(
        id_corrida=SuperAgenteCoordinador.nueva_corrida(etiqueta),
        fecha_corte=fecha_corte,
        horizonte_meses=horizonte,
        escenarios=tuple(e.nombre for e in settings.ESCENARIOS),
        usuario=st.session_state.get("usuario", "director_proyecto"),
        parametros=parametros or {},
    )
    with st.status("Orquestando especialistas…", expanded=True) as estado:
        st.write(f"Corrida `{ctx.id_corrida}` · corte {fecha_corte} · horizonte {horizonte} meses")
        try:
            resultados = coord.ejecutar_pipeline(ctx)
        except Exception as exc:  # noqa: BLE001 - frontera de la UI
            estado.update(label="La corrida no pudo completarse", state="error")
            st.error(f"{type(exc).__name__}: {exc}")
            return None

        for nombre, r in resultados.items():
            icono = {"CALCULADO": "✓", "OBSERVADO": "!", "BLOQUEADO": "×",
                     "FALLIDO": "×", "OMITIDO": "–"}.get(r.estado.value, "·")
            st.write(f"{icono} **{nombre}** · {r.estado.value} · {r.duracion_seg:.2f}s · {r.mensaje}")
        estado.update(label=f"Corrida {ctx.id_corrida} completada", state="complete")

    dd.limpiar_cache()
    st.session_state["corrida"] = ctx.id_corrida
    return ctx.id_corrida


# =============================================================================
# BARRA LATERAL
# =============================================================================
def barra_lateral() -> dict:
    """Dibuja la barra lateral y devuelve la configuracion activa."""
    with st.sidebar:
        st.markdown("### ◧ SAPA · Torre de Control")
        st.caption(f"v{settings.APP_VERSION}")

        estado = dd.estado_base()
        ok = bool(estado.get("ok"))
        color = tema.COLORES["ok"] if ok else tema.COLORES["alerta"]
        st.markdown(
            tema.pildora("BASE OPERATIVA" if ok else "BASE CON OBSERVACIONES", color)
            + f"&nbsp;&nbsp;<span style='font-size:.72rem;color:{tema.COLORES['texto_tenue']}'>"
              f"{estado.get('journal_mode', '—')} · {estado.get('tamano_mb', 0)} MB</span>",
            unsafe_allow_html=True,
        )

        conteos = estado.get("conteos", {}) or {}
        st.caption(
            f"{conteos.get('maestro_materiales', 0):,} SKU · "
            f"{conteos.get('historico_demanda', 0):,} registros diarios · "
            f"{conteos.get('ordenes_compra', 0):,} ordenes"
        )

        st.divider()
        st.markdown("**Parametros de planificacion**")
        corte = st.date_input(
            "Fecha de corte",
            value=date.fromisoformat(settings.SIMULACION.fecha_corte),
            help="Ultimo dia con informacion completa. El mes parcial nunca se "
                 "trata como mes cerrado.",
        )
        horizonte = st.slider("Horizonte (meses)", 6, 18,
                              settings.INVENTARIO.horizonte_meses)

        st.divider()
        historial = dd.corridas()
        if historial.empty:
            st.info("Sin corridas registradas. Ejecute el pipeline en la consola 1.")
            seleccion = None
        else:
            etiquetas = {
                f"{r.id_corrida} · {r.estado}": r.id_corrida
                for r in historial.itertuples()
            }
            actual = st.session_state.get("corrida")
            claves = list(etiquetas)
            idx = next((i for i, k in enumerate(claves) if etiquetas[k] == actual), 0)
            elegida = st.selectbox("Corrida activa", claves, index=idx)
            seleccion = etiquetas[elegida]
            st.session_state["corrida"] = seleccion

        st.divider()
        if st.button("Refrescar datos", width="stretch"):
            dd.limpiar_cache()
            st.rerun()

        st.caption(
            "Los agentes se ejecutan sobre la base local SQLite. "
            "Ninguna consulta sale del equipo."
        )

    return {"corte": corte.isoformat(), "horizonte": int(horizonte), "corrida": seleccion}


# =============================================================================
# CONSOLA 1 · ORQUESTACION Y E-PROCUREMENT
# =============================================================================
def consola_orquestacion(cfg: dict) -> None:
    """Estado del sistema, ejecucion del pipeline y segmentacion estrategica."""
    estado = dd.estado_base()
    conteos = estado.get("conteos", {}) or {}
    historial = dd.corridas(1)

    c1, c2, c3, c4 = st.columns(4)
    with c1:
        tema.kpi("Integridad de la base",
                 "OK" if estado.get("ok") else "REVISAR",
                 f"quick_check: {estado.get('integrity_check', '—')} · "
                 f"FK: {estado.get('fk_violaciones', '—')}",
                 tema.COLORES["ok"] if estado.get("ok") else tema.COLORES["alerta"])
    with c2:
        tema.kpi("Articulos activos", _fmt(conteos.get("maestro_materiales", 0)),
                 f"{conteos.get('sku_proveedor', 0)} relaciones SKU-proveedor")
    with c3:
        tema.kpi("Profundidad historica", _fmt(conteos.get("historico_demanda", 0)),
                 "registros diarios de demanda e inventario")
    with c4:
        ult = "—" if historial.empty else str(historial.iloc[0]["ts_inicio"])
        tema.kpi("Ultima corrida", ult[:16],
                 "—" if historial.empty else f"estado {historial.iloc[0]['estado']}")

    st.markdown("")
    izq, der = st.columns([3, 2])
    with izq:
        if st.button("▶  Ejecutar pipeline completo de los 5 agentes",
                     type="primary", width="stretch"):
            ejecutar_pipeline(cfg["corte"], cfg["horizonte"], etiqueta="UI")
            st.rerun()
    with der:
        with st.popover("Regenerar dataset sintetico", width="stretch"):
            st.warning(
                "Reconstruye el esquema y regenera los 112 992 registros. "
                "Las corridas anteriores se pierden."
            )
            semilla = st.number_input("Semilla", value=settings.SIMULACION.semilla, step=1)
            if st.button("Confirmar regeneracion", type="secondary"):
                from data.data_generator import GeneradorDataSintetica
                with st.spinner("Simulando 36 meses de operacion…"):
                    GeneradorDataSintetica(db=dd.gestor(), semilla=int(semilla)).generar(forzar=True)
                dd.limpiar_cache()
                st.success("Dataset regenerado.")
                st.rerun()

    st.divider()

    # --- Matriz de Kraljic ---------------------------------------------------
    st.markdown("#### Segmentacion estrategica de abastecimiento")
    tema.nota(
        "Adaptacion de la matriz de <b>Kraljic (1983)</b>. Los ejes son scores "
        "persistidos y recalculables, no etiquetas escritas a mano: el impacto "
        "economico es el percentil del consumo valorizado y el riesgo de suministro "
        "combina plazo, variabilidad del plazo, numero de fuentes homologadas, "
        "condicion de importado y criticidad operativa. El corte de cuadrante es 0,50."
    )

    maestro = dd.maestro_segmentado()
    if maestro.empty:
        st.info("No hay maestro cargado.")
        return

    g1, g2 = st.columns([3, 2])
    with g1:
        fig = go.Figure()
        for seg, grupo in maestro.groupby("segmento_kraljic"):
            fig.add_trace(go.Scatter(
                x=grupo["score_riesgo_suministro"], y=grupo["score_impacto_economico"],
                mode="markers", name=seg.replace("_", " ").title(),
                marker=dict(
                    size=np.clip(np.sqrt(grupo["consumo_valorizado"].to_numpy()) / 55, 8, 34),
                    color=tema.COLOR_KRALJIC.get(seg, "#64748B"),
                    line=dict(width=1, color="rgba(255,255,255,0.35)"), opacity=0.82,
                ),
                customdata=np.stack([
                    grupo["sku"], grupo["descripcion"], grupo["clase_abc"],
                    grupo["clase_xyz"], grupo["consumo_valorizado"],
                ], axis=-1),
                hovertemplate=("<b>%{customdata[0]}</b><br>%{customdata[1]}<br>"
                               "Clase %{customdata[2]}%{customdata[3]}<br>"
                               "Riesgo %{x:.2f} · Impacto %{y:.2f}<br>"
                               "Consumo S/ %{customdata[4]:,.0f}<extra></extra>"),
            ))
        fig.add_hline(y=0.5, line=dict(color=tema.COLORES["borde"], dash="dash"))
        fig.add_vline(x=0.5, line=dict(color=tema.COLORES["borde"], dash="dash"))
        for x, y, txt in ((0.05, 0.95, "APALANCADOS"), (0.72, 0.95, "ESTRATEGICOS"),
                          (0.05, 0.04, "RUTINARIOS"), (0.66, 0.04, "CUELLO DE BOTELLA")):
            fig.add_annotation(x=x, y=y, text=txt, showarrow=False, xanchor="left",
                               font=dict(size=10, color=tema.COLORES["texto_tenue"]))
        fig.update_xaxes(title="Riesgo de suministro", range=[-0.03, 1.03])
        fig.update_yaxes(title="Impacto economico", range=[-0.03, 1.03])
        st.plotly_chart(tema.plantilla_grafico(fig, 430), width="stretch")

    with g2:
        resumen = (maestro.groupby("segmento_kraljic")
                   .agg(articulos=("sku", "count"),
                        consumo=("consumo_valorizado", "sum"))
                   .reset_index().sort_values("consumo", ascending=True))
        fig2 = go.Figure(go.Bar(
            x=resumen["consumo"], y=resumen["segmento_kraljic"].str.replace("_", " ").str.title(),
            orientation="h",
            marker_color=[tema.COLOR_KRALJIC.get(s, "#64748B") for s in resumen["segmento_kraljic"]],
            text=[f"{n} art. · {_PEN}{v:,.0f}" for n, v in
                  zip(resumen["articulos"], resumen["consumo"])],
            textposition="auto", textfont=dict(size=10),
            hovertemplate="%{y}<br>Consumo S/ %{x:,.0f}<extra></extra>",
        ))
        fig2.update_xaxes(title="Consumo valorizado (PEN)")
        st.plotly_chart(tema.plantilla_grafico(fig2, 200, "Concentracion por cuadrante"),
                        width="stretch")

        estrategia = {
            "APALANCADO": "Negociar volumen y costo total de propiedad.",
            "ESTRATEGICO": "Acuerdo de suministro y fuente alternativa homologada.",
            "RUTINARIO": "Catalogo y reposicion simplificada.",
            "CUELLO_DE_BOTELLA": "Reserva tecnica y sustituto homologado.",
        }
        for seg in resumen.sort_values("consumo", ascending=False)["segmento_kraljic"]:
            st.markdown(
                tema.pildora(seg.replace("_", " "), tema.COLOR_KRALJIC.get(seg, "#64748B"))
                + f"&nbsp;<span style='font-size:.78rem;color:{tema.COLORES['texto_tenue']}'>"
                  f"{estrategia.get(seg, '')}</span>",
                unsafe_allow_html=True,
            )

    st.divider()

    # --- E-procurement: expediente de abastecimiento -------------------------
    st.markdown("#### E-Procurement · parametria homologada por articulo")
    param = dd.parametria_abastecimiento()
    if param.empty:
        st.info("Sin parametria de abastecimiento.")
        return

    tabla = maestro.merge(param, on="sku", how="left")
    f1, f2, f3 = st.columns(3)
    with f1:
        sectores = st.multiselect("Sector", sorted(tabla["sector"].dropna().unique()))
    with f2:
        segmentos = st.multiselect("Segmento Kraljic",
                                   sorted(tabla["segmento_kraljic"].dropna().unique()))
    with f3:
        clases = st.multiselect("Clase ABC", sorted(tabla["clase_abc"].dropna().unique()))

    if sectores:
        tabla = tabla[tabla["sector"].isin(sectores)]
    if segmentos:
        tabla = tabla[tabla["segmento_kraljic"].isin(segmentos)]
    if clases:
        tabla = tabla[tabla["clase_abc"].isin(clases)]

    vista = tabla[[
        "sku", "descripcion", "sector", "segmento_kraljic", "clase_abc", "clase_xyz",
        "razon_social", "precio_unitario", "moq", "lote_multiplo",
        "lead_time_medio_dias", "lead_time_sigma_dias", "politica_rotacion",
        "tipo_almacenamiento", "compatible_gtp", "consumo_valorizado",
    ]].sort_values("consumo_valorizado", ascending=False)

    st.dataframe(
        vista, width="stretch", height=340, hide_index=True,
        column_config={
            "sku": st.column_config.TextColumn("SKU", width="small"),
            "descripcion": st.column_config.TextColumn("Descripcion", width="medium"),
            "segmento_kraljic": st.column_config.TextColumn("Kraljic"),
            "razon_social": st.column_config.TextColumn("Proveedor prioritario"),
            "precio_unitario": st.column_config.NumberColumn("Precio", format="S/ %.2f"),
            "moq": st.column_config.NumberColumn("MOQ", format="%.0f"),
            "lote_multiplo": st.column_config.NumberColumn("Empaque", format="%.0f"),
            "lead_time_medio_dias": st.column_config.NumberColumn("Plazo (d)", format="%.1f"),
            "lead_time_sigma_dias": st.column_config.NumberColumn("σ plazo (d)", format="%.1f"),
            "politica_rotacion": st.column_config.TextColumn("Rotacion"),
            "tipo_almacenamiento": st.column_config.TextColumn("Ubicacion WMS"),
            "compatible_gtp": st.column_config.CheckboxColumn("GTP"),
            "consumo_valorizado": st.column_config.NumberColumn("Consumo", format="S/ %.0f"),
        },
    )
    st.download_button(
        "Descargar parametria (CSV)", vista.to_csv(index=False).encode("utf-8-sig"),
        file_name="parametria_abastecimiento.csv", mime="text/csv",
    )


# =============================================================================
# CONSOLA 2 · INTELIGENCIA LOGISTICA
# =============================================================================
def consola_inteligencia(corrida: str | None) -> None:
    """Indicadores descriptivos y atribucion diagnostica de causa raiz."""
    if not corrida:
        st.info("Seleccione o ejecute una corrida para ver los indicadores.")
        return

    fill = dd.metrica(corrida, "fill_rate_global")
    otif = dd.metrica(corrida, "otif_global")
    consumo = dd.metrica(corrida, "consumo_valorizado_pen")
    inv_medio = dd.metrica(corrida, "inventario_medio_pen")
    cobertura = dd.metrica(corrida, "dias_cobertura_media")
    gasto = dd.metrica(corrida, "gasto_compras_pen")
    periodos = dd.metrica(corrida, "periodos_analizados", 36.0)

    # Rotacion = consumo valorizado anualizado / inventario medio valorizado
    anios = max(periodos / 12.0, 1e-9)
    rotacion = (consumo / anios) / max(inv_medio, 1e-9)

    k = st.columns(6)
    with k[0]:
        tema.kpi("Fill rate", _pct(fill), "unidades atendidas / demandadas",
                 tema.COLORES["ok"] if fill >= 0.95 else tema.COLORES["aviso"])
    with k[1]:
        tema.kpi("OTIF proveedor", _pct(otif), "completas y a tiempo / evaluadas",
                 tema.COLORES["ok"] if otif >= 0.85 else tema.COLORES["alerta"])
    with k[2]:
        tema.kpi("Rotacion", f"{rotacion:,.2f}x", "consumo anualizado / inventario medio")
    with k[3]:
        tema.kpi("Cobertura", f"{cobertura:,.1f} d", "dias de inventario disponible")
    with k[4]:
        tema.kpi("Inventario medio", _fmt(inv_medio, 0, _PEN), "capital inmovilizado")
    with k[5]:
        tema.kpi("Gasto de compras", _fmt(gasto, 0, _PEN), f"acumulado {periodos:.0f} meses")

    st.markdown("")
    c1, c2 = st.columns([3, 2])

    # --- Demanda atendida frente a demanda perdida ---------------------------
    with c1:
        mensual = dd.demanda_mensual(corrida)
        if not mensual.empty:
            agg = mensual.groupby("periodo")[["unidades_atendidas", "unidades_perdidas"]].sum()
            fig = go.Figure()
            fig.add_trace(go.Bar(x=agg.index, y=agg["unidades_atendidas"],
                                 name="Atendida", marker_color=tema.COLORES["acento"]))
            fig.add_trace(go.Bar(x=agg.index, y=agg["unidades_perdidas"],
                                 name="Perdida estimada", marker_color=tema.COLORES["alerta"]))
            fig.update_layout(barmode="stack")
            fig.update_yaxes(title="Unidades")
            st.plotly_chart(
                tema.plantilla_grafico(fig, 320, "Demanda mensual conciliada"),
                width="stretch")
            tema.nota(
                "La barra roja es <b>estimacion, no observacion</b>: la demanda perdida "
                "se infiere por prorrateo de disponibilidad y se almacena en columna "
                "propia con su metodo declarado. La venta observada nunca se altera."
            )

    # --- Descomposicion del retraso -----------------------------------------
    with c2:
        interno = dd.metrica(corrida, "dias_retraso_imputables_finanzas")
        externo = dd.metrica(corrida, "dias_retraso_imputables_proveedor")
        part = dd.metrica(corrida, "participacion_retraso_interno")
        retenido = dd.metrica(corrida, "valor_retenido_por_aprobacion_pen")

        fig = go.Figure(go.Bar(
            x=[interno, externo], y=["Aprobacion interna", "Proveedor"], orientation="h",
            marker_color=[tema.COLORES["aviso"], tema.COLORES["violeta"]],
            text=[f"{interno:,.0f} d", f"{externo:,.0f} d"], textposition="auto",
            hovertemplate="%{y}: %{x:,.0f} dias<extra></extra>",
        ))
        fig.update_xaxes(title="Dias de retraso acumulados")
        st.plotly_chart(
            tema.plantilla_grafico(fig, 200, "Causa raiz del retraso de abastecimiento"),
            width="stretch")
        tema.kpi("Retraso imputable a control interno", _pct(part),
                 f"valor comprometido retenido: {_PEN}{retenido:,.0f}",
                 tema.COLORES["alerta"] if part > 0.30 else tema.COLORES["aviso"])

    st.divider()
    d1, d2 = st.columns(2)
    with d1:
        st.markdown("##### Atribucion detallada de retrasos")
        cr = dd.causa_raiz()
        if not cr.empty:
            st.dataframe(
                cr, width="stretch", hide_index=True, height=250,
                column_config={
                    "causa_raiz_retraso": st.column_config.TextColumn("Causa raiz"),
                    "n_ordenes": st.column_config.NumberColumn("OC", format="%d"),
                    "retraso_medio": st.column_config.NumberColumn("Retraso medio", format="%.1f d"),
                    "dias_retraso_acumulados": st.column_config.NumberColumn("Dias acum.", format="%.0f"),
                    "valor_comprometido": st.column_config.NumberColumn("Valor", format="S/ %.0f"),
                },
            )
    with d2:
        st.markdown("##### Desempeno de entrega por proveedor")
        op = dd.otif_proveedor()
        if not op.empty:
            fig = go.Figure()
            fig.add_trace(go.Bar(
                x=op["otif"], y=op["razon_social"], orientation="h",
                marker_color=[tema.COLORES["ok"] if v >= 0.85 else
                              tema.COLORES["aviso"] if v >= 0.7 else tema.COLORES["alerta"]
                              for v in op["otif"]],
                text=[f"{v:.0%}" for v in op["otif"]], textposition="auto",
                hovertemplate="%{y}<br>OTIF %{x:.1%}<extra></extra>",
            ))
            fig.update_xaxes(title="OTIF", tickformat=".0%", range=[0, 1])
            st.plotly_chart(tema.plantilla_grafico(fig, 250), width="stretch")

    # --- Hipotesis y excepciones --------------------------------------------
    st.divider()
    h1, h2 = st.columns(2)
    with h1:
        st.markdown("##### Hallazgos del agente diagnostico")
        tema.nota(
            "El sistema distingue <b>OBSERVACION</b> (hecho medido y reproducible), "
            "<b>HIPOTESIS</b> (explicacion plausible que exige validacion) y "
            "<b>SUPUESTO</b> (valor adoptado por decision). Ninguna hipotesis modifica "
            "el plan hasta que un responsable la acepta."
        )
        hip = dd.hipotesis(corrida)
        if hip.empty:
            st.caption("Sin hallazgos registrados.")
        for _, r in hip.head(8).iterrows():
            color = {"OBSERVACION": tema.COLORES["acento"],
                     "HIPOTESIS": tema.COLORES["aviso"],
                     "SUPUESTO": tema.COLORES["violeta"]}.get(r["naturaleza"], "#64748B")
            tema.excepcion(str(r["naturaleza"]), str(r["ambito"]), str(r["hallazgo"]),
                           str(r["accion_sugerida"] or ""), str(r["responsable"] or ""),
                           str(r["sku"]) if pd.notna(r["sku"]) else None)
    with h2:
        st.markdown("##### Excepciones abiertas del plan")
        exc = dd.excepciones(corrida)
        if exc.empty:
            st.success("Sin excepciones abiertas en esta corrida.")
        for _, r in exc.head(10).iterrows():
            tema.excepcion(str(r["severidad"]), str(r["codigo"]), str(r["descripcion"]),
                           str(r["accion_sugerida"] or ""), str(r["responsable"] or ""),
                           str(r["sku"]) if pd.notna(r["sku"]) else None)


# =============================================================================
# CONSOLA 3 · GEMELO DIGITAL
# =============================================================================
def consola_gemelo(cfg: dict) -> None:
    """Panel de simulacion: reconfigura la politica y reejecuta el calculo."""
    st.markdown("#### Panel de simulacion de politica")
    tema.nota(
        "Estos controles <b>gobiernan el calculo</b>, no el filtrado. El nivel de "
        "servicio fija el cuantil z, la variabilidad del plazo entra en la formula de "
        "King para sigma_DDLT, y ambos cambian el stock de seguridad, la necesidad "
        "neta y la canasta completa. Ejecutar abre una corrida nueva y trazable."
    )

    with st.form("form_gemelo"):
        c1, c2, c3, c4 = st.columns(4)
        with c1:
            nivel = st.slider("Nivel de servicio de ciclo", 0.80, 0.995, 0.95, 0.005,
                              format="%.3f",
                              help="Probabilidad de no quebrar durante un ciclo de "
                                   "reposicion. NO es el fill rate.")
        with c2:
            var_lt = st.slider("Variabilidad del lead time", 0.5, 3.0, 1.0, 0.1,
                               format="%.1fx",
                               help="Multiplica sigma del plazo. Entra al cuadrado en "
                                    "la varianza de la demanda durante el plazo.")
        with c3:
            presup = st.slider("Holgura de presupuesto", 0.5, 1.5, 1.0, 0.05,
                               format="%.2fx",
                               help="Multiplica el tope de caja por periodo. Por debajo "
                                    "de 1 el sistema raciona y declara el faltante.")
        with c4:
            iteraciones = st.select_slider("Iteraciones Monte Carlo",
                                           [200, 400, 600, 1000, 2000], value=600)
        lanzar = st.form_submit_button("▶  Ejecutar gemelo digital", type="primary",
                                       width="stretch")

    if lanzar:
        ejecutar_pipeline(
            cfg["corte"], cfg["horizonte"],
            parametros={
                "nivel_servicio": float(nivel),
                "factor_variabilidad_lt": float(var_lt),
                "factor_presupuesto": float(presup),
                "n_iteraciones": int(iteraciones),
            },
            etiqueta="SIM",
        )
        st.rerun()

    corrida = cfg["corrida"]
    if not corrida:
        st.info("Ejecute el gemelo digital o seleccione una corrida en la barra lateral.")
        return

    pron = dd.pronostico(corrida)
    if pron.empty:
        st.warning("Esta corrida no llego a producir pronostico. Revise las excepciones.")
        return

    st.divider()
    _panel_pronostico(corrida, pron)
    st.divider()
    _panel_canasta(corrida)
    st.divider()
    _panel_montecarlo(corrida)


def _panel_pronostico(corrida: str, pron: pd.DataFrame) -> None:
    """Grafico de pronostico del SKU elegido frente al referente estacional."""
    st.markdown("#### Pronostico validado frente al referente")

    val = dd.validacion(corrida)
    sel = val[val["seleccionado"] == 1].set_index("sku") if not val.empty else pd.DataFrame()

    c1, c2 = st.columns([1, 3])
    with c1:
        skus = sorted(pron["sku"].unique())
        sku = st.selectbox("Articulo", skus, key="sku_pron")
        modelo = str(pron[pron["sku"] == sku]["modelo"].iloc[0])
        calibrado = int(pron[pron["sku"] == sku]["intervalo_calibrado"].max())
        st.markdown(
            tema.pildora(modelo, tema.COLORES["acento"]) + "&nbsp;" +
            tema.pildora("intervalo calibrado" if calibrado else "intervalo sin calibrar",
                         tema.COLORES["ok"] if calibrado else tema.COLORES["aviso"]),
            unsafe_allow_html=True,
        )

    hist = dd.historico_sku(sku)
    fila = sel.loc[sku] if (not sel.empty and sku in sel.index) else None
    sub = pron[pron["sku"] == sku].sort_values("horizonte")

    # Referente ingenuo estacional: repetir los ultimos 12 meses observados.
    referente = (hist["corregida"].to_numpy()[-12:]
                 if len(hist) >= 12 else np.array([]))
    if referente.size and len(sub) > referente.size:
        referente = np.resize(referente, len(sub))

    with c2:
        if fila is not None:
            wape = float(fila.get("wape") or np.nan)
            media_mes = float(hist["corregida"].tail(12).mean()) if len(hist) else 0.0
            # MAD = WAPE x demanda media, por definicion de WAPE = MAD / media.
            mad = wape * media_mes if np.isfinite(wape) else np.nan
            m = st.columns(4)
            with m[0]:
                tema.kpi("WAPE fuera de muestra", _pct(wape) if np.isfinite(wape) else "—",
                         "reserva final, no usada para seleccionar")
            with m[1]:
                tema.kpi("MAD", _fmt(mad, 0) if np.isfinite(mad) else "—",
                         "= WAPE × demanda media mensual")
            with m[2]:
                sesgo = float(fila.get("sesgo") or np.nan)
                tema.kpi("Sesgo", _pct(sesgo) if np.isfinite(sesgo) else "—",
                         "positivo = sobrepronostico",
                         tema.COLORES["ok"] if abs(sesgo) <= 0.05 else tema.COLORES["aviso"])
            with m[3]:
                cob = float(fila.get("cobertura") or np.nan)
                tema.kpi("Cobertura del intervalo",
                         _pct(cob) if np.isfinite(cob) else "—",
                         f"nominal {settings.PRONOSTICO.cobertura_nominal:.0%}")

    fig = go.Figure()
    if not hist.empty:
        fig.add_trace(go.Scatter(
            x=hist["periodo"], y=hist["corregida"], name="Historico corregido",
            mode="lines", line=dict(color=tema.COLORES["texto_tenue"], width=1.6),
        ))
        fig.add_trace(go.Scatter(
            x=hist["periodo"], y=hist["atendida"], name="Venta observada",
            mode="lines", line=dict(color=tema.COLORES["borde"], width=1, dash="dot"),
        ))
    fig.add_trace(go.Scatter(
        x=sub["periodo"], y=sub["p90"], name="P90", mode="lines",
        line=dict(width=0), showlegend=False, hoverinfo="skip"))
    fig.add_trace(go.Scatter(
        x=sub["periodo"], y=sub["p10"], name="Intervalo 80%", mode="lines",
        line=dict(width=0), fill="tonexty",
        fillcolor="rgba(56,189,248,0.18)", hoverinfo="skip"))
    fig.add_trace(go.Scatter(
        x=sub["periodo"], y=sub["p50"], name=f"Pronostico ({sub['modelo'].iloc[0]})",
        mode="lines+markers", line=dict(color=tema.COLORES["acento"], width=2.4),
        marker=dict(size=5)))
    if referente.size == len(sub):
        fig.add_trace(go.Scatter(
            x=sub["periodo"], y=referente, name="Referente ingenuo estacional",
            mode="lines", line=dict(color=tema.COLORES["aviso"], width=1.6, dash="dash")))
    fig.update_yaxes(title="Unidades por mes")
    st.plotly_chart(tema.plantilla_grafico(fig, 380, f"{sku} · horizonte de 12 meses"),
                    width="stretch")

    if fila is not None and pd.notna(fila.get("motivo_decision")):
        st.caption(f"Decision de modelo: {fila['motivo_decision']}")


def _panel_canasta(corrida: str) -> None:
    """Tabla interactiva de la canasta de compras a 12 meses."""
    st.markdown("#### Canasta de compras a 12 meses")

    escenarios = [e.nombre for e in settings.ESCENARIOS]
    c1, c2 = st.columns([1, 3])
    with c1:
        escenario = st.radio("Escenario", escenarios, horizontal=False, key="esc_canasta")
    cst = dd.canasta(corrida, escenario)
    if cst.empty:
        st.info("Sin canasta para este escenario.")
        return

    costo = float(cst["costo_compra"].sum())
    lineas = int((cst["compra_propuesta"] > 0).sum())
    faltante = float(cst["faltante"].sum())
    vencidas = int(cst["emision_vencida"].sum())
    recortes = int(cst["ajuste_presupuesto"].sum())

    with c2:
        m = st.columns(5)
        with m[0]:
            tema.kpi("Compromiso total", _fmt(costo, 0, _PEN), f"{lineas} lineas con compra")
        with m[1]:
            tema.kpi("Faltante proyectado", _fmt(faltante, 0),
                     "unidades sin cobertura",
                     tema.COLORES["ok"] if faltante == 0 else tema.COLORES["alerta"])
        with m[2]:
            tema.kpi("Emisiones vencidas", str(vencidas),
                     "fecha limite ya superada al corte",
                     tema.COLORES["ok"] if vencidas == 0 else tema.COLORES["aviso"])
        with m[3]:
            tema.kpi("Recortes por caja", str(recortes), "lineas diferidas por presupuesto",
                     tema.COLORES["ok"] if recortes == 0 else tema.COLORES["aviso"])
        with m[4]:
            volumen = float(cst["volumen_m3"].sum())
            tema.kpi("Volumen a recibir", f"{volumen:,.0f} m³", "capacidad de almacen requerida")

    tema.nota(
        "El lote se resuelve con <b>Wagner-Whitin (1958)</b>, optimo exacto para el "
        "problema multiperiodo, y despues se redondea a empaque y MOQ; ese redondeo "
        "rompe la optimalidad, de modo que la canasta se presenta como "
        "<b>factible y trazable</b>, no como optimo economico. El racionamiento por "
        "caja es una heuristica de priorizacion declarada."
    )

    f1, f2, f3 = st.columns(3)
    with f1:
        periodos = st.multiselect("Periodo", sorted(cst["periodo"].unique()))
    with f2:
        riesgos = st.multiselect("Nivel de riesgo", ["CRITICO", "ALTO", "MEDIO", "BAJO"])
    with f3:
        solo_compra = st.checkbox("Solo lineas con compra", value=True)

    vista = cst.copy()
    if periodos:
        vista = vista[vista["periodo"].isin(periodos)]
    if riesgos:
        vista = vista[vista["nivel_riesgo"].isin(riesgos)]
    if solo_compra:
        vista = vista[vista["compra_propuesta"] > 0]

    st.dataframe(
        vista, width="stretch", height=420, hide_index=True,
        column_config={
            "sku": st.column_config.TextColumn("SKU", width="small"),
            "proveedor_id": st.column_config.TextColumn("Proveedor", width="small"),
            "periodo": st.column_config.TextColumn("Periodo", width="small"),
            "demanda_plan": st.column_config.NumberColumn("Demanda", format="%.0f"),
            "inventario_inicial": st.column_config.NumberColumn("Inv. inicial", format="%.0f"),
            "recepcion_confirmada": st.column_config.NumberColumn("Recep. confirm.", format="%.0f"),
            "stock_seguridad": st.column_config.NumberColumn("Reserva", format="%.0f"),
            "necesidad_neta": st.column_config.NumberColumn("Necesidad neta", format="%.0f"),
            "compra_propuesta": st.column_config.NumberColumn("Compra", format="%.0f"),
            "inventario_final": st.column_config.NumberColumn("Inv. final", format="%.0f"),
            "faltante": st.column_config.NumberColumn("Faltante", format="%.0f"),
            "fecha_emision": st.column_config.TextColumn("Emitir el"),
            "fecha_recepcion": st.column_config.TextColumn("Recibir el"),
            "emision_vencida": st.column_config.CheckboxColumn("Vencida"),
            "precio_unitario": st.column_config.NumberColumn("Precio", format="S/ %.2f"),
            "costo_compra": st.column_config.NumberColumn("Costo", format="S/ %.0f"),
            "volumen_m3": st.column_config.NumberColumn("m³", format="%.2f"),
            "metodo_lote": st.column_config.TextColumn("Metodo"),
            "ajuste_presupuesto": st.column_config.CheckboxColumn("Recortada"),
            "nivel_riesgo": st.column_config.TextColumn("Riesgo"),
            "estado": st.column_config.TextColumn("Estado"),
        },
    )

    d1, d2 = st.columns(2)
    with d1:
        st.download_button(
            f"Descargar canasta {escenario} (CSV)",
            cst.to_csv(index=False).encode("utf-8-sig"),
            file_name=f"canasta_{escenario.lower()}_{corrida}.csv", mime="text/csv",
            width="stretch",
        )
    with d2:
        resumen = (cst.groupby("periodo")
                   .agg(costo=("costo_compra", "sum"),
                        lineas=("compra_propuesta", lambda s: int((s > 0).sum())),
                        faltante=("faltante", "sum")).reset_index())
        st.download_button(
            "Descargar resumen mensual (CSV)",
            resumen.to_csv(index=False).encode("utf-8-sig"),
            file_name=f"resumen_mensual_{escenario.lower()}.csv", mime="text/csv",
            width="stretch",
        )

    fig = go.Figure()
    fig.add_trace(go.Bar(x=resumen["periodo"], y=resumen["costo"], name="Compromiso",
                         marker_color=tema.COLORES["acento"]))
    fig.update_yaxes(title="PEN")
    st.plotly_chart(tema.plantilla_grafico(fig, 260, "Compromiso de caja por periodo"),
                    width="stretch")


def _panel_montecarlo(corrida: str) -> None:
    """Resultados de la simulacion estocastica por escenario."""
    st.markdown("#### Simulacion estocastica multiescenario")
    sim = dd.simulacion(corrida)
    if sim.empty:
        st.info("Sin resultados de simulacion para esta corrida.")
        return

    n_iter = int(sim["n_iteraciones"].max())
    tema.nota(
        f"<b>{n_iter}</b> iteraciones por escenario. La demanda se simula con un factor "
        f"comun (w = {settings.MONTECARLO.peso_factor_comun}) mas ruido propio, de modo "
        "que los articulos quedan correlacionados: con shocks independientes la "
        "agregacion cancela las colas y el P90 del total saldria artificialmente bajo. "
        "El plazo se muestrea de la log-normal desplazada calibrada en la Fase 1."
    )

    fr = sim[sim["metrica"] == "fill_rate"].set_index("escenario")
    orden = [e.nombre for e in settings.ESCENARIOS if e.nombre in fr.index]

    c1, c2 = st.columns([2, 3])
    with c1:
        fig = go.Figure()
        for esc in orden:
            r = fr.loc[esc]
            color = {"BASE": tema.COLORES["ok"], "DEMANDA_ALTA": tema.COLORES["aviso"],
                     "DISRUPCION": tema.COLORES["alerta"]}.get(esc, tema.COLORES["acento"])
            fig.add_trace(go.Scatter(
                x=[r["p05"], r["p95"]], y=[esc, esc], mode="lines",
                line=dict(color=color, width=10), opacity=0.35, showlegend=False,
                hovertemplate=f"{esc}<br>P05 %{{x:.1%}}<extra></extra>"))
            fig.add_trace(go.Scatter(
                x=[r["p50"]], y=[esc], mode="markers", name=esc,
                marker=dict(color=color, size=15, symbol="diamond"),
                hovertemplate=f"{esc}<br>P50 %{{x:.1%}}<extra></extra>"))
        fig.update_xaxes(title="Fill rate simulado", tickformat=".0%")
        st.plotly_chart(
            tema.plantilla_grafico(fig, 260, "Fill rate: mediana e intervalo P05-P95"),
            width="stretch")

    with c2:
        vista = sim.pivot_table(index="metrica", columns="escenario",
                                values="p50", aggfunc="first").reset_index()
        st.dataframe(
            vista, width="stretch", hide_index=True, height=260,
            column_config={"metrica": st.column_config.TextColumn("Metrica (mediana P50)")},
        )

    st.dataframe(
        sim[["escenario", "metrica", "unidad", "media", "p05", "p50", "p95"]],
        width="stretch", hide_index=True, height=260,
        column_config={
            "escenario": st.column_config.TextColumn("Escenario"),
            "metrica": st.column_config.TextColumn("Metrica"),
            "unidad": st.column_config.TextColumn("Unidad", width="small"),
            "media": st.column_config.NumberColumn("Media", format="%.3f"),
            "p05": st.column_config.NumberColumn("P05", format="%.3f"),
            "p50": st.column_config.NumberColumn("P50", format="%.3f"),
            "p95": st.column_config.NumberColumn("P95", format="%.3f"),
        },
    )


# =============================================================================
# PROGRAMA PRINCIPAL
# =============================================================================
def main() -> None:
    """Punto de entrada de la aplicacion Streamlit."""
    cfg = barra_lateral()
    corrida = cfg["corrida"] or dd.ultima_corrida_completa()
    cfg["corrida"] = corrida

    tema.cabecera(
        "Torre de Control · Abastecimiento Predictivo",
        f"Corte {cfg['corte']} · horizonte {cfg['horizonte']} meses · "
        f"corrida {corrida or 'sin ejecutar'}",
        f"{settings.APP_NOMBRE} v{settings.APP_VERSION}<br>"
        f"Super Agente IA · 5 especialistas<br>Base local SQLite · sin salida a red",
    )

    t0, t1, t2, t3 = st.tabs([
        "  0 · Carga de Datos  ",
        "  1 · Orquestacion y E-Procurement  ",
        "  2 · Inteligencia Logistica  ",
        "  3 · Gemelo Digital  ",
    ])
    # La carga va primero porque es lo primero del ciclo: sin datos conciliados
    # no hay nada que orquestar. Las tres consolas analiticas conservan su
    # numeracion original.
    with t0:
        consola_carga()
    with t1:
        consola_orquestacion(cfg)
    with t2:
        consola_inteligencia(corrida)
    with t3:
        consola_gemelo(cfg)


main()
