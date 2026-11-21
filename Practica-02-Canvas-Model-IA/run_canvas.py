# -*- coding: utf-8 -*-
"""
CANVAS MODEL IA - Lanzador del ejecutable (run_canvas.py)
---------------------------------------------------------
Punto de entrada del archivo CANVAS_MODEL_IA.exe (PyInstaller).
- Ubica la carpeta de trabajo para que las rutas ./Entregable/ sean válidas.
- Copia la data de prueba junto al ejecutable si no existe.
- Busca un puerto libre, inicia el servidor local de Streamlit y abre el navegador.
"""
from __future__ import annotations

import os
import shutil
import socket
import sys
import threading
import time
import webbrowser

TITULO = "CANVAS MODEL IA"


def carpeta_recursos() -> str:
    """Carpeta donde están los .py empaquetados (sys._MEIPASS en el .exe)."""
    return getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))


def carpeta_trabajo() -> str:
    """Carpeta que contiene a Entregable/ (el .exe puede estar dentro o al lado de Entregable)."""
    base = os.path.dirname(sys.executable) if getattr(sys, "frozen", False) else os.path.dirname(os.path.abspath(__file__))
    if os.path.basename(base).lower() == "entregable":
        return os.path.dirname(base)
    return base


def puerto_libre(preferido: int = 8501) -> int:
    for p in list(range(preferido, preferido + 20)):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", p))
                return p
            except OSError:
                continue
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def abrir_navegador(url: str, puerto: int) -> None:
    for _ in range(120):
        try:
            with socket.create_connection(("127.0.0.1", puerto), timeout=1):
                break
        except OSError:
            time.sleep(0.5)
    time.sleep(1.5)
    webbrowser.open(url)


def main() -> None:
    trabajo = carpeta_trabajo()
    os.chdir(trabajo)
    os.makedirs("./Entregable/", exist_ok=True)
    recursos = carpeta_recursos()
    destino = "./Entregable/10_Data_Prueba.xlsx"
    origen = os.path.join(recursos, "10_Data_Prueba.xlsx")
    if not os.path.exists(destino) and os.path.exists(origen):
        shutil.copyfile(origen, destino)
    app = os.path.join(recursos, "canvas_app.py")
    puerto = puerto_libre()
    url = f"http://localhost:{puerto}"
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass
    print("=" * 66)
    print(f"  {TITULO} - Sistema Inteligente de Modelamiento de Negocios")
    print("=" * 66)
    print(f"  Carpeta de datos : {os.path.abspath('./Entregable/')}")
    print(f"  Direccion local  : {url}")
    print("  Usuario demo     : admin  /  Admin2026!")
    print("  El navegador se abrira automaticamente.")
    print("  NO cierre esta ventana mientras use el sistema.")
    print("=" * 66)
    threading.Thread(target=abrir_navegador, args=(url, puerto), daemon=True).start()
    from streamlit.web import cli as stcli

    sys.argv = [
        "streamlit", "run", app,
        "--global.developmentMode=false",
        f"--server.port={puerto}",
        "--server.address=127.0.0.1",
        "--server.headless=true",
        "--server.fileWatcherType=none",
        "--browser.gatherUsageStats=false",
        "--client.toolbarMode=viewer",
        "--theme.base=light",
        "--theme.primaryColor=#1D70B8",
    ]
    sys.exit(stcli.main())


if __name__ == "__main__":
    main()
