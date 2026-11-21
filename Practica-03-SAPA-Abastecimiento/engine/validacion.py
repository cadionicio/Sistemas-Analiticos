"""Metricas de exactitud y protocolo de validacion temporal.

La evaluacion debe simular lo que el planificador habria conocido en cada
fecha. Por eso aqui NO existe ninguna funcion de particion aleatoria: un
`train_test_split` sobre una serie temporal entrena con el futuro y produce un
error de prueba optimista que no se reproduce jamas en operacion.

Todas las metricas devuelven FRACCIONES (0.07 = 7%), no porcentajes. La
conversion a porcentaje es responsabilidad de la capa de presentacion; hacerla
aqui invita a comparar magnitudes en escalas distintas.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from config import settings


# =============================================================================
# CUANTIL NORMAL (sustituto de scipy.stats.norm.ppf)
# =============================================================================
# Coeficientes de la aproximacion racional de Acklam para la inversa de la
# funcion de distribucion normal estandar. Error relativo < 1.15e-9 en todo el
# dominio tras un paso de refinamiento de Halley.
_A = (-3.969683028665376e01, 2.209460984245205e02, -2.759285104469687e02,
      1.383577518672690e02, -3.066479806614716e01, 2.506628277459239e00)
_B = (-5.447609879822406e01, 1.615858368580409e02, -1.556989798598866e02,
      6.680131188771972e01, -1.328068155288572e01)
_C = (-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e00,
      -2.549732539343734e00, 4.374664141464968e00, 2.938163982698783e00)
_D = (7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e00,
      3.754408661907416e00)
_P_BAJO = 0.02425


def cuantil_normal(p: float) -> float:
    """Inversa de la funcion de distribucion normal estandar.

    Args:
        p: probabilidad acumulada en (0, 1).

    Returns:
        float: z tal que Phi(z) = p.

    Raises:
        ValueError: si p no esta en (0, 1).
    """
    if not 0.0 < p < 1.0:
        raise ValueError(f"p debe estar en (0,1); recibido {p}")

    if p < _P_BAJO:
        q = math.sqrt(-2.0 * math.log(p))
        z = (((((_C[0] * q + _C[1]) * q + _C[2]) * q + _C[3]) * q + _C[4]) * q + _C[5]) / \
            ((((_D[0] * q + _D[1]) * q + _D[2]) * q + _D[3]) * q + 1.0)
    elif p <= 1.0 - _P_BAJO:
        q = p - 0.5
        r = q * q
        z = (((((_A[0] * r + _A[1]) * r + _A[2]) * r + _A[3]) * r + _A[4]) * r + _A[5]) * q / \
            (((((_B[0] * r + _B[1]) * r + _B[2]) * r + _B[3]) * r + _B[4]) * r + 1.0)
    else:
        q = math.sqrt(-2.0 * math.log(1.0 - p))
        z = -(((((_C[0] * q + _C[1]) * q + _C[2]) * q + _C[3]) * q + _C[4]) * q + _C[5]) / \
             ((((_D[0] * q + _D[1]) * q + _D[2]) * q + _D[3]) * q + 1.0)

    # Refinamiento de Halley sobre e = Phi(z) - p
    e = 0.5 * math.erfc(-z / math.sqrt(2.0)) - p
    u = e * math.sqrt(2.0 * math.pi) * math.exp(z * z / 2.0)
    return z - u / (1.0 + z * u / 2.0)


# =============================================================================
# METRICAS DE EXACTITUD
# =============================================================================
def wape(real: np.ndarray, pron: np.ndarray) -> float:
    """Weighted Absolute Percentage Error.

        WAPE = sum|real - pron| / sum|real|

    Se prefiere a MAPE porque MAPE es indefinido con reales en cero y explota
    con reales pequenos, situacion habitual en repuestos e intermitentes.

    Args:
        real: observaciones.
        pron: pronosticos alineados.

    Returns:
        float: error como fraccion; NaN si el total real es cero.
    """
    real, pron = np.asarray(real, float), np.asarray(pron, float)
    denom = float(np.abs(real).sum())
    if denom <= 1e-12:
        return float("nan")
    return float(np.abs(real - pron).sum() / denom)


def mad(real: np.ndarray, pron: np.ndarray) -> float:
    """Mean Absolute Deviation (desviacion absoluta media).

        MAD = (1/n) * sum|real - pron|

    Es la metrica clasica de la literatura de suavizacion exponencial y la que
    alimenta la senal de rastreo (tracking signal = suma acumulada del error /
    MAD), por lo que se calcula y se persiste para cada corte y cada modelo.

    ADVERTENCIA METODOLOGICA, deliberada y documentada
    --------------------------------------------------
    MAD NO se usa como criterio de seleccion entre SKU. Esta expresada en
    unidades del articulo, de modo que su magnitud depende del volumen: un SKU
    de alta rotacion tendra siempre un MAD mayor que uno de baja rotacion
    aunque su ajuste relativo sea mejor. Ordenar modelos por MAD a traves de un
    portafolio de 50 SKU heterogeneos equivale a ordenar por volumen, no por
    exactitud. Por eso la decision se toma sobre WAPE (adimensional) y MASE
    (escalada contra el paseo aleatorio estacional), y MAD queda como dato de
    control comparable DENTRO de un mismo SKU y como insumo de la senal de
    rastreo. Ver `engine.forecasting` y el Manual Descriptivo.

    Args:
        real: observaciones.
        pron: pronosticos alineados.

    Returns:
        float: desviacion absoluta media en unidades del articulo; NaN si no
        hay observaciones.
    """
    real, pron = np.asarray(real, float), np.asarray(pron, float)
    if real.size == 0:
        return float("nan")
    return float(np.mean(np.abs(real - pron)))


def senal_rastreo(real: np.ndarray, pron: np.ndarray) -> float:
    """Tracking signal: error acumulado con signo dividido por el MAD.

        TS = sum(pron - real) / MAD

    Criterio operativo clasico (Brown, 1959): |TS| > 4 indica que el modelo ha
    perdido el nivel y el error dejo de comportarse como ruido centrado. Se
    calcula para dejar constancia auditable de que el sesgo detectado por la
    metrica relativa tiene tambien lectura en la escala del articulo.

    Returns:
        float: senal de rastreo; NaN si el MAD es nulo o indefinido.
    """
    m = mad(real, pron)
    if not np.isfinite(m) or m <= 1e-12:
        return float("nan")
    real, pron = np.asarray(real, float), np.asarray(pron, float)
    return float((pron - real).sum() / m)


def sesgo(real: np.ndarray, pron: np.ndarray) -> float:
    """Sesgo relativo. Positivo = sobrepronostico.

        sesgo = sum(pron - real) / sum(real)

    Un WAPE bajo con sesgo alto significa errores que NO se compensan: el
    sistema comprara de mas o de menos de forma sistematica.
    """
    real, pron = np.asarray(real, float), np.asarray(pron, float)
    denom = float(real.sum())
    if abs(denom) <= 1e-12:
        return float("nan")
    return float((pron - real).sum() / denom)


def rmse(real: np.ndarray, pron: np.ndarray) -> float:
    """Raiz del error cuadratico medio."""
    real, pron = np.asarray(real, float), np.asarray(pron, float)
    return float(np.sqrt(np.mean((real - pron) ** 2)))


def mase(real: np.ndarray, pron: np.ndarray, entrenamiento: np.ndarray,
         periodo: int = 12) -> float:
    """Mean Absolute Scaled Error (Hyndman y Koehler).

        MASE = MAE(pronostico) / MAE(ingenuo estacional en entrenamiento)

    El escalado por un referente calculado EN ENTRENAMIENTO permite comparar
    series de distinta magnitud. MASE < 1 significa mejor que repetir el mismo
    mes del ano anterior.

    Args:
        real: observaciones de prueba.
        pron: pronosticos alineados.
        entrenamiento: serie de entrenamiento, para el denominador.
        periodo: estacionalidad (12 = mensual anual).

    Returns:
        float: error escalado; NaN si el denominador es cero.
    """
    real, pron = np.asarray(real, float), np.asarray(pron, float)
    ent = np.asarray(entrenamiento, float)
    if ent.size <= periodo:
        periodo = 1
    if ent.size <= periodo:
        return float("nan")
    escala = float(np.mean(np.abs(ent[periodo:] - ent[:-periodo])))
    if escala <= 1e-12:
        return float("nan")
    return float(np.mean(np.abs(real - pron)) / escala)


def cobertura(real: np.ndarray, inferior: np.ndarray, superior: np.ndarray) -> float:
    """Proporcion de observaciones dentro del intervalo de prediccion.

    Se reporta junto a la cobertura nominal. Un intervalo nominal de 80% cuya
    cobertura empirica es 55% esta mal calibrado y no debe usarse para
    dimensionar stock de seguridad.
    """
    real = np.asarray(real, float)
    inf, sup = np.asarray(inferior, float), np.asarray(superior, float)
    if real.size == 0:
        return float("nan")
    return float(np.mean((real >= inf) & (real <= sup)))


@dataclass(frozen=True)
class ResumenExactitud:
    """Conjunto de metricas de un modelo en un corte de validacion."""

    modelo: str
    origen: int
    n_observaciones: int
    wape: float
    mase: float
    sesgo: float
    rmse: float
    mad: float = float("nan")
    senal_rastreo: float = float("nan")
    cobertura: float | None = None

    def como_fila(self) -> dict[str, float | str | int | None]:
        """Devuelve el resumen como diccionario para persistencia."""
        return {
            "modelo": self.modelo,
            "origen": self.origen,
            "n_observaciones": self.n_observaciones,
            "wape": None if math.isnan(self.wape) else round(self.wape, 6),
            "mase": None if self.mase is None or math.isnan(self.mase) else round(self.mase, 6),
            "sesgo": None if math.isnan(self.sesgo) else round(self.sesgo, 6),
            "rmse": round(self.rmse, 6),
            "mad": None if math.isnan(self.mad) else round(self.mad, 6),
            "senal_rastreo": None if math.isnan(self.senal_rastreo)
                             else round(self.senal_rastreo, 6),
            "cobertura": None if self.cobertura is None or math.isnan(self.cobertura)
                         else round(self.cobertura, 6),
        }


def evaluar(
    modelo: str, origen: int, real: np.ndarray, pron: np.ndarray,
    entrenamiento: np.ndarray, inferior: np.ndarray | None = None,
    superior: np.ndarray | None = None, periodo: int = 12,
) -> ResumenExactitud:
    """Calcula el paquete completo de metricas de un corte."""
    cob = (cobertura(real, inferior, superior)
           if inferior is not None and superior is not None else None)
    return ResumenExactitud(
        modelo=modelo,
        origen=origen,
        n_observaciones=int(np.asarray(real).size),
        wape=wape(real, pron),
        mase=mase(real, pron, entrenamiento, periodo),
        sesgo=sesgo(real, pron),
        rmse=rmse(real, pron),
        mad=mad(real, pron),
        senal_rastreo=senal_rastreo(real, pron),
        cobertura=cob,
    )


# =============================================================================
# PROTOCOLO DE CORTES TEMPORALES
# =============================================================================
def reserva_adaptativa(n_total: int) -> int:
    """Meses de reserva final que la longitud de la serie permite sostener.

    Con historia larga se reserva el horizonte operativo completo (12 meses),
    que es lo deseable: el desempeno se reporta al mismo horizonte que se
    planifica. Con historia corta esa reserva deja un pool insuficiente para
    que los origenes de validacion alcancen los dos ciclos que necesita un ETS
    estacional, de modo que el modelo quedaria descartado por construccion y no
    por desempeno. En ese caso se usa una reserva corta Y SE DECLARA que el
    desempeno reportado corresponde a un horizonte menor que el operativo.

    Args:
        n_total: longitud de la serie en periodos.

    Returns:
        int: meses a reservar.
    """
    p = settings.PRONOSTICO
    if n_total >= p.min_historia_reserva_larga:
        return p.meses_reserva_final
    return p.meses_reserva_corta


def cortes_rolling_origin(
    n_total: int,
    n_reserva: int | None = None,
    n_origenes: int | None = None,
    horizonte: int | None = None,
    paso: int | None = None,
    min_entrenamiento: int | None = None,
) -> list[tuple[int, int]]:
    """Genera los cortes de validacion con origen deslizante.

    Cada corte es un par (fin_entrenamiento, fin_prueba) sobre indices de la
    serie. El entrenamiento es SIEMPRE un prefijo: nunca hay informacion
    posterior al origen dentro del conjunto de ajuste.

    La reserva final queda excluida por completo de estos cortes. Su unico uso
    es el reporte de desempeno del modelo YA seleccionado; si participara en la
    seleccion, el desempeno reportado dejaria de ser fuera de muestra.

    Args:
        n_total: longitud de la serie.
        n_reserva: meses apartados al final.
        n_origenes: numero de cortes deseados.
        horizonte: meses evaluados por corte.
        paso: separacion entre origenes consecutivos.
        min_entrenamiento: longitud minima aceptable de entrenamiento.

    Returns:
        list[tuple[int, int]]: cortes en orden cronologico. Vacia si la serie
        no admite ninguno, lo que el llamador debe tratar como excepcion de
        datos y no como ausencia de error.
    """
    p = settings.PRONOSTICO
    n_reserva = reserva_adaptativa(n_total) if n_reserva is None else n_reserva
    n_origenes = p.origenes_cv if n_origenes is None else n_origenes
    horizonte = p.horizonte_cv if horizonte is None else horizonte
    paso = p.paso_origenes if paso is None else paso
    min_entrenamiento = p.min_meses_serie if min_entrenamiento is None else min_entrenamiento

    pool = n_total - n_reserva
    ultimo_origen = pool - horizonte
    if ultimo_origen < min_entrenamiento:
        return []

    origenes = [ultimo_origen - k * paso for k in range(n_origenes)]
    origenes = sorted(o for o in origenes if o >= min_entrenamiento)
    return [(o, o + horizonte) for o in origenes]


def corte_reserva_final(
    n_total: int, n_reserva: int | None = None
) -> tuple[int, int] | None:
    """Devuelve el corte de la reserva final (entrenamiento, fin de prueba).

    Returns:
        tuple[int, int] | None: None si la serie no alcanza para reservar.
    """
    n_reserva = reserva_adaptativa(n_total) if n_reserva is None else n_reserva
    fin_entrenamiento = n_total - n_reserva
    if fin_entrenamiento < settings.PRONOSTICO.min_meses_serie:
        return None
    return (fin_entrenamiento, n_total)


def mejora_relativa(wape_referente: float, wape_candidato: float) -> float:
    """Mejora relativa del candidato frente al referente.

        mejora = (WAPE_ref - WAPE_cand) / WAPE_ref

    Returns:
        float: positiva si el candidato es mejor; NaN si el referente es cero.
    """
    if not np.isfinite(wape_referente) or wape_referente <= 1e-12:
        return float("nan")
    return float((wape_referente - wape_candidato) / wape_referente)
