# -*- coding: utf-8 -*-
"""
GESTIÓN Y CONTROL ESTRATÉGICO IA (GCE-IA)
config.py - Rutas, constantes y parámetros globales.

Regla de rutas: todos los archivos se leen y escriben en la carpeta
Entregable/ (carpeta única, sin subcarpetas). BASE_DIR apunta a esa carpeta:
  * EXE (PyInstaller): carpeta donde está 7_GCE_IA.exe (variable GCE_BASE_DIR
    fijada por run_gce.py, o sys.executable).
  * Script: carpeta donde está este archivo (Entregable/).
Así, BASE_DIR / "gce_ia.db" equivale a ./Entregable/gce_ia.db
sin depender de la carpeta desde donde se lance el programa.
"""
import os
import sys
from pathlib import Path

APP_NOMBRE = "GESTIÓN Y CONTROL ESTRATÉGICO IA"
APP_CORTO = "GCE · IA"
APP_VERSION = "1.0.0"


def _resolver_base_dir() -> Path:
    env = os.environ.get("GCE_BASE_DIR")
    if env:
        return Path(env).resolve()
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


BASE_DIR: Path = _resolver_base_dir()


def ruta(nombre_archivo: str) -> Path:
    """Devuelve la ruta de un archivo dentro de Entregable/ (sin subcarpetas)."""
    if any(sep in nombre_archivo for sep in ("/", "\\")):
        raise ValueError("Solo se permiten nombres de archivo (carpeta única Entregable/).")
    return BASE_DIR / nombre_archivo


DB_PATH = ruta("gce_ia.db")
# En la versión HTML (8_GCE_IA.html) la data de prueba viaja dentro de la página
# y se indica con GCE_DATA_PRUEBA; en EXE/script se usa la carpeta Entregable/.
_DEMO = os.environ.get("GCE_DATA_PRUEBA")
DATA_PRUEBA_XLSX = Path(_DEMO) if _DEMO else ruta("10_Data_Prueba.xlsx")
ES_WEB = sys.platform == "emscripten"   # True cuando corre en el navegador (Pyodide)
PLANTILLA_XLSX = ruta("Plantilla_Carga_GCE_IA.xlsx")

# ------------------------------------------------------------------ Dominio
PERSPECTIVAS = ["Financiera", "Clientes", "Procesos", "Aprendizaje"]
PREFIJO_PERSPECTIVA = {"Financiera": "F", "Clientes": "C", "Procesos": "P", "Aprendizaje": "A"}
SENTIDOS = ["MAX", "MIN", "RANGO"]
TIPOS_VALOR = ["Meta", "Real"]
CALIDAD_DATO = ["Certificado", "No certificado"]
ESTADOS_FLUJO = ["Borrador", "Propuesto", "En revisión", "Aprobado", "Rechazado"]
ESTADOS_INICIATIVA = ["No iniciada", "En ejecución", "Retrasada", "Completada", "Cancelada"]
PUERTAS = ["G0", "G1", "G2", "G3", "G4"]
TIPOS_INICIATIVA = ["IA", "Tradicional"]
ESCENARIOS_BASE = ["Protección", "Base", "Expansión"]
ROLES = ["Administrador", "Analista", "Aprobador", "Consulta"]

# Pesos por defecto de la matriz de priorización (guía 2027, p. 12)
PESOS_PRIORIZACION = {
    "p_eva": 0.30, "p_alineamiento": 0.20, "p_tiempo_valor": 0.15,
    "p_factibilidad": 0.15, "p_adopcion": 0.10, "p_riesgo": 0.10,
}

# Simulación Monte Carlo (guía 2027, p. 11)
MC_ITERACIONES = 10_000
MC_SEMILLA = 2027
UMBRAL_PROB_EVA = 0.60

# Límites de coherencia del BSC (guía 2027, pp. 13 y 36)
MIN_OBJETIVOS, MAX_OBJETIVOS = 10, 15
MIN_KPI, MAX_KPI = 15, 25
MAX_KPI_POR_OBJETIVO = 2

# ------------------------------------------------------------------ Diseño
COLOR = {
    "marca": "#1F3A5F", "accion": "#0E7C86", "texto2": "#5A6B7F", "fondo": "#F7F9FC",
    "borde": "#D5DEEA", "verde": "#2E7D32", "ambar": "#F9A825", "rojo": "#C62828",
    "gris": "#9E9E9E", "azul_claro": "#EAF1F8",
}
COLOR_SEMAFORO = {"VERDE": COLOR["verde"], "AMBAR": COLOR["ambar"], "ROJO": COLOR["rojo"],
                  "GRIS": COLOR["gris"], "N/A": COLOR["borde"]}
COLOR_PERSPECTIVA = {"Financiera": "#1F3A5F", "Clientes": "#0E7C86",
                     "Procesos": "#3F6FB5", "Aprendizaje": "#6A8E3A"}

USUARIO_ADMIN_DEFECTO = ("admin", "admin123")
