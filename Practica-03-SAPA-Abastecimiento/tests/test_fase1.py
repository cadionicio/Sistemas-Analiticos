"""Pruebas de verificacion de la Fase 1.

No son pruebas unitarias exhaustivas: son las PRUEBAS DE ACEPTACION que el
Director exige para dar por cerrada la fase. Cada una corresponde a un riesgo
concreto identificado en la auditoria del diseno.

Ejecucion:
    python -m tests.test_fase1
"""

from __future__ import annotations

import math
import sys
import threading

import numpy as np
import pandas as pd

from agents.core_agent import (
    AgenteControlDatos,
    ContextoEjecucion,
    EstadoAgente,
    SuperAgenteCoordinador,
    TipoAnalisis,
)
from config import settings
from data.data_generator import GeneradorDataSintetica
from db.db_manager import DatabaseManager, ErrorIntegridad

_FALLOS: list[str] = []


def verificar(condicion: bool, titulo: str, detalle: str = "") -> None:
    """Registra el resultado de una comprobacion."""
    marca = "OK  " if condicion else "FALLA"
    print(f"  [{marca}] {titulo}{(' -> ' + detalle) if detalle else ''}")
    if not condicion:
        _FALLOS.append(titulo)


# =============================================================================
def t01_singleton_y_concurrencia(db: DatabaseManager) -> None:
    """El Singleton es unico y cada hilo obtiene su propia conexion."""
    print("\nT01 | Singleton y aislamiento de conexiones por hilo")
    verificar(DatabaseManager() is db, "DatabaseManager devuelve siempre la misma instancia")

    n_hilos = 6
    ids: list[int] = []
    errores: list[str] = []
    cerrojo = threading.Lock()
    # Barrera: obliga a que los seis hilos mantengan su conexion VIVA al mismo
    # tiempo. Sin ella, un hilo que termina libera su conexion y CPython puede
    # reutilizar la direccion de memoria, produciendo un falso negativo.
    barrera = threading.Barrier(n_hilos, timeout=15)

    def _trabajo() -> None:
        try:
            con = DatabaseManager().conexion
            DatabaseManager().consultar_escalar("SELECT COUNT(*) FROM maestro_materiales;")
            with cerrojo:
                ids.append(id(con))
            barrera.wait()  # nadie suelta su conexion hasta que todos la tengan
        except Exception as exc:  # noqa: BLE001
            errores.append(f"{type(exc).__name__}: {exc}")
            try:
                barrera.abort()
            except Exception:  # noqa: BLE001
                pass

    hilos = [threading.Thread(target=_trabajo, name=f"w{i}") for i in range(n_hilos)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join()

    verificar(not errores, "Seis hilos consultan sin error de cross-thread", str(errores[:1]))
    # En modo normal cada hilo recibe su propia conexion. Si el sistema de
    # archivos obligo al modo exclusivo, hay UNA sola conexion compartida y
    # serializada, y eso es el comportamiento correcto, no un fallo.
    exclusivo = getattr(db, "_modo_exclusivo", False)
    esperadas = 1 if exclusivo else n_hilos
    verificar(len(set(ids)) == esperadas,
              "Una conexion por hilo, o una compartida en modo exclusivo",
              f"{len(set(ids))} conexiones para {n_hilos} hilos"
              f"{' (modo exclusivo)' if exclusivo else ''}")

    # WAL es lo deseable, pero un sistema de archivos de red o sincronizado no
    # lo admite y el gestor degrada a DELETE de forma deliberada. Exigir WAL
    # siempre convertiria una degradacion correcta en un fallo de prueba.
    modo = str(db.consultar_escalar("PRAGMA journal_mode;")).lower()
    degradado = getattr(db, "_journal_degradado", False)
    verificar(modo == "wal" or (degradado and modo == "delete"),
              "Journal en WAL, o degradado a DELETE de forma consciente",
              f"{modo}{' (degradado)' if degradado else ''}")
    verificar(bool(db.consultar_escalar("PRAGMA foreign_keys;")), "Claves foraneas activas")


def t02_integridad_esquema(db: DatabaseManager) -> None:
    """El esquema aplica realmente sus restricciones declarativas."""
    print("\nT02 | Restricciones declarativas del esquema")
    info = db.diagnostico()
    verificar(info["integrity_check"] == "ok", "quick_check integro")
    verificar(info["fk_violaciones"] == 0, "Sin violaciones de clave foranea")

    # Regla: material perecible no puede tener politica LIFO
    try:
        db.ejecutar(
            "INSERT INTO maestro_materiales (sku, descripcion, sector, categoria, unidad_base, "
            "unidad_compra, factor_conversion, costo_unitario, volumen_m3_unidad, peso_kg_unidad, "
            "unidades_por_palet, tipo_almacenamiento, politica_rotacion, vida_util_dias, "
            "score_impacto_economico, score_riesgo_suministro, segmento_kraljic, arquetipo_demanda) "
            "VALUES ('X-BAD','prueba','RETAIL','ABARROTES','UND','CAJA',1,10,0.01,1,100,"
            "'RACK_COMPACTO_DRIVE_IN','LIFO',90,0.5,0.5,'RUTINARIO','REGULAR');"
        )
        verificar(False, "Rechaza perecible con rotacion LIFO", "la insercion fue aceptada")
    except ErrorIntegridad:
        verificar(True, "Rechaza perecible con rotacion LIFO")

    # Regla: FK inexistente en ordenes_compra
    try:
        db.ejecutar(
            "INSERT INTO ordenes_compra (id_orden, sku, proveedor_id, fecha_necesidad, "
            "fecha_solicitud, estado_aprobacion_finanzas, cantidad_solicitada, precio_unitario, "
            "costo_total, estado_orden) VALUES "
            "('OC-BAD','NO-EXISTE','PRV999','2026-01-01','2026-01-01','APROBADA',10,5,50,'EMITIDA');"
        )
        verificar(False, "Rechaza orden con SKU y proveedor inexistentes")
    except ErrorIntegridad:
        verificar(True, "Rechaza orden con SKU y proveedor inexistentes")


def t03_volumen_y_cobertura(db: DatabaseManager) -> None:
    """El dataset tiene la profundidad y amplitud comprometidas."""
    print("\nT03 | Volumen y cobertura del dataset")
    n_sku = int(db.consultar_escalar("SELECT COUNT(*) FROM maestro_materiales;"))
    meses = int(db.consultar_escalar(
        "SELECT COUNT(DISTINCT substr(fecha,1,7)) FROM historico_demanda;"))
    dias = int(db.consultar_escalar("SELECT COUNT(DISTINCT fecha) FROM historico_demanda;"))
    filas = int(db.consultar_escalar("SELECT COUNT(*) FROM historico_demanda;"))

    verificar(n_sku == 50, "50 SKU en el maestro", str(n_sku))
    verificar(meses >= 36, "Al menos 36 meses de historia", f"{meses} meses")
    verificar(filas == n_sku * dias, "Panel completo sin huecos",
              f"{filas} = {n_sku} x {dias}")
    verificar(
        int(db.consultar_escalar("SELECT COUNT(*) FROM inventario_diario;")) == filas,
        "Inventario diario alineado con la demanda",
    )


def t04_lead_time_lognormal(db: DatabaseManager) -> None:
    """La parametrizacion log-normal reproduce la media objetivo."""
    print("\nT04 | Distribucion log-normal del lead time")
    rel = db.consultar_df(
        "SELECT sku, proveedor_id, lead_time_min_dias, lead_time_medio_dias, "
        "lead_time_sigma_dias, ln_mu, ln_sigma FROM sku_proveedor LIMIT 200;"
    )
    verificar(not rel.empty, "Existe parametria de lead time")

    # E[LT] = LT_min + exp(mu + sigma^2/2). Se comprueba analiticamente, no
    # por simulacion: si la conversion de momentos estuviera mal, el error
    # seria sistematico y este control lo detecta sin ruido muestral.
    errores = []
    for _, r in rel.iterrows():
        esperado = float(r["lead_time_min_dias"]) + math.exp(
            float(r["ln_mu"]) + 0.5 * float(r["ln_sigma"]) ** 2
        )
        errores.append(abs(esperado - float(r["lead_time_medio_dias"])))
    err_max = max(errores) if errores else 0.0
    verificar(err_max < 0.02, "E[LT] analitica coincide con lead_time_medio_dias",
              f"error maximo {err_max:.5f} dias")

    # Y una comprobacion empirica del sesgo que la parametrizacion evita
    rng = np.random.default_rng(7)
    fila = rel.iloc[0]
    muestra = float(fila["lead_time_min_dias"]) + rng.lognormal(
        mean=float(fila["ln_mu"]), sigma=float(fila["ln_sigma"]), size=200_000
    )
    desvio = abs(muestra.mean() - float(fila["lead_time_medio_dias"]))
    verificar(desvio < 0.15, "Media simulada coincide con la teorica",
              f"desvio {desvio:.4f} dias")
    verificar(muestra.min() >= float(fila["lead_time_min_dias"]),
              "Ningun lead time por debajo del minimo fisico")


def t05_censura_emergente(db: DatabaseManager) -> None:
    """La censura de demanda emerge de la dinamica, no se inyecta."""
    print("\nT05 | Censura de demanda emergente y coherente")
    df = db.consultar_df(
        "SELECT demanda_atendida, demanda_latente_sintetica, horas_sin_stock, "
        "flag_censura, demanda_perdida_estimada FROM historico_demanda;"
    )
    atendida = df["demanda_atendida"].to_numpy(float)
    latente = df["demanda_latente_sintetica"].to_numpy(float)
    censura = df["flag_censura"].to_numpy(int)

    verificar(bool(np.all(atendida <= latente + 1e-6)),
              "La venta observada nunca supera la demanda latente")
    verificar(bool(np.all((censura == 0) | (df["horas_sin_stock"].to_numpy(float) > 0))),
              "Todo dia censurado registra horas sin stock")

    tasa = float(censura.mean())
    verificar(0.005 < tasa < 0.45, "Tasa de censura en rango plausible", f"{tasa:.2%}")

    # La correccion debe reducir el sesgo respecto de usar la venta cruda.
    perdida_est = df["demanda_perdida_estimada"].fillna(0).to_numpy(float)
    sesgo_crudo = abs(atendida.sum() - latente.sum()) / latente.sum()
    sesgo_corr = abs((atendida + perdida_est).sum() - latente.sum()) / latente.sum()
    verificar(sesgo_corr < sesgo_crudo,
              "La correccion de censura reduce el sesgo agregado",
              f"crudo {sesgo_crudo:.2%} -> corregido {sesgo_corr:.2%}")


def t06_friccion_organizacional(db: DatabaseManager) -> None:
    """La fraccion de ordenes con retraso de Finanzas esta en el rango exigido."""
    print("\nT06 | Friccion organizacional y atribucion de causa raiz")
    total = int(db.consultar_escalar("SELECT COUNT(*) FROM ordenes_compra;"))
    con_friccion = int(db.consultar_escalar(
        "SELECT COUNT(*) FROM ordenes_compra WHERE dias_retraso_aprobacion > 0;"))
    prop = con_friccion / max(total, 1)
    verificar(0.13 <= prop <= 0.23, "Entre 15% y 20% (tolerancia muestral) de OC con "
              "retraso imputable a Finanzas", f"{prop:.2%} de {total:,} OC")

    causas = db.consultar_df("SELECT * FROM v_causa_raiz_retrasos;")
    verificar(len(causas) >= 3, "La vista de causa raiz discrimina varios origenes",
              ", ".join(causas["causa_raiz_retraso"].tolist()))

    # El retraso total debe ser exactamente la suma de sus dos tramos.
    desajuste = int(db.consultar_escalar(
        "SELECT COUNT(*) FROM ordenes_compra "
        "WHERE ABS(dias_retraso_total - (dias_retraso_aprobacion + dias_retraso_proveedor)) > 0.001;"
    ))
    verificar(desajuste == 0, "retraso_total = retraso_aprobacion + retraso_proveedor",
              f"{desajuste} desajustes")

    bloqueos = int(db.consultar_escalar(
        "SELECT COUNT(*) FROM ordenes_compra WHERE motivo_bloqueo_finanzas IS NOT NULL;"))
    verificar(bloqueos > 0, "Los bloqueos llevan motivo documentado", f"{bloqueos:,} OC")


def t07_balance_material(db: DatabaseManager) -> None:
    """La ecuacion de balance de inventario cuadra dia a dia."""
    print("\nT07 | Balance material del inventario")
    # stock_final = stock_inicial + recepciones - consumo - mermas
    desbalance = int(db.consultar_escalar(
        "SELECT COUNT(*) FROM inventario_diario "
        "WHERE ABS(stock_final - (stock_inicial + recepciones - consumo - mermas)) > 0.01;"
    ))
    verificar(desbalance == 0, "Balance diario exacto en todos los registros",
              f"{desbalance} filas descuadradas")

    negativos = int(db.consultar_escalar(
        "SELECT COUNT(*) FROM inventario_diario WHERE stock_final < 0;"))
    verificar(negativos == 0, "Sin inventario negativo")

    # La continuidad recursiva: el final de un dia es el inicial del siguiente.
    saltos = int(db.consultar_escalar(
        """
        SELECT COUNT(*) FROM (
            SELECT sku, fecha, stock_inicial,
                   LAG(stock_final) OVER (PARTITION BY sku ORDER BY fecha) AS prev_final
            FROM inventario_diario
        ) WHERE prev_final IS NOT NULL AND ABS(stock_inicial - prev_final) > 0.01;
        """
    ))
    verificar(saltos == 0, "Continuidad recursiva entre dias consecutivos",
              f"{saltos} discontinuidades")


def t08_segmentacion(db: DatabaseManager) -> None:
    """ABC, XYZ y Kraljic se derivan de datos, no de constantes."""
    print("\nT08 | Segmentacion estrategica derivada")
    mat = db.consultar_df(
        "SELECT sku, clase_abc, clase_xyz, segmento_kraljic, score_impacto_economico, "
        "score_riesgo_suministro, cv_demanda FROM maestro_materiales;"
    )
    verificar(mat["clase_abc"].notna().all(), "Todos los SKU tienen clase ABC")
    verificar(mat["clase_xyz"].notna().all(), "Todos los SKU tienen clase XYZ")
    verificar(mat["segmento_kraljic"].nunique() >= 3,
              "La matriz de Kraljic ocupa al menos 3 cuadrantes",
              ", ".join(sorted(mat["segmento_kraljic"].unique())))

    # Coherencia del cuadrante con sus dos scores (regla de corte en 0.50)
    def _cuadrante(r: pd.Series) -> str:
        alto_i = r["score_impacto_economico"] >= 0.50
        alto_r = r["score_riesgo_suministro"] >= 0.50
        if alto_i and alto_r:
            return "ESTRATEGICO"
        if alto_i:
            return "APALANCADO"
        if alto_r:
            return "CUELLO_DE_BOTELLA"
        return "RUTINARIO"

    coincide = (mat.apply(_cuadrante, axis=1) == mat["segmento_kraljic"]).all()
    verificar(bool(coincide), "El segmento es reproducible desde sus scores")

    clase_a = mat[mat["clase_abc"] == "A"]
    verificar(1 <= len(clase_a) <= 25, "La clase A es minoritaria (Pareto)",
              f"{len(clase_a)} de {len(mat)} SKU")


def t09_pipeline_superagente(db: DatabaseManager) -> None:
    """El coordinador ejecuta, ordena y persiste correctamente."""
    print("\nT09 | Pipeline del superagente")
    coord = SuperAgenteCoordinador(db=db)
    coord.registrar(AgenteControlDatos(db=db))

    ctx = ContextoEjecucion(
        id_corrida=SuperAgenteCoordinador.nueva_corrida("TEST"),
        fecha_corte="2026-09-30",
        escenarios=("BASE",),
    )
    resultados = coord.ejecutar_pipeline(ctx)
    res = resultados["control_datos"]

    verificar(res.estado in {EstadoAgente.CALCULADO, EstadoAgente.OBSERVADO},
              "El agente de control concluye correctamente", res.estado.value)
    verificar(res.tipo_analisis is TipoAnalisis.CONTROL, "Tipo de analisis correcto")
    verificar(len(res.metricas) >= 5, "Publica metricas al tablero", str(len(res.metricas)))

    tablero = coord.tablero(ctx.id_corrida)
    verificar(not tablero.empty, "Las metricas quedan persistidas y consultables",
              f"{len(tablero)} filas")

    estado = db.consultar_escalar(
        "SELECT estado FROM ejecuciones WHERE id_corrida = ?;", (ctx.id_corrida,))
    verificar(estado in {"CALCULADA", "OBSERVADA"}, "La corrida se cierra con estado valido",
              str(estado))

    # Deteccion de ciclos en el grafo de dependencias
    class _A(AgenteControlDatos):
        nombre = "ciclo_a"
        dependencias = ("ciclo_b",)

    class _B(AgenteControlDatos):
        nombre = "ciclo_b"
        dependencias = ("ciclo_a",)

    c2 = SuperAgenteCoordinador(db=db)
    c2.registrar(_A(db=db)).registrar(_B(db=db))
    try:
        c2._orden_ejecucion()
        verificar(False, "Detecta ciclos de dependencia entre agentes")
    except ValueError:
        verificar(True, "Detecta ciclos de dependencia entre agentes")


def t11_migracion_anclada_a_la_conexion() -> None:
    """La migracion aditiva no puede depender de que el llamador la invoque.

    REGRESION DOCUMENTADA. La migracion estaba ligada a `inicializar_esquema`,
    metodo que solo invoca el generador de datos. Cualquier otra via de entrada
    -la linea de comandos, la Torre de Control, el propio .EXE- abria una base
    antigua sin migrar y moria al primer INSERT sobre una columna nueva:

        ErrorEsquema: Columnas inexistentes en validacion_modelos:
                      ['mad', 'senal_rastreo']

    El fallo se manifesto en el equipo de destino, no en el de desarrollo, por
    la razon exacta que hace peligrosa esta clase de defecto: en desarrollo la
    base se regenera a menudo y la migracion se aplica de paso. Una migracion
    que depende de que el llamador se acuerde de llamarla no es una migracion.
    """
    print("\nT11 | La migracion aditiva se aplica sola al abrir la base")
    import ast
    import sqlite3
    import tempfile
    from pathlib import Path as _Path

    raiz = _Path(__file__).resolve().parent.parent
    fuente = (raiz / "db" / "db_manager.py").read_text(encoding="utf-8")
    arbol = ast.parse(fuente)
    abrir = next(n for n in ast.walk(arbol)
                 if isinstance(n, ast.FunctionDef) and n.name == "_abrir_conexion")
    cuerpo = "\n".join(ast.unparse(s) for s in abrir.body)
    verificar("_migrar_columnas" in cuerpo,
              "La migracion esta anclada a la apertura de conexion, no a un "
              "metodo que el llamador deba recordar")

    # Y debe FUNCIONAR sobre una base real a la que le faltan las columnas.
    with tempfile.TemporaryDirectory() as tmp:
        ruta = _Path(tmp) / "antigua.db"
        con = sqlite3.connect(ruta)
        con.executescript(
            "CREATE TABLE validacion_modelos ("
            " id_corrida TEXT NOT NULL, sku TEXT NOT NULL, modelo TEXT NOT NULL,"
            " tipo_corte TEXT NOT NULL, origen INTEGER NOT NULL,"
            " n_observaciones INTEGER NOT NULL, wape REAL, mase REAL,"
            " sesgo REAL, rmse REAL, cobertura REAL,"
            " es_referente INTEGER NOT NULL DEFAULT 0,"
            " seleccionado INTEGER NOT NULL DEFAULT 0, motivo_decision TEXT,"
            " PRIMARY KEY (id_corrida, sku, modelo, tipo_corte, origen));"
            "CREATE TABLE metadata_esquema (clave TEXT PRIMARY KEY,"
            " valor TEXT NOT NULL, fecha_actualizacion TEXT NOT NULL);"
            "INSERT INTO metadata_esquema VALUES ('version_esquema','2','2026-01-01');"
            "INSERT INTO metadata_esquema VALUES ('version_app','2.0.0-fase2','2026-01-01');"
        )
        con.commit(); con.close()

        previas = {f[1] for f in sqlite3.connect(ruta).execute(
            "PRAGMA table_info(validacion_modelos)")}
        verificar("mad" not in previas,
                  "Punto de partida: base sin las columnas nuevas",
                  f"{len(previas)} columnas")

        # El gestor es Singleton: se descarta la instancia viva para apuntar a
        # la base antigua, y se restaura al terminar para no contaminar las
        # pruebas siguientes.
        original = DatabaseManager._instancias.get(DatabaseManager)
        DatabaseManager.reiniciar_singleton()
        try:
            gestor = DatabaseManager(ruta_db=ruta)
            gestor.conexion                               # solo abrir la base
            despues = {f[1] for f in gestor.conexion.execute(
                "PRAGMA table_info(validacion_modelos)")}
            sello = dict(gestor.conexion.execute(
                "SELECT clave, valor FROM metadata_esquema").fetchall())
            gestor.cerrar_conexion_hilo()
        finally:
            DatabaseManager.reiniciar_singleton()
            if original is not None:
                DatabaseManager._instancias[DatabaseManager] = original

        for col in ("mad", "senal_rastreo"):
            verificar(col in despues,
                      f"Abrir la base basta para incorporar '{col}'")
        verificar(sello.get("version_esquema") == str(settings.ESQUEMA_VERSION),
                  "La migracion resella la version de esquema en la propia base",
                  f"metadata_esquema dice {sello.get('version_esquema')!r}")
        verificar(sello.get("version_app") == settings.APP_VERSION,
                  "La migracion resella la version de aplicacion",
                  f"metadata_esquema dice {sello.get('version_app')!r}")
        verificar(previas.issubset(despues),
                  "La migracion es aditiva: no se pierde ninguna columna previa",
                  f"{len(previas)} -> {len(despues)} columnas")


def t10_reproducibilidad() -> None:
    """La misma semilla produce exactamente el mismo dataset."""
    print("\nT10 | Reproducibilidad exacta por semilla")
    g1 = GeneradorDataSintetica(db=DatabaseManager(), semilla=12345)
    g2 = GeneradorDataSintetica(db=DatabaseManager(), semilla=12345)
    m1, _ = g1._generar_materiales()
    m2, _ = g2._generar_materiales()
    verificar(m1.equals(m2), "Dos generadores con la misma semilla coinciden bit a bit")

    g3 = GeneradorDataSintetica(db=DatabaseManager(), semilla=999)
    m3, _ = g3._generar_materiales()
    verificar(not m1.equals(m3), "Semillas distintas producen datasets distintos")


# =============================================================================
def main() -> int:
    """Ejecuta la bateria completa de aceptacion."""
    print("=" * 78)
    print("  PRUEBAS DE ACEPTACION - SAPA FASE 1")
    print("=" * 78)
    db = DatabaseManager()

    t01_singleton_y_concurrencia(db)
    t02_integridad_esquema(db)
    t03_volumen_y_cobertura(db)
    t04_lead_time_lognormal(db)
    t05_censura_emergente(db)
    t06_friccion_organizacional(db)
    t07_balance_material(db)
    t08_segmentacion(db)
    t09_pipeline_superagente(db)
    t10_reproducibilidad()
    t11_migracion_anclada_a_la_conexion()

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
