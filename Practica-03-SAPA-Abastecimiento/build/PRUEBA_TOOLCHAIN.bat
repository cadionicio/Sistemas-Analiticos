@echo off
REM ===========================================================================
REM  SAPA - Prueba de la cadena de compilacion
REM
REM  Compila un programa de doce lineas y lo ejecuta. Dos o tres minutos.
REM
REM  Separa dos causas que se confunden bajo el mismo "codigo 1":
REM    (A) la cadena de compilacion no funciona en este equipo, o
REM    (B) funciona, y lo que falla es el tamano de la aplicacion.
REM
REM  La accion correcta es opuesta en cada caso, asi que conviene saberlo
REM  antes de invertir veinte minutos en la compilacion completa.
REM ===========================================================================
setlocal
cd /d "%~dp0"

echo.
echo  SAPA - Prueba de la cadena de compilacion
echo  =========================================
echo.
echo  Esto compila un "hola mundo" para comprobar si Nuitka funciona.
echo  Tarda entre 2 y 5 minutos. No cierre la ventana.
echo.

where powershell >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] No se encontro PowerShell en el PATH.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0PRUEBA_TOOLCHAIN.ps1"

echo.
echo  ---------------------------------------------------------------
echo  Informe:  %~dp0prueba_toolchain.txt
echo  Detalle:  %~dp0prueba_toolchain_nuitka.log
echo  ---------------------------------------------------------------
echo.
pause
