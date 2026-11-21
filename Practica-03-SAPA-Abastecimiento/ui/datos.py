"""Capa de acceso a datos de la interfaz, con cache de Streamlit.

Streamlit reejecuta el script completo en cada interaccion del usuario. Sin
cache, mover un deslizador relanzaria todas las consultas de todos los paneles
y la aplicacion se sentiria pesada aunque el calculo sea trivial.

Dos caches distintas, y la diferencia importa:

*   `st.cache_resource` para el `DatabaseManager`: es un objeto con estado
    (conexiones por hilo) que debe existir UNA sola vez por proceso. Cachearlo
    como dato lo serializaria y romperia el patron Singleton.
*   `st.cache_data` para los DataFrames: se devuelven copias, de modo que un
    panel no puede modificar por accidente lo que otro esta leyendo.

Toda funcion cacheada recibe `id_corrida` como argumento explicito. Es la clave
de invalidacion: al ejecutarse una corrida nueva, la cache anterior deja de
usarse sin necesidad de limpiarla a mano.
"""

from __future__ import annotations

import pandas as pd
import streamlit as st

from db.db_manager import DatabaseManager, ErrorBaseDatos


@st.cache_resource(show_spinner=False)
def gestor() -> DatabaseManager:
    """Devuelve el Singleton de base de datos, uno por proceso."""
    return DatabaseManager()


def _df(sql: str, params: tuple = ()) -> pd.DataFrame:
    """Ejecuta una consulta devolviendo un DataFrame vacio ante error."""
    try:
        return gestor().consultar_df(sql, params)
    except ErrorBaseDatos:
        return pd.DataFrame()


# =============================================================================
# ESTADO DEL SISTEMA
# =============================================================================
@st.cache_data(ttl=20, show_spinner=False)
def estado_base() -> dict:
    """Diagnostico de la base: integridad, PRAGMAs y conteos."""
    try:
        return gestor().diagnostico()
    except ErrorBaseDatos as exc:
        return {"ok": False, "error": str(exc), "conteos": {}}


@st.cache_data(ttl=10, show_spinner=False)
def corridas(limite: int = 30) -> pd.DataFrame:
    """Historial de corridas del superagente, de la mas reciente a la mas antigua."""
    return _df(
        "SELECT id_corrida, fecha_corte, horizonte_meses, estado, usuario, "
        "       ts_inicio, ROUND(duracion_seg,2) AS duracion_seg "
        "FROM ejecuciones ORDER BY ts_inicio DESC, rowid DESC LIMIT ?;",
        (limite,),
    )


@st.cache_data(ttl=10, show_spinner=False)
def ultima_corrida_completa() -> str | None:
    """Ultima corrida que llego a producir canasta de compras.

    Se exige la existencia de canasta y no solo el estado de la corrida: una
    corrida puede cerrar como OBSERVADA sin haber llegado al agente
    prescriptivo, y la consola quedaria vacia sin explicacion.
    """
    v = _df(
        "SELECT e.id_corrida FROM ejecuciones e "
        "WHERE EXISTS (SELECT 1 FROM canasta_compras c WHERE c.id_corrida = e.id_corrida) "
        "ORDER BY e.ts_inicio DESC, e.rowid DESC LIMIT 1;"
    )
    return None if v.empty else str(v.iloc[0]["id_corrida"])


# =============================================================================
# MAESTROS Y SEGMENTACION
# =============================================================================
@st.cache_data(ttl=60, show_spinner=False)
def maestro_segmentado() -> pd.DataFrame:
    """Maestro de materiales con su valorizacion de consumo historico."""
    return _df(
        """
        SELECT  m.sku, m.descripcion, m.sector, m.categoria, m.clase_abc, m.clase_xyz,
                m.segmento_kraljic, m.criticidad_operativa, m.costo_unitario,
                m.score_impacto_economico, m.score_riesgo_suministro, m.cv_demanda,
                m.politica_rotacion, m.tipo_almacenamiento, m.compatible_gtp,
                m.vida_util_dias, m.volumen_m3_unidad, m.unidades_por_palet,
                COALESCE(SUM(d.demanda_atendida * m.costo_unitario), 0) AS consumo_valorizado,
                COALESCE(SUM(d.demanda_atendida), 0)                    AS unidades
        FROM    maestro_materiales m
        LEFT JOIN historico_demanda d ON d.sku = m.sku
        WHERE   m.activo = 1
        GROUP BY m.sku;
        """
    )


@st.cache_data(ttl=60, show_spinner=False)
def parametria_abastecimiento() -> pd.DataFrame:
    """Proveedor prioritario, precio, empaque y plazo por SKU."""
    return _df(
        """
        SELECT  sp.sku, sp.proveedor_id, p.razon_social, p.es_importado, p.otif_historico,
                sp.precio_unitario, sp.moq, sp.lote_multiplo,
                sp.lead_time_medio_dias, sp.lead_time_sigma_dias
        FROM    sku_proveedor sp
        JOIN    maestro_proveedores p ON p.proveedor_id = sp.proveedor_id
        WHERE   sp.homologado = 1 AND sp.prioridad = 1;
        """
    )


# =============================================================================
# DESCRIPTIVO Y DIAGNOSTICO
# =============================================================================
@st.cache_data(ttl=60, show_spinner=False)
def metricas(id_corrida: str, tipo: str | None = None) -> pd.DataFrame:
    """Metricas publicadas por los agentes en una corrida."""
    if tipo:
        return _df(
            "SELECT tipo_analisis, metrica, valor FROM resultados_analisis "
            "WHERE id_corrida = ? AND tipo_analisis = ?;", (id_corrida, tipo),
        )
    return _df(
        "SELECT tipo_analisis, metrica, valor FROM resultados_analisis "
        "WHERE id_corrida = ?;", (id_corrida,),
    )


def metrica(id_corrida: str, nombre: str, defecto: float = 0.0) -> float:
    """Devuelve el valor escalar de una metrica, o el valor por defecto."""
    df = metricas(id_corrida)
    if df.empty:
        return defecto
    fila = df[df["metrica"] == nombre]
    return defecto if fila.empty else float(fila.iloc[0]["valor"])


@st.cache_data(ttl=60, show_spinner=False)
def demanda_mensual(id_corrida: str) -> pd.DataFrame:
    """Serie mensual conciliada de la corrida."""
    return _df(
        "SELECT periodo, sku, unidades_atendidas, unidades_perdidas, "
        "       demanda_corregida, dias_censurados FROM demanda_mensual "
        "WHERE id_corrida = ? ORDER BY periodo;", (id_corrida,),
    )


@st.cache_data(ttl=60, show_spinner=False)
def causa_raiz() -> pd.DataFrame:
    """Atribucion de causa raiz de los retrasos de abastecimiento."""
    return _df("SELECT * FROM v_causa_raiz_retrasos ORDER BY dias_retraso_acumulados DESC;")


@st.cache_data(ttl=60, show_spinner=False)
def otif_proveedor() -> pd.DataFrame:
    """Desempeno de entrega por proveedor."""
    return _df("SELECT * FROM v_otif_proveedor ORDER BY otif ASC;")


@st.cache_data(ttl=60, show_spinner=False)
def hipotesis(id_corrida: str) -> pd.DataFrame:
    """Hallazgos del agente diagnostico con su naturaleza y evidencia."""
    return _df(
        "SELECT ambito, sku, hallazgo, naturaleza, impacto_valor, impacto_unidad, "
        "       evidencia, accion_sugerida, responsable FROM hipotesis_diagnostico "
        "WHERE id_corrida = ? ORDER BY naturaleza, ambito;", (id_corrida,),
    )


@st.cache_data(ttl=30, show_spinner=False)
def excepciones(id_corrida: str) -> pd.DataFrame:
    """Excepciones abiertas de la corrida, ordenadas por severidad."""
    return _df(
        "SELECT agente, severidad, codigo, sku, descripcion, accion_sugerida, responsable "
        "FROM excepciones_plan WHERE id_corrida = ? "
        "ORDER BY CASE severidad WHEN 'BLOQUEANTE' THEN 1 WHEN 'ALTA' THEN 2 "
        "WHEN 'MEDIA' THEN 3 ELSE 4 END, codigo;", (id_corrida,),
    )


# =============================================================================
# PREDICTIVO Y PRESCRIPTIVO
# =============================================================================
@st.cache_data(ttl=60, show_spinner=False)
def pronostico(id_corrida: str, escenario: str = "BASE") -> pd.DataFrame:
    """Pronostico publicado para un escenario."""
    return _df(
        "SELECT sku, periodo, horizonte, modelo, p10, p50, p90, sigma_residual, "
        "       intervalo_calibrado, validado FROM pronosticos "
        "WHERE id_corrida = ? AND escenario = ? ORDER BY sku, horizonte;",
        (id_corrida, escenario),
    )


@st.cache_data(ttl=60, show_spinner=False)
def validacion(id_corrida: str) -> pd.DataFrame:
    """Resultados de la validacion temporal por SKU y modelo."""
    return _df(
        "SELECT sku, modelo, tipo_corte, origen, n_observaciones, wape, mase, sesgo, "
        "       rmse, cobertura, es_referente, seleccionado, motivo_decision "
        "FROM validacion_modelos WHERE id_corrida = ?;", (id_corrida,),
    )


@st.cache_data(ttl=60, show_spinner=False)
def canasta(id_corrida: str, escenario: str = "BASE") -> pd.DataFrame:
    """Canasta de compras de 12 meses de un escenario."""
    return _df(
        "SELECT sku, proveedor_id, periodo, horizonte, demanda_plan, inventario_inicial, "
        "       recepcion_confirmada, stock_seguridad, necesidad_neta, compra_propuesta, "
        "       inventario_final, faltante, fecha_emision, fecha_recepcion, "
        "       emision_vencida, precio_unitario, costo_compra, volumen_m3, metodo_lote, "
        "       ajuste_presupuesto, nivel_riesgo, estado "
        "FROM canasta_compras WHERE id_corrida = ? AND escenario = ? "
        "ORDER BY periodo, sku;", (id_corrida, escenario),
    )


@st.cache_data(ttl=60, show_spinner=False)
def simulacion(id_corrida: str) -> pd.DataFrame:
    """Resultados de la simulacion Monte Carlo por escenario y metrica."""
    return _df(
        "SELECT escenario, metrica, unidad, n_iteraciones, media, p05, p50, p95, "
        "       minimo, maximo FROM simulacion_resultados WHERE id_corrida = ?;",
        (id_corrida,),
    )


@st.cache_data(ttl=60, show_spinner=False)
def historico_sku(sku: str) -> pd.DataFrame:
    """Serie mensual historica de un SKU, atendida y corregida por censura."""
    return _df(
        "SELECT substr(fecha,1,7) AS periodo, "
        "       SUM(demanda_atendida) AS atendida, "
        "       SUM(demanda_atendida + COALESCE(demanda_perdida_estimada,0)) AS corregida "
        "FROM historico_demanda WHERE sku = ? GROUP BY periodo ORDER BY periodo;",
        (sku,),
    )


def limpiar_cache() -> None:
    """Invalida toda la cache de datos tras una corrida nueva o una recarga."""
    st.cache_data.clear()
