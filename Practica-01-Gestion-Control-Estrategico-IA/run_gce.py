# -*- coding: utf-8 -*-
"""
run_gce.py - Lanzador de 7_GCE_IA.exe.

* Fija GCE_BASE_DIR = carpeta del EXE (Entregable/), donde se guardan gce_ia.db y los reportes.
* Busca un puerto libre, inicia Streamlit en modo local (127.0.0.1) y abre el navegador.
* Funciona igual si se ejecuta con Python:  python run_gce.py
"""
import sys
sys.dont_write_bytecode = True  # carpeta única: no crear __pycache__ en Entregable/
import os
import socket
import threading
import time
import webbrowser
from pathlib import Path


def carpeta_sistema() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def carpeta_recursos() -> Path:
    # PyInstaller descomprime los .py empaquetados en sys._MEIPASS
    return Path(getattr(sys, "_MEIPASS", carpeta_sistema()))


def puerto_libre(preferido: int = 8501) -> int:
    for p in list(range(preferido, preferido + 30)):
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
    for _ in range(120):                       # espera hasta 60 s a que el servidor responda
        try:
            with socket.create_connection(("127.0.0.1", puerto), timeout=0.5):
                break
        except OSError:
            time.sleep(0.5)
    if os.environ.get("GCE_NO_BROWSER") != "1":
        webbrowser.open(url)


def main() -> int:
    base, recursos = carpeta_sistema(), carpeta_recursos()
    os.environ["GCE_BASE_DIR"] = str(base)
    os.chdir(base)
    sys.path.insert(0, str(recursos))
    puerto = int(os.environ.get("GCE_PUERTO", 0)) or puerto_libre()
    url = f"http://localhost:{puerto}"
    print("=" * 64)
    print("  GESTION Y CONTROL ESTRATEGICO IA")
    print(f"  Carpeta del sistema : {base}")
    print(f"  Abra en su navegador: {url}")
    print("  Para cerrar el sistema cierre esta ventana (o Ctrl+C).")
    print("=" * 64)
    threading.Thread(target=abrir_navegador, args=(url, puerto), daemon=True).start()

    from streamlit.web import cli as stcli
    sys.argv = [
        "streamlit", "run", str(recursos / "app.py"),
        "--global.developmentMode=false",
        "--server.headless=true",
        "--server.address=127.0.0.1",
        f"--server.port={puerto}",
        "--server.fileWatcherType=none",
        "--server.runOnSave=false",
        "--browser.gatherUsageStats=false",
        "--server.maxUploadSize=50",
        "--theme.base=light",
        "--client.toolbarMode=minimal",
        "--theme.primaryColor=#0E7C86",
    ]
    return stcli.main()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as ex:                    # deja el error visible en la consola del EXE
        import traceback
        traceback.print_exc()
        input(f"\nError al iniciar: {ex}\nPresione Enter para cerrar...")
        sys.exit(1)
