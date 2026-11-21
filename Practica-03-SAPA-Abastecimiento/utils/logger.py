"""Servicio de logging unificado del SAPA.

Un unico configurador para toda la aplicacion. Se evita `logging.basicConfig`
porque Streamlit instala sus propios handlers en el root logger y duplicaria
cada linea en consola.
"""

from __future__ import annotations

import logging
import sys
import threading
from logging.handlers import RotatingFileHandler

from config import settings

_LOCK = threading.Lock()
_CONFIGURADO = False

_FORMATO = "%(asctime)s | %(levelname)-8s | %(name)-22s | %(threadName)-12s | %(message)s"


def configurar_logging() -> None:
    """Instala los handlers de archivo y consola una sola vez por proceso.

    Idempotente y thread-safe: multiples hilos de Streamlit pueden invocarla.
    Un fallo de escritura en disco degrada a consola en lugar de abortar: el
    ejecutable debe arrancar aunque la carpeta logs/ sea de solo lectura.
    """
    global _CONFIGURADO
    with _LOCK:
        if _CONFIGURADO:
            return

        raiz = logging.getLogger("sapa")
        raiz.setLevel(getattr(logging, settings.LOG_NIVEL, logging.INFO))
        raiz.propagate = False
        formateador = logging.Formatter(_FORMATO, datefmt="%Y-%m-%d %H:%M:%S")

        consola = logging.StreamHandler(stream=sys.stdout)
        consola.setFormatter(formateador)
        raiz.addHandler(consola)

        try:
            archivo = RotatingFileHandler(
                filename=settings.LOG_ARCHIVO,
                maxBytes=settings.LOG_MAX_BYTES,
                backupCount=settings.LOG_BACKUPS,
                encoding="utf-8",
            )
            archivo.setFormatter(formateador)
            raiz.addHandler(archivo)
        except OSError as exc:
            raiz.warning("Logging a archivo deshabilitado (%s). Solo consola.", exc)

        _CONFIGURADO = True


def obtener_logger(nombre: str) -> logging.Logger:
    """Devuelve un logger hijo del arbol 'sapa'.

    Args:
        nombre: nombre corto del modulo, p.ej. 'db_manager'.

    Returns:
        logging.Logger: logger configurado y listo para usar.
    """
    configurar_logging()
    return logging.getLogger(f"sapa.{nombre}")
