# -*- coding: utf-8 -*-
"""
ui.py - Componentes visuales compartidos, estilos, contexto de sesión y caché.
"""
from __future__ import annotations

import html

import pandas as pd
import streamlit as st

import config
import db

C = config.COLOR

CSS = f"""
<style>
:root {{ --marca:{C['marca']}; --accion:{C['accion']}; --txt2:{C['texto2']}; --borde:{C['borde']}; }}
.block-container {{ padding-top: 3.2rem; padding-bottom: 2rem; max-width: 1400px; }}
[data-testid="stSidebar"] {{ background: linear-gradient(180deg, {C['marca']} 0%, #16304F 100%); }}
[data-testid="stSidebarNav"] *, [data-testid="stSidebar"] [data-testid="stWidgetLabel"] *,
[data-testid="stSidebar"] [data-testid="stCaptionContainer"] *, [data-testid="stSidebar"] .stMarkdown *,
[data-testid="stSidebarNavSeparator"] *, [data-testid="stSidebar"] [data-testid="stNavSectionHeader"] *
  {{ color: #EAF1F8 !important; }}
[data-testid="stSidebar"] [data-baseweb="select"] > div {{ background:#FFFFFF; border-radius:8px; }}
[data-testid="stSidebar"] [data-baseweb="select"] * {{ color: #1A1A1A !important; }}
[data-testid="stSidebar"] button {{ background: rgba(255,255,255,.10); color:#FFFFFF !important; border-color: rgba(255,255,255,.35); }}
[data-testid="stSidebar"] button * {{ color:#FFFFFF !important; }}
[data-testid="stSidebar"] [data-testid="stAlert"] * {{ color:#1A1A1A !important; }}
header[data-testid="stHeader"] {{ background: rgba(247,249,252,.85); }}
[data-testid="stSidebarHeader"] img, [data-testid="stHeaderLogo"] {{ height: 2.6rem !important; max-height: 2.6rem !important; }}
[data-testid="stSidebar"] [data-testid="stSidebarNavSeparator"] {{ border-color: rgba(255,255,255,.2); }}
[data-testid="stSidebarNavLink"][aria-current="page"] {{ background: rgba(255,255,255,.14); border-radius: 8px; }}
h1, h2, h3 {{ color: {C['marca']}; }}
.gce-hero {{ display:flex; justify-content:space-between; align-items:flex-end; gap:1rem;
  border-bottom: 1px solid var(--borde); padding-bottom:.6rem; margin-bottom:1rem; }}
.gce-hero h1 {{ font-size: 1.7rem; margin: 0; padding: 0; }}
.gce-hero p {{ color: var(--txt2); margin: .2rem 0 0 0; font-size: .95rem; }}
.gce-chip {{ display:inline-block; padding:.18rem .7rem; border-radius:999px; font-size:.78rem;
  font-weight:600; border:1px solid transparent; white-space:nowrap; }}
.gce-card {{ background:#fff; border:1px solid var(--borde); border-radius:14px; padding:1rem 1.1rem;
  box-shadow: 0 1px 2px rgba(16,40,80,.04); height:100%; }}
.gce-card .lbl {{ color: var(--txt2); font-size:.8rem; text-transform: uppercase; letter-spacing:.04em; }}
.gce-card .val {{ font-size:1.75rem; font-weight:700; line-height:1.25; margin-top:.25rem; }}
.gce-card .sub {{ color: var(--txt2); font-size:.82rem; margin-top:.15rem; }}
.gce-step {{ background:#fff; border:1px solid var(--borde); border-left:4px solid var(--accion);
  border-radius:10px; padding:.7rem .9rem; margin-bottom:.5rem; }}
.gce-brand {{ font-size:1.35rem; font-weight:800; letter-spacing:.02em; margin:.2rem 0 0 0; }}
.gce-brand-sub {{ font-size:.72rem; opacity:.8; margin-bottom:.4rem; }}
[data-testid="stMetricValue"] {{ font-size: clamp(1.1rem, 2.1vw, 1.9rem); }}
div[data-testid="stMetric"] {{ background:#fff; border:1px solid var(--borde); border-radius:12px; padding:.6rem .8rem; }}
.stTabs [data-baseweb="tab-list"] {{ gap: .3rem; }}
.stTabs [data-baseweb="tab"] {{ background:#fff; border:1px solid var(--borde); border-radius:8px 8px 0 0; padding:.4rem .9rem; }}
.stTabs [aria-selected="true"] {{ background:{C['azul_claro']}; }}
</style>
"""

COLOR_ESTADO = {"Borrador": ("#EEF1F5", "#5A6B7F"), "Propuesto": ("#E3F2FD", "#1565C0"),
                "En revisión": ("#FFF8E1", "#8D6E00"), "Aprobado": ("#E8F5E9", "#2E7D32"),
                "Rechazado": ("#FFEBEE", "#C62828")}
ETIQUETA_SEMAFORO = {"VERDE": "Verde", "AMBAR": "Ámbar", "ROJO": "Rojo", "GRIS": "Gris", "N/A": "Sin dato"}


def estilos() -> None:
    st.markdown(CSS, unsafe_allow_html=True)


# ------------------------------------------------------------------ Caché de datos
@st.cache_data(show_spinner=False)
def leer(tabla: str, empresa_id: str | None = None) -> pd.DataFrame:
    return db.leer(tabla, empresa_id)


def refrescar() -> None:
    """Limpia la caché tras cualquier escritura en la base de datos."""
    leer.clear()


# ------------------------------------------------------------------ Sesión y permisos
def usuario() -> dict:
    return st.session_state.get("usuario") or {"usuario": "invitado", "nombre": "Invitado", "rol": "Consulta"}


def puede(accion: str) -> bool:
    """accion: editar | aprobar | administrar."""
    rol = usuario()["rol"]
    reglas = {"editar": {"Administrador", "Analista"},
              "aprobar": {"Administrador", "Aprobador"},
              "administrar": {"Administrador"},
              "seguimiento": {"Administrador", "Analista", "Consulta", "Aprobador"}}
    return rol in reglas.get(accion, set())


def ctx() -> dict:
    s = st.session_state
    return {"empresa_id": s.get("empresa_id"), "anio": s.get("anio"), "escenario": s.get("escenario"),
            "periodo_id": s.get("periodo_id"), "usuario": usuario()["usuario"]}


def barra_lateral() -> None:
    """Marca, selectores globales (empresa, año, escenario, periodo) y usuario."""
    sb = st.sidebar
    emp = leer("empresas")
    sb.markdown("---")
    if emp.empty:
        st.session_state["empresa_id"] = None
        sb.info("Sin empresas. Vaya a Base de Datos para cargar datos.")
    else:
        ids = emp["empresa_id"].tolist()
        nombres = dict(zip(emp["empresa_id"], emp["razon_social"]))
        if st.session_state.get("empresa_id") not in ids:
            st.session_state["empresa_id"] = ids[0]
        sb.selectbox("Empresa", ids, key="empresa_id", format_func=lambda x: nombres.get(x, x))
        esc = leer("escenarios", st.session_state["empresa_id"])
        anios = sorted([a for a in esc["anio"].dropna().unique() if a != str(emp.set_index("empresa_id").loc[st.session_state["empresa_id"], "anio_base"])]) or ["2027"]
        if st.session_state.get("anio") not in anios:
            st.session_state["anio"] = anios[0]
        sb.selectbox("Año del plan", anios, key="anio")
        escs = esc[esc["anio"] == st.session_state["anio"]]["escenario"].dropna().unique().tolist() or config.ESCENARIOS_BASE
        if st.session_state.get("escenario") not in escs:
            st.session_state["escenario"] = "Base" if "Base" in escs else escs[0]
        sb.selectbox("Escenario", escs, key="escenario")
        meses = [f"{st.session_state['anio']}-{m:02d}" for m in range(1, 13)]
        vals = leer("kpi_valores", st.session_state["empresa_id"])
        reales = vals[(vals["tipo_valor"] == "Real") & vals["periodo_id"].isin(meses)]["periodo_id"]
        defecto = reales.max() if not reales.empty else meses[0]
        if st.session_state.get("periodo_id") not in meses:
            st.session_state["periodo_id"] = defecto
        sb.selectbox("Periodo de control", meses, key="periodo_id",
                     help="Mes contra el cual se evalúan semáforos y avances.")
    u = usuario()
    sb.markdown("---")
    sb.caption(f"👤 {u['nombre']} · {u['rol']}")
    if sb.button("Cerrar sesión", width="stretch"):
        for k in ("usuario",):
            st.session_state.pop(k, None)
        st.rerun()
    sb.caption(f"{config.APP_CORTO} v{config.APP_VERSION}")


LOGO_SVG = (
    "<svg xmlns='http://www.w3.org/2000/svg' width='360' height='80' viewBox='0 0 360 80'>"
    "<circle cx='40' cy='40' r='30' fill='none' stroke='#FFFFFF' stroke-width='6'/>"
    "<circle cx='40' cy='40' r='17' fill='none' stroke='#5FD3DB' stroke-width='6'/>"
    "<circle cx='40' cy='40' r='6' fill='#FFFFFF'/>"
    "<text x='86' y='42' font-family='Segoe UI,Arial,sans-serif' font-size='30' font-weight='800' fill='#FFFFFF'>GCE · IA</text>"
    "<text x='87' y='64' font-family='Segoe UI,Arial,sans-serif' font-size='13' fill='#BFD3EA'>Gestión y Control Estratégico</text>"
    "</svg>")


ICONO_SVG = (
    "<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'>"
    "<circle cx='40' cy='40' r='30' fill='none' stroke='#1F3A5F' stroke-width='7'/>"
    "<circle cx='40' cy='40' r='17' fill='none' stroke='#0E7C86' stroke-width='7'/>"
    "<circle cx='40' cy='40' r='6' fill='#1F3A5F'/></svg>")


def _data_uri(svg: str) -> str:
    import base64
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode("utf-8")).decode("ascii")


def marca_lateral() -> None:
    """Logotipo en la parte superior del menú lateral (SVG embebido, sin archivos externos)."""
    try:
        # Logo completo con el menú abierto; ícono de color con el menú contraído (visible sobre fondo claro)
        st.logo(_data_uri(LOGO_SVG), size="large", icon_image=_data_uri(ICONO_SVG))
    except Exception:  # versiones sin st.logo: se muestra como texto
        st.sidebar.markdown(f"<div class='gce-brand'>🎯 {config.APP_CORTO}</div>", unsafe_allow_html=True)


# ------------------------------------------------------------------ Componentes
def chip(texto: str, fondo: str, color: str) -> str:
    return (f"<span class='gce-chip' style='background:{fondo};color:{color};border-color:{color}33'>"
            f"{html.escape(str(texto))}</span>")


def chip_estado(estado: str) -> str:
    f, c = COLOR_ESTADO.get(estado, ("#EEF1F5", "#5A6B7F"))
    return chip(estado, f, c)


def chip_semaforo(sem: str) -> str:
    col = config.COLOR_SEMAFORO.get(sem, C["gris"])
    return chip(f"● {ETIQUETA_SEMAFORO.get(sem, sem)}", col + "1A", col)


def encabezado(titulo: str, subtitulo: str = "", entidad: str | None = None) -> None:
    derecha = ""
    if entidad and ctx()["empresa_id"]:
        est = db.estado_flujo(ctx()["empresa_id"], entidad)
        derecha = chip_estado(est["estado"]) + (f" <span style='color:{C['texto2']};font-size:.8rem'>v{est['version']}</span>")
    st.markdown(f"<div class='gce-hero'><div><h1>{html.escape(titulo)}</h1><p>{html.escape(subtitulo)}</p></div>"
                f"<div>{derecha}</div></div>", unsafe_allow_html=True)


def tarjeta(etiqueta: str, valor: str, sub: str = "", color: str | None = None) -> None:
    st.markdown(f"<div class='gce-card'><div class='lbl'>{html.escape(etiqueta)}</div>"
                f"<div class='val' style='color:{color or C['marca']}'>{html.escape(valor)}</div>"
                f"<div class='sub'>{html.escape(sub)}</div></div>", unsafe_allow_html=True)


def paso(numero: int, titulo: str, texto: str, hecho: bool = False) -> None:
    marca = "✅" if hecho else f"{numero}."
    st.markdown(f"<div class='gce-step'><b>{marca} {html.escape(titulo)}</b><br>"
                f"<span style='color:{C['texto2']};font-size:.88rem'>{html.escape(texto)}</span></div>",
                unsafe_allow_html=True)


def en_construccion(titulo: str) -> None:
    encabezado(titulo, "Módulo en desarrollo")
    st.info("Este módulo se incorpora en el siguiente paso de desarrollo (Pasos 4 y 5). "
            "La base de datos, la importación y los cálculos ya están operativos.")


def requiere_empresa() -> str | None:
    e = ctx()["empresa_id"]
    if not e:
        st.warning("No hay empresas registradas. Cargue datos en **Base de Datos** o use los datos de demostración.")
        boton_demo()
    return e


def boton_demo(clave: str = "demo") -> None:
    if not config.DATA_PRUEBA_XLSX.exists():
        st.caption(f"No se encontró {config.DATA_PRUEBA_XLSX.name} en la carpeta del sistema.")
        return
    if st.button("Cargar datos de demostración (10_Data_Prueba.xlsx)", key=clave, type="primary",
                 disabled=not puede("editar")):
        r = db.importar_excel(str(config.DATA_PRUEBA_XLSX), usuario=usuario()["usuario"])
        refrescar()
        if r["ok"]:
            st.session_state["_toast"] = f"Datos cargados: {sum(r['resumen'].values())} registros."
            st.rerun()
        else:
            st.error("\n".join(r["errores"]))


def mostrar_toast() -> None:
    msg = st.session_state.pop("_toast", None)
    if msg:
        st.toast(msg, icon="✅")


def estilo_semaforo(df: pd.DataFrame, col: str = "semaforo"):
    """Colorea una columna de semáforo en un DataFrame (Styler)."""
    def _c(v):
        colr = config.COLOR_SEMAFORO.get(v)
        return f"background-color:{colr}22;color:{colr};font-weight:600" if colr else ""
    return df.style.map(_c, subset=[col])


def nombre_empresa(empresa_id: str | None) -> str:
    emp = leer("empresas")
    fila = emp[emp["empresa_id"] == empresa_id]
    return fila["razon_social"].iloc[0] if not fila.empty else (empresa_id or "—")
