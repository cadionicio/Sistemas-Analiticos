@echo off
REM ===========================================================================
REM  SAPA - Empaquetado a ejecutable SIN compilador de C
REM
REM  Reemplaza a build_exe.bat (ruta Nuitka), que exigia traducir el programa a
REM  C y compilarlo. Ese camino murio siempre en el mismo sitio: el modulo de
REM  esquema de Altair se traduce a un archivo C de 166 000 lineas y cl.exe
REM  agota su monton intentando compilarlo.
REM
REM  PyInstaller no compila: congela. El arranque nativo ya viene compilado
REM  dentro del paquete. Tarda minutos y no necesita MSVC ni MinGW.
REM ===========================================================================
setlocal
cd /d "%~dp0"

echo.
echo  SAPA - Empaquetado a ejecutable nativo
echo  ======================================
echo.
echo  Sin compilador de C. Entre 3 y 8 minutos.
echo.

where powershell >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] No se encontro PowerShell en el PATH.
    pause
    exit /b 1
)

REM Si el proyecto esta bajo OneDrive, la salida va a un disco local: el cliente
REM de sincronizacion procesa uno a uno los miles de archivos de Streamlit y
REM convierte un empaquetado de cinco minutos en uno de cuarenta.
echo "%~dp0" | find /I "OneDrive" >nul
if not errorlevel 1 (
    echo  Proyecto bajo OneDrive: la salida ira a C:\SAPA_build
    echo.
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0EMPAQUETAR.ps1" -Limpiar -SalidaEn C:\SAPA_build
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0EMPAQUETAR.ps1" -Limpiar %*
)
set CODIGO=%ERRORLEVEL%

echo.
if %CODIGO% NEQ 0 (
    echo  [ERROR] El empaquetado termino con codigo %CODIGO%.
    echo.
    echo  Detalle completo en:  %~dp0pyinstaller.log
    echo  Resumen en:           %~dp0ultimo_empaquetado.log
) else (
    echo  [OK] Proceso finalizado.
    echo  Resumen en:  %~dp0ultimo_empaquetado.log
)
pause
exit /b %CODIGO%
