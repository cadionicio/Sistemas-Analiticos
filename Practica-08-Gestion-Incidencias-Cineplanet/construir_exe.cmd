@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title Construccion de PC08
cd /d "%~dp0"
set "PYTHONUTF8=1"
set "VER=0.8.2"
set "LOG=%~dp0build\construir_exe.log"
set "TRAB=%LOCALAPPDATA%\PC08_build"
set "SAL=%~dp0..\PC08_Entrega\PC08_v%VER%"
echo ==== Construccion PC08 v%VER% - %date% %time% ==== > "%LOG%"
echo.
echo  Construyendo PC08 v%VER%: PC08.exe y PC08.html (soluciones aisladas) en una sola carpeta.
echo  Puede tardar de 3 a 6 minutos. Registro: build\construir_exe.log
echo.
set "PYEXE="
for %%V in (3.14 3.13 3.12 3.11) do (
  if not defined PYEXE for /f "delims=" %%P in ('py -%%V -c "import sys;print(sys.executable)" 2^>nul') do set "PYEXE=%%P"
)
if not defined PYEXE for /f "delims=" %%P in ('python -c "import sys;assert sys.version_info>=(3,11);print(sys.executable)" 2^>nul') do set "PYEXE=%%P"
if not defined PYEXE (echo  [FALLA] No se encontro Python 3.11 o superior. & echo FALLA sin Python >> "%LOG%" & goto fin)
echo  [1/6] Python: %PYEXE%
"%PYEXE%" -c "import sys,sqlite3,platform;print('Python',sys.version.split()[0],'SQLite',sqlite3.sqlite_version,platform.platform())" >> "%LOG%" 2>&1

echo  [2/6] Entorno aislado y dependencias...
if not exist "%TRAB%\venv2\Scripts\python.exe" "%PYEXE%" -m venv "%TRAB%\venv2" >> "%LOG%" 2>&1
set "VPY=%TRAB%\venv2\Scripts\python.exe"
if not exist "%VPY%" (echo  [FALLA] No se pudo crear el entorno. & goto fin)
"%VPY%" -m pip install --disable-pip-version-check -q -r requirements.txt >> "%LOG%" 2>&1 || (echo  [FALLA] Dependencias. Revise internet y el registro. & goto fin)
"%VPY%" -m pip freeze >> "%LOG%" 2>&1

echo  [3/6] Pruebas automaticas de la base de datos...
"%VPY%" pruebas\ejecutar.py >> "%LOG%" 2>&1 || (echo  [FALLA] Pruebas. Ver registro. & goto fin)
where node >nul 2>&1 && (node pruebas\nucleo.test.js >> "%LOG%" 2>&1 || (echo  [FALLA] Pruebas del nucleo. & goto fin))

echo  [4/6] Empaquetando PC08.exe...
if exist "%SAL%" rmdir /s /q "%SAL%"
if exist "%TRAB%\dist" rmdir /s /q "%TRAB%\dist"
"%VPY%" -m PyInstaller --noconfirm --clean --log-level WARN --distpath "%TRAB%\dist" --workpath "%TRAB%\work3" build\pc08.spec >> "%LOG%" 2>&1 || (echo  [FALLA] PyInstaller. Ver registro. & goto fin)
mkdir "%SAL%" >> "%LOG%" 2>&1
copy /y "%TRAB%\dist\PC08.exe" "%SAL%\PC08.exe" >> "%LOG%" 2>&1
if not exist "%SAL%\PC08.exe" (echo  [FALLA] No se genero PC08.exe & goto fin)

echo  [5/6] Generando PC08.html (archivo unico)...
"%VPY%" build\html_unico.py "%SAL%\PC08.html" >> "%LOG%" 2>&1 || (echo  [FALLA] No se genero PC08.html & goto fin)

echo  [6/6] Comprimiendo...
if exist "%SAL%.zip" del /q "%SAL%.zip"
powershell -NoProfile -Command "Compress-Archive -Path '%SAL%' -DestinationPath '%SAL%.zip' -Force" >> "%LOG%" 2>&1
certutil -hashfile "%SAL%\PC08.exe" SHA256 >> "%LOG%" 2>&1
echo OK %date% %time% >> "%LOG%"
echo.
echo  [OK] Construccion terminada.
echo       Carpeta lista para probar: PC08_Entrega\PC08_v%VER%  (PC08.exe y PC08.html)
echo       ZIP: PC08_Entrega\PC08_v%VER%.zip
start "" explorer "%SAL%"
:fin
echo.
pause
