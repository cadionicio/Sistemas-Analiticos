"""Agente de analisis diagnostico: por que paso.

Separa con rigor tres categorias que el lenguaje cotidiano confunde y que el
sistema debe mantener distinguidas en la base de datos:

    OBSERVACION  hecho medido y reproducible desde una tabla.
    HIPOTESIS    explicacion plausible que requiere validacion adicional.
    SUPUESTO     valor adoptado por decision, no por evidencia.

La explicacion de un modelo no demuestra causalidad. Una correlacion orienta la
investigacion; atribuir el efecto a una causa exige comparacion valida. Por eso
todo hallazgo se persiste con su naturaleza y su evidencia, y ninguna hipotesis
modifica el plan hasta que un responsable la acepta.

El analisis central es la DESCOMPOSICION DEL RETRASO. Gracias a que la Fase 1
almacena la cadena de fechas completa, el retraso total de cada orden se
reparte en dos sumandos disjuntos con responsable distinto:

    dias_retraso_total = dias_retraso_aprobacion + dias_retraso_proveedor
                         (control interno)        (desempeno del proveedor)

Sin esa separacion, "el proveedor nos falla" es una conclusion indistinguible
de "nosotros aprobamos tarde", y la accion correctiva se dirige al lugar
equivocado.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from agents.core_agent import (
    AgenteEspecialista,
    ContextoEjecucion,
    ExcepcionPlan,
    ResultadoAgente,
    Severidad,
    TipoAnalisis,
)


class AgenteDiagnostico(AgenteEspecialista):
    """Explica las variaciones y atribuye causa raiz con evidencia."""

    nombre = "diagnostico"
    tipo_analisis = TipoAnalisis.DIAGNOSTICO
    dependencias = ("descriptivo",)

    def _procesar(
        self, contexto: ContextoEjecucion, previos: dict[str, ResultadoAgente]
    ) -> ResultadoAgente:
        res = self._nuevo_resultado(contexto)
        hipotesis: list[tuple] = []

        # =====================================================================
        # 1. DESCOMPOSICION DEL RETRASO DE ABASTECIMIENTO
        # =====================================================================
        causas = self.db.consultar_df("SELECT * FROM v_causa_raiz_retrasos;")
        res.datos["causa_raiz"] = causas

        tot = self.db.consultar_df(
            """
            SELECT  COUNT(*)                            AS n_ordenes,
                    SUM(dias_retraso_total)             AS dias_total,
                    SUM(dias_retraso_aprobacion)        AS dias_interno,
                    SUM(dias_retraso_proveedor)         AS dias_externo,
                    SUM(CASE WHEN dias_retraso_aprobacion > 0 THEN 1 ELSE 0 END) AS n_interno,
                    SUM(CASE WHEN dias_retraso_proveedor  > 0 THEN 1 ELSE 0 END) AS n_externo,
                    SUM(CASE WHEN dias_retraso_aprobacion > 0 THEN costo_total ELSE 0 END)
                                                        AS valor_retenido
            FROM    ordenes_compra
            WHERE   estado_orden <> 'CANCELADA';
            """
        ).iloc[0]

        dias_total = float(tot["dias_total"] or 0.0)
        dias_interno = float(tot["dias_interno"] or 0.0)
        dias_externo = float(tot["dias_externo"] or 0.0)
        n_ordenes = int(tot["n_ordenes"] or 0)
        participacion_interna = dias_interno / max(dias_total, 1e-9)

        res.metricas.update({
            "ordenes_evaluadas": float(n_ordenes),
            "dias_retraso_acumulados": round(dias_total, 1),
            "dias_retraso_imputables_finanzas": round(dias_interno, 1),
            "dias_retraso_imputables_proveedor": round(dias_externo, 1),
            "participacion_retraso_interno": round(participacion_interna, 4),
            "ordenes_con_bloqueo_finanzas": float(tot["n_interno"] or 0),
            "valor_retenido_por_aprobacion_pen": round(float(tot["valor_retenido"] or 0.0), 2),
        })

        # OBSERVACION: es un hecho medido, no una interpretacion.
        hipotesis.append((
            "ABASTECIMIENTO", None,
            f"El {participacion_interna:.1%} de los dias de retraso acumulados "
            f"({dias_interno:,.0f} de {dias_total:,.0f}) se origina en la aprobacion "
            f"interna, no en el proveedor",
            "OBSERVACION", round(dias_interno, 1), "dias",
            "ordenes_compra: suma de dias_retraso_aprobacion vs dias_retraso_proveedor",
            "Revisar el SLA de liberacion presupuestal y las atribuciones de aprobacion",
            "Finanzas y Compras",
        ))

        if participacion_interna > 0.30:
            res.excepciones.append(ExcepcionPlan(
                codigo="DIA-001", severidad=Severidad.ALTA,
                descripcion=f"El retraso interno explica el {participacion_interna:.1%} del "
                            "total: la autonomia del area de compras esta comprometida",
                accion_sugerida="Definir limites de atribucion y presupuesto comprometido por "
                                "categoria para desbloquear la emision",
                responsable="Gerencia"))

        # =====================================================================
        # 2. DESEMPENO POR PROVEEDOR
        # =====================================================================
        prov = self.db.consultar_df("SELECT * FROM v_otif_proveedor ORDER BY otif ASC;")
        res.datos["otif_proveedor"] = prov
        if not prov.empty:
            peor = prov.iloc[0]
            res.metricas["otif_minimo_proveedor"] = round(float(peor["otif"]), 4)
            hipotesis.append((
                "PROVEEDOR", None,
                f"{peor['razon_social']} presenta OTIF de {float(peor['otif']):.1%} "
                f"sobre {int(peor['entregas_evaluadas'])} entregas evaluadas",
                "OBSERVACION", round(float(peor["otif"]), 4), "ratio",
                "v_otif_proveedor con fecha prometida congelada al momento de la emision",
                "Acordar plan de mejora o habilitar fuente alternativa homologada",
                "Compras",
            ))

        # =====================================================================
        # 3. VINCULACION ENTRE RETRASO Y QUIEBRE (hipotesis, no causalidad)
        # =====================================================================
        # Se compara la tasa de quiebre de los meses con recepciones atrasadas
        # frente a los meses sin ellas. Es una comparacion de grupos, no un
        # experimento: identifica una asociacion que Operaciones debe validar.
        asociacion = self.db.consultar_df(
            """
            WITH retraso_mes AS (
                SELECT substr(fecha_real_recepcion,1,7) AS periodo, sku,
                       SUM(CASE WHEN dias_retraso_total > 0 THEN 1 ELSE 0 END) AS oc_atrasadas
                FROM   ordenes_compra
                WHERE  fecha_real_recepcion IS NOT NULL
                GROUP BY periodo, sku
            ),
            quiebre_mes AS (
                SELECT substr(fecha,1,7) AS periodo, sku,
                       1.0*SUM(flag_censura)/COUNT(*) AS tasa_quiebre
                FROM   historico_demanda
                GROUP BY periodo, sku
            )
            SELECT q.periodo, q.sku, q.tasa_quiebre,
                   COALESCE(r.oc_atrasadas,0) AS oc_atrasadas
            FROM   quiebre_mes q
            LEFT JOIN retraso_mes r ON r.periodo = q.periodo AND r.sku = q.sku;
            """
        )
        if not asociacion.empty:
            con_retraso = asociacion.loc[asociacion["oc_atrasadas"] > 0, "tasa_quiebre"]
            sin_retraso = asociacion.loc[asociacion["oc_atrasadas"] == 0, "tasa_quiebre"]
            if len(con_retraso) > 10 and len(sin_retraso) > 10:
                m1, m0 = float(con_retraso.mean()), float(sin_retraso.mean())
                # Diferencia estandarizada (d de Cohen) como medida de tamano de
                # efecto. NO es una prueba de significancia ni de causalidad.
                s = float(np.sqrt((con_retraso.var(ddof=1) + sin_retraso.var(ddof=1)) / 2.0))
                d_cohen = (m1 - m0) / max(s, 1e-9)
                res.metricas["tasa_quiebre_con_oc_atrasada"] = round(m1, 4)
                res.metricas["tasa_quiebre_sin_oc_atrasada"] = round(m0, 4)
                res.metricas["tamano_efecto_retraso_quiebre"] = round(d_cohen, 4)
                hipotesis.append((
                    "SERVICIO", None,
                    f"Los meses-SKU con recepciones atrasadas muestran una tasa de quiebre de "
                    f"{m1:.1%} frente a {m0:.1%} sin ellas (d={d_cohen:.2f})",
                    "HIPOTESIS", round(m1 - m0, 4), "diferencia de tasa",
                    "Comparacion de grupos sobre historico_demanda y ordenes_compra. "
                    "Asociacion, no causalidad: no controla estacionalidad ni campanas",
                    "Validar con Operaciones en una muestra de meses comparables antes de "
                    "modificar politicas de reserva",
                    "Planificacion",
                ))

        # =====================================================================
        # 4. DESCOMPOSICION DE LA VARIACION INTERANUAL DE DEMANDA
        # =====================================================================
        desc = previos.get("descriptivo")
        mensual = desc.datos.get("demanda_mensual") if desc else None
        if mensual is not None and not mensual.empty:
            m = mensual.copy()
            m["anio"] = m["periodo"].str[:4].astype(int)
            por_anio = m.groupby(["anio", "sku"])["demanda_corregida"].sum().reset_index()
            anios = sorted(por_anio["anio"].unique())
            if len(anios) >= 2:
                ult, prev = anios[-1], anios[-2]
                a = por_anio[por_anio["anio"] == ult].set_index("sku")["demanda_corregida"]
                b = por_anio[por_anio["anio"] == prev].set_index("sku")["demanda_corregida"]
                comp = pd.DataFrame({"actual": a, "anterior": b}).dropna()
                comp["variacion"] = comp["actual"] - comp["anterior"]
                comp["variacion_pct"] = comp["variacion"] / comp["anterior"].clip(lower=1e-9)
                res.datos["variacion_interanual"] = comp.reset_index()

                top = comp.reindex(comp["variacion"].abs().sort_values(ascending=False).index).head(5)
                for sku, r in top.iterrows():
                    hipotesis.append((
                        "DEMANDA", str(sku),
                        f"Variacion interanual de {r['variacion_pct']:+.1%} "
                        f"({r['variacion']:+,.0f} unidades) entre {prev} y {ult}",
                        "OBSERVACION", round(float(r["variacion"]), 2), "unidades",
                        f"demanda_mensual agregada por anio; comparacion {prev} vs {ult} "
                        "sobre demanda corregida por censura",
                        "Comercial debe confirmar si responde a precio, distribucion, "
                        "campana o disponibilidad antes de trasladarla al pronostico",
                        "Comercial",
                    ))
                res.metricas["skus_con_variacion_mayor_20pct"] = float(
                    (comp["variacion_pct"].abs() > 0.20).sum())

        # =====================================================================
        # 5. PERSISTENCIA DE HIPOTESIS
        # =====================================================================
        if hipotesis:
            self.db.ejecutar_masivo(
                "INSERT INTO hipotesis_diagnostico "
                "(id_corrida, ambito, sku, hallazgo, naturaleza, impacto_valor, "
                " impacto_unidad, evidencia, accion_sugerida, responsable) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
                [(contexto.id_corrida, *h) for h in hipotesis],
            )
        res.metricas["hipotesis_registradas"] = float(len(hipotesis))
        res.datos["hipotesis"] = pd.DataFrame(
            hipotesis,
            columns=["ambito", "sku", "hallazgo", "naturaleza", "impacto_valor",
                     "impacto_unidad", "evidencia", "accion_sugerida", "responsable"],
        )

        res.evidencia = {
            "metodo_causa_raiz": "descomposicion aditiva del retraso en tramo interno y externo",
            "limite_declarado": "las asociaciones no establecen causalidad; se marcan como HIPOTESIS",
            "fuente": "ordenes_compra, historico_demanda, v_otif_proveedor, demanda_mensual",
        }
        res.mensaje = (f"{len(hipotesis)} hallazgos; retraso interno "
                       f"{participacion_interna:.1%} del total")
        return res
