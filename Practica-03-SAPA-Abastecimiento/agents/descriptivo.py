"""Agente de analisis descriptivo: que paso.

Primera fase del ciclo analitico. Su producto no son graficos sino una SERIE
MENSUAL CONCILIADA que el resto del sistema consume como unica version de la
verdad. Dos decisiones que condicionan todo lo que viene despues:

1.  Se agrega la DEMANDA CORREGIDA (atendida + perdida estimada), no la venta
    observada. Entrenar el pronostico sobre venta censurada perpetua el
    quiebre: el modelo aprende el limite del inventario, no el del mercado.

2.  El mes parcial se marca y se EXCLUYE del entrenamiento. Tratar un mes
    incompleto como cerrado introduce una caida artificial al final de toda
    serie, que los modelos con tendencia interpretan como declive real.
"""

from __future__ import annotations

import pandas as pd

from agents.core_agent import (
    AgenteEspecialista,
    ContextoEjecucion,
    ExcepcionPlan,
    ResultadoAgente,
    Severidad,
    TipoAnalisis,
)
from engine.calendario import dias_del_periodo


class AgenteDescriptivo(AgenteEspecialista):
    """Concilia la historia y publica los indicadores de lo ocurrido.

    Salidas:
        datos['demanda_mensual']: serie mensual por SKU, con marca de completitud.
        datos['kpi_sku']: indicadores por articulo para el tablero.
        metricas: agregados publicables en tiempo real.
    """

    nombre = "descriptivo"
    tipo_analisis = TipoAnalisis.DESCRIPTIVO
    dependencias = ("control_datos",)

    def _procesar(
        self, contexto: ContextoEjecucion, previos: dict[str, ResultadoAgente]
    ) -> ResultadoAgente:
        res = self._nuevo_resultado(contexto)
        corte = contexto.fecha_corte

        # --- 1. Serie mensual conciliada ------------------------------------
        mensual = self.db.consultar_df(
            """
            SELECT  substr(d.fecha,1,7)                                   AS periodo,
                    d.sku, d.centro,
                    SUM(d.demanda_atendida)                               AS unidades_atendidas,
                    SUM(COALESCE(d.demanda_perdida_estimada,0))           AS unidades_perdidas,
                    SUM(d.demanda_atendida + COALESCE(d.demanda_perdida_estimada,0))
                                                                          AS demanda_corregida,
                    SUM(d.flag_censura)                                   AS dias_censurados,
                    COUNT(*)                                              AS dias_con_registro
            FROM    historico_demanda d
            WHERE   d.fecha <= ?
            GROUP BY periodo, d.sku, d.centro
            ORDER BY periodo, d.sku;
            """,
            (corte,),
        )
        if mensual.empty:
            res.excepciones.append(ExcepcionPlan(
                codigo="DES-001", severidad=Severidad.BLOQUEANTE,
                descripcion="No se pudo construir la serie mensual",
                accion_sugerida="Verificar la fecha de corte y la carga de demanda",
                responsable="Planificacion"))
            return res

        # Un mes es completo si tiene registro para todos sus dias calendario.
        mensual["dias_periodo"] = mensual["periodo"].map(dias_del_periodo)
        mensual["mes_completo"] = (
            mensual["dias_con_registro"] >= mensual["dias_periodo"]
        ).astype(int)
        mensual["id_corrida"] = contexto.id_corrida

        parciales = mensual.loc[mensual["mes_completo"] == 0, "periodo"].unique().tolist()
        if parciales:
            res.excepciones.append(ExcepcionPlan(
                codigo="DES-002", severidad=Severidad.MEDIA,
                descripcion=f"Periodos con informacion parcial: {sorted(parciales)}",
                accion_sugerida="Excluirlos del entrenamiento o tratarlos como estimacion de cierre",
                responsable="Planificacion"))

        columnas = [
            "id_corrida", "periodo", "sku", "centro", "unidades_atendidas",
            "unidades_perdidas", "demanda_corregida", "dias_censurados",
            "dias_periodo", "mes_completo",
        ]
        self.db.insertar_df("demanda_mensual", mensual[columnas], modo="INSERT OR REPLACE")
        res.datos["demanda_mensual"] = mensual

        # --- 2. Indicadores por SKU -----------------------------------------
        kpi = self.db.consultar_df(
            """
            SELECT  m.sku, m.descripcion, m.sector, m.categoria, m.clase_abc,
                    m.clase_xyz, m.segmento_kraljic, m.criticidad_operativa,
                    m.costo_unitario, m.cv_demanda,
                    SUM(d.demanda_atendida)                             AS atendido,
                    SUM(COALESCE(d.demanda_perdida_estimada,0))         AS perdido,
                    SUM(d.demanda_atendida * m.costo_unitario)          AS consumo_valorizado,
                    SUM(d.flag_censura)                                 AS dias_quiebre,
                    COUNT(*)                                            AS dias_evaluados
            FROM    historico_demanda d
            JOIN    maestro_materiales m ON m.sku = d.sku
            WHERE   d.fecha <= ?
            GROUP BY m.sku;
            """,
            (corte,),
        )
        kpi["fill_rate"] = kpi["atendido"] / (kpi["atendido"] + kpi["perdido"]).clip(lower=1e-9)
        kpi["tasa_quiebre"] = kpi["dias_quiebre"] / kpi["dias_evaluados"].clip(lower=1)
        res.datos["kpi_sku"] = kpi

        # --- 3. Cobertura e inventario --------------------------------------
        inv = self.db.consultar_df(
            """
            SELECT  i.sku,
                    AVG(i.stock_final)                          AS stock_medio,
                    AVG(i.stock_final * m.costo_unitario)       AS stock_medio_pen,
                    AVG(i.volumen_ocupado_m3)                   AS volumen_medio_m3,
                    AVG(i.palets_ocupados)                      AS palets_medio
            FROM    inventario_diario i
            JOIN    maestro_materiales m ON m.sku = i.sku
            WHERE   i.fecha <= ?
            GROUP BY i.sku;
            """,
            (corte,),
        )
        res.datos["inventario_sku"] = inv

        # --- 4. Metricas agregadas del tablero -------------------------------
        atendido = float(kpi["atendido"].sum())
        perdido = float(kpi["perdido"].sum())
        consumo_diario = kpi["atendido"].sum() / max(int(kpi["dias_evaluados"].max() or 1), 1)
        stock_medio_pen = float(inv["stock_medio_pen"].sum()) if not inv.empty else 0.0
        costo_medio = float(kpi["consumo_valorizado"].sum()) / max(atendido, 1e-9)

        otif = self.db.consultar_escalar(
            "SELECT ROUND(1.0*SUM(CASE WHEN fecha_real_recepcion <= fecha_prometida "
            "AND cantidad_recibida >= cantidad_solicitada THEN 1 ELSE 0 END)/COUNT(*),4) "
            "FROM ordenes_compra WHERE estado_orden IN ('RECIBIDA_TOTAL','RECIBIDA_PARCIAL');"
        )
        gasto = self.db.consultar_escalar(
            "SELECT SUM(costo_total) FROM ordenes_compra WHERE estado_orden <> 'CANCELADA';"
        )

        res.metricas = {
            "unidades_atendidas": round(atendido, 2),
            "unidades_perdidas_estimadas": round(perdido, 2),
            "fill_rate_global": round(atendido / max(atendido + perdido, 1e-9), 4),
            "consumo_valorizado_pen": round(float(kpi["consumo_valorizado"].sum()), 2),
            "otif_global": round(float(otif or 0.0), 4),
            "gasto_compras_pen": round(float(gasto or 0.0), 2),
            "inventario_medio_pen": round(stock_medio_pen, 2),
            "dias_cobertura_media": round(
                stock_medio_pen / max(consumo_diario * costo_medio, 1e-9), 2),
            "periodos_analizados": float(mensual["periodo"].nunique()),
            "periodos_parciales": float(len(parciales)),
        }

        # --- 5. Excepciones de servicio --------------------------------------
        criticos = kpi[(kpi["fill_rate"] < 0.90) & (kpi["clase_abc"] == "A")]
        for _, r in criticos.iterrows():
            res.excepciones.append(ExcepcionPlan(
                codigo="DES-003", severidad=Severidad.ALTA, sku=str(r["sku"]),
                descripcion=f"Clase A con fill rate {r['fill_rate']:.1%} "
                            f"y {int(r['dias_quiebre'])} dias de quiebre",
                accion_sugerida="Revisar politica de reserva y plazo del proveedor principal",
                responsable="Planificacion"))

        res.evidencia = {
            "fuente": "historico_demanda, inventario_diario, ordenes_compra",
            "fecha_corte": corte,
            "base_de_agregacion": "demanda corregida por censura (atendida + perdida estimada)",
            "exclusion": f"periodos parciales marcados: {sorted(parciales)}",
        }
        res.mensaje = (f"{mensual['periodo'].nunique()} periodos conciliados para "
                       f"{kpi['sku'].nunique()} SKU")
        return res
