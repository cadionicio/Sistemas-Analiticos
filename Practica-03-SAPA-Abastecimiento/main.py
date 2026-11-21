"""Punto de entrada del SAPA - Fase 1.

Bootstrap por linea de comandos. En la Fase 3 este mismo archivo levantara la
interfaz Streamlit; hoy expone las operaciones de datos y la corrida del
superagente para que el desarrollo sea verificable sin UI.

Uso:
    python main.py generar        # regenera el dataset sintetico completo
    python main.py diagnostico    # estado de la base
    python main.py correr         # ejecuta el pipeline del superagente
    python main.py exportar-ddl   # vuelca el esquema a docs/esquema.sql
    python main.py exportar-html  # tablero HTML autocontenido
    python main.py plantillas     # libro de plantillas de carga
    python main.py exportar-excel # data de prueba a Excel
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime

import pandas as pd

from agents.core_agent import (ContextoEjecucion, EstadoAgente,
                               SuperAgenteCoordinador)
from agents.registro import agentes_completos
from config import settings
from data.data_generator import GeneradorDataSintetica
from db.db_manager import DatabaseManager, ErrorBaseDatos
from db.schema_ddl import exportar_sql
from data.importador import exportar_datos, generar_plantillas
from export_html import generar_html
from utils.logger import obtener_logger

_log = obtener_logger("main")

pd.set_option("display.width", 160)
pd.set_option("display.max_columns", 40)


def _banner() -> None:
    """Imprime la cabecera del aplicativo."""
    print("=" * 78)
    print(f"  {settings.APP_TITULO}  [{settings.APP_NOMBRE} v{settings.APP_VERSION}]")
    print(f"  Base de datos: {settings.DB_PATH}")
    print("=" * 78)


def cmd_generar(args: argparse.Namespace) -> int:
    """Regenera el dataset sintetico completo.

    Returns:
        int: codigo de salida del proceso.
    """
    db = DatabaseManager()
    gen = GeneradorDataSintetica(db=db, semilla=args.semilla)
    t0 = datetime.now()
    conteos = gen.generar(forzar=True)
    db.compactar()
    print("\nFilas generadas por tabla:")
    for tabla, n in conteos.items():
        print(f"  {tabla:.<32}{n:>10,}")
    print(f"\nDuracion total: {(datetime.now() - t0).total_seconds():.1f}s")
    return 0


def cmd_diagnostico(_: argparse.Namespace) -> int:
    """Muestra el estado operativo de la base de datos."""
    info = DatabaseManager().diagnostico()
    print(f"\nIntegridad......: {info.get('integrity_check')}")
    print(f"Journal mode....: {info.get('journal_mode')}")
    print(f"Foreign keys....: {info.get('foreign_keys')}")
    print(f"Violaciones FK..: {info.get('fk_violaciones')}")
    print(f"Tamano (MB).....: {info.get('tamano_mb')}")
    print("\nConteos por tabla:")
    for tabla, n in (info.get("conteos") or {}).items():
        print(f"  {tabla:.<32}{n:>10,}")
    print(f"\nEstado global: {'OK' if info.get('ok') else 'CON OBSERVACIONES'}")
    return 0 if info.get("ok") else 1


def cmd_correr(args: argparse.Namespace) -> int:
    """Ejecuta el pipeline del superagente sobre el dataset cargado."""
    coordinador = SuperAgenteCoordinador()
    coordinador.registrar_varios(agentes_completos())

    print("\nAgentes registrados:")
    print(coordinador.estado_registro().to_string(index=False))

    contexto = ContextoEjecucion(
        id_corrida=SuperAgenteCoordinador.nueva_corrida(),
        fecha_corte=args.corte,
        horizonte_meses=args.horizonte,
        escenarios=("BASE", "DEMANDA_ALTA", "DISRUPCION"),
        usuario="director_proyecto",
    )
    resultados = coordinador.ejecutar_pipeline(contexto)

    print("\nResultados por agente:")
    for nombre, r in resultados.items():
        print(f"  {nombre:.<26}{r.estado.value:<14}{r.duracion_seg:>7.3f}s  {r.mensaje}")

    tablero = coordinador.tablero(contexto.id_corrida)
    if not tablero.empty:
        print("\nMetricas publicadas:")
        print(tablero[["tipo_analisis", "metrica", "valor"]].to_string(index=False))

    exc = coordinador.excepciones(contexto.id_corrida)
    if not exc.empty:
        print(f"\nExcepciones abiertas ({len(exc)}):")
        print(exc.head(12).to_string(index=False))

    # CODIGO DE SALIDA HONESTO.
    #
    # Devolver 0 pase lo que pase convierte este comando en inservible dentro
    # de un guion. Ocurrio de verdad: el pipeline termino FALLIDA por un fallo
    # de esquema, el .bat de cierre de entrega leyo errorlevel 0 y siguio
    # adelante empaquetando un ejecutable cuya base traia una corrida rota.
    #
    #   0  la corrida concluyo, con o sin excepciones abiertas (OBSERVADA es un
    #      resultado valido: hay decisiones pendientes, no un fallo tecnico).
    #   1  algun agente fallo o quedo omitido; lo que sigue no debe ejecutarse.
    fallidos = [n for n, r in resultados.items()
                if r.estado in (EstadoAgente.FALLIDO, EstadoAgente.OMITIDO,
                                EstadoAgente.BLOQUEADO)]
    if fallidos:
        print(f"\n[ERROR] Agentes sin completar: {', '.join(fallidos)}")
        print("[ERROR] La corrida NO es utilizable. Revise logs/sapa.log.")
        return 1
    return 0


def cmd_exportar_ddl(_: argparse.Namespace) -> int:
    """Vuelca el DDL embebido a docs/esquema.sql."""
    destino = exportar_sql(settings.BASE_DIR / "docs" / "esquema.sql")
    print(f"Esquema exportado a: {destino}")
    return 0


def cmd_exportar_html(_: argparse.Namespace) -> int:
    """Genera la Torre de Control en HTML autocontenido."""
    destino = generar_html()
    print(f"Tablero HTML generado: {destino}")
    print(f"Tamano: {destino.stat().st_size / 1_048_576:.1f} MB")
    return 0


def cmd_plantillas(_: argparse.Namespace) -> int:
    """Genera el libro de plantillas de carga."""
    destino = generar_plantillas()
    print(f"Plantillas generadas: {destino}")
    return 0


def cmd_exportar_excel(_: argparse.Namespace) -> int:
    """Exporta la data actual a Excel (entregable de data de prueba)."""
    destino = exportar_datos(db=DatabaseManager())
    print(f"Data de prueba exportada: {destino}")
    print(f"Tamano: {destino.stat().st_size / 1_048_576:.1f} MB")
    return 0


def construir_parser() -> argparse.ArgumentParser:
    """Define la interfaz de linea de comandos."""
    p = argparse.ArgumentParser(prog="sapa", description=settings.APP_TITULO)
    sub = p.add_subparsers(dest="comando", required=True)

    g = sub.add_parser("generar", help="Regenera el dataset sintetico")
    g.add_argument("--semilla", type=int, default=None, help="Semilla PCG64")
    g.set_defaults(func=cmd_generar)

    d = sub.add_parser("diagnostico", help="Estado de la base de datos")
    d.set_defaults(func=cmd_diagnostico)

    c = sub.add_parser("correr", help="Ejecuta el pipeline del superagente")
    c.add_argument("--corte", default=settings.SIMULACION.fecha_corte)
    c.add_argument("--horizonte", type=int, default=settings.INVENTARIO.horizonte_meses)
    c.set_defaults(func=cmd_correr)

    e = sub.add_parser("exportar-ddl", help="Exporta el esquema a .sql")
    e.set_defaults(func=cmd_exportar_ddl)

    hh = sub.add_parser("exportar-html", help="Genera el tablero HTML autocontenido")
    hh.set_defaults(func=cmd_exportar_html)

    pl = sub.add_parser("plantillas", help="Genera el libro de plantillas de carga")
    pl.set_defaults(func=cmd_plantillas)

    xl = sub.add_parser("exportar-excel", help="Exporta la data actual a Excel")
    xl.set_defaults(func=cmd_exportar_excel)
    return p


def main(argv: list[str] | None = None) -> int:
    """Punto de entrada.

    Returns:
        int: codigo de salida (0 = exito).
    """
    _banner()
    args = construir_parser().parse_args(argv)
    try:
        return int(args.func(args))
    except ErrorBaseDatos as exc:
        _log.error("Error de base de datos: %s", exc)
        print(f"\n[ERROR] {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\nInterrumpido por el usuario.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
