"""Capa de acceso a datos (DAL) del SAPA sobre SQLite.

Patron Singleton con estado por hilo. La combinacion es deliberada y responde a
dos hechos incompatibles entre si si se ignoran:

*   La aplicacion necesita UN solo punto de verdad sobre la ruta de la base, los
    PRAGMAs aplicados y el estado del esquema -> Singleton.
*   Un objeto `sqlite3.Connection` NO es compartible entre hilos. Streamlit
    reejecuta el script en un hilo distinto por cada interaccion del usuario, y
    el coordinador de agentes puede paralelizar especialistas. Un Singleton que
    guarde una unica conexion revienta con
    `ProgrammingError: SQLite objects created in a thread can only be used in
    that same thread`.

Solucion implementada: el Singleton guarda la CONFIGURACION; las conexiones
viven en `threading.local()`, una por hilo, cada una con sus PRAGMAs. WAL
permite N lectores concurrentes con 1 escritor sin bloqueo de lectura, y un
`RLock` de proceso serializa las escrituras para que `busy_timeout` no se agote
por contencion interna (SQLite admite un unico escritor, sea cual sea el modo).

Typical usage:
    db = DatabaseManager()
    db.inicializar_esquema()
    with db.transaccion() as cur:
        cur.execute("INSERT INTO ...", params)
    df = db.consultar_df("SELECT * FROM maestro_materiales WHERE clase_abc = ?", ("A",))
"""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterable, Iterator, Sequence
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd

from config import settings
from db.schema_ddl import SCHEMA_DDL, TABLAS_NUCLEO
from utils.logger import obtener_logger

_log = obtener_logger("db_manager")


# =============================================================================
# EXCEPCIONES DE DOMINIO
# =============================================================================
class ErrorBaseDatos(Exception):
    """Error generico de la capa de datos del SAPA."""


class ErrorEsquema(ErrorBaseDatos):
    """El esquema no existe, esta incompleto o su version no corresponde."""


class ErrorIntegridad(ErrorBaseDatos):
    """Violacion de una restriccion declarativa (CHECK, FK, UNIQUE, NOT NULL)."""


# =============================================================================
# METACLASE SINGLETON THREAD-SAFE
# =============================================================================
class _SingletonMeta(type):
    """Metaclase Singleton con bloqueo y doble verificacion.

    Sin el bloqueo, dos hilos que instancian simultaneamente crean dos objetos y
    el invariante del patron se rompe silenciosamente (bug clasico y dificil de
    reproducir). La doble verificacion evita pagar el lock en cada acceso.
    """

    _instancias: dict[type, Any] = {}
    _lock: threading.Lock = threading.Lock()

    def __call__(cls, *args: Any, **kwargs: Any) -> Any:
        if cls not in cls._instancias:
            with cls._lock:
                if cls not in cls._instancias:
                    cls._instancias[cls] = super().__call__(*args, **kwargs)
        return cls._instancias[cls]

    def reiniciar_singleton(cls) -> None:
        """Descarta la instancia registrada. Uso exclusivo de las pruebas."""
        with cls._lock:
            cls._instancias.pop(cls, None)


# =============================================================================
# GESTOR DE BASE DE DATOS
# =============================================================================
class DatabaseManager(metaclass=_SingletonMeta):
    """Gestor unico de la base SQLite local.

    Attributes:
        ruta_db: ruta absoluta del archivo de base de datos.
    """

    def __init__(self, ruta_db: Path | str | None = None) -> None:
        """Inicializa el gestor.

        Args:
            ruta_db: ruta del archivo .db. Si se omite usa `settings.DB_PATH`.
                Acepta ":memory:" para pruebas en memoria.
        """
        self.ruta_db: Path | str = ruta_db if ruta_db is not None else settings.DB_PATH
        self._local = threading.local()
        self._lock_escritura = threading.RLock()
        self._cfg = settings.SQLITE
        self._esquema_verificado = False
        # La migracion aditiva se aplica UNA vez por proceso, en la primera
        # conexion que se abra. Ver `_abrir_conexion` para el razonamiento.
        self._migracion_aplicada = False
        # True cuando el sistema de archivos no admitio WAL y se degrado a
        # DELETE. La interfaz lo muestra: el usuario debe saber que esta
        # operando en modo compatible y por que.
        self._journal_degradado = False
        self._journal_verificado = False
        # Modo compatible con sistemas de archivos sin bloqueos POSIX. Obliga a
        # una UNICA conexion compartida y serializada; ver `_acceso()`.
        self._modo_exclusivo = False
        self._con_compartida: sqlite3.Connection | None = None

        if isinstance(self.ruta_db, Path):
            try:
                self.ruta_db.parent.mkdir(parents=True, exist_ok=True)
            except OSError as exc:
                raise ErrorBaseDatos(
                    f"No se pudo preparar el directorio de la base: {exc}"
                ) from exc

        _log.info("DatabaseManager inicializado sobre %s", self.ruta_db)

    # -------------------------------------------------------------------------
    # CONEXION
    # -------------------------------------------------------------------------
    @property
    def conexion(self) -> sqlite3.Connection:
        """Conexion SQLite propia del hilo actual, creada al primer uso.

        Returns:
            sqlite3.Connection: conexion con PRAGMAs ya aplicados y
            `row_factory = sqlite3.Row`.

        Raises:
            ErrorBaseDatos: si el archivo no es accesible o esta corrupto.
        """
        # En modo exclusivo la base solo admite UNA conexion: se comparte y todo
        # acceso queda serializado por `_acceso()`.
        if self._modo_exclusivo and self._con_compartida is not None:
            return self._con_compartida

        con: sqlite3.Connection | None = getattr(self._local, "con", None)
        if con is not None:
            return con

        # La CREACION se serializa. Sin este cerrojo, varios hilos que arrancan
        # a la vez abren su conexion antes de que el primero haya determinado si
        # el sistema de archivos obliga al modo exclusivo; en ese modo la base
        # solo admite una conexion y las demas mueren con un `disk I/O error`
        # que parece corrupcion y no lo es. Es una carrera que solo aparece
        # sobre montajes sin bloqueos POSIX.
        with self._lock_escritura:
            if self._modo_exclusivo and self._con_compartida is not None:
                return self._con_compartida
            con = getattr(self._local, "con", None)
            if con is not None:
                return con
            return self._abrir_conexion()

    def _abrir_conexion(self) -> sqlite3.Connection:
        """Abre y registra una conexion. Debe llamarse con `_lock_escritura` tomado.

        Returns:
            sqlite3.Connection: conexion lista para usar.

        Raises:
            ErrorBaseDatos: si el archivo no es accesible.
        """
        try:
            con = sqlite3.connect(
                self.ruta_db if isinstance(self.ruta_db, str) else str(self.ruta_db),
                timeout=self._cfg.busy_timeout_ms / 1000.0,
                isolation_level=None,  # control explicito de transacciones
                # En modo normal cada hilo recibe su propia conexion y nunca la
                # comparte, de modo que desactivar la comprobacion no relaja
                # nada. En modo exclusivo la comparticion es deliberada y la
                # seguridad la aporta el cerrojo, no esta bandera.
                check_same_thread=False,
            )
            con.row_factory = sqlite3.Row
            self._aplicar_pragmas(con)
        except sqlite3.Error as exc:
            _log.exception("Fallo al abrir la base")
            raise ErrorBaseDatos(f"No se pudo abrir la base {self.ruta_db}: {exc}") from exc

        if self._modo_exclusivo:
            self._con_compartida = con
        else:
            self._local.con = con

        # MIGRACION AUTOMATICA, UNA VEZ POR PROCESO.
        #
        # Estaba ligada a `inicializar_esquema`, que solo invoca el generador de
        # datos. Cualquier otra via de entrada -la linea de comandos, la Torre
        # de Control, el propio .EXE- abria una base antigua sin migrar y moria
        # al primer INSERT sobre una columna nueva:
        #
        #     ErrorEsquema: Columnas inexistentes en validacion_modelos:
        #                   ['mad', 'senal_rastreo']
        #
        # Una migracion que depende de que el llamador se acuerde de invocarla
        # no es una migracion. Se ancla aqui, en el unico punto por el que pasa
        # todo acceso a la base, de modo que ninguna via de entrada pueda
        # saltarsela. Se ejecuta con `_lock_escritura` ya tomado por el llamador
        # y es idempotente: sobre una base al dia no emite una sola sentencia.
        if not self._migracion_aplicada:
            self._migracion_aplicada = True      # antes de migrar: evita reentrada
            try:
                self._migrar_columnas(con)
            except sqlite3.Error as exc:         # una base de solo lectura, p.ej.
                _log.warning("Migracion aditiva no aplicada: %s", exc)

        _log.debug("Nueva conexion SQLite en el hilo %s", threading.current_thread().name)
        return con

    @contextmanager
    def _acceso(self) -> Iterator[None]:
        """Serializa el acceso cuando la base opera en modo exclusivo.

        En modo normal no hace nada: cada hilo tiene su conexion y WAL admite
        lectores concurrentes. En modo exclusivo hay una sola conexion para todo
        el proceso y dos hilos que la usen a la vez corromperian el cursor, de
        modo que toda lectura pasa por el mismo cerrojo que las escrituras.
        """
        if self._modo_exclusivo:
            with self._lock_escritura:
                yield
        else:
            yield

    def _aplicar_pragmas(self, con: sqlite3.Connection) -> None:
        """Aplica los PRAGMAs de rendimiento e integridad a una conexion nueva.

        Args:
            con: conexion recien abierta.

        Note:
            `journal_mode=WAL` es persistente en el archivo, pero los demas
            PRAGMAs son POR CONEXION: hay que aplicarlos siempre, en cada hilo.
            Omitir `foreign_keys=ON` convierte las FK en documentacion inerte.
        """
        cfg = self._cfg
        sentencias = (
            f"PRAGMA journal_mode={cfg.journal_mode};",
            f"PRAGMA synchronous={cfg.synchronous};",
            f"PRAGMA busy_timeout={cfg.busy_timeout_ms};",
            f"PRAGMA foreign_keys={'ON' if cfg.foreign_keys else 'OFF'};",
            f"PRAGMA temp_store={cfg.temp_store};",
            f"PRAGMA cache_size={cfg.cache_size_kb};",
            f"PRAGMA mmap_size={cfg.mmap_size};",
        )
        for sql in sentencias:
            try:
                con.execute(sql)
            except sqlite3.Error as exc:
                # Una base en memoria o un sistema de archivos de red rechazan
                # WAL o mmap. Es degradacion aceptable, no causa de aborto.
                _log.warning("PRAGMA no aplicado (%s): %s", sql.strip(), exc)

        self._asegurar_journal_utilizable(con)

    def _asegurar_journal_utilizable(self, con: sqlite3.Connection) -> None:
        """Comprueba que el modo de journal activo permite escribir, y degrada si no.

        WAL necesita memoria compartida entre procesos, que SQLite implementa
        con un archivo `-shm` mapeado. Los sistemas de archivos de red -unidades
        SMB, carpetas sincronizadas por OneDrive o Drive, montajes FUSE- no
        soportan ese mapeo. El sintoma es traicionero: el `PRAGMA
        journal_mode=WAL` responde 'wal' como si hubiera funcionado y el fallo
        aparece despues, en la primera escritura real, como un
        `disk I/O error` sin mas contexto.

        Esto no es una hipotesis de laboratorio: es donde vive el aplicativo.
        La carpeta del proyecto esta bajo Documentos, que en muchos equipos esta
        sincronizada con OneDrive, y el ejecutable puede acabar en una unidad de
        red del aula. Un sistema que solo arranca desde un disco local no es
        entregable.

        Estrategia: se prueba una escritura real. Si falla, se degrada a
        `journal_mode=DELETE` -que solo usa el archivo principal y un journal
        contiguo, compatible con cualquier sistema de archivos- y se eleva
        `synchronous` a FULL, porque NORMAL solo es seguro bajo WAL.

        Args:
            con: conexion con los PRAGMAs ya aplicados.

        Raises:
            ErrorBaseDatos: si la base no admite escritura en ningun modo.
        """
        def _probar_escritura() -> None:
            con.execute("CREATE TABLE IF NOT EXISTS _sapa_sonda (x INTEGER);")
            con.execute("INSERT INTO _sapa_sonda (x) VALUES (1);")
            con.execute("DELETE FROM _sapa_sonda;")
            con.execute("DROP TABLE _sapa_sonda;")
            con.commit()

        def _aplicar_modo_compatible(exclusivo: bool) -> None:
            """Reaplica el modo degradado a una conexion.

            `locking_mode=EXCLUSIVE` debe fijarse ANTES que `journal_mode`: es
            lo que hace que SQLite deje de usar bloqueos por rango de bytes, que
            es justo lo que estos sistemas de archivos no implementan.
            """
            sentencias = ["PRAGMA locking_mode=EXCLUSIVE;"] if exclusivo else []
            sentencias += ["PRAGMA journal_mode=DELETE;", "PRAGMA synchronous=FULL;",
                           "PRAGMA mmap_size=0;"]
            for sql in sentencias:
                try:
                    con.execute(sql)
                except sqlite3.Error:
                    pass

        # El sondeo escribe en la base y solo puede correr UNA vez por proceso.
        # Ejecutarlo en cada conexion nueva hace que varios hilos creen y borren
        # la misma tabla a la vez y colisionen: el diagnostico se convertiria en
        # la averia. El modo de journal es una propiedad del ARCHIVO, no de la
        # conexion, asi que basta determinarlo una vez y reaplicarlo despues.
        with self._lock_escritura:
            if self._journal_verificado:
                if self._journal_degradado:
                    _aplicar_modo_compatible(self._modo_exclusivo)
                return
            self._journal_verificado = True

        try:
            _probar_escritura()
            return
        except sqlite3.Error as exc:
            modo = "desconocido"
            try:
                modo = con.execute("PRAGMA journal_mode;").fetchone()[0]
                con.rollback()
            except sqlite3.Error:
                pass
            _log.warning(
                "El modo de journal '%s' no admite escritura en este sistema de "
                "archivos (%s). Degradando a DELETE.", modo, exc,
            )

        # --- Nivel 2: journal DELETE con bloqueo normal ----------------------
        try:
            _aplicar_modo_compatible(exclusivo=False)
            _probar_escritura()
            self._journal_degradado = True
            _log.info(
                "Base operando en journal_mode=DELETE. Es mas lenta en carga masiva "
                "y no admite lectores concurrentes durante una escritura, pero es "
                "compatible con carpetas de red y sincronizadas."
            )
            return
        except sqlite3.Error as exc:
            _log.warning("DELETE con bloqueo normal tampoco funciona (%s).", exc)
            try:
                con.rollback()
            except sqlite3.Error:
                pass

        # --- Nivel 3: DELETE con bloqueo exclusivo ---------------------------
        # Ultimo recurso para montajes que no implementan bloqueos por rango de
        # bytes (SMB antiguo, FUSE, algunos clientes de sincronizacion). SQLite
        # toma el archivo entero una sola vez y deja de pedir bloqueos.
        #
        # CONSECUENCIA QUE HAY QUE DECLARAR: con `locking_mode=EXCLUSIVE` la
        # base admite UNA sola conexion en todo el sistema. El gestor pasa a
        # conexion compartida y serializa tambien las lecturas. Para un
        # aplicativo de escritorio de un solo usuario es aceptable; para varios
        # usuarios sobre la misma carpeta, no lo es, y por eso el mensaje
        # recomienda mover la base a disco local.
        try:
            _aplicar_modo_compatible(exclusivo=True)
            _probar_escritura()
            self._journal_degradado = True
            self._modo_exclusivo = True
            self._con_compartida = con
            _log.warning(
                "Sistema de archivos sin bloqueos POSIX. Base en journal_mode=DELETE "
                "con locking_mode=EXCLUSIVE: una sola conexion, accesos serializados. "
                "Funciona, pero para uso multiusuario mueva la base a disco local."
            )
        except sqlite3.Error as exc:
            raise ErrorBaseDatos(
                "La base de datos no admite escritura en esta ubicacion "
                f"({exc}). Mueva la carpeta del aplicativo a un disco local "
                "-por ejemplo C:\\SAPA- fuera de OneDrive o de una unidad de red."
            ) from exc

    def cerrar_conexion_hilo(self) -> None:
        """Cierra y descarta la conexion del hilo actual, si existe."""
        con: sqlite3.Connection | None = getattr(self._local, "con", None)
        if con is None:
            return
        try:
            con.close()
        except sqlite3.Error as exc:
            _log.warning("Error al cerrar la conexion del hilo: %s", exc)
        finally:
            self._local.con = None

    # -------------------------------------------------------------------------
    # TRANSACCIONES
    # -------------------------------------------------------------------------
    @contextmanager
    def transaccion(self, inmediata: bool = True) -> Iterator[sqlite3.Cursor]:
        """Contexto transaccional con commit/rollback automatico.

        Args:
            inmediata: si es True emite `BEGIN IMMEDIATE`, que toma el bloqueo
                de escritura al inicio. Con `BEGIN DEFERRED` (el de por defecto)
                el bloqueo se solicita al primer write, y bajo concurrencia eso
                produce `SQLITE_BUSY` a mitad de transaccion con trabajo ya
                hecho: fallar temprano es mas barato que fallar tarde.

        Yields:
            sqlite3.Cursor: cursor dentro de la transaccion.

        Raises:
            ErrorIntegridad: si se viola una restriccion declarativa.
            ErrorBaseDatos: ante cualquier otro fallo de SQLite.
        """
        con = self.conexion
        with self._lock_escritura:
            cur = con.cursor()
            try:
                cur.execute("BEGIN IMMEDIATE;" if inmediata else "BEGIN;")
                yield cur
                con.commit()
            except sqlite3.IntegrityError as exc:
                con.rollback()
                _log.error("Integridad violada, rollback aplicado: %s", exc)
                raise ErrorIntegridad(str(exc)) from exc
            except sqlite3.Error as exc:
                con.rollback()
                _log.exception("Error SQLite, rollback aplicado")
                raise ErrorBaseDatos(str(exc)) from exc
            except Exception:
                con.rollback()
                _log.exception("Error de aplicacion dentro de la transaccion, rollback")
                raise
            finally:
                cur.close()

    # -------------------------------------------------------------------------
    # ESQUEMA
    # -------------------------------------------------------------------------
    def inicializar_esquema(self, forzar: bool = False) -> None:
        """Crea el esquema si no existe y registra su version.

        Args:
            forzar: si es True elimina todas las tablas del nucleo antes de
                recrearlas. Operacion destructiva: solo para regenerar el
                dataset de prueba.

        Raises:
            ErrorEsquema: si el DDL no puede aplicarse.
        """
        try:
            con = self.conexion
            with self._lock_escritura:
                if forzar:
                    _log.warning("Reconstruccion forzada del esquema: se eliminan tablas")
                    con.execute("PRAGMA foreign_keys=OFF;")
                    for tabla in reversed(TABLAS_NUCLEO):
                        con.execute(f"DROP TABLE IF EXISTS {tabla};")
                    con.commit()
                    con.execute("PRAGMA foreign_keys=ON;")

                con.executescript(SCHEMA_DDL)
                con.execute(
                    "INSERT INTO metadata_esquema (clave, valor, fecha_actualizacion) "
                    "VALUES ('version_esquema', ?, ?) "
                    "ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor, "
                    "fecha_actualizacion=excluded.fecha_actualizacion;",
                    (str(settings.ESQUEMA_VERSION), datetime.now().isoformat(timespec="seconds")),
                )
                con.execute(
                    "INSERT INTO metadata_esquema (clave, valor, fecha_actualizacion) "
                    "VALUES ('version_app', ?, ?) "
                    "ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor, "
                    "fecha_actualizacion=excluded.fecha_actualizacion;",
                    (settings.APP_VERSION, datetime.now().isoformat(timespec="seconds")),
                )
                con.commit()
                self._migrar_columnas(con)
            self._esquema_verificado = True
            _log.info("Esquema v%s aplicado correctamente", settings.ESQUEMA_VERSION)
        except sqlite3.Error as exc:
            _log.exception("Fallo al aplicar el DDL")
            raise ErrorEsquema(f"No se pudo inicializar el esquema: {exc}") from exc

    # Columnas incorporadas despues de la version inicial del esquema. El DDL usa
    # CREATE TABLE IF NOT EXISTS, de modo que sobre una base ya existente una
    # columna nueva NO aparece y todo INSERT que la mencione falla. Declararlas
    # aqui permite evolucionar el esquema sin obligar a regenerar una base de
    # 50 MB ni perder las corridas historicas, que son evidencia de auditoria.
    #
    # Se omiten las clausulas CHECK a proposito: SQLite las admite en ALTER
    # TABLE ADD COLUMN de forma desigual entre versiones, y una restriccion que
    # falla al migrar deja la base a medias. La validacion de dominio de estas
    # columnas vive en el codigo que las calcula.
    COLUMNAS_AGREGADAS: dict[str, tuple[tuple[str, str], ...]] = {
        "validacion_modelos": (
            ("mad", "REAL"),
            ("senal_rastreo", "REAL"),
        ),
    }

    def _migrar_columnas(self, con: sqlite3.Connection) -> None:
        """Agrega de forma aditiva las columnas que falten en una base antigua.

        La migracion es idempotente y no destructiva: consulta `PRAGMA
        table_info` y solo emite el ALTER de lo ausente. Una base ya migrada
        atraviesa este metodo sin ejecutar una sola sentencia.

        Args:
            con: conexion abierta dentro del lock de escritura.
        """
        for tabla, columnas in self.COLUMNAS_AGREGADAS.items():
            try:
                existentes = {fila[1] for fila in
                              con.execute(f"PRAGMA table_info({tabla});").fetchall()}
            except sqlite3.Error:
                continue                      # la tabla no existe todavia
            if not existentes:
                continue
            for nombre, tipo in columnas:
                if nombre in existentes:
                    continue
                try:
                    con.execute(f"ALTER TABLE {tabla} ADD COLUMN {nombre} {tipo};")
                    con.commit()
                    _log.info("Migracion: %s.%s agregada", tabla, nombre)
                except sqlite3.Error as exc:
                    _log.error("No se pudo agregar %s.%s: %s", tabla, nombre, exc)

        self._sellar_version(con)

    def _sellar_version(self, con: sqlite3.Connection) -> None:
        """Deja constancia en la base de la version de esquema y de aplicacion.

        El sello estaba unicamente en `inicializar_esquema`, de modo que una
        base migrada por otra via seguia declarandose en la version anterior.
        El sintoma es silencioso y caro: la base opera correctamente con el
        esquema nuevo mientras `metadata_esquema` afirma el viejo, y un auditor
        que lea esa tabla encuentra una contradiccion con la documentacion.

        Quien pone la base al dia es responsable de sellarla. Por eso el sello
        vive aqui, junto a la migracion, y no en la creacion del esquema.
        """
        marca = datetime.now().isoformat(timespec="seconds")
        for clave, valor in (("version_esquema", str(settings.ESQUEMA_VERSION)),
                             ("version_app", settings.APP_VERSION)):
            try:
                actual = con.execute(
                    "SELECT valor FROM metadata_esquema WHERE clave = ?;", (clave,)
                ).fetchone()
            except sqlite3.Error:
                return                       # la tabla aun no existe
            if actual is not None and actual[0] == valor:
                continue
            try:
                con.execute(
                    "INSERT INTO metadata_esquema (clave, valor, fecha_actualizacion) "
                    "VALUES (?, ?, ?) ON CONFLICT(clave) DO UPDATE SET "
                    "valor=excluded.valor, fecha_actualizacion=excluded.fecha_actualizacion;",
                    (clave, valor, marca),
                )
                con.commit()
                _log.info("Sello de version: %s = %s", clave, valor)
            except sqlite3.Error as exc:
                _log.error("No se pudo sellar %s: %s", clave, exc)

    def verificar_esquema(self) -> dict[str, bool]:
        """Comprueba la presencia de todas las tablas del nucleo.

        Returns:
            dict[str, bool]: nombre de tabla -> existe.
        """
        try:
            with self._acceso():
                filas = self.conexion.execute(
                    "SELECT name FROM sqlite_master WHERE type='table';"
                ).fetchall()
            existentes = {f["name"] for f in filas}
            return {t: (t in existentes) for t in TABLAS_NUCLEO}
        except sqlite3.Error as exc:
            raise ErrorEsquema(f"No se pudo inspeccionar el esquema: {exc}") from exc

    # -------------------------------------------------------------------------
    # LECTURA
    # -------------------------------------------------------------------------
    def consultar_df(self, sql: str, params: Sequence[Any] | None = None) -> pd.DataFrame:
        """Ejecuta un SELECT y devuelve un DataFrame.

        Args:
            sql: sentencia SELECT parametrizada con '?'.
            params: valores de los parametros.

        Returns:
            pd.DataFrame: resultado; vacio si no hay filas.

        Raises:
            ErrorBaseDatos: ante error de SQLite.

        Note:
            Siempre parametrizado. La concatenacion de literales en SQL es la
            via de inyeccion incluso en una base local, donde el atacante es un
            archivo Excel con un nombre de SKU malicioso.
        """
        try:
            with self._acceso():
                cur = self.conexion.execute(sql, tuple(params or ()))
                filas = cur.fetchall()
                columnas = [d[0] for d in cur.description] if cur.description else []
                cur.close()
            return pd.DataFrame(filas, columns=columnas) if filas else pd.DataFrame(columns=columnas)
        except sqlite3.Error as exc:
            _log.exception("Fallo en consulta: %.120s", sql)
            raise ErrorBaseDatos(f"Consulta fallida: {exc}") from exc

    def consultar_escalar(self, sql: str, params: Sequence[Any] | None = None) -> Any:
        """Ejecuta un SELECT y devuelve la primera columna de la primera fila.

        Args:
            sql: sentencia SELECT.
            params: parametros posicionales.

        Returns:
            Any: valor escalar, o None si no hubo filas.
        """
        try:
            with self._acceso():
                fila = self.conexion.execute(sql, tuple(params or ())).fetchone()
            return fila[0] if fila is not None else None
        except sqlite3.Error as exc:
            raise ErrorBaseDatos(f"Consulta escalar fallida: {exc}") from exc

    # -------------------------------------------------------------------------
    # ESCRITURA
    # -------------------------------------------------------------------------
    def ejecutar(self, sql: str, params: Sequence[Any] | None = None) -> int:
        """Ejecuta un DML unitario dentro de su propia transaccion.

        Args:
            sql: INSERT/UPDATE/DELETE parametrizado.
            params: parametros posicionales.

        Returns:
            int: numero de filas afectadas.
        """
        with self.transaccion() as cur:
            cur.execute(sql, tuple(params or ()))
            return cur.rowcount

    def ejecutar_masivo(self, sql: str, filas: Iterable[Sequence[Any]]) -> int:
        """Ejecuta un DML repetido con `executemany` en una sola transaccion.

        Args:
            sql: sentencia parametrizada.
            filas: iterable de tuplas de parametros.

        Returns:
            int: numero de filas procesadas.
        """
        lote = list(filas)
        if not lote:
            return 0
        with self.transaccion() as cur:
            cur.executemany(sql, lote)
            return len(lote)

    def insertar_df(
        self,
        tabla: str,
        df: pd.DataFrame,
        modo: str = "INSERT",
    ) -> int:
        """Carga masiva de un DataFrame en una tabla existente.

        Se implementa con `executemany` sobre sentencias parametrizadas en lugar
        de `DataFrame.to_sql`, por tres motivos: (1) `to_sql` exige SQLAlchemy
        para cualquier cosa que no sea una conexion DBAPI cruda y ata el
        proyecto a la dependencia que se excluyo por Nuitka; (2) no permite
        `INSERT OR REPLACE`; (3) no controla el tamano de lote ni la
        transaccion, y en 500k filas eso decide entre segundos y minutos.

        Args:
            tabla: nombre de la tabla destino. Se valida contra el catalogo
                para impedir interpolacion arbitraria de identificadores.
            df: datos a insertar. Sus columnas deben existir en la tabla.
            modo: 'INSERT', 'INSERT OR REPLACE' o 'INSERT OR IGNORE'.

        Returns:
            int: filas insertadas.

        Raises:
            ErrorEsquema: si la tabla no existe o hay columnas desconocidas.
            ErrorIntegridad: si alguna fila viola una restriccion.
        """
        if df.empty:
            _log.info("insertar_df: DataFrame vacio para %s, nada que hacer", tabla)
            return 0

        modo = modo.upper().strip()
        if modo not in {"INSERT", "INSERT OR REPLACE", "INSERT OR IGNORE"}:
            raise ValueError(f"Modo de insercion no soportado: {modo}")

        columnas_tabla = self._columnas_de(tabla)
        desconocidas = set(df.columns) - columnas_tabla
        if desconocidas:
            raise ErrorEsquema(
                f"Columnas inexistentes en {tabla}: {sorted(desconocidas)}"
            )

        cols = list(df.columns)
        marcadores = ", ".join("?" * len(cols))
        sql = f'{modo} INTO "{tabla}" ({", ".join(cols)}) VALUES ({marcadores});'

        # itertuples es ~10x mas rapido que iterrows y preserva el orden de cols.
        # Se convierten NaN/NaT a None: SQLite no entiende el NaN de numpy.
        datos = [
            tuple(None if pd.isna(v) else v for v in fila)
            for fila in df.itertuples(index=False, name=None)
        ]

        insertadas = 0
        chunk = self._cfg.chunk_insercion
        try:
            with self.transaccion() as cur:
                for inicio in range(0, len(datos), chunk):
                    bloque = datos[inicio : inicio + chunk]
                    cur.executemany(sql, bloque)
                    insertadas += len(bloque)
        except ErrorIntegridad:
            _log.error("Carga de %s abortada por integridad; transaccion revertida", tabla)
            raise
        _log.info("insertar_df: %d filas -> %s", insertadas, tabla)
        return insertadas

    def _columnas_de(self, tabla: str) -> set[str]:
        """Devuelve el conjunto de columnas de una tabla existente.

        Args:
            tabla: nombre de la tabla.

        Returns:
            set[str]: nombres de columna.

        Raises:
            ErrorEsquema: si la tabla no existe.
        """
        with self._acceso():
            filas = self.conexion.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?;", (tabla,)
            ).fetchall()
            if not filas:
                raise ErrorEsquema(f"La tabla '{tabla}' no existe en el esquema")
            info = self.conexion.execute(f'PRAGMA table_info("{tabla}");').fetchall()
        return {r["name"] for r in info}

    # -------------------------------------------------------------------------
    # MANTENIMIENTO Y DIAGNOSTICO
    # -------------------------------------------------------------------------
    def registrar_auditoria(
        self,
        modulo: str,
        nivel: str,
        evento: str,
        detalle: str | None = None,
        id_corrida: str | None = None,
    ) -> None:
        """Escribe un registro en `log_auditoria`.

        No propaga excepciones: la auditoria nunca debe tumbar el proceso que
        audita. Un fallo aqui se reporta al log de archivo y se continua.
        """
        try:
            self.ejecutar(
                "INSERT INTO log_auditoria (id_corrida, modulo, nivel, evento, detalle) "
                "VALUES (?, ?, ?, ?, ?);",
                (id_corrida, modulo, nivel, evento, detalle),
            )
        except ErrorBaseDatos as exc:
            _log.warning("No se pudo registrar auditoria (%s): %s", evento, exc)

    def diagnostico(self) -> dict[str, Any]:
        """Devuelve el estado operativo de la base para el panel de control.

        Returns:
            dict[str, Any]: ruta, tamano, modo de journal, integridad, conteos.
        """
        info: dict[str, Any] = {"ruta": str(self.ruta_db), "ok": False}
        try:
            con = self.conexion
            with self._acceso():
                info["journal_mode"] = con.execute("PRAGMA journal_mode;").fetchone()[0]
                info["foreign_keys"] = bool(con.execute("PRAGMA foreign_keys;").fetchone()[0])
                info["integrity_check"] = con.execute("PRAGMA quick_check;").fetchone()[0]
                info["fk_violaciones"] = len(con.execute("PRAGMA foreign_key_check;").fetchall())
            info["journal_degradado"] = self._journal_degradado
            info["modo_exclusivo"] = self._modo_exclusivo
            if isinstance(self.ruta_db, Path) and self.ruta_db.exists():
                info["tamano_mb"] = round(self.ruta_db.stat().st_size / 1_048_576, 2)
            conteos: dict[str, int] = {}
            for tabla, existe in self.verificar_esquema().items():
                conteos[tabla] = (
                    int(self.consultar_escalar(f'SELECT COUNT(*) FROM "{tabla}";') or 0)
                    if existe
                    else -1
                )
            info["conteos"] = conteos
            info["ok"] = info["integrity_check"] == "ok" and info["fk_violaciones"] == 0
        except (ErrorBaseDatos, sqlite3.Error) as exc:
            info["error"] = str(exc)
            _log.exception("Diagnostico de base fallido")
        return info

    def compactar(self) -> None:
        """Ejecuta checkpoint del WAL y VACUUM.

        Reduce el archivo tras una regeneracion completa del dataset. VACUUM no
        puede correr dentro de una transaccion, por eso no usa `transaccion()`.
        """
        try:
            with self._lock_escritura:
                self.conexion.execute("PRAGMA wal_checkpoint(TRUNCATE);")
                self.conexion.execute("VACUUM;")
            _log.info("Base compactada")
        except sqlite3.Error as exc:
            _log.warning("No se pudo compactar la base: %s", exc)

    def respaldar(self, destino: Path) -> Path:
        """Copia consistente de la base usando la API de backup de SQLite.

        Args:
            destino: ruta del archivo de respaldo.

        Returns:
            Path: ruta escrita.

        Raises:
            ErrorBaseDatos: si el respaldo falla.

        Note:
            Copiar el .db con el sistema de archivos mientras hay conexiones
            abiertas produce respaldos corruptos bajo WAL, porque el contenido
            vigente puede residir en el archivo -wal. `Connection.backup()` es
            la unica forma correcta.
        """
        try:
            destino.parent.mkdir(parents=True, exist_ok=True)
            with sqlite3.connect(str(destino)) as destino_con:
                self.conexion.backup(destino_con)
            _log.info("Respaldo generado en %s", destino)
            return destino
        except (sqlite3.Error, OSError) as exc:
            raise ErrorBaseDatos(f"Respaldo fallido: {exc}") from exc
