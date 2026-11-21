@echo off
REM ===========================================================================
REM  SAPA - Diagnostico del entorno de compilacion
REM
REM  No compila ni modifica nada. Mira el equipo y escribe un informe en
REM  build\diagnostico.txt.
REM
REM  Ejecutelo ANTES de compilar por primera vez, o despues de un fallo:
REM  el informe dice exactamente que falta y que hacer.
REM ===========================================================================
setlocal
cd /d "%~dp0"

echo.
echo  SAPA - Diagnostico del entorno
echo  ==============================
echo.

where powershell >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] No se encontro PowerShell en el PATH.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0DIAGNOSTICO.ps1"

echo.
echo  ---------------------------------------------------------------
echo  El informe quedo en:  %~dp0diagnostico.txt
echo  Abralo o compartalo para revisar que falta.
echo  ---------------------------------------------------------------
echo.
pause
