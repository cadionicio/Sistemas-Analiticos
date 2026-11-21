@echo off
REM GESTION Y CONTROL ESTRATEGICO IA - Iniciar con Python (alternativa al EXE)
REM Requiere haber ejecutado antes Preparar_Entorno_GCE.bat
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONDONTWRITEBYTECODE=1
set PYTHONIOENCODING=utf-8
set "PYEXE=%LOCALAPPDATA%\GCE_IA\entorno\Scripts\python.exe"
if not exist "%PYEXE%" (
  echo No existe el entorno. Ejecute primero Preparar_Entorno_GCE.bat
  pause
  exit /b 1
)
"%PYEXE%" run_gce.py
