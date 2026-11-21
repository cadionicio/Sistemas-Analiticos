@echo off
REM ===========================================================================
REM  SAPA - Cierre de entrega en un solo clic
REM
REM  1. Regenera la corrida con el esquema v3 para que la base que viaja dentro
REM     del .EXE traiga el MAD y la senal de rastreo, tal como los declaran los
REM     documentos y las capturas de los entregables.
REM  2. Vuelve a empaquetar el ejecutable con el codigo vigente (version 2.1.0).
REM  3. Copia la distribucion terminada dentro de ENTREGABLES\07.
REM
REM  Tarda entre 4 y 8 minutos. No cierre la ventana.
REM ===========================================================================
setlocal
cd /d "%~dp0.."

echo.
echo  ===============================================================
echo    SAPA - Cierre de entrega
echo  ===============================================================
echo.
echo  [1/3] Regenerando la corrida sobre el esquema v3...
echo        (migra la base de forma aditiva; no se pierde nada)
echo.
python main.py correr
if errorlevel 1 (
    echo.
    echo  [ERROR] La corrida fallo. Revise el detalle de arriba.
    pause
    exit /b 1
)

echo.
echo  [2/3] Empaquetando el ejecutable con el codigo vigente...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0EMPAQUETAR.ps1" -Limpiar
if errorlevel 1 (
    echo.
    echo  [ERROR] El empaquetado fallo. Detalle en build\pyinstaller.log
    pause
    exit /b 1
)

echo.
echo  [3/3] Copiando la distribucion al entregable 7...
set "DESTINO=%~dp0..\..\ENTREGABLES\07_Aplicativo_Ejecutable\SAPA"
xcopy "%~dp0..\dist_exe\SAPA" "%DESTINO%\" /E /I /Y /Q
if errorlevel 1 (
    echo  [AVISO] La copia no se completo. Copie la carpeta a mano.
) else (
    echo        Copiada en ENTREGABLES\07_Aplicativo_Ejecutable\SAPA
)

echo.
echo  ===============================================================
echo    LISTO. Puede cerrar esta ventana.
echo  ===============================================================
echo.
pause
