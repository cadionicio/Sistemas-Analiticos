"""PC08.exe · ventana propia de aplicación (WebView2), sin consola ni navegador externo."""
import logging
import os
import sys

from pc08 import config


def _registro():
    carpeta = config.carpeta_app() / "registros"
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
        sys.stderr = open(carpeta / "errores.log", "a", encoding="utf-8")
    logging.basicConfig(filename=carpeta / "pc08.log", level=logging.INFO, encoding="utf-8",
                        format="%(asctime)s %(levelname)s %(message)s")


def _mensaje(texto, icono=0x10):
    logging.getLogger("pc08").warning(texto)
    if os.name == "nt":
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, texto, config.TITULO, icono)
    else:
        print(texto, file=sys.stderr)


def _traer_ventana_existente():
    """Si ya hay una ventana abierta, la muestra al frente y devuelve True. Un proceso sin ventana no bloquea el inicio."""
    if os.name != "nt":
        return False
    import ctypes
    u32 = ctypes.windll.user32
    hwnd = u32.FindWindowW(None, config.TITULO)
    if not hwnd:
        return False
    u32.ShowWindow(hwnd, 9)  # SW_RESTORE
    u32.SetForegroundWindow(hwnd)
    return True


def main():
    _registro()
    log = logging.getLogger("pc08")
    if _traer_ventana_existente():
        log.info("Ventana existente llevada al frente")
        return 0
    try:
        from pc08.db import migrar, Almacen
        from pc08.puente import Puente
        esquema = migrar()
        from pc08.db import conectar
        con = conectar()
        try:  # cada apertura comienza con «Datos de demostración» activo (decisión de evaluación)
            con.execute("UPDATE configuracion SET valor = 'DEMO' WHERE clave = 'modo'")
        finally:
            con.close()
        puente = Puente(Almacen())
        import webview
    except Exception as e:  # noqa: BLE001
        logging.exception("Fallo al iniciar")
        _mensaje(f"No se pudo iniciar la aplicación: {e}\n\nRegistro: {config.carpeta_app() / 'registros'}")
        return 1
    log.info("Inicio v%s esquema %s base %s", config.VERSION, esquema, config.base_datos())
    ventana = webview.create_window(config.TITULO, url=str(config.WEB_DIR / "index.html"), js_api=puente,
                                    width=1440, height=880, min_size=(1024, 680), background_color="#F5F8FC")
    ventana.events.closed += lambda: (log.info("Ventana cerrada: fin del proceso"), logging.shutdown(), os._exit(0))
    try:
        webview.start(http_server=True, private_mode=True, gui="edgechromium" if os.name == "nt" else None,
                      storage_path=str(config.carpeta_app() / "datos" / "webview"))
    except Exception as e:  # noqa: BLE001
        logging.exception("Fallo de la ventana")
        _mensaje("No se pudo abrir la ventana de la aplicación. Verifique que Microsoft Edge WebView2 Runtime esté instalado "
                 f"(viene con Windows 11).\n\nDetalle: {e}")
        return 1
    logging.shutdown()
    os._exit(0)  # garantiza que no quede un proceso en segundo plano al cerrar la ventana


if __name__ == "__main__":
    sys.exit(main())
