"""Motor de generacion de data sintetica compleja del SAPA.

No es un generador de numeros aleatorios: es un SIMULADOR DE SISTEMA. La
diferencia es metodologica y decide la validez de todo lo que se construya
encima.

Un generador aleatorio produciria una columna `demanda_perdida` sorteada al
azar. Eso es circular: el agente diagnostico "descubriria" exactamente lo que
el generador escribio, y la validacion del modelo predictivo seria una
tautologia. Aqui las patologias EMERGEN de la dinamica:

1.  Se simula una demanda LATENTE (la que el mercado quiso comprar).
2.  Se simula la politica de inventario, la aprobacion de Finanzas y el
    transporte del proveedor dia a dia.
3.  Las ventas observadas son `min(demanda_latente, stock_disponible)`. La
    censura aparece sola, cuando y donde el sistema falla.
4.  El retraso de una orden es la suma de dos tramos independientes, cada uno
    con su responsable: aprobacion interna y cumplimiento del proveedor.

Modelos probabilisticos empleados:

*   Demanda: mixtura Gamma-Poisson (binomial negativa). La demanda de unidades
    es un conteo no negativo y sobredisperso (var > media); una normal produce
    valores negativos y subestima la cola, que es justo lo que dimensiona el
    stock de seguridad.
*   Intermitencia: proceso de Bernoulli para la ocurrencia y conteo positivo
    para el tamano (estructura de Croston, 1972).
*   Lead time: log-normal DESPLAZADA, LT = LT_min + LogNormal(mu, sigma). La
    log-normal pura admite tiempos arbitrariamente cercanos a cero, lo que es
    fisicamente imposible: ninguna importacion llega en 0.3 dias.
*   Retraso de aprobacion: Gamma, asimetrica positiva, cola larga.

Referencias de la teoria aplicada:
    Croston (1972); Harris (1913) para EOQ; King (2011) para la varianza de la
    demanda durante el lead time; Kraljic (1983) para la segmentacion.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

import numpy as np
import pandas as pd

from config import settings
from db.db_manager import DatabaseManager, ErrorBaseDatos
from engine.inventario import parametros_lognormal
from utils.logger import obtener_logger

_log = obtener_logger("data_generator")

# =============================================================================
# CATALOGOS BASE DEL ESCENARIO PERUANO SIMULADO
# =============================================================================
_CATEGORIAS_RETAIL: tuple[tuple[str, str], ...] = (
    ("ABARROTES", "Arroz / Azucar / Fideos"),
    ("ACEITES", "Aceite vegetal"),
    ("LIMPIEZA", "Detergentes y lejias"),
    ("BEBIDAS", "Gaseosas y aguas"),
    ("CUIDADO_PERSONAL", "Higiene y cuidado"),
    ("LACTEOS", "Leche y derivados"),
)
_CATEGORIAS_INDUSTRIAL: tuple[tuple[str, str], ...] = (
    ("RESINAS", "Resina PET / PEAD"),
    ("EMPAQUES", "Cajas, film y etiquetas"),
    ("TAPAS_COMPONENTES", "Tapas y preformas"),
    ("INSUMOS_QUIMICOS", "Aditivos y masterbatch"),
    ("REPUESTOS", "Repuestos de linea"),
)

_NOMBRES_PROVEEDOR: tuple[str, ...] = (
    "Distribuidora Andina", "Corporacion Pacifico", "Insumos del Sur",
    "Global Trading Peru", "Almacenes Lima Norte", "Quimica Industrial SAC",
    "Polimeros del Peru", "Importaciones Oriente", "Comercial Huascaran",
    "Logistica Integral SAC", "Envases Continental", "Agroindustrias Chira",
)

_MOTIVOS_BLOQUEO: tuple[str, ...] = (
    "Presupuesto de categoria agotado en el periodo",
    "Falta de validacion de centro de costo",
    "Proveedor sin actualizacion de datos bancarios",
    "Solicitud sobre el limite de atribucion del aprobador",
    "Cierre contable en curso",
    "Observacion de Tesoreria por flujo de caja proyectado",
)

_TIPOS_DISRUPCION: tuple[str, ...] = (
    "CLIMA", "PARO_TRANSPORTISTA", "CONGESTION_ADUANA",
    "QUIEBRE_PROVEEDOR", "SHOCK_TIPO_CAMBIO", "FALLA_INTERNA",
)

# SLA interno de aprobacion: dias habiles comprometidos entre la requisicion
# de Compras y la liberacion presupuestal de Finanzas. Todo exceso sobre este
# valor es retraso IMPUTABLE A LA ORGANIZACION, no al proveedor.
SLA_APROBACION_DIAS: int = 2


# =============================================================================
# ESTRUCTURAS AUXILIARES
# =============================================================================
@dataclass
class _PerfilSKU:
    """Parametros latentes de un SKU que gobiernan su simulacion.

    Attributes:
        nivel_base: demanda diaria media en unidades al inicio del horizonte.
        tendencia_diaria: variacion multiplicativa acumulada por dia.
        amplitud_anual: amplitud del armonico estacional anual.
        fase_anual: desfase del armonico, en radianes.
        dispersion_k: parametro de forma de la mixtura Gamma-Poisson. Menor k =
            mayor sobredispersion (mas varianza para la misma media).
        prob_ocurrencia: probabilidad diaria de demanda no nula (intermitentes).
        sensibilidad_promo: multiplicador de demanda en dia de promocion.
        dia_lanzamiento: indice del dia en que el SKU nace (arquetipo NUEVO).
    """

    nivel_base: float
    tendencia_diaria: float
    amplitud_anual: float
    fase_anual: float
    dispersion_k: float
    prob_ocurrencia: float
    sensibilidad_promo: float
    dia_lanzamiento: int


# =============================================================================
# GENERADOR
# =============================================================================
class GeneradorDataSintetica:
    """Construye el dataset historico completo y lo persiste en SQLite.

    Attributes:
        db: gestor de base de datos.
        p: parametros de simulacion.
        rng: generador PCG64 sembrado; garantiza reproducibilidad exacta.
    """

    def __init__(
        self,
        db: DatabaseManager | None = None,
        parametros: settings.ParametrosSimulacion | None = None,
        semilla: int | None = None,
    ) -> None:
        """Inicializa el generador.

        Args:
            db: gestor de base. Si se omite, usa el Singleton por defecto.
            parametros: configuracion de simulacion. Por defecto `settings.SIMULACION`.
            semilla: sobrescribe la semilla de `parametros`.
        """
        self.db = db or DatabaseManager()
        self.p = parametros or settings.SIMULACION
        self.rng = np.random.default_rng(semilla if semilla is not None else self.p.semilla)

        self.fecha_fin: date = date.fromisoformat(self.p.fecha_corte)
        # 36 meses de historia diaria; se usa 30.4375 d/mes para no arrastrar
        # el sesgo de asumir meses de 30 dias en un horizonte de 3 anios.
        self.n_dias: int = int(round(self.p.meses_historia * 30.4375))
        self.fecha_inicio: date = self.fecha_fin - timedelta(days=self.n_dias - 1)
        self.fechas: pd.DatetimeIndex = pd.date_range(
            self.fecha_inicio, self.fecha_fin, freq="D"
        )

        _log.info(
            "Generador listo: %d dias (%s a %s), %d SKU, semilla %d",
            self.n_dias, self.fecha_inicio, self.fecha_fin, self.p.n_skus, self.p.semilla,
        )

    # =========================================================================
    # ORQUESTACION
    # =========================================================================
    def generar(self, forzar: bool = True) -> dict[str, int]:
        """Ejecuta el pipeline completo de generacion y persistencia.

        Args:
            forzar: si es True reconstruye el esquema desde cero. Es lo normal
                al regenerar el dataset de prueba entregable.

        Returns:
            dict[str, int]: conteo de filas escritas por tabla.

        Raises:
            ErrorBaseDatos: si falla la persistencia.
        """
        _log.info("=== INICIO DE GENERACION DE DATA SINTETICA ===")
        self.db.inicializar_esquema(forzar=forzar)

        proveedores = self._generar_proveedores()
        materiales, perfiles = self._generar_materiales()
        relaciones = self._generar_sku_proveedor(materiales, proveedores)
        disrupciones = self._generar_disrupciones(proveedores, materiales)

        # Persistencia de maestros ANTES de los hechos: las claves foraneas se
        # validan en tiempo de insercion (PRAGMA foreign_keys=ON).
        self.db.insertar_df("maestro_proveedores", proveedores)
        self.db.insertar_df("maestro_materiales", materiales)
        self.db.insertar_df("sku_proveedor", relaciones)
        self.db.insertar_df("eventos_disrupcion", disrupciones)

        mapa_disrupcion = self._cargar_mapa_disrupciones()

        demanda, inventario, ordenes = self._simular_operacion(
            materiales, perfiles, relaciones, mapa_disrupcion
        )

        demanda = self._estimar_demanda_perdida(demanda)

        self.db.insertar_df("historico_demanda", demanda)
        self.db.insertar_df("inventario_diario", inventario)
        self.db.insertar_df("ordenes_compra", ordenes)

        self._recalcular_segmentacion()
        self._registrar_parametros_usados()

        conteos = {
            "maestro_proveedores": len(proveedores),
            "maestro_materiales": len(materiales),
            "sku_proveedor": len(relaciones),
            "eventos_disrupcion": len(disrupciones),
            "historico_demanda": len(demanda),
            "inventario_diario": len(inventario),
            "ordenes_compra": len(ordenes),
        }
        self.db.registrar_auditoria(
            "data_generator", "INFO", "GENERACION_COMPLETADA", str(conteos)
        )
        _log.info("=== GENERACION COMPLETADA: %s ===", conteos)
        return conteos

    # =========================================================================
    # 1. PROVEEDORES
    # =========================================================================
    def _generar_proveedores(self) -> pd.DataFrame:
        """Construye el maestro de proveedores.

        Un tercio son importadores: su lead time es mas largo y mas volatil, y
        su moneda es USD. Esa asimetria es la que despues hace que el agente
        prescriptivo distinga riesgo cambiario de riesgo de demanda.

        Returns:
            pd.DataFrame: maestro de proveedores.
        """
        filas: list[dict[str, Any]] = []
        for i, nombre in enumerate(_NOMBRES_PROVEEDOR, start=1):
            importado = bool(self.rng.random() < 0.33)
            filas.append(
                {
                    "proveedor_id": f"PRV{i:03d}",
                    "razon_social": f"{nombre} S.A.C.",
                    # RUC sintetico valido en formato (11 digitos, prefijo 20)
                    "ruc": f"20{self.rng.integers(100000000, 999999999)}",
                    "pais": self.rng.choice(["CN", "BR", "CL", "US"]) if importado else "PE",
                    "es_importado": int(importado),
                    "moneda": "USD" if importado else "PEN",
                    "dias_credito": int(self.rng.choice([0, 15, 30, 45, 60])),
                    "otif_historico": round(float(self.rng.uniform(0.62, 0.96)), 4),
                    "homologado": 1,
                    "fecha_alta": str(self.fecha_inicio - timedelta(days=int(self.rng.integers(90, 900)))),
                }
            )
        return pd.DataFrame(filas)

    # =========================================================================
    # 2. MATERIALES
    # =========================================================================
    def _generar_materiales(self) -> tuple[pd.DataFrame, dict[str, _PerfilSKU]]:
        """Construye el maestro de materiales y el perfil latente de cada SKU.

        Los scores de Kraljic asignados aqui son PROVISIONALES: se recalculan en
        `_recalcular_segmentacion()` sobre el consumo valorizado realmente
        observado. Clasificar antes de medir seria asignar la etiqueta por
        intuicion, que es justamente lo que el sistema debe evitar.

        Returns:
            tuple: (DataFrame del maestro, dict sku -> perfil latente).
        """
        n_retail = int(round(self.p.n_skus * self.p.proporcion_retail))
        arquetipos = list(self.p.mezcla_arquetipos.keys())
        pesos = np.array(list(self.p.mezcla_arquetipos.values()), dtype=float)
        pesos = pesos / pesos.sum()

        filas: list[dict[str, Any]] = []
        perfiles: dict[str, _PerfilSKU] = {}

        for idx in range(self.p.n_skus):
            es_retail = idx < n_retail
            sector = "RETAIL" if es_retail else "INDUSTRIAL"
            catalogo = _CATEGORIAS_RETAIL if es_retail else _CATEGORIAS_INDUSTRIAL
            categoria, familia = catalogo[idx % len(catalogo)]
            sku = f"{'R' if es_retail else 'I'}{idx + 1:03d}-{categoria[:3]}"

            arquetipo = str(self.rng.choice(arquetipos, p=pesos))
            perfil = self._perfil_de_arquetipo(arquetipo)
            perfiles[sku] = perfil

            # --- Atributos fisicos ---
            if es_retail:
                volumen = float(self.rng.uniform(0.0008, 0.035))
                peso = float(self.rng.uniform(0.15, 12.0))
                costo = round(float(self.rng.uniform(2.0, 45.0)), 2)
            else:
                volumen = float(self.rng.uniform(0.002, 0.42))
                peso = float(self.rng.uniform(0.02, 60.0))
                costo = round(float(self.rng.uniform(0.08, 320.0)), 2)

            perecible = bool(
                es_retail and categoria in {"LACTEOS", "ABARROTES", "BEBIDAS"}
                and self.rng.random() < 0.55
            )
            vida_util = int(self.rng.integers(21, 400)) if perecible else None

            # --- Reglas WMS ---
            # La politica de rotacion NO es una preferencia: la determina la
            # conjuncion (perecibilidad, tipo de estanteria). Un rack compacto
            # drive-in solo permite extraer el ultimo palet ingresado -> LIFO.
            # Por eso el esquema prohibe LIFO sobre material con vida util.
            if perecible:
                politica = "FEFO"
                tipo_alm = "RACK_DINAMICO"
            elif volumen > 0.20 or peso > 35:
                politica = "LIFO"
                tipo_alm = "RACK_COMPACTO_DRIVE_IN"
            elif volumen < 0.01 and peso < 5:
                politica = "FIFO"
                tipo_alm = "ESTANTERIA_PICKING"
            else:
                politica = "FIFO"
                tipo_alm = "RACK_SELECTIVO"

            compatible_gtp = int(
                volumen <= self.p.gtp_volumen_max_m3 and peso <= self.p.gtp_peso_max_kg
            )
            motivo_no_gtp = None
            if not compatible_gtp:
                motivo_no_gtp = (
                    "Excede volumen maximo de contenedor shuttle"
                    if volumen > self.p.gtp_volumen_max_m3
                    else "Excede peso maximo de bandeja miniload"
                )

            unidades_palet = max(1, int(round(1.6 / max(volumen, 1e-4))))
            criticidad = int(self.rng.integers(1, 6))

            filas.append(
                {
                    "sku": sku,
                    "descripcion": f"{familia} - presentacion {idx + 1:02d}",
                    "sector": sector,
                    "categoria": categoria,
                    "familia": familia,
                    "unidad_base": "UND" if es_retail else self.rng.choice(["UND", "KG"]),
                    "unidad_compra": self.rng.choice(["CAJA", "SACO", "PALET", "UND"]),
                    "factor_conversion": float(self.rng.choice([1, 6, 12, 20, 24, 25, 50])),
                    "costo_unitario": costo,
                    "moneda": "PEN",
                    "volumen_m3_unidad": round(volumen, 6),
                    "peso_kg_unidad": round(peso, 3),
                    "unidades_por_palet": unidades_palet,
                    "apilable_max_niveles": int(self.rng.integers(1, 5)),
                    "tipo_almacenamiento": tipo_alm,
                    "politica_rotacion": politica,
                    "vida_util_dias": vida_util,
                    "compatible_gtp": compatible_gtp,
                    "motivo_no_gtp": motivo_no_gtp,
                    "score_impacto_economico": 0.5,  # provisional
                    "score_riesgo_suministro": 0.5,  # provisional
                    "segmento_kraljic": "RUTINARIO",  # provisional
                    "clase_abc": None,
                    "clase_xyz": None,
                    "cv_demanda": None,
                    "criticidad_operativa": criticidad,
                    "arquetipo_demanda": arquetipo,
                    "activo": 1,
                    "version_maestro": 1,
                    "fecha_alta": str(self.fecha_inicio),
                }
            )

        return pd.DataFrame(filas), perfiles

    def _perfil_de_arquetipo(self, arquetipo: str) -> _PerfilSKU:
        """Traduce un arquetipo de demanda a parametros del proceso generador.

        Args:
            arquetipo: uno de REGULAR, ESTACIONAL, TENDENCIA, INTERMITENTE,
                PROMO_SENSIBLE o NUEVO.

        Returns:
            _PerfilSKU: parametros latentes del SKU.
        """
        r = self.rng
        base = {
            # (nivel, tendencia anual, amplitud, k dispersion, p ocurrencia, promo)
            "REGULAR": (r.uniform(25, 220), r.uniform(-0.02, 0.05), r.uniform(0.04, 0.12), 12.0, 1.0, 1.15),
            "ESTACIONAL": (r.uniform(30, 260), r.uniform(-0.03, 0.06), r.uniform(0.28, 0.55), 9.0, 1.0, 1.25),
            "TENDENCIA": (r.uniform(20, 150), r.uniform(0.18, 0.45), r.uniform(0.05, 0.18), 10.0, 1.0, 1.2),
            "INTERMITENTE": (r.uniform(1.5, 12), r.uniform(-0.05, 0.05), r.uniform(0.02, 0.10), 2.5, r.uniform(0.08, 0.35), 1.05),
            "PROMO_SENSIBLE": (r.uniform(35, 200), r.uniform(-0.02, 0.08), r.uniform(0.15, 0.30), 6.0, 1.0, r.uniform(1.8, 3.2)),
            "NUEVO": (r.uniform(15, 120), r.uniform(0.30, 0.80), r.uniform(0.08, 0.22), 7.0, 1.0, 1.3),
        }[arquetipo]

        nivel, tend_anual, amplitud, k, p_occ, promo = base
        dia_lanz = int(self.n_dias * float(r.uniform(0.45, 0.75))) if arquetipo == "NUEVO" else 0

        return _PerfilSKU(
            nivel_base=float(nivel),
            # Tendencia anual compuesta -> factor diario equivalente
            tendencia_diaria=float((1.0 + tend_anual) ** (1.0 / 365.25)),
            amplitud_anual=float(amplitud),
            fase_anual=float(r.uniform(0, 2 * math.pi)),
            dispersion_k=float(k),
            prob_ocurrencia=float(p_occ),
            sensibilidad_promo=float(promo),
            dia_lanzamiento=dia_lanz,
        )

    # =========================================================================
    # 3. RELACION SKU-PROVEEDOR (parametria de abastecimiento)
    # =========================================================================
    @staticmethod
    def _parametros_lognormal(media_exceso: float, sigma_exceso: float) -> tuple[float, float]:
        """Parametros de la log-normal desplazada del lead time.

        Delega en `engine.inventario.parametros_lognormal`, que es el unico
        lugar donde vive la conversion por momentos. El generador sintetico y el
        importador de parametria real deben producir exactamente los mismos
        numeros a partir de la misma media y desviacion; dos implementaciones
        acabarian divergiendo.

        Args:
            media_exceso: media deseada del exceso sobre el lead time minimo.
            sigma_exceso: desviacion estandar deseada de ese exceso.

        Returns:
            tuple[float, float]: (mu_ln, sigma_ln).
        """
        return parametros_lognormal(media_exceso, sigma_exceso)

    def _generar_sku_proveedor(
        self, materiales: pd.DataFrame, proveedores: pd.DataFrame
    ) -> pd.DataFrame:
        """Asigna proveedores y parametria de compra a cada SKU.

        Args:
            materiales: maestro de materiales.
            proveedores: maestro de proveedores.

        Returns:
            pd.DataFrame: relacion sku-proveedor con la distribucion de lead time.
        """
        filas: list[dict[str, Any]] = []
        ids_prov = proveedores["proveedor_id"].to_numpy()
        es_importado = dict(zip(proveedores["proveedor_id"], proveedores["es_importado"]))

        for _, mat in materiales.iterrows():
            # Entre 1 y 3 proveedores: el numero de fuentes alternativas es un
            # determinante directo del riesgo de suministro de Kraljic.
            n_prov = int(self.rng.choice([1, 2, 3], p=[0.42, 0.40, 0.18]))
            elegidos = self.rng.choice(ids_prov, size=n_prov, replace=False)

            for prioridad, prov in enumerate(elegidos, start=1):
                importado = bool(es_importado[prov])
                lt_min = float(self.rng.uniform(25, 45)) if importado else float(self.rng.uniform(2, 7))
                exceso_medio = float(self.rng.uniform(12, 30)) if importado else float(self.rng.uniform(4, 14))
                cv = self.p.cv_lead_time * (self.p.factor_cv_importado if importado else 1.0)
                sigma_exceso = exceso_medio * cv
                mu_ln, sigma_ln = self._parametros_lognormal(exceso_medio, sigma_exceso)

                lt_medio = lt_min + exceso_medio
                # Desviacion del LT total = desviacion del exceso (el shift es
                # una constante y no aporta varianza).
                lt_sigma = sigma_exceso

                precio = float(mat["costo_unitario"]) * float(self.rng.uniform(0.94, 1.09))
                filas.append(
                    {
                        "sku": mat["sku"],
                        "proveedor_id": str(prov),
                        "prioridad": prioridad,
                        "precio_unitario": round(precio, 4),
                        "moq": float(self.rng.choice([1, 50, 100, 250, 500])),
                        "lote_multiplo": float(self.rng.choice([1, 10, 12, 20, 25, 50])),
                        "lead_time_min_dias": round(lt_min, 2),
                        "lead_time_medio_dias": round(lt_medio, 2),
                        "lead_time_sigma_dias": round(lt_sigma, 3),
                        "ln_mu": round(mu_ln, 6),
                        "ln_sigma": round(sigma_ln, 6),
                        "homologado": 1,
                    }
                )
        return pd.DataFrame(filas)

    # =========================================================================
    # 4. DISRUPCIONES
    # =========================================================================
    def _generar_disrupciones(
        self, proveedores: pd.DataFrame, materiales: pd.DataFrame
    ) -> pd.DataFrame:
        """Genera eventos exogenos que alteran lead time y/o demanda.

        Returns:
            pd.DataFrame: eventos de disrupcion del horizonte historico.
        """
        filas: list[dict[str, Any]] = []
        categorias = materiales["categoria"].unique().tolist()

        for _ in range(self.p.n_disrupciones):
            tipo = str(self.rng.choice(_TIPOS_DISRUPCION))
            ambito = str(self.rng.choice(["PROVEEDOR", "CATEGORIA", "GLOBAL"], p=[0.5, 0.3, 0.2]))
            if ambito == "PROVEEDOR":
                valor = str(self.rng.choice(proveedores["proveedor_id"].to_numpy()))
            elif ambito == "CATEGORIA":
                valor = str(self.rng.choice(categorias))
            else:
                valor = None

            dur = int(self.rng.integers(*self.p.duracion_disrupcion_dias))
            inicio_idx = int(self.rng.integers(30, max(31, self.n_dias - dur - 1)))
            f_ini = self.fecha_inicio + timedelta(days=inicio_idx)
            f_fin = f_ini + timedelta(days=dur)

            filas.append(
                {
                    "tipo": tipo,
                    "ambito": ambito,
                    "ambito_valor": valor,
                    "fecha_inicio": str(f_ini),
                    "fecha_fin": str(f_fin),
                    "factor_lead_time": round(float(self.rng.uniform(*self.p.factor_lt_disrupcion)), 3),
                    "factor_demanda": round(float(self.rng.uniform(0.82, 1.25)), 3),
                    "descripcion": f"{tipo} con impacto sobre {ambito.lower()} {valor or 'nacional'}",
                }
            )
        return pd.DataFrame(filas)

    def _cargar_mapa_disrupciones(self) -> list[dict[str, Any]]:
        """Relee las disrupciones ya persistidas para obtener sus IDs.

        Returns:
            list[dict]: eventos con su `id_disrupcion` asignado por SQLite.
        """
        df = self.db.consultar_df("SELECT * FROM eventos_disrupcion;")
        eventos: list[dict[str, Any]] = []
        for _, r in df.iterrows():
            eventos.append(
                {
                    "id": int(r["id_disrupcion"]),
                    "ambito": r["ambito"],
                    "valor": r["ambito_valor"],
                    "ini": (date.fromisoformat(r["fecha_inicio"]) - self.fecha_inicio).days,
                    "fin": (date.fromisoformat(r["fecha_fin"]) - self.fecha_inicio).days,
                    "f_lt": float(r["factor_lead_time"]),
                    "f_dem": float(r["factor_demanda"]),
                }
            )
        return eventos

    # =========================================================================
    # 5. SIMULACION OPERATIVA DIA A DIA
    # =========================================================================
    def _demanda_latente(self, perfil: _PerfilSKU, promos: np.ndarray, factor_evento: np.ndarray) -> np.ndarray:
        """Genera la serie diaria de demanda latente (no censurada).

        Estructura multiplicativa:

            mu_t = nivel * tendencia^t * (1 + A*sin(2*pi*t/365.25 + fase))
                   * factor_dia_semana * factor_promo * factor_evento

        y luego un sorteo Gamma-Poisson con media mu_t y forma k, que produce
        una binomial negativa: Var = mu + mu^2/k > mu. La sobredispersion es la
        norma en demanda real; usar Poisson pura subestima el stock de seguridad.

        Args:
            perfil: parametros latentes del SKU.
            promos: vector binario de dias con promocion.
            factor_evento: multiplicador diario por disrupciones de demanda.

        Returns:
            np.ndarray: demanda latente diaria, entera y no negativa.
        """
        t = np.arange(self.n_dias, dtype=float)
        tendencia = perfil.tendencia_diaria ** t
        estacional = 1.0 + perfil.amplitud_anual * np.sin(
            2.0 * np.pi * t / 365.25 + perfil.fase_anual
        )
        dow = self.fechas.dayofweek.to_numpy()
        # Perfil semanal tipico de canal peruano: pico viernes-sabado.
        pesos_dow = np.array([0.92, 0.90, 0.95, 1.00, 1.14, 1.28, 0.81])
        semanal = pesos_dow[dow]
        promo_factor = np.where(promos == 1, perfil.sensibilidad_promo, 1.0)

        mu = perfil.nivel_base * tendencia * estacional * semanal * promo_factor * factor_evento
        mu = np.clip(mu, 0.01, None)

        # Ciclo de vida: antes del lanzamiento no hay demanda; despues, rampa.
        if perfil.dia_lanzamiento > 0:
            rampa = np.clip((t - perfil.dia_lanzamiento) / 60.0, 0.0, 1.0)
            mu = mu * rampa

        # Mixtura Gamma-Poisson -> binomial negativa
        k = perfil.dispersion_k
        lam = self.rng.gamma(shape=k, scale=mu / k)
        demanda = self.rng.poisson(lam).astype(float)

        # Intermitencia (estructura de Croston): ocurrencia Bernoulli
        if perfil.prob_ocurrencia < 1.0:
            ocurre = self.rng.random(self.n_dias) < perfil.prob_ocurrencia
            demanda = np.where(ocurre, np.maximum(demanda, 1.0), 0.0)

        return demanda

    def _simular_operacion(
        self,
        materiales: pd.DataFrame,
        perfiles: dict[str, _PerfilSKU],
        relaciones: pd.DataFrame,
        disrupciones: list[dict[str, Any]],
    ) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
        """Simula demanda, inventario y ciclo de compra para todos los SKU.

        Politica de reposicion aplicada: revision continua (s, S) con punto de
        pedido calculado sobre la VARIANZA DE LA DEMANDA DURANTE EL LEAD TIME,
        contemplando lead time estocastico (formula de King):

            sigma_DDLT = sqrt( L_bar * sigma_d^2 + d_bar^2 * sigma_L^2 )
            s (ROP)    = d_bar * L_bar + z * sigma_DDLT
            S          = ROP + max(EOQ, d_bar * dias_cobertura_objetivo)

        Omitir el segundo sumando (el termino `d_bar^2 * sigma_L^2`) es el error
        clasico: subestima la proteccion justo en los materiales importados,
        donde sigma_L domina la varianza total.

        Returns:
            tuple: (demanda, inventario_diario, ordenes_compra).
        """
        filas_dem: list[dict[str, Any]] = []
        filas_inv: list[dict[str, Any]] = []
        filas_oc: list[dict[str, Any]] = []
        contador_oc = 0

        rel_por_sku = {s: g for s, g in relaciones.groupby("sku", sort=False)}
        fechas_str = [d.strftime("%Y-%m-%d") for d in self.fechas]

        for _, mat in materiales.iterrows():
            sku = str(mat["sku"])
            perfil = perfiles[sku]
            rel = rel_por_sku[sku].sort_values("prioridad").iloc[0]

            # --- Factores exogenos que afectan a este SKU ---
            f_dem = np.ones(self.n_dias)
            f_lt = np.ones(self.n_dias)
            id_disr = np.full(self.n_dias, -1, dtype=int)
            for ev in disrupciones:
                aplica = (
                    ev["ambito"] == "GLOBAL"
                    or (ev["ambito"] == "CATEGORIA" and ev["valor"] == mat["categoria"])
                    or (ev["ambito"] == "PROVEEDOR" and ev["valor"] == rel["proveedor_id"])
                )
                if not aplica:
                    continue
                ini, fin = max(0, ev["ini"]), min(self.n_dias - 1, ev["fin"])
                f_dem[ini : fin + 1] *= ev["f_dem"]
                f_lt[ini : fin + 1] *= ev["f_lt"]
                id_disr[ini : fin + 1] = ev["id"]

            # --- Promociones y demanda latente ---
            promos = (self.rng.random(self.n_dias) < 0.07).astype(int)
            demanda_lat = self._demanda_latente(perfil, promos, f_dem)

            # --- Parametria de inventario ---
            d_bar = max(float(demanda_lat.mean()), 0.01)
            sigma_d = max(float(demanda_lat.std(ddof=1)), 0.01)
            lt_bar = float(rel["lead_time_medio_dias"])
            sigma_lt = float(rel["lead_time_sigma_dias"])
            lt_min = float(rel["lead_time_min_dias"])
            ln_mu, ln_sigma = float(rel["ln_mu"]), float(rel["ln_sigma"])

            # z provisional por criticidad (la clase ABC aun no existe)
            z = {1: 1.282, 2: 1.282, 3: 1.645, 4: 2.054, 5: 2.326}[int(mat["criticidad_operativa"])]
            sigma_ddlt = math.sqrt(lt_bar * sigma_d**2 + (d_bar**2) * (sigma_lt**2))
            rop = d_bar * lt_bar + z * sigma_ddlt

            # EOQ de Harris (1913): sqrt(2*D*S / H)
            demanda_anual = d_bar * 365.25
            costo_mantener = float(mat["costo_unitario"]) * settings.INVENTARIO.factor_costo_mantener
            eoq = math.sqrt(
                2.0 * demanda_anual * settings.INVENTARIO.costo_por_pedido / max(costo_mantener, 1e-6)
            )
            lote_mult = float(rel["lote_multiplo"])
            moq = float(rel["moq"])
            nivel_objetivo = rop + max(eoq, d_bar * 21.0)

            # --- Estado inicial ---
            stock = float(rop * self.rng.uniform(0.8, 1.4))
            transito: dict[int, float] = {}          # dia_llegada -> cantidad
            bloqueado: dict[int, float] = {}         # dia_liberacion -> cantidad
            pendiente_aprobacion: list[dict[str, Any]] = []
            en_curso = 0.0                           # cantidad ya comprometida

            vida_util = mat["vida_util_dias"]
            tasa_merma = (1.0 / float(vida_util)) * 0.25 if vida_util and not pd.isna(vida_util) else 0.0

            for t in range(self.n_dias):
                stock_ini = stock
                # 1) Recepciones del dia
                recep = transito.pop(t, 0.0)
                liberado = bloqueado.pop(t, 0.0)
                stock += recep + liberado
                en_curso = max(0.0, en_curso - recep)

                # 2) Consumo: la censura emerge aqui
                dem = float(demanda_lat[t])
                consumo = min(dem, stock)
                perdida_real = dem - consumo
                stock -= consumo

                # 3) Merma de perecibles (aproximacion de deterioro proporcional)
                merma = stock * tasa_merma if tasa_merma > 0 else 0.0
                stock = max(0.0, stock - merma)

                # 4) Posicion de inventario y decision de reposicion
                stock_transito = sum(transito.values())
                posicion = stock + stock_transito + en_curso * 0.0  # transito ya contiene lo emitido
                if posicion <= rop:
                    cantidad = max(nivel_objetivo - posicion, moq)
                    cantidad = math.ceil(cantidad / lote_mult) * lote_mult
                    if cantidad > 0:
                        pendiente_aprobacion.append({"t_sol": t, "cant": cantidad})

                # 5) Ciclo de aprobacion y emision de las requisiciones creadas hoy
                nuevas = [r for r in pendiente_aprobacion if r["t_sol"] == t]
                for req in nuevas:
                    contador_oc += 1
                    oc = self._procesar_orden(
                        contador_oc, sku, rel, mat, req, t, f_lt, id_disr,
                        lt_min, ln_mu, ln_sigma, lt_bar, fechas_str,
                    )
                    filas_oc.append(oc)
                    # Programar la llegada dentro del horizonte simulado
                    t_llegada = oc["_t_llegada"]
                    if t_llegada < self.n_dias:
                        transito[t_llegada] = transito.get(t_llegada, 0.0) + oc["cantidad_recibida"]
                        if oc["cantidad_rechazada_calidad"] > 0:
                            # El material rechazado permanece bloqueado 10 dias
                            t_lib = min(self.n_dias - 1, t_llegada + 10)
                            bloqueado[t_lib] = bloqueado.get(t_lib, 0.0) + 0.0
                    del oc["_t_llegada"]
                pendiente_aprobacion = [r for r in pendiente_aprobacion if r["t_sol"] != t]

                # 6) Registro diario
                # Horas sin stock estimadas por proporcion de demanda no
                # atendida. Piso de 0.01 h: un quiebre marginal sigue siendo un
                # quiebre, y el esquema exige coherencia entre la bandera de
                # censura y la existencia de horas sin stock (CHECK del DDL).
                horas_sin_stock = 0.0
                quiebre = int(perdida_real > 1e-9)
                if quiebre:
                    horas_sin_stock = max(0.01, round(24.0 * (perdida_real / max(dem, 1e-9)), 2))

                filas_dem.append(
                    {
                        "fecha": fechas_str[t],
                        "sku": sku,
                        "centro": self.p.centro_default,
                        "demanda_atendida": round(consumo, 3),
                        "devoluciones": round(consumo * 0.01, 3) if self.rng.random() < 0.05 else 0.0,
                        "precio_neto": round(
                            float(mat["costo_unitario"]) * (1.28 if not promos[t] else 1.12), 4
                        ),
                        "promocion_activa": int(promos[t]),
                        "evento": None if id_disr[t] < 0 else f"DISRUPCION_{id_disr[t]}",
                        "horas_sin_stock": horas_sin_stock,
                        "flag_censura": quiebre,
                        "demanda_perdida_estimada": None,   # se calcula despues
                        "metodo_estimacion_perdida": None,
                        "demanda_latente_sintetica": round(dem, 3),
                        "origen_dato": "SINTETICO",
                    }
                )
                filas_inv.append(
                    {
                        "fecha": fechas_str[t],
                        "sku": sku,
                        "centro": self.p.centro_default,
                        "stock_inicial": round(stock_ini, 3),
                        "recepciones": round(recep + liberado, 3),
                        "consumo": round(consumo, 3),
                        "mermas": round(merma, 3),
                        "stock_final": round(stock, 3),
                        "stock_transito": round(sum(transito.values()), 3),
                        "stock_reservado": 0.0,
                        "stock_bloqueado_calidad": round(sum(bloqueado.values()), 3),
                        "posicion_inventario": round(stock + sum(transito.values()), 3),
                        "quiebre_flag": quiebre,
                        "palets_ocupados": round(stock / float(mat["unidades_por_palet"]), 4),
                        "volumen_ocupado_m3": round(stock * float(mat["volumen_m3_unidad"]), 4),
                    }
                )

        return (
            pd.DataFrame(filas_dem),
            pd.DataFrame(filas_inv),
            pd.DataFrame(filas_oc),
        )

    def _procesar_orden(
        self,
        secuencia: int,
        sku: str,
        rel: pd.Series,
        mat: pd.Series,
        req: dict[str, Any],
        t: int,
        f_lt: np.ndarray,
        id_disr: np.ndarray,
        lt_min: float,
        ln_mu: float,
        ln_sigma: float,
        lt_bar: float,
        fechas_str: list[str],
    ) -> dict[str, Any]:
        """Construye una orden de compra completa con su cadena de fechas.

        Aqui se inyecta la FRICCION ORGANIZACIONAL. El retraso total se
        descompone en dos tramos disjuntos y trazables:

            dias_retraso_aprobacion = (fecha_emision - fecha_solicitud) - SLA
            dias_retraso_proveedor  = fecha_real_recepcion - fecha_prometida

        Esta separacion es lo que permitira al agente diagnostico responder
        "el quiebre de marzo no fue del proveedor, fue de la aprobacion
        presupuestal", que es precisamente la debilidad de control que el
        Director pidio reflejar.

        Returns:
            dict: fila de `ordenes_compra` mas la clave interna `_t_llegada`.
        """
        rng = self.rng
        cantidad = float(req["cant"])
        precio = float(rel["precio_unitario"])

        # --- Tramo 1: aprobacion de Finanzas ---
        hay_friccion = bool(rng.random() < self.p.prob_friccion_finanzas)
        if hay_friccion:
            # Gamma asimetrica: la mayoria de los bloqueos se resuelven rapido,
            # unos pocos se eternizan. La media y la dispersion son parametros.
            forma = (self.p.dias_retraso_aprob_media / self.p.dias_retraso_aprob_dispersion) ** 2
            escala = (self.p.dias_retraso_aprob_dispersion ** 2) / self.p.dias_retraso_aprob_media
            retraso_aprob = float(np.ceil(rng.gamma(shape=forma, scale=escala)))
            estado_fin = "APROBADA_CON_RETRASO"
            motivo = str(rng.choice(_MOTIVOS_BLOQUEO))
        else:
            retraso_aprob = 0.0
            estado_fin = "APROBADA"
            motivo = None

        t_aprob = t + SLA_APROBACION_DIAS + int(retraso_aprob)
        t_emision = t_aprob  # se emite el mismo dia de la liberacion presupuestal

        # --- Tramo 2: transporte del proveedor ---
        factor = float(f_lt[min(t_emision, self.n_dias - 1)])
        lt_real = lt_min + float(rng.lognormal(mean=ln_mu, sigma=ln_sigma))
        lt_real *= factor
        t_llegada = t_emision + int(round(lt_real))
        t_prometida = t_emision + int(round(lt_bar))
        retraso_prov = max(0.0, float(t_llegada - t_prometida))

        # --- Recepcion: parcialidad y rechazo de calidad ---
        recibida = cantidad
        if rng.random() < self.p.prob_entrega_parcial:
            recibida = round(cantidad * float(rng.uniform(0.55, 0.95)), 3)
        rechazada = 0.0
        if rng.random() < self.p.prob_rechazo_calidad:
            rechazada = round(recibida * float(rng.uniform(0.02, 0.20)), 3)
            recibida = round(recibida - rechazada, 3)

        # --- Atribucion de causa raiz ---
        if retraso_aprob > 0 and retraso_prov > 0:
            causa = "CAUSA_MIXTA"
        elif retraso_aprob > 0:
            causa = "BLOQUEO_FINANZAS" if retraso_aprob > 5 else "APROBACION_TARDIA"
        elif retraso_prov > 0:
            disr = int(id_disr[min(t_emision, self.n_dias - 1)])
            causa = "DISRUPCION_LOGISTICA" if disr > 0 and factor > 1.0 else "INCUMPLIMIENTO_PROVEEDOR"
        elif rechazada > 0:
            causa = "RECHAZO_CALIDAD"
        else:
            causa = "SIN_RETRASO"

        dentro = t_llegada < self.n_dias
        idx_disr = int(id_disr[min(t_emision, self.n_dias - 1)])

        def _f(i: int) -> str | None:
            return fechas_str[i] if 0 <= i < self.n_dias else None

        return {
            "id_orden": f"OC{secuencia:07d}",
            "linea": 1,
            "sku": sku,
            "proveedor_id": str(rel["proveedor_id"]),
            "centro": self.p.centro_default,
            "fecha_necesidad": fechas_str[min(t + int(lt_bar), self.n_dias - 1)],
            "fecha_solicitud": fechas_str[t],
            "fecha_aprobacion_finanzas": _f(t_aprob) or fechas_str[-1],
            "fecha_emision": _f(t_emision) or fechas_str[-1],
            "fecha_prometida": _f(t_prometida) or fechas_str[-1],
            "fecha_real_recepcion": _f(t_llegada) if dentro else None,
            "estado_aprobacion_finanzas": estado_fin,
            "motivo_bloqueo_finanzas": motivo,
            "cantidad_solicitada": cantidad,
            "cantidad_recibida": recibida if dentro else 0.0,
            "cantidad_rechazada_calidad": rechazada if dentro else 0.0,
            "precio_unitario": round(precio, 4),
            "moneda": "PEN",
            "costo_total": round(cantidad * precio, 2),
            "lead_time_plan_dias": round(lt_bar, 2),
            "lead_time_real_dias": round(float(t_llegada - t_emision), 2) if dentro else None,
            "dias_retraso_aprobacion": retraso_aprob,
            "dias_retraso_proveedor": retraso_prov if dentro else 0.0,
            "dias_retraso_total": retraso_aprob + (retraso_prov if dentro else 0.0),
            "causa_raiz_retraso": causa if dentro else "SIN_RETRASO",
            "id_disrupcion": idx_disr if idx_disr > 0 else None,
            "es_compra_urgente": int(retraso_aprob > 8),
            "estado_orden": (
                "RECIBIDA_PARCIAL" if dentro and recibida < cantidad
                else "RECIBIDA_TOTAL" if dentro
                else "EN_TRANSITO"
            ),
            "usuario_aprobador": f"USR{int(self.rng.integers(1, 7)):02d}",
            "id_corrida": None,
            "_t_llegada": t_llegada,
        }

    # =========================================================================
    # 6. CORRECCION DE CENSURA
    # =========================================================================
    def _estimar_demanda_perdida(self, demanda: pd.DataFrame) -> pd.DataFrame:
        """Estima la demanda perdida a partir de la disponibilidad observada.

        Metodo `PRORRATEO_DISPONIBILIDAD`, el mismo del ejemplo de los documentos
        base (900 ventas en 24 de 30 dias disponibles -> 900/24*30 = 1125):

            demanda_estimada = atendida * 24 / (24 - horas_sin_stock)
            perdida_estimada = demanda_estimada - atendida

        Es una APROXIMACION, no una medicion, y por eso se persiste en columna
        propia con su metodo declarado, dejando intacta `demanda_atendida`. El
        supuesto que la sostiene (tasa de venta homogenea dentro del dia) se
        rompe en dias de promocion, de modo que ahi se acota el factor de
        expansion para no fabricar demanda.

        Args:
            demanda: DataFrame de demanda diaria con `horas_sin_stock`.

        Returns:
            pd.DataFrame: el mismo DataFrame con las columnas de estimacion.
        """
        h = demanda["horas_sin_stock"].to_numpy(dtype=float)
        atendida = demanda["demanda_atendida"].to_numpy(dtype=float)
        promo = demanda["promocion_activa"].to_numpy(dtype=int)

        horas_disp = np.clip(24.0 - h, 1.0, 24.0)  # piso de 1h: evita division explosiva
        factor = 24.0 / horas_disp
        # Tope de expansion: x3 en dia normal, x2 en promocion (la tasa horaria
        # de un dia promocional no es extrapolable linealmente).
        tope = np.where(promo == 1, 2.0, 3.0)
        factor = np.minimum(factor, tope)

        estimada = atendida * factor
        perdida = np.where(h > 0, np.maximum(estimada - atendida, 0.0), 0.0)

        demanda = demanda.copy()
        demanda["demanda_perdida_estimada"] = np.round(perdida, 3)
        demanda["metodo_estimacion_perdida"] = np.where(
            h > 0, "PRORRATEO_DISPONIBILIDAD_v1", None
        )
        return demanda

    # =========================================================================
    # 7. SEGMENTACION POSTERIOR (ABC / XYZ / KRALJIC)
    # =========================================================================
    def _recalcular_segmentacion(self) -> None:
        """Reclasifica los SKU con el consumo valorizado realmente observado.

        Orden metodologico: primero medir, despues clasificar. Se calcula sobre
        la demanda CORREGIDA por censura, no sobre la venta observada: clasificar
        con ventas censuradas degrada a clase C justamente los articulos que mas
        quiebres tuvieron, que es el error que perpetua el quiebre.

        Cortes aplicados (politica documentada, no ley natural):
            ABC por Pareto acumulado: A hasta 80%, B hasta 95%, C el resto.
            XYZ por coeficiente de variacion mensual: X < 0.50, Y < 1.00, Z >= 1.00.
            Kraljic: corte en 0.50 sobre ambos scores normalizados.
        """
        df = self.db.consultar_df(
            """
            SELECT  d.sku,
                    SUM(d.demanda_atendida + COALESCE(d.demanda_perdida_estimada,0)) AS unidades,
                    SUM((d.demanda_atendida + COALESCE(d.demanda_perdida_estimada,0))
                        * m.costo_unitario)                                          AS valor_consumo
            FROM    historico_demanda d
            JOIN    maestro_materiales m ON m.sku = d.sku
            GROUP BY d.sku;
            """
        )
        if df.empty:
            _log.warning("Sin datos para segmentar")
            return

        # --- ABC sobre valor de consumo ---
        df = df.sort_values("valor_consumo", ascending=False).reset_index(drop=True)
        total = float(df["valor_consumo"].sum()) or 1.0
        df["acum"] = df["valor_consumo"].cumsum() / total
        df["clase_abc"] = np.where(df["acum"] <= 0.80, "A", np.where(df["acum"] <= 0.95, "B", "C"))
        # Score de impacto economico: percentil normalizado [0,1]
        df["score_impacto"] = df["valor_consumo"].rank(pct=True)

        # --- XYZ sobre el CV de la demanda mensual corregida ---
        mensual = self.db.consultar_df(
            """
            SELECT  substr(fecha,1,7) AS periodo, sku,
                    SUM(demanda_atendida + COALESCE(demanda_perdida_estimada,0)) AS u
            FROM    historico_demanda
            GROUP BY periodo, sku;
            """
        )
        cv = (
            mensual.groupby("sku")["u"]
            .agg(lambda s: float(s.std(ddof=1)) / float(s.mean()) if float(s.mean()) > 0 else 0.0)
            .rename("cv")
            .reset_index()
        )
        df = df.merge(cv, on="sku", how="left")
        df["cv"] = df["cv"].fillna(0.0)
        df["clase_xyz"] = np.where(df["cv"] < 0.50, "X", np.where(df["cv"] < 1.00, "Y", "Z"))

        # --- Riesgo de suministro: combinacion ponderada y documentada ---
        riesgo = self.db.consultar_df(
            """
            SELECT  sp.sku,
                    COUNT(DISTINCT sp.proveedor_id)     AS n_proveedores,
                    MAX(p.es_importado)                 AS importado,
                    AVG(sp.lead_time_medio_dias)        AS lt_medio,
                    AVG(sp.lead_time_sigma_dias)        AS lt_sigma,
                    m.criticidad_operativa              AS criticidad
            FROM    sku_proveedor sp
            JOIN    maestro_proveedores p ON p.proveedor_id = sp.proveedor_id
            JOIN    maestro_materiales  m ON m.sku = sp.sku
            GROUP BY sp.sku, m.criticidad_operativa;
            """
        )
        lt_norm = riesgo["lt_medio"] / max(float(riesgo["lt_medio"].max()), 1e-6)
        cv_lt = riesgo["lt_sigma"] / riesgo["lt_medio"].clip(lower=1e-6)
        cv_lt_norm = (cv_lt / max(float(cv_lt.max()), 1e-6)).clip(0, 1)
        escasez_fuente = (4.0 - riesgo["n_proveedores"].clip(upper=3)) / 3.0
        criticidad_norm = (riesgo["criticidad"] - 1.0) / 4.0

        riesgo["score_riesgo"] = (
            0.22 * lt_norm
            + 0.20 * cv_lt_norm
            + 0.28 * escasez_fuente
            + 0.12 * riesgo["importado"].astype(float)
            + 0.18 * criticidad_norm
        ).clip(0.0, 1.0)

        df = df.merge(riesgo[["sku", "score_riesgo"]], on="sku", how="left")
        df["score_riesgo"] = df["score_riesgo"].fillna(0.5)

        # --- Matriz de Kraljic (1983) ---
        alto_imp = df["score_impacto"] >= 0.50
        alto_rsg = df["score_riesgo"] >= 0.50
        df["segmento"] = np.select(
            [alto_imp & alto_rsg, alto_imp & ~alto_rsg, ~alto_imp & alto_rsg],
            ["ESTRATEGICO", "APALANCADO", "CUELLO_DE_BOTELLA"],
            default="RUTINARIO",
        )

        filas = [
            (
                round(float(r["score_impacto"]), 4),
                round(float(r["score_riesgo"]), 4),
                str(r["segmento"]),
                str(r["clase_abc"]),
                str(r["clase_xyz"]),
                round(float(r["cv"]), 4),
                str(r["sku"]),
            )
            for _, r in df.iterrows()
        ]
        self.db.ejecutar_masivo(
            """
            UPDATE maestro_materiales
               SET score_impacto_economico = ?,
                   score_riesgo_suministro = ?,
                   segmento_kraljic        = ?,
                   clase_abc               = ?,
                   clase_xyz               = ?,
                   cv_demanda              = ?,
                   version_maestro         = version_maestro + 1
             WHERE sku = ?;
            """,
            filas,
        )
        _log.info("Segmentacion recalculada para %d SKU", len(filas))

    # =========================================================================
    # 8. TRAZABILIDAD DE PARAMETROS
    # =========================================================================
    def _registrar_parametros_usados(self) -> None:
        """Persiste la parametria de la corrida para que el dataset sea auditable."""
        import json

        registros = [
            ("semilla", str(self.p.semilla), "INT", "Semilla PCG64 de la corrida"),
            ("n_skus", str(self.p.n_skus), "INT", "SKU generados"),
            ("meses_historia", str(self.p.meses_historia), "INT", "Meses de historia diaria"),
            ("fecha_corte", self.p.fecha_corte, "TEXT", "Fecha de corte operativo"),
            ("sla_aprobacion_dias", str(SLA_APROBACION_DIAS), "INT", "SLA interno de Finanzas"),
            ("prob_friccion_finanzas", str(self.p.prob_friccion_finanzas), "FLOAT",
             "Proporcion de OC con retraso imputable a Finanzas"),
            ("cv_lead_time", str(self.p.cv_lead_time), "FLOAT", "CV base del lead time"),
            ("mezcla_arquetipos", json.dumps(self.p.mezcla_arquetipos), "JSON",
             "Mezcla de arquetipos de demanda"),
            ("politica_abc", json.dumps({"A": 0.80, "B": 0.95}), "JSON", "Cortes Pareto ABC"),
            ("politica_xyz", json.dumps({"X": 0.50, "Y": 1.00}), "JSON", "Cortes de CV para XYZ"),
        ]
        try:
            self.db.ejecutar_masivo(
                "INSERT INTO parametros_sistema (clave, valor, tipo_dato, descripcion) "
                "VALUES (?, ?, ?, ?) "
                "ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor, "
                "fecha_actualizacion=datetime('now');",
                [(c, v, t, d) for c, v, t, d in registros],
            )
        except ErrorBaseDatos as exc:
            _log.warning("No se pudo registrar la parametria: %s", exc)
