"""Motor de carga de datos desde Excel y de registro directo.

Cubre el primer requisito funcional de la practica: la base debe poder cargarse
desde Excel o registrarse directamente, no solo generarse de forma sintetica.

PRINCIPIO QUE GOBIERNA TODO EL MODULO: validar antes de escribir, y escribir
todo o nada. Un importador que inserta fila por fila y se detiene en el primer
error deja la base a medio cargar, en un estado que nadie sabe describir. Aqui
el lote completo se valida en memoria, se devuelve un informe de errores con la
FILA DE EXCEL exacta, y solo si el usuario acepta se aplica una unica
transaccion.

Segundo principio: el sistema DERIVA lo que puede derivar. Al usuario se le
piden los datos que conoce -plazo medio y su desviacion en dias, impacto y
riesgo- y el importador calcula lo que se sigue de ellos: los parametros de la
log-normal del lead time y el cuadrante de Kraljic. Pedir un campo que el
sistema puede calcular es invitar a que llegue mal escrito y desalineado.

Tercer principio: los mensajes de error nombran la causa y la accion. "CHECK
constraint failed" es lo que diria SQLite; aqui se dice "la politica FEFO exige
vida util declarada, porque sin fecha de vencimiento no es ejecutable".
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd

from config import settings
from db.db_manager import DatabaseManager, ErrorBaseDatos, ErrorIntegridad
from engine.inventario import parametros_lognormal, segmento_kraljic
from utils.logger import obtener_logger

_log = obtener_logger("importador")

# Fila 1 del Excel es la cabecera; la primera fila de datos es la 2.
_OFFSET_EXCEL = 2


# =============================================================================
# DESCRIPCION DE LAS PLANTILLAS
# =============================================================================
@dataclass(frozen=True)
class Columna:
    """Una columna de una plantilla de carga.

    Attributes:
        tipo: texto | entero | decimal | fecha | periodo | booleano.
        dominio: valores admitidos; se convierte en lista desplegable en Excel.
        derivada: si es True, el sistema la calcula y no se pide al usuario.
    """

    nombre: str
    tipo: str
    obligatoria: bool = True
    dominio: tuple[str, ...] | None = None
    minimo: float | None = None
    maximo: float | None = None
    ejemplo: Any = ""
    ayuda: str = ""
    derivada: bool = False


@dataclass(frozen=True)
class Plantilla:
    """Contrato de carga de una tabla."""

    tabla: str
    titulo: str
    proposito: str
    clave: tuple[str, ...]
    columnas: tuple[Columna, ...]
    referencias: tuple[tuple[str, str, str], ...] = ()  # (col, tabla_ref, col_ref)

    @property
    def visibles(self) -> list[Columna]:
        """Columnas que el usuario debe rellenar."""
        return [c for c in self.columnas if not c.derivada]

    @property
    def nombres(self) -> list[str]:
        """Todos los nombres de columna, derivadas incluidas."""
        return [c.nombre for c in self.columnas]


def _c(nombre: str, tipo: str, **kw: Any) -> Columna:
    """Atajo de construccion de columnas."""
    return Columna(nombre=nombre, tipo=tipo, **kw)


_SI_NO = ("0", "1")

PLANTILLAS: dict[str, Plantilla] = {
    "maestro_proveedores": Plantilla(
        tabla="maestro_proveedores",
        titulo="Proveedores",
        proposito="Quien abastece. Debe cargarse antes que los materiales.",
        clave=("proveedor_id",),
        columnas=(
            _c("proveedor_id", "texto", ejemplo="PRV001", ayuda="Codigo unico y estable"),
            _c("razon_social", "texto", ejemplo="Distribuidora Andina S.A.C."),
            _c("ruc", "texto", obligatoria=False, ejemplo="20123456789",
               ayuda="11 digitos; debe ser unico"),
            _c("pais", "texto", obligatoria=False, ejemplo="PE"),
            _c("es_importado", "booleano", dominio=_SI_NO, ejemplo=0,
               ayuda="1 si el suministro es de importacion"),
            _c("moneda", "texto", dominio=("PEN", "USD"), ejemplo="PEN"),
            _c("dias_credito", "entero", obligatoria=False, minimo=0, ejemplo=30),
            _c("otif_historico", "decimal", obligatoria=False, minimo=0, maximo=1,
               ejemplo=0.9, ayuda="Fraccion entre 0 y 1, no porcentaje"),
            _c("homologado", "booleano", dominio=_SI_NO, ejemplo=1),
        ),
    ),
    "maestro_materiales": Plantilla(
        tabla="maestro_materiales",
        titulo="Materiales",
        proposito="Que se compra y como se almacena. El segmento Kraljic lo deriva el sistema.",
        clave=("sku",),
        columnas=(
            _c("sku", "texto", ejemplo="R001-ABA"),
            _c("descripcion", "texto", ejemplo="Arroz 1 kg"),
            _c("sector", "texto", dominio=("RETAIL", "INDUSTRIAL"), ejemplo="RETAIL"),
            _c("categoria", "texto", ejemplo="ABARROTES"),
            _c("familia", "texto", obligatoria=False, ejemplo="Arroz"),
            _c("unidad_base", "texto", ejemplo="UND"),
            _c("unidad_compra", "texto", ejemplo="CAJA"),
            _c("factor_conversion", "decimal", minimo=1e-9, ejemplo=12,
               ayuda="Unidades base por unidad de compra. '10 cajas' no significa nada sin este numero"),
            _c("costo_unitario", "decimal", minimo=1e-9, ejemplo=4.0),
            _c("moneda", "texto", dominio=("PEN", "USD"), ejemplo="PEN"),
            _c("volumen_m3_unidad", "decimal", minimo=1e-9, ejemplo=0.0012),
            _c("peso_kg_unidad", "decimal", minimo=1e-9, ejemplo=1.05),
            _c("unidades_por_palet", "entero", minimo=1, ejemplo=1200),
            _c("apilable_max_niveles", "entero", obligatoria=False, minimo=1, ejemplo=3),
            _c("tipo_almacenamiento", "texto",
               dominio=("RACK_SELECTIVO", "RACK_DINAMICO", "RACK_COMPACTO_DRIVE_IN",
                        "PISO_BLOQUE", "ESTANTERIA_PICKING"),
               ejemplo="RACK_SELECTIVO"),
            _c("politica_rotacion", "texto", dominio=("FIFO", "LIFO", "FEFO"), ejemplo="FIFO",
               ayuda="FEFO exige vida util. LIFO no admite material perecible"),
            _c("vida_util_dias", "entero", obligatoria=False, minimo=1, ejemplo="",
               ayuda="Vacio si no es perecible"),
            _c("compatible_gtp", "booleano", dominio=_SI_NO, ejemplo=1,
               ayuda="Solo 1 si volumen <= 0,05 m3 y peso <= 15 kg"),
            _c("motivo_no_gtp", "texto", obligatoria=False, ejemplo=""),
            _c("score_impacto_economico", "decimal", minimo=0, maximo=1, ejemplo=0.8),
            _c("score_riesgo_suministro", "decimal", minimo=0, maximo=1, ejemplo=0.3),
            _c("criticidad_operativa", "entero", minimo=1, maximo=5, ejemplo=3),
            _c("arquetipo_demanda", "texto",
               dominio=("REGULAR", "ESTACIONAL", "TENDENCIA", "INTERMITENTE",
                        "PROMO_SENSIBLE", "NUEVO"), ejemplo="REGULAR"),
            _c("clase_abc", "texto", obligatoria=False, dominio=("A", "B", "C"), ejemplo=""),
            _c("clase_xyz", "texto", obligatoria=False, dominio=("X", "Y", "Z"), ejemplo=""),
            _c("activo", "booleano", dominio=_SI_NO, ejemplo=1),
            _c("segmento_kraljic", "texto", derivada=True,
               ayuda="Derivado de los dos scores; corte en 0,50"),
        ),
    ),
    "sku_proveedor": Plantilla(
        tabla="sku_proveedor",
        titulo="Parametria de abastecimiento",
        proposito="Precio, empaque y plazo por par SKU-proveedor. Los parametros "
                  "de la distribucion del plazo los deriva el sistema.",
        clave=("sku", "proveedor_id"),
        columnas=(
            _c("sku", "texto", ejemplo="R001-ABA"),
            _c("proveedor_id", "texto", ejemplo="PRV001"),
            _c("prioridad", "entero", minimo=1, ejemplo=1,
               ayuda="1 = proveedor principal"),
            _c("precio_unitario", "decimal", minimo=1e-9, ejemplo=4.0),
            _c("moq", "decimal", minimo=1e-9, ejemplo=100,
               ayuda="Minimo de compra"),
            _c("lote_multiplo", "decimal", minimo=1e-9, ejemplo=50,
               ayuda="Empaque: la compra se redondea a multiplos de este valor"),
            _c("lead_time_min_dias", "decimal", minimo=0, ejemplo=3,
               ayuda="Plazo fisicamente minimo; nunca se entrega antes"),
            _c("lead_time_medio_dias", "decimal", minimo=1e-9, ejemplo=12,
               ayuda="Debe ser mayor que el minimo"),
            _c("lead_time_sigma_dias", "decimal", minimo=0, ejemplo=4,
               ayuda="Desviacion del plazo. Entra al cuadrado en el stock de seguridad"),
            _c("homologado", "booleano", dominio=_SI_NO, ejemplo=1),
            _c("ln_mu", "decimal", derivada=True, ayuda="Derivado del plazo medio y su sigma"),
            _c("ln_sigma", "decimal", derivada=True, ayuda="Derivado del plazo medio y su sigma"),
        ),
        referencias=(("sku", "maestro_materiales", "sku"),
                     ("proveedor_id", "maestro_proveedores", "proveedor_id")),
    ),
    "historico_demanda": Plantilla(
        tabla="historico_demanda",
        titulo="Historico de demanda",
        proposito="Lo que se vendio cada dia. La demanda perdida NO se pide: es una "
                  "inferencia y el sistema la estima desde las horas sin stock.",
        clave=("fecha", "sku", "centro"),
        columnas=(
            _c("fecha", "fecha", ejemplo="2026-01-15"),
            _c("sku", "texto", ejemplo="R001-ABA"),
            _c("centro", "texto", ejemplo="CD01"),
            _c("demanda_atendida", "decimal", minimo=0, ejemplo=120,
               ayuda="Unidades efectivamente entregadas. Es lo unico observable"),
            _c("devoluciones", "decimal", obligatoria=False, minimo=0, ejemplo=0),
            _c("precio_neto", "decimal", obligatoria=False, minimo=0, ejemplo=5.2),
            _c("promocion_activa", "booleano", obligatoria=False, dominio=_SI_NO, ejemplo=0),
            _c("evento", "texto", obligatoria=False, ejemplo=""),
            _c("horas_sin_stock", "decimal", obligatoria=False, minimo=0, maximo=24, ejemplo=0,
               ayuda="Horas del dia sin existencias. De aqui sale la correccion de censura"),
            _c("origen_dato", "texto", dominio=("ERP", "EXCEL", "MANUAL", "SINTETICO"),
               ejemplo="EXCEL"),
            _c("flag_censura", "booleano", derivada=True,
               ayuda="Derivado: 1 si hubo horas sin stock"),
        ),
        referencias=(("sku", "maestro_materiales", "sku"),),
    ),
    "inventario_diario": Plantilla(
        tabla="inventario_diario",
        titulo="Inventario diario",
        proposito="Foto diaria de existencias. Sin esto no se puede saber cuando "
                  "hubo quiebre ni evaluar politica alguna.",
        clave=("fecha", "sku", "centro"),
        columnas=(
            _c("fecha", "fecha", ejemplo="2026-01-15"),
            _c("sku", "texto", ejemplo="R001-ABA"),
            _c("centro", "texto", ejemplo="CD01"),
            _c("stock_inicial", "decimal", minimo=0, ejemplo=500),
            _c("recepciones", "decimal", obligatoria=False, minimo=0, ejemplo=0),
            _c("consumo", "decimal", obligatoria=False, minimo=0, ejemplo=120),
            _c("mermas", "decimal", obligatoria=False, minimo=0, ejemplo=0),
            _c("stock_final", "decimal", minimo=0, ejemplo=380),
            _c("stock_transito", "decimal", obligatoria=False, minimo=0, ejemplo=0),
            _c("stock_reservado", "decimal", obligatoria=False, minimo=0, ejemplo=0),
            _c("stock_bloqueado_calidad", "decimal", obligatoria=False, minimo=0, ejemplo=0),
            _c("posicion_inventario", "decimal", derivada=True,
               ayuda="Derivado: final + transito - reservado"),
            _c("quiebre_flag", "booleano", derivada=True, ayuda="Derivado: 1 si el final es cero"),
        ),
        referencias=(("sku", "maestro_materiales", "sku"),),
    ),
    "ordenes_compra": Plantilla(
        tabla="ordenes_compra",
        titulo="Ordenes de compra",
        proposito="La cadena de fechas completa. Es lo que permite separar el retraso "
                  "de aprobacion interna del incumplimiento del proveedor.",
        clave=("id_orden", "linea"),
        columnas=(
            _c("id_orden", "texto", ejemplo="OC0000001"),
            _c("linea", "entero", minimo=1, ejemplo=1),
            _c("sku", "texto", ejemplo="R001-ABA"),
            _c("proveedor_id", "texto", ejemplo="PRV001"),
            _c("centro", "texto", ejemplo="CD01"),
            _c("fecha_necesidad", "fecha", ejemplo="2026-02-01"),
            _c("fecha_solicitud", "fecha", ejemplo="2026-01-10"),
            _c("fecha_aprobacion_finanzas", "fecha", obligatoria=False, ejemplo="2026-01-12"),
            _c("fecha_emision", "fecha", obligatoria=False, ejemplo="2026-01-12"),
            _c("fecha_prometida", "fecha", obligatoria=False, ejemplo="2026-01-24"),
            _c("fecha_real_recepcion", "fecha", obligatoria=False, ejemplo="2026-01-27"),
            _c("estado_aprobacion_finanzas", "texto",
               dominio=("PENDIENTE", "APROBADA", "APROBADA_CON_RETRASO", "OBSERVADA",
                        "RECHAZADA"), ejemplo="APROBADA"),
            _c("motivo_bloqueo_finanzas", "texto", obligatoria=False, ejemplo=""),
            _c("cantidad_solicitada", "decimal", minimo=1e-9, ejemplo=650),
            _c("cantidad_recibida", "decimal", obligatoria=False, minimo=0, ejemplo=650),
            _c("cantidad_rechazada_calidad", "decimal", obligatoria=False, minimo=0, ejemplo=0),
            _c("precio_unitario", "decimal", minimo=1e-9, ejemplo=4.0),
            _c("moneda", "texto", dominio=("PEN", "USD"), ejemplo="PEN"),
            _c("estado_orden", "texto",
               dominio=("PENDIENTE_APROBACION", "APROBADA", "EMITIDA", "EN_TRANSITO",
                        "RECIBIDA_PARCIAL", "RECIBIDA_TOTAL", "CANCELADA"),
               ejemplo="RECIBIDA_TOTAL"),
            _c("es_compra_urgente", "booleano", obligatoria=False, dominio=_SI_NO, ejemplo=0),
            _c("usuario_aprobador", "texto", obligatoria=False, ejemplo="USR01"),
            _c("costo_total", "decimal", derivada=True, ayuda="Derivado: cantidad x precio"),
            _c("dias_retraso_aprobacion", "decimal", derivada=True,
               ayuda="Derivado: emision - solicitud - SLA interno"),
            _c("dias_retraso_proveedor", "decimal", derivada=True,
               ayuda="Derivado: recepcion real - fecha prometida"),
            _c("dias_retraso_total", "decimal", derivada=True, ayuda="Suma de los dos tramos"),
            _c("causa_raiz_retraso", "texto", derivada=True, ayuda="Derivada de la cadena de fechas"),
            _c("lead_time_real_dias", "decimal", derivada=True),
        ),
        referencias=(("sku", "maestro_materiales", "sku"),
                     ("proveedor_id", "maestro_proveedores", "proveedor_id")),
    ),
    "restricciones_periodo": Plantilla(
        tabla="restricciones_periodo",
        titulo="Restricciones del horizonte",
        proposito="Presupuesto y capacidad por mes. Si no se cargan, el sistema los "
                  "deriva del gasto historico y lo declara como SUPUESTO.",
        clave=("periodo", "centro"),
        columnas=(
            _c("periodo", "periodo", ejemplo="2026-10", ayuda="Formato AAAA-MM"),
            _c("centro", "texto", ejemplo="CD01"),
            _c("presupuesto_compra", "decimal", obligatoria=False, minimo=0, ejemplo=12000000),
            _c("capacidad_almacen_m3", "decimal", obligatoria=False, minimo=1e-9, ejemplo=4500),
            _c("capacidad_palets", "decimal", obligatoria=False, minimo=1e-9, ejemplo=1200),
            _c("origen", "texto", dominio=("APROBADO", "SUPUESTO", "IMPORTADO"),
               ejemplo="APROBADO"),
            _c("responsable", "texto", obligatoria=False, ejemplo="Finanzas"),
            _c("fecha_aprobacion", "fecha", obligatoria=False, ejemplo="2026-09-20"),
        ),
    ),
}

# Orden obligatorio: las claves foraneas se validan al insertar, de modo que un
# material no puede entrar antes que su proveedor.
ORDEN_CARGA: tuple[str, ...] = (
    "maestro_proveedores", "maestro_materiales", "sku_proveedor",
    "restricciones_periodo", "historico_demanda", "inventario_diario", "ordenes_compra",
)

SLA_APROBACION_DIAS: int = 2


# =============================================================================
# RESULTADOS
# =============================================================================
@dataclass
class ResultadoValidacion:
    """Informe de validacion de una hoja.

    Attributes:
        datos: DataFrame ya normalizado y con las columnas derivadas calculadas.
        errores: un registro por problema, con la fila de Excel exacta.
        filas_validas: indices de `datos` sin errores bloqueantes.
    """

    tabla: str
    datos: pd.DataFrame = field(default_factory=pd.DataFrame)
    errores: pd.DataFrame = field(default_factory=pd.DataFrame)
    filas_leidas: int = 0

    @property
    def bloqueantes(self) -> int:
        """Numero de errores que impiden cargar su fila."""
        if self.errores.empty:
            return 0
        return int((self.errores["severidad"] == "BLOQUEANTE").sum())

    @property
    def filas_validas(self) -> pd.Index:
        """Indices de las filas sin ningun error bloqueante."""
        if self.datos.empty:
            return pd.Index([])
        if self.errores.empty:
            return self.datos.index
        malas = set(
            self.errores.loc[self.errores["severidad"] == "BLOQUEANTE", "fila_excel"]
        )
        return pd.Index([i for i in self.datos.index if (i + _OFFSET_EXCEL) not in malas])

    @property
    def es_cargable(self) -> bool:
        """True si hay al menos una fila sin errores bloqueantes."""
        return len(self.filas_validas) > 0


@dataclass
class ResultadoCarga:
    """Resumen de una carga aplicada a la base."""

    tabla: str
    filas_insertadas: int = 0
    filas_descartadas: int = 0
    modo: str = "INSERT OR REPLACE"
    mensaje: str = ""
    exito: bool = True


# =============================================================================
# NORMALIZACION Y VALIDACION
# =============================================================================
def _registrar(errores: list[dict], indice: int, columna: str, valor: Any,
               problema: str, severidad: str = "BLOQUEANTE") -> None:
    """Anota un problema referido a la fila de Excel correspondiente."""
    errores.append({
        "fila_excel": int(indice) + _OFFSET_EXCEL,
        "columna": columna,
        "valor": "" if valor is None or (isinstance(valor, float) and math.isnan(valor)) else str(valor)[:60],
        "problema": problema,
        "severidad": severidad,
    })


def _a_fecha(v: Any) -> str | None:
    """Normaliza cualquier representacion de fecha a ISO AAAA-MM-DD."""
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    if isinstance(v, (datetime, date)):
        return v.strftime("%Y-%m-%d")
    texto = str(v).strip()
    if not texto:
        return None
    # Se intenta primero el formato ISO, que es el unico sin ambiguedad. Solo si
    # falla se prueba el orden dia/mes, habitual en los archivos peruanos. El
    # aviso de pandas sobre el orden se silencia a proposito: la ambiguedad ya
    # esta resuelta por el orden de los intentos y el mensaje solo asustaria al
    # usuario en una carga que es correcta.
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        ts = pd.to_datetime(texto, errors="coerce", format="%Y-%m-%d")
        if pd.isna(ts):
            ts = pd.to_datetime(texto, errors="coerce", dayfirst=True)
    return None if pd.isna(ts) else ts.strftime("%Y-%m-%d")


def _normalizar_columna(serie: pd.Series, col: Columna, errores: list[dict]) -> pd.Series:
    """Convierte una columna a su tipo destino, anotando lo que no se puede convertir."""
    if col.tipo == "texto":
        out = serie.apply(lambda v: None if v is None or (isinstance(v, float) and math.isnan(v))
                          else str(v).strip())
        return out.apply(lambda v: None if v == "" else v)

    if col.tipo in {"entero", "decimal", "booleano"}:
        num = pd.to_numeric(serie, errors="coerce")
        for i, (orig, conv) in enumerate(zip(serie, num)):
            vacio = orig is None or (isinstance(orig, float) and math.isnan(orig)) or str(orig).strip() == ""
            if pd.isna(conv) and not vacio:
                _registrar(errores, serie.index[i], col.nombre, orig,
                           f"No es un numero valido para la columna {col.nombre}")
        if col.tipo == "entero":
            return num.apply(lambda v: None if pd.isna(v) else int(round(float(v))))
        if col.tipo == "booleano":
            return num.apply(lambda v: None if pd.isna(v) else (1 if float(v) != 0 else 0))
        return num.apply(lambda v: None if pd.isna(v) else float(v))

    if col.tipo == "fecha":
        out = []
        for idx, v in serie.items():
            f = _a_fecha(v)
            vacio = v is None or (isinstance(v, float) and math.isnan(v)) or str(v).strip() == ""
            if f is None and not vacio:
                _registrar(errores, idx, col.nombre, v,
                           "Fecha no reconocida. Use AAAA-MM-DD o una celda con formato fecha")
            out.append(f)
        return pd.Series(out, index=serie.index, dtype="object")

    if col.tipo == "periodo":
        out = []
        for idx, v in serie.items():
            texto = "" if v is None else str(v).strip()
            if not texto:
                out.append(None)
                continue
            f = _a_fecha(texto)
            if f is not None:
                out.append(f[:7])
            elif len(texto) == 7 and texto[4] == "-" and texto[:4].isdigit():
                out.append(texto)
            else:
                _registrar(errores, idx, col.nombre, v, "Periodo no valido. Use AAAA-MM")
                out.append(None)
        return pd.Series(out, index=serie.index, dtype="object")

    return serie


# =============================================================================
# REGLAS DE NEGOCIO POR TABLA
# =============================================================================
def _reglas_materiales(df: pd.DataFrame, errores: list[dict]) -> pd.DataFrame:
    """Aplica y deriva las reglas del maestro de materiales."""
    gtp_vol = settings.SIMULACION.gtp_volumen_max_m3
    gtp_peso = settings.SIMULACION.gtp_peso_max_kg

    for idx, r in df.iterrows():
        rot, vida = r.get("politica_rotacion"), r.get("vida_util_dias")
        if rot == "FEFO" and (vida is None or pd.isna(vida)):
            _registrar(errores, idx, "politica_rotacion", rot,
                       "FEFO exige vida util declarada: sin fecha de vencimiento la "
                       "politica no es ejecutable")
        if rot == "LIFO" and vida is not None and not pd.isna(vida):
            _registrar(errores, idx, "politica_rotacion", rot,
                       "LIFO no admite material perecible: un rack compacto solo libera "
                       "el ultimo palet ingresado y el material viejo caducaria al fondo")
        if int(r.get("compatible_gtp") or 0) == 1:
            vol, peso = r.get("volumen_m3_unidad"), r.get("peso_kg_unidad")
            if vol is not None and float(vol) > gtp_vol:
                _registrar(errores, idx, "compatible_gtp", vol,
                           f"Volumen {float(vol):.4f} m3 supera el maximo del shuttle "
                           f"({gtp_vol} m3): no puede ser compatible GTP")
            if peso is not None and float(peso) > gtp_peso:
                _registrar(errores, idx, "compatible_gtp", peso,
                           f"Peso {float(peso):.2f} kg supera el maximo de bandeja "
                           f"({gtp_peso} kg): no puede ser compatible GTP")

    # Derivada: el cuadrante se calcula, no se escribe a mano.
    df["segmento_kraljic"] = [
        segmento_kraljic(r.get("score_impacto_economico") or 0.0,
                         r.get("score_riesgo_suministro") or 0.0)
        for _, r in df.iterrows()
    ]
    if "version_maestro" not in df.columns:
        df["version_maestro"] = 1
    return df


def _reglas_sku_proveedor(df: pd.DataFrame, errores: list[dict]) -> pd.DataFrame:
    """Valida el plazo y deriva los parametros de su distribucion."""
    mu, sigma = [], []
    for idx, r in df.iterrows():
        lt_min = float(r.get("lead_time_min_dias") or 0.0)
        lt_med = float(r.get("lead_time_medio_dias") or 0.0)
        lt_sig = float(r.get("lead_time_sigma_dias") or 0.0)
        if lt_med <= lt_min:
            _registrar(errores, idx, "lead_time_medio_dias", lt_med,
                       f"El plazo medio ({lt_med}) debe superar al minimo ({lt_min}): "
                       "el exceso sobre el minimo es lo que se modela como aleatorio")
            mu.append(0.0)
            sigma.append(0.0)
            continue
        m, s = parametros_lognormal(lt_med - lt_min, max(lt_sig, 1e-6))
        mu.append(round(m, 6))
        sigma.append(round(s, 6))
    df["ln_mu"] = mu
    df["ln_sigma"] = sigma
    return df


def _reglas_demanda(df: pd.DataFrame, errores: list[dict]) -> pd.DataFrame:
    """Deriva la bandera de censura desde las horas sin stock."""
    horas = pd.to_numeric(df.get("horas_sin_stock"), errors="coerce").fillna(0.0)
    df["horas_sin_stock"] = horas
    df["flag_censura"] = (horas > 0).astype(int)
    if "demanda_perdida_estimada" not in df.columns:
        df["demanda_perdida_estimada"] = None
    return df


def _reglas_inventario(df: pd.DataFrame, errores: list[dict]) -> pd.DataFrame:
    """Comprueba el balance y deriva posicion y bandera de quiebre."""
    for c in ("recepciones", "consumo", "mermas", "stock_transito",
              "stock_reservado", "stock_bloqueado_calidad"):
        if c not in df.columns:
            df[c] = 0.0
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0.0)

    for idx, r in df.iterrows():
        esperado = (float(r["stock_inicial"] or 0) + float(r["recepciones"])
                    - float(r["consumo"]) - float(r["mermas"]))
        real = float(r["stock_final"] or 0)
        if abs(esperado - real) > 0.01:
            _registrar(errores, idx, "stock_final", real,
                       f"El balance no cuadra: inicial + recepciones - consumo - mermas "
                       f"= {esperado:.2f}, pero el final declarado es {real:.2f}",
                       severidad="ALTA")

    df["posicion_inventario"] = (
        pd.to_numeric(df["stock_final"], errors="coerce").fillna(0.0)
        + df["stock_transito"] - df["stock_reservado"]
    )
    df["quiebre_flag"] = (pd.to_numeric(df["stock_final"], errors="coerce").fillna(0.0) <= 0).astype(int)
    return df


def _reglas_ordenes(df: pd.DataFrame, errores: list[dict]) -> pd.DataFrame:
    """Valida la cadena de fechas y deriva la descomposicion del retraso."""
    for c in ("cantidad_recibida", "cantidad_rechazada_calidad"):
        if c not in df.columns:
            df[c] = 0.0
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0.0)

    retr_ap, retr_pr, total, causa, lt_real = [], [], [], [], []
    for idx, r in df.iterrows():
        f_sol = r.get("fecha_solicitud")
        f_apr = r.get("fecha_aprobacion_finanzas")
        f_emi = r.get("fecha_emision")
        f_pro = r.get("fecha_prometida")
        f_rec = r.get("fecha_real_recepcion")

        def _d(a: Any, b: Any) -> float | None:
            if not a or not b:
                return None
            return (date.fromisoformat(str(a)) - date.fromisoformat(str(b))).days

        for etiqueta, antes, despues in (
            ("fecha_aprobacion_finanzas", f_sol, f_apr),
            ("fecha_emision", f_apr, f_emi),
            ("fecha_real_recepcion", f_emi, f_rec),
        ):
            d = _d(despues, antes)
            if d is not None and d < 0:
                _registrar(errores, idx, etiqueta, despues,
                           f"Cadena de fechas imposible: {etiqueta} es anterior a la "
                           "fecha que deberia precederla")

        sol = float(r.get("cantidad_solicitada") or 0.0)
        rec = float(r.get("cantidad_recibida") or 0.0)
        if rec > sol * 1.05:
            _registrar(errores, idx, "cantidad_recibida", rec,
                       f"Sobre-recepcion de {rec - sol:.0f} unidades sobre {sol:.0f} "
                       "solicitadas. Por encima del 5% es un error de registro")

        d_ap = max(0.0, (_d(f_emi, f_sol) or 0) - SLA_APROBACION_DIAS)
        d_pr = max(0.0, float(_d(f_rec, f_pro) or 0))
        retr_ap.append(d_ap)
        retr_pr.append(d_pr)
        total.append(d_ap + d_pr)
        lt_real.append(_d(f_rec, f_emi))

        rech = float(r.get("cantidad_rechazada_calidad") or 0.0)
        if d_ap > 0 and d_pr > 0:
            causa.append("CAUSA_MIXTA")
        elif d_ap > 0:
            causa.append("BLOQUEO_FINANZAS" if d_ap > 5 else "APROBACION_TARDIA")
        elif d_pr > 0:
            causa.append("INCUMPLIMIENTO_PROVEEDOR")
        elif rech > 0:
            causa.append("RECHAZO_CALIDAD")
        else:
            causa.append("SIN_RETRASO")

    df["dias_retraso_aprobacion"] = retr_ap
    df["dias_retraso_proveedor"] = retr_pr
    df["dias_retraso_total"] = total
    df["causa_raiz_retraso"] = causa
    df["lead_time_real_dias"] = lt_real
    df["costo_total"] = (pd.to_numeric(df["cantidad_solicitada"], errors="coerce").fillna(0.0)
                         * pd.to_numeric(df["precio_unitario"], errors="coerce").fillna(0.0)).round(2)
    if "lead_time_plan_dias" not in df.columns:
        df["lead_time_plan_dias"] = None
    return df


_REGLAS: dict[str, Callable[[pd.DataFrame, list[dict]], pd.DataFrame]] = {
    "maestro_materiales": _reglas_materiales,
    "sku_proveedor": _reglas_sku_proveedor,
    "historico_demanda": _reglas_demanda,
    "inventario_diario": _reglas_inventario,
    "ordenes_compra": _reglas_ordenes,
}


# =============================================================================
# API PRINCIPAL
# =============================================================================
def validar(
    tabla: str, df: pd.DataFrame, db: DatabaseManager | None = None
) -> ResultadoValidacion:
    """Valida y normaliza un lote SIN tocar la base.

    Orden de comprobacion, del error mas barato de corregir al mas caro:
    columnas ausentes, tipos, dominios, rangos, duplicados de clave, claves
    foraneas y por ultimo las reglas de negocio de la tabla.

    Args:
        tabla: nombre de la tabla destino.
        df: datos tal como llegaron del Excel o del editor.
        db: gestor de base, necesario para comprobar claves foraneas.

    Returns:
        ResultadoValidacion: datos normalizados y el informe de errores.

    Raises:
        KeyError: si la tabla no tiene plantilla definida.
    """
    if tabla not in PLANTILLAS:
        raise KeyError(f"No existe plantilla para la tabla '{tabla}'")
    plantilla = PLANTILLAS[tabla]
    errores: list[dict] = []

    datos = df.copy()
    datos.columns = [str(c).strip() for c in datos.columns]
    datos = datos.reset_index(drop=True)
    # Se descartan las filas completamente vacias: son el residuo habitual de
    # arrastrar formato en Excel y no deben contarse como errores.
    datos = datos.dropna(how="all").reset_index(drop=True)
    filas_leidas = len(datos)

    if filas_leidas == 0:
        return ResultadoValidacion(tabla=tabla, filas_leidas=0)

    # --- Columnas ausentes ---------------------------------------------------
    for col in plantilla.columnas:
        if col.derivada:
            continue
        if col.nombre not in datos.columns:
            if col.obligatoria:
                errores.append({
                    "fila_excel": 1, "columna": col.nombre, "valor": "",
                    "problema": f"Falta la columna obligatoria '{col.nombre}'",
                    "severidad": "BLOQUEANTE",
                })
            datos[col.nombre] = None

    # --- Tipos, obligatoriedad, dominio y rango ------------------------------
    for col in plantilla.columnas:
        if col.derivada:
            continue
        datos[col.nombre] = _normalizar_columna(datos[col.nombre], col, errores)
        serie = datos[col.nombre]

        for idx, v in serie.items():
            vacio = v is None or (isinstance(v, float) and math.isnan(v))
            if vacio:
                if col.obligatoria:
                    _registrar(errores, idx, col.nombre, v,
                               f"'{col.nombre}' es obligatorio y esta vacio")
                continue
            if col.dominio and str(v) not in col.dominio:
                _registrar(errores, idx, col.nombre, v,
                           f"Valor no admitido. Use uno de: {', '.join(col.dominio)}")
            if col.minimo is not None and isinstance(v, (int, float)) and float(v) < col.minimo:
                _registrar(errores, idx, col.nombre, v,
                           f"Debe ser mayor o igual que {col.minimo}")
            if col.maximo is not None and isinstance(v, (int, float)) and float(v) > col.maximo:
                _registrar(errores, idx, col.nombre, v,
                           f"Debe ser menor o igual que {col.maximo}")

    # --- Duplicados de clave dentro del propio archivo -----------------------
    claves = [c for c in plantilla.clave if c in datos.columns]
    if claves:
        dup = datos.duplicated(subset=claves, keep=False)
        for idx in datos.index[dup]:
            _registrar(errores, idx, "+".join(claves),
                       " / ".join(str(datos.at[idx, c]) for c in claves),
                       "Clave repetida dentro del archivo: cada combinacion debe ser unica")

    # --- Claves foraneas -----------------------------------------------------
    if db is not None and plantilla.referencias:
        for col_local, tabla_ref, col_ref in plantilla.referencias:
            if col_local not in datos.columns:
                continue
            try:
                existentes = set(
                    db.consultar_df(f"SELECT {col_ref} FROM {tabla_ref};")[col_ref].astype(str)
                )
            except (ErrorBaseDatos, KeyError):
                continue
            for idx, v in datos[col_local].items():
                if v is None or str(v) in existentes:
                    continue
                _registrar(errores, idx, col_local, v,
                           f"No existe en {tabla_ref}. Cargue primero esa tabla o "
                           "corrija el codigo")

    # --- Reglas de negocio ---------------------------------------------------
    regla = _REGLAS.get(tabla)
    if regla is not None:
        datos = regla(datos, errores)

    # Solo se conservan las columnas que la tabla admite.
    columnas_finales = [c for c in plantilla.nombres if c in datos.columns]
    datos = datos[columnas_finales]

    df_err = pd.DataFrame(errores) if errores else pd.DataFrame(
        columns=["fila_excel", "columna", "valor", "problema", "severidad"])
    if not df_err.empty:
        df_err = df_err.sort_values(["fila_excel", "columna"]).reset_index(drop=True)

    return ResultadoValidacion(tabla=tabla, datos=datos, errores=df_err,
                               filas_leidas=filas_leidas)


def cargar(
    resultado: ResultadoValidacion, db: DatabaseManager | None = None,
    modo: str = "INSERT OR REPLACE", solo_validas: bool = True,
) -> ResultadoCarga:
    """Aplica un lote validado a la base en una unica transaccion.

    Args:
        resultado: salida de `validar`.
        db: gestor de base de datos.
        modo: 'INSERT OR REPLACE' actualiza lo existente; 'INSERT OR IGNORE'
            conserva lo que ya hay; 'INSERT' falla ante cualquier duplicado.
        solo_validas: si es True carga las filas sin errores bloqueantes y
            descarta el resto; si es False exige que no haya ninguno.

    Returns:
        ResultadoCarga: recuento y estado de la operacion.
    """
    db = db or DatabaseManager()
    if resultado.datos.empty:
        return ResultadoCarga(tabla=resultado.tabla, exito=False,
                              mensaje="No hay filas que cargar")

    if not solo_validas and resultado.bloqueantes:
        return ResultadoCarga(
            tabla=resultado.tabla, exito=False, modo=modo,
            mensaje=f"{resultado.bloqueantes} errores bloqueantes. Corrija el archivo "
                    "o acepte cargar solo las filas validas.")

    indices = resultado.filas_validas if solo_validas else resultado.datos.index
    lote = resultado.datos.loc[indices]
    descartadas = len(resultado.datos) - len(lote)

    if lote.empty:
        return ResultadoCarga(tabla=resultado.tabla, exito=False, modo=modo,
                              filas_descartadas=descartadas,
                              mensaje="Ninguna fila supero la validacion")

    try:
        n = db.insertar_df(resultado.tabla, lote, modo=modo)
    except ErrorIntegridad as exc:
        # La base es la ultima linea de defensa: si algo llego hasta aqui, el
        # lote entero se revierte y se informa sin dejar carga parcial.
        return ResultadoCarga(
            tabla=resultado.tabla, exito=False, modo=modo,
            mensaje=f"La base rechazo el lote y se revirtio por completo: {exc}")
    except ErrorBaseDatos as exc:
        return ResultadoCarga(tabla=resultado.tabla, exito=False, modo=modo,
                              mensaje=f"Error de base de datos: {exc}")

    db.registrar_auditoria(
        "importador", "INFO", "CARGA_APLICADA",
        f"{resultado.tabla}: {n} filas ({modo}), {descartadas} descartadas")
    _log.info("Carga aplicada a %s: %d filas", resultado.tabla, n)
    return ResultadoCarga(tabla=resultado.tabla, filas_insertadas=n,
                          filas_descartadas=descartadas, modo=modo,
                          mensaje=f"{n} filas aplicadas a {resultado.tabla}")


def leer_libro(ruta: Path | Any) -> dict[str, pd.DataFrame]:
    """Lee un libro de Excel y devuelve solo las hojas que corresponden a tablas.

    Args:
        ruta: ruta del archivo o un objeto tipo archivo (el que entrega Streamlit).

    Returns:
        dict[str, pd.DataFrame]: nombre de tabla -> datos de su hoja.

    Raises:
        ValueError: si el libro no contiene ninguna hoja reconocible.
    """
    hojas = pd.read_excel(ruta, sheet_name=None, dtype=object)
    reconocidas: dict[str, pd.DataFrame] = {}
    for nombre, df in hojas.items():
        clave = str(nombre).strip().lower()
        if clave in PLANTILLAS:
            reconocidas[clave] = df
    if not reconocidas:
        raise ValueError(
            "El libro no contiene ninguna hoja reconocible. Las hojas deben "
            f"llamarse como las tablas: {', '.join(PLANTILLAS)}"
        )
    return reconocidas


# =============================================================================
# GENERACION DE PLANTILLAS Y EXPORTACION
# =============================================================================
_FORMATOS = {
    "cabecera": {"bold": True, "font_color": "#FFFFFF", "bg_color": "#16243A",
                 "border": 1, "border_color": "#22334D", "text_wrap": True,
                 "valign": "vcenter", "align": "center"},
    "derivada": {"bold": True, "font_color": "#0B1220", "bg_color": "#8CA0BC",
                 "border": 1, "text_wrap": True, "valign": "vcenter", "align": "center"},
    "ayuda": {"italic": True, "font_color": "#4A5A70", "text_wrap": True,
              "valign": "top", "font_size": 9},
    "ejemplo": {"bg_color": "#EAF4FC", "border": 1, "border_color": "#B8D8EE"},
    "titulo": {"bold": True, "font_size": 14, "font_color": "#16243A"},
    "parrafo": {"text_wrap": True, "valign": "top"},
}


def generar_plantillas(destino: Path | None = None) -> Path:
    """Genera el libro de plantillas de carga, con validaciones en las celdas.

    Cada tabla tiene su hoja, con tres filas de encabezado: el nombre de la
    columna, una linea de ayuda y una fila de ejemplo. Las columnas con dominio
    cerrado llevan lista desplegable y las numericas, validacion de rango, de
    modo que la mayor parte de los errores se evitan en el propio Excel en lugar
    de descubrirse al cargar.

    Las columnas DERIVADAS aparecen sombreadas y con la nota de que el sistema
    las calcula: asi el usuario sabe que no debe rellenarlas.

    Args:
        destino: ruta del .xlsx. Por defecto, `exports/`.

    Returns:
        Path: ruta del archivo generado.
    """
    destino = destino or (settings.EXPORTS_DIR / "SAPA_Plantillas_de_Carga.xlsx")
    destino.parent.mkdir(parents=True, exist_ok=True)

    with pd.ExcelWriter(destino, engine="xlsxwriter") as writer:
        libro = writer.book
        fmt = {k: libro.add_format(v) for k, v in _FORMATOS.items()}

        # --- Hoja de instrucciones ------------------------------------------
        hoja = libro.add_worksheet("INSTRUCCIONES")
        writer.sheets["INSTRUCCIONES"] = hoja
        hoja.set_column("A:A", 110)
        hoja.write(0, 0, "SAPA · Plantillas de carga de datos", fmt["titulo"])
        lineas = [
            "",
            "COMO USAR ESTE LIBRO",
            "1. Rellene una o varias hojas. No hace falta completarlas todas.",
            "2. No cambie el nombre de las hojas ni el de las columnas: el sistema las "
            "reconoce por ese nombre exacto.",
            "3. Cargue el libro desde la consola 'Carga de Datos' del aplicativo.",
            "4. El sistema valida TODO antes de escribir y muestra la fila de Excel de "
            "cada problema. Nada se guarda hasta que usted lo acepta.",
            "",
            "ORDEN DE CARGA",
            "Las tablas dependen unas de otras. Si carga todo a la vez el sistema "
            "respeta este orden automaticamente:",
            "   " + "  →  ".join(ORDEN_CARGA),
            "",
            "COLUMNAS SOMBREADAS EN GRIS",
            "Son DERIVADAS: el sistema las calcula y las ignora si usted las rellena. "
            "Por ejemplo, el segmento de Kraljic se deduce de los dos scores, y los "
            "parametros de la distribucion del plazo se deducen del plazo medio y su "
            "desviacion.",
            "",
            "LO QUE NO SE PIDE, Y POR QUE",
            "La demanda perdida NO es una columna de entrada. Ningun ERP la registra: "
            "nadie anota al cliente que no encontro el producto y se fue. Usted declara "
            "las horas sin stock y el sistema estima la demanda perdida, la guarda en "
            "columna aparte y deja constancia del metodo empleado.",
            "",
            "FORMATOS",
            "Fechas: AAAA-MM-DD (o celda con formato de fecha). Periodos: AAAA-MM.",
            "Numeros: sin separador de miles. Fracciones como 0,9 y no como 90%.",
            "Si / No: 1 y 0.",
            "",
            f"Generado por SAPA v{settings.APP_VERSION} el "
            f"{datetime.now():%Y-%m-%d %H:%M}",
        ]
        for i, texto in enumerate(lineas, start=2):
            hoja.write(i, 0, texto, fmt["parrafo"])

        # --- Una hoja por tabla ---------------------------------------------
        for nombre, plantilla in PLANTILLAS.items():
            hoja = libro.add_worksheet(nombre[:31])
            writer.sheets[nombre[:31]] = hoja
            hoja.freeze_panes(3, 0)

            for j, col in enumerate(plantilla.columnas):
                estilo = fmt["derivada"] if col.derivada else fmt["cabecera"]
                hoja.write(0, j, col.nombre, estilo)

                hoja.write(1, j, _pista(col), fmt["ayuda"])
                hoja.write(2, j, "" if col.derivada else col.ejemplo, fmt["ejemplo"])

                ancho = max(14, min(34, len(col.nombre) + 6))
                hoja.set_column(j, j, ancho)

                if col.derivada:
                    continue
                rango = f"{_col_excel(j)}4:{_col_excel(j)}5000"
                if col.dominio:
                    hoja.data_validation(rango, {
                        "validate": "list", "source": list(col.dominio),
                        "error_title": "Valor no admitido",
                        "error_message": "Use uno de los valores de la lista.",
                    })
                elif col.tipo in {"entero", "decimal"} and (
                        col.minimo is not None or col.maximo is not None):
                    hoja.data_validation(rango, {
                        "validate": "decimal",
                        "criteria": "between",
                        "minimum": col.minimo if col.minimo is not None else -1e15,
                        "maximum": col.maximo if col.maximo is not None else 1e15,
                        "error_title": "Fuera de rango",
                        "error_message": f"Debe estar entre {col.minimo} y {col.maximo}.",
                    })

            hoja.write(3, 0, "")  # primera fila de datos libre
            hoja.set_row(1, 34)

    _log.info("Plantillas generadas en %s", destino)
    return destino


_ETIQUETA_TIPO: dict[str, str] = {
    "texto": "Texto",
    "entero": "Numero entero",
    "decimal": "Numero decimal",
    "fecha": "Fecha AAAA-MM-DD",
    "periodo": "Periodo AAAA-MM",
    "booleano": "1 = si, 0 = no",
}


def _pista(col: Columna) -> str:
    """Construye la linea de ayuda de una columna en la plantilla.

    NINGUNA columna se queda sin pista. Una cabecera desnuda obliga a adivinar
    si el campo es obligatorio, que formato espera y que valores admite, y esa
    adivinanza es el origen de la mayoria de los errores de carga. El coste de
    escribirla es cero; el de omitirla lo paga el usuario fila por fila.

    Args:
        col: definicion de la columna.

    Returns:
        str: linea de ayuda, nunca vacia.
    """
    if col.derivada:
        base = "DERIVADA · la calcula el sistema, no la rellene"
        return f"{base} · {col.ayuda}" if col.ayuda else base

    partes = [
        "OBLIGATORIO" if col.obligatoria else "Opcional",
        _ETIQUETA_TIPO.get(col.tipo, col.tipo),
    ]
    if col.dominio:
        partes.append("Valores: " + ", ".join(col.dominio))
    elif col.minimo is not None or col.maximo is not None:
        bajo = "—" if col.minimo is None else f"{col.minimo:g}"
        alto = "—" if col.maximo is None else f"{col.maximo:g}"
        partes.append(f"Rango {bajo} a {alto}")
    if col.ayuda:
        partes.append(col.ayuda)
    return " · ".join(partes)


def _col_excel(indice: int) -> str:
    """Convierte un indice de columna en su letra de Excel (0 -> A)."""
    letras = ""
    n = indice
    while True:
        letras = chr(ord("A") + n % 26) + letras
        n = n // 26 - 1
        if n < 0:
            break
    return letras


def exportar_datos(
    destino: Path | None = None, db: DatabaseManager | None = None,
    limite_filas: int | None = None,
) -> Path:
    """Exporta el contenido actual de la base a un libro de Excel.

    Es el entregable de data de prueba: permite a un tercero reproducir el mismo
    proceso con exactamente los mismos datos. Cada tabla va en su hoja, con los
    mismos nombres que las plantillas de carga, de modo que el libro exportado
    puede volver a importarse sin tocar nada.

    Args:
        destino: ruta del .xlsx. Por defecto, `exports/`.
        db: gestor de base de datos.
        limite_filas: tope por hoja. Excel admite 1 048 576 filas; las tablas de
            hechos de este sistema rondan las 55 000 y caben holgadamente, pero
            el tope existe para datasets mayores.

    Returns:
        Path: ruta del archivo generado.
    """
    db = db or DatabaseManager()
    destino = destino or (settings.EXPORTS_DIR / "SAPA_Data_de_Prueba.xlsx")
    destino.parent.mkdir(parents=True, exist_ok=True)

    resumen: list[dict] = []
    with pd.ExcelWriter(destino, engine="xlsxwriter") as writer:
        libro = writer.book
        fmt = {k: libro.add_format(v) for k, v in _FORMATOS.items()}

        hoja = libro.add_worksheet("RESUMEN")
        writer.sheets["RESUMEN"] = hoja
        hoja.set_column("A:A", 32)
        hoja.set_column("B:C", 18)
        hoja.write(0, 0, "SAPA · Data de prueba exportada", fmt["titulo"])

        for i, tabla in enumerate(ORDEN_CARGA):
            try:
                sql = f"SELECT * FROM {tabla}"
                if limite_filas:
                    sql += f" LIMIT {int(limite_filas)}"
                df = db.consultar_df(sql + ";")
            except ErrorBaseDatos:
                continue
            df.to_excel(writer, sheet_name=tabla[:31], index=False)
            ws = writer.sheets[tabla[:31]]
            ws.freeze_panes(1, 0)
            for j, c in enumerate(df.columns):
                ws.write(0, j, str(c), fmt["cabecera"])
                ws.set_column(j, j, max(13, min(30, len(str(c)) + 4)))
            resumen.append({"tabla": tabla, "filas": len(df), "columnas": len(df.columns)})

        hoja.write(2, 0, "Tabla", fmt["cabecera"])
        hoja.write(2, 1, "Filas", fmt["cabecera"])
        hoja.write(2, 2, "Columnas", fmt["cabecera"])
        for i, r in enumerate(resumen, start=3):
            hoja.write(i, 0, r["tabla"])
            hoja.write_number(i, 1, r["filas"])
            hoja.write_number(i, 2, r["columnas"])

        fila = len(resumen) + 5
        semilla = db.consultar_escalar(
            "SELECT valor FROM parametros_sistema WHERE clave = 'semilla';") or "—"
        for texto in (
            f"Generado por SAPA v{settings.APP_VERSION} el {datetime.now():%Y-%m-%d %H:%M}",
            f"Semilla del generador: {semilla}",
            "Las hojas conservan los nombres de las tablas, de modo que este libro "
            "puede volver a importarse tal cual desde la consola de carga.",
            "Los datos son simulados y estan identificados como tales.",
        ):
            hoja.write(fila, 0, texto, fmt["parrafo"])
            fila += 1

    _log.info("Data exportada a %s", destino)
    return destino
