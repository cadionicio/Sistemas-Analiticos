"""Pruebas de aceptacion de la Fase 2.

Cada prueba corresponde a un riesgo concreto del diseno analitico. Varias
verifican propiedades MATEMATICAS contra un calculo independiente (fuerza
bruta, forma cerrada o serie construida con respuesta conocida), no contra la
salida del propio sistema: una prueba que compara el codigo consigo mismo no
prueba nada.

Ejecucion:
    python -m tests.test_fase2
"""

from __future__ import annotations

import itertools
import math
import sys

import numpy as np
import pandas as pd

from agents.core_agent import (
    AgenteControlDatos,
    ContextoEjecucion,
    EstadoAgente,
    SuperAgenteCoordinador,
)
from agents.descriptivo import AgenteDescriptivo
from agents.diagnostico import AgenteDiagnostico
from agents.predictivo import AgentePredictivo
from agents.prescriptivo import AgentePrescriptivo
from config import settings
from db.db_manager import DatabaseManager
from engine import forecasting as fc
from engine import inventario as invm
from engine import simulacion as simm
from engine import validacion as val

_FALLOS: list[str] = []

# Corrida creada por T19 y reutilizada por T17 y T20. Se comparte de forma
# explicita en lugar de consultar "la ultima corrida": esa consulta depende del
# estado global de la base y hace que el resultado de una prueba cambie segun
# que se haya ejecutado antes, que es exactamente lo que una prueba no debe hacer.
_CORRIDA: str | None = None


def verificar(cond: bool, titulo: str, detalle: str = "") -> None:
    """Registra el resultado de una comprobacion."""
    print(f"  [{'OK  ' if cond else 'FALLA'}] {titulo}{(' -> ' + detalle) if detalle else ''}")
    if not cond:
        _FALLOS.append(titulo)


# =============================================================================
def t11_cuantil_normal() -> None:
    """La inversa normal propia reproduce los valores de tabla."""
    print("\nT11 | Cuantil normal sin scipy")
    casos = {0.5: 0.0, 0.90: 1.2815515655, 0.95: 1.6448536270,
             0.975: 1.9599639845, 0.99: 2.3263478740, 0.999: 3.0902323062}
    err = max(abs(val.cuantil_normal(p) - z) for p, z in casos.items())
    verificar(err < 1e-8, "Coincide con la tabla normal estandar", f"error maximo {err:.2e}")
    verificar(abs(val.cuantil_normal(0.25) + val.cuantil_normal(0.75)) < 1e-10,
              "Simetria z(p) = -z(1-p)")
    try:
        val.cuantil_normal(0.0)
        verificar(False, "Rechaza probabilidades fuera de (0,1)")
    except ValueError:
        verificar(True, "Rechaza probabilidades fuera de (0,1)")


def t12_metricas() -> None:
    """Las metricas de exactitud devuelven los valores esperados."""
    print("\nT12 | Metricas de exactitud")
    real = np.array([100.0, 200.0, 300.0, 400.0])
    pron = np.array([110.0, 190.0, 330.0, 360.0])
    # sum|e| = 10+10+30+40 = 90 ; sum real = 1000 -> WAPE = 0.09
    verificar(abs(val.wape(real, pron) - 0.09) < 1e-12, "WAPE exacto", f"{val.wape(real, pron):.4f}")
    # sum(pron-real) = 10-10+30-40 = -10 -> sesgo = -0.01
    verificar(abs(val.sesgo(real, pron) + 0.01) < 1e-12, "Sesgo exacto")
    verificar(math.isnan(val.wape(np.zeros(3), np.ones(3))),
              "WAPE devuelve NaN con total real cero, no division por cero")
    # Dos de cuatro observaciones dentro de su intervalo -> cobertura 0.50
    inferior = np.array([90.0, 190.0, 1000.0, 1000.0])
    superior = np.array([110.0, 210.0, 2000.0, 2000.0])
    cob = val.cobertura(real, inferior, superior)
    verificar(abs(cob - 0.5) < 1e-12, "Cobertura empirica correcta", f"{cob:.2f}")
    verificar(abs(val.cobertura(real, real - 1e6, real + 1e6) - 1.0) < 1e-12,
              "Cobertura 1.0 cuando el intervalo contiene todo")
    # Un pronostico identico al ingenuo estacional debe dar MASE = 1
    y = np.arange(1, 37, dtype=float)
    verificar(abs(val.mase(y[24:36], y[12:24], y[:24], 12) - 1.0) < 1e-9,
              "MASE = 1 cuando el pronostico iguala al ingenuo estacional")


def t13_sin_fuga_temporal() -> None:
    """Los cortes de validacion nunca tocan la reserva ni el futuro."""
    print("\nT13 | Ausencia de fuga temporal en el protocolo")
    n = 36
    reserva = val.reserva_adaptativa(n)
    cortes = val.cortes_rolling_origin(n)
    verificar(len(cortes) >= 2, "Se generan varios origenes", f"{cortes}")
    verificar(all(fin <= n - reserva for _, fin in cortes),
              "Ningun corte invade la reserva final",
              f"reserva={reserva}, max fin={max(f for _, f in cortes)}")
    verificar(all(o < f for o, f in cortes), "El entrenamiento precede a la prueba")
    verificar(all(cortes[i][0] < cortes[i + 1][0] for i in range(len(cortes) - 1)),
              "Los origenes avanzan en el tiempo")
    final = val.corte_reserva_final(n)
    verificar(final is not None and final[0] == n - reserva,
              "La reserva final arranca donde termina el pool", str(final))
    verificar(val.reserva_adaptativa(60) == settings.PRONOSTICO.meses_reserva_final,
              "Con historia larga la reserva vuelve a 12 meses")


def t14_wagner_whitin() -> None:
    """Wagner-Whitin coincide con la enumeracion exhaustiva del optimo."""
    print("\nT14 | Optimalidad de Wagner-Whitin")

    def costo_de_particion(R: np.ndarray, cortes: tuple[int, ...], S: float, h: float) -> float:
        """Costo de una particion en ventanas contiguas."""
        total = 0.0
        limites = [0, *cortes, R.size]
        for a, b in zip(limites[:-1], limites[1:]):
            if R[a:b].sum() <= 1e-9:
                continue
            total += S + h * sum((t - a) * R[t] for t in range(a, b))
        return total

    rng = np.random.default_rng(4242)
    peores = []
    for _ in range(40):
        T = int(rng.integers(6, 11))
        R = np.round(rng.uniform(0, 120, T), 2)
        R[rng.random(T) < 0.25] = 0.0
        S = float(rng.uniform(40, 400))
        h = float(rng.uniform(0.2, 4.0))

        plan = invm.wagner_whitin(R, S, h)
        mejor = min(
            costo_de_particion(R, c, S, h)
            for k in range(T)
            for c in itertools.combinations(range(1, T), k)
        )
        peores.append(abs(plan.costo_total - mejor))

    verificar(max(peores) < 1e-6, "Coincide con el optimo por fuerza bruta en 40 instancias",
              f"desviacion maxima {max(peores):.2e}")

    # Costo de pedido nulo -> conviene pedir en cada periodo con demanda
    R = np.array([10.0, 0.0, 20.0, 30.0])
    plan = invm.wagner_whitin(R, 0.0, 1.0)
    verificar(plan.periodos_pedido == [0, 2, 3],
              "Sin costo fijo, lote a lote es optimo", str(plan.periodos_pedido))
    # Costo de mantener nulo -> conviene un unico pedido
    plan = invm.wagner_whitin(R, 500.0, 0.0)
    verificar(len(plan.periodos_pedido) == 1,
              "Sin costo de mantener, un solo pedido es optimo", str(plan.periodos_pedido))


def t15_teoria_inventarios() -> None:
    """Las formulas de inventario se comportan como exige la teoria."""
    print("\nT15 | Teoria de inventarios")
    # Con sigma_L = 0 la formula de King se reduce a sigma_d * sqrt(L)
    s = invm.sigma_demanda_durante_lead_time(20.0, 100.0, 9.0, 0.0)
    verificar(abs(s - 20.0 * 3.0) < 1e-9, "Con plazo determinista se reduce a sigma_d*sqrt(L)",
              f"{s:.4f}")
    # El termino de plazo domina cuando la demanda media es alta
    s_con = invm.sigma_demanda_durante_lead_time(20.0, 100.0, 9.0, 2.0)
    verificar(s_con > s * 3, "El termino d^2*sigma_L^2 domina con plazo volatil",
              f"{s:.1f} -> {s_con:.1f}")

    # Ejemplo trazable de los documentos base: d=100, L=10, sigma_d=20, z=1.645
    ss = invm.stock_seguridad(1.645, 20.0, 100.0, 10.0, 0.0)
    rop = invm.punto_pedido(100.0, 10.0, ss)
    verificar(abs(ss - 104.0) < 0.5 and abs(rop - 1104.0) < 0.5,
              "Reproduce el ejemplo de punto de pedido de la investigacion base",
              f"SS={ss:.1f}, ROP={rop:.1f}")

    # EOQ de Harris
    q = invm.eoq(3600.0, 100.0, 2.0)
    verificar(abs(q - math.sqrt(2 * 3600 * 100 / 2)) < 1e-9, "EOQ de Harris exacto", f"{q:.2f}")

    # Redondeo: empaque 50, MOQ 100
    verificar(invm.redondear_lote(0.0, 50, 100) == 0.0,
              "Sin necesidad no se compra el MOQ")
    verificar(invm.redondear_lote(30, 50, 100) == 100.0, "Respeta el minimo de compra")
    verificar(invm.redondear_lote(650, 50, 100) == 650.0, "Multiplo exacto no se infla")
    verificar(invm.redondear_lote(651, 50, 100) == 700.0, "Redondea hacia arriba al empaque")


def t16_modelos_pronostico() -> None:
    """Cada modelo recupera la estructura que dice modelar."""
    print("\nT16 | Comportamiento de los modelos de pronostico")
    estacion = np.array([100, 90, 110, 130, 120, 115, 105, 95, 125, 135, 140, 160], float)
    serie = np.tile(estacion, 3)

    m = fc.NaiveEstacional(12).ajustar(serie)
    verificar(np.allclose(m.predecir(12), estacion),
              "El referente estacional reproduce exactamente un ciclo puro")

    tendencia = serie + np.arange(36) * 5.0
    m2 = fc.NaiveEstacionalDeriva(12).ajustar(tendencia)
    verificar(abs(m2.deriva - 60.0) < 1e-6, "La deriva interanual estimada es exacta",
              f"{m2.deriva:.2f}")

    m3 = fc.RegresionEstacional(12).ajustar(tendencia)
    esperado = tendencia[-12:] + 60.0
    verificar(np.allclose(m3.predecir(12), esperado, rtol=1e-6),
              "La regresion recupera tendencia lineal mas estacionalidad")

    m4 = fc.HoltWinters(12, True).ajustar(tendencia)
    err = float(np.mean(np.abs(m4.predecir(12) - esperado) / esperado))
    verificar(err < 0.06, "Holt-Winters sigue la senal deterministica", f"error medio {err:.2%}")

    intermitente = np.zeros(36)
    intermitente[::5] = 20.0
    verificar(fc.es_intermitente(intermitente), "Detecta la serie intermitente")
    m5 = fc.CrostonSBA(12).ajustar(intermitente)
    tasa = float(m5.predecir(1)[0])
    # Tasa verdadera 20/5 = 4. SBA aplica la correccion de sesgo (1 - alpha/2)
    # = 0.925, de modo que el valor esperado es 3.70 y NO 4.00: subestimar en
    # ese factor es el comportamiento correcto del estimador, no un error.
    verificar(abs(tasa - 3.70) < 0.25, "Croston-SBA estima 20/5 con la correccion "
              "de sesgo (1 - alpha/2) = 3.70", f"{tasa:.2f}")

    verificar(all(np.all(mm.predecir(6) >= 0) for mm in (m, m2, m3, m4, m5)),
              "Ningun modelo pronostica demanda negativa")

    # Minimos por modelo: el bug que habria excluido al referente de la validacion
    verificar(fc.NaiveEstacional(12).min_observaciones() == 13
              and fc.HoltWinters(12, True).min_observaciones() == 24,
              "Cada familia declara su propio minimo de observaciones")


def t17_balance_canasta(db: DatabaseManager) -> None:
    """La canasta cuadra el balance material en todas sus lineas."""
    print("\nT17 | Balance material de la canasta")
    par = invm.ParametrosArticulo(
        sku="TEST", proveedor_id="PRV001", inventario_inicial=450.0,
        precio_unitario=4.0, costo_unitario=4.0, lote_multiplo=50.0, moq=100.0,
        lead_time_dias=30.0, sigma_lead_time_dias=5.0, stock_seguridad=300.0,
    )
    D = np.array([1000.0])
    C = np.array([200.0])
    filas, _ = invm.proyectar_balance(D, par, C, usar_wagner_whitin=False)
    # Ejemplo de la investigacion base: 1000 + 300 - 450 - 200 = 650
    verificar(abs(filas[0].necesidad_neta - 650.0) < 1e-6,
              "Reproduce la necesidad neta del ejemplo retail (650 bolsas)",
              f"{filas[0].necesidad_neta:.1f}")
    verificar(abs(filas[0].compra - 650.0) < 1e-6, "La compra respeta empaque 50 y minimo 100")
    verificar(abs(filas[0].inventario_final - 300.0) < 1e-6, "El cierre iguala la reserva")

    assert _CORRIDA is not None, "T17 requiere que T19 se haya ejecutado antes"
    canasta = db.consultar_df(
        "SELECT * FROM canasta_compras WHERE escenario = 'BASE' AND id_corrida = ?;",
        (_CORRIDA,),
    )
    verificar(not canasta.empty, "Existe canasta BASE persistida", f"{len(canasta)} lineas")
    if not canasta.empty:
        atendida = canasta["demanda_plan"] - canasta["faltante"]
        esperado = (canasta["inventario_inicial"] + canasta["recepcion_confirmada"]
                    + canasta["compra_propuesta"] - atendida)
        desv = float((esperado - canasta["inventario_final"]).abs().max())
        verificar(desv < 0.05, "Balance exacto en todas las lineas persistidas",
                  f"desviacion maxima {desv:.4f}")
        verificar(bool((canasta["inventario_final"] >= -1e-6).all()), "Sin inventario negativo")
        verificar(bool((canasta["costo_compra"] >= 0).all()), "Sin costos negativos")
        continuidad = 0
        for _, g in canasta.sort_values(["sku", "horizonte"]).groupby("sku"):
            prev = g["inventario_final"].shift(1).dropna()
            act = g["inventario_inicial"].iloc[1:]
            continuidad += int((prev.values - act.values > 0.05).sum())
        verificar(continuidad == 0, "Continuidad recursiva entre periodos",
                  f"{continuidad} discontinuidades")


def t18_simulacion_estocastica() -> None:
    """El modelo estocastico induce la correlacion declarada y es coherente."""
    print("\nT18 | Simulacion Monte Carlo")
    w = settings.MONTECARLO.peso_factor_comun
    corr = simm.correlacion_inducida(n=20000, w=w)
    verificar(abs(corr - w) < 0.03, "La descomposicion de shocks induce la correlacion w",
              f"objetivo {w:.2f}, obtenido {corr:.3f}")
    verificar(abs(simm.correlacion_inducida(n=20000, w=0.0)) < 0.03,
              "Con w = 0 los articulos quedan independientes")

    S, T = 8, 12
    rng = np.random.default_rng(3)
    entrada = simm.EntradaSimulacion(
        p50=np.full((S, T), 100.0), sigma=np.full((S, T), 15.0),
        # Suministro deliberadamente insuficiente (90 frente a 100 de demanda)
        # para que el fill rate sea informativo: con exceso de inventario la
        # prueba pasaria siempre sin ejercitar nada.
        compras=np.full((S, T), 90.0), inventario_inicial=np.full(S, 60.0),
        precio=np.full(S, 5.0), costo_unitario=np.full(S, 4.0),
        lt_plan_dias=np.full(S, 20.0), ln_mu=np.full(S, 2.3),
        ln_sigma=np.full(S, 0.3), lt_min_dias=np.full(S, 5.0),
    )
    r = simm.simular_escenario(entrada, settings.ESCENARIOS[0], n_iteraciones=300)
    fr = r["fill_rate"]
    verificar(fr["p50"] < 1.0, "El escenario base con suministro ajustado muestra quiebre",
              f"fill rate p50 = {fr['p50']:.3f}")
    verificar(fr["p05"] <= fr["p50"] <= fr["p95"], "Los percentiles estan ordenados",
              f"p05={fr['p05']:.3f} p50={fr['p50']:.3f} p95={fr['p95']:.3f}")
    verificar(0.0 <= fr["minimo"] and fr["maximo"] <= 1.0 + 1e-9,
              "El fill rate permanece en [0,1]")

    disr = next(e for e in settings.ESCENARIOS if e.nombre == "DISRUPCION")
    r2 = simm.simular_escenario(entrada, disr, n_iteraciones=300)
    verificar(r2["fill_rate"]["p50"] < fr["p50"],
              "El escenario de disrupcion no mejora el servicio",
              f"BASE {fr['p50']:.3f} vs DISRUPCION {r2['fill_rate']['p50']:.3f}")


def t19_pipeline_completo(db: DatabaseManager) -> None:
    """Los cinco agentes se ordenan, ejecutan y persisten correctamente."""
    global _CORRIDA
    print("\nT19 | Pipeline completo del superagente")
    coord = SuperAgenteCoordinador(db=db)
    coord.registrar_varios([
        AgentePrescriptivo(db=db), AgentePredictivo(db=db), AgenteDiagnostico(db=db),
        AgenteDescriptivo(db=db), AgenteControlDatos(db=db),
    ])
    orden = coord._orden_ejecucion()
    verificar(orden == ["control_datos", "descriptivo", "diagnostico",
                        "predictivo", "prescriptivo"],
              "El orden topologico respeta la causalidad analitica", " -> ".join(orden))

    ctx = ContextoEjecucion(
        id_corrida=SuperAgenteCoordinador.nueva_corrida("T19"),
        fecha_corte=settings.SIMULACION.fecha_corte,
        escenarios=tuple(e.nombre for e in settings.ESCENARIOS),
    )
    resultados = coord.ejecutar_pipeline(ctx)
    _CORRIDA = ctx.id_corrida
    ok = all(r.estado in {EstadoAgente.CALCULADO, EstadoAgente.OBSERVADO}
             for r in resultados.values())
    verificar(ok, "Los cinco agentes concluyen sin fallo tecnico",
              ", ".join(f"{k}={v.estado.value}" for k, v in resultados.items()))

    for tabla in ("demanda_mensual", "validacion_modelos", "pronosticos",
                  "canasta_compras", "simulacion_resultados"):
        n = int(db.consultar_escalar(
            f"SELECT COUNT(*) FROM {tabla} WHERE id_corrida = ?;", (ctx.id_corrida,)) or 0)
        verificar(n > 0, f"La tabla {tabla} recibe resultados de la corrida", f"{n} filas")

    escenarios = db.consultar_df(
        "SELECT DISTINCT escenario FROM canasta_compras WHERE id_corrida = ?;",
        (ctx.id_corrida,))
    verificar(len(escenarios) == len(settings.ESCENARIOS),
              "La canasta cubre todos los escenarios",
              ", ".join(sorted(escenarios["escenario"])))


def t20_referente_y_regla(db: DatabaseManager) -> None:
    """El referente se evalua siempre y la regla de paso se aplica de verdad."""
    print("\nT20 | Referente obligatorio y regla de seleccion")
    assert _CORRIDA is not None, "T20 requiere que T19 se haya ejecutado antes"
    corrida = _CORRIDA
    v = db.consultar_df(
        "SELECT sku, modelo, tipo_corte, origen, wape, sesgo, es_referente, seleccionado, "
        "motivo_decision FROM validacion_modelos WHERE id_corrida = ?;", (corrida,))
    verificar(not v.empty, "Existen registros de validacion", f"{len(v)} filas")

    cv = v[v["tipo_corte"] == "CV"]
    skus = set(cv["sku"].unique())
    con_ref = set(cv.loc[cv["es_referente"] == 1, "sku"].unique())
    verificar(skus == con_ref,
              "El referente fue evaluado en TODOS los SKU (regresion del fallo detectado)",
              f"{len(con_ref)} de {len(skus)}")

    seleccion = v[v["seleccionado"] == 1]
    verificar(not seleccion.empty and seleccion["motivo_decision"].notna().all(),
              "Toda seleccion deja constancia escrita del motivo")

    modelos = set(cv["modelo"].unique())
    verificar(len(modelos) >= 3, "Se comparan varias familias de modelos",
              ", ".join(sorted(modelos)))

    pron = db.consultar_df(
        "SELECT p10, p50, p90, intervalo_calibrado, validado FROM pronosticos "
        "WHERE id_corrida = ?;", (corrida,))
    verificar(bool((pron["p10"] <= pron["p50"]).all() and (pron["p50"] <= pron["p90"]).all()),
              "Los intervalos son coherentes: p10 <= p50 <= p90")
    verificar(bool((pron["p10"] >= 0).all()), "Ningun limite inferior es negativo")

    res = db.consultar_df(
        "SELECT metrica, valor FROM resultados_analisis WHERE id_corrida = ? "
        "AND tipo_analisis = 'PREDICTIVO';", (corrida,))
    m = dict(zip(res["metrica"], res["valor"]))
    cob = float(m.get("cobertura_empirica_media", float("nan")))
    verificar(np.isfinite(m.get("wape_referente_medio", np.nan)),
              "El WAPE del referente es un numero, no NaN",
              f"{m.get('wape_referente_medio')}")
    verificar(abs(cob - settings.PRONOSTICO.cobertura_nominal) < 0.15,
              "La cobertura empirica se aproxima a la nominal",
              f"empirica {cob:.1%} vs nominal {settings.PRONOSTICO.cobertura_nominal:.0%}")


# =============================================================================
def main() -> int:
    """Ejecuta la bateria completa de la Fase 2."""
    print("=" * 78)
    print("  PRUEBAS DE ACEPTACION - SAPA FASE 2")
    print("=" * 78)
    db = DatabaseManager()

    t11_cuantil_normal()
    t12_metricas()
    t13_sin_fuga_temporal()
    t14_wagner_whitin()
    t15_teoria_inventarios()
    t16_modelos_pronostico()
    t19_pipeline_completo(db)
    t17_balance_canasta(db)
    t18_simulacion_estocastica()
    t20_referente_y_regla(db)

    print("\n" + "=" * 78)
    if _FALLOS:
        print(f"  RESULTADO: {len(_FALLOS)} COMPROBACION(ES) FALLIDA(S)")
        for f in _FALLOS:
            print(f"    - {f}")
        print("=" * 78)
        return 1
    print("  RESULTADO: TODAS LAS COMPROBACIONES PASARON")
    print("=" * 78)
    return 0


if __name__ == "__main__":
    sys.exit(main())
