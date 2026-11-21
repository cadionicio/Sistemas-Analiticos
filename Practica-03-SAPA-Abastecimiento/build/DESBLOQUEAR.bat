@echo off
REM ===========================================================================
REM  SAPA - Retirar la marca Mark-of-the-Web (MotW)
REM
REM  QUE HACE
REM  Windows adjunta a todo archivo procedente de Internet un flujo alternativo
REM  llamado Zone.Identifier. Cuando se ejecuta un programa que lo lleva,
REM  SmartScreen consulta la reputacion del archivo y, si no la tiene -que es
REM  el caso de cualquier ejecutable recien compilado y sin firma digital-,
REM  muestra la pantalla azul "Windows protegio su PC".
REM
REM  Unblock-File elimina ese flujo. Sin MotW no hay consulta de reputacion y
REM  por tanto no hay pantalla azul. No desactiva ninguna proteccion del
REM  sistema: Defender sigue analizando el archivo con normalidad.
REM
REM  CUANDO EJECUTARLO
REM  Solo si descargo esta carpeta de Internet, Drive, correo o similar. Si la
REM  copio desde una memoria USB o desde la red local, Windows no aplica MotW y
REM  este paso es innecesario.
REM
REM  Ejecutar UNA vez, antes del primer arranque de SAPA.exe.
REM ===========================================================================
setlocal
cd /d "%~dp0"

echo.
echo  SAPA - Desbloqueo de archivos descargados
echo  =========================================
echo.
echo  Carpeta: %~dp0
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$n=0; Get-ChildItem -LiteralPath '%~dp0' -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object { if (Get-Item -LiteralPath $_.FullName -Stream Zone.Identifier -ErrorAction SilentlyContinue) { Unblock-File -LiteralPath $_.FullName -ErrorAction SilentlyContinue; $n++ } }; Write-Host ('  Archivos desbloqueados: ' + $n) -ForegroundColor Green"

echo.
echo  Listo. Ya puede ejecutar SAPA.exe
echo.
pause
