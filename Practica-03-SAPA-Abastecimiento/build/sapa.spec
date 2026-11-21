# -*- mode: python ; coding: utf-8 -*-
"""Receta de empaquetado de SAPA con PyInstaller (sin compilador de C).

POR QUE ESTE ARCHIVO EXISTE
---------------------------
La ruta original de empaquetado era Nuitka, que TRADUCE el programa a C y luego
invoca un compilador nativo. En el equipo de destino esa cadena murio siempre en
el mismo punto, y el informe de fallo de Nuitka lo dice sin ambiguedad:

    module.altair.vegalite.v6.schema.core.c(166116) :
    fatal error C1002: el compilador no tiene espacio en el monton en el paso 2

Altair (dependencia de Streamlit) genera su esquema Vega-Lite por codigo: un solo
modulo se traduce a un archivo C de 166 000 lineas. `cl.exe` agota su monton
intentando compilarlo, y con ~1 GB de RAM libre no hay bandera que lo salve. El
problema no es el proyecto: es el tamano del arbol de dependencias de Streamlit
frente a la memoria disponible.

PyInstaller NO compila nada a C. Congela: copia el interprete, los .pyc y los
datos junto a un arranque (`bootloader`) que ya viene compilado dentro del wheel.
Por eso no necesita MSVC ni MinGW, no toca el monton del compilador y termina en
minutos en lugar de decenas de minutos.

REGLAS DE EMPAQUETADO QUE NO SE NEGOCIAN
----------------------------------------
1.  Modo CARPETA (`onedir`), nunca `onefile`. El autoextraible descomprime en
    %TEMP% y se ejecuta desde ahi: ese patron es identico al de un dropper y es
    el detonante heuristico numero uno de los antivirus.
2.  UPX DESACTIVADO. Comprimir secciones de un PE es, literalmente, la tecnica
    de ofuscacion que los motores heuristicos buscan.
3.  RECURSO DE VERSION incrustado. Un binario sin empresa, producto ni version
    declarados puntua peor en toda heuristica de reputacion.
4.  `app.py` viaja como DATO, no congelado. Streamlit LEE el script desde disco,
    le aplica su transformacion AST (el "magic" que convierte expresiones
    sueltas en `st.write`) y lo ejecuta. Un modulo congelado no sirve para eso.
5.  Los paquetes propios SI se congelan, y se declaran uno a uno. PyInstaller
    analiza `run_app.py`, que solo importa Streamlit; nunca ve los imports de
    `app.py` porque es un dato. Sin esta lista explicita el binario compila y
    muere al primer `from agents.core_agent import ...`.

SmartScreen es un asunto distinto y se trata fuera de aqui: lo dispara la marca
de procedencia de Internet (MotW) sobre un ejecutable sin firma de pago, no el
contenido del binario. Se resuelve con `Unblock-File` tras compilar y con
`DESBLOQUEAR.bat` en el equipo del evaluador.

Uso:
    python -m PyInstaller --noconfirm --clean build/sapa.spec
"""

import importlib.util
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, copy_metadata

# =============================================================================
# 1. RUTAS
# =============================================================================
# SPECPATH lo inyecta PyInstaller: es la carpeta de este archivo (build/).
RAIZ = Path(SPECPATH).resolve().parent          # noqa: F821  -> sistema/
if str(RAIZ) not in sys.path:
    sys.path.insert(0, str(RAIZ))

PAQUETES_PROPIOS = ("config", "db", "data", "engine", "agents", "ui", "utils")
MODULOS_PROPIOS_SUELTOS = ("export_html",)


def _modulos_locales() -> list[str]:
    """Enumera los modulos propios recorriendo el disco, sin importarlos.

    Se resuelve por sistema de archivos y no con `collect_submodules` a
    proposito: esa funcion IMPORTA el paquete para inspeccionarlo, y
    `config.settings` crea directorios al importarse. Un efecto secundario
    durante el empaquetado es una fuente de fallos irreproducibles.

    Returns:
        list[str]: nombres de modulo en notacion punteada, ordenados.
    """
    nombres: list[str] = []
    for paquete in PAQUETES_PROPIOS:
        base = RAIZ / paquete
        if not base.is_dir():
            continue
        nombres.append(paquete)
        for py in base.rglob("*.py"):
            if "__pycache__" in py.parts:
                continue
            partes = list(py.relative_to(RAIZ).with_suffix("").parts)
            if partes and partes[-1] == "__init__":
                partes = partes[:-1]
            if partes:
                nombres.append(".".join(partes))
    for suelto in MODULOS_PROPIOS_SUELTOS:
        if (RAIZ / f"{suelto}.py").is_file():
            nombres.append(suelto)
    return sorted(set(nombres))


def _existe(paquete: str) -> bool:
    """Indica si un paquete es importable en este entorno.

    Evita el fallo que tumbo la ruta anterior: pedir la inclusion de un paquete
    que no esta instalado aborta el empaquetado entero. El caso real fue
    `tornado`, que Streamlit 1.64 ya no usa.
    """
    try:
        return importlib.util.find_spec(paquete) is not None
    except (ImportError, ValueError):
        return False


# =============================================================================
# 2. RECOLECCION DE DEPENDENCIAS
# =============================================================================
datos: list = []
binarios: list = []
ocultos: list = []

# Paquetes que resuelven recursos o submodulos por nombre en tiempo de
# ejecucion. `collect_all` trae datos, extensiones nativas e imports ocultos.
# La lista se filtra contra lo realmente instalado: una entrada ausente ya no
# aborta la compilacion, solo se omite.
# NOTA SOBRE LO QUE NO ESTA EN ESTA LISTA
# `collect_all` es una escopeta: arrastra el paquete ENTERO, incluidas sus
# suites de prueba. Aplicarlo a pandas, numpy y pyarrow inflo una prueba real
# de esta receta a 475 MB, de los cuales 152 MB eran pyarrow y buena parte
# `pandas/tests`. PyInstaller ya trae hooks propios y correctos para esos tres:
# se los deja hacer su trabajo. Aqui solo van los paquetes que resuelven
# recursos o submodulos POR NOMBRE en tiempo de ejecucion, que es justo lo que
# un analisis estatico no puede ver.
for paquete in ("streamlit", "altair", "plotly", "openpyxl", "xlsxwriter",
                "narwhals", "click", "blinker", "watchdog", "uvicorn",
                "tornado"):
    if not _existe(paquete):
        continue
    d, b, h = collect_all(paquete)
    datos += d
    binarios += b
    ocultos += h

# Streamlit consulta `importlib.metadata.version(...)` de varias distribuciones
# al arrancar. Sin la metadata el fallo ocurre DESPUES de levantar el proceso y
# se manifiesta como una ventana que se cierra sola.
for distribucion in ("streamlit", "numpy", "pandas", "plotly", "altair",
                     "pyarrow", "openpyxl", "XlsxWriter", "packaging",
                     "click", "pillow", "narwhals"):
    try:
        datos += copy_metadata(distribucion)
    except Exception:  # noqa: BLE001 - la distribucion puede no estar instalada
        pass

# `app.py` como DATO (regla 4). Va a la carpeta interna de recursos; `run_app.py`
# lo busca alli via `sys._MEIPASS`.
datos.append((str(RAIZ / "app.py"), "."))

ocultos += _modulos_locales()
# pandas elige el motor de Excel por nombre en tiempo de ejecucion.
ocultos += ["openpyxl", "xlsxwriter", "sqlite3", "decimal", "csv"]
ocultos = sorted(set(ocultos))

# Lo que NO debe viajar. Cada exclusion es peso y superficie de fallo que no
# aporta nada: el proyecto no usa ninguno de estos.
EXCLUIDOS = [
    # Nunca se usan en el proyecto.
    "tkinter", "matplotlib", "scipy", "sklearn", "statsmodels", "sqlalchemy",
    "PyQt5", "PyQt6", "PySide2", "PySide6", "wx",
    # Herramientas de desarrollo: no tienen nada que hacer en el entregable.
    "pytest", "nuitka", "IPython", "jedi", "notebook", "jupyter", "ipywidgets",
    "test", "unittest",
    # Suites de prueba de las librerias de calculo. Decenas de MB de archivos
    # que el evaluador nunca ejecutara.
    "pandas.tests", "numpy.f2py", "pyarrow.tests",
    # pydeck solo lo necesita `st.map` / `st.pydeck_chart`, que esta aplicacion
    # no usa: todo el grafico es Plotly. Arrastra scikit-image, lxml y
    # cryptography por transitividad. Se corta de raiz.
    "pydeck", "skimage", "lxml", "cryptography",
]

# =============================================================================
# 3. ANALISIS Y ENSAMBLADO
# =============================================================================
a = Analysis(                                   # noqa: F821
    [str(RAIZ / "run_app.py")],
    pathex=[str(RAIZ)],
    binaries=binarios,
    datas=datos,
    hiddenimports=ocultos,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=EXCLUIDOS,
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)                               # noqa: F821

exe = EXE(                                      # noqa: F821
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,                      # modo carpeta (regla 1)
    name="SAPA",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,                                  # regla 2
    console=True,                               # la consola ES el diagnostico
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    version=str(RAIZ / "build" / "version_info.txt"),   # regla 3
)

coll = COLLECT(                                 # noqa: F821
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,                                  # regla 2, tambien en las DLL
    upx_exclude=[],
    name="SAPA",
)
