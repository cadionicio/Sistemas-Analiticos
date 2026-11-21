"""Punto de entrada del ejecutable SAPA.

Arranca el servidor de Streamlit dentro de ESTE proceso y abre el navegador.
Es el archivo que el empaquetador toma como punto de entrada; `app.py` viaja
como DATO y lo ejecuta el runtime de Streamlit, porque Streamlit necesita
leer el script desde disco para aplicarle su transformacion AST.

POR QUE NO SE USA `streamlit.web.cli.main()` COMO RUTA PRINCIPAL
----------------------------------------------------------------
`cli.main()` es un grupo de Click: parsea `sys.argv`, valida opciones y termina
llamando a `sys.exit()`. Dentro de un binario compilado eso trae tres problemas
concretos:

1.  Click resuelve el nombre del programa desde `sys.argv[0]`, que en el
    ejecutable es la ruta del .exe y no "streamlit"; los mensajes de error y
    algunas rutas de autocompletado quedan inconsistentes.
2.  `cli.main()` invoca `sys.exit()` con `standalone_mode=True`, de modo que un
    fallo de arranque mata el proceso sin dejar rastro en pantalla: el usuario
    ve una ventana que se cierra sola, que es el peor modo de fallar cuando la
    calificacion empieza ejecutando el .EXE.
3.  Varias rutas del CLI consultan la metadata de la distribucion con
    `importlib.metadata`. Si Nuitka no la empaqueto, el fallo ocurre DESPUES de
    parsear argumentos y se confunde con un error de opciones.

La ruta principal es `streamlit.web.bootstrap.run()`, que levanta el servidor
directamente, acepta la configuracion como diccionario y no llama a `sys.exit()`.
`cli.main()` queda como plan de contingencia por si una version futura cambia la
firma de `bootstrap.run`.

Uso:
    python run_app.py            # desarrollo
    SAPA.exe                     # binario empaquetado con PyInstaller
"""

from __future__ import annotations

import inspect
import os
import socket
import sys
import threading
import time
import traceback
import webbrowser
from pathlib import Path

PUERTO_PREFERIDO = 8520
NOMBRE_SCRIPT = "app.py"


# =============================================================================
# LOCALIZACION DE RECURSOS
# =============================================================================
def raiz_aplicacion() -> Path:
    """Directorio donde viven los datos del aplicativo.

    Devuelve el directorio DONDE SE ESCRIBE, no donde vive el codigo. Bajo un
    binario congelado el codigo puede estar en una carpeta interna de solo
    lectura, pero la base SQLite, los exportables y los registros deben quedar
    junto al .exe, a la vista del evaluador.

    Se contemplan los tres modos de ejecucion:

    *   PyInstaller (`--onedir`, ruta actual): define `sys.frozen`; la raiz es
        la carpeta del ejecutable.
    *   Nuitka `--standalone` (ruta historica): inyecta la global `__compiled__`
        con `containing_dir`, y no siempre define `sys.frozen`.
    *   Interprete: el directorio de este archivo.

    Returns:
        Path: raiz de la distribucion.
    """
    compilado = globals().get("__compiled__")
    if compilado is not None:
        try:
            return Path(compilado.containing_dir).resolve()
        except AttributeError:
            pass
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def ruta_script() -> Path:
    """Ruta en disco de `app.py`.

    Streamlit NECESITA el script como archivo de texto en disco: lo lee, lo
    reescribe con su transformacion AST (el "magic" que convierte expresiones
    sueltas en `st.write`) y lo ejecuta. Un modulo compilado dentro del binario
    no sirve para eso, y por eso `app.py` se empaqueta como DATO y no como
    codigo. Si este archivo falta, el ejecutable no puede arrancar.

    Returns:
        Path: ruta del script principal.

    Raises:
        FileNotFoundError: si `app.py` no acompana al ejecutable.
    """
    raiz = raiz_aplicacion()
    candidatos: list[Path] = []
    # PyInstaller en modo carpeta deja los datos en `_internal` y expone la ruta
    # en `sys._MEIPASS`. Se consulta PRIMERO porque es el unico sitio donde el
    # archivo esta garantizado: la raiz junto al .exe la puede tocar el usuario.
    recursos = getattr(sys, "_MEIPASS", None)
    if recursos:
        candidatos.append(Path(recursos) / NOMBRE_SCRIPT)
    candidatos += [raiz / NOMBRE_SCRIPT, raiz / "sapa" / NOMBRE_SCRIPT,
                   Path.cwd() / NOMBRE_SCRIPT]
    for c in candidatos:
        if c.is_file():
            return c.resolve()
    raise FileNotFoundError(
        f"No se encontro {NOMBRE_SCRIPT}. Rutas probadas: "
        + ", ".join(str(c) for c in candidatos)
    )


def puerto_libre(preferido: int = PUERTO_PREFERIDO, intentos: int = 25) -> int:
    """Devuelve el primer puerto libre a partir del preferido.

    Evita el fallo mas comun en una segunda ejecucion: el puerto sigue ocupado
    por una instancia anterior y el binario muere con un error de socket que el
    usuario no puede interpretar.
    """
    for offset in range(intentos):
        candidato = preferido + offset
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            if s.connect_ex(("127.0.0.1", candidato)) != 0:
                return candidato
    return preferido


# =============================================================================
# CONFIGURACION DEL SERVIDOR
# =============================================================================
def opciones(puerto: int) -> dict[str, object]:
    """Opciones de arranque de Streamlit para el binario.

    Decisiones relevantes:

    *   `fileWatcherType = "none"`: el vigilante de archivos recorre los modulos
        importados buscando cambios. Dentro del binario esos modulos no existen
        como .py y el vigilante lanza excepciones en bucle.
    *   `headless = True`: impide que Streamlit intente abrir el navegador por
        su cuenta y que pida el correo de telemetria en el primer arranque, que
        dejaria el proceso esperando una entrada por consola que nadie escribira.
    *   `gatherUsageStats = False`: sin telemetria no hay intento de salida a
        red, coherente con el requisito de operacion local.
    """
    return {
        "server.port": puerto,
        "server.address": "127.0.0.1",
        "server.headless": True,
        "server.fileWatcherType": "none",
        "server.enableCORS": False,
        "server.enableXsrfProtection": True,
        "browser.gatherUsageStats": False,
        "global.developmentMode": False,
        "logger.level": "error",
        "theme.base": "dark",
        "theme.primaryColor": "#38BDF8",
        "theme.backgroundColor": "#0B1220",
        "theme.secondaryBackgroundColor": "#111C2E",
        "theme.textColor": "#E6EDF7",
    }


def exportar_entorno(opts: dict[str, object]) -> None:
    """Replica las opciones como variables de entorno.

    Cinturon y tirantes: algunas rutas internas de Streamlit leen la
    configuracion del entorno antes de que el diccionario de opciones se haya
    propagado. Duplicarlas cuesta nada y elimina una clase entera de fallos de
    arranque intermitentes.
    """
    for clave, valor in opts.items():
        seccion, campo = clave.split(".", 1)
        nombre = f"STREAMLIT_{seccion.upper()}_{_a_mayusculas(campo)}"
        os.environ[nombre] = str(valor)
    os.environ.setdefault("STREAMLIT_SERVER_RUN_ON_SAVE", "false")


def _a_mayusculas(campo: str) -> str:
    """Convierte `camelCase` a `MAYUSCULAS_CON_GUION_BAJO`."""
    salida = []
    for ch in campo:
        if ch.isupper():
            salida.append("_")
        salida.append(ch.upper())
    return "".join(salida)


def silenciar_registros(nivel: str = "ERROR") -> None:
    """Baja el nivel de registro de Streamlit y sus dependencias.

    La opcion `logger.level` de Streamlit no basta: varias de sus dependencias
    (uvicorn, watchdog, el motor de cache) escriben por el modulo `logging`
    estandar con su propio espacio de nombres. En un binario congelado el modulo
    `inspect` no encuentra el codigo fuente de las funciones cacheadas y el
    motor de cache registra una traza completa POR CADA UNA. Es inofensivo -lo
    captura y usa el bytecode como clave- pero llena la consola de trazas de
    excepcion, y una consola llena de trazas es indistinguible de un programa
    roto para quien lo esta calificando.
    """
    import logging

    try:
        numero = getattr(logging, nivel.upper(), logging.ERROR)
        for espacio in ("streamlit", "uvicorn", "uvicorn.error", "uvicorn.access",
                        "watchdog", "asyncio", "PIL", "matplotlib"):
            logging.getLogger(espacio).setLevel(numero)
        from streamlit import logger as st_logger
        if hasattr(st_logger, "set_log_level"):
            st_logger.set_log_level(nivel.lower())
    except Exception:  # noqa: BLE001 - silenciar logs jamas debe impedir arrancar
        pass


def abrir_navegador(url: str, retraso: float = 2.0) -> None:
    """Abre el navegador del sistema una vez levantado el servidor."""
    def _tarea() -> None:
        time.sleep(retraso)
        try:
            webbrowser.open(url, new=2)
        except Exception:  # noqa: BLE001 - abrir el navegador nunca es critico
            pass
    threading.Thread(target=_tarea, daemon=True).start()


# =============================================================================
# ARRANQUE
# =============================================================================
def lanzar_con_bootstrap(script: Path, opts: dict[str, object]) -> None:
    """Arranca el servidor con `streamlit.web.bootstrap.run` (ruta principal).

    La firma de `run()` cambio entre versiones de Streamlit: unas aceptan
    `command_line` y otras `is_hello`. Se inspecciona en tiempo de ejecucion en
    lugar de fijar una version, de modo que una actualizacion de la libreria no
    rompa el ejecutable.
    """
    from streamlit import config as st_config
    from streamlit.web import bootstrap

    for clave, valor in opts.items():
        st_config.set_option(clave, valor)
    silenciar_registros("ERROR")

    parametros = list(inspect.signature(bootstrap.run).parameters)
    if "is_hello" in parametros:
        bootstrap.run(str(script), False, [], opts)
    elif "command_line" in parametros:
        bootstrap.run(str(script), "", [], opts)
    else:
        bootstrap.run(str(script), [], opts)


def lanzar_con_cli(script: Path, puerto: int) -> None:
    """Plan de contingencia: delega en el CLI de Streamlit."""
    from streamlit.web import cli as st_cli

    sys.argv = [
        "streamlit", "run", str(script),
        f"--server.port={puerto}",
        "--server.address=127.0.0.1",
        "--server.headless=true",
        "--server.fileWatcherType=none",
        "--browser.gatherUsageStats=false",
        "--global.developmentMode=false",
    ]
    st_cli.main()


def main() -> int:
    """Arranca la Torre de Control.

    Returns:
        int: codigo de salida del proceso.
    """
    raiz = raiz_aplicacion()
    os.chdir(raiz)  # la base SQLite y las carpetas de trabajo cuelgan de aqui

    # CONTRATO DE RAIZ DE DATOS. Se fija aqui, en el unico punto del sistema que
    # sabe con certeza donde esta el .EXE, y ANTES de ceder el control a
    # Streamlit. Es imprescindible: el ejecutor de scripts de Streamlit reescribe
    # `sys.argv` con la ruta de `app.py`, que dentro del binario vive en la
    # carpeta interna de recursos. Cuando `config.settings` se importaba desde
    # ese hilo y deducia la raiz de `sys.argv[0]`, creaba una base vacia dentro
    # de `_internal/` y la aplicacion abria entera con todos los contadores en
    # cero, sin un solo error visible.
    os.environ["SAPA_BASE_DIR"] = str(raiz)

    print("=" * 70)
    print("  SAPA · Sistema Analitico Predictivo de Abastecimiento")
    print("  Torre de Control WES — iniciando servidor local")
    print("=" * 70)

    try:
        script = ruta_script()
    except FileNotFoundError as exc:
        print(f"\n[ERROR] {exc}")
        print("La carpeta de distribucion esta incompleta. Vuelva a copiarla entera.")
        input("\nPulse Enter para cerrar…")
        return 2

    puerto = puerto_libre()
    url = f"http://127.0.0.1:{puerto}"
    opts = opciones(puerto)
    exportar_entorno(opts)

    print(f"  Directorio  : {raiz}")
    print(f"  Aplicacion  : {script.name}")
    print(f"  Direccion   : {url}")
    print("\n  El navegador se abrira solo. Para detener el sistema, cierre esta ventana.")
    print("=" * 70)

    abrir_navegador(url)

    try:
        lanzar_con_bootstrap(script, opts)
        return 0
    except (ImportError, AttributeError, TypeError) as exc:
        print(f"\n[AVISO] bootstrap no disponible ({type(exc).__name__}: {exc}).")
        print("[AVISO] Reintentando por la ruta del CLI de Streamlit…")
        try:
            lanzar_con_cli(script, puerto)
            return 0
        except SystemExit as salida:       # Click termina con SystemExit
            return int(salida.code or 0)
        except Exception:                  # noqa: BLE001
            traceback.print_exc()
    except KeyboardInterrupt:
        print("\nServidor detenido por el usuario.")
        return 0
    except Exception:                      # noqa: BLE001 - frontera del proceso
        traceback.print_exc()

    # Nunca cerrar la ventana en silencio: un .exe que desaparece no deja
    # diagnostico y es indistinguible de un bloqueo del antivirus.
    print("\nEl servidor no pudo iniciarse. Revise el detalle anterior.")
    input("Pulse Enter para cerrar…")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
