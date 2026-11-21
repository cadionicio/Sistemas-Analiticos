# -*- coding: utf-8 -*-
"""
CANVAS MODEL IA - Aplicación principal (canvas_app.py)
=======================================================
Sistema Informático Dinámico Inteligente para el modelamiento de negocios
con Business Model Canvas (AS IS / TO BE), simulación multiperiodo y
multiescenario, seguimiento de proyectos, dashboard, Gantt, predicción del
mes +1 y reporte PPTX.

Ejecución:  streamlit run ./Entregable/canvas_app.py
Autor del control de calidad: Cesar Alonso Dionicio Achachagua (UNI 20192589B)
"""
from __future__ import annotations

import os
import sys
from datetime import date, datetime

sys.dont_write_bytecode = True  # no crear __pycache__: la carpeta Entregable no lleva subcarpetas
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import plotly.express as px  # noqa: E402
import plotly.graph_objects as go  # noqa: E402
import streamlit as st  # noqa: E402

import db  # noqa: E402
import forecast as fc  # noqa: E402
import ia_engine as ia  # noqa: E402
import reports as rp  # noqa: E402

VERSION_APP = "1.0.0"
st.set_page_config(page_title="CANVAS MODEL IA", page_icon="🧭", layout="wide", initial_sidebar_state="expanded")

# ----------------------------------------------------------------------------
# Estilo
# ----------------------------------------------------------------------------
AZUL, AZUL2, FONDO, TXT = "#0B3C5D", "#1D70B8", "#F5F7FA", "#1F2937"
SEM_COLOR = {"Verde": "#16A34A", "Ámbar": "#F59E0B", "Rojo": "#DC2626", "Gris": "#9CA3AF"}
SEM_ICONO = {"Verde": "🟢 Verde", "Ámbar": "🟡 Ámbar", "Rojo": "🔴 Rojo", "Gris": "⚪ Gris"}
CAMBIO_COLOR = {"Crear": "#16A34A", "Modificar": "#1D70B8", "Eliminar": "#DC2626", "Mantener": "#6B7280", "N/A": "#9CA3AF"}
ESTADO_ICONO = {"Borrador": "📝", "En revisión": "🔎", "Aprobado": "🔒", "Rechazado": "⛔", "Reemplazado": "🗄️"}

CSS = f"""
<style>
.block-container {{padding-top: 2.6rem; padding-bottom: 2rem; max-width: 1400px;}}
[data-testid="stSidebar"] {{background: {AZUL};}}
[data-testid="stSidebar"] [data-testid="stMarkdownContainer"] *,
[data-testid="stSidebar"] [data-testid="stWidgetLabel"] *,
[data-testid="stSidebar"] [data-testid="stCaptionContainer"] *,
[data-testid="stSidebar"] [role="radiogroup"] label * {{color: #E6EEF5 !important;}}
[data-testid="stSidebar"] [data-testid="stSelectbox"] * {{color: {TXT} !important;}}
[data-testid="stSidebar"] button, [data-testid="stSidebar"] button [data-testid="stMarkdownContainer"] * {{color: {AZUL} !important;}}
[data-testid="stSidebar"] [data-testid="stSelectbox"] [data-testid="stWidgetLabel"] * {{color: #E6EEF5 !important;}}
[data-testid="stMetricValue"] {{font-size: 1.45rem;}}
button[kind="primary"], button[data-testid="stBaseButton-primary"] {{background-color: {AZUL2}; border-color: {AZUL2};}}
[data-testid="stMetricValue"] > div {{overflow: visible; text-overflow: clip; white-space: normal;}}
.cm-hero {{background: linear-gradient(90deg, {AZUL} 0%, {AZUL2} 100%); color: white; padding: 18px 24px;
          border-radius: 12px; margin-bottom: 14px;}}
.cm-hero h1 {{color: white; font-size: 1.7rem; margin: 0; padding: 0;}}
.cm-hero p {{color: #D6E4F0; margin: 4px 0 0 0; font-size: .95rem;}}
.cm-chip {{display:inline-block; padding: 6px 12px; margin: 3px; border-radius: 999px; background: #E8F0F8;
          color: {AZUL}; font-weight: 600; font-size: .85rem;}}
.cm-arrow {{color: #9CA3AF; font-weight: 700;}}
.cm-grid {{display: grid; grid-template-columns: repeat(10, 1fr); gap: 8px;
          grid-template-areas: "rk rk ac ac pv pv rc rc sc sc" "rk rk sk sk pv pv ch ch sc sc" "ec ec ec ec ec fi fi fi fi fi";}}
.cm-block {{background: white; border: 1px solid #D5DEE8; border-radius: 10px; padding: 8px; min-height: 120px;}}
.cm-block h4 {{margin: 0 0 6px 0; font-size: .78rem; letter-spacing: .04em; color: {AZUL}; text-transform: uppercase;}}
.cm-card {{background: {FONDO}; border-left: 4px solid {AZUL2}; border-radius: 6px; padding: 5px 7px; margin-bottom: 6px;
          font-size: .80rem; color: {TXT}; line-height: 1.25;}}
.cm-meta {{font-size: .68rem; color: #6B7280; margin-top: 2px;}}
.cm-badge {{display:inline-block; padding: 1px 6px; border-radius: 6px; color: white; font-size: .64rem; font-weight: 700; margin-right: 4px;}}
.cm-empty {{color: #9CA3AF; font-size: .75rem; font-style: italic;}}
.cm-step {{border-left: 3px solid {AZUL2}; padding: 4px 10px; margin: 4px 0; background: {FONDO}; border-radius: 4px;}}
</style>
"""

PERMISOS = {
    "editar": {"Administrador", "Gerente", "PMO", "Analista"},
    "pmo": {"Administrador", "Gerente", "PMO"},
    "aprobar": {"Administrador", "Gerente"},
    "admin": {"Administrador"},
}

MENU = ["0. Inicio", "1. Base de datos", "2. Canvas AS IS", "3. Canvas TO BE y escenarios",
        "4. Brechas y proyectos", "5. Diagrama de Gantt", "6. Seguimiento y control", "7. Dashboard",
        "8. Predicción y simulación", "9. Reportes", "10. Trazabilidad y auditoría", "11. Configuración"]


# ----------------------------------------------------------------------------
# Utilidades de interfaz
# ----------------------------------------------------------------------------
def usuario() -> str:
    return st.session_state["user"]["usuario"]


def rol() -> str:
    return st.session_state["user"]["rol"]


def puede(accion: str) -> bool:
    return rol() in PERMISOS[accion]


def hero(titulo: str, subtitulo: str = "") -> None:
    st.markdown(f"<div class='cm-hero'><h1>{titulo}</h1><p>{subtitulo}</p></div>", unsafe_allow_html=True)


def aviso_permiso(accion: str) -> None:
    st.info(f"Su rol ({rol()}) no tiene permiso para esta acción ({accion}).", icon="🔐")


def org_actual() -> dict | None:
    oid = st.session_state.get("org_id")
    return db.q1("SELECT * FROM organizacion WHERE org_id=?", (oid,)) if oid else None


def mensaje_pendiente() -> None:
    for tipo, txt in st.session_state.pop("_msgs", []):
        getattr(st, tipo)(txt)


def avisar(tipo: str, txt: str) -> None:
    st.session_state.setdefault("_msgs", []).append((tipo, txt))


def semaforo_txt(s) -> str:
    return SEM_ICONO.get(s, "⚪ Gris")


def fnum(v, unidad: str = "", dec: int = 1) -> str:
    return rp.fmt(v, unidad, dec)


def guardar_editor(tabla: str, original: pd.DataFrame, editado: pd.DataFrame, extra: dict | None = None,
                   generar_id=None) -> tuple[int, list[str]]:
    """Persiste los cambios de un st.data_editor (altas, cambios y bajas) con auditoría."""
    pks = db.PK[tabla]
    errores: list[str] = []
    n = 0
    editado = editado.copy()
    for i, fila in enumerate(editado.to_dict("records")):
        fila = {k: db._limpio(v) for k, v in fila.items()}
        if extra:
            for k, v in extra.items():
                if fila.get(k) in (None, ""):
                    fila[k] = v
        if generar_id and any(fila.get(k) in (None, "") for k in pks):
            fila.update(generar_id(fila))
        if any(fila.get(k) in (None, "") for k in pks):
            errores.append(f"Fila {i + 1}: falta la clave {', '.join(pks)}")
            continue
        with db.get_conn() as conn:
            errs = db.validar_fila(tabla, fila, conn)
        if errs:
            errores.append(f"Fila {i + 1}: " + "; ".join(errs))
            continue
        try:
            if db.guardar(tabla, fila, usuario()) != "SIN CAMBIOS":
                n += 1
        except Exception as ex:  # noqa: BLE001
            errores.append(f"Fila {i + 1}: {ex}")
    if not original.empty:
        clave = lambda d: tuple(str(d.get(k)) for k in pks)  # noqa: E731
        antes = {clave(r) for r in original.to_dict("records")}
        despues = {clave({k: db._limpio(v) for k, v in r.items()}) for r in editado.to_dict("records")}
        for k in antes - despues:
            try:
                db.eliminar(tabla, dict(zip(pks, k)), usuario())
                n += 1
            except Exception as ex:  # noqa: BLE001
                errores.append(f"No se pudo eliminar {k}: {ex}")
    return n, errores


def mostrar_resultado_guardado(n: int, errores: list[str]) -> None:
    if n:
        avisar("success", f"✅ {n} cambio(s) guardado(s) y auditado(s).")
    for e in errores[:10]:
        avisar("error", e)
    if not n and not errores:
        avisar("info", "No había cambios que guardar.")


EN_NAVEGADOR = sys.platform == "emscripten"  # versión HTML (Pyodide / stlite)


def editor(df: pd.DataFrame, key: str, num_rows: str = "fixed", **kw) -> pd.DataFrame:
    """st.data_editor compatible con la versión HTML.

    En stlite, un editor con key y num_rows='fixed' falla (depende de pyarrow);
    en ese caso se omite la key solo en el navegador.
    """
    if EN_NAVEGADOR and num_rows == "fixed":
        return st.data_editor(df, num_rows=num_rows, **kw)
    return st.data_editor(df, key=key, num_rows=num_rows, **kw)


def cfg_select(opciones: list[str]):
    return st.column_config.SelectboxColumn(options=opciones, required=False)


def figura_base(fig: go.Figure, alto: int = 360) -> go.Figure:
    fig.update_layout(template="plotly_white", height=alto, margin=dict(l=10, r=10, t=50, b=10),
                      legend=dict(orientation="h", yanchor="top", y=-0.18, x=0, title_text=""), font=dict(size=12),
                      title_x=0, title_xanchor="left", title_font=dict(size=15, color=AZUL))
    if not fig.layout.title.text:
        fig.update_layout(title_text="")
    return fig


# ----------------------------------------------------------------------------
# Login
# ----------------------------------------------------------------------------
def pantalla_login() -> None:
    st.markdown(CSS, unsafe_allow_html=True)
    c1, c2, c3 = st.columns([1, 1.3, 1])
    with c2:
        st.markdown("<div style='height:50px'></div>", unsafe_allow_html=True)
        st.markdown("<div class='cm-hero' style='text-align:center'><h1>🧭 CANVAS MODEL IA</h1>"
                    "<p>Sistema Inteligente de Modelamiento de Negocios · Canvas AS IS / TO BE · Predicción mes +1</p></div>",
                    unsafe_allow_html=True)
        with st.form("login"):
            u = st.text_input("Usuario", value="admin")
            p = st.text_input("Contraseña", value="Admin2026!", type="password",
                              help="Credenciales de demostración precargadas: pulse Ingresar")
            ok = st.form_submit_button("Ingresar", type="primary", width="stretch")
        if ok:
            r = db.q1("SELECT * FROM usuario WHERE usuario=? AND activo=1", (u.strip(),))
            if r and db.verificar_password(p, r["pwd_hash"]):
                st.session_state["user"] = {"usuario": r["usuario"], "nombre": r["nombre"], "rol": r["rol"]}
                with db.get_conn() as conn:
                    db.auditar(conn, r["usuario"], "sesion", r["usuario"], "LOGIN", None, {"rol": r["rol"]})
                st.rerun()
            else:
                st.error("Usuario o contraseña incorrectos.")
        st.caption("Usuarios de demostración: admin / Admin2026! · gerente / Gerente2026! · pmo / Pmo2026! · "
                   "analista / Analista2026! · auditor / Auditor2026! (los cuatro últimos se crean al cargar la data de prueba).")
        st.caption(f"Versión {VERSION_APP} · Base de datos: {db.DB_PATH}")


# ----------------------------------------------------------------------------
# 0. Inicio
# ----------------------------------------------------------------------------
def cargar_data_prueba() -> None:
    ruta = db.ruta_data_prueba()
    if not ruta:
        st.error("No se encontró 10_Data_Prueba.xlsx en ./Entregable/")
        return
    with open(ruta, "rb") as f:
        r = db.cargar_excel(f.read(), os.path.basename(ruta), usuario())
    st.session_state["ultima_carga"] = r
    avisar("success", f"Data de prueba cargada: {r['ok']} filas nuevas/actualizadas, {r['omitidas']} sin cambios, "
                      f"{r['error']} a cuarentena (incluye las filas inválidas intencionales).")


def pagina_inicio(org: dict | None) -> None:
    hero("Bienvenido a CANVAS MODEL IA",
         "Diagnosticar AS IS → Diseñar TO BE → Priorizar proyectos → Ejecutar y medir KPI → Predecir mes +1 → Aprender y versionar")
    pasos = ["1 Diagnosticar AS IS", "2 Diseñar TO BE", "3 Priorizar proyectos", "4 Ejecutar y medir", "5 Predecir mes +1",
             "6 Aprender y versionar"]
    st.markdown(" <span class='cm-arrow'>→</span> ".join(f"<span class='cm-chip'>{p}</span>" for p in pasos),
                unsafe_allow_html=True)
    if org is None:
        st.warning("La base de datos no tiene organizaciones registradas.")
        c1, c2 = st.columns(2)
        with c1:
            st.markdown("**Opción A:** cargar la data de prueba incluida (3 empresas, escenarios, proyectos y KPI).")
            if puede("editar") and st.button("📥 Cargar data de prueba", type="primary"):
                cargar_data_prueba()
                st.rerun()
        with c2:
            st.markdown("**Opción B:** registrar su organización en *1. Base de datos → Registro manual* "
                        "y luego usar *2. Canvas AS IS → Formular con IA*.")
        return
    oid = org["org_id"]
    st.subheader(f"{org['razon_social']}")
    st.caption(f"Sector {org['sector']} · {org['tamano']} empresa · Ventas anuales S/ {org['ventas_anuales_pen'] or 0:,.0f} "
               f"({(org['ventas_anuales_pen'] or 0) / float(db.param('UIT_2026', '5500')):,.0f} UIT) · "
               f"Madurez digital {org['madurez_digital']}/5")
    ver = db.q("SELECT tipo, estado FROM canvas_version WHERE org_id=?", (oid,))
    port = rp.portafolio(oid)
    c = st.columns(5)
    c[0].metric("Canvas AS IS aprobado", int(((ver.tipo == "AS IS") & (ver.estado == "Aprobado")).sum()) if not ver.empty else 0, border=True)
    c[1].metric("Canvas TO BE aprobados", int(((ver.tipo == "TO BE") & (ver.estado == "Aprobado")).sum()) if not ver.empty else 0, border=True)
    c[2].metric("Brechas identificadas", db.q1("SELECT COUNT(*) n FROM brecha WHERE org_id=?", (oid,))["n"], border=True)
    c[3].metric("Proyectos en control", len(port), border=True)
    c[4].metric("Proyectos en rojo", int((port["semaforo"] == "Rojo").sum()) if not port.empty else 0, border=True)
    st.markdown("#### Guía rápida")
    st.markdown("""
| Paso | Menú | Qué hacer |
|---|---|---|
| 1 | 1. Base de datos | Cargar el Excel o registrar datos manualmente |
| 2 | 2. Canvas AS IS | Formular con IA, revisar, validar reglas y aprobar la línea base |
| 3 | 3. Canvas TO BE | Elegir escenario, formular con IA, comparar y simular |
| 4 | 4. Brechas y proyectos | Calcular brechas, priorizar y aprobar proyectos |
| 5 | 5. Diagrama de Gantt | Proponer, editar y aprobar el cronograma |
| 6 | 6. Seguimiento | Registrar avances, costos, riesgos e hipótesis |
| 7 | 7-9. Dashboard, Predicción, Reportes | Analizar real vs proyectado, mes +1 y generar el PPTX |
""")
    if puede("editar"):
        with st.expander("Mantenimiento de datos de prueba"):
            if st.button("📥 Volver a cargar data de prueba (idempotente)"):
                cargar_data_prueba()
                st.rerun()


# ----------------------------------------------------------------------------
# 1. Base de datos
# ----------------------------------------------------------------------------
TABLAS_EDITABLES = {
    "Organizaciones": ("organizacion", None),
    "Escenarios": ("escenario", "org"),
    "KPI (definición)": ("kpi", "org"),
    "KPI (observaciones mensuales)": ("kpi_observacion", "kpi"),
    "Proyectos": ("proyecto", "org"),
    "Avance mensual de proyectos": ("avance_mensual", "proy"),
    "Hitos": ("hito", "proy"),
    "Riesgos": ("riesgo", "proy"),
    "Hipótesis": ("hipotesis", "org"),
    "Brechas": ("brecha", "org"),
}


def df_tabla(tabla: str, filtro: str | None, oid: str | None) -> pd.DataFrame:
    if filtro == "org":
        return db.q(f"SELECT * FROM {tabla} WHERE org_id=? ORDER BY 1", (oid,))
    if filtro == "kpi":
        return db.q(f"SELECT t.* FROM {tabla} t JOIN kpi k ON k.kpi_id=t.kpi_id WHERE k.org_id=? ORDER BY 1,2", (oid,))
    if filtro == "proy":
        return db.q(f"SELECT t.* FROM {tabla} t JOIN proyecto p ON p.proyecto_id=t.proyecto_id WHERE p.org_id=? ORDER BY 1,2", (oid,))
    return db.q(f"SELECT * FROM {tabla} ORDER BY 1")


def config_columnas(tabla: str) -> dict:
    cfg = {}
    for (t, c), cat in db.CATALOGOS.items():
        if t == tabla:
            cfg[c] = cfg_select(cat)
    if tabla in ("canvas_elemento", "brecha"):
        cfg["bloque"] = st.column_config.SelectboxColumn(options=db.BLOQUES, help="; ".join(f"{k}={v}" for k, v in ia.BLOQUES.items()))
    for c in ("presupuesto_pen", "costo_plan_pen", "costo_real_pen", "ventas_anuales_pen"):
        cfg[c] = st.column_config.NumberColumn(format="S/ %,.0f", min_value=0)
    for c in ("avance_plan_pct", "avance_real_pct"):
        cfg[c] = st.column_config.NumberColumn(format="%.1f %%", min_value=0, max_value=100)
    return cfg


def pagina_base_datos(org: dict | None) -> None:
    hero("1. Base de datos", "Carga desde Excel con validación y cuarentena · Registro manual · Exportación")
    t1, t2, t3, t4 = st.tabs(["📥 Cargar Excel", "✍️ Registro manual", "🚫 Cuarentena", "📤 Exportar"])
    with t1:
        st.markdown("El libro debe tener una hoja por tabla (organizacion, escenario, canvas_version, canvas_elemento, "
                    "brecha, proyecto, hito, avance_mensual, riesgo, kpi, kpi_observacion, ...). "
                    "Descargue la plantilla con datos de prueba como referencia.")
        ruta = db.ruta_data_prueba()
        c1, c2 = st.columns(2)
        if ruta:
            with open(ruta, "rb") as f:
                c1.download_button("⬇️ Descargar plantilla / data de prueba", f.read(), "10_Data_Prueba.xlsx",
                                   "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        if puede("editar") and c2.button("📥 Cargar data de prueba incluida", type="primary"):
            cargar_data_prueba()
            st.rerun()
        if puede("editar"):
            archivo = st.file_uploader("Seleccione un archivo Excel (.xlsx)", type=["xlsx"])
            if archivo is not None and st.button("⚙️ Procesar archivo"):
                with st.spinner("Validando y cargando..."):
                    r = db.cargar_excel(archivo.getvalue(), archivo.name, usuario())
                st.session_state["ultima_carga"] = r
                st.rerun()
        r = st.session_state.get("ultima_carga")
        if r:
            st.markdown("##### Resultado de la última carga")
            c = st.columns(4)
            c[0].metric("Filas cargadas", r["ok"], border=True)
            c[1].metric("Sin cambios (idempotente)", r["omitidas"], border=True)
            c[2].metric("A cuarentena", r["error"], border=True)
            c[3].metric("Hash SHA-256", r["hash"][:12] + "…", border=True)
            st.dataframe(pd.DataFrame(r["detalle"]).T.rename(columns={"ok": "Cargadas", "error": "Errores", "omitidas": "Sin cambios"}))
        st.markdown("##### Historial de cargas (linaje)")
        st.dataframe(db.q("SELECT carga_id, fecha, archivo, substr(hash_sha256,1,16) AS hash, filas_ok, filas_error, "
                          "filas_omitidas, usuario FROM carga_datos ORDER BY carga_id DESC"), hide_index=True)
    with t2:
        if puede("editar"):
            with st.expander("➕ Registrar nueva organización (crea escenarios Pesimista/Base/Optimista)", expanded=org is None):
                with st.form("nueva_org"):
                    c1, c2, c3 = st.columns(3)
                    rs = c1.text_input("Razón social *")
                    ruc = c2.text_input("RUC")
                    sector = c3.selectbox("Sector *", db.SECTORES)
                    ventas = c1.number_input("Ventas anuales (S/)", min_value=0.0, step=10000.0)
                    madurez = c2.slider("Madurez digital (1-5)", 1, 5, 2)
                    uit = float(db.param("UIT_2026", "5500"))
                    enviar = st.form_submit_button("Guardar organización", type="primary")
                if enviar:
                    if not rs.strip():
                        st.error("La razón social es obligatoria.")
                    else:
                        v_uit = ventas / uit
                        tam = "Micro" if v_uit <= 150 else "Pequeña" if v_uit <= 1700 else "Mediana" if v_uit <= 2300 else "Grande"
                        oid = db.siguiente_id("organizacion", "org_id", "EMP")
                        db.guardar("organizacion", dict(org_id=oid, razon_social=rs.strip(), ruc=ruc, sector=sector, tamano=tam,
                                                        ventas_anuales_pen=ventas, madurez_digital=madurez, moneda="PEN",
                                                        fecha_alta=date.today().isoformat(), activo=1), usuario())
                        n = oid[-2:]
                        for sufijo, tipo, fd, fp, fcst, pr in (("PES", "Pesimista", 0.92, 0.98, 1.06, 0.25),
                                                                ("BAS", "Base", 1, 1, 1, 0.5),
                                                                ("OPT", "Optimista", 1.08, 1.02, 0.97, 0.25)):
                            db.guardar("escenario", dict(escenario_id=f"E{n}-{sufijo}", org_id=oid, nombre=tipo, tipo=tipo,
                                                         horizonte_meses=12, factor_demanda=fd, factor_precio=fp,
                                                         factor_costo=fcst, probabilidad=pr,
                                                         descripcion="Escenario creado automáticamente"), usuario())
                        st.session_state["_org_pend"] = oid
                        avisar("success", f"Organización {oid} registrada como {tam} empresa ({v_uit:,.0f} UIT).")
                        st.rerun()
        etiqueta = st.selectbox("Tabla a editar", list(TABLAS_EDITABLES.keys()))
        tabla, filtro = TABLAS_EDITABLES[etiqueta]
        if filtro and org is None:
            st.info("Seleccione o registre una organización primero.")
            return
        oid = org["org_id"] if org else None
        df = df_tabla(tabla, filtro, oid)
        st.caption(f"Tabla `{tabla}` · {len(df)} filas · Use ➕ al final de la tabla para agregar y la papelera para eliminar.")
        if puede("editar"):
            if df.empty:
                df = pd.DataFrame(columns=[c for c in db.columnas(tabla) if c not in ("cargado_en",)])
            editado = editor(df, f"ed_{tabla}_{oid}", num_rows="dynamic", column_config=config_columnas(tabla),
                                     disabled=["cargado_en"], hide_index=True)
            if st.button("💾 Guardar cambios", type="primary", key=f"g_{tabla}"):
                extra = {"org_id": oid} if filtro == "org" else None
                n, errs = guardar_editor(tabla, df, editado, extra)
                mostrar_resultado_guardado(n, errs)
                st.rerun()
        else:
            st.dataframe(df, hide_index=True)
    with t3:
        cu = db.q("""SELECT c.cuar_id, c.carga_id, d.archivo, d.fecha, c.hoja, c.fila, c.error, c.datos_json
                     FROM cuarentena c LEFT JOIN carga_datos d ON d.carga_id=c.carga_id ORDER BY c.cuar_id DESC""")
        st.markdown(f"**{len(cu)}** fila(s) rechazadas. Corrija el dato en el Excel y vuelva a cargarlo.")
        st.dataframe(cu, hide_index=True, height=420)
    with t4:
        st.markdown("Exporta todas las tablas (incluye predicciones, simulaciones y auditoría) a un libro Excel.")
        if st.button("📦 Preparar exportación"):
            st.session_state["export_xlsx"] = db.exportar_excel()
        if st.session_state.get("export_xlsx"):
            st.download_button("⬇️ Descargar Excel de la base de datos", st.session_state["export_xlsx"],
                               f"CanvasModelIA_BD_{datetime.now():%Y%m%d_%H%M}.xlsx",
                               "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


# ----------------------------------------------------------------------------
# 2 y 3. Canvas AS IS / TO BE
# ----------------------------------------------------------------------------
def render_canvas(elementos: pd.DataFrame, tipo: str) -> None:
    areas = {"RK": "rk", "AC": "ac", "SK": "sk", "PV": "pv", "RC": "rc", "CH": "ch", "SC": "sc", "EC": "ec", "FI": "fi"}
    html = ["<div class='cm-grid'>"]
    for b, area in areas.items():
        sub = elementos[elementos["bloque"] == b] if not elementos.empty else elementos
        tarjetas = []
        for e in sub.to_dict("records"):
            color = CAMBIO_COLOR.get(e.get("tipo_cambio") or "N/A", AZUL2) if tipo == "TO BE" else (
                "#F59E0B" if e.get("naturaleza") == "Hipótesis" else AZUL2)
            badge = (f"<span class='cm-badge' style='background:{color}'>{(e.get('tipo_cambio') or '').upper()}</span>"
                     if tipo == "TO BE" else "")
            ia_b = "<span class='cm-badge' style='background:#7C3AED'>IA</span>" if e.get("origen") == "IA" else ""
            conf = {"Alta": "●●●", "Media": "●●○", "Baja": "●○○"}.get(e.get("confianza") or "", "○○○")
            desc = str(e.get("descripcion") or "").replace("<", "&lt;")
            tarjetas.append(
                f"<div class='cm-card' style='border-left-color:{color}'>{badge}{ia_b}{desc}"
                f"<div class='cm-meta'>{e.get('naturaleza') or ''} · confianza {conf} · {e.get('responsable') or 'sin responsable'}</div></div>")
        cuerpo = "".join(tarjetas) or "<div class='cm-empty'>Sin elementos</div>"
        html.append(f"<div class='cm-block' style='grid-area:{area}'><h4>{ia.BLOQUES[b]} ({b})</h4>{cuerpo}</div>")
    html.append("</div>")
    st.markdown("".join(html), unsafe_allow_html=True)
    if tipo == "TO BE":
        st.markdown(" ".join(f"<span class='cm-badge' style='background:{c}'>{k.upper()}</span>" for k, c in CAMBIO_COLOR.items()
                             if k != "N/A") + " <span class='cm-badge' style='background:#7C3AED'>IA</span> = generado por IA",
                    unsafe_allow_html=True)
    else:
        st.caption("Borde azul = hecho con evidencia · borde naranja = hipótesis · IA = generado por IA (requiere revisión)")


def motor_ia(org: dict, tipo: str, contexto: list[dict], escenario: dict | None) -> tuple[list[dict], str]:
    """Ejecuta el motor configurado (LLM opcional con respaldo local)."""
    motor = db.param("IA_MOTOR", "Local")
    cfg = st.session_state.get("llm_cfg")
    if motor == "LLM" and cfg and cfg.get("api_key"):
        try:
            return ia.llm_formular(org, tipo, cfg, contexto, escenario), "LLM"
        except Exception as ex:  # noqa: BLE001
            avisar("warning", f"El LLM no respondió correctamente ({ex}). Se usó el motor IA local.")
    if tipo == "AS IS":
        kpis = db.q("SELECT nombre, linea_base FROM kpi WHERE org_id=?", (org["org_id"],)).to_dict("records")
        return ia.formular_asis(org, kpis), "Local"
    return ia.formular_tobe(org, contexto, escenario), "Local"


def etiqueta_version(r: dict) -> str:
    esc = f" · {r['escenario_id']}" if r.get("escenario_id") else ""
    return f"{r['version_id']} · v{r['numero']} · {ESTADO_ICONO.get(r['estado'], '')} {r['estado']}{esc}"


def pagina_canvas(org: dict | None, tipo: str) -> None:
    titulo = "2. Canvas AS IS (situación actual)" if tipo == "AS IS" else "3. Canvas TO BE y escenarios (situación futura)"
    hero(titulo, "Formulación asistida por IA · revisión · validación de reglas · aprobación · versionado inmutable")
    if org is None:
        st.info("Registre o seleccione una organización.")
        return
    oid = org["org_id"]
    ia_on = db.param("IA_HABILITADA", "1") == "1"
    versiones = db.q("SELECT * FROM canvas_version WHERE org_id=? AND tipo=? ORDER BY numero, version_id", (oid, tipo))
    escenarios = db.q("SELECT * FROM escenario WHERE org_id=? ORDER BY escenario_id", (oid,))
    asis_aprob = db.q("SELECT * FROM canvas_version WHERE org_id=? AND tipo='AS IS' AND estado='Aprobado'", (oid,))

    # ---------- Crear nuevas versiones ----------
    with st.expander("➕ Crear nueva versión " + tipo, expanded=versiones.empty):
        if not puede("editar"):
            aviso_permiso("crear versiones")
        elif tipo == "AS IS":
            c1, c2 = st.columns(2)
            if c1.button("🤖 Formular AS IS con IA", type="primary", disabled=not ia_on,
                         help=None if ia_on else "Asistente IA deshabilitado en Configuración"):
                els, motor = motor_ia(org, "AS IS", [], None)
                vid = db.crear_version(oid, "AS IS", usuario(), comentario=f"Borrador generado por IA ({motor})", elementos=els, origen="IA")
                db.registrar_ia(oid, "formular_asis", motor, {"org": oid}, els, usuario())
                st.session_state[f"_pend_{tipo}"] = vid
                avisar("success", f"Borrador {vid} creado con {len(els)} elementos. Revíselo antes de aprobar.")
                st.rerun()
            if c2.button("📄 Nueva versión vacía"):
                vid = db.crear_version(oid, "AS IS", usuario(), comentario="Versión manual")
                st.session_state[f"_pend_{tipo}"] = vid
                st.rerun()
        else:
            if asis_aprob.empty:
                st.warning("Primero apruebe un Canvas AS IS (línea base).")
            elif escenarios.empty:
                st.warning("Registre escenarios en la pestaña Escenarios y simulación.")
            else:
                c1, c2, c3 = st.columns(3)
                base = c1.selectbox("AS IS base (aprobado)", asis_aprob["version_id"].tolist())
                esc_id = c2.selectbox("Escenario", escenarios["escenario_id"].tolist(),
                                      format_func=lambda x: f"{x} · {escenarios.set_index('escenario_id').loc[x, 'nombre']}",
                                      index=int(np.argmax((escenarios["tipo"] == "Base").to_numpy())) if (escenarios["tipo"] == "Base").any() else 0)
                hz = c3.number_input("Horizonte (meses)", 1, 36, int(escenarios.set_index("escenario_id").loc[esc_id, "horizonte_meses"] or 12))
                b1, b2 = st.columns(2)
                if b1.button("🤖 Formular TO BE con IA", type="primary", disabled=not ia_on):
                    ctx = db.q("SELECT * FROM canvas_elemento WHERE version_id=? ORDER BY elemento_id", (base,)).to_dict("records")
                    esc = escenarios.set_index("escenario_id").loc[esc_id].to_dict()
                    esc["escenario_id"] = esc_id
                    els, motor = motor_ia(org, "TO BE", ctx, esc)
                    vid = db.crear_version(oid, "TO BE", usuario(), esc_id, base, int(hz),
                                           f"Borrador IA ({motor}) escenario {esc['nombre']}", els, "IA")
                    db.registrar_ia(oid, "formular_tobe", motor, {"base": base, "escenario": esc_id}, els, usuario())
                    st.session_state[f"_pend_{tipo}"] = vid
                    avisar("success", f"Borrador {vid} creado con {len(els)} elementos para el escenario {esc['nombre']}.")
                    st.rerun()
                if b2.button("📄 Copiar AS IS como TO BE (edición manual)"):
                    ctx = db.q("SELECT * FROM canvas_elemento WHERE version_id=? ORDER BY elemento_id", (base,)).to_dict("records")
                    els = [{**{k: e[k] for k in ("bloque", "descripcion", "naturaleza", "evidencia", "fuente", "confianza", "responsable")},
                            "tipo_cambio": "Mantener", "elemento_origen_id": e["elemento_id"], "origen": "Manual"} for e in ctx]
                    vid = db.crear_version(oid, "TO BE", usuario(), esc_id, base, int(hz), "Copia manual del AS IS", els)
                    st.session_state[f"_pend_{tipo}"] = vid
                    st.rerun()
    if versiones.empty:
        st.info(f"No hay versiones {tipo} para esta organización.")
        if tipo == "TO BE":
            pestaña_escenarios(org)
        return

    registros = [{k: db._limpio(x) for k, x in r.items()} for r in versiones.to_dict("records")]
    ids = [r["version_id"] for r in registros]
    selkey = f"sel_ver_{tipo}_{oid}"
    pend = st.session_state.pop(f"_pend_{tipo}", None)
    if pend in ids:
        st.session_state[selkey] = pend
    if st.session_state.get(selkey) not in ids:
        aprob = [r["version_id"] for r in registros if r["estado"] == "Aprobado"]
        st.session_state[selkey] = aprob[-1] if aprob else ids[-1]
    vid = st.selectbox("Versión", ids, format_func=lambda x: etiqueta_version(
        next(r for r in registros if r["version_id"] == x)), key=selkey)
    v = next(r for r in registros if r["version_id"] == vid)
    els = db.q("SELECT * FROM canvas_elemento WHERE version_id=? ORDER BY bloque, elemento_id", (vid,))
    editable = v["estado"] in ("Borrador", "Rechazado")

    c = st.columns(5)
    c[0].metric("Estado", f"{ESTADO_ICONO.get(v['estado'], '')} {v['estado']}")
    c[1].metric("Elementos", len(els))
    c[2].metric("Fecha de corte", v["fecha_corte"] or "—")
    c[3].metric("Deriva de", v["deriva_de"] or "—")
    c[4].metric("Hash", (v["hash_contenido"] or "—")[:10])
    if tipo == "TO BE":
        st.caption(f"Escenario: {v['escenario_id'] or '—'} · Horizonte: {v['horizonte_meses']} meses · Autor: {v['autor'] or '—'} · "
                   f"Aprobador: {v['aprobador'] or '—'} {v['fecha_aprobacion'] or ''} · {v['comentario'] or ''}")
    else:
        st.caption(f"Autor: {v['autor'] or '—'} · Aprobador: {v['aprobador'] or '—'} {v['fecha_aprobacion'] or ''} · {v['comentario'] or ''}")

    brechas = db.q("SELECT * FROM brecha WHERE version_tobe_id=?", (vid,)).to_dict("records") if tipo == "TO BE" else None
    hallazgos = ia.validar_reglas(els.to_dict("records"), tipo, brechas)

    # ---------- Flujo de aprobación ----------
    with st.container(border=True):
        st.markdown("**Flujo de aprobación**")
        comentario = st.text_input("Comentario de la decisión", key=f"com_{vid}")
        b = st.columns(4)
        if b[0].button("📤 Enviar a revisión", disabled=not (editable and puede("editar")), key=f"rev_{vid}"):
            db.cambiar_estado_version(vid, "En revisión", usuario(), comentario)
            avisar("success", f"{vid} enviada a revisión.")
            st.rerun()
        if b[1].button("✅ Aprobar", type="primary", key=f"apr_{vid}",
                       disabled=not (v["estado"] == "En revisión" and puede("aprobar") and ia.puede_aprobar(hallazgos)),
                       help="Requiere estado En revisión, rol Gerente/Administrador y ninguna regla en Error"):
            db.cambiar_estado_version(vid, "Aprobado", usuario(), comentario)
            avisar("success", f"{vid} aprobada y congelada (hash registrado). Si existía una versión aprobada anterior del mismo tipo y escenario, pasó a Reemplazado.")
            st.rerun()
        if b[2].button("⛔ Rechazar", key=f"rec_{vid}", disabled=not (v["estado"] == "En revisión" and puede("aprobar"))):
            db.cambiar_estado_version(vid, "Rechazado", usuario(), comentario or "Rechazado")
            avisar("warning", f"{vid} rechazada; puede editarse y reenviarse.")
            st.rerun()
        if b[3].button("🧬 Clonar como nueva versión", key=f"clo_{vid}", disabled=not puede("editar")):
            nuevo = db.clonar_version(vid, usuario(), f"Clon de {vid}. {comentario}")
            st.session_state[f"_pend_{tipo}"] = nuevo
            avisar("success", f"Se creó {nuevo} (Borrador) a partir de {vid}.")
            st.rerun()
        if not puede("aprobar"):
            st.caption("Solo Gerente o Administrador pueden aprobar o rechazar.")

    pest = ["🗺️ Vista Canvas", "✏️ Editar elementos", "🧪 Validación de reglas", "🔀 Comparar versiones", "🕘 Historial"]
    if tipo == "TO BE":
        pest.append("🎲 Escenarios y simulación")
    tabs = st.tabs(pest)
    with tabs[0]:
        render_canvas(els, tipo)
    with tabs[1]:
        if not editable:
            st.info(f"La versión está en estado **{v['estado']}**. "
                    + ("Es inmutable: use **Clonar** para modificarla." if v["estado"] in ("Aprobado", "Reemplazado")
                       else "Para editarla debe ser rechazada o clonada."))
            st.dataframe(els, hide_index=True)
        elif not puede("editar"):
            aviso_permiso("editar")
            st.dataframe(els, hide_index=True)
        else:
            cols = ["elemento_id", "bloque", "descripcion", "naturaleza", "evidencia", "fuente", "confianza", "responsable",
                    "kpi_id", "tipo_cambio", "elemento_origen_id", "origen"]
            base_df = els[cols] if not els.empty else pd.DataFrame(columns=cols)
            cfg = config_columnas("canvas_elemento")
            cfg["descripcion"] = st.column_config.TextColumn(width="large", required=True)
            cfg["elemento_id"] = st.column_config.TextColumn(disabled=True, help="Se genera automáticamente")
            editado = editor(base_df, f"ed_el_{vid}", num_rows="dynamic", column_config=cfg, hide_index=True,
                                     column_order=cols)
            contador = {"n": len(base_df)}

            def gen_id(_fila):
                contador["n"] += 1
                while db.q1("SELECT 1 x FROM canvas_elemento WHERE elemento_id=?", (f"{vid}-E{contador['n']:02d}",)):
                    contador["n"] += 1
                return {"elemento_id": f"{vid}-E{contador['n']:02d}"}

            if st.button("💾 Guardar elementos", type="primary", key=f"gel_{vid}"):
                editado = editado.assign(version_id=vid)
                editado["tipo_cambio"] = editado["tipo_cambio"].fillna("N/A" if tipo == "AS IS" else "Modificar")
                editado["origen"] = editado["origen"].fillna("Manual")
                n, errs = guardar_editor("canvas_elemento", base_df.assign(version_id=vid), editado, None, gen_id)
                mostrar_resultado_guardado(n, errs)
                st.rerun()
    with tabs[2]:
        hz = pd.DataFrame(hallazgos)
        iconos = {"Error": "❌", "Advertencia": "⚠️", "Info": "ℹ️", "OK": "✅"}
        hz.insert(0, " ", hz["nivel"].map(iconos))
        st.dataframe(hz, hide_index=True)
        if ia.puede_aprobar(hallazgos):
            st.success("La versión puede aprobarse (sin errores de integridad).")
        else:
            st.error("La versión tiene errores de integridad: corríjalos antes de aprobar.")
        st.caption("RN-01 PV↔SC y evidencia · RN-02 canales/relaciones con responsable o KPI · RN-03 ingresos/costos con fuente · "
                   "RN-04 clasificación del cambio · RN-05 cambio material con proyecto · RN-08 nueve bloques completos")
    with tabs[3]:
        todas = db.q("SELECT version_id, tipo, estado FROM canvas_version WHERE org_id=? AND version_id<>? ORDER BY tipo, version_id",
                     (oid, vid))
        if todas.empty:
            st.info("No hay otra versión para comparar.")
        else:
            opciones = todas["version_id"].tolist()
            sugerida = v["deriva_de"] if v["deriva_de"] in opciones else opciones[0]
            otra = st.selectbox("Comparar contra", opciones, index=opciones.index(sugerida), key=f"cmp_{vid}")
            origen = db.q("SELECT * FROM canvas_elemento WHERE version_id=?", (otra,)).to_dict("records")
            comp = pd.DataFrame(ia.comparar(origen, els.to_dict("records")))
            if comp.empty:
                st.info("Sin elementos para comparar.")
            else:
                cnt = comp["tipo_cambio"].value_counts()
                cc = st.columns(4)
                for i, k in enumerate(["Crear", "Modificar", "Eliminar", "Mantener"]):
                    cc[i].metric(k, int(cnt.get(k, 0)))
                comp["bloque"] = comp["bloque"].map(lambda b: f"{b} · {ia.BLOQUES[b]}")
                comp = comp.rename(columns={"as_is": f"Origen ({otra})", "to_be": f"Destino ({vid})"})
                st.dataframe(comp, hide_index=True, height=420)
    with tabs[4]:
        hist = versiones[["version_id", "numero", "estado", "escenario_id", "fecha_corte", "deriva_de", "autor", "aprobador",
                          "fecha_aprobacion", "hash_contenido", "comentario"]].copy()
        st.dataframe(hist, hide_index=True)
        cadena, actual = [], vid
        while actual:
            cadena.append(actual)
            actual = (db.q1("SELECT deriva_de FROM canvas_version WHERE version_id=?", (actual,)) or {}).get("deriva_de")
            if actual in cadena:
                break
        st.markdown("**Linaje de la versión seleccionada:** " + " ← ".join(cadena))
        st.markdown("**Ejecuciones de IA**")
        st.dataframe(db.q("SELECT ia_id, fecha, tarea, motor, prompt_version, estado_revision, usuario FROM ia_ejecucion "
                          "WHERE org_id=? ORDER BY ia_id DESC", (oid,)), hide_index=True)
    if tipo == "TO BE":
        with tabs[5]:
            pestaña_escenarios(org)


def pestaña_escenarios(org: dict) -> None:
    oid = org["org_id"]
    st.markdown("#### Escenarios de la organización")
    esc = db.q("SELECT * FROM escenario WHERE org_id=? ORDER BY escenario_id", (oid,))
    if puede("editar"):
        base = esc if not esc.empty else pd.DataFrame(columns=db.columnas("escenario"))
        cfg = config_columnas("escenario")
        cfg["org_id"] = st.column_config.TextColumn(disabled=True)
        cfg["probabilidad"] = st.column_config.NumberColumn(min_value=0.0, max_value=1.0, step=0.05)
        ed = editor(base, f"ed_esc_{oid}", num_rows="dynamic", column_config=cfg, hide_index=True)
        if st.button("💾 Guardar escenarios", key=f"gesc_{oid}"):
            n, errs = guardar_editor("escenario", base, ed, {"org_id": oid},
                                     lambda f: {"escenario_id": db.siguiente_id("escenario", "escenario_id", f"E{oid[-2:]}-P")})
            mostrar_resultado_guardado(n, errs)
            st.rerun()
        suma = esc.loc[esc["tipo"] != "Personalizado", "probabilidad"].sum() if not esc.empty else 0
        if not esc.empty and abs(suma - 1) > 0.01:
            st.warning(f"Las probabilidades de los escenarios estándar suman {suma:.2f} (se recomienda 1,00).")
    else:
        st.dataframe(esc, hide_index=True)
    st.divider()
    ui_simulacion(org, "to_be")


def ui_simulacion(org: dict, clave: str) -> None:
    """Simulación Monte Carlo multiperiodo y multiescenario."""
    oid = org["org_id"]
    st.markdown("#### 🎲 Simulación multiperiodo por escenario")
    kpis = db.q("SELECT * FROM kpi WHERE org_id=? ORDER BY kpi_id", (oid,))
    esc = db.q("SELECT * FROM escenario WHERE org_id=? ORDER BY escenario_id", (oid,))
    if kpis.empty or esc.empty:
        st.info("Se requieren KPI con observaciones y escenarios.")
        return
    c1, c2, c3 = st.columns([2, 3, 1])
    kid = c1.selectbox("KPI", kpis["kpi_id"].tolist(), key=f"sim_k_{clave}_{oid}",
                       format_func=lambda k: f"{k} · {kpis.set_index('kpi_id').loc[k, 'nombre']}")
    sel = c2.multiselect("Escenarios", esc["escenario_id"].tolist(), default=esc["escenario_id"].tolist()[:3],
                         key=f"sim_e_{clave}_{oid}", format_func=lambda e: f"{e} · {esc.set_index('escenario_id').loc[e, 'nombre']}")
    hz = c3.number_input("Meses", 1, 36, 12, key=f"sim_h_{clave}_{oid}")
    kpi = {k: db._limpio(x) for k, x in kpis.set_index("kpi_id").loc[kid].to_dict().items()}
    kpi["kpi_id"] = kid
    kpi["unidad"] = kpi.get("unidad") or ""
    serie = db.q("SELECT periodo, valor_real, valor_plan FROM kpi_observacion WHERE kpi_id=? ORDER BY periodo", (kid,))
    if serie.dropna(subset=["valor_real"]).empty:
        st.info("El KPI no tiene observaciones reales.")
        return
    it = int(float(db.param("SIM_ITERACIONES", "500")))
    semilla = int(float(db.param("SIM_SEMILLA", "42")))
    reales = serie.dropna(subset=["valor_real"])
    fig = go.Figure()
    fig.add_trace(go.Scatter(x=reales["periodo"], y=reales["valor_real"], name="Real", line=dict(color="#111827", width=2.5)))
    planes = serie.dropna(subset=["valor_plan"])
    fig.add_trace(go.Scatter(x=planes["periodo"], y=planes["valor_plan"], name="Plan", line=dict(color="#9CA3AF", dash="dash")))
    paleta = {"Pesimista": "#DC2626", "Base": "#1D70B8", "Optimista": "#16A34A", "Personalizado": "#7C3AED"}
    resultados = []
    for eid in sel:
        e = esc.set_index("escenario_id").loc[eid].to_dict()
        e["escenario_id"] = eid
        d = fc.simular(serie, kpi, e, int(hz), it, semilla)
        col = paleta.get(e["tipo"], "#6B7280")
        fig.add_trace(go.Scatter(x=list(d["periodo"]) + list(d["periodo"][::-1]), y=list(d["p90"]) + list(d["p10"][::-1]),
                                 fill="toself", fillcolor=col, opacity=0.12, line=dict(width=0), showlegend=False,
                                 hoverinfo="skip"))
        fig.add_trace(go.Scatter(x=d["periodo"], y=d["p50"], name=f"{e['nombre']} P50", line=dict(color=col, width=2)))
        d.insert(0, "escenario", f"{eid} · {e['nombre']}")
        d["probabilidad"] = e["probabilidad"]
        resultados.append((eid, d))
    fig.update_layout(title=f"{kid} · {kpi['nombre']} ({kpi['unidad']}): trayectorias P10–P90 por escenario")
    st.plotly_chart(figura_base(fig, 420), key=f"sim_fig_{clave}_{oid}")
    if resultados:
        tabla = pd.concat([d for _, d in resultados])
        ult = tabla.groupby("escenario").tail(1)
        esperado = sum(r["p50"] * r["probabilidad"] for r in ult.to_dict("records") if r["probabilidad"])
        pr = sum(r["probabilidad"] for r in ult.to_dict("records") if r["probabilidad"])
        c = st.columns(len(ult) + 1)
        for i, r in enumerate(ult.to_dict("records")):
            c[i].metric(f"{r['escenario']} ({r['periodo']})", fnum(r["p50"], kpi["unidad"]),
                        f"P10 {fnum(r['p10'], kpi['unidad'])} · P90 {fnum(r['p90'], kpi['unidad'])}", delta_color="off")
        if pr > 0:
            c[-1].metric("Valor esperado ponderado", fnum(esperado / pr, kpi["unidad"]), help="Σ P50 × probabilidad / Σ probabilidad")
        with st.expander("Tabla de resultados por mes"):
            st.dataframe(tabla, hide_index=True)
        if puede("editar") and st.button("💾 Guardar simulación en la base de datos", key=f"sim_g_{clave}_{oid}"):
            with db.get_conn() as conn:
                for eid, d in resultados:
                    conn.executemany("INSERT INTO simulacion(org_id, escenario_id, kpi_id, periodo, p10, p50, p90) VALUES (?,?,?,?,?,?,?)",
                                     [(oid, eid, kid, r.periodo, float(r.p10), float(r.p50), float(r.p90)) for r in d.itertuples()])
                db.auditar(conn, usuario(), "simulacion", kid, "SIMULAR", None, {"escenarios": [e for e, _ in resultados], "meses": int(hz)})
            avisar("success", "Simulación guardada.")
            st.rerun()


# ----------------------------------------------------------------------------
# 4. Brechas y proyectos
# ----------------------------------------------------------------------------
def crear_plan_avance(proyecto: dict) -> int:
    """Genera la curva S planificada (avance y costo) si el proyecto aún no tiene plan."""
    if db.q1("SELECT COUNT(*) n FROM avance_mensual WHERE proyecto_id=?", (proyecto["proyecto_id"],))["n"]:
        return 0
    per = pd.period_range(proyecto["fecha_inicio"][:7], proyecto["fecha_fin"][:7], freq="M")
    n = len(per)
    x = np.arange(1, n + 1) / n
    curva = 1 / (1 + np.exp(-10 * (x - 0.5)))
    lo, hi = 1 / (1 + np.exp(5)), 1 / (1 + np.exp(-5))
    curva = (curva - lo) / (hi - lo) * 100
    with db.get_conn() as conn:
        for p, c in zip(per, curva):
            db.guardar("avance_mensual", {"proyecto_id": proyecto["proyecto_id"], "periodo": str(p),
                                          "avance_plan_pct": round(float(c), 1),
                                          "costo_plan_pen": round(float(proyecto["presupuesto_pen"] or 0) * float(c) / 100, 0),
                                          "comentario": "Plan generado (curva S)"}, usuario(), conn)
    return n


def pagina_brechas(org: dict | None) -> None:
    hero("4. Brechas y proyectos", "Matriz de diferencia AS IS → TO BE · priorización · conversión en proyectos · aprobación")
    if org is None:
        st.info("Seleccione una organización.")
        return
    oid = org["org_id"]
    t1, t2, t3 = st.tabs(["🧮 Matriz de brechas", "📁 Proyectos y aprobación", "📈 Mapa de priorización"])
    with t1:
        asis = db.q("SELECT version_id, estado FROM canvas_version WHERE org_id=? AND tipo='AS IS' ORDER BY estado='Aprobado' DESC, version_id DESC", (oid,))
        tobe = db.q("SELECT version_id, estado, escenario_id FROM canvas_version WHERE org_id=? AND tipo='TO BE' ORDER BY estado='Aprobado' DESC, version_id", (oid,))
        if asis.empty or tobe.empty:
            st.info("Se requiere al menos un Canvas AS IS y un TO BE.")
        else:
            c1, c2 = st.columns(2)
            va = c1.selectbox("Canvas AS IS", asis["version_id"], format_func=lambda x: f"{x} ({asis.set_index('version_id').loc[x, 'estado']})")
            vt = c2.selectbox("Canvas TO BE", tobe["version_id"], format_func=lambda x: f"{x} ({tobe.set_index('version_id').loc[x, 'estado']})")
            if puede("pmo") and st.button("🤖 Calcular brechas con IA", type="primary"):
                a = db.q("SELECT * FROM canvas_elemento WHERE version_id=?", (va,)).to_dict("records")
                t = db.q("SELECT * FROM canvas_elemento WHERE version_id=?", (vt,)).to_dict("records")
                existentes = db.q("SELECT bloque, to_be FROM brecha WHERE org_id=?", (oid,))
                claves = {(r["bloque"], ia._norm(r["to_be"])) for r in existentes.to_dict("records")}
                nuevas = [b for b in ia.calcular_brechas(a, t, org["tamano"]) if (b["bloque"], ia._norm(b["to_be"])) not in claves]
                st.session_state["brechas_prev"] = {"va": va, "vt": vt, "df": pd.DataFrame(nuevas)}
                db.registrar_ia(oid, "calcular_brechas", "Local", {"asis": va, "tobe": vt}, nuevas, usuario())
            prev = st.session_state.get("brechas_prev")
            if prev and prev["vt"] == vt:
                if prev["df"].empty:
                    st.success("No hay brechas nuevas: todas ya están registradas.")
                else:
                    st.markdown("**Propuesta de brechas (revise impacto, esfuerzo y riesgo antes de guardar)**")
                    cfg = {c: st.column_config.NumberColumn(min_value=1, max_value=5, step=1) for c in ("impacto", "esfuerzo", "riesgo")}
                    cfg["score"] = st.column_config.NumberColumn(disabled=True)
                    ed = editor(prev["df"], "ed_brechas_prev", column_config=cfg, hide_index=True, num_rows="delete")
                    if st.button("💾 Guardar brechas propuestas", type="primary"):
                        alta, media = float(db.param("PRIORIDAD_ALTA", "75")), float(db.param("PRIORIDAD_MEDIA", "55"))
                        with db.get_conn() as conn:
                            for r in ed.to_dict("records"):
                                s = ia.score(r["impacto"], r["esfuerzo"], r["riesgo"])
                                bid = db.siguiente_id("brecha", "brecha_id", "BR-")
                                db.guardar("brecha", {**r, "brecha_id": bid, "org_id": oid, "version_asis_id": va,
                                                      "version_tobe_id": vt, "score": s, "prioridad": ia.prioridad(s, alta, media)},
                                           usuario(), conn)
                                conn.commit()
                        st.session_state.pop("brechas_prev", None)
                        avisar("success", f"{len(ed)} brecha(s) registradas.")
                        st.rerun()
        st.markdown("#### Brechas registradas")
        br = db.q("SELECT * FROM brecha WHERE org_id=? ORDER BY score DESC", (oid,))
        if puede("pmo") and not br.empty:
            cfg = config_columnas("brecha")
            cfg["score"] = st.column_config.ProgressColumn(min_value=0, max_value=100, format="%.0f")
            for ccol in ("brecha_id", "org_id", "version_asis_id", "version_tobe_id", "prioridad"):
                cfg[ccol] = st.column_config.TextColumn(disabled=True)
            ed = editor(br, f"ed_br_{oid}", column_config=cfg, hide_index=True)
            if st.button("💾 Guardar cambios en brechas (recalcula score)"):
                ed = ed.copy()
                alta, media = float(db.param("PRIORIDAD_ALTA", "75")), float(db.param("PRIORIDAD_MEDIA", "55"))
                ed["score"] = [ia.score(i, e, r) for i, e, r in zip(ed["impacto"], ed["esfuerzo"], ed["riesgo"])]
                ed["prioridad"] = ed["score"].map(lambda s: ia.prioridad(s, alta, media))
                n, errs = guardar_editor("brecha", br, ed)
                mostrar_resultado_guardado(n, errs)
                st.rerun()
        else:
            st.dataframe(br, hide_index=True)
        sin_p = br[(br["proyecto_id"].isna()) & (br["justificacion"].fillna("") == "")] if not br.empty else br
        if puede("pmo") and not sin_p.empty:
            st.markdown("#### Convertir brecha en proyecto")
            bsel = st.selectbox("Brecha sin proyecto ni justificación", sin_p["brecha_id"],
                                format_func=lambda b: f"{b} · {sin_p.set_index('brecha_id').loc[b, 'to_be']}")
            if st.button("🤖 Generar proyecto propuesto con IA"):
                b = sin_p.set_index("brecha_id").loc[bsel].to_dict()
                prop = ia.proponer_proyecto(b, org)
                pid = db.siguiente_id("proyecto", "proyecto_id", "P-")
                kpi_s, tareas = prop.pop("_kpi_sugerido"), prop.pop("_tareas")
                with db.get_conn() as conn:
                    db.guardar("proyecto", {**prop, "proyecto_id": pid, "org_id": oid, "brecha_id": bsel}, usuario(), conn)
                    kid = db.siguiente_id("kpi", "kpi_id", "K-")
                    db.guardar("kpi", {"kpi_id": kid, "org_id": oid, "proyecto_id": pid, "nombre": kpi_s["nombre"],
                                       "formula": "Definir fórmula", "unidad": kpi_s["unidad"], "frecuencia": "Mensual",
                                       "tolerancia_pct": 5, "sentido": "Menor es mejor" if "merma" in kpi_s["nombre"].lower()
                                       or "retrabajo" in kpi_s["nombre"].lower() else "Mayor es mejor",
                                       "dueno": prop["responsable"], "fuente": "Por definir"}, usuario(), conn)
                    conn.execute("UPDATE proyecto SET kpi_principal=? WHERE proyecto_id=?", (kid, pid))
                    conn.execute("UPDATE brecha SET proyecto_id=? WHERE brecha_id=?", (pid, bsel))
                    for h in ia.proponer_hitos(pid, tareas, prop["fecha_inicio"], prop["fecha_fin"], prop["responsable"]):
                        db.guardar("hito", h, usuario(), conn)
                    db.auditar(conn, usuario(), "brecha", bsel, "VINCULAR_PROYECTO", None, {"proyecto_id": pid})
                db.registrar_ia(oid, "proponer_proyecto", "Local", b, prop, usuario())
                avisar("success", f"Proyecto {pid} propuesto con KPI {kid} e hitos. Revise y apruebe en la pestaña Proyectos.")
                st.rerun()
    with t2:
        pr = db.q("SELECT * FROM proyecto WHERE org_id=? ORDER BY proyecto_id", (oid,))
        if pr.empty:
            st.info("No hay proyectos.")
        else:
            if puede("pmo"):
                cfg = config_columnas("proyecto")
                for ccol in ("proyecto_id", "org_id", "aprobado_por", "fecha_aprobacion", "estado"):
                    cfg[ccol] = st.column_config.TextColumn(disabled=True)
                ed = editor(pr, f"ed_pr_{oid}", column_config=cfg, hide_index=True)
                if st.button("💾 Guardar cambios en proyectos"):
                    n, errs = guardar_editor("proyecto", pr, ed)
                    mostrar_resultado_guardado(n, errs)
                    st.rerun()
            else:
                st.dataframe(pr, hide_index=True)
            st.markdown("#### Aprobación de proyectos")
            pend = pr[pr["estado"] == "Propuesto"]
            if pend.empty:
                st.success("No hay proyectos pendientes de aprobación.")
            else:
                psel = st.selectbox("Proyecto propuesto", pend["proyecto_id"],
                                    format_func=lambda p: f"{p} · {pend.set_index('proyecto_id').loc[p, 'nombre']}")
                fila = pend.set_index("proyecto_id").loc[psel]
                st.markdown(f"**Objetivo:** {fila['objetivo']}  \n**Presupuesto:** S/ {fila['presupuesto_pen']:,.0f} · "
                            f"**Plazo:** {fila['fecha_inicio']} → {fila['fecha_fin']} · **Responsable:** {fila['responsable']}  \n"
                            f"**Criterio de parada:** {fila['criterio_parada']}")
                c1, c2 = st.columns(2)
                if c1.button("✅ Aprobar proyecto", type="primary", disabled=not puede("aprobar")):
                    db.ejecutar("UPDATE proyecto SET estado='Aprobado', aprobado_por=?, fecha_aprobacion=? WHERE proyecto_id=?",
                                (usuario(), date.today().isoformat(), psel), usuario(), "proyecto", psel, "APROBAR", {"estado": "Aprobado"})
                    n = crear_plan_avance(db.q1("SELECT * FROM proyecto WHERE proyecto_id=?", (psel,)))
                    avisar("success", f"Proyecto {psel} aprobado. Se generó el plan de avance de {n} meses; ya aparece en Seguimiento.")
                    st.rerun()
                if c2.button("⛔ Rechazar proyecto", disabled=not puede("aprobar")):
                    db.ejecutar("UPDATE proyecto SET estado='Rechazado' WHERE proyecto_id=?", (psel,), usuario(),
                                "proyecto", psel, "RECHAZAR", {"estado": "Rechazado"})
                    avisar("warning", f"Proyecto {psel} rechazado.")
                    st.rerun()
                if not puede("aprobar"):
                    st.caption("Solo Gerente o Administrador pueden aprobar proyectos.")
    with t3:
        br = db.q("SELECT * FROM brecha WHERE org_id=?", (oid,))
        if br.empty:
            st.info("Sin brechas.")
        else:
            br["etiqueta"] = br["brecha_id"] + " " + br["bloque"]
            fig = px.scatter(br, x="esfuerzo", y="impacto", size="score", color="prioridad", text="etiqueta",
                             hover_data=["to_be", "riesgo", "score", "proyecto_id"],
                             color_discrete_map={"Alta": "#DC2626", "Media": "#F59E0B", "Baja": "#16A34A"},
                             range_x=[0.5, 5.5], range_y=[0.5, 5.5], title="Impacto vs esfuerzo (tamaño = score)")
            fig.update_traces(textposition="top center")
            fig.add_shape(type="rect", x0=0.5, x1=3, y0=3, y1=5.5, fillcolor="#16A34A", opacity=0.06, line_width=0)
            fig.add_annotation(x=1.2, y=5.3, text="Victorias rápidas", showarrow=False, font=dict(color="#16A34A"))
            st.plotly_chart(figura_base(fig, 460), key="fig_prior")


# ----------------------------------------------------------------------------
# 5. Gantt
# ----------------------------------------------------------------------------
def pagina_gantt(org: dict | None) -> None:
    hero("5. Diagrama de Gantt", "Propuesta automática · edición · control de versiones · aprobación")
    if org is None:
        st.info("Seleccione una organización.")
        return
    oid = org["org_id"]
    pr = db.q("SELECT * FROM proyecto WHERE org_id=? AND estado NOT IN ('Cancelado','Rechazado') ORDER BY proyecto_id", (oid,))
    if pr.empty:
        st.info("No hay proyectos para planificar.")
        return
    sel = st.multiselect("Proyectos", pr["proyecto_id"].tolist(), default=pr["proyecto_id"].tolist(),
                         format_func=lambda p: f"{p} · {pr.set_index('proyecto_id').loc[p, 'nombre'][:50]}")
    if not sel:
        return
    ph = ",".join("?" * len(sel))
    hitos = db.q(f"SELECT h.*, p.nombre AS proyecto FROM hito h JOIN proyecto p ON p.proyecto_id=h.proyecto_id "
                 f"WHERE h.proyecto_id IN ({ph}) ORDER BY h.proyecto_id, h.fecha_inicio", sel)
    sin_hitos = [p for p in sel if p not in set(hitos["proyecto_id"])]
    c1, c2 = st.columns(2)
    if sin_hitos and puede("pmo"):
        if c1.button(f"🤖 Proponer Gantt con IA para {len(sin_hitos)} proyecto(s) sin cronograma", type="primary"):
            with db.get_conn() as conn:
                for p in sin_hitos:
                    fila = pr.set_index("proyecto_id").loc[p].to_dict()
                    bloque = (db.q1("SELECT bloque FROM brecha WHERE brecha_id=?", (fila.get("brecha_id"),)) or {}).get("bloque", "AC")
                    tareas = ia.PLANTILLA_PROYECTO.get(bloque, ia.PLANTILLA_PROYECTO["AC"])[4]
                    for h in ia.proponer_hitos(p, tareas, fila["fecha_inicio"], fila["fecha_fin"], fila["responsable"]):
                        db.guardar("hito", h, usuario(), conn)
            db.registrar_ia(oid, "proponer_gantt", "Local", sin_hitos, {"proyectos": sin_hitos}, usuario())
            avisar("success", "Cronograma propuesto. Revíselo y apruébelo.")
            st.rerun()
    propuestos = pr[(pr["proyecto_id"].isin(sel)) & (pr["estado"] == "Propuesto")]
    if not propuestos.empty and puede("pmo"):
        if c2.button("🤖 Re-secuenciar proyectos propuestos (capacidad 2 en paralelo)"):
            br = db.q("SELECT brecha_id, score FROM brecha WHERE org_id=?", (oid,)).set_index("brecha_id")["score"].to_dict()
            plan = ia.proponer_gantt([{**r, "score": br.get(r["brecha_id"], 0)} for r in propuestos.to_dict("records")])
            with db.get_conn() as conn:
                for p in plan:
                    viejo = pr.set_index("proyecto_id").loc[p["proyecto_id"]]
                    delta = date.fromisoformat(p["fecha_inicio"]) - date.fromisoformat(viejo["fecha_inicio"])
                    db.guardar("proyecto", {"proyecto_id": p["proyecto_id"], "fecha_inicio": p["fecha_inicio"],
                                            "fecha_fin": p["fecha_fin"]}, usuario(), conn)
                    for h in db.q("SELECT * FROM hito WHERE proyecto_id=?", (p["proyecto_id"],)).to_dict("records"):
                        h["fecha_inicio"] = (date.fromisoformat(h["fecha_inicio"]) + delta).isoformat()
                        h["fecha_fin"] = (date.fromisoformat(h["fecha_fin"]) + delta).isoformat()
                        h["estado_aprobacion"] = "Propuesto"
                        db.guardar("hito", h, usuario(), conn)
            avisar("success", "Proyectos propuestos re-secuenciados.")
            st.rerun()
    if hitos.empty:
        st.info("Los proyectos seleccionados no tienen hitos.")
        return
    g = hitos.copy()
    g["Tarea"] = g["proyecto_id"] + " · " + g["tarea"]
    g["inicio"] = pd.to_datetime(g["fecha_inicio"])
    g["fin"] = pd.to_datetime(g["fecha_fin"]) + pd.Timedelta(days=1)
    g["Estado"] = g["estado_aprobacion"]
    g["Avance real"] = g["avance_real_pct"].fillna(0).map(lambda v: f"{v:.0f} %")
    fig = px.timeline(g, x_start="inicio", x_end="fin", y="Tarea", color="Estado",
                      color_discrete_map={"Aprobado": AZUL2, "Propuesto": "#F59E0B", "Rechazado": "#DC2626"},
                      hover_data=["responsable", "fecha_inicio", "fecha_fin", "Avance real", "dependencia", "version_gantt"])
    fig.update_yaxes(autorange="reversed", title=None)
    fig.update_layout(title="Cronograma de implementación de proyectos del Canvas TO BE")
    hoy = pd.Timestamp(date.today())
    fig.add_shape(type="line", x0=hoy, x1=hoy, y0=0, y1=1, yref="paper", line=dict(color="#DC2626", dash="dot"))
    fig.add_annotation(x=hoy, y=1.02, yref="paper", text="Hoy", showarrow=False, font=dict(color="#DC2626"))
    st.plotly_chart(figura_base(fig, max(360, 26 * len(g) + 120)), key="fig_gantt")

    st.markdown("#### Editar y aprobar cronograma por proyecto")
    p_ed = st.selectbox("Proyecto a editar", sel, key="gantt_ed_p")
    hp = db.q("SELECT * FROM hito WHERE proyecto_id=? ORDER BY fecha_inicio", (p_ed,))
    version = int(hp["version_gantt"].max()) if not hp.empty else 0
    aprobados = (hp["estado_aprobacion"] == "Aprobado").all() if not hp.empty else False
    st.caption(f"Versión del Gantt: {version} · Estado: {'✅ Aprobado' if aprobados else '🟡 Pendiente de aprobación'}")
    if puede("pmo"):
        cfg = config_columnas("hito")
        cfg["fecha_inicio"] = st.column_config.TextColumn(help="AAAA-MM-DD")
        cfg["fecha_fin"] = st.column_config.TextColumn(help="AAAA-MM-DD")
        for ccol in ("proyecto_id", "estado_aprobacion", "version_gantt"):
            cfg[ccol] = st.column_config.TextColumn(disabled=True)
        base = hp if not hp.empty else pd.DataFrame(columns=db.columnas("hito"))
        ed = editor(base, f"ed_h_{p_ed}", num_rows="dynamic", column_config=cfg, hide_index=True)
        b = st.columns(3)
        if b[0].button("💾 Guardar como nueva versión del Gantt"):
            ed = ed.copy()
            cambiados = []
            orig = hp.set_index("hito_id").to_dict("index") if not hp.empty else {}
            for r in ed.to_dict("records"):
                o = orig.get(r.get("hito_id"))
                campos = ("tarea", "responsable", "fecha_inicio", "fecha_fin", "dependencia", "peso_pct")
                if o is None or any(str(db._limpio(r.get(k))) != str(db._limpio(o.get(k))) for k in campos):
                    cambiados.append(r.get("hito_id"))
            ed["version_gantt"] = version + 1 if cambiados else version
            ed["estado_aprobacion"] = ed.apply(lambda r: "Propuesto" if r["hito_id"] in cambiados or pd.isna(r["hito_id"])
                                               else r["estado_aprobacion"], axis=1)
            cont = {"n": len(hp)}

            def gen(_f):
                cont["n"] += 1
                return {"hito_id": f"{p_ed}-H{cont['n']}"}

            n, errs = guardar_editor("hito", hp, ed, {"proyecto_id": p_ed, "avance_plan_pct": 0, "avance_real_pct": 0}, gen)
            mostrar_resultado_guardado(n, errs)
            st.rerun()
        if b[1].button("✅ Aprobar Gantt", type="primary", disabled=not puede("aprobar") or hp.empty):
            db.ejecutar("UPDATE hito SET estado_aprobacion='Aprobado' WHERE proyecto_id=?", (p_ed,), usuario(), "hito",
                        p_ed, "APROBAR_GANTT", {"version": version})
            avisar("success", f"Gantt de {p_ed} (versión {version}) aprobado.")
            st.rerun()
        if b[2].button("⛔ Rechazar Gantt", disabled=not puede("aprobar") or hp.empty):
            db.ejecutar("UPDATE hito SET estado_aprobacion='Rechazado' WHERE proyecto_id=?", (p_ed,), usuario(), "hito",
                        p_ed, "RECHAZAR_GANTT", {"version": version})
            avisar("warning", f"Gantt de {p_ed} rechazado: edítelo y guarde una nueva versión.")
            st.rerun()
    else:
        st.dataframe(hp, hide_index=True)


# ----------------------------------------------------------------------------
# 6. Seguimiento y control
# ----------------------------------------------------------------------------
def alertas_org(oid: str) -> pd.DataFrame:
    al = []
    port = rp.portafolio(oid)
    for r in port.to_dict("records"):
        if r["semaforo"] in ("Rojo", "Ámbar"):
            al.append({"Nivel": semaforo_txt(r["semaforo"]), "Tipo": "Proyecto", "Objeto": r["proyecto_id"],
                       "Detalle": f"SPI {fnum(r['spi'], '', 2)} · CPI {fnum(r['cpi'], '', 2)} · {r['nombre']}"})
    hoy = date.today().isoformat()
    for h in db.q("""SELECT h.* FROM hito h JOIN proyecto p ON p.proyecto_id=h.proyecto_id WHERE p.org_id=?
                     AND p.estado IN ('Aprobado','En ejecución') AND h.fecha_fin<? AND IFNULL(h.avance_real_pct,0)<100""",
                  (oid, hoy)).to_dict("records"):
        al.append({"Nivel": "🟡 Ámbar", "Tipo": "Hito vencido", "Objeto": h["hito_id"],
                   "Detalle": f"{h['tarea']} (fin {h['fecha_fin']}, avance {h['avance_real_pct'] or 0:.0f} %)"})
    for r in db.q("""SELECT r.* FROM riesgo r JOIN proyecto p ON p.proyecto_id=r.proyecto_id WHERE p.org_id=?
                     AND r.estado<>'Cerrado' AND r.probabilidad*r.impacto>=12""", (oid,)).to_dict("records"):
        al.append({"Nivel": "🔴 Rojo" if r["estado"] == "Materializado" else "🟡 Ámbar", "Tipo": "Riesgo alto",
                   "Objeto": r["riesgo_id"], "Detalle": f"{r['descripcion']} (P×I = {r['probabilidad'] * r['impacto']}, {r['estado']})"})
    for h in db.q("SELECT * FROM hipotesis WHERE org_id=? AND estado='Pendiente' AND fecha_limite<?", (oid, hoy)).to_dict("records"):
        al.append({"Nivel": "🟡 Ámbar", "Tipo": "Hipótesis vencida", "Objeto": h["hip_id"], "Detalle": h["enunciado"]})
    return pd.DataFrame(al)


def pagina_seguimiento(org: dict | None) -> None:
    hero("6. Seguimiento y control", "Proyectos aprobados del Canvas TO BE · avance físico y financiero · SPI/CPI · riesgos · hipótesis · alertas")
    if org is None:
        st.info("Seleccione una organización.")
        return
    oid = org["org_id"]
    port = rp.portafolio(oid)
    t1, t2, t3, t4 = st.tabs(["📋 Portafolio", "📌 Detalle del proyecto", "⚠️ Riesgos e hipótesis", "🚨 Alertas"])
    with t1:
        if port.empty:
            st.info("No hay proyectos aprobados. Apruebe proyectos en 4. Brechas y proyectos.")
        else:
            v = port[["proyecto_id", "nombre", "estado", "responsable", "presupuesto_pen", "periodo_corte", "avance_plan",
                      "avance_real", "costo_real", "spi", "cpi", "riesgos_altos", "semaforo"]].copy()
            v["semaforo"] = v["semaforo"].map(semaforo_txt)
            st.dataframe(v, hide_index=True, column_config={
                "presupuesto_pen": st.column_config.NumberColumn("Presupuesto", format="S/ %,.0f"),
                "costo_real": st.column_config.NumberColumn("Costo real", format="S/ %,.0f"),
                "avance_plan": st.column_config.ProgressColumn("Avance plan", min_value=0, max_value=100, format="%.1f %%"),
                "avance_real": st.column_config.ProgressColumn("Avance real", min_value=0, max_value=100, format="%.1f %%"),
                "spi": st.column_config.NumberColumn("SPI", format="%.2f"),
                "cpi": st.column_config.NumberColumn("CPI", format="%.2f"),
                "semaforo": "Semáforo", "periodo_corte": "Corte", "riesgos_altos": "Riesgos altos"})
            st.caption("SPI = avance real / avance plan · CPI = valor ganado / costo real · Verde ≥ 0,95 · Ámbar ≥ 0,85 · Rojo < 0,85")
    with t2:
        pr = db.q("SELECT * FROM proyecto WHERE org_id=? AND estado IN ('Aprobado','En ejecución','En pausa','Cerrado') ORDER BY proyecto_id", (oid,))
        if pr.empty:
            st.info("Sin proyectos aprobados.")
        else:
            pid = st.selectbox("Proyecto", pr["proyecto_id"], format_func=lambda p: f"{p} · {pr.set_index('proyecto_id').loc[p, 'nombre']}")
            p = {k: db._limpio(x) for k, x in pr.set_index("proyecto_id").loc[pid].to_dict().items()}
            fila = port.set_index("proyecto_id").loc[pid].to_dict() if pid in set(port["proyecto_id"]) else {}
            c = st.columns(5)
            c[0].metric("Semáforo", semaforo_txt(fila.get("semaforo")))
            c[1].metric("Avance real", fnum(fila.get("avance_real"), "%"), f"plan {fnum(fila.get('avance_plan'), '%')}", delta_color="off")
            c[2].metric("SPI", fnum(fila.get("spi"), "", 2))
            c[3].metric("CPI", fnum(fila.get("cpi"), "", 2))
            c[4].metric("Costo real", fnum(fila.get("costo_real"), "S/"), f"de {fnum(p['presupuesto_pen'], 'S/')}", delta_color="off")
            av = db.q("SELECT * FROM avance_mensual WHERE proyecto_id=? ORDER BY periodo", (pid,))
            if not av.empty:
                g1, g2 = st.columns(2)
                f1 = go.Figure()
                f1.add_trace(go.Scatter(x=av["periodo"], y=av["avance_plan_pct"], name="Proyectado", line=dict(dash="dash", color="#9CA3AF")))
                f1.add_trace(go.Scatter(x=av["periodo"], y=av["avance_real_pct"], name="Real", line=dict(color=AZUL2, width=3)))
                f1.update_layout(title="Avance físico acumulado (%)")
                g1.plotly_chart(figura_base(f1, 320), key=f"f1_{pid}")
                f2 = go.Figure()
                f2.add_trace(go.Bar(x=av["periodo"], y=av["costo_plan_pen"], name="Proyectado", marker_color="#9CA3AF"))
                f2.add_trace(go.Bar(x=av["periodo"], y=av["costo_real_pen"], name="Real", marker_color=AZUL))
                f2.update_layout(title="Costo acumulado (S/)", barmode="group")
                g2.plotly_chart(figura_base(f2, 320), key=f"f2_{pid}")
            if puede("pmo"):
                with st.form(f"av_{pid}"):
                    st.markdown("**Registrar avance del mes**")
                    cc = st.columns(4)
                    per = cc[0].text_input("Periodo (AAAA-MM)", value=date.today().strftime("%Y-%m"))
                    ar = cc[1].number_input("Avance real acumulado (%)", 0.0, 100.0, float(fila.get("avance_real") or 0))
                    cr = cc[2].number_input("Costo real acumulado (S/)", 0.0, value=float(fila.get("costo_real") or 0), step=500.0)
                    est = cc[3].selectbox("Estado del proyecto", ["Aprobado", "En ejecución", "En pausa", "Cerrado", "Cancelado"],
                                          index=["Aprobado", "En ejecución", "En pausa", "Cerrado", "Cancelado"].index(p["estado"])
                                          if p["estado"] in ("Aprobado", "En ejecución", "En pausa", "Cerrado", "Cancelado") else 1)
                    com = st.text_input("Comentario / evidencia")
                    if st.form_submit_button("💾 Registrar", type="primary"):
                        previo = db.q1("SELECT * FROM avance_mensual WHERE proyecto_id=? AND periodo=?", (pid, per)) or {}
                        fila_av = {"proyecto_id": pid, "periodo": per, "avance_real_pct": ar, "costo_real_pen": cr,
                                   "avance_plan_pct": previo.get("avance_plan_pct"), "costo_plan_pen": previo.get("costo_plan_pen"),
                                   "comentario": com or previo.get("comentario")}
                        with db.get_conn() as conn:
                            errs = db.validar_fila("avance_mensual", fila_av, conn)
                        if errs:
                            st.error("; ".join(errs))
                        else:
                            db.guardar("avance_mensual", fila_av, usuario())
                            if est != p["estado"]:
                                db.guardar("proyecto", {"proyecto_id": pid, "estado": est}, usuario())
                            avisar("success", f"Avance de {per} registrado.")
                            st.rerun()
                st.markdown("**Avance de hitos**")
                hp = db.q("SELECT hito_id, tarea, fecha_inicio, fecha_fin, avance_real_pct, estado_aprobacion FROM hito "
                          "WHERE proyecto_id=? ORDER BY fecha_inicio", (pid,))
                if not hp.empty:
                    cfg = {c: st.column_config.TextColumn(disabled=True) for c in ("hito_id", "tarea", "fecha_inicio", "fecha_fin", "estado_aprobacion")}
                    cfg["avance_real_pct"] = st.column_config.NumberColumn("Avance real %", min_value=0, max_value=100)
                    ed = editor(hp, f"ed_hav_{pid}", column_config=cfg, hide_index=True)
                    if st.button("💾 Guardar avance de hitos", key=f"ghav_{pid}"):
                        n = 0
                        for r in ed.to_dict("records"):
                            if db.guardar("hito", {"hito_id": r["hito_id"], "avance_real_pct": r["avance_real_pct"]}, usuario()) != "SIN CAMBIOS":
                                n += 1
                        avisar("success", f"{n} hito(s) actualizados.")
                        st.rerun()
                with st.expander("Tabla completa de avance mensual (plan y real)"):
                    cfg = config_columnas("avance_mensual")
                    ed2 = editor(av, f"ed_avm_{pid}", column_config=cfg, hide_index=True, num_rows="dynamic")
                    if st.button("💾 Guardar tabla de avance", key=f"gavm_{pid}"):
                        n, errs = guardar_editor("avance_mensual", av, ed2, {"proyecto_id": pid})
                        mostrar_resultado_guardado(n, errs)
                        st.rerun()
    with t3:
        st.markdown("#### Riesgos de los proyectos")
        rg = db.q("SELECT r.* FROM riesgo r JOIN proyecto p ON p.proyecto_id=r.proyecto_id WHERE p.org_id=? ORDER BY r.riesgo_id", (oid,))
        if not rg.empty:
            rg["nivel"] = rg["probabilidad"] * rg["impacto"]
        if puede("pmo"):
            base = rg if not rg.empty else pd.DataFrame(columns=db.columnas("riesgo") + ["nivel"])
            cfg = config_columnas("riesgo")
            cfg["nivel"] = st.column_config.ProgressColumn("Nivel P×I", min_value=0, max_value=25, format="%d")
            cfg["probabilidad"] = st.column_config.NumberColumn(min_value=1, max_value=5, step=1)
            cfg["impacto"] = st.column_config.NumberColumn(min_value=1, max_value=5, step=1)
            ed = editor(base, f"ed_rg_{oid}", column_config=cfg, hide_index=True, num_rows="dynamic", disabled=["nivel"])
            if st.button("💾 Guardar riesgos"):
                n, errs = guardar_editor("riesgo", base.drop(columns=["nivel"]), ed.drop(columns=["nivel"]),
                                         generar_id=lambda f: {"riesgo_id": db.siguiente_id("riesgo", "riesgo_id", "R-")})
                mostrar_resultado_guardado(n, errs)
                st.rerun()
        else:
            st.dataframe(rg, hide_index=True)
        st.markdown("#### Hipótesis y su validación")
        hp = db.q("SELECT * FROM hipotesis WHERE org_id=? ORDER BY hip_id", (oid,))
        if puede("editar"):
            base = hp if not hp.empty else pd.DataFrame(columns=db.columnas("hipotesis"))
            cfg = config_columnas("hipotesis")
            cfg["org_id"] = st.column_config.TextColumn(disabled=True)
            ed = editor(base, f"ed_hip_{oid}", column_config=cfg, hide_index=True, num_rows="dynamic")
            if st.button("💾 Guardar hipótesis"):
                n, errs = guardar_editor("hipotesis", base, ed, {"org_id": oid},
                                         lambda f: {"hip_id": db.siguiente_id("hipotesis", "hip_id", "H-")})
                mostrar_resultado_guardado(n, errs)
                st.rerun()
        else:
            st.dataframe(hp, hide_index=True)
    with t4:
        al = alertas_org(oid)
        if al.empty:
            st.success("Sin alertas activas.")
        else:
            st.markdown(f"**{len(al)}** alerta(s) activas")
            st.dataframe(al, hide_index=True)


# ----------------------------------------------------------------------------
# 7. Dashboard
# ----------------------------------------------------------------------------
def pagina_dashboard(org: dict | None) -> None:
    hero("7. Dashboard de seguimiento", "Proyectos del Canvas TO BE y KPI · real vs proyectado · predicción del mes +1")
    todas = st.toggle("Ver todas las organizaciones", value=False)
    oid = None if todas else (org or {}).get("org_id")
    if not todas and oid is None:
        st.info("Seleccione una organización.")
        return
    port = rp.portafolio(oid)
    c = st.columns(6)
    if port.empty:
        st.info("No hay proyectos aprobados.")
    else:
        c[0].metric("Proyectos", len(port), border=True)
        c[1].metric("Presupuesto", fnum(port["presupuesto_pen"].sum(), "S/"), border=True)
        c[2].metric("Costo real", fnum(port["costo_real"].fillna(0).sum(), "S/"), border=True)
        c[3].metric("SPI promedio", fnum(port["spi"].mean(), "", 2), border=True)
        c[4].metric("CPI promedio", fnum(port["cpi"].mean(), "", 2), border=True)
        c[5].metric("En rojo", int((port["semaforo"] == "Rojo").sum()), border=True)
        g1, g2 = st.columns([3, 2])
        d = port.melt(id_vars=["proyecto_id"], value_vars=["avance_plan", "avance_real"], var_name="Serie", value_name="Avance %")
        d["Serie"] = d["Serie"].map({"avance_plan": "Proyectado", "avance_real": "Real"})
        f = px.bar(d, x="proyecto_id", y="Avance %", color="Serie", barmode="group", title="Avance físico: real vs proyectado",
                   labels={"proyecto_id": "Proyecto"},
                   color_discrete_map={"Proyectado": "#9CA3AF", "Real": AZUL2})
        g1.plotly_chart(figura_base(f), key="dash_av")
        cnt = port["semaforo"].value_counts().reset_index()
        cnt.columns = ["Semáforo", "Proyectos"]
        f = px.pie(cnt, names="Semáforo", values="Proyectos", hole=0.55, color="Semáforo", color_discrete_map=SEM_COLOR,
                   title="Semáforo del portafolio")
        g2.plotly_chart(figura_base(f), key="dash_pie")
        g3, g4 = st.columns(2)
        f = px.scatter(port, x="spi", y="cpi", text="proyecto_id", color="semaforo", color_discrete_map=SEM_COLOR,
                       size="presupuesto_pen", title="Matriz SPI (plazo) vs CPI (costo)", hover_data=["nombre"],
                       labels={"spi": "SPI (plazo)", "cpi": "CPI (costo)", "semaforo": "Semáforo"})
        f.add_hline(y=1, line_dash="dot", line_color="#6B7280")
        f.add_vline(x=1, line_dash="dot", line_color="#6B7280")
        f.update_traces(textposition="top center")
        g3.plotly_chart(figura_base(f), key="dash_spi")
        d = port.melt(id_vars=["proyecto_id"], value_vars=["costo_plan", "costo_real"], var_name="Serie", value_name="S/")
        d["Serie"] = d["Serie"].map({"costo_plan": "Proyectado", "costo_real": "Real"})
        f = px.bar(d, x="proyecto_id", y="S/", color="Serie", barmode="group", title="Costo acumulado: real vs proyectado",
                   labels={"proyecto_id": "Proyecto"},
                   color_discrete_map={"Proyectado": "#9CA3AF", "Real": AZUL})
        g4.plotly_chart(figura_base(f), key="dash_cost")
    st.markdown("### Indicadores (KPI) y predicción del mes +1")
    orgs = [oid] if oid else db.q("SELECT org_id FROM organizacion")["org_id"].tolist()
    preds = pd.concat([rp.predicciones_org(o) for o in orgs], ignore_index=True) if orgs else pd.DataFrame()
    if preds.empty:
        st.info("No hay KPI con observaciones.")
        return
    kid = st.selectbox("KPI", preds["kpi_id"], format_func=lambda k: f"{k} · {preds.set_index('kpi_id').loc[k, 'kpi']}")
    p = preds.set_index("kpi_id").loc[kid]
    serie = db.q("SELECT periodo, valor_real, valor_plan FROM kpi_observacion WHERE kpi_id=? ORDER BY periodo", (kid,))
    f = go.Figure()
    f.add_trace(go.Scatter(x=serie["periodo"], y=serie["valor_plan"], name="Proyectado (plan)", line=dict(color="#9CA3AF", dash="dash")))
    f.add_trace(go.Scatter(x=serie["periodo"], y=serie["valor_real"], name="Real", line=dict(color=AZUL2, width=3)))
    if p["p50"] is not None and not pd.isna(p["p50"]):
        f.add_trace(go.Scatter(x=[p["periodo_objetivo"]], y=[p["p50"]], name="Predicción mes +1 (P50, P10–P90)", mode="markers",
                               marker=dict(size=13, color=SEM_COLOR.get(p["semaforo"], "#6B7280"), symbol="diamond"),
                               error_y=dict(type="data", symmetric=False, array=[p["p90"] - p["p50"]], arrayminus=[p["p50"] - p["p10"]])))
    if p["meta"] is not None and not pd.isna(p["meta"]):
        f.add_hline(y=p["meta"], line_dash="dot", line_color="#16A34A", annotation_text="Meta")
    f.update_layout(title=f"{kid} · {p['kpi']} ({p['unidad']})")
    k1, k2 = st.columns([3, 1])
    k1.plotly_chart(figura_base(f, 400), key="dash_kpi")
    with k2:
        st.metric("Último real", fnum(p["ultimo_real"], p["unidad"]))
        st.metric(f"Predicción {p['periodo_objetivo']} (P50)", fnum(p["p50"], p["unidad"]),
                  f"P10 {fnum(p['p10'], p['unidad'])} · P90 {fnum(p['p90'], p['unidad'])}", delta_color="off")
        st.metric("Semáforo", semaforo_txt(p["semaforo"]))
        st.caption(f"Modelo: {p['modelo']} · n = {p['n_obs']} · Confianza: {p['confianza']}")
    tabla = preds[["kpi_id", "kpi", "unidad", "ultimo_real", "p10", "p50", "p90", "plan_objetivo", "meta", "modelo", "n_obs", "semaforo"]].copy()
    tabla["semaforo"] = tabla["semaforo"].map(semaforo_txt)
    st.dataframe(tabla, hide_index=True, column_config={c: st.column_config.NumberColumn(format="%,.2f")
                                                          for c in ("ultimo_real", "p10", "p50", "p90", "plan_objetivo", "meta")})


# ----------------------------------------------------------------------------
# 8. Predicción y simulación
# ----------------------------------------------------------------------------
def pagina_prediccion(org: dict | None) -> None:
    hero("8. Predicción del mes +1 y simulación", "Jerarquía de modelos · backtesting walk-forward · campeón-retador · intervalos P10–P90 · abstención")
    if org is None:
        st.info("Seleccione una organización.")
        return
    oid = org["org_id"]
    esc = db.q("SELECT * FROM escenario WHERE org_id=? ORDER BY escenario_id", (oid,))
    opciones = ["(sin ajuste)"] + esc["escenario_id"].tolist()
    defecto = next((i for i, e in enumerate(opciones) if e.endswith("BAS")), 0)
    eid = st.selectbox("Escenario para la predicción", opciones, index=defecto,
                       format_func=lambda e: e if e == "(sin ajuste)" else f"{e} · {esc.set_index('escenario_id').loc[e, 'nombre']}")
    e = None
    if eid != "(sin ajuste)":
        e = esc.set_index("escenario_id").loc[eid].to_dict()
        e["escenario_id"] = eid
    preds = rp.predicciones_org(oid, e)
    t1, t2, t3, t4 = st.tabs(["🔮 Mes +1", "🔬 Detalle y backtesting", "🎲 Simulación multiperiodo", "🗂️ Publicadas"])
    with t1:
        if preds.empty:
            st.info("No hay KPI con observaciones.")
        else:
            v = preds[["kpi_id", "kpi", "unidad", "fecha_corte", "periodo_objetivo", "n_obs", "confianza", "modelo", "p10", "p50", "p90",
                       "plan_objetivo", "mae", "wape", "mejora_vs_naive", "semaforo", "advertencia"]].copy()
            v["semaforo"] = v["semaforo"].map(semaforo_txt)
            st.dataframe(v, hide_index=True, column_config={
                **{c: st.column_config.NumberColumn(format="%,.2f") for c in ("p10", "p50", "p90", "plan_objetivo", "mae")},
                "wape": st.column_config.NumberColumn("WAPE %", format="%.1f"),
                "mejora_vs_naive": st.column_config.NumberColumn("Mejora vs naive %", format="%.1f"),
                "advertencia": st.column_config.TextColumn(width="large")})
            st.caption("Reglas: < 6 obs. → escenario experto (Gris) · 6–17 → naive/media/tendencia · 18–35 → + Holt y estacional · "
                       "≥ 36 → + Holt-Winters y ensamble. Se publica el naive si el retador no lo supera.")
            if puede("editar") and st.button("📢 Publicar predicciones en la base de datos", type="primary"):
                with db.get_conn() as conn:
                    for r in preds.to_dict("records"):
                        conn.execute("""INSERT INTO prediccion(kpi_id, escenario_id, fecha_corte, periodo_objetivo, modelo, n_obs,
                                        p10, p50, p90, mae, wape, sesgo, mejora_vs_naive, semaforo, advertencia, dataset_hash)
                                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                                     (r["kpi_id"], eid if e else None, r["fecha_corte"], r["periodo_objetivo"], r["modelo"], r["n_obs"],
                                      r["p10"], r["p50"], r["p90"], r["mae"], r["wape"], r["sesgo"], r["mejora_vs_naive"],
                                      r["semaforo"], r["advertencia"], r["dataset_hash"]))
                    db.auditar(conn, usuario(), "prediccion", oid, "PUBLICAR", None, {"kpis": len(preds), "escenario": eid})
                avisar("success", f"{len(preds)} predicciones publicadas con fecha de corte, modelo, intervalo y hash del dataset.")
                st.rerun()
    with t2:
        if not preds.empty:
            kid = st.selectbox("KPI", preds["kpi_id"], key="pred_det", format_func=lambda k: f"{k} · {preds.set_index('kpi_id').loc[k, 'kpi']}")
            kpi = db.q1("SELECT * FROM kpi WHERE kpi_id=?", (kid,))
            serie = db.q("SELECT periodo, valor_real, valor_plan FROM kpi_observacion WHERE kpi_id=? ORDER BY periodo", (kid,))
            o = fc.predecir(serie, kpi, e, int(float(db.param("MIN_OBS_PREDICCION", "6"))))
            c = st.columns(4)
            c[0].metric("Modelo campeón", o["modelo"])
            c[1].metric("MAE backtesting", fnum(o["mae"], kpi["unidad"], 2))
            c[2].metric("Mejora vs naive", fnum(o["mejora_vs_naive"], "%"))
            c[3].metric("Semáforo", semaforo_txt(o["semaforo"]))
            st.info(o["advertencia"])
            if o["ranking"]:
                st.markdown("**Competencia de modelos (menor MAE gana)**")
                st.dataframe(pd.DataFrame(o["ranking"]), hide_index=True)
            if o["backtest"] is not None:
                bt = o["backtest"]
                f = go.Figure()
                f.add_trace(go.Scatter(x=serie["periodo"], y=serie["valor_real"], name="Real", line=dict(color="#111827")))
                f.add_trace(go.Scatter(x=bt["periodo"], y=bt["pronostico"], name="Pronóstico walk-forward", mode="lines+markers",
                                       line=dict(color="#F59E0B")))
                f.add_trace(go.Scatter(x=[o["periodo_objetivo"]], y=[o["p50"]], name="Mes +1", mode="markers",
                                       marker=dict(size=12, color=AZUL2, symbol="diamond"),
                                       error_y=dict(type="data", symmetric=False, array=[o["p90"] - o["p50"]],
                                                    arrayminus=[o["p50"] - o["p10"]])))
                f.update_layout(title="Backtesting sin fuga temporal y predicción del mes +1")
                st.plotly_chart(figura_base(f, 380), key="pred_bt")
            st.caption(f"Fecha de corte {o['fecha_corte']} · objetivo {o['periodo_objetivo']} · n = {o['n_obs']} · "
                       f"hash del dataset {o['dataset_hash']}")
    with t3:
        ui_simulacion(org, "pred")
    with t4:
        st.dataframe(db.q("""SELECT p.* FROM prediccion p JOIN kpi k ON k.kpi_id=p.kpi_id WHERE k.org_id=?
                             ORDER BY p.pred_id DESC""", (oid,)), hide_index=True)


# ----------------------------------------------------------------------------
# 9. Reportes
# ----------------------------------------------------------------------------
def pagina_reportes(org: dict | None) -> None:
    hero("9. Reportes", "PPTX automático de avance real vs proyectado · exportación Excel")
    if org is None:
        st.info("Seleccione una organización.")
        return
    oid = org["org_id"]
    esc = db.q("SELECT escenario_id, nombre FROM escenario WHERE org_id=?", (oid,))
    c1, c2 = st.columns(2)
    with c1:
        with st.container(border=True):
            st.markdown("#### 📊 Presentación PowerPoint")
            st.markdown("Incluye portada, resumen ejecutivo, una diapositiva por proyecto (gráficos editables de avance y costo, "
                        "KPI con predicción mes +1), tabla de predicciones, trazabilidad brecha→proyecto y conclusiones.")
            opciones = [None] + esc["escenario_id"].tolist()
            eid = st.selectbox("Escenario de predicción", opciones,
                               index=next((i for i, x in enumerate(opciones) if x and x.endswith("BAS")), 0),
                               format_func=lambda x: "(sin ajuste)" if x is None else f"{x} · {esc.set_index('escenario_id').loc[x, 'nombre']}")
            if st.button("⚙️ Generar PPTX", type="primary"):
                with st.spinner("Generando presentación..."):
                    datos, nombre = rp.generar_pptx(oid, usuario(), eid)
                st.session_state["pptx"] = (datos, nombre)
            if st.session_state.get("pptx"):
                datos, nombre = st.session_state["pptx"]
                st.success(f"Presentación generada: {nombre} (copia guardada en {db.BASE_DIR})")
                st.download_button("⬇️ Descargar PPTX", datos, nombre,
                                   "application/vnd.openxmlformats-officedocument.presentationml.presentation", type="primary")
    with c2:
        with st.container(border=True):
            st.markdown("#### 📗 Exportación Excel")
            st.markdown("Todas las tablas de la base de datos, incluidas predicciones, simulaciones y auditoría.")
            if st.button("📦 Preparar Excel"):
                st.session_state["export_xlsx"] = db.exportar_excel()
            if st.session_state.get("export_xlsx"):
                st.download_button("⬇️ Descargar Excel", st.session_state["export_xlsx"],
                                   f"CanvasModelIA_BD_{datetime.now():%Y%m%d_%H%M}.xlsx",
                                   "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    st.markdown("#### Historial de reportes")
    st.dataframe(db.q("SELECT * FROM reporte WHERE org_id=? ORDER BY reporte_id DESC", (oid,)), hide_index=True)


# ----------------------------------------------------------------------------
# 10. Trazabilidad y auditoría
# ----------------------------------------------------------------------------
def pagina_auditoria(org: dict | None) -> None:
    hero("10. Trazabilidad y auditoría", "Quién cambió qué, cuándo y con qué fuente · cadena de hash verificable")
    t1, t2, t3 = st.tabs(["🔗 Trazabilidad de un KPI", "📜 Registro de auditoría", "🤖 Uso de IA"])
    with t1:
        if org is None:
            st.info("Seleccione una organización.")
        else:
            kp = db.q("SELECT * FROM kpi WHERE org_id=?", (org["org_id"],))
            if kp.empty:
                st.info("Sin KPI.")
            else:
                kid = st.selectbox("KPI", kp["kpi_id"], format_func=lambda k: f"{k} · {kp.set_index('kpi_id').loc[k, 'nombre']}")
                k = kp.set_index("kpi_id").loc[kid].to_dict()
                pred = db.q1("SELECT * FROM prediccion WHERE kpi_id=? ORDER BY pred_id DESC LIMIT 1", (kid,))
                obs = db.q1("SELECT COUNT(*) n, MIN(periodo) i, MAX(CASE WHEN valor_real IS NOT NULL THEN periodo END) f "
                            "FROM kpi_observacion WHERE kpi_id=?", (kid,))
                proy = db.q1("SELECT * FROM proyecto WHERE proyecto_id=?", (k.get("proyecto_id"),)) if k.get("proyecto_id") else None
                br = db.q1("SELECT * FROM brecha WHERE brecha_id=?", (proy.get("brecha_id"),)) if proy and proy.get("brecha_id") else None
                el_to = db.q1("SELECT * FROM canvas_elemento WHERE version_id=? AND bloque=? AND descripcion=?",
                              (br["version_tobe_id"], br["bloque"], br["to_be"])) if br else None
                el_as = db.q1("SELECT * FROM canvas_elemento WHERE elemento_id=?", (el_to.get("elemento_origen_id"),)) if el_to and el_to.get("elemento_origen_id") else None
                carga = db.q1("SELECT * FROM carga_datos ORDER BY carga_id DESC LIMIT 1")
                pasos = [
                    ("🔮 Predicción publicada", f"{pred['periodo_objetivo']} · P50 {pred['p50']:,.2f} · {pred['modelo']} · {pred['semaforo']} · "
                                               f"dataset {pred['dataset_hash']} · {pred['creado_en']}" if pred else "Aún no publicada (menú 8)"),
                    ("📏 KPI", f"{kid} {k['nombre']} · meta {k['meta']} {k['unidad']} · dueño {k['dueno']} · fuente {k['fuente']}"),
                    ("🗓️ Observaciones", f"{obs['n']} periodos ({obs['i']} → último real {obs['f']})"),
                    ("📁 Proyecto", f"{proy['proyecto_id']} {proy['nombre']} · {proy['estado']} · aprobado por {proy['aprobado_por']} "
                                   f"{proy['fecha_aprobacion']}" if proy else "KPI organizacional sin proyecto"),
                    ("🧮 Brecha", f"{br['brecha_id']} · {br['bloque']} · {br['tipo_cambio']} · score {br['score']} ({br['prioridad']})" if br else "—"),
                    ("🎯 Elemento TO BE", f"{el_to['elemento_id']} · {el_to['descripcion']} · {el_to['naturaleza']} · origen {el_to['origen']} "
                                         f"· versión {el_to['version_id']}" if el_to else (f"{br['to_be']} (versión {br['version_tobe_id']})" if br else "—")),
                    ("📍 Elemento AS IS", f"{el_as['elemento_id']} · {el_as['descripcion']} · evidencia: {el_as['evidencia']} · fuente {el_as['fuente']}"
                                         if el_as else (br["as_is"] if br else "—")),
                    ("📥 Fuente de datos", f"Carga #{carga['carga_id']} {carga['archivo']} · SHA-256 {carga['hash_sha256'][:16]}… · {carga['fecha']}"
                                          if carga else "Registro manual"),
                ]
                for t, d in pasos:
                    st.markdown(f"<div class='cm-step'><b>{t}</b><br>{d}</div>", unsafe_allow_html=True)
                st.markdown("**Eventos de auditoría relacionados**")
                ids = [x for x in (kid, k.get("proyecto_id"), br and br["brecha_id"]) if x]
                ph = ",".join("?" * len(ids))
                st.dataframe(db.q(f"SELECT audit_id, fecha, usuario, entidad, entidad_id, accion FROM auditoria WHERE entidad_id IN ({ph}) "
                                  f"ORDER BY audit_id DESC", ids), hide_index=True)
    with t2:
        if st.button("🔐 Verificar integridad de la cadena de auditoría", type="primary"):
            ok, n, err = db.verificar_auditoria()
            if ok:
                st.success(f"Cadena íntegra: {n} eventos verificados (SHA-256 encadenado).")
            else:
                st.error(f"Cadena alterada en el evento {err}.")
        c1, c2 = st.columns(2)
        ent = c1.selectbox("Entidad", ["(todas)"] + db.q("SELECT DISTINCT entidad FROM auditoria ORDER BY 1")["entidad"].tolist())
        us = c2.selectbox("Usuario", ["(todos)"] + db.q("SELECT DISTINCT usuario FROM auditoria ORDER BY 1")["usuario"].dropna().tolist())
        sql, par = "SELECT * FROM auditoria WHERE 1=1", []
        if ent != "(todas)":
            sql += " AND entidad=?"
            par.append(ent)
        if us != "(todos)":
            sql += " AND usuario=?"
            par.append(us)
        st.dataframe(db.q(sql + " ORDER BY audit_id DESC LIMIT 1000", par), hide_index=True, height=450)
    with t3:
        st.dataframe(db.q("SELECT * FROM ia_ejecucion ORDER BY ia_id DESC"), hide_index=True)
        st.caption("Toda salida de IA se marca como 'IA / Hipótesis' y requiere revisión y aprobación humana (Ley 31814).")


# ----------------------------------------------------------------------------
# 11. Configuración
# ----------------------------------------------------------------------------
def pagina_configuracion() -> None:
    hero("11. Configuración", "Parámetros · usuarios · motor de IA · mantenimiento")
    t1, t2, t3, t4 = st.tabs(["⚙️ Parámetros", "👥 Usuarios", "🤖 Motor de IA", "🛠️ Mantenimiento"])
    with t1:
        pa = db.q("SELECT * FROM parametro ORDER BY clave")
        if puede("admin"):
            ed = editor(pa, "ed_param", hide_index=True, disabled=["clave"])
            if st.button("💾 Guardar parámetros"):
                n, errs = guardar_editor("parametro", pa, ed)
                mostrar_resultado_guardado(n, errs)
                st.rerun()
        else:
            st.dataframe(pa, hide_index=True)
    with t2:
        us = db.q("SELECT user_id, usuario, nombre, rol, org_id, activo FROM usuario ORDER BY user_id")
        st.dataframe(us, hide_index=True)
        if puede("admin"):
            with st.form("nuevo_usuario"):
                st.markdown("**Crear usuario o restablecer contraseña**")
                c = st.columns(4)
                u = c[0].text_input("Usuario")
                n = c[1].text_input("Nombre")
                r = c[2].selectbox("Rol", db.ROLES)
                p = c[3].text_input("Contraseña", type="password")
                if st.form_submit_button("💾 Guardar usuario"):
                    if not u or len(p) < 8:
                        st.error("Usuario obligatorio y contraseña de al menos 8 caracteres.")
                    else:
                        ex = db.q1("SELECT user_id FROM usuario WHERE usuario=?", (u,))
                        uid = ex["user_id"] if ex else db.siguiente_id("usuario", "user_id", "U")
                        db.guardar("usuario", {"user_id": uid, "usuario": u, "nombre": n or u, "rol": r,
                                               "pwd_hash": db.hash_password(p), "activo": 1}, usuario())
                        avisar("success", f"Usuario {u} guardado.")
                        st.rerun()
    with t3:
        on = db.param("IA_HABILITADA", "1") == "1"
        motor = db.param("IA_MOTOR", "Local")
        st.markdown("El **motor local** funciona sin internet (base de conocimiento sectorial + reglas). "
                    "El **motor LLM** es opcional: usa una API de modelo de lenguaje **sin motores de búsqueda**; "
                    "la clave se guarda solo en la sesión actual, nunca en la base de datos.")
        if puede("admin"):
            c1, c2 = st.columns(2)
            nuevo_on = c1.toggle("Asistente IA habilitado (kill switch)", value=on)
            nuevo_motor = c2.radio("Motor", ["Local", "LLM"], index=0 if motor == "Local" else 1, horizontal=True)
            if (nuevo_on != on) or (nuevo_motor != motor):
                db.guardar("parametro", {"clave": "IA_HABILITADA", "valor": "1" if nuevo_on else "0"}, usuario())
                db.guardar("parametro", {"clave": "IA_MOTOR", "valor": nuevo_motor}, usuario())
                st.rerun()
            if nuevo_motor == "LLM":
                cfg = st.session_state.get("llm_cfg", {})
                with st.form("llm"):
                    prov = st.selectbox("Proveedor", ["OpenAI compatible", "Anthropic"],
                                        index=0 if cfg.get("proveedor", "OpenAI compatible") == "OpenAI compatible" else 1)
                    url = st.text_input("URL del endpoint (vacío = predeterminado)", cfg.get("url", ""))
                    modelo = st.text_input("Modelo", cfg.get("modelo", ""))
                    key = st.text_input("Clave de API", type="password", value=cfg.get("api_key", ""))
                    if st.form_submit_button("Guardar en la sesión"):
                        st.session_state["llm_cfg"] = {"proveedor": prov, "url": url.strip(), "modelo": modelo.strip(), "api_key": key.strip()}
                        st.success("Configuración guardada para esta sesión.")
        else:
            st.write(f"Asistente IA: {'habilitado' if on else 'deshabilitado'} · Motor: {motor}")
    with t4:
        st.markdown(f"**Base de datos:** `{os.path.abspath(db.DB_PATH)}`  \n**Directorio de archivos:** `{os.path.abspath(db.BASE_DIR)}`  \n"
                    f"**Versión:** {VERSION_APP}")
        if puede("admin"):
            conf = st.checkbox("Confirmo que deseo borrar TODOS los datos y reiniciar la base de datos")
            if st.button("🗑️ Reiniciar base de datos", disabled=not conf):
                db.reiniciar_bd()
                for k in list(st.session_state.keys()):
                    if k != "user":
                        del st.session_state[k]
                avisar("success", "Base de datos reiniciada. Solo existe el usuario admin.")
                st.rerun()


# ----------------------------------------------------------------------------
# Principal
# ----------------------------------------------------------------------------
def main() -> None:
    db.init_db()
    if "user" not in st.session_state:
        pantalla_login()
        return
    st.markdown(CSS, unsafe_allow_html=True)
    orgs = db.q("SELECT org_id, razon_social FROM organizacion WHERE activo=1 ORDER BY org_id")
    with st.sidebar:
        st.markdown("## 🧭 CANVAS MODEL IA")
        st.caption("Modelamiento de negocios inteligente")
        if not orgs.empty:
            ids = orgs["org_id"].tolist()
            pend = st.session_state.pop("_org_pend", None)
            if pend in ids:
                st.session_state["org_id"] = pend
            if st.session_state.get("org_id") not in ids:
                st.session_state["org_id"] = ids[0]
            st.selectbox("Organización", ids, key="org_id",
                         format_func=lambda o: f"{o} · {orgs.set_index('org_id').loc[o, 'razon_social']}")
        else:
            st.session_state["org_id"] = None
        pagina = st.radio("Menú", MENU, key="menu", label_visibility="collapsed")
        st.divider()
        u = st.session_state["user"]
        st.markdown(f"👤 **{u['nombre']}**  \n{u['rol']}")
        if st.button("Cerrar sesión"):
            with db.get_conn() as conn:
                db.auditar(conn, u["usuario"], "sesion", u["usuario"], "LOGOUT")
            st.session_state.clear()
            st.rerun()
        st.caption(f"v{VERSION_APP} · UNI · GE803U")
    mensaje_pendiente()
    org = org_actual()
    try:
        {
            MENU[0]: lambda: pagina_inicio(org),
            MENU[1]: lambda: pagina_base_datos(org),
            MENU[2]: lambda: pagina_canvas(org, "AS IS"),
            MENU[3]: lambda: pagina_canvas(org, "TO BE"),
            MENU[4]: lambda: pagina_brechas(org),
            MENU[5]: lambda: pagina_gantt(org),
            MENU[6]: lambda: pagina_seguimiento(org),
            MENU[7]: lambda: pagina_dashboard(org),
            MENU[8]: lambda: pagina_prediccion(org),
            MENU[9]: lambda: pagina_reportes(org),
            MENU[10]: lambda: pagina_auditoria(org),
            MENU[11]: pagina_configuracion,
        }[pagina]()
    except Exception as ex:  # noqa: BLE001
        st.error(f"Ocurrió un error: {ex}")
        st.caption("El detalle técnico se muestra a continuación para soporte.")
        st.exception(ex)


main()
