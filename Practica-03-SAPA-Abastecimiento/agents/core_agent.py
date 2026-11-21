"""Arquitectura base del Super Agente IA del SAPA.

Modelo de coordinacion: un `SuperAgenteCoordinador` determinista que orquesta
`AgenteEspecialista` intercambiables. La secuencia critica y las puertas de
aprobacion NO son negociables por el agente: estan fijadas en el flujo. Esto es
una decision de diseno, no una limitacion:

*   Un LLM puede elegir QUE herramienta invocar. No debe decidir SI una orden
    requiere aprobacion, ni alterar un balance material.
*   El orden Descriptivo -> Diagnostico -> Predictivo -> Prescriptivo es una
    dependencia de informacion, no una preferencia estetica: no se puede
    prescribir sobre una demanda que no se ha pronosticado, ni pronosticar
    sobre una historia que no se ha conciliado.
*   Ante discrepancia entre especialistas, el coordinador abre una EXCEPCION.
    No promedia resultados ni "vota" entre modelos: promediar dos respuestas
    incompatibles produce una tercera que no es defendible ante nadie.

Contrato de ejecucion: cada especialista recibe un `ContextoEjecucion` inmutable
y devuelve un `ResultadoAgente` con estado, metricas, excepciones y evidencia.
Una excepcion BLOQUEANTE detiene la rama afectada sin invalidar los resultados
correctos de los demas articulos.
"""

from __future__ import annotations

import json
import time
import traceback
import uuid
from abc import ABC, abstractmethod
from collections.abc import Sequence
from dataclasses import asdict, dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any

import pandas as pd

from config import settings
from db.db_manager import DatabaseManager, ErrorBaseDatos
from utils.logger import obtener_logger

_log = obtener_logger("core_agent")


# =============================================================================
# ENUMERACIONES DEL DOMINIO
# =============================================================================
class TipoAnalisis(str, Enum):
    """Los cuatro analiticos exigidos, mas el rol de control."""

    DESCRIPTIVO = "DESCRIPTIVO"
    DIAGNOSTICO = "DIAGNOSTICO"
    PREDICTIVO = "PREDICTIVO"
    PRESCRIPTIVO = "PRESCRIPTIVO"
    CONTROL = "CONTROL"


class EstadoAgente(str, Enum):
    """Estados terminales de la ejecucion de un especialista."""

    PENDIENTE = "PENDIENTE"
    EN_EJECUCION = "EN_EJECUCION"
    CALCULADO = "CALCULADO"
    OBSERVADO = "OBSERVADO"   # concluyo con excepciones no bloqueantes
    BLOQUEADO = "BLOQUEADO"   # precondiciones no satisfechas
    FALLIDO = "FALLIDO"       # error tecnico no controlado
    OMITIDO = "OMITIDO"       # dependencia previa no disponible


class Severidad(str, Enum):
    """Gravedad de una excepcion de plan."""

    BLOQUEANTE = "BLOQUEANTE"
    ALTA = "ALTA"
    MEDIA = "MEDIA"
    INFORMATIVA = "INFORMATIVA"


# Orden canonico del pipeline analitico. Se usa para ordenar la ejecucion y
# para validar que las dependencias declaradas no violen la causalidad.
ORDEN_ANALITICO: tuple[TipoAnalisis, ...] = (
    TipoAnalisis.DESCRIPTIVO,
    TipoAnalisis.DIAGNOSTICO,
    TipoAnalisis.PREDICTIVO,
    TipoAnalisis.PRESCRIPTIVO,
    TipoAnalisis.CONTROL,
)


# =============================================================================
# ESTRUCTURAS DE TRANSFERENCIA
# =============================================================================
@dataclass(frozen=True)
class ContextoEjecucion:
    """Parametros inmutables de una corrida del superagente.

    Attributes:
        id_corrida: identificador unico. Toda fila producida queda ligada a el;
            sin esto no hay reproducibilidad ni auditoria posible.
        fecha_corte: ultimo dia con informacion completa. El mes parcial NUNCA
            se trata como mes cerrado.
        horizonte_meses: meses a planificar hacia adelante.
        escenarios: escenarios a simular. 'BASE' siempre presente.
        skus: subconjunto de SKU a procesar; None = todos los activos.
        usuario: responsable de la corrida.
        parametros: overrides puntuales de politica para esta corrida.
    """

    id_corrida: str
    fecha_corte: str
    horizonte_meses: int = settings.INVENTARIO.horizonte_meses
    escenarios: tuple[str, ...] = ("BASE",)
    skus: tuple[str, ...] | None = None
    centro: str = settings.SIMULACION.centro_default
    usuario: str = "director_proyecto"
    parametros: dict[str, Any] = field(default_factory=dict)

    def resumen(self) -> str:
        """Devuelve una linea legible para el log y el dashboard."""
        n = "todos" if self.skus is None else str(len(self.skus))
        return (
            f"corrida={self.id_corrida} corte={self.fecha_corte} "
            f"H={self.horizonte_meses}m escenarios={list(self.escenarios)} skus={n}"
        )


@dataclass
class ExcepcionPlan:
    """Hallazgo que impide o condiciona el avance del plan.

    Attributes:
        codigo: identificador estable del tipo de hallazgo, p.ej. 'DAT-001'.
        severidad: BLOQUEANTE detiene la rama; el resto solo informa.
        accion_sugerida: que debe hacerse, expresado como accion, no como queja.
        responsable: rol que debe resolverlo.
    """

    codigo: str
    severidad: Severidad
    descripcion: str
    sku: str | None = None
    accion_sugerida: str | None = None
    responsable: str | None = None


@dataclass
class ResultadoAgente:
    """Entrega de un especialista al coordinador.

    Attributes:
        datos: tablas producidas, indexadas por nombre logico.
        metricas: escalares publicables en el dashboard.
        evidencia: origen de cada cifra (tabla, filtro, formula, version).
    """

    agente: str
    tipo_analisis: TipoAnalisis
    estado: EstadoAgente
    id_corrida: str
    datos: dict[str, pd.DataFrame] = field(default_factory=dict)
    metricas: dict[str, float] = field(default_factory=dict)
    excepciones: list[ExcepcionPlan] = field(default_factory=list)
    evidencia: dict[str, Any] = field(default_factory=dict)
    duracion_seg: float = 0.0
    mensaje: str = ""
    ts: str = field(default_factory=lambda: datetime.now().isoformat(timespec="seconds"))

    @property
    def tiene_bloqueantes(self) -> bool:
        """True si alguna excepcion impide continuar la rama."""
        return any(e.severidad is Severidad.BLOQUEANTE for e in self.excepciones)

    def resumen(self) -> str:
        """Linea compacta para log y panel de control."""
        return (
            f"[{self.agente}] {self.estado.value} en {self.duracion_seg:.2f}s | "
            f"metricas={len(self.metricas)} excepciones={len(self.excepciones)}"
        )


# =============================================================================
# CLASE ABSTRACTA DE ESPECIALISTA
# =============================================================================
class AgenteEspecialista(ABC):
    """Contrato que todo agente analitico debe cumplir.

    Implementa el patron Template Method: `ejecutar()` es concreto y fija el
    protocolo invariante (validar -> ejecutar -> medir -> capturar), mientras
    que `_procesar()` es el unico punto que cada especialista redefine. De este
    modo ningun agente puede "olvidarse" de validar precondiciones ni de dejar
    trazabilidad, que es exactamente lo que se audita en la practica.

    Attributes:
        nombre: identificador corto del agente.
        tipo_analisis: a cual de los cuatro analiticos pertenece.
        dependencias: nombres de agentes que deben haber concluido antes.
    """

    nombre: str = "agente_base"
    tipo_analisis: TipoAnalisis = TipoAnalisis.CONTROL
    dependencias: tuple[str, ...] = ()

    def __init__(self, db: DatabaseManager | None = None) -> None:
        """Inicializa el especialista.

        Args:
            db: gestor de base de datos. Por defecto el Singleton del sistema.
        """
        self.db = db or DatabaseManager()
        self._log = obtener_logger(f"agente.{self.nombre}")

    # -- Template method ------------------------------------------------------
    def ejecutar(
        self, contexto: ContextoEjecucion, previos: dict[str, ResultadoAgente]
    ) -> ResultadoAgente:
        """Ejecuta el especialista bajo el protocolo invariante.

        Args:
            contexto: parametros de la corrida.
            previos: resultados de los agentes ya ejecutados, por nombre.

        Returns:
            ResultadoAgente: nunca lanza; todo fallo se devuelve como estado
            FALLIDO con su traza. Un especialista caido no debe tumbar la
            corrida completa ni dejar al usuario sin diagnostico.
        """
        t0 = time.perf_counter()
        resultado = ResultadoAgente(
            agente=self.nombre,
            tipo_analisis=self.tipo_analisis,
            estado=EstadoAgente.EN_EJECUCION,
            id_corrida=contexto.id_corrida,
        )
        try:
            faltantes = [d for d in self.dependencias if d not in previos]
            if faltantes:
                resultado.estado = EstadoAgente.OMITIDO
                resultado.mensaje = f"Dependencias no disponibles: {faltantes}"
                return resultado

            excepciones_pre = self.validar_precondiciones(contexto)
            resultado.excepciones.extend(excepciones_pre)
            if any(e.severidad is Severidad.BLOQUEANTE for e in excepciones_pre):
                resultado.estado = EstadoAgente.BLOQUEADO
                resultado.mensaje = "Precondiciones de datos no satisfechas"
                return resultado

            parcial = self._procesar(contexto, previos)
            resultado.datos = parcial.datos
            resultado.metricas = parcial.metricas
            resultado.evidencia = parcial.evidencia
            resultado.excepciones.extend(parcial.excepciones)
            resultado.mensaje = parcial.mensaje
            resultado.estado = (
                EstadoAgente.OBSERVADO if resultado.excepciones else EstadoAgente.CALCULADO
            )
        except Exception as exc:  # noqa: BLE001 - frontera de aislamiento
            resultado.estado = EstadoAgente.FALLIDO
            resultado.mensaje = f"{type(exc).__name__}: {exc}"
            resultado.evidencia["traceback"] = traceback.format_exc(limit=8)
            self._log.exception("Fallo no controlado en %s", self.nombre)
        finally:
            resultado.duracion_seg = round(time.perf_counter() - t0, 4)
            self._log.info(resultado.resumen())
        return resultado

    # -- Puntos de extension --------------------------------------------------
    @abstractmethod
    def _procesar(
        self, contexto: ContextoEjecucion, previos: dict[str, ResultadoAgente]
    ) -> ResultadoAgente:
        """Logica propia del especialista.

        Args:
            contexto: parametros de la corrida.
            previos: resultados de agentes precedentes.

        Returns:
            ResultadoAgente: con `datos`, `metricas`, `evidencia` y excepciones.
            El estado lo fija `ejecutar()`; aqui no debe establecerse.
        """
        raise NotImplementedError

    def validar_precondiciones(self, contexto: ContextoEjecucion) -> list[ExcepcionPlan]:
        """Comprueba que los insumos minimos existan antes de calcular.

        Implementacion por defecto: verifica que haya maestro e historia. Los
        especialistas la extienden con sus propias puertas de datos.

        Args:
            contexto: parametros de la corrida.

        Returns:
            list[ExcepcionPlan]: hallazgos; vacia si todo esta en orden.
        """
        hallazgos: list[ExcepcionPlan] = []
        try:
            n_mat = int(self.db.consultar_escalar(
                "SELECT COUNT(*) FROM maestro_materiales WHERE activo = 1;") or 0)
            n_dem = int(self.db.consultar_escalar(
                "SELECT COUNT(*) FROM historico_demanda WHERE fecha <= ?;",
                (contexto.fecha_corte,)) or 0)
            if n_mat == 0:
                hallazgos.append(ExcepcionPlan(
                    codigo="DAT-001", severidad=Severidad.BLOQUEANTE,
                    descripcion="Maestro de materiales vacio",
                    accion_sugerida="Cargar el maestro desde Excel o generar el dataset",
                    responsable="Datos maestros"))
            if n_dem == 0:
                hallazgos.append(ExcepcionPlan(
                    codigo="DAT-002", severidad=Severidad.BLOQUEANTE,
                    descripcion="No hay historia de demanda anterior a la fecha de corte",
                    accion_sugerida="Verificar la fecha de corte o cargar el historico",
                    responsable="Planificacion"))
        except ErrorBaseDatos as exc:
            hallazgos.append(ExcepcionPlan(
                codigo="DAT-000", severidad=Severidad.BLOQUEANTE,
                descripcion=f"Base de datos inaccesible: {exc}",
                accion_sugerida="Revisar la ruta e integridad del archivo .db",
                responsable="Sistemas"))
        return hallazgos

    # -- Utilidad compartida --------------------------------------------------
    def _nuevo_resultado(self, contexto: ContextoEjecucion) -> ResultadoAgente:
        """Crea un contenedor de resultado prellenado para uso en `_procesar`."""
        return ResultadoAgente(
            agente=self.nombre,
            tipo_analisis=self.tipo_analisis,
            estado=EstadoAgente.EN_EJECUCION,
            id_corrida=contexto.id_corrida,
        )


# =============================================================================
# SUPER AGENTE COORDINADOR
# =============================================================================
class SuperAgenteCoordinador:
    """Orquestador determinista del sistema multi-agente.

    Responsabilidades:
        1. Registrar especialistas y validar la coherencia del grafo de
           dependencias (sin ciclos, sin violar el orden analitico).
        2. Abrir la corrida en `ejecuciones` y cerrarla con su estado final.
        3. Ejecutar los agentes en orden, propagando resultados previos.
        4. Aplicar puertas de calidad: una excepcion BLOQUEANTE detiene la
           cadena aguas abajo pero conserva lo ya calculado.
        5. Persistir metricas y excepciones para el dashboard en tiempo real.

    Attributes:
        db: gestor de base de datos.
        agentes: especialistas registrados, indexados por nombre.
    """

    def __init__(self, db: DatabaseManager | None = None) -> None:
        """Inicializa el coordinador.

        Args:
            db: gestor de base de datos; por defecto el Singleton del sistema.
        """
        self.db = db or DatabaseManager()
        self.agentes: dict[str, AgenteEspecialista] = {}
        self.resultados: dict[str, ResultadoAgente] = {}
        self._log = obtener_logger("superagente")

    # -------------------------------------------------------------------------
    # REGISTRO
    # -------------------------------------------------------------------------
    def registrar(self, agente: AgenteEspecialista) -> SuperAgenteCoordinador:
        """Registra un especialista. Encadenable.

        Args:
            agente: instancia de `AgenteEspecialista`.

        Returns:
            SuperAgenteCoordinador: self, para encadenar registros.

        Raises:
            ValueError: si el nombre ya esta registrado.
        """
        if agente.nombre in self.agentes:
            raise ValueError(f"Agente duplicado: '{agente.nombre}'")
        self.agentes[agente.nombre] = agente
        self._log.info(
            "Registrado '%s' (%s), dependencias=%s",
            agente.nombre, agente.tipo_analisis.value, list(agente.dependencias),
        )
        return self

    def registrar_varios(self, agentes: Sequence[AgenteEspecialista]) -> SuperAgenteCoordinador:
        """Registra una secuencia de especialistas."""
        for a in agentes:
            self.registrar(a)
        return self

    def _orden_ejecucion(self) -> list[str]:
        """Resuelve el orden topologico de ejecucion.

        Ordena primero por la fase analitica canonica y despues por dependencias
        declaradas (Kahn). Un ciclo es un error de diseno y se reporta como tal.

        Returns:
            list[str]: nombres de agentes en orden de ejecucion.

        Raises:
            ValueError: si el grafo tiene ciclos o dependencias inexistentes.
        """
        for nombre, ag in self.agentes.items():
            for dep in ag.dependencias:
                if dep not in self.agentes:
                    raise ValueError(f"'{nombre}' depende de '{dep}', que no esta registrado")

        pendientes = {
            n: set(a.dependencias) for n, a in self.agentes.items()
        }
        prioridad = {n: ORDEN_ANALITICO.index(a.tipo_analisis) for n, a in self.agentes.items()}
        orden: list[str] = []

        while pendientes:
            disponibles = sorted(
                [n for n, deps in pendientes.items() if not deps],
                key=lambda n: (prioridad[n], n),
            )
            if not disponibles:
                raise ValueError(f"Ciclo de dependencias entre agentes: {sorted(pendientes)}")
            elegido = disponibles[0]
            orden.append(elegido)
            pendientes.pop(elegido)
            for deps in pendientes.values():
                deps.discard(elegido)
        return orden

    # -------------------------------------------------------------------------
    # EJECUCION
    # -------------------------------------------------------------------------
    @staticmethod
    def nueva_corrida(prefijo: str = "RUN") -> str:
        """Genera un identificador de corrida legible y unico.

        Returns:
            str: por ejemplo 'RUN-20260921-3f9a1c'.
        """
        return f"{prefijo}-{datetime.now():%Y%m%d}-{uuid.uuid4().hex[:6]}"

    def ejecutar_pipeline(self, contexto: ContextoEjecucion) -> dict[str, ResultadoAgente]:
        """Ejecuta todos los especialistas registrados en orden.

        Args:
            contexto: parametros de la corrida.

        Returns:
            dict[str, ResultadoAgente]: resultados por nombre de agente.
        """
        self.resultados = {}
        t0 = time.perf_counter()
        self._abrir_corrida(contexto)
        self._log.info("Pipeline iniciado | %s", contexto.resumen())

        try:
            orden = self._orden_ejecucion()
        except ValueError as exc:
            self._cerrar_corrida(contexto, "FALLIDA", str(exc), time.perf_counter() - t0)
            raise

        bloqueados: set[str] = set()
        for nombre in orden:
            agente = self.agentes[nombre]

            # Puerta de calidad: si una dependencia quedo bloqueada o fallida,
            # este agente se omite. No se calcula sobre insumos invalidos.
            if any(d in bloqueados for d in agente.dependencias):
                res = ResultadoAgente(
                    agente=nombre, tipo_analisis=agente.tipo_analisis,
                    estado=EstadoAgente.OMITIDO, id_corrida=contexto.id_corrida,
                    mensaje="Omitido: una dependencia quedo bloqueada o fallida",
                )
                self.resultados[nombre] = res
                bloqueados.add(nombre)
                self._log.warning(res.resumen())
                continue

            res = agente.ejecutar(contexto, dict(self.resultados))
            self.resultados[nombre] = res
            self._persistir_resultado(contexto, res)

            if res.estado in {EstadoAgente.BLOQUEADO, EstadoAgente.FALLIDO} or res.tiene_bloqueantes:
                bloqueados.add(nombre)

        duracion = time.perf_counter() - t0
        estado_final = self._estado_global()
        self._cerrar_corrida(contexto, estado_final, None, duracion)
        self._log.info(
            "Pipeline finalizado en %.2fs con estado %s", duracion, estado_final
        )
        return self.resultados

    def _estado_global(self) -> str:
        """Determina el estado final de la corrida a partir de los resultados."""
        estados = {r.estado for r in self.resultados.values()}
        if EstadoAgente.FALLIDO in estados:
            return "FALLIDA"
        if {EstadoAgente.BLOQUEADO, EstadoAgente.OMITIDO} & estados:
            return "PENDIENTE_DATOS"
        if EstadoAgente.OBSERVADO in estados:
            return "OBSERVADA"
        return "CALCULADA"

    # -------------------------------------------------------------------------
    # PERSISTENCIA
    # -------------------------------------------------------------------------
    def _abrir_corrida(self, contexto: ContextoEjecucion) -> None:
        """Registra la corrida en `ejecuciones` con estado INICIADA."""
        try:
            self.db.ejecutar(
                "INSERT OR REPLACE INTO ejecuciones "
                "(id_corrida, fecha_corte, horizonte_meses, escenarios, usuario, "
                " version_app, estado, ts_inicio) "
                "VALUES (?, ?, ?, ?, ?, ?, 'INICIADA', datetime('now'));",
                (
                    contexto.id_corrida, contexto.fecha_corte, contexto.horizonte_meses,
                    json.dumps(list(contexto.escenarios)), contexto.usuario,
                    settings.APP_VERSION,
                ),
            )
            self.db.registrar_auditoria(
                "superagente", "INFO", "CORRIDA_INICIADA",
                contexto.resumen(), contexto.id_corrida,
            )
        except ErrorBaseDatos:
            self._log.exception("No se pudo abrir la corrida")
            raise

    def _cerrar_corrida(
        self, contexto: ContextoEjecucion, estado: str,
        observaciones: str | None, duracion: float,
    ) -> None:
        """Cierra la corrida con su estado final y duracion."""
        try:
            self.db.ejecutar(
                "UPDATE ejecuciones SET estado = ?, ts_fin = datetime('now'), "
                "duracion_seg = ?, observaciones = ? WHERE id_corrida = ?;",
                (estado, round(duracion, 3), observaciones, contexto.id_corrida),
            )
        except ErrorBaseDatos:
            self._log.exception("No se pudo cerrar la corrida %s", contexto.id_corrida)

    def _persistir_resultado(
        self, contexto: ContextoEjecucion, res: ResultadoAgente
    ) -> None:
        """Vuelca metricas y excepciones de un agente a la base.

        Las tablas `resultados_analisis` y `excepciones_plan` son la fuente del
        dashboard: al escribirse aqui, cualquier metrica calculada por cualquier
        agente queda disponible para consulta en tiempo real sin acoplar la UI
        a la estructura interna de cada especialista.
        """
        try:
            if res.metricas:
                self.db.ejecutar_masivo(
                    "INSERT INTO resultados_analisis "
                    "(id_corrida, agente, tipo_analisis, escenario, metrica, valor, evidencia_json) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?);",
                    [
                        (
                            contexto.id_corrida, res.agente, res.tipo_analisis.value,
                            contexto.escenarios[0], k, float(v),
                            json.dumps(res.evidencia, ensure_ascii=False, default=str)[:4000],
                        )
                        for k, v in res.metricas.items()
                    ],
                )
            if res.excepciones:
                self.db.ejecutar_masivo(
                    "INSERT INTO excepciones_plan "
                    "(id_corrida, agente, severidad, codigo, sku, descripcion, "
                    " accion_sugerida, responsable) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?);",
                    [
                        (
                            contexto.id_corrida, res.agente, e.severidad.value, e.codigo,
                            e.sku, e.descripcion, e.accion_sugerida, e.responsable,
                        )
                        for e in res.excepciones
                    ],
                )
            self.db.registrar_auditoria(
                "superagente", "INFO", f"AGENTE_{res.estado.value}",
                res.resumen(), contexto.id_corrida,
            )
        except ErrorBaseDatos:
            self._log.exception("No se pudieron persistir los resultados de %s", res.agente)

    # -------------------------------------------------------------------------
    # CONSULTA PARA LA CAPA DE PRESENTACION
    # -------------------------------------------------------------------------
    def tablero(self, id_corrida: str) -> pd.DataFrame:
        """Devuelve las metricas de una corrida, listas para el dashboard.

        Args:
            id_corrida: identificador de la corrida.

        Returns:
            pd.DataFrame: metricas con su agente, tipo de analisis y escenario.
        """
        return self.db.consultar_df(
            "SELECT agente, tipo_analisis, escenario, metrica, valor, ts_registro "
            "FROM resultados_analisis WHERE id_corrida = ? ORDER BY tipo_analisis, metrica;",
            (id_corrida,),
        )

    def excepciones(self, id_corrida: str) -> pd.DataFrame:
        """Devuelve las excepciones abiertas de una corrida, por severidad."""
        return self.db.consultar_df(
            "SELECT severidad, codigo, sku, descripcion, accion_sugerida, responsable "
            "FROM excepciones_plan WHERE id_corrida = ? "
            "ORDER BY CASE severidad WHEN 'BLOQUEANTE' THEN 1 WHEN 'ALTA' THEN 2 "
            "WHEN 'MEDIA' THEN 3 ELSE 4 END;",
            (id_corrida,),
        )

    def estado_registro(self) -> pd.DataFrame:
        """Inventario de agentes registrados y su orden de ejecucion previsto."""
        try:
            orden = self._orden_ejecucion()
        except ValueError:
            orden = list(self.agentes)
        return pd.DataFrame(
            [
                {
                    "orden": i + 1,
                    "agente": n,
                    "tipo_analisis": self.agentes[n].tipo_analisis.value,
                    "dependencias": ", ".join(self.agentes[n].dependencias) or "-",
                }
                for i, n in enumerate(orden)
            ]
        )


# =============================================================================
# ESPECIALISTA DE REFERENCIA (Fase 1)
# =============================================================================
class AgenteControlDatos(AgenteEspecialista):
    """Puerta de datos del sistema: valida el dataset antes de todo calculo.

    Es el unico especialista implementado en la Fase 1 y cumple dos funciones:
    (1) demostrar que el contrato `AgenteEspecialista` es operativo de extremo a
    extremo, y (2) actuar como puerta real: en la Fase 2, Demanda, Diagnostico,
    Prediccion y Prescripcion declararan dependencia de este agente, de modo que
    ningun pronostico se calcule sobre datos inconsistentes.

    Controles aplicados:
        CTL-001  Cobertura de historia suficiente para estacionalidad anual.
        CTL-002  Inventario con saldos negativos o sin fecha de corte.
        CTL-003  Ordenes con cadena de fechas incoherente.
        CTL-004  SKU sin proveedor homologado.
        CTL-005  Proporcion de dias censurados por SKU (riesgo de sesgo).
    """

    nombre = "control_datos"
    tipo_analisis = TipoAnalisis.CONTROL
    dependencias: tuple[str, ...] = ()

    def _procesar(
        self, contexto: ContextoEjecucion, previos: dict[str, ResultadoAgente]
    ) -> ResultadoAgente:
        """Ejecuta los controles de calidad del dataset."""
        res = self._nuevo_resultado(contexto)
        corte = contexto.fecha_corte

        # --- CTL-001: profundidad de historia ---
        meses = int(self.db.consultar_escalar(
            "SELECT COUNT(DISTINCT substr(fecha,1,7)) FROM historico_demanda WHERE fecha <= ?;",
            (corte,)) or 0)
        res.metricas["meses_historia"] = float(meses)
        if meses < 24:
            res.excepciones.append(ExcepcionPlan(
                codigo="CTL-001", severidad=Severidad.ALTA,
                descripcion=f"Solo {meses} meses de historia; la estacionalidad anual "
                            "no es verificable con menos de 24",
                accion_sugerida="Usar familias y analogos, y ampliar los intervalos",
                responsable="Planificacion"))

        # --- CTL-002: integridad del inventario ---
        negativos = int(self.db.consultar_escalar(
            "SELECT COUNT(*) FROM inventario_diario WHERE stock_final < 0 OR stock_inicial < 0;"
        ) or 0)
        res.metricas["registros_inventario_negativo"] = float(negativos)
        if negativos:
            res.excepciones.append(ExcepcionPlan(
                codigo="CTL-002", severidad=Severidad.BLOQUEANTE,
                descripcion=f"{negativos} registros de inventario con saldo negativo",
                accion_sugerida="Conciliar movimientos contra conteo fisico",
                responsable="Almacen"))

        # --- CTL-003: coherencia de la cadena de fechas de compra ---
        incoherentes = int(self.db.consultar_escalar(
            "SELECT COUNT(*) FROM ordenes_compra "
            "WHERE (fecha_emision IS NOT NULL AND fecha_emision < fecha_solicitud) "
            "   OR (fecha_real_recepcion IS NOT NULL AND fecha_emision IS NOT NULL "
            "       AND fecha_real_recepcion < fecha_emision);"
        ) or 0)
        res.metricas["ordenes_fechas_incoherentes"] = float(incoherentes)
        if incoherentes:
            res.excepciones.append(ExcepcionPlan(
                codigo="CTL-003", severidad=Severidad.BLOQUEANTE,
                descripcion=f"{incoherentes} ordenes con cadena de fechas imposible",
                accion_sugerida="Revisar la extraccion del ERP antes de medir lead time",
                responsable="Compras"))

        # --- CTL-004: cobertura de proveedor homologado ---
        sin_prov = self.db.consultar_df(
            "SELECT m.sku FROM maestro_materiales m "
            "LEFT JOIN sku_proveedor sp ON sp.sku = m.sku AND sp.homologado = 1 "
            "WHERE m.activo = 1 AND sp.sku IS NULL;"
        )
        res.metricas["skus_sin_proveedor_homologado"] = float(len(sin_prov))
        for sku in sin_prov.get("sku", pd.Series(dtype=str)):
            res.excepciones.append(ExcepcionPlan(
                codigo="CTL-004", severidad=Severidad.BLOQUEANTE, sku=str(sku),
                descripcion="SKU activo sin proveedor homologado",
                accion_sugerida="Homologar proveedor o desactivar el SKU",
                responsable="Compras"))

        # --- CTL-005: intensidad de censura ---
        censura = self.db.consultar_df(
            "SELECT sku, "
            "       1.0*SUM(flag_censura)/COUNT(*) AS tasa_censura "
            "FROM historico_demanda WHERE fecha <= ? GROUP BY sku;",
            (corte,),
        )
        if not censura.empty:
            tasa_media = float(censura["tasa_censura"].mean())
            criticos = censura[censura["tasa_censura"] > 0.25]
            res.metricas["tasa_censura_media"] = round(tasa_media, 4)
            res.metricas["skus_censura_critica"] = float(len(criticos))
            for _, r in criticos.iterrows():
                res.excepciones.append(ExcepcionPlan(
                    codigo="CTL-005", severidad=Severidad.MEDIA, sku=str(r["sku"]),
                    descripcion=f"{r['tasa_censura']:.1%} de los dias con quiebre: la venta "
                                "observada subestima la demanda real",
                    accion_sugerida="Entrenar sobre demanda corregida, no sobre venta observada",
                    responsable="Planificacion"))

        # --- Conteos generales para el tablero ---
        res.metricas["skus_activos"] = float(self.db.consultar_escalar(
            "SELECT COUNT(*) FROM maestro_materiales WHERE activo = 1;") or 0)
        res.metricas["ordenes_registradas"] = float(self.db.consultar_escalar(
            "SELECT COUNT(*) FROM ordenes_compra;") or 0)

        res.evidencia = {
            "fecha_corte": corte,
            "controles": ["CTL-001", "CTL-002", "CTL-003", "CTL-004", "CTL-005"],
            "fuente": "historico_demanda, inventario_diario, ordenes_compra, sku_proveedor",
            "version_app": settings.APP_VERSION,
        }
        res.mensaje = f"{len(res.excepciones)} hallazgos sobre {int(res.metricas['skus_activos'])} SKU"
        return res
