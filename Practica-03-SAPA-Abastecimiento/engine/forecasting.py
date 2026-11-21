"""Motor de pronostico de demanda en numpy puro.

Implementacion propia de las familias de modelos exigidas, sin statsmodels.
Motivo (ver requirements.txt): statsmodels carga submodulos por nombre en
tiempo de ejecucion y arrastra extensiones Cython; es la causa mas frecuente de
binarios Nuitka que compilan y mueren en el primer import. La calificacion de
la practica arranca ejecutando el .EXE, de modo que la robustez de arranque
domina sobre la comodidad de desarrollo.

Familias implementadas:

*   `NaiveEstacional` - repetir el mismo mes del ano anterior. Es el REFERENTE
    OBLIGATORIO. Todo modelo candidato debe superarlo por un margen declarado
    para ser adoptado; sin referente, "el modelo funciona bien" no significa nada.
*   `NaiveEstacionalDeriva` - referente mas la variacion interanual media.
*   `HoltWinters` - suavizamiento exponencial con nivel, tendencia amortiguada
    y estacionalidad aditiva. Interpretable y robusto con historia corta.
*   `RegresionEstacional` - minimos cuadrados sobre tendencia y variables
    indicadoras de mes; admite regresores externos conocidos de antemano.
*   `CrostonSBA` - demanda intermitente: separa ocurrencia y tamano
    (Croston, 1972) con la correccion de sesgo de Syntetos-Boylan.
*   `MediaMovil` - salvaguarda para series demasiado cortas.

Ningun modelo extrapola por debajo de cero: la demanda de unidades no es
negativa y un pronostico negativo propagado al MRP produce compras absurdas.
"""

from __future__ import annotations

import itertools
from abc import ABC, abstractmethod

import numpy as np

from config import settings

_EPS = 1e-9


# =============================================================================
# CONTRATO
# =============================================================================
class ModeloPronostico(ABC):
    """Interfaz comun de los modelos de pronostico.

    Attributes:
        nombre: identificador del modelo, persistido junto a cada pronostico.
        ajustado: True tras un `ajustar()` exitoso.
        residuos: errores de ajuste dentro de muestra (un paso adelante).
    """

    nombre: str = "base"
    requiere_estacionalidad: bool = False

    def __init__(self, periodo: int = 12) -> None:
        """Args:
            periodo: longitud del ciclo estacional (12 = mensual).
        """
        self.periodo = periodo
        self.ajustado = False
        self.residuos: np.ndarray = np.array([])
        self._y: np.ndarray = np.array([])

    @abstractmethod
    def ajustar(self, y: np.ndarray) -> ModeloPronostico:
        """Estima los parametros del modelo sobre la serie `y`.

        Args:
            y: serie historica en orden cronologico, sin huecos.

        Returns:
            ModeloPronostico: self, para encadenar.
        """

    @abstractmethod
    def predecir(self, h: int) -> np.ndarray:
        """Genera el pronostico central para los proximos `h` periodos.

        Args:
            h: horizonte en periodos.

        Returns:
            np.ndarray: vector de longitud h, no negativo.
        """

    # -- utilidades compartidas ----------------------------------------------
    @staticmethod
    def _limpiar(y: np.ndarray) -> np.ndarray:
        """Convierte a float, sustituye no finitos por cero y trunca negativos."""
        arr = np.asarray(y, dtype=float).ravel()
        arr = np.where(np.isfinite(arr), arr, 0.0)
        return np.maximum(arr, 0.0)

    def _finalizar(self, y: np.ndarray, ajuste: np.ndarray) -> None:
        """Registra serie, residuos y marca el modelo como ajustado."""
        self._y = y
        self.residuos = y - ajuste
        self.ajustado = True

    @property
    def sigma_residual(self) -> float:
        """Desviacion estandar de los residuos de ajuste."""
        if self.residuos.size < 2:
            return 0.0
        return float(np.std(self.residuos, ddof=1))

    def min_observaciones(self) -> int:
        """Longitud minima de serie que este modelo necesita para estimarse.

        Cada familia tiene su propio minimo y la diferencia es sustantiva: un
        referente estacional solo necesita superar un ciclo, mientras que un
        ETS estacional necesita dos para separar nivel, tendencia y estacion.
        Aplicar un unico minimo global excluiria modelos estimables y falsearia
        la comparacion.
        """
        return 4

    def puede_ajustar(self, n: int) -> bool:
        """Indica si la longitud de serie permite estimar este modelo."""
        return n >= self.min_observaciones()


# =============================================================================
# REFERENTES
# =============================================================================
class NaiveEstacional(ModeloPronostico):
    """Repite el valor del mismo periodo del ciclo anterior.

        y_hat(T+h) = y(T + h - m*k),  k = ceil(h/m)

    Es el referente contra el que se mide toda mejora. No representa cambios de
    tendencia ni campanas nuevas, y eso es precisamente lo que lo hace util como
    piso: si un modelo sofisticado no lo supera, el modelo sofisticado sobra.
    """

    nombre = "naive_estacional"
    requiere_estacionalidad = True

    def min_observaciones(self) -> int:
        """Basta superar un ciclo completo para tener el mes homologo."""
        return self.periodo + 1

    def ajustar(self, y: np.ndarray) -> NaiveEstacional:
        y = self._limpiar(y)
        m = self.periodo
        if y.size <= m:
            raise ValueError(f"Serie de {y.size} < periodo {m}")
        ajuste = np.empty_like(y)
        ajuste[:m] = y[:m]
        ajuste[m:] = y[:-m]
        self._finalizar(y, ajuste)
        return self

    def predecir(self, h: int) -> np.ndarray:
        m, y = self.periodo, self._y
        idx = [y.size - m + ((i) % m) for i in range(h)]
        return np.maximum(y[np.asarray(idx)], 0.0)


class NaiveEstacionalDeriva(ModeloPronostico):
    """Referente estacional mas la variacion interanual media.

        deriva = media( y(t) - y(t-m) )   sobre el entrenamiento
        y_hat(T+h) = y(T+h-m) + deriva * ceil(h/m)

    Captura el crecimiento sostenido que el referente puro ignora, sin estimar
    parametros libres.
    """

    nombre = "naive_deriva"
    requiere_estacionalidad = True

    def min_observaciones(self) -> int:
        """Un ciclo mas una observacion para estimar la deriva interanual."""
        return self.periodo + 1

    def __init__(self, periodo: int = 12) -> None:
        super().__init__(periodo)
        self.deriva = 0.0

    def ajustar(self, y: np.ndarray) -> NaiveEstacionalDeriva:
        y = self._limpiar(y)
        m = self.periodo
        if y.size <= m:
            raise ValueError(f"Serie de {y.size} < periodo {m}")
        self.deriva = float(np.mean(y[m:] - y[:-m]))
        ajuste = np.empty_like(y)
        ajuste[:m] = y[:m]
        ajuste[m:] = y[:-m] + self.deriva
        self._finalizar(y, ajuste)
        return self

    def predecir(self, h: int) -> np.ndarray:
        m, y = self.periodo, self._y
        salida = np.empty(h)
        for i in range(h):
            ciclos = i // m + 1
            salida[i] = y[y.size - m + (i % m)] + self.deriva * ciclos
        return np.maximum(salida, 0.0)


class MediaMovil(ModeloPronostico):
    """Media de las ultimas k observaciones. Salvaguarda para series cortas."""

    nombre = "media_movil"

    def __init__(self, periodo: int = 12, ventana: int = 3) -> None:
        super().__init__(periodo)
        self.ventana = ventana
        self._nivel = 0.0

    def min_observaciones(self) -> int:
        """Salvaguarda: opera con una sola observacion."""
        return 1

    def ajustar(self, y: np.ndarray) -> MediaMovil:
        y = self._limpiar(y)
        k = min(self.ventana, y.size)
        self._nivel = float(np.mean(y[-k:]))
        ajuste = np.full_like(y, float(np.mean(y)))
        self._finalizar(y, ajuste)
        return self

    def predecir(self, h: int) -> np.ndarray:
        return np.full(h, max(self._nivel, 0.0))


# =============================================================================
# SUAVIZAMIENTO EXPONENCIAL
# =============================================================================
class HoltWinters(ModeloPronostico):
    """Suavizamiento exponencial con tendencia amortiguada y estacionalidad.

    Recursiones (forma aditiva, estacionalidad opcional):

        l_t = alpha*(y_t - s_{t-m}) + (1-alpha)*(l_{t-1} + phi*b_{t-1})
        b_t = beta *(l_t - l_{t-1}) + (1-beta )*phi*b_{t-1}
        s_t = gamma*(y_t - l_{t-1} - phi*b_{t-1}) + (1-gamma)*s_{t-m}

        y_hat(T+h) = l_T + sum_{i=1..h} phi^i * b_T + s_{T+h-m*ceil(h/m)}

    El factor de amortiguamiento `phi < 1` es deliberado: una tendencia lineal
    no amortiguada extrapolada a 12 meses produce cifras que ninguna operacion
    puede sostener, y es el error mas comun al planificar a un ano.

    Los parametros se estiman por busqueda en rejilla minimizando la suma de
    cuadrados de los errores de un paso. La rejilla es fija y documentada, de
    modo que el ajuste es reproducible bit a bit (requisito del entregable 10).
    """

    nombre = "holt_winters"

    _GRID_ALPHA = (0.10, 0.20, 0.30, 0.50, 0.70)
    _GRID_BETA = (0.05, 0.15, 0.30)
    _GRID_GAMMA = (0.05, 0.15, 0.30)
    _GRID_PHI = (0.95, 1.00)

    def __init__(self, periodo: int = 12, estacional: bool = True) -> None:
        """Args:
            periodo: ciclo estacional.
            estacional: si False, se reduce a Holt amortiguado (sin estacion).
        """
        super().__init__(periodo)
        self.estacional = estacional
        self.requiere_estacionalidad = estacional
        self.nombre = "holt_winters" if estacional else "holt_amortiguado"
        self.alpha = self.beta = self.gamma = self.phi = 0.0
        self._l = 0.0
        self._b = 0.0
        self._s: np.ndarray = np.zeros(periodo)

    def min_observaciones(self) -> int:
        """Dos ciclos completos si es estacional; cinco puntos si no lo es.

        Con un solo ciclo la estacionalidad inicial es indistinguible del
        nivel y el ajuste recupera ruido, no patron.
        """
        return 2 * self.periodo if self.estacional else 5

    # -- inicializacion -------------------------------------------------------
    def _valores_iniciales(self, y: np.ndarray) -> tuple[float, float, np.ndarray]:
        """Calcula nivel, tendencia y estacionalidad iniciales.

        Nivel y tendencia por medias de los dos primeros ciclos; estacionalidad
        por desviacion de cada periodo respecto de la media de su ciclo. Es la
        inicializacion clasica y evita que la rejilla tenga que compensar un
        arranque arbitrario.
        """
        m = self.periodo
        if not self.estacional:
            k = min(4, y.size)
            nivel = float(np.mean(y[:k]))
            tend = float((y[min(k, y.size - 1)] - y[0]) / max(k, 1))
            return nivel, tend, np.zeros(m)

        ciclos = y.size // m
        nivel = float(np.mean(y[:m]))
        if ciclos >= 2:
            tend = float((np.mean(y[m : 2 * m]) - np.mean(y[:m])) / m)
        else:
            tend = 0.0
        estacion = np.zeros(m)
        for j in range(m):
            valores = y[j::m][:ciclos] if ciclos > 0 else y[j : j + 1]
            medias = [float(np.mean(y[c * m : (c + 1) * m])) for c in range(max(ciclos, 1))]
            desv = [v - medias[i] for i, v in enumerate(valores[: len(medias)])]
            estacion[j] = float(np.mean(desv)) if desv else 0.0
        estacion -= estacion.mean()  # normalizacion: la estacion no aporta nivel
        return nivel, tend, estacion

    # -- recursion ------------------------------------------------------------
    def _recorrer(
        self, y: np.ndarray, alpha: float, beta: float, gamma: float, phi: float
    ) -> tuple[np.ndarray, float, float, np.ndarray]:
        """Ejecuta la recursion y devuelve (ajuste, nivel, tendencia, estacion)."""
        m = self.periodo
        l, b, s = self._valores_iniciales(y)
        s = s.copy()
        ajuste = np.empty(y.size)

        for t in range(y.size):
            s_ant = s[t % m] if self.estacional else 0.0
            pred = l + phi * b + s_ant
            ajuste[t] = pred
            l_ant = l
            if self.estacional:
                l = alpha * (y[t] - s_ant) + (1 - alpha) * (l_ant + phi * b)
                s[t % m] = gamma * (y[t] - l_ant - phi * b) + (1 - gamma) * s_ant
            else:
                l = alpha * y[t] + (1 - alpha) * (l_ant + phi * b)
            b = beta * (l - l_ant) + (1 - beta) * phi * b
        return ajuste, l, b, s

    def ajustar(self, y: np.ndarray) -> HoltWinters:
        y = self._limpiar(y)
        if self.estacional and y.size < 2 * self.periodo:
            raise ValueError(f"Holt-Winters estacional requiere >= {2*self.periodo} obs")
        if y.size < 4:
            raise ValueError("Serie demasiado corta")

        gammas = self._GRID_GAMMA if self.estacional else (0.0,)
        mejor_sse = float("inf")
        mejor: tuple[float, float, float, float] = (0.3, 0.1, 0.1, 1.0)

        for a, b_, g, p in itertools.product(
            self._GRID_ALPHA, self._GRID_BETA, gammas, self._GRID_PHI
        ):
            ajuste, *_ = self._recorrer(y, a, b_, g, p)
            # Se descartan los primeros m puntos: dependen de la inicializacion
            # y no informan sobre la calidad de los parametros.
            corte = self.periodo if self.estacional else 1
            sse = float(np.sum((y[corte:] - ajuste[corte:]) ** 2))
            if np.isfinite(sse) and sse < mejor_sse:
                mejor_sse, mejor = sse, (a, b_, g, p)

        self.alpha, self.beta, self.gamma, self.phi = mejor
        ajuste, self._l, self._b, self._s = self._recorrer(y, *mejor)
        self._finalizar(y, ajuste)
        return self

    def predecir(self, h: int) -> np.ndarray:
        m = self.periodo
        n = self._y.size
        salida = np.empty(h)
        acum_phi = 0.0
        for i in range(1, h + 1):
            acum_phi += self.phi ** i
            estacion = self._s[(n + i - 1) % m] if self.estacional else 0.0
            salida[i - 1] = self._l + acum_phi * self._b + estacion
        return np.maximum(salida, 0.0)


# =============================================================================
# REGRESION
# =============================================================================
class RegresionEstacional(ModeloPronostico):
    """Minimos cuadrados sobre tendencia lineal e indicadoras de periodo.

        y_t = b0 + b1*t + sum_{j=2..m} b_j * D_j(t) + e_t

    Se resuelve con `numpy.linalg.lstsq`, que usa descomposicion SVD y por tanto
    tolera colinealidad sin invertir X'X. Se omite la indicadora del primer
    periodo para evitar la trampa de variables ficticias.

    Limite declarado: extrapola la tendencia linealmente. Por eso compite contra
    Holt-Winters amortiguado, y la regla de seleccion decide con datos, no con
    preferencia.
    """

    nombre = "regresion_estacional"
    requiere_estacionalidad = True

    def __init__(self, periodo: int = 12) -> None:
        super().__init__(periodo)
        self.coef: np.ndarray = np.array([])

    def min_observaciones(self) -> int:
        """Un ciclo mas tres grados de libertad para tendencia e intercepto."""
        return self.periodo + 3

    def _diseno(self, t_idx: np.ndarray) -> np.ndarray:
        """Construye la matriz de diseno para los indices de tiempo dados."""
        m = self.periodo
        n = t_idx.size
        X = np.zeros((n, 1 + 1 + (m - 1)))
        X[:, 0] = 1.0
        X[:, 1] = t_idx
        for j in range(1, m):
            X[:, 1 + j] = (t_idx % m == j).astype(float)
        return X

    def ajustar(self, y: np.ndarray) -> RegresionEstacional:
        y = self._limpiar(y)
        if y.size < self.periodo + 3:
            raise ValueError("Serie insuficiente para regresion estacional")
        t_idx = np.arange(y.size)
        X = self._diseno(t_idx)
        self.coef, *_ = np.linalg.lstsq(X, y, rcond=None)
        self._finalizar(y, X @ self.coef)
        return self

    def predecir(self, h: int) -> np.ndarray:
        t_idx = np.arange(self._y.size, self._y.size + h)
        return np.maximum(self._diseno(t_idx) @ self.coef, 0.0)


# =============================================================================
# DEMANDA INTERMITENTE
# =============================================================================
class CrostonSBA(ModeloPronostico):
    """Croston con correccion de sesgo de Syntetos-Boylan.

    Separa la serie en dos procesos suavizados independientemente:

        z_t = tamano de la demanda cuando ocurre
        p_t = intervalo entre ocurrencias

        y_hat = (1 - alpha/2) * z / p          (correccion SBA)

    El factor (1 - alpha/2) corrige el sesgo positivo del Croston original,
    demostrado por Syntetos y Boylan: el cociente de dos medias suavizadas no
    es un estimador insesgado de la demanda media por periodo.

    Limite declarado: produce una tasa media por periodo, no una distribucion.
    El intervalo de prediccion para estos articulos se construye empiricamente
    a partir de los residuos de validacion, no de un supuesto normal.
    """

    nombre = "croston_sba"

    def __init__(self, periodo: int = 12, alpha: float = 0.15) -> None:
        super().__init__(periodo)
        self.alpha = alpha
        self._tasa = 0.0

    def min_observaciones(self) -> int:
        """Cuatro periodos para estimar tamano e intervalo de ocurrencia."""
        return 4

    def ajustar(self, y: np.ndarray) -> CrostonSBA:
        y = self._limpiar(y)
        if y.size < 4:
            raise ValueError("Serie demasiado corta para Croston")

        no_cero = np.flatnonzero(y > _EPS)
        if no_cero.size == 0:
            self._tasa = 0.0
            self._finalizar(y, np.zeros_like(y))
            return self

        a = self.alpha
        # INICIALIZACION POR MOMENTOS, no por la primera observacion.
        # Arrancar con z = primer tamano y p = indice de la primera ocurrencia
        # introduce un transitorio largo: con alpha = 0.15 el intervalo tarda
        # decenas de ocurrencias en converger, y en una serie de 36 meses el
        # estimador nunca llega, sobreestimando la tasa de forma sistematica.
        # Se inicializa con la media de los tamanos y la media de los
        # intervalos observados, que es el estimador de momentos del proceso.
        tamanos = y[no_cero]
        z = float(np.mean(tamanos))
        if no_cero.size >= 2:
            p = float(np.mean(np.diff(no_cero)))
        else:
            p = float(no_cero[0] + 1)
        ajuste = np.zeros_like(y)
        ultimo = int(no_cero[0])

        for t in range(no_cero[0] + 1, y.size):
            ajuste[t] = (1 - a / 2.0) * z / max(p, _EPS)
            if y[t] > _EPS:
                intervalo = float(t - ultimo)
                z = a * float(y[t]) + (1 - a) * z
                p = a * intervalo + (1 - a) * p
                ultimo = t

        self._tasa = (1 - a / 2.0) * z / max(p, _EPS)
        self._finalizar(y, ajuste)
        return self

    def predecir(self, h: int) -> np.ndarray:
        return np.full(h, max(self._tasa, 0.0))


# =============================================================================
# SELECCION DEL CONJUNTO DE CANDIDATOS
# =============================================================================
def es_intermitente(y: np.ndarray, umbral: float | None = None) -> bool:
    """Determina si una serie debe tratarse como intermitente.

    Criterio: proporcion de periodos con demanda nula por encima del umbral.

    Args:
        y: serie historica.
        umbral: proporcion de ceros; por defecto `settings.PRONOSTICO`.

    Returns:
        bool: True si corresponde el tratamiento de Croston.
    """
    umbral = settings.PRONOSTICO.umbral_intermitencia if umbral is None else umbral
    y = np.asarray(y, float)
    if y.size == 0:
        return False
    return float(np.mean(y <= _EPS)) >= umbral


def catalogo_modelos(y: np.ndarray, periodo: int = 12) -> list[ModeloPronostico]:
    """Devuelve los candidatos aplicables a la serie, referente incluido.

    La seleccion del conjunto NO es una eleccion de modelo: solo descarta los
    que la serie no permite estimar. La eleccion final la decide la validacion
    temporal, por SKU y por horizonte, porque no existe un modelo
    universalmente superior para el retail ni para la industria peruana.

    Args:
        y: serie historica mensual.
        periodo: ciclo estacional.

    Returns:
        list[ModeloPronostico]: instancias sin ajustar. El primer elemento es
        siempre el referente disponible.
    """
    n = int(np.asarray(y).size)
    p = settings.PRONOSTICO
    candidatos: list[ModeloPronostico] = []

    if n > periodo:
        candidatos.append(NaiveEstacional(periodo))
        candidatos.append(NaiveEstacionalDeriva(periodo))
    else:
        candidatos.append(MediaMovil(periodo))

    if es_intermitente(y):
        candidatos.append(CrostonSBA(periodo))
        candidatos.append(MediaMovil(periodo))
        return candidatos

    if n >= 2 * periodo:
        candidatos.append(HoltWinters(periodo, estacional=True))
    if n >= periodo + 3:
        candidatos.append(RegresionEstacional(periodo))
    if n >= p.min_meses_serie:
        candidatos.append(HoltWinters(periodo, estacional=False))

    return candidatos


def ajustar_seguro(
    modelo: ModeloPronostico, y: np.ndarray, h: int
) -> np.ndarray | None:
    """Ajusta y pronostica capturando cualquier fallo numerico.

    Un modelo que no converge en un SKU no debe interrumpir la corrida de los
    otros 49. Devuelve None y el llamador lo excluye de la comparacion.

    Args:
        modelo: instancia sin ajustar.
        y: serie de entrenamiento.
        h: horizonte.

    Returns:
        np.ndarray | None: pronostico, o None si el ajuste fallo.
    """
    try:
        if not modelo.puede_ajustar(int(np.asarray(y).size)):
            return None
        modelo.ajustar(y)
        pred = modelo.predecir(h)
        if not np.all(np.isfinite(pred)):
            return None
        return pred
    except (ValueError, FloatingPointError, np.linalg.LinAlgError, ZeroDivisionError):
        return None
