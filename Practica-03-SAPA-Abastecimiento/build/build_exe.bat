@echo off
REM ===========================================================================
REM  RUTA DESCARTADA - SE CONSERVA COMO TRAZABILIDAD DEL DESARROLLO
REM
REM  Este lanzador usa Nuitka, que traduce el programa a C y lo compila. En el
REM  equipo de destino esa cadena murio siempre en el mismo punto:
REM
REM    module.altair.vegalite.v6.schema.core.c(166116) :
REM    fatal error C1002: el compilador no tiene espacio en el monton
REM
REM  Altair genera su esquema Vega-Lite por codigo y un solo modulo se traduce
REM  a un archivo C de 166 000 lineas. Reproducirlo exige MSVC y >= 8 GB libres.
REM
REM  PARA GENERAR EL ENTREGABLE USE:  EMPAQUETAR.bat
REM ===========================================================================
setlocal
echo.
echo  ATENCION: esta es la ruta Nuitka, descartada por un limite del
echo            compilador de C. Para generar el .EXE use EMPAQUETAR.bat
echo.
choice /C SN /M "Continuar de todas formas"
if errorlevel 2 exit /b 0
REM ===========================================================================
REM  SAPA - Lanzador de la compilacion
REM  Envoltorio de build_exe.ps1 para quien prefiera no abrir PowerShell.
REM
REM  -ExecutionPolicy Bypass afecta UNICAMENTE a este proceso: no modifica la
REM  politica del equipo ni deja rastro en el registro. Es la forma correcta de
REM  ejecutar un script propio sin bajar la seguridad de la maquina.
REM ===========================================================================
setlocal
cd /d "%~dp0"

echo.
echo  SAPA - Compilacion a ejecutable nativo
echo  ======================================
echo.

where powershell >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] No se encontro PowerShell en el PATH.
    pause
    exit /b 1
)

REM Si el proyecto esta bajo OneDrive, la salida se manda a un disco local:
REM Nuitka escribe decenas de miles de archivos temporales y el cliente de
REM sincronizacion los procesa uno a uno.
echo "%~dp0" | find /I "OneDrive" >nul
if not errorlevel 1 (
    echo  Proyecto bajo OneDrive: la salida ira a C:\SAPA_build
    echo.
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build_exe.ps1" -Limpiar -SalidaEn C:\SAPA_build
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build_exe.ps1" %*
)
set CODIGO=%ERRORLEVEL%

echo.
if %CODIGO% NEQ 0 (
    echo  [ERROR] La compilacion termino con codigo %CODIGO%.
    echo.
    echo  El detalle completo esta en:  %~dp0ultimo_build.log
    echo  Ejecute DIAGNOSTICO.bat para saber que falta.
) else (
    echo  [OK] Proceso finalizado.
    echo  Registro completo en:  %~dp0ultimo_build.log
)
pause
exit /b %CODIGO%
