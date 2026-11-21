"""Motor de simulacion estocastica multiescenario (Monte Carlo).

Responde al requerimiento de "simulacion de escenarios considerando un modelo
estocastico". Lo que se simula NO es el pronostico -eso ya se hizo- sino la
EJECUCION del plan de compras bajo incertidumbre conjunta de demanda y plazo.
La pregunta que contesta es: dada esta canasta aprobada, que probabilidad hay
de quebrar, cuanto costara y cuanta caja hara falta.

Dos decisiones de modelado que distinguen esto de un generador de numeros:

1.  CORRELACION ENTRE ARTICULOS. El shock de demanda se descompone en un
    factor comun (ciclo, campana, clima) y uno idiosincratico:

        z = sqrt(w) * z_comun + sqrt(1-w) * z_propio      con z ~ N(0,1)

    y la correlacion entre dos SKU cualesquiera resulta exactamente `w`. Con
    shocks independientes (w = 0) la agregacion cancela las colas y el P90 del
    total sale artificialmente bajo: es el error de "sumar el P90 de cada
    articulo" que invalida cualquier dimensionamiento de caja o de almacen.

2.  EL PLAZO TAMBIEN ES ALEATORIO. Cada recepcion planificada se desplaza
    segun un lead time muestreado de la log-normal desplazada calibrada en la
    Fase 1. Un plan materialmente suficiente puede quebrar solo porque el
    material llega un mes tarde, y ese riesgo no aparece si el plazo se trata
    como constante.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from config import settings

_DIAS_MES = 30.4375
_EPS = 1e-9


@dataclass(frozen=True)
class EntradaSimulacion:
    """Insumos vectorizados de la simulacion.

    Todas las matrices son (S, T): S articulos por T periodos del horizonte.

    Attributes:
        p50: demanda central pronosticada.
        sigma: desviacion del error de pronostico por articulo y horizonte,
            estimada empiricamente en la validacion temporal.
        compras: cantidades de la canasta a recibir en cada periodo.
        inventario_inicial: existencias utilizables al inicio del horizonte.
        precio: precio unitario de compra.
        costo_unitario: costo de valorizacion del inventario.
        lt_plan_dias: plazo planificado usado al fijar las fechas de emision.
        ln_mu, ln_sigma, lt_min_dias: parametros de la log-normal desplazada.
    """

    p50: np.ndarray
    sigma: np.ndarray
    compras: np.ndarray
    inventario_inicial: np.ndarray
    precio: np.ndarray
    costo_unitario: np.ndarray
    lt_plan_dias: np.ndarray
    ln_mu: np.ndarray
    ln_sigma: np.ndarray
    lt_min_dias: np.ndarray


def simular_escenario(
    entrada: EntradaSimulacion,
    escenario: settings.EscenarioSimulacion,
    n_iteraciones: int | None = None,
    peso_factor_comun: float | None = None,
    semilla: int | None = None,
) -> dict[str, dict[str, float]]:
    """Ejecuta la simulacion de un escenario y devuelve metricas con percentiles.

    Args:
        entrada: matrices de insumos.
        escenario: factores multiplicativos declarados del escenario.
        n_iteraciones: replicas; por defecto `settings.MONTECARLO`.
        peso_factor_comun: correlacion inducida entre articulos.
        semilla: semilla del generador; fija la reproducibilidad.

    Returns:
        dict: metrica -> {media, p05, p50, p95, minimo, maximo}.
    """
    mc = settings.MONTECARLO
    n = mc.n_iteraciones if n_iteraciones is None else int(n_iteraciones)
    w = mc.peso_factor_comun if peso_factor_comun is None else float(peso_factor_comun)
    rng = np.random.default_rng(mc.semilla if semilla is None else semilla)

    S, T = entrada.p50.shape

    # --- Demanda estocastica correlacionada ---------------------------------
    # cv por articulo y horizonte, acotado: un cv superior a 1.5 indica una
    # serie que el modelo no explica y produciria ruido dominante.
    base = np.maximum(entrada.p50, 1.0)
    cv = np.clip(entrada.sigma / base, 0.0, 1.5)

    z_comun = rng.standard_normal((n, 1, T))
    z_propio = rng.standard_normal((n, S, T))
    z = math_sqrt(w) * z_comun + math_sqrt(1.0 - w) * z_propio

    demanda = entrada.p50[None, :, :] * escenario.factor_demanda * (1.0 + cv[None, :, :] * z)
    demanda = np.maximum(demanda, 0.0)

    # --- Desplazamiento de recepciones por lead time aleatorio ---------------
    lt_real = (entrada.lt_min_dias[None, :, None]
               + rng.lognormal(mean=entrada.ln_mu[None, :, None],
                               sigma=np.maximum(entrada.ln_sigma[None, :, None], _EPS),
                               size=(n, S, T))) * escenario.factor_lead_time
    retraso_meses = np.maximum(
        0, np.rint((lt_real - entrada.lt_plan_dias[None, :, None]) / _DIAS_MES).astype(int)
    )

    # Reprograma cada recepcion planificada al periodo en que realmente llega.
    recepciones = np.zeros((n, S, T))
    compras = entrada.compras[None, :, :] * np.ones((n, 1, 1))
    for t in range(T):
        destino = np.minimum(t + retraso_meses[:, :, t], T - 1)
        # np.add.at evita perder colisiones cuando dos recepciones caen en el
        # mismo periodo destino.
        idx_i, idx_s = np.meshgrid(np.arange(n), np.arange(S), indexing="ij")
        np.add.at(recepciones, (idx_i, idx_s, destino), compras[:, :, t])

    # --- Simulacion recursiva del inventario ---------------------------------
    inv = np.repeat(entrada.inventario_inicial[None, :], n, axis=0)
    total_demanda = np.zeros(n)
    total_atendida = np.zeros(n)
    total_faltante = np.zeros(n)
    inv_valorizado = np.zeros(n)
    meses_con_algun_quiebre = np.zeros(n)
    sku_mes_con_quiebre = np.zeros(n)

    for t in range(T):
        disponible = inv + recepciones[:, :, t]
        d_t = demanda[:, :, t]
        atendida = np.minimum(d_t, disponible)
        faltante = d_t - atendida
        inv = disponible - atendida

        total_demanda += d_t.sum(axis=1)
        total_atendida += atendida.sum(axis=1)
        total_faltante += faltante.sum(axis=1)
        inv_valorizado += (inv * entrada.costo_unitario[None, :]).sum(axis=1)
        # Dos granularidades distintas y NO intercambiables:
        #   - meses en que ALGUN articulo quebro: con 50 SKU tiende a 12 de 12
        #     incluso con servicio excelente, y leerlo como "12 meses de
        #     desabastecimiento" seria una alarma falsa.
        #   - proporcion de pares articulo-mes con quiebre: es la medida que
        #     realmente dimensiona el problema.
        meses_con_algun_quiebre += (faltante.sum(axis=1) > _EPS).astype(float)
        sku_mes_con_quiebre += (faltante > _EPS).sum(axis=1).astype(float)

    desembolso = float((entrada.compras * entrada.precio[:, None]).sum()) * escenario.factor_costo

    fill_rate = np.where(total_demanda > _EPS, total_atendida / np.maximum(total_demanda, _EPS), 1.0)
    inv_medio = inv_valorizado / max(T, 1)
    # Valor de la venta perdida a precio de compra: cota inferior prudente del
    # impacto economico. El margen perdido es mayor, pero exige dato comercial.
    valor_faltante = (total_faltante * float(np.mean(entrada.precio)))

    metricas = {
        "fill_rate": fill_rate,
        "unidades_faltantes": total_faltante,
        "valor_faltante_pen": valor_faltante,
        "inventario_medio_pen": inv_medio,
        "meses_con_algun_quiebre": meses_con_algun_quiebre,
        "proporcion_sku_mes_con_quiebre": sku_mes_con_quiebre / float(max(S * T, 1)),
        "desembolso_total_pen": np.full(n, desembolso),
    }
    return {k: _percentiles(v) for k, v in metricas.items()}


def math_sqrt(x: float) -> float:
    """Raiz cuadrada acotada a valores no negativos."""
    return float(np.sqrt(max(float(x), 0.0)))


def _percentiles(v: np.ndarray) -> dict[str, float]:
    """Resume una muestra en media, percentiles y extremos."""
    v = np.asarray(v, dtype=float)
    return {
        "media": float(np.mean(v)),
        "p05": float(np.percentile(v, 5)),
        "p50": float(np.percentile(v, 50)),
        "p95": float(np.percentile(v, 95)),
        "minimo": float(np.min(v)),
        "maximo": float(np.max(v)),
    }


def correlacion_inducida(
    n: int = 4000, w: float = 0.45, semilla: int = 11
) -> float:
    """Comprueba empiricamente que el factor comun induce la correlacion `w`.

    Sirve de autoverificacion del modelo estocastico: si esta funcion no
    devuelve aproximadamente `w`, la descomposicion de shocks esta mal
    implementada y toda la agregacion de riesgo seria incorrecta.

    Returns:
        float: correlacion media entre pares de series simuladas.
    """
    rng = np.random.default_rng(semilla)
    z_comun = rng.standard_normal((n, 1))
    z_propio = rng.standard_normal((n, 2))
    z = math_sqrt(w) * z_comun + math_sqrt(1.0 - w) * z_propio
    return float(np.corrcoef(z[:, 0], z[:, 1])[0, 1])
