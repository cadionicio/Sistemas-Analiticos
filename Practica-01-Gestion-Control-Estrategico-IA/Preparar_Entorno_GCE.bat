@echo off
REM ==================================================================
REM  GESTION Y CONTROL ESTRATEGICO IA - Preparar entorno y probar
REM  Crea el entorno Python FUERA de Entregable (%LOCALAPPDATA%\GCE_IA)
REM  para mantener la carpeta unica, instala dependencias (solo binarios)
REM  y ejecuta la autoprueba. Resultado: log_entorno.txt
REM ==================================================================
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "LOG=%~dp0log_entorno.txt"
set "VENV=%LOCALAPPDATA%\GCE_IA\entorno"
set PYTHONIOENCODING=utf-8
set PYTHONDONTWRITEBYTECODE=1
echo === GCE-IA preparacion %DATE% %TIME% === > "%LOG%"
ver >> "%LOG%" 2>&1

set "PY="
where py >nul 2>&1 && py -3.11 --version >nul 2>&1 && set "PY=py -3.11"
if not defined PY where py >nul 2>&1 && py -3 --version >nul 2>&1 && set "PY=py -3"
if not defined PY where python >nul 2>&1 && python --version >nul 2>&1 && set "PY=python"
if not defined PY (
  echo ERROR: Python no encontrado. Instale Python 3.11 o superior desde python.org >> "%LOG%"
  echo Python no esta instalado. Revise log_entorno.txt
  goto :fin
)
echo PYTHON_USADO=%PY% >> "%LOG%"
%PY% -c "import sys,platform;print('VERSION',sys.version);print('ARQ',platform.architecture()[0])" >> "%LOG%" 2>&1

if not exist "%VENV%\Scripts\python.exe" (
  echo Creando entorno en %VENV% ...
  %PY% -m venv "%VENV%" >> "%LOG%" 2>&1
)
if not exist "%VENV%\Scripts\python.exe" (
  echo ERROR: no se pudo crear el entorno >> "%LOG%"
  goto :fin
)
echo Instalando dependencias (puede tardar unos minutos)...
"%VENV%\Scripts\python.exe" -m pip install --upgrade pip --disable-pip-version-check -q >> "%LOG%" 2>&1
"%VENV%\Scripts\python.exe" -m pip install --only-binary=:all: --disable-pip-version-check -r requirements.txt >> "%LOG%" 2>&1
echo PIP_EXIT=%ERRORLEVEL% >> "%LOG%"
"%VENV%\Scripts\python.exe" -c "import streamlit,pandas,numpy,plotly,openpyxl,pptx,PyInstaller;print('LIBRERIAS streamlit',streamlit.__version__,'pandas',pandas.__version__,'numpy',numpy.__version__,'pyinstaller',PyInstaller.__version__)" >> "%LOG%" 2>&1
echo === AUTOPRUEBA === >> "%LOG%"
"%VENV%\Scripts\python.exe" autoprueba.py >> "%LOG%" 2>&1
echo AUTOPRUEBA_EXIT=%ERRORLEVEL% >> "%LOG%"

:fin
echo === FIN %DATE% %TIME% === >> "%LOG%"
echo.
echo Proceso terminado. Resultado en log_entorno.txt
timeout /t 5 >nul
endlocal
