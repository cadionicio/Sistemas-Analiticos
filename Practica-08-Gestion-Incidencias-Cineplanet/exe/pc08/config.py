"""Configuración de la solución EXE (PC08.exe)."""
import os
import sys
from pathlib import Path

VERSION = "0.8.2"
TITULO = "Cineplanet · Gestión de incidencias"
CONGELADO = getattr(sys, "frozen", False)
RAIZ = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[2]))
WEB_DIR = RAIZ / "web"
MIGRACIONES_DIR = (RAIZ / "pc08" / "migraciones") if CONGELADO else Path(__file__).resolve().parent / "migraciones"


def carpeta_app() -> Path:
    if os.environ.get("PC08_DATOS"):
        base = Path(os.environ["PC08_DATOS"])
    elif os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "PC08"
    else:
        base = Path.home() / ".local" / "share" / "PC08"
    for sub in ("datos", "registros", "respaldos", "exportaciones"):
        (base / sub).mkdir(parents=True, exist_ok=True)
    return base


def base_datos() -> Path:
    return carpeta_app() / "datos" / "pc08.sqlite3"
