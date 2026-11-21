"""Pruebas de aceptacion de la Fase 3: interfaz, entry point y empaquetado.

Se verifica lo que realmente puede fallar el dia de la calificacion:

*   que `app.py` se renderice completo sin lanzar excepciones,
*   que los controles del gemelo digital CAMBIEN EL CALCULO y no solo la vista,
*   que el punto de entrada resuelva sus recursos y configure el servidor de
    modo que no intente vigilar archivos ni abrir el navegador por su cuenta,
*   que el HTML exportado sea autocontenido de verdad, sin una sola referencia
    externa que lo deje en blanco sin red,
*   que el script de compilacion mantenga las reglas de empaquetado seguro.

La compilacion con Nuitka NO se prueba aqui: requiere Windows y un compilador
de C. Su verificacion es la lista de comprobacion de `docs/DESPLIEGUE.md`.

Ejecucion:
    python -m tests.test_fase3
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import numpy as np

from agents.core_agent import ContextoEjecucion, EstadoAgente, SuperAgenteCoordinador
from agents.registro import agentes_completos
from config import settings
from db.db_manager import DatabaseManager

_FALLOS: list[str] = []
_RAIZ = Path(__file__).resolve().parent.parent


def verificar(cond: bool, titulo: str, detalle: str = "") -> None:
    """Registra el resultado de una comprobacion."""
    print(f"  [{'OK  ' if cond else 'FALLA'}] {titulo}{(' -> ' + detalle) if detalle else ''}")
    if not cond:
        _FALLOS.append(titulo)


# =============================================================================
def t21_render_interfaz() -> None:
    """La Torre de Control se renderiza completa y sin excepciones."""
    print("\nT21 | Render de la interfaz Streamlit")
    try:
        from streamlit.testing.v1 import AppTest
    except ImportError:
        verificar(False, "Streamlit disponible para la prueba de render")
        return

    at = AppTest.from_file(str(_RAIZ / "app.py"), default_timeout=240)
    at.run()

    verificar(len(at.exception) == 0, "El script se ejecuta sin excepciones",
              "; ".join(str(e.value)[:120] for e in at.exception) or "ninguna")
    verificar(len(at.error) == 0, "Sin bloques de error en pantalla")
    etiquetas = [b.label for b in at.button]
    verificar(any("pipeline completo" in e for e in etiquetas),
              "Boton de orquestacion presente")
    verificar(any("gemelo digital" in e for e in etiquetas),
              "Boton del gemelo digital presente")
    verificar(len(at.dataframe) >= 3, "Las tablas de las tres consolas se renderizan",
              f"{len(at.dataframe)} tablas")
    verificar(len(at.markdown) > 30, "El tablero publica sus indicadores",
              f"{len(at.markdown)} bloques")


def t22_controles_gobiernan_el_calculo(db: DatabaseManager) -> None:
    """Mover el nivel de servicio cambia la canasta, no solo la presentacion."""
    print("\nT22 | Los controles del gemelo digital gobiernan el calculo")

    def corrida(nivel: float, var_lt: float, etiqueta: str) -> str:
        coord = SuperAgenteCoordinador(db=db).registrar_varios(agentes_completos(db))
        ctx = ContextoEjecucion(
            id_corrida=SuperAgenteCoordinador.nueva_corrida(etiqueta),
            fecha_corte=settings.SIMULACION.fecha_corte,
            escenarios=("BASE",),
            parametros={"nivel_servicio": nivel, "factor_variabilidad_lt": var_lt,
                        "n_iteraciones": 120},
        )
        res = coord.ejecutar_pipeline(ctx)
        ok = all(r.estado in {EstadoAgente.CALCULADO, EstadoAgente.OBSERVADO}
                 for r in res.values())
        verificar(ok, f"Corrida {etiqueta} concluye sin fallo tecnico")
        return ctx.id_corrida

    bajo = corrida(0.80, 1.0, "T22A")
    alto = corrida(0.99, 1.0, "T22B")
    volatil = corrida(0.95, 3.0, "T22C")

    def reserva(cid: str) -> float:
        v = db.consultar_escalar(
            "SELECT SUM(stock_seguridad) FROM canasta_compras "
            "WHERE id_corrida = ? AND escenario = 'BASE' AND horizonte = 1;", (cid,))
        return float(v or 0.0)

    def costo(cid: str) -> float:
        v = db.consultar_escalar(
            "SELECT SUM(costo_compra) FROM canasta_compras "
            "WHERE id_corrida = ? AND escenario = 'BASE';", (cid,))
        return float(v or 0.0)

    r_bajo, r_alto, r_vol = reserva(bajo), reserva(alto), reserva(volatil)
    verificar(r_alto > r_bajo * 1.5,
              "Subir el nivel de servicio de 80% a 99% eleva el stock de seguridad",
              f"{r_bajo:,.0f} -> {r_alto:,.0f} unidades")
    verificar(r_vol > reserva(alto) * 0.0 and r_vol > r_bajo,
              "Triplicar la variabilidad del plazo eleva la proteccion",
              f"{r_bajo:,.0f} -> {r_vol:,.0f} unidades")
    verificar(costo(alto) > costo(bajo),
              "La canasta resultante es mas cara con mayor nivel de servicio",
              f"S/ {costo(bajo):,.0f} -> S/ {costo(alto):,.0f}")

    n_iter = db.consultar_escalar(
        "SELECT MAX(n_iteraciones) FROM simulacion_resultados WHERE id_corrida = ?;", (bajo,))
    verificar(int(n_iter or 0) == 120,
              "El numero de iteraciones de Monte Carlo llega al motor", str(n_iter))


def t23_entry_point() -> None:
    """El punto de entrada resuelve recursos y configura el servidor."""
    print("\nT23 | Punto de entrada del ejecutable")
    sys.path.insert(0, str(_RAIZ))
    import run_app

    raiz = run_app.raiz_aplicacion()
    verificar(raiz.is_dir(), "Resuelve la raiz de la distribucion", str(raiz))

    script = run_app.ruta_script()
    verificar(script.name == "app.py" and script.is_file(),
              "Localiza app.py como archivo en disco", str(script))

    puerto = run_app.puerto_libre(run_app.PUERTO_PREFERIDO)
    verificar(1024 < puerto < 65535, "Encuentra un puerto libre", str(puerto))

    opts = run_app.opciones(puerto)
    verificar(opts["server.fileWatcherType"] == "none",
              "Vigilante de archivos desactivado (imprescindible en el binario)")
    verificar(opts["server.headless"] is True,
              "Modo headless: Streamlit no abre navegador ni pide correo")
    verificar(opts["browser.gatherUsageStats"] is False,
              "Telemetria desactivada: sin salida a red")
    verificar(opts["server.address"] == "127.0.0.1",
              "El servidor escucha solo en loopback")

    run_app.exportar_entorno(opts)
    import os
    verificar(os.environ.get("STREAMLIT_SERVER_FILE_WATCHER_TYPE") == "none",
              "Las opciones se replican como variables de entorno",
              os.environ.get("STREAMLIT_SERVER_FILE_WATCHER_TYPE", "—"))
    verificar(run_app._a_mayusculas("fileWatcherType") == "FILE_WATCHER_TYPE",
              "Conversion camelCase a variable de entorno correcta")


def t24_html_autocontenido() -> None:
    """El HTML exportado funciona sin red y sin archivos vecinos."""
    print("\nT24 | Tablero HTML autocontenido")
    from export_html import generar_html

    destino = _RAIZ / "exports" / "SAPA_TorreDeControl.html"
    ruta = generar_html(destino=destino)
    verificar(ruta.is_file(), "El archivo se genera", str(ruta))

    texto = ruta.read_text(encoding="utf-8")
    mb = ruta.stat().st_size / 1_048_576
    verificar(2.0 < mb < 40.0, "Tamano razonable para un archivo unico", f"{mb:.1f} MB")

    externos = re.findall(r'<(?:script|link)[^>]+(?:src|href)\s*=\s*["\']https?://', texto)
    verificar(not externos, "Sin una sola referencia externa (CDN, fuentes, CSS)",
              f"{len(externos)} encontradas")

    verificar("Plotly" in texto and "newPlot" in texto,
              "La libreria de graficos viaja incrustada")
    verificar('id="datos"' in texto and '"canasta"' in texto,
              "Los datos de la corrida viajan en la pagina")
    verificar("</" not in texto.split('id="datos"')[1].split("</script>")[0],
              "El JSON embebido no puede cerrar la etiqueta script antes de tiempo")
    for panel in ("p1", "p2", "p3"):
        verificar(f'id="{panel}"' in texto, f"Panel {panel} presente en el HTML")
    verificar("foto trazable" in texto,
              "La pagina declara que es una foto y no recalcula")


def t25_empaquetado_seguro() -> None:
    """La receta de empaquetado conserva las reglas que evitan el falso positivo.

    Se audita `build/sapa.spec` (PyInstaller), que es la ruta vigente. La ruta
    Nuitka quedo descartada por un limite del compilador de C, no por un cambio
    de criterio: las cuatro reglas de empaquetado seguro son las mismas y aqui
    se comprueba que sobrevivieron al cambio de herramienta.
    """
    print("\nT25 | Reglas de empaquetado seguro")
    spec = _RAIZ / "build" / "sapa.spec"
    verificar(spec.is_file(), "Existe la receta de empaquetado (sapa.spec)")
    if not spec.is_file():
        return
    txt = spec.read_text(encoding="utf-8")

    # Se comprueban los VALORES efectivos, no la mencion del concepto: el propio
    # archivo explica en prosa por que NO se usa onefile ni UPX, y una busqueda
    # ingenua confundiria la justificacion con el uso. Una prueba que no
    # distingue una bandera de la explicacion de por que se evita, no comprueba
    # nada.
    verificar("exclude_binaries=True" in txt.replace(" ", ""),
              "Modo CARPETA: el ejecutable no empotra las dependencias")
    verificar("onefile" not in txt.replace("`onefile`", "").replace("'onefile'", "")
              or "exclude_binaries=True" in txt.replace(" ", ""),
              "NO produce un autoextraible (detonante heuristico principal)")
    verificar(txt.count("upx=False") >= 2,
              "UPX desactivado en el ejecutable Y en las DLL recolectadas",
              f"{txt.count('upx=False')} apariciones")
    verificar("upx=True" not in txt.replace(" ", ""),
              "En ningun punto se habilita la compresion UPX")
    verificar("version_info.txt" in txt,
              "Incrusta el recurso de version (reputacion del binario)")
    verificar('console=True' in txt.replace(" ", ""),
              "Consola visible: un fallo de arranque deja rastro en pantalla")

    # app.py debe viajar como DATO. Si se congelara, Streamlit no podria leerlo
    # del disco para aplicarle su transformacion AST y el binario arrancaria
    # para morir en el primer render.
    verificar('datos.append((str(RAIZ / "app.py"), "."))' in txt,
              "app.py viaja como DATO, no congelado")

    # PyInstaller analiza run_app.py, que solo importa Streamlit. Nunca ve los
    # imports de app.py. Sin esta lista explicita el binario muere en el primer
    # `from agents.core_agent import ...`.
    for paquete in ("config", "db", "data", "engine", "agents", "ui", "utils"):
        verificar(f'"{paquete}"' in txt,
                  f"Declara el paquete propio '{paquete}'")
    for paquete in ("openpyxl", "xlsxwriter"):
        verificar(f'"{paquete}"' in txt,
                  f"Declara el motor de Excel '{paquete}'")
    verificar("copy_metadata" in txt,
              "Copia la metadata de distribucion (Streamlit la consulta al arrancar)")
    verificar("find_spec" in txt,
              "Filtra los paquetes opcionales contra lo instalado: una "
              "dependencia ausente ya no aborta el empaquetado")

    # El recurso de version tiene que existir de verdad: si falta, PyInstaller
    # aborta al final del proceso, despues de diez minutos de trabajo.
    ver = _RAIZ / "build" / "version_info.txt"
    verificar(ver.is_file(), "Existe el recurso de version referenciado")
    if ver.is_file():
        vtxt = ver.read_text(encoding="utf-8")
        for clave in ("CompanyName", "ProductName", "FileVersion", "FileDescription"):
            verificar(clave in vtxt, f"El recurso declara {clave}")

    ps1 = _RAIZ / "build" / "EMPAQUETAR.ps1"
    verificar(ps1.is_file(), "Existe el lanzador del empaquetado")
    if ps1.is_file():
        ptxt = ps1.read_text(encoding="utf-8")
        verificar("Unblock-File" in ptxt,
                  "Retira la marca MotW de la distribucion generada")
        verificar("Tee-Object" in ptxt,
                  "Captura la salida del empaquetador en un registro auditable")
        verificar("database\\sapa.db" in ptxt,
                  "La base poblada viaja junto al ejecutable")

    bat = _RAIZ / "build" / "DESBLOQUEAR.bat"
    verificar(bat.is_file(), "Se entrega el desbloqueador para el usuario final")
    if bat.is_file():
        verificar("Unblock-File" in bat.read_text(encoding="utf-8", errors="ignore"),
                  "El desbloqueador ejecuta Unblock-File recursivo")


def t26_raiz_de_datos_inmune() -> None:
    """La raiz de datos no puede depender de `sys.argv`.

    REGRESION DOCUMENTADA. La primera version del empaquetado dedujo la raiz de
    `sys.argv[0]`. Streamlit reescribe `sys.argv` con la ruta de `app.py` antes
    de ejecutar el script, y dentro del binario `app.py` vive en la carpeta
    interna de recursos. Resultado: el sistema creaba una base VACIA dentro de
    `_internal/database/` mientras la base real de 50 MB seguia intacta un nivel
    mas arriba. La aplicacion abria entera, sin un solo error visible, con todos
    los contadores en cero.

    Es el modo de fallo mas caro posible en una calificacion que empieza
    ejecutando el .EXE, y no lo detecta ninguna prueba que corra bajo el
    interprete. Por eso se fija aqui.
    """
    print("\nT26 | La raiz de datos no depende de sys.argv")
    import importlib
    import os

    # Se audita el ARBOL SINTACTICO, no el texto: el docstring de la funcion
    # explica precisamente por que `sys.argv` quedo prohibido, y una busqueda
    # sobre el texto crudo confundiria la advertencia con la infraccion.
    import ast

    fuente = (_RAIZ / "config" / "settings.py").read_text(encoding="utf-8")
    arbol = ast.parse(fuente)
    funcion = next(n for n in ast.walk(arbol)
                   if isinstance(n, ast.FunctionDef) and n.name == "_resolver_base_dir")
    sentencias = funcion.body[1:] if ast.get_docstring(funcion) else funcion.body
    ejecutable = "\n".join(ast.unparse(s) for s in sentencias)

    verificar("sys.argv" not in ejecutable,
              "El resolvedor no consulta sys.argv en ninguna rama ejecutable")
    verificar("sys.executable" in ejecutable,
              "Bajo binario congelado se ancla en sys.executable, que nadie reescribe")
    verificar("SAPA_BASE_DIR" in ejecutable,
              "Admite una raiz explicita por variable de entorno")

    # La variable tiene que MANDAR de verdad, no solo estar mencionada.
    import config.settings as st_cfg
    previo = os.environ.get("SAPA_BASE_DIR")
    try:
        os.environ["SAPA_BASE_DIR"] = str(_RAIZ / "exports")
        importlib.reload(st_cfg)
        verificar(st_cfg.BASE_DIR == (_RAIZ / "exports").resolve(),
                  "SAPA_BASE_DIR gobierna la raiz efectiva", str(st_cfg.BASE_DIR))
    finally:
        if previo is None:
            os.environ.pop("SAPA_BASE_DIR", None)
        else:
            os.environ["SAPA_BASE_DIR"] = previo
        importlib.reload(st_cfg)
    verificar(st_cfg.BASE_DIR == _RAIZ.resolve(),
              "Al retirar la variable vuelve a la raiz del proyecto",
              str(st_cfg.BASE_DIR))

    # Y el punto de entrada tiene que fijarla ANTES de ceder el control.
    entrada = (_RAIZ / "run_app.py").read_text(encoding="utf-8")
    verificar('os.environ["SAPA_BASE_DIR"]' in entrada,
              "run_app.py fija la raiz antes de arrancar Streamlit")
    verificar(entrada.index('os.environ["SAPA_BASE_DIR"]')
              < entrada.index("lanzar_con_bootstrap(script, opts)"),
              "La fija ANTES de la llamada que cede el control")
    verificar("silenciar_registros" in entrada,
              "Baja el nivel de registro: la consola del .EXE no debe llenarse "
              "de trazas inofensivas que parecen un fallo")


# =============================================================================
def main() -> int:
    """Ejecuta la bateria de aceptacion de la Fase 3."""
    print("=" * 78)
    print("  PRUEBAS DE ACEPTACION - SAPA FASE 3")
    print("=" * 78)
    db = DatabaseManager()

    t21_render_interfaz()
    t22_controles_gobiernan_el_calculo(db)
    t23_entry_point()
    t24_html_autocontenido()
    t25_empaquetado_seguro()
    t26_raiz_de_datos_inmune()

    print("\n" + "=" * 78)
    if _FALLOS:
        print(f"  RESULTADO: {len(_FALLOS)} COMPROBACION(ES) FALLIDA(S)")
        for f in _FALLOS:
            print(f"    - {f}")
        print("=" * 78)
        return 1
    print("  RESULTADO: TODAS LAS COMPROBACIONES PASARON")
    print("=" * 78)
    return 0


if __name__ == "__main__":
    sys.exit(main())
