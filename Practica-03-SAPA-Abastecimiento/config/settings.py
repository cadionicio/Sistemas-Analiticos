"""Configuracion central del Sistema Analitico Predictivo de Abastecimiento.

Centraliza rutas, constantes de negocio y parametros del simulador. Ningun otro
modulo debe construir rutas absolutas ni fijar constantes de negocio en linea:
la auditoria de la practica exige que todo parametro sea localizable y versionado
en un unico punto.

Note:
    La resolucion de `BASE_DIR` contempla los cuatro modos de ejecucion
    previstos: variable de entorno explicita, PyInstaller en modo carpeta
    (ruta vigente del entregable), Nuitka --standalone (ruta historica) e
    interprete. Ver `_resolver_base_dir` para el detalle y para el fallo real
    que motivo el orden actual.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final

# =============================================================================
# 1. IDENTIDAD Y VERSION
# =============================================================================
APP_NOMBRE: Final[str] = "SAPA"
APP_TITULO: Final[str] = "Sistema Analitico Predictivo de Abastecimiento"
APP_VERSION: Final[str] = "2.1.0"
ESQUEMA_VERSION: Final[int] = 3


# =============================================================================
# 2. RESOLUCION DE RUTAS (compatible con interprete y binario Nuitka)
# =============================================================================
def _resolver_base_dir() -> Path:
    """Devuelve el directorio raiz de trabajo del aplicativo.

    Bajo un binario empaquetado el codigo vive en una carpeta interna de
    recursos; la base de datos, los exportables y los registros deben quedar
    JUNTO AL .EXE, a la vista del evaluador y sobre un directorio escribible.

    POR QUE NO SE USA `sys.argv[0]`
    -------------------------------
    Era la implementacion anterior y estaba mal. Streamlit REESCRIBE `sys.argv`
    antes de ejecutar el script de la aplicacion: le pone la ruta de `app.py`
    como argumento cero. Dentro del binario, `app.py` vive en la carpeta interna
    de recursos, de modo que `sys.argv[0]` apuntaba ahi y el sistema creaba una
    base vacia dentro de `_internal/database/`. El sintoma observado en la
    prueba de empaquetado fue exacto y silencioso:

        sqlite3.OperationalError: no such table: ejecuciones

    con el archivo correcto de 50 MB intacto un nivel mas arriba. Un fallo asi
    no rompe el arranque: la aplicacion abre, se ve entera y muestra todos los
    contadores en cero. Es el peor modo de fallar en una calificacion que
    empieza ejecutando el .EXE.

    ORDEN DE RESOLUCION
    -------------------
    1.  `SAPA_BASE_DIR` si esta definida. `run_app.py` la fija antes de ceder el
        control a Streamlit, de modo que la raiz queda decidida por quien
        arranca el proceso y no por quien manipula `sys.argv` despues.
    2.  Nuitka: la global `__compiled__` con `containing_dir`.
    3.  Cualquier congelador (PyInstaller define `sys.frozen`): la carpeta de
        `sys.executable`, que es el .EXE y nadie reescribe.
    4.  Interprete: el directorio del proyecto.

    Returns:
        Path: raiz sobre la que cuelgan database/, exports/, logs/ e imports/.
    """
    explicita = os.environ.get("SAPA_BASE_DIR", "").strip()
    if explicita:
        try:
            return Path(explicita).expanduser().resolve()
        except (OSError, RuntimeError):
            print(f"[SAPA][AVISO] SAPA_BASE_DIR invalida: {explicita!r}",
                  file=sys.stderr)

    compilado = globals().get("__compiled__")
    if compilado is not None:
        try:
            return Path(compilado.containing_dir).resolve()
        except AttributeError:
            pass

    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent

    return Path(__file__).resolve().parent.parent


BASE_DIR: Final[Path] = _resolver_base_dir()
DB_DIR: Final[Path] = BASE_DIR / "database"
EXPORTS_DIR: Final[Path] = BASE_DIR / "exports"
LOGS_DIR: Final[Path] = BASE_DIR / "logs"
IMPORTS_DIR: Final[Path] = BASE_DIR / "imports"
DB_PATH: Final[Path] = DB_DIR / "sapa.db"

for _d in (DB_DIR, EXPORTS_DIR, LOGS_DIR, IMPORTS_DIR):
    try:
        _d.mkdir(parents=True, exist_ok=True)
    except OSError as exc:  # disco lleno, permisos, ruta UNC no disponible
        print(f"[SAPA][FATAL] No se pudo crear {_d}: {exc}", file=sys.stderr)


# =============================================================================
# 3. PARAMETROS DE CONEXION SQLITE
# =============================================================================
@dataclass(frozen=True)
class ConfiguracionSQLite:
    """Parametros de conexion y PRAGMAs aplicados a cada conexion nueva.

    Attributes:
        journal_mode: WAL habilita un escritor concurrente con N lectores sin
            bloqueo de lectura. Es la unica configuracion viable bajo Streamlit,
            que reejecuta el script en hilos distintos por cada interaccion.
        synchronous: NORMAL es seguro bajo WAL (fsync en checkpoint, no en cada
            commit) y reduce en un orden de magnitud el costo de la carga masiva.
        busy_timeout_ms: espera activa antes de lanzar `database is locked`.
        foreign_keys: SQLite NO aplica claves foraneas por defecto; sin este
            PRAGMA el esquema relacional es decorativo.
    """

    journal_mode: str = "WAL"
    synchronous: str = "NORMAL"
    busy_timeout_ms: int = 15_000
    foreign_keys: bool = True
    temp_store: str = "MEMORY"
    cache_size_kb: int = -64_000  # negativo = KiB; 64 MB de cache de paginas
    mmap_size: int = 268_435_456  # 256 MB
    chunk_insercion: int = 5_000  # filas por lote en executemany


SQLITE: Final[ConfiguracionSQLite] = ConfiguracionSQLite()


# =============================================================================
# 4. PARAMETROS DE NEGOCIO (teoria de inventarios)
# =============================================================================
@dataclass(frozen=True)
class ParametrosInventario:
    """Politicas por defecto de la teoria de inventarios.

    Attributes:
        z_por_clase: cuantil normal estandar asociado al nivel de servicio de
            ciclo objetivo por clase ABC. z(0.99)=2.326, z(0.95)=1.645,
            z(0.90)=1.282. Se documenta como POLITICA, no como constante fisica.
        dias_revision: periodo de revision (R) de la politica periodica (R, S).
        factor_costo_mantener: costo anual de mantener una unidad como fraccion
            de su costo unitario (capital + almacenaje + obsolescencia + seguro).
        costo_por_pedido: costo administrativo fijo de emitir una orden (S del EOQ).
    """

    z_por_clase: dict[str, float] = field(
        default_factory=lambda: {"A": 2.326, "B": 1.645, "C": 1.282}
    )
    nivel_servicio_por_clase: dict[str, float] = field(
        default_factory=lambda: {"A": 0.99, "B": 0.95, "C": 0.90}
    )
    dias_revision: int = 7
    factor_costo_mantener: float = 0.18
    costo_por_pedido: float = 85.0
    horizonte_meses: int = 12


INVENTARIO: Final[ParametrosInventario] = ParametrosInventario()


# =============================================================================
# 5. PARAMETROS DEL GENERADOR SINTETICO
# =============================================================================
@dataclass(frozen=True)
class ParametrosSimulacion:
    """Configuracion reproducible del motor de data sintetica.

    Attributes:
        semilla: semilla maestra del PCG64. La reproducibilidad exacta es un
            requisito del entregable 10 (libro Excel con la data de prueba):
            el evaluador debe poder regenerar el mismo dataset bit a bit.
        prob_friccion_finanzas: proporcion de ordenes con retraso de aprobacion
            atribuible a Finanzas. Rango exigido por el Director: 15%-20%.
        cv_lead_time: coeficiente de variacion del lead time (sigma/media). Un
            CV de 0.35 corresponde a logistica domestica con incidencias; los
            importados se escalan por `factor_cv_importado`.
    """

    semilla: int = 20260921
    n_skus: int = 50
    meses_historia: int = 36
    fecha_corte: str = "2026-09-30"
    centro_default: str = "CD01"

    # --- Fricción organizacional ---
    prob_friccion_finanzas: float = 0.18
    dias_retraso_aprob_media: float = 6.0
    dias_retraso_aprob_dispersion: float = 4.0

    # --- Riesgo logistico ---
    cv_lead_time: float = 0.35
    factor_cv_importado: float = 1.6
    prob_rechazo_calidad: float = 0.03
    prob_entrega_parcial: float = 0.08
    n_disrupciones: int = 11
    duracion_disrupcion_dias: tuple[int, int] = (7, 45)
    factor_lt_disrupcion: tuple[float, float] = (1.4, 2.6)

    # --- Mezcla sectorial y de arquetipos ---
    proporcion_retail: float = 0.60
    mezcla_arquetipos: dict[str, float] = field(
        default_factory=lambda: {
            "REGULAR": 0.30,
            "ESTACIONAL": 0.22,
            "TENDENCIA": 0.16,
            "INTERMITENTE": 0.16,
            "PROMO_SENSIBLE": 0.12,
            "NUEVO": 0.04,
        }
    )

    # --- Umbrales fisicos para compatibilidad GTP (Goods-to-Person) ---
    gtp_volumen_max_m3: float = 0.050
    gtp_peso_max_kg: float = 15.0


SIMULACION: Final[ParametrosSimulacion] = ParametrosSimulacion()


# =============================================================================
# 6. PARAMETROS DE PRONOSTICO Y VALIDACION TEMPORAL (Fase 2)
# =============================================================================
@dataclass(frozen=True)
class ParametrosPronostico:
    """Protocolo de entrenamiento, validacion y seleccion de modelos.

    Attributes:
        meses_reserva_final: ultimos meses apartados que NO participan en la
            seleccion del modelo. Sirven solo para reportar desempeno final.
            Seleccionar con ellos equivale a aprender del futuro.
        origenes_cv: numero de origenes de la validacion rolling-origin. Cada
            origen simula lo que el planificador habria conocido esa fecha.
        horizonte_cv: horizonte evaluado en cada origen. Es menor que el
            horizonte operativo (12) porque con 36 meses de historia no existe
            informacion independiente suficiente para validar a 12; declararlo
            es preferible a simular una validacion que no se tiene.
        mejora_minima_wape: mejora relativa exigida al modelo candidato frente
            al referente estacional para reemplazarlo.
            mejora = (WAPE_ref - WAPE_cand) / WAPE_ref
        sesgo_maximo: |sesgo| tolerado en familias estables.
        min_meses_estacional: observaciones minimas para estimar un patron
            anual. Por debajo, el modelo estacional queda deshabilitado.
        umbral_intermitencia: proporcion de meses con demanda cero por encima
            de la cual la serie se trata con Croston/SBA.
        cobertura_nominal: cobertura nominal del intervalo de prediccion. Se
            reporta SIEMPRE junto a la cobertura empirica observada: un
            intervalo cuya cobertura real difiere de la nominal es un intervalo
            mal calibrado, no una garantia.
    """

    meses_reserva_final: int = 12
    # Con historia corta, una reserva de 12 meses deja un pool de solo 24 y los
    # origenes de validacion no alcanzan los 24 meses que exige un ETS
    # estacional: el modelo quedaria excluido por construccion, no por merito.
    # Por debajo de `min_historia_reserva_larga` se usa una reserva corta y el
    # sistema DECLARA que el desempeno reportado es a ese horizonte menor.
    min_historia_reserva_larga: int = 48
    meses_reserva_corta: int = 6
    origenes_cv: int = 3
    horizonte_cv: int = 6
    paso_origenes: int = 3
    # Un candidato solo puede desplazar al referente si ambos fueron evaluados
    # en al menos este numero de cortes COMUNES. Comparar promedios calculados
    # sobre conjuntos de cortes distintos no es una comparacion.
    min_cortes_comunes: int = 2
    mejora_minima_wape: float = 0.10
    sesgo_maximo: float = 0.05
    min_meses_estacional: int = 24
    periodo_estacional: int = 12
    umbral_intermitencia: float = 0.30
    cobertura_nominal: float = 0.80
    min_meses_serie: int = 12


PRONOSTICO: Final[ParametrosPronostico] = ParametrosPronostico()


# =============================================================================
# 7. ESCENARIOS Y SIMULACION ESTOCASTICA (Fase 2)
# =============================================================================
@dataclass(frozen=True)
class EscenarioSimulacion:
    """Definicion explicita de un escenario de planificacion.

    Cada escenario declara sus SUPUESTOS, no una probabilidad. Asignar
    probabilidades arbitrarias a escenarios construidos a mano convierte una
    hipotesis de trabajo en una afirmacion estadistica que nadie puede
    sostener.

    Attributes:
        factor_demanda: multiplicador sobre la demanda central pronosticada.
        factor_lead_time: multiplicador sobre el lead time medio.
        factor_costo: multiplicador sobre el precio de compra.
        factor_presupuesto: multiplicador sobre el presupuesto mensual.
    """

    nombre: str
    descripcion: str
    factor_demanda: float = 1.0
    factor_lead_time: float = 1.0
    factor_costo: float = 1.0
    factor_presupuesto: float = 1.0


ESCENARIOS: Final[tuple[EscenarioSimulacion, ...]] = (
    EscenarioSimulacion(
        "BASE", "Campanas aprobadas, costos y plazos mas plausibles",
        1.00, 1.00, 1.00, 1.00,
    ),
    EscenarioSimulacion(
        "DEMANDA_ALTA", "Mayor consumo con capacidad y caja sin ampliar",
        1.20, 1.00, 1.00, 1.00,
    ),
    EscenarioSimulacion(
        "DISRUPCION", "Plazo prolongado, encarecimiento y caja restringida",
        1.00, 1.60, 1.12, 0.85,
    ),
)


@dataclass(frozen=True)
class ParametrosMonteCarlo:
    """Configuracion de la simulacion estocastica multiescenario.

    Attributes:
        n_iteraciones: replicas por escenario.
        peso_factor_comun: fraccion de la varianza de demanda atribuida a un
            factor comun a todos los SKU (ciclo economico, campana, clima).
            Es lo que impide el error de sumar P90 individuales: con shocks
            independientes la agregacion cancela la cola y el P90 del total
            sale artificialmente bajo.
        percentiles: percentiles reportados de cada metrica.
    """

    n_iteraciones: int = 600
    peso_factor_comun: float = 0.45
    percentiles: tuple[int, ...] = (5, 50, 95)
    semilla: int = 777


MONTECARLO: Final[ParametrosMonteCarlo] = ParametrosMonteCarlo()


# =============================================================================
# 8. LOGGING
# =============================================================================
LOG_NIVEL: Final[str] = os.environ.get("SAPA_LOG_NIVEL", "INFO").upper()
LOG_ARCHIVO: Final[Path] = LOGS_DIR / "sapa.log"
LOG_MAX_BYTES: Final[int] = 5 * 1024 * 1024
LOG_BACKUPS: Final[int] = 5
