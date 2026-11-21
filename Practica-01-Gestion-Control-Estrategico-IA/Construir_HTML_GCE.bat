@echo off
REM ==================================================================
REM  GESTION Y CONTROL ESTRATEGICO IA - Construir 8_GCE_IA.html
REM  Incrusta los modulos .py y 10_Data_Prueba.xlsx en un unico HTML
REM  (stlite: Streamlit + Pyodide en el navegador). Resultado: log_html.txt
REM ==================================================================
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set PYTHONDONTWRITEBYTECODE=1
set PYTHONIOENCODING=utf-8
set "LOG=%~dp0log_html.txt"
set "PYEXE=%LOCALAPPDATA%\GCE_IA\entorno\Scripts\python.exe"
if not exist "%PYEXE%" set "PYEXE=py -3"
echo === GCE-IA construccion HTML %DATE% %TIME% === > "%LOG%"
%PYEXE% build_html.py >> "%LOG%" 2>&1
echo BUILD_HTML_EXIT=%ERRORLEVEL% >> "%LOG%"
for %%A in ("%~dp08_GCE_IA.html") do echo HTML_BYTES=%%~zA >> "%LOG%"
echo === FIN %DATE% %TIME% === >> "%LOG%"
echo Proceso terminado. Resultado en log_html.txt
timeout /t 3 >nul
endlocal
