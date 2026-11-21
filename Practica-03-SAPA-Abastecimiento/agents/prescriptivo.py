"""Agente de analisis prescriptivo: que conviene hacer.

Convierte el pronostico aprobado en una CANASTA DE COMPRAS ejecutable a 12
meses, por escenario, y la somete a simulacion estocastica para medir el riesgo
de su ejecucion.

Reglas de conducta que el agente respeta sin excepcion:

*   Si no existe solucion factible, PRESENTA LA BRECHA. No suprime demanda ni
    relaja restricciones en silencio. Un presupuesto que se cumple eliminando
    demanda real no es una solucion: es un plan que fallara en el almacen.
*   Ninguna cantidad se declara OPTIMA salvo que lo sea. Wagner-Whitin resuelve
    de forma exacta el lote dinamico; el redondeo a empaque y MOQ posterior
    rompe esa optimalidad, y el racionamiento por presupuesto es explicitamente
    una heuristica de priorizacion. El sistema lo dice en cada fila.
*   El balance material no demuestra factibilidad temporal. Toda compra cuya
    fecha limite de emision ya paso al corte se marca VENCIDA y escala como
    excepcion: requiere suministro urgente, transferencia o reprogramacion.
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
from config import settings
from engine import inventario as inv
from engine import simulacion as sim
from engine.calendario import (
    DIAS_MES,
    emision_vencida,
    fecha_emision,
    inicio_de_periodo,
    periodos_horizonte,
)

_EPS = 1e-9


class AgentePrescriptivo(AgenteEspecialista):
    """Formula la canasta de compras multiescenario y simula su ejecucion."""

    nombre = "prescriptivo"
    tipo_analisis = TipoAnalisis.PRESCRIPTIVO
    dependencias = ("predictivo",)

    def _procesar(
        self, contexto: ContextoEjecucion, previos: dict[str, ResultadoAgente]
    ) -> ResultadoAgente:
        res = self._nuevo_resultado(contexto)
        H = contexto.horizonte_meses
        periodos = periodos_horizonte(contexto.fecha_corte, H)

        parametria = self._cargar_parametria()
        if parametria.empty:
            res.excepciones.append(ExcepcionPlan(
                codigo="PRS-001", severidad=Severidad.BLOQUEANTE,
                descripcion="Sin parametria de abastecimiento homologada",
                accion_sugerida="Homologar proveedor, precio, empaque y plazo por SKU",
                responsable="Compras"))
            return res

        pron = self.db.consultar_df(
            "SELECT sku, periodo, horizonte, escenario, p50, sigma_residual "
            "FROM pronosticos WHERE id_corrida = ? AND centro = ?;",
            (contexto.id_corrida, contexto.centro),
        )
        if pron.empty:
            res.excepciones.append(ExcepcionPlan(
                codigo="PRS-002", severidad=Severidad.BLOQUEANTE,
                descripcion="No hay pronostico publicado para esta corrida",
                accion_sugerida="Ejecutar el agente predictivo",
                responsable="Planificacion"))
            return res

        inventario_inicial = self._inventario_al_corte(contexto.fecha_corte)
        confirmadas = self._recepciones_confirmadas(periodos)
        presupuesto, origen_presupuesto = self._presupuesto(periodos, contexto)

        if origen_presupuesto == "SUPUESTO":
            res.excepciones.append(ExcepcionPlan(
                codigo="PRS-003", severidad=Severidad.INFORMATIVA,
                descripcion="No existe presupuesto aprobado; se adopta el gasto historico "
                            "mensual mas 5% como SUPUESTO de trabajo",
                accion_sugerida="Finanzas debe confirmar el presupuesto por periodo antes de "
                                "autorizar emisiones",
                responsable="Finanzas"))

        filas_canasta: list[dict] = []
        filas_simulacion: list[dict] = []
        resumen_escenarios: list[dict] = []

        for esc in settings.ESCENARIOS:
            canasta, ajustes, brechas = self._construir_canasta(
                esc, pron, parametria, inventario_inicial, confirmadas,
                presupuesto, periodos, contexto,
            )
            filas_canasta.extend(canasta)

            df = pd.DataFrame(canasta)
            costo_total = float(df["costo_compra"].sum()) if not df.empty else 0.0
            faltante = float(df["faltante"].sum()) if not df.empty else 0.0
            vencidas = int(df["emision_vencida"].sum()) if not df.empty else 0

            resumen_escenarios.append({
                "escenario": esc.nombre, "costo_total": costo_total,
                "faltante": faltante, "lineas": len(df),
                "lineas_con_compra": int((df["compra_propuesta"] > 0).sum()) if not df.empty else 0,
                "emisiones_vencidas": vencidas, "ajustes_presupuesto": ajustes,
            })

            # --- Simulacion estocastica del escenario -------------------------
            metricas_sim = self._simular(esc, df, parametria, inventario_inicial, H,
                                         contexto)
            for metrica, valores in metricas_sim.items():
                filas_simulacion.append({
                    "id_corrida": contexto.id_corrida, "escenario": esc.nombre,
                    "metrica": metrica,
                    "unidad": self._unidad_de(metrica),
                    "n_iteraciones": int(contexto.parametros.get(
                        "n_iteraciones", settings.MONTECARLO.n_iteraciones)),
                    "media": round(valores["media"], 4),
                    "p05": round(valores["p05"], 4), "p50": round(valores["p50"], 4),
                    "p95": round(valores["p95"], 4), "minimo": round(valores["minimo"], 4),
                    "maximo": round(valores["maximo"], 4),
                })

            # --- Excepciones del escenario ------------------------------------
            if vencidas:
                res.excepciones.append(ExcepcionPlan(
                    codigo="PRS-004", severidad=Severidad.ALTA,
                    descripcion=f"[{esc.nombre}] {vencidas} lineas cuya fecha limite de emision "
                                "ya paso al corte: materialmente necesarias, temporalmente "
                                "inejecutables",
                    accion_sugerida="Suministro urgente, transferencia entre centros o "
                                    "reprogramacion aprobada",
                    responsable="Compras"))
            if ajustes:
                res.excepciones.append(ExcepcionPlan(
                    codigo="PRS-005", severidad=Severidad.ALTA,
                    descripcion=f"[{esc.nombre}] {ajustes} lineas recortadas por restriccion de "
                                f"caja; faltante resultante {faltante:,.0f} unidades",
                    accion_sugerida="Ampliar presupuesto, negociar plazos de pago o autorizar la "
                                    "relajacion de reserva con constancia del servicio perdido",
                    responsable="Finanzas y Gerencia"))
            for b in brechas[:8]:
                res.excepciones.append(b)

        if filas_canasta:
            self.db.insertar_df("canasta_compras", pd.DataFrame(filas_canasta),
                                modo="INSERT OR REPLACE")
        if filas_simulacion:
            self.db.insertar_df("simulacion_resultados", pd.DataFrame(filas_simulacion),
                                modo="INSERT OR REPLACE")

        df_esc = pd.DataFrame(resumen_escenarios)
        res.datos["canasta"] = pd.DataFrame(filas_canasta)
        res.datos["resumen_escenarios"] = df_esc
        res.datos["simulacion"] = pd.DataFrame(filas_simulacion)

        base = df_esc[df_esc["escenario"] == "BASE"].iloc[0]
        sim_base = {f["metrica"]: f for f in filas_simulacion if f["escenario"] == "BASE"}
        res.metricas.update({
            "costo_canasta_base_pen": round(float(base["costo_total"]), 2),
            "lineas_canasta_base": float(base["lineas"]),
            "lineas_con_compra_base": float(base["lineas_con_compra"]),
            "faltante_base_unidades": round(float(base["faltante"]), 2),
            "emisiones_vencidas_base": float(base["emisiones_vencidas"]),
            "ajustes_presupuesto_base": float(base["ajustes_presupuesto"]),
            "costo_canasta_disrupcion_pen": round(
                float(df_esc[df_esc["escenario"] == "DISRUPCION"]["costo_total"].iloc[0]), 2),
            "fill_rate_simulado_p50": round(
                float(sim_base.get("fill_rate", {}).get("p50", 0.0)), 4),
            "fill_rate_simulado_p05": round(
                float(sim_base.get("fill_rate", {}).get("p05", 0.0)), 4),
            "valor_faltante_p95_pen": round(
                float(sim_base.get("valor_faltante_pen", {}).get("p95", 0.0)), 2),
        })

        res.evidencia = {
            "metodo_lote": "Wagner-Whitin (1958) exacto, seguido de redondeo a empaque y MOQ",
            "metodo_reserva": "z(clase ABC) x sigma_DDLT con formula de King (lead time estocastico)",
            "racionamiento": "heuristica de priorizacion por criticidad, clase ABC y segmento "
                             "Kraljic; NO es un optimo economico y se declara como tal",
            "simulacion": (f"{settings.MONTECARLO.n_iteraciones} iteraciones por escenario con "
                           f"factor comun de demanda w={settings.MONTECARLO.peso_factor_comun} "
                           "para preservar la correlacion entre articulos"),
            "presupuesto": f"origen {origen_presupuesto}",
            "limite_declarado": "el balance material no demuestra factibilidad temporal; las "
                                "emisiones vencidas se reportan por separado",
        }
        res.mensaje = (f"{len(filas_canasta)} lineas en {len(settings.ESCENARIOS)} escenarios; "
                       f"base S/ {float(base['costo_total']):,.0f}")
        return res

    # =========================================================================
    # CARGA DE INSUMOS
    # =========================================================================
    def _cargar_parametria(self) -> pd.DataFrame:
        """Parametria de abastecimiento del proveedor prioritario por SKU."""
        return self.db.consultar_df(
            """
            SELECT  m.sku, m.descripcion, m.costo_unitario, m.clase_abc, m.clase_xyz,
                    m.segmento_kraljic, m.criticidad_operativa, m.volumen_m3_unidad,
                    sp.proveedor_id, sp.precio_unitario, sp.moq, sp.lote_multiplo,
                    sp.lead_time_medio_dias, sp.lead_time_sigma_dias,
                    sp.lead_time_min_dias, sp.ln_mu, sp.ln_sigma
            FROM    maestro_materiales m
            JOIN    sku_proveedor sp ON sp.sku = m.sku AND sp.homologado = 1
            WHERE   m.activo = 1
              AND   sp.prioridad = (SELECT MIN(prioridad) FROM sku_proveedor s2
                                     WHERE s2.sku = m.sku AND s2.homologado = 1)
            GROUP BY m.sku;
            """
        )

    def _inventario_al_corte(self, fecha_corte: str) -> dict[str, float]:
        """Existencias utilizables por SKU en la fecha de corte."""
        df = self.db.consultar_df(
            "SELECT sku, stock_final FROM inventario_diario WHERE fecha = "
            "(SELECT MAX(fecha) FROM inventario_diario WHERE fecha <= ?);",
            (fecha_corte,),
        )
        return dict(zip(df["sku"], df["stock_final"].astype(float))) if not df.empty else {}

    def _recepciones_confirmadas(self, periodos: list[str]) -> dict[tuple[str, str], float]:
        """Ordenes abiertas que llegaran dentro del horizonte.

        Se excluyen del compromiso nuevo pero NO del balance fisico: olvidarlas
        en el balance produce sobrecompra, contarlas dos veces produce quiebre.
        """
        df = self.db.consultar_df(
            "SELECT sku, substr(fecha_prometida,1,7) AS periodo, "
            "       SUM(cantidad_solicitada - cantidad_recibida) AS pendiente "
            "FROM ordenes_compra WHERE estado_orden IN ('EMITIDA','EN_TRANSITO') "
            "GROUP BY sku, periodo;"
        )
        validos = set(periodos)
        return {
            (str(r["sku"]), str(r["periodo"])): max(float(r["pendiente"]), 0.0)
            for _, r in df.iterrows() if str(r["periodo"]) in validos
        }

    def _presupuesto(
        self, periodos: list[str], contexto: ContextoEjecucion
    ) -> tuple[dict[str, float], str]:
        """Presupuesto de compra por periodo; lo deriva si no esta aprobado."""
        df = self.db.consultar_df(
            "SELECT periodo, presupuesto_compra, origen FROM restricciones_periodo "
            "WHERE centro = ? AND presupuesto_compra IS NOT NULL;",
            (contexto.centro,),
        )
        existentes = dict(zip(df["periodo"], df["presupuesto_compra"].astype(float))) if not df.empty else {}
        if all(p in existentes for p in periodos) and not df.empty:
            return {p: existentes[p] for p in periodos}, str(df["origen"].iloc[0])

        gasto = self.db.consultar_escalar(
            "SELECT AVG(g) FROM (SELECT SUM(costo_total) AS g FROM ordenes_compra "
            "WHERE estado_orden <> 'CANCELADA' GROUP BY substr(fecha_emision,1,7));"
        )
        base = float(gasto or 0.0) * 1.05
        derivado = {p: base for p in periodos}
        self.db.ejecutar_masivo(
            "INSERT INTO restricciones_periodo (periodo, centro, presupuesto_compra, origen, "
            "responsable) VALUES (?, ?, ?, 'SUPUESTO', 'derivado_del_gasto_historico') "
            "ON CONFLICT(periodo, centro) DO UPDATE SET presupuesto_compra=excluded.presupuesto_compra;",
            [(p, contexto.centro, round(base, 2)) for p in periodos],
        )
        return derivado, "SUPUESTO"

    # =========================================================================
    # CONSTRUCCION DE LA CANASTA
    # =========================================================================
    def _construir_canasta(
        self,
        esc: settings.EscenarioSimulacion,
        pron: pd.DataFrame,
        parametria: pd.DataFrame,
        inventario_inicial: dict[str, float],
        confirmadas: dict[tuple[str, str], float],
        presupuesto: dict[str, float],
        periodos: list[str],
        contexto: ContextoEjecucion,
    ) -> tuple[list[dict], int, list[ExcepcionPlan]]:
        """Calcula la canasta de un escenario y aplica la restriccion de caja."""
        sub = pron[pron["escenario"] == esc.nombre]
        mapa = {
            sku: g.sort_values("horizonte")
            for sku, g in sub.groupby("sku", sort=True)
        }
        H = len(periodos)
        brechas: list[ExcepcionPlan] = []
        por_sku: dict[str, list[inv.FilaBalance]] = {}
        parametros_sku: dict[str, inv.ParametrosArticulo] = {}
        metodo_sku: dict[str, str] = {}

        for _, m in parametria.iterrows():
            sku = str(m["sku"])
            g = mapa.get(sku)
            if g is None or g.empty:
                continue

            D = g["p50"].to_numpy(dtype=float)[:H]
            sigma_mes = float(np.nanmean(g["sigma_residual"].to_numpy(dtype=float)))
            d_bar = float(np.mean(D)) if D.size else 0.0

            # Los controles de la Torre de Control llegan por `contexto.parametros`
            # y gobiernan el calculo real, no solo la presentacion: si el usuario
            # mueve el nivel de servicio o la variabilidad del plazo, cambia el
            # stock de seguridad y por tanto la canasta completa.
            factor_lt = float(contexto.parametros.get("factor_variabilidad_lt", 1.0))
            nivel_servicio = contexto.parametros.get("nivel_servicio")

            lt_dias = float(m["lead_time_medio_dias"]) * esc.factor_lead_time
            lt_meses = lt_dias / DIAS_MES
            sigma_lt_meses = (float(m["lead_time_sigma_dias"]) * esc.factor_lead_time
                              * factor_lt / DIAS_MES)

            z = inv.z_nivel_servicio(str(m["clase_abc"] or "C"), nivel=nivel_servicio)
            ss = inv.stock_seguridad(z, sigma_mes, d_bar, lt_meses, sigma_lt_meses)

            par = inv.ParametrosArticulo(
                sku=sku, proveedor_id=str(m["proveedor_id"]),
                inventario_inicial=float(inventario_inicial.get(sku, 0.0)),
                precio_unitario=float(m["precio_unitario"]) * esc.factor_costo,
                costo_unitario=float(m["costo_unitario"]),
                lote_multiplo=float(m["lote_multiplo"]), moq=float(m["moq"]),
                lead_time_dias=lt_dias, sigma_lead_time_dias=float(m["lead_time_sigma_dias"]),
                stock_seguridad=ss, volumen_m3=float(m["volumen_m3_unidad"]),
                clase_abc=str(m["clase_abc"] or "C"),
            )
            C = np.array([confirmadas.get((sku, p), 0.0) for p in periodos])
            filas, metodo = inv.proyectar_balance(D, par, C)

            fallos = inv.verificar_balance(filas)
            if fallos:
                brechas.append(ExcepcionPlan(
                    codigo="PRS-006", severidad=Severidad.BLOQUEANTE, sku=sku,
                    descripcion=f"Balance material descuadrado en periodos {fallos}",
                    accion_sugerida="Revisar parametria de empaque, MOQ e inventario inicial",
                    responsable="Sistemas"))

            por_sku[sku] = filas
            parametros_sku[sku] = par
            metodo_sku[sku] = metodo

        # --- Restriccion de caja por periodo ---------------------------------
        ajustados = self._racionar_por_presupuesto(
            por_sku, parametros_sku, parametria, presupuesto, periodos, esc,
            float(contexto.parametros.get("factor_presupuesto", 1.0)),
        )

        # --- Materializacion de filas ----------------------------------------
        filas_out: list[dict] = []
        prioridad = self._tabla_prioridad(parametria)
        for sku, filas in por_sku.items():
            par = parametros_sku[sku]
            for f in filas:
                periodo = periodos[f.periodo_idx]
                vencida = emision_vencida(periodo, par.lead_time_dias, contexto.fecha_corte)
                filas_out.append({
                    "id_corrida": contexto.id_corrida, "escenario": esc.nombre, "sku": sku,
                    "proveedor_id": par.proveedor_id, "centro": contexto.centro,
                    "periodo": periodo, "horizonte": f.periodo_idx + 1,
                    "demanda_plan": round(f.demanda, 3),
                    "inventario_inicial": round(f.inventario_inicial, 3),
                    "recepcion_confirmada": round(f.recepcion_confirmada, 3),
                    "stock_seguridad": round(f.stock_seguridad, 3),
                    "necesidad_neta": round(f.necesidad_neta, 3),
                    "compra_propuesta": round(f.compra, 3),
                    "inventario_final": round(f.inventario_final, 3),
                    "faltante": round(f.faltante, 3),
                    "fecha_emision": str(fecha_emision(periodo, par.lead_time_dias)),
                    "fecha_recepcion": str(inicio_de_periodo(periodo)),
                    "emision_vencida": int(vencida and f.compra > 0),
                    "precio_unitario": round(par.precio_unitario, 4),
                    "moneda": "PEN",
                    "costo_compra": round(f.compra * par.precio_unitario, 2),
                    "volumen_m3": round(f.compra * par.volumen_m3, 4),
                    "metodo_lote": metodo_sku[sku],
                    "ajuste_presupuesto": int((sku, f.periodo_idx) in ajustados),
                    "nivel_riesgo": self._nivel_riesgo(f, prioridad.get(sku, 0)),
                    "estado": "PROPUESTA", "aprobador": None,
                })
        return filas_out, len(ajustados), brechas

    def _racionar_por_presupuesto(
        self,
        por_sku: dict[str, list[inv.FilaBalance]],
        parametros: dict[str, inv.ParametrosArticulo],
        parametria: pd.DataFrame,
        presupuesto: dict[str, float],
        periodos: list[str],
        esc: settings.EscenarioSimulacion,
        factor_usuario: float = 1.0,
    ) -> set[tuple[str, int]]:
        """Recorta compras cuando el desembolso del periodo supera la caja.

        HEURISTICA DECLARADA, no optimizacion. Ordena por prioridad de negocio
        (criticidad operativa, clase ABC y segmento Kraljic) y difiere de abajo
        hacia arriba hasta encajar en el presupuesto. Tras el recorte se
        RECALCULA el balance del articulo hacia adelante, de modo que el
        faltante resultante queda registrado y visible: el plan no finge que la
        demanda desaparecio.

        Returns:
            set[tuple[str, int]]: pares (sku, periodo) efectivamente recortados.
        """
        prioridad = self._tabla_prioridad(parametria)
        ajustados: set[tuple[str, int]] = set()

        for t, periodo in enumerate(periodos):
            tope = presupuesto.get(periodo, float("inf")) * esc.factor_presupuesto * factor_usuario
            if not np.isfinite(tope):
                continue

            costo_periodo = sum(
                filas[t].compra * parametros[sku].precio_unitario
                for sku, filas in por_sku.items() if t < len(filas)
            )
            if costo_periodo <= tope + _EPS:
                continue

            candidatos = sorted(
                [(sku, filas) for sku, filas in por_sku.items()
                 if t < len(filas) and filas[t].compra > _EPS],
                key=lambda kv: prioridad.get(kv[0], 0),
            )
            exceso = costo_periodo - tope
            for sku, filas in candidatos:
                if exceso <= _EPS:
                    break
                par = parametros[sku]
                valor = filas[t].compra * par.precio_unitario
                filas[t].compra = 0.0
                filas[t].costo = 0.0
                ajustados.add((sku, t))
                exceso -= valor
                self._recalcular_desde(filas, t, par)

        return ajustados

    @staticmethod
    def _recalcular_desde(
        filas: list[inv.FilaBalance], desde: int, par: inv.ParametrosArticulo
    ) -> None:
        """Recalcula el balance hacia adelante tras modificar una compra.

        Sin esta pasada, el inventario final de los periodos siguientes seguiria
        reflejando una compra que ya no existe y el faltante quedaria oculto.
        """
        inv_actual = filas[desde].inventario_inicial
        for t in range(desde, len(filas)):
            f = filas[t]
            f.inventario_inicial = inv_actual
            disponible = inv_actual + f.recepcion_confirmada + f.compra
            atendida = min(f.demanda, disponible)
            f.faltante = max(0.0, f.demanda - disponible)
            f.inventario_final = max(0.0, disponible - atendida)
            f.costo = f.compra * par.precio_unitario
            inv_actual = f.inventario_final

    @staticmethod
    def _tabla_prioridad(parametria: pd.DataFrame) -> dict[str, int]:
        """Puntaje de prioridad de negocio por SKU (mayor = se protege antes)."""
        prioridad: dict[str, int] = {}
        for _, m in parametria.iterrows():
            p = int(m["criticidad_operativa"])
            if str(m["clase_abc"]) == "A":
                p += 3
            elif str(m["clase_abc"]) == "B":
                p += 1
            if str(m["segmento_kraljic"]) in {"ESTRATEGICO", "CUELLO_DE_BOTELLA"}:
                p += 2
            prioridad[str(m["sku"])] = p
        return prioridad

    @staticmethod
    def _nivel_riesgo(f: inv.FilaBalance, prioridad: int) -> str:
        """Clasifica el riesgo de la linea para el semaforo del tablero."""
        if f.faltante > _EPS:
            return "CRITICO" if prioridad >= 7 else "ALTO"
        if f.inventario_final < f.stock_seguridad * 0.5:
            return "ALTO"
        if f.inventario_final < f.stock_seguridad:
            return "MEDIO"
        return "BAJO"

    # =========================================================================
    # SIMULACION
    # =========================================================================
    def _simular(
        self, esc: settings.EscenarioSimulacion, canasta: pd.DataFrame,
        parametria: pd.DataFrame, inventario_inicial: dict[str, float], H: int,
        contexto: ContextoEjecucion | None = None,
    ) -> dict[str, dict[str, float]]:
        """Ejecuta el Monte Carlo del escenario sobre la canasta calculada."""
        if canasta.empty:
            return {}

        skus = sorted(canasta["sku"].unique())
        idx = {s: i for i, s in enumerate(skus)}
        S = len(skus)

        p50 = np.zeros((S, H))
        sigma = np.zeros((S, H))
        compras = np.zeros((S, H))
        for _, r in canasta.iterrows():
            i, t = idx[r["sku"]], int(r["horizonte"]) - 1
            if t < H:
                p50[i, t] = float(r["demanda_plan"])
                compras[i, t] = float(r["compra_propuesta"])

        pron_sigma = self.db.consultar_df(
            "SELECT sku, horizonte, sigma_residual FROM pronosticos "
            "WHERE id_corrida = ? AND escenario = ?;",
            (canasta["id_corrida"].iloc[0], esc.nombre),
        )
        for _, r in pron_sigma.iterrows():
            s = str(r["sku"])
            t = int(r["horizonte"]) - 1
            if s in idx and t < H:
                sigma[idx[s], t] = float(r["sigma_residual"] or 0.0)

        m = parametria.set_index("sku")
        def _col(nombre: str, defecto: float = 0.0) -> np.ndarray:
            return np.array([
                float(m.loc[s, nombre]) if s in m.index else defecto for s in skus
            ])

        entrada = sim.EntradaSimulacion(
            p50=p50, sigma=sigma, compras=compras,
            inventario_inicial=np.array([inventario_inicial.get(s, 0.0) for s in skus]),
            precio=_col("precio_unitario", 1.0),
            costo_unitario=_col("costo_unitario", 1.0),
            lt_plan_dias=_col("lead_time_medio_dias", 15.0),
            ln_mu=_col("ln_mu", 1.0),
            ln_sigma=_col("ln_sigma", 0.2),
            lt_min_dias=_col("lead_time_min_dias", 2.0),
        )
        n_iter = None
        if contexto is not None:
            n_iter = contexto.parametros.get("n_iteraciones")
        return sim.simular_escenario(entrada, esc, n_iteraciones=n_iter)

    @staticmethod
    def _unidad_de(metrica: str) -> str:
        """Unidad de medida de cada metrica simulada."""
        if metrica.endswith("_pen"):
            return "PEN"
        if metrica == "fill_rate":
            return "ratio"
        if metrica == "meses_con_algun_quiebre":
            return "meses"
        if metrica.startswith("proporcion"):
            return "ratio"
        return "unidades"
