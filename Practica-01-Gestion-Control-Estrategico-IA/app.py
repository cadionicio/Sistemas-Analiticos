# -*- coding: utf-8 -*-
"""
app.py - Punto de entrada de GESTIÓN Y CONTROL ESTRATÉGICO IA (Streamlit).

Ejecución como script (desde la carpeta Entregable):
    streamlit run app.py
Ejecución como EXE: 7_GCE_IA.exe (ver run_gce.py).
"""
import sys
sys.dont_write_bytecode = True  # carpeta única: no crear __pycache__ en Entregable/
import importlib

import streamlit as st

import config
import db
import ui
import vistas_base

st.set_page_config(page_title=config.APP_NOMBRE, page_icon="🎯", layout="wide",
                   initial_sidebar_state="expanded")
ui.estilos()

if config.ES_WEB:
    # Compatibilidad 8_GCE_IA.html (stlite): su Streamlit no usa pyarrow y st.data_editor
    # con key consulta el esquema arrow solo para la firma del widget; se entrega uno vacío.
    from types import SimpleNamespace
    import streamlit.elements.widgets.data_editor as _editor
    if not hasattr(_editor, "arrow_table"):
        _editor.arrow_table = SimpleNamespace(schema=())


@st.cache_resource(show_spinner=False)
def _inicializar_base() -> bool:
    db.inicializar()
    return True


_inicializar_base()

if "usuario" not in st.session_state:
    vistas_base.pagina_login()
    st.stop()


def _pagina(modulo: str, funcion: str, titulo: str, icono: str, url: str, defecto: bool = False) -> st.Page:
    """Registra una página. Si el módulo aún no existe (pasos siguientes), muestra 'en construcción'."""
    try:
        fn = getattr(importlib.import_module(modulo), funcion)
    except ModuleNotFoundError as ex:
        if ex.name != modulo:
            raise
        fn = None
    if fn is None:
        def fn(_t=titulo):
            ui.en_construccion(_t)
        fn.__name__ = f"pendiente_{url}"
    return st.Page(fn, title=titulo, icon=icono, url_path=url, default=defecto)


paginas = {
    "General": [
        _pagina("vistas_base", "pagina_inicio", "Inicio", ":material/home:", "inicio", defecto=True),
    ],
    "Formulación": [
        _pagina("vistas_plan", "pagina_plan", "Plan Estratégico", ":material/explore:", "plan"),
        _pagina("vistas_bsc", "pagina_bsc", "Mapa y BSC", ":material/account_tree:", "bsc"),
    ],
    "Ejecución y control": [
        _pagina("vistas_control", "pagina_seguimiento", "Seguimiento", ":material/task_alt:", "seguimiento"),
        _pagina("vistas_control", "pagina_dashboard", "Dashboard", ":material/monitoring:", "dashboard"),
        _pagina("vistas_control", "pagina_gantt", "Gantt", ":material/view_timeline:", "gantt"),
        _pagina("vistas_control", "pagina_simulador", "Simulador EVA", ":material/casino:", "simulador"),
        _pagina("vistas_control", "pagina_reportes", "Reportes PPT", ":material/slideshow:", "reportes"),
    ],
    "Administración": [
        _pagina("vistas_base", "pagina_base_datos", "Base de Datos", ":material/database:", "base-datos"),
        _pagina("vistas_base", "pagina_auditoria", "Auditoría", ":material/policy:", "auditoria"),
        _pagina("vistas_base", "pagina_configuracion", "Configuración", ":material/settings:", "configuracion"),
    ],
}

ui.marca_lateral()
navegacion = st.navigation(paginas, expanded=True)  # muestra todas las opciones del menú
ui.barra_lateral()
navegacion.run()
