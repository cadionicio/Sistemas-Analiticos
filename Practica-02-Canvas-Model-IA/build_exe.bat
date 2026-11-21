@echo off
REM ==========================================================================
REM  CANVAS MODEL IA - Construccion del ejecutable CANVAS_MODEL_IA.exe
REM  Uso: doble clic sobre este archivo (dentro de la carpeta Entregable).
REM  Requisito: Python 3.11 o 3.12 de 64 bits instalado (python.org).
REM ==========================================================================
setlocal
set PYTHONDONTWRITEBYTECODE=1
chcp 65001 >nul
set "D=%~dp0"
cd /d "%D%"
title CANVAS MODEL IA - Construccion del EXE

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] No se encontro Python. Instalelo desde https://www.python.org/downloads/
  echo         marcando la opcion "Add python.exe to PATH" y vuelva a ejecutar este archivo.
  pause
  exit /b 1
)

echo [1/4] Creando entorno virtual aislado en %TEMP%\cmia_venv ...
python -m venv "%TEMP%\cmia_venv" || goto :error
call "%TEMP%\cmia_venv\Scripts\activate.bat" || goto :error

echo [2/4] Instalando dependencias (requiere internet, 3-6 minutos) ...
python -m pip install --upgrade pip >nul
python -m pip install -r "%D%requirements.txt" || goto :error

echo [3/4] Generando la version HTML ...
python "%D%build_html.py" || goto :error

echo [4/4] Compilando CANVAS_MODEL_IA.exe con PyInstaller (5-10 minutos) ...
python -m PyInstaller --noconfirm --clean --onefile --console ^
  --name CANVAS_MODEL_IA ^
  --distpath "%D%." ^
  --workpath "%TEMP%\cmia_build" ^
  --specpath "%TEMP%\cmia_build" ^
  --paths "%D%." ^
  --collect-all streamlit ^
  --copy-metadata streamlit ^
  --collect-all plotly ^
  --collect-all pptx ^
  --collect-submodules openpyxl ^
  --hidden-import canvas_app ^
  --hidden-import db ^
  --hidden-import ia_engine ^
  --hidden-import forecast ^
  --hidden-import reports ^
  --add-data "%D%canvas_app.py;." ^
  --add-data "%D%db.py;." ^
  --add-data "%D%ia_engine.py;." ^
  --add-data "%D%forecast.py;." ^
  --add-data "%D%reports.py;." ^
  --add-data "%D%10_Data_Prueba.xlsx;." ^
  "%D%run_canvas.py" || goto :error

call deactivate
echo.
echo ==========================================================================
echo  LISTO: %D%CANVAS_MODEL_IA.exe
echo  Ejecutelo con doble clic. Usuario: admin  Clave: Admin2026!
echo ==========================================================================
pause
exit /b 0

:error
echo.
echo [ERROR] La construccion fallo. Revise los mensajes anteriores.
pause
exit /b 1
