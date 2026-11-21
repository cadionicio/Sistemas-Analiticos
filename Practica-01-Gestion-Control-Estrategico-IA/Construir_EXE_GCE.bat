@echo off
REM ==================================================================
REM  GESTION Y CONTROL ESTRATEGICO IA - Construir 7_GCE_IA.exe
REM  Requiere haber ejecutado antes Preparar_Entorno_GCE.bat
REM  Archivos temporales (build/spec) en %TEMP%: Entregable queda limpia.
REM  Resultado: 7_GCE_IA.exe en esta carpeta y log_exe.txt
REM ==================================================================
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set PYTHONDONTWRITEBYTECODE=1
set PYTHONIOENCODING=utf-8
set "LOG=%~dp0log_exe.txt"
set "PYEXE=%LOCALAPPDATA%\GCE_IA\entorno\Scripts\python.exe"
set "TMPB=%TEMP%\GCE_IA_build"
set "E=%~dp0"
echo === GCE-IA construccion EXE %DATE% %TIME% === > "%LOG%"
if not exist "%PYEXE%" (
  echo ERROR: no existe el entorno. Ejecute Preparar_Entorno_GCE.bat >> "%LOG%"
  goto :fin
)
taskkill /f /im 7_GCE_IA.exe >nul 2>&1
if exist "%E%7_GCE_IA.exe" del /q "%E%7_GCE_IA.exe"
echo Construyendo 7_GCE_IA.exe (tarda varios minutos)...
"%PYEXE%" -m PyInstaller --noconfirm --clean --onefile --console ^
  --name 7_GCE_IA ^
  --distpath "%E%." --workpath "%TMPB%\work" --specpath "%TMPB%" ^
  --add-data "%E%app.py;." ^
  --hidden-import config --hidden-import db --hidden-import ui ^
  --hidden-import finanzas --hidden-import simulador --hidden-import motor_ia ^
  --hidden-import reporte_ppt ^
  --hidden-import vistas_base --hidden-import vistas_plan ^
  --hidden-import vistas_bsc --hidden-import vistas_control ^
  --collect-all streamlit --collect-all plotly --collect-all pptx ^
  --collect-data openpyxl --copy-metadata streamlit ^
  --paths "%E%." ^
  "%E%run_gce.py" >> "%LOG%" 2>&1
echo PYINSTALLER_EXIT=%ERRORLEVEL% >> "%LOG%"
if not exist "%E%7_GCE_IA.exe" (
  echo ERROR: no se genero el EXE >> "%LOG%"
  goto :fin
)
for %%A in ("%E%7_GCE_IA.exe") do echo EXE_BYTES=%%~zA >> "%LOG%"

echo === PRUEBA DE HUMO DEL EXE === >> "%LOG%"
set GCE_NO_BROWSER=1
set GCE_PUERTO=8599
start "GCE_EXE_PRUEBA" /min "%E%7_GCE_IA.exe"
set /a N=0
:espera
timeout /t 3 >nul
set /a N+=1
curl -s http://127.0.0.1:8599/_stcore/health > "%TMPB%\health.txt" 2>nul
findstr /c:"ok" "%TMPB%\health.txt" >nul && goto :ok
if %N% LSS 40 goto :espera
echo HEALTH=FALLO (sin respuesta en 120 s) >> "%LOG%"
goto :cerrar
:ok
echo HEALTH=ok (intentos %N%) >> "%LOG%"
curl -s -o "%TMPB%\index.html" -w "HTTP_INDEX=%%{http_code}\n" http://127.0.0.1:8599/ >> "%LOG%"
:cerrar
taskkill /f /im 7_GCE_IA.exe >> "%LOG%" 2>&1

:fin
echo === FIN %DATE% %TIME% === >> "%LOG%"
echo.
echo Proceso terminado. Resultado en log_exe.txt
timeout /t 5 >nul
endlocal
