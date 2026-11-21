"""Agente de analisis predictivo: que puede ocurrir.

Produce el pronostico de demanda a 12 meses con su evidencia de validacion. El
producto NO es una cifra: es una cifra con su error medido fuera de muestra, su
sesgo, su modelo identificado y su intervalo con cobertura verificada.

Protocolo aplicado, en este orden estricto:

1.  Se aparta una RESERVA FINAL que no participa en ninguna decision de
    seleccion. Su tamano es adaptativo: 12 meses con historia larga, 6 con
    historia corta, porque una reserva de 12 sobre 36 meses deja un pool que
    impide estimar un ETS estacional y lo excluiria por construccion. El
    sistema declara a que horizonte corresponde el desempeno reportado.
2.  Sobre el resto se ejecuta validacion con ORIGEN DESLIZANTE: cada corte
    entrena solo con el prefijo de la serie y evalua el tramo siguiente,
    reproduciendo lo que el planificador habria conocido esa fecha.
3.  Se compara cada candidato contra el REFERENTE ESTACIONAL de forma PAREADA
    POR CORTE: solo sobre los origenes en que ambos pudieron estimarse, y
    exigiendo un minimo de cortes comunes. Un candidato reemplaza al referente
    unicamente si mejora el WAPE por encima del umbral de politica Y mantiene
    el sesgo bajo control. En caso contrario se conserva el referente: un
    modelo que no demuestra ventaja no se adopta por ser mas sofisticado.
4.  El modelo elegido se reajusta sobre toda la historia disponible y proyecta
    el horizonte operativo.
5.  El intervalo se construye con la DISPERSION EMPIRICA de los errores de
    validacion por horizonte, no con un supuesto normal impuesto. Se reporta la
    cobertura observada en la reserva final; si difiere de la nominal, el
    intervalo se marca como NO CALIBRADO y el sistema lo declara.

Lo que este agente nunca hace: generar cantidades de demanda a partir de texto,
declarar un porcentaje de confianza no medido, ni usar informacion posterior al
origen de cada corte.
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
from engine import forecasting as fc
from engine import validacion as val
from engine.calendario import periodos_horizonte

_EPS = 1e-9


class AgentePredictivo(AgenteEspecialista):
    """Selecciona modelo por SKU con validacion temporal y publica el pronostico."""

    nombre = "predictivo"
    tipo_analisis = TipoAnalisis.PREDICTIVO
    dependencias = ("descriptivo", "diagnostico")

    def _procesar(
        self, contexto: ContextoEjecucion, previos: dict[str, ResultadoAgente]
    ) -> ResultadoAgente:
        res = self._nuevo_resultado(contexto)
        p = settings.PRONOSTICO
        H = contexto.horizonte_meses
        periodos = periodos_horizonte(contexto.fecha_corte, H)
        z_int = val.cuantil_normal(0.5 + p.cobertura_nominal / 2.0)

        serie_larga = self.db.consultar_df(
            "SELECT periodo, sku, demanda_corregida, mes_completo "
            "FROM demanda_mensual WHERE id_corrida = ? AND mes_completo = 1 "
            "ORDER BY sku, periodo;",
            (contexto.id_corrida,),
        )
        if serie_larga.empty:
            res.excepciones.append(ExcepcionPlan(
                codigo="PRE-001", severidad=Severidad.BLOQUEANTE,
                descripcion="No hay serie mensual completa para entrenar",
                accion_sugerida="Ejecutar el agente descriptivo o revisar la fecha de corte",
                responsable="Planificacion"))
            return res

        filas_validacion: list[dict] = []
        filas_pronostico: list[dict] = []
        resumen: list[dict] = []

        for sku, grupo in serie_larga.groupby("sku", sort=True):
            g = grupo.sort_values("periodo")
            y = g["demanda_corregida"].to_numpy(dtype=float)
            n = y.size

            if n < p.min_meses_serie:
                res.excepciones.append(ExcepcionPlan(
                    codigo="PRE-002", severidad=Severidad.MEDIA, sku=str(sku),
                    descripcion=f"Solo {n} meses de historia; se usa salvaguarda sin validacion",
                    accion_sugerida="Planificar por analogos y familias; ampliar los intervalos",
                    responsable="Planificacion"))
                self._pronostico_salvaguarda(
                    contexto, str(sku), y, periodos, filas_pronostico, resumen
                )
                continue

            candidatos = fc.catalogo_modelos(y, p.periodo_estacional)
            nombre_referente = candidatos[0].nombre
            cortes = val.cortes_rolling_origin(n)

            if not cortes:
                res.excepciones.append(ExcepcionPlan(
                    codigo="PRE-003", severidad=Severidad.ALTA, sku=str(sku),
                    descripcion=f"Historia insuficiente para validacion temporal ({n} meses)",
                    accion_sugerida="Conservar el referente estacional y declarar la incertidumbre",
                    responsable="Planificacion"))

            # ---------------------------------------------------------------
            # Validacion con origen deslizante
            # ---------------------------------------------------------------
            errores_por_modelo: dict[str, list[np.ndarray]] = {}
            metricas_por_modelo: dict[str, list[val.ResumenExactitud]] = {}
            # detalle[modelo][origen] permite comparar modelos SOLO en los
            # cortes donde ambos pudieron estimarse.
            detalle: dict[str, dict[int, dict[str, float]]] = {}

            for origen, fin in cortes:
                entrenamiento = y[:origen]
                prueba = y[origen:fin]
                h = prueba.size
                for plantilla in candidatos:
                    modelo = type(plantilla)(p.periodo_estacional) \
                        if not isinstance(plantilla, fc.HoltWinters) \
                        else fc.HoltWinters(p.periodo_estacional, plantilla.estacional)
                    pred = fc.ajustar_seguro(modelo, entrenamiento, h)
                    if pred is None:
                        continue
                    m = val.evaluar(modelo.nombre, origen, prueba, pred, entrenamiento,
                                    periodo=p.periodo_estacional)
                    metricas_por_modelo.setdefault(modelo.nombre, []).append(m)
                    errores_por_modelo.setdefault(modelo.nombre, []).append(prueba - pred)
                    detalle.setdefault(modelo.nombre, {})[int(origen)] = {
                        "wape": m.wape, "sesgo": m.sesgo, "mase": m.mase,
                    }
                    filas_validacion.append({
                        "id_corrida": contexto.id_corrida, "sku": str(sku),
                        "modelo": modelo.nombre, "tipo_corte": "CV", "origen": int(origen),
                        "n_observaciones": int(h),
                        **{k: v for k, v in m.como_fila().items()
                           if k in {"wape", "mase", "sesgo", "rmse",
                                    "mad", "senal_rastreo"}},
                        "es_referente": int(modelo.nombre == nombre_referente),
                        "seleccionado": 0, "motivo_decision": None, "cobertura": None,
                    })

            # ---------------------------------------------------------------
            # Regla de seleccion
            # ---------------------------------------------------------------
            agregado = {
                nombre: {
                    "wape": float(np.nanmean([x.wape for x in lista])),
                    "sesgo": float(np.nanmean([x.sesgo for x in lista])),
                    "mase": float(np.nanmean([x.mase for x in lista])),
                }
                for nombre, lista in metricas_por_modelo.items() if lista
            }
            elegido, motivo = self._aplicar_regla_de_paso(detalle, nombre_referente, p)

            wape_ref = agregado.get(nombre_referente, {}).get("wape", float("nan"))
            wape_sel = agregado.get(elegido, {}).get("wape", float("nan"))
            mejora = val.mejora_relativa(wape_ref, wape_sel)

            # ---------------------------------------------------------------
            # Dispersion empirica por horizonte
            # ---------------------------------------------------------------
            sigma_h = self._sigma_por_horizonte(
                errores_por_modelo.get(elegido, []), H, p.horizonte_cv
            )

            # ---------------------------------------------------------------
            # Reserva final: desempeno fuera de muestra del modelo YA elegido
            # ---------------------------------------------------------------
            cobertura_reserva = float("nan")
            corte_final = val.corte_reserva_final(n)
            if corte_final:
                fin_ent, fin_total = corte_final
                ent, prueba = y[:fin_ent], y[fin_ent:fin_total]
                modelo_r = self._instanciar(elegido, p.periodo_estacional)
                pred_r = fc.ajustar_seguro(modelo_r, ent, prueba.size) if modelo_r else None
                if pred_r is not None:
                    s = sigma_h[: prueba.size]
                    inf, sup = np.maximum(pred_r - z_int * s, 0.0), pred_r + z_int * s
                    m = val.evaluar(elegido, fin_ent, prueba, pred_r, ent, inf, sup,
                                    p.periodo_estacional)
                    cobertura_reserva = m.cobertura if m.cobertura is not None else float("nan")
                    filas_validacion.append({
                        "id_corrida": contexto.id_corrida, "sku": str(sku), "modelo": elegido,
                        "tipo_corte": "RESERVA_FINAL", "origen": int(fin_ent),
                        "n_observaciones": int(prueba.size),
                        **{k: v for k, v in m.como_fila().items()
                           if k in {"wape", "mase", "sesgo", "rmse",
                                    "mad", "senal_rastreo", "cobertura"}},
                        "es_referente": int(elegido == nombre_referente),
                        "seleccionado": 1, "motivo_decision": motivo,
                    })

            calibrado = (np.isfinite(cobertura_reserva)
                         and abs(cobertura_reserva - p.cobertura_nominal) <= 0.15)

            # ---------------------------------------------------------------
            # Reajuste sobre toda la historia y proyeccion del horizonte
            # ---------------------------------------------------------------
            modelo_final = self._instanciar(elegido, p.periodo_estacional)
            pred = fc.ajustar_seguro(modelo_final, y, H) if modelo_final else None
            if pred is None:
                pred = np.full(H, float(np.mean(y[-min(3, n):])))
                elegido, motivo = "media_movil", "Salvaguarda: el modelo elegido no convergio"

            for esc in settings.ESCENARIOS:
                escalado = pred * esc.factor_demanda
                s = sigma_h * esc.factor_demanda
                for i, periodo in enumerate(periodos):
                    filas_pronostico.append({
                        "id_corrida": contexto.id_corrida, "sku": str(sku),
                        "centro": contexto.centro, "periodo": periodo, "horizonte": i + 1,
                        "escenario": esc.nombre, "modelo": elegido,
                        "p50": round(float(escalado[i]), 3),
                        "p10": round(float(max(escalado[i] - z_int * s[i], 0.0)), 3),
                        "p90": round(float(escalado[i] + z_int * s[i]), 3),
                        "sigma_residual": round(float(s[i]), 4),
                        "intervalo_calibrado": int(calibrado and (i + 1) <= p.horizonte_cv),
                        "validado": int(bool(cortes)),
                    })

            resumen.append({
                "sku": str(sku), "modelo": elegido, "referente": nombre_referente,
                "wape_referente": wape_ref, "wape_seleccionado": wape_sel,
                "mejora_relativa": mejora, "sesgo": agregado.get(elegido, {}).get("sesgo", np.nan),
                "cobertura_reserva": cobertura_reserva, "intervalo_calibrado": int(calibrado),
                "motivo": motivo, "n_meses": n,
            })

        # =====================================================================
        # Persistencia
        # =====================================================================
        if filas_validacion:
            self.db.insertar_df("validacion_modelos", pd.DataFrame(filas_validacion),
                                modo="INSERT OR REPLACE")
        if filas_pronostico:
            self.db.insertar_df("pronosticos", pd.DataFrame(filas_pronostico),
                                modo="INSERT OR REPLACE")

        df_res = pd.DataFrame(resumen)
        res.datos["resumen_modelos"] = df_res
        res.datos["pronostico"] = pd.DataFrame(filas_pronostico)

        if not df_res.empty:
            adoptaron = df_res["modelo"] != df_res["referente"]
            res.metricas.update({
                "skus_pronosticados": float(len(df_res)),
                "wape_referente_medio": round(float(df_res["wape_referente"].mean(skipna=True)), 4),
                "wape_seleccionado_medio": round(float(df_res["wape_seleccionado"].mean(skipna=True)), 4),
                "mejora_relativa_media": round(float(df_res["mejora_relativa"].mean(skipna=True)), 4),
                "skus_que_superan_al_referente": float(adoptaron.sum()),
                "proporcion_supera_referente": round(float(adoptaron.mean()), 4),
                "cobertura_empirica_media": round(float(df_res["cobertura_reserva"].mean(skipna=True)), 4),
                "cobertura_nominal": p.cobertura_nominal,
                "skus_con_intervalo_calibrado": float(df_res["intervalo_calibrado"].sum()),
            })

            mal_calibrados = df_res[df_res["intervalo_calibrado"] == 0]
            if len(mal_calibrados) > 0.5 * len(df_res):
                res.excepciones.append(ExcepcionPlan(
                    codigo="PRE-004", severidad=Severidad.MEDIA,
                    descripcion=f"{len(mal_calibrados)} de {len(df_res)} SKU tienen intervalos "
                                "cuya cobertura empirica se aparta de la nominal",
                    accion_sugerida="Usar los intervalos como orientacion, no como nivel de "
                                    "servicio; ampliar historia antes de dimensionar con ellos",
                    responsable="Planificacion"))

            sesgados = df_res[df_res["sesgo"].abs() > p.sesgo_maximo]
            for _, r in sesgados.head(10).iterrows():
                res.excepciones.append(ExcepcionPlan(
                    codigo="PRE-005", severidad=Severidad.MEDIA, sku=str(r["sku"]),
                    descripcion=f"Sesgo de {r['sesgo']:+.1%} con el modelo {r['modelo']}: "
                                "los errores no se compensan",
                    accion_sugerida="Revisar quiebres, cambios de surtido o promociones no "
                                    "registradas antes de aceptar el pronostico",
                    responsable="Planificacion"))

        res.evidencia = {
            "protocolo": "rolling-origin CV + reserva final apartada de la seleccion",
            "cortes_cv": f"{p.origenes_cv} origenes, horizonte {p.horizonte_cv} meses, paso {p.paso_origenes}",
            "reserva_final_meses": p.meses_reserva_final,
            "regla_de_paso": (f"mejora WAPE >= {p.mejora_minima_wape:.0%} frente al referente "
                              f"y |sesgo| <= {p.sesgo_maximo:.0%}"),
            "intervalos": (f"dispersion empirica de los errores de validacion; nominal "
                           f"{p.cobertura_nominal:.0%}; extrapolados por sqrt(h) mas alla del "
                           f"horizonte {p.horizonte_cv} y marcados como no calibrados"),
            "limite_declarado": ("el horizonte de validacion es menor que el operativo: con 36 "
                                 "meses no existe evidencia independiente para validar a 12"),
        }
        res.mensaje = f"{len(resumen)} SKU pronosticados a {H} meses"
        return res

    # =========================================================================
    # AUXILIARES
    # =========================================================================
    @staticmethod
    def _instanciar(nombre: str, periodo: int) -> fc.ModeloPronostico | None:
        """Crea una instancia nueva del modelo por su nombre.

        Se reinstancia en lugar de reutilizar: un modelo ya ajustado conserva
        estado del corte anterior y lo arrastraria al reajuste final.
        """
        mapa = {
            "naive_estacional": lambda: fc.NaiveEstacional(periodo),
            "naive_deriva": lambda: fc.NaiveEstacionalDeriva(periodo),
            "holt_winters": lambda: fc.HoltWinters(periodo, True),
            "holt_amortiguado": lambda: fc.HoltWinters(periodo, False),
            "regresion_estacional": lambda: fc.RegresionEstacional(periodo),
            "croston_sba": lambda: fc.CrostonSBA(periodo),
            "media_movil": lambda: fc.MediaMovil(periodo),
        }
        fabrica = mapa.get(nombre)
        return fabrica() if fabrica else None

    @staticmethod
    def _aplicar_regla_de_paso(
        detalle: dict[str, dict[int, dict[str, float]]], referente: str,
        p: settings.ParametrosPronostico,
    ) -> tuple[str, str]:
        """Decide que modelo se adopta y deja constancia del motivo.

        La comparacion es PAREADA POR CORTE. Promediar el WAPE de un modelo
        evaluado en tres origenes contra el de otro evaluado en uno solo no es
        una comparacion: mide cortes distintos, con dificultad distinta. Aqui
        cada candidato se enfrenta al referente unicamente sobre los origenes
        en que AMBOS pudieron estimarse, y se exige un minimo de cortes comunes
        para que la diferencia sea interpretable.

        Consecuencia practica que el sistema declara: con 36 meses de historia,
        un ETS estacional solo alcanza a estimarse en el ultimo origen, no
        reune cortes comunes suficientes y por tanto NO puede desplazar al
        referente. No es que sea peor: es que no hay evidencia para adoptarlo.

        Args:
            detalle: modelo -> origen -> metricas de ese corte.
            referente: nombre del modelo de referencia obligatorio.
            p: parametros de politica de pronostico.

        Returns:
            tuple[str, str]: (modelo elegido, motivo textual de la decision).
        """
        if referente not in detalle or not detalle[referente]:
            if not detalle:
                return "media_movil", "Ningun modelo pudo validarse; salvaguarda"
            mejor = min(
                detalle,
                key=lambda k: float(np.nanmean([v["wape"] for v in detalle[k].values()])),
            )
            return mejor, "Referente no evaluable en ningun corte; se adopta el de menor WAPE"

        cortes_ref = detalle[referente]
        evaluaciones: list[tuple[float, str, str]] = []
        # Se separan dos clases de rechazo que NO son equivalentes y que el
        # resumen anterior confundia:
        #
        #   COMPARATIVO  el modelo compitio y perdio. Es informacion sobre el
        #                modelo.
        #   ESTRUCTURAL  el modelo nunca llego a competir porque la longitud de
        #                la serie no permite construir los cortes comunes que
        #                exige el protocolo. Es informacion sobre LOS DATOS.
        #
        # La distincion importa: un Holt-Winters estacional necesita 24
        # observaciones, de modo que con 36 meses de historia y un horizonte de
        # validacion de 6 meses solo alcanza UN origen valido. Bajo la regla de
        # dos cortes comunes queda excluido por construccion, no por desempeno.
        # Si el motivo no lo dice, el lector concluye que el modelo fue peor,
        # que es una afirmacion falsa y no auditable.
        estructurales: list[str] = []

        for nombre, cortes in detalle.items():
            if nombre == referente:
                continue
            comunes = sorted(set(cortes) & set(cortes_ref))
            if len(comunes) < p.min_cortes_comunes:
                estructurales.append(
                    f"{nombre}: NO EVALUABLE, {len(comunes)} corte(s) comun(es) de los "
                    f"{p.min_cortes_comunes} exigidos (historia insuficiente para su "
                    f"requisito minimo de observaciones)"
                )
                continue

            w_ref = float(np.nanmean([cortes_ref[o]["wape"] for o in comunes]))
            w_can = float(np.nanmean([cortes[o]["wape"] for o in comunes]))
            sesgo_can = float(np.nanmean([cortes[o]["sesgo"] for o in comunes]))
            mejora = val.mejora_relativa(w_ref, w_can)

            if not np.isfinite(mejora):
                evaluaciones.append((-np.inf, nombre, f"{nombre}: mejora no calculable"))
            elif mejora < p.mejora_minima_wape:
                evaluaciones.append((
                    mejora, nombre,
                    f"{nombre}: mejora {mejora:.1%} < umbral {p.mejora_minima_wape:.0%}",
                ))
            elif np.isfinite(sesgo_can) and abs(sesgo_can) > p.sesgo_maximo:
                evaluaciones.append((
                    -np.inf, nombre,
                    f"{nombre}: mejora {mejora:.1%} pero sesgo {sesgo_can:+.1%} "
                    f"excede {p.sesgo_maximo:.0%}",
                ))
            else:
                evaluaciones.append((
                    mejora, nombre,
                    f"Adoptado {nombre}: mejora WAPE {mejora:.1%} sobre el referente en "
                    f"{len(comunes)} cortes comunes, sesgo {sesgo_can:+.1%}",
                ))

        aptos = [e for e in evaluaciones if e[0] >= p.mejora_minima_wape and np.isfinite(e[0])]
        if aptos:
            mejor = max(aptos, key=lambda e: e[0])
            return mejor[1], mejor[2]

        # Las exclusiones estructurales se reportan SIEMPRE y completas: son
        # pocas, y omitirlas equivale a atribuir a bajo desempeno lo que en
        # realidad es una limitacion de la serie historica.
        if evaluaciones or estructurales:
            partes = [e[2] for e in sorted(evaluaciones, key=lambda e: -e[0])[:3]]
            partes += estructurales
            return referente, f"Se conserva el referente. {'; '.join(partes)}"
        return referente, "Sin candidatos alternativos evaluables"

    @staticmethod
    def _sigma_por_horizonte(
        errores: list[np.ndarray], horizonte_operativo: int, horizonte_cv: int
    ) -> np.ndarray:
        """Estima la dispersion del error para cada horizonte del plan.

        Con pocos cortes la desviacion por horizonte es inestable, de modo que
        se usa la agrupada cuando el horizonte no tiene observaciones propias
        suficientes. Mas alla del horizonte validado se extrapola con sqrt(h),
        supuesto de acumulacion de error que el sistema declara explicitamente
        y que obliga a marcar esos intervalos como NO calibrados.

        Args:
            errores: lista de vectores de error por corte.
            horizonte_operativo: meses a pronosticar.
            horizonte_cv: horizonte efectivamente validado.

        Returns:
            np.ndarray: sigma para cada horizonte 1..H.
        """
        H = horizonte_operativo
        if not errores:
            return np.zeros(H)

        largo = max(e.size for e in errores)
        matriz = np.full((len(errores), largo), np.nan)
        for i, e in enumerate(errores):
            matriz[i, : e.size] = e

        # Se usa la RAIZ CUADRATICA MEDIA alrededor de cero, no la desviacion
        # estandar alrededor de la media: el intervalo debe cubrir tambien el
        # sesgo del modelo. Un modelo que subpronostica sistematicamente tiene
        # residuos poco dispersos pero muy desplazados; medir su dispersion
        # alrededor de su propia media produciria intervalos que nunca cubren.
        finitos = matriz[np.isfinite(matriz)]
        pooled = float(np.sqrt(np.mean(finitos ** 2))) if finitos.size > 0 else 0.0
        sigma = np.full(H, pooled)

        for h in range(min(largo, H)):
            col = matriz[:, h]
            col = col[np.isfinite(col)]
            if col.size >= 3:
                # Con 3 observaciones la dispersion por horizonte es inestable y
                # sesgada a la baja. Se toma el MAXIMO contra la agrupada: ante
                # evidencia escasa, el intervalo se amplia, no se estrecha.
                sigma[h] = max(float(np.sqrt(np.mean(col ** 2))), pooled)

        limite = min(horizonte_cv, largo)
        if limite >= 1:
            base = sigma[limite - 1]
            for h in range(limite, H):
                sigma[h] = base * np.sqrt((h + 1) / limite)
        return np.nan_to_num(sigma, nan=pooled, posinf=pooled)

    def _pronostico_salvaguarda(
        self, contexto: ContextoEjecucion, sku: str, y: np.ndarray,
        periodos: list[str], filas: list[dict], resumen: list[dict],
    ) -> None:
        """Genera un pronostico de salvaguarda, marcado como no validado."""
        nivel = float(np.mean(y[-min(3, y.size):])) if y.size else 0.0
        sigma = float(np.std(y, ddof=1)) if y.size > 1 else 0.0
        z = val.cuantil_normal(0.5 + settings.PRONOSTICO.cobertura_nominal / 2.0)
        for esc in settings.ESCENARIOS:
            for i, periodo in enumerate(periodos):
                centro = nivel * esc.factor_demanda
                filas.append({
                    "id_corrida": contexto.id_corrida, "sku": sku, "centro": contexto.centro,
                    "periodo": periodo, "horizonte": i + 1, "escenario": esc.nombre,
                    "modelo": "media_movil", "p50": round(centro, 3),
                    "p10": round(max(centro - z * sigma, 0.0), 3),
                    "p90": round(centro + z * sigma, 3),
                    "sigma_residual": round(sigma, 4),
                    "intervalo_calibrado": 0, "validado": 0,
                })
        resumen.append({
            "sku": sku, "modelo": "media_movil", "referente": "media_movil",
            "wape_referente": np.nan, "wape_seleccionado": np.nan,
            "mejora_relativa": np.nan, "sesgo": np.nan, "cobertura_reserva": np.nan,
            "intervalo_calibrado": 0, "motivo": "Historia insuficiente para validar",
            "n_meses": int(y.size),
        })
