@echo off
REM CANVAS MODEL IA - Ejecucion directa con Python (alternativa al EXE)
setlocal
set PYTHONDONTWRITEBYTECODE=1
set "D=%~dp0"
cd /d "%D%.."
if not exist "%TEMP%\cmia_venv\Scripts\python.exe" (
  python -m venv "%TEMP%\cmia_venv"
  "%TEMP%\cmia_venv\Scripts\python.exe" -m pip install -r "%D%requirements.txt"
)
"%TEMP%\cmia_venv\Scripts\python.exe" "%D%run_canvas.py"
pause
