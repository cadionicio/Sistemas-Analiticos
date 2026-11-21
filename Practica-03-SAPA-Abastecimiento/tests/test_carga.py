"""Pruebas de aceptacion de la consola de carga de datos.

El riesgo de un importador no es que falle: es que ACEPTE lo que no debe y
contamine la base con datos que luego nadie sabe de donde salieron. Por eso la
mayor parte de esta bateria son PRUEBAS NEGATIVAS: se le entrega basura
deliberada y se comprueba que la rechaza por la razon correcta.

La prueba mas dura es la de ida y vuelta: se exporta la base a Excel, se vuelve
a leer y se valida. Si el sistema no puede releer lo que el mismo escribio, el
libro de data de prueba no sirve como entregable reproducible.

Ejecucion:
    python -m tests.test_carga
"""

from __future__ import annotations

import math
import sys
import tempfile
from pathlib import Path

import pandas as pd

from config import settings
from data import importador as imp
from db.db_manager import DatabaseManager
from engine.inventario import parametros_lognormal, segmento_kraljic

_FALLOS: list[str] = []
_RAIZ = Path(__file__).resolve().parent.parent


def verificar(cond: bool, titulo: str, detalle: str = "") -> None:
    """Registra el resultado de una comprobacion."""
    print(f"  [{'OK  ' if cond else 'FALLA'}] {titulo}{(' -> ' + detalle) if detalle else ''}")
    if not cond:
        _FALLOS.append(titulo)


def _tiene_error(res: imp.ResultadoValidacion, columna: str, texto: str) -> bool:
    """True si el informe contiene un error en esa columna cuyo texto coincide."""
    if res.errores.empty:
        return False
    sel = res.errores[res.errores["columna"] == columna]
    return bool(sel["problema"].str.contains(texto, case=False, regex=False).any())


# =============================================================================
def t26_plantillas() -> None:
    """El libro de plantillas sale completo y con validaciones en las celdas."""
    print("\nT26 | Generacion de plantillas de carga")
    with tempfile.TemporaryDirectory() as tmp:
        ruta = imp.generar_plantillas(Path(tmp) / "plantillas.xlsx")
        verificar(ruta.is_file(), "El libro se genera", f"{ruta.stat().st_size // 1024} KB")

        import openpyxl
        libro = openpyxl.load_workbook(ruta)
        hojas = set(libro.sheetnames)
        verificar("INSTRUCCIONES" in hojas, "Incluye hoja de instrucciones")
        faltan = [t for t in imp.PLANTILLAS if t not in hojas]
        verificar(not faltan, "Una hoja por cada tabla importable",
                  f"{len(imp.PLANTILLAS)} hojas" if not faltan else f"faltan {faltan}")

        hoja = libro["maestro_materiales"]
        cabeceras = [c.value for c in hoja[1]]
        esperadas = imp.PLANTILLAS["maestro_materiales"].nombres
        verificar(cabeceras == esperadas,
                  "Las cabeceras coinciden exactamente con el contrato de la tabla",
                  f"{len(cabeceras)} columnas")
        pistas = [c.value for c in hoja[2]]
        vacias = [esperadas[i] for i, p in enumerate(pistas) if not p]
        verificar(not vacias, "Cada columna lleva su linea de ayuda",
                  f"{len(pistas)} pistas" if not vacias else f"sin pista: {vacias}")
        verificar(all("OBLIGATORIO" in str(p) or "Opcional" in str(p) or "DERIVADA" in str(p)
                      for p in pistas),
                  "Cada pista declara si el campo es obligatorio, opcional o derivado")

        validaciones = len(hoja.data_validations.dataValidation)
        verificar(validaciones >= 5,
                  "Las celdas llevan listas desplegables y rangos",
                  f"{validaciones} validaciones en maestro_materiales")

        # La columna derivada existe en la cabecera pero no debe pedir dato
        idx = esperadas.index("segmento_kraljic")
        verificar(hoja[3][idx].value in (None, ""),
                  "La columna derivada no trae valor de ejemplo")


def t27_normalizacion() -> None:
    """Tipos, fechas y periodos se normalizan y lo irrecuperable se reporta."""
    print("\nT27 | Normalizacion de tipos")
    df = pd.DataFrame({
        "periodo": ["2026-10", "15/11/2026", "no-es-periodo"],
        "centro": ["CD01", "CD01", "CD01"],
        "presupuesto_compra": ["1000.5", 2000, "mil"],
        "capacidad_almacen_m3": [100, 200, 300],
        "capacidad_palets": [10, 20, 30],
        "origen": ["APROBADO", "SUPUESTO", "INVENTADO"],
        "responsable": ["Finanzas", "Finanzas", "Finanzas"],
        "fecha_aprobacion": ["2026-09-20", None, "2026-09-20"],
    })
    res = imp.validar("restricciones_periodo", df)

    verificar(res.datos.at[0, "periodo"] == "2026-10", "Periodo AAAA-MM se conserva")
    verificar(res.datos.at[1, "periodo"] == "2026-11",
              "Una fecha completa se reduce a su periodo", str(res.datos.at[1, "periodo"]))
    verificar(_tiene_error(res, "periodo", "Periodo no valido"),
              "El periodo ilegible se reporta, no se inventa")
    verificar(res.datos.at[0, "presupuesto_compra"] == 1000.5,
              "Un numero escrito como texto se convierte")
    verificar(_tiene_error(res, "presupuesto_compra", "No es un numero"),
              "El texto no numerico se reporta")
    verificar(_tiene_error(res, "origen", "Valor no admitido"),
              "El valor fuera de dominio se rechaza")
    verificar(len(res.filas_validas) == 2,
              "Sobreviven las dos filas recuperables y cae solo la ilegible",
              f"{len(res.filas_validas)} de 3")


def t28_reglas_de_negocio(db: DatabaseManager) -> None:
    """Cada regla del esquema se comprueba antes de llegar a SQLite."""
    print("\nT28 | Reglas de negocio (pruebas negativas)")

    base = {
        "sku": "X-TEST", "descripcion": "prueba", "sector": "RETAIL",
        "categoria": "ABARROTES", "familia": "f", "unidad_base": "UND",
        "unidad_compra": "CAJA", "factor_conversion": 12, "costo_unitario": 10,
        "moneda": "PEN", "volumen_m3_unidad": 0.01, "peso_kg_unidad": 1,
        "unidades_por_palet": 100, "apilable_max_niveles": 2,
        "tipo_almacenamiento": "RACK_SELECTIVO", "politica_rotacion": "FIFO",
        "vida_util_dias": None, "compatible_gtp": 1, "motivo_no_gtp": None,
        "score_impacto_economico": 0.8, "score_riesgo_suministro": 0.3,
        "criticidad_operativa": 3, "arquetipo_demanda": "REGULAR",
        "clase_abc": None, "clase_xyz": None, "activo": 1,
    }

    def variante(**kw):
        d = dict(base)
        d.update(kw)
        return imp.validar("maestro_materiales", pd.DataFrame([d]), db)

    r = variante(politica_rotacion="FEFO", vida_util_dias=None)
    verificar(_tiene_error(r, "politica_rotacion", "FEFO exige vida util"),
              "FEFO sin vida util se rechaza con la razon explicada")

    r = variante(politica_rotacion="LIFO", vida_util_dias=90)
    verificar(_tiene_error(r, "politica_rotacion", "LIFO no admite material perecible"),
              "LIFO sobre perecible se rechaza")

    r = variante(compatible_gtp=1, volumen_m3_unidad=0.3)
    verificar(_tiene_error(r, "compatible_gtp", "supera el maximo del shuttle"),
              "GTP con volumen excesivo se rechaza citando el limite fisico")

    r = variante(compatible_gtp=1, peso_kg_unidad=40)
    verificar(_tiene_error(r, "compatible_gtp", "supera el maximo de bandeja"),
              "GTP con peso excesivo se rechaza")

    r = variante(costo_unitario=0)
    verificar(_tiene_error(r, "costo_unitario", "mayor o igual"),
              "Un costo cero se rechaza por rango")

    r = variante(sector="COMERCIAL")
    verificar(_tiene_error(r, "sector", "Valor no admitido"),
              "Un sector fuera de dominio se rechaza")

    r = variante(descripcion=None)
    verificar(_tiene_error(r, "descripcion", "obligatorio"),
              "Un obligatorio vacio se rechaza")

    # Clave duplicada dentro del propio archivo
    r = imp.validar("maestro_materiales", pd.DataFrame([base, dict(base)]), db)
    verificar(_tiene_error(r, "sku", "Clave repetida"),
              "Dos filas con el mismo SKU se rechazan")

    # Clave foranea inexistente
    r = imp.validar("sku_proveedor", pd.DataFrame([{
        "sku": "NO-EXISTE", "proveedor_id": "NO-EXISTE", "prioridad": 1,
        "precio_unitario": 5, "moq": 10, "lote_multiplo": 10,
        "lead_time_min_dias": 2, "lead_time_medio_dias": 10,
        "lead_time_sigma_dias": 3, "homologado": 1,
    }]), db)
    verificar(_tiene_error(r, "sku", "No existe en maestro_materiales"),
              "Un SKU inexistente se rechaza indicando que cargar primero")

    # Plazo medio por debajo del minimo
    r = imp.validar("sku_proveedor", pd.DataFrame([{
        "sku": "NO-EXISTE", "proveedor_id": "NO-EXISTE", "prioridad": 1,
        "precio_unitario": 5, "moq": 10, "lote_multiplo": 10,
        "lead_time_min_dias": 20, "lead_time_medio_dias": 10,
        "lead_time_sigma_dias": 3, "homologado": 1,
    }]), db)
    verificar(_tiene_error(r, "lead_time_medio_dias", "debe superar al minimo"),
              "Un plazo medio menor que el minimo se rechaza")

    # Cadena de fechas imposible y sobre-recepcion
    r = imp.validar("ordenes_compra", pd.DataFrame([{
        "id_orden": "OC-T", "linea": 1, "sku": "X", "proveedor_id": "P",
        "centro": "CD01", "fecha_necesidad": "2026-02-01",
        "fecha_solicitud": "2026-01-20", "fecha_aprobacion_finanzas": "2026-01-10",
        "fecha_emision": "2026-01-10", "fecha_prometida": "2026-01-25",
        "fecha_real_recepcion": "2026-01-05",
        "estado_aprobacion_finanzas": "APROBADA", "motivo_bloqueo_finanzas": None,
        "cantidad_solicitada": 100, "cantidad_recibida": 500,
        "cantidad_rechazada_calidad": 0, "precio_unitario": 4, "moneda": "PEN",
        "estado_orden": "RECIBIDA_TOTAL", "es_compra_urgente": 0,
        "usuario_aprobador": "USR01",
    }]))
    verificar(_tiene_error(r, "fecha_aprobacion_finanzas", "Cadena de fechas imposible"),
              "Una aprobacion anterior a la solicitud se rechaza")
    verificar(_tiene_error(r, "cantidad_recibida", "Sobre-recepcion"),
              "Recibir cinco veces lo pedido se rechaza")

    # Balance de inventario descuadrado
    r = imp.validar("inventario_diario", pd.DataFrame([{
        "fecha": "2026-01-15", "sku": "X", "centro": "CD01",
        "stock_inicial": 500, "recepciones": 0, "consumo": 100, "mermas": 0,
        "stock_final": 999, "stock_transito": 0, "stock_reservado": 0,
        "stock_bloqueado_calidad": 0,
    }]))
    verificar(_tiene_error(r, "stock_final", "El balance no cuadra"),
              "Un balance que no cierra se reporta con ambos numeros")


def t29_derivadas(db: DatabaseManager) -> None:
    """El sistema calcula lo que puede calcular, y lo calcula bien."""
    print("\nT29 | Columnas derivadas")

    filas = []
    for imp_sc, rie_sc, esperado in ((0.9, 0.9, "ESTRATEGICO"), (0.9, 0.1, "APALANCADO"),
                                     (0.1, 0.9, "CUELLO_DE_BOTELLA"), (0.1, 0.1, "RUTINARIO")):
        filas.append({
            "sku": f"K-{esperado[:4]}", "descripcion": "x", "sector": "RETAIL",
            "categoria": "ABARROTES", "familia": "f", "unidad_base": "UND",
            "unidad_compra": "CAJA", "factor_conversion": 1, "costo_unitario": 1,
            "moneda": "PEN", "volumen_m3_unidad": 0.001, "peso_kg_unidad": 0.1,
            "unidades_por_palet": 10, "apilable_max_niveles": 1,
            "tipo_almacenamiento": "RACK_SELECTIVO", "politica_rotacion": "FIFO",
            "vida_util_dias": None, "compatible_gtp": 1, "motivo_no_gtp": None,
            "score_impacto_economico": imp_sc, "score_riesgo_suministro": rie_sc,
            "criticidad_operativa": 3, "arquetipo_demanda": "REGULAR",
            "clase_abc": None, "clase_xyz": None, "activo": 1,
        })
    r = imp.validar("maestro_materiales", pd.DataFrame(filas), db)
    obtenidos = list(r.datos["segmento_kraljic"])
    verificar(obtenidos == ["ESTRATEGICO", "APALANCADO", "CUELLO_DE_BOTELLA", "RUTINARIO"],
              "El cuadrante de Kraljic se deriva de los dos scores", ", ".join(obtenidos))
    verificar(r.bloqueantes == 0, "Las cuatro filas validas no generan errores")

    # Lead time: E[LT] = LT_min + exp(mu + sigma^2/2) debe reproducir la media pedida
    r = imp.validar("sku_proveedor", pd.DataFrame([{
        "sku": "A", "proveedor_id": "P", "prioridad": 1, "precio_unitario": 5,
        "moq": 10, "lote_multiplo": 10, "lead_time_min_dias": 5,
        "lead_time_medio_dias": 20, "lead_time_sigma_dias": 6, "homologado": 1,
    }]))
    mu, sg = float(r.datos.at[0, "ln_mu"]), float(r.datos.at[0, "ln_sigma"])
    esperado = 5 + math.exp(mu + 0.5 * sg * sg)
    verificar(abs(esperado - 20.0) < 0.02,
              "Los parametros log-normales reproducen el plazo medio declarado",
              f"E[LT] = {esperado:.4f} frente a 20 dias")
    mu2, sg2 = parametros_lognormal(15.0, 6.0)
    verificar(abs(mu - mu2) < 1e-6 and abs(sg - sg2) < 1e-6,
              "El importador usa la misma conversion que el generador sintetico")

    # Censura derivada de las horas sin stock
    r = imp.validar("historico_demanda", pd.DataFrame([
        {"fecha": "2026-01-01", "sku": "A", "centro": "CD01", "demanda_atendida": 10,
         "devoluciones": 0, "precio_neto": 1, "promocion_activa": 0, "evento": None,
         "horas_sin_stock": 0, "origen_dato": "EXCEL"},
        {"fecha": "2026-01-02", "sku": "A", "centro": "CD01", "demanda_atendida": 5,
         "devoluciones": 0, "precio_neto": 1, "promocion_activa": 0, "evento": None,
         "horas_sin_stock": 6, "origen_dato": "EXCEL"},
    ]))
    verificar(list(r.datos["flag_censura"]) == [0, 1],
              "La bandera de censura se deriva de las horas sin stock")
    verificar("demanda_perdida_estimada" not in
              [c.nombre for c in imp.PLANTILLAS["historico_demanda"].visibles],
              "La demanda perdida NO se pide como dato de entrada")

    # Descomposicion del retraso en sus dos tramos
    r = imp.validar("ordenes_compra", pd.DataFrame([{
        "id_orden": "OC-D", "linea": 1, "sku": "A", "proveedor_id": "P",
        "centro": "CD01", "fecha_necesidad": "2026-02-01",
        "fecha_solicitud": "2026-01-01", "fecha_aprobacion_finanzas": "2026-01-09",
        "fecha_emision": "2026-01-09", "fecha_prometida": "2026-01-20",
        "fecha_real_recepcion": "2026-01-24",
        "estado_aprobacion_finanzas": "APROBADA_CON_RETRASO",
        "motivo_bloqueo_finanzas": "presupuesto", "cantidad_solicitada": 100,
        "cantidad_recibida": 100, "cantidad_rechazada_calidad": 0,
        "precio_unitario": 4, "moneda": "PEN", "estado_orden": "RECIBIDA_TOTAL",
        "es_compra_urgente": 0, "usuario_aprobador": "USR01",
    }]))
    d = r.datos.iloc[0]
    # emision - solicitud = 8 dias; SLA interno 2 -> 6 imputables a aprobacion
    # recepcion - prometida = 4 dias -> imputables al proveedor
    verificar(abs(float(d["dias_retraso_aprobacion"]) - 6.0) < 1e-6,
              "Retraso de aprobacion = emision - solicitud - SLA", str(d["dias_retraso_aprobacion"]))
    verificar(abs(float(d["dias_retraso_proveedor"]) - 4.0) < 1e-6,
              "Retraso de proveedor = recepcion real - fecha prometida")
    verificar(abs(float(d["dias_retraso_total"]) - 10.0) < 1e-6,
              "El total es la suma exacta de los dos tramos")
    verificar(d["causa_raiz_retraso"] == "CAUSA_MIXTA",
              "La causa raiz se clasifica como mixta cuando fallan ambos")
    verificar(abs(float(d["costo_total"]) - 400.0) < 1e-6, "Costo total = cantidad x precio")


def t30_transaccionalidad(db: DatabaseManager) -> None:
    """Un lote con errores no deja la base a medio cargar."""
    print("\nT30 | Transaccionalidad de la carga")
    antes = int(db.consultar_escalar("SELECT COUNT(*) FROM maestro_proveedores;"))

    buenos = [{"proveedor_id": f"TST{i:02d}", "razon_social": f"Prueba {i}",
               "ruc": f"20{700000000 + i}", "pais": "PE", "es_importado": 0,
               "moneda": "PEN", "dias_credito": 30, "otif_historico": 0.9,
               "homologado": 1} for i in range(3)]
    malo = {"proveedor_id": "TSTBAD", "razon_social": None, "ruc": "20999999999",
            "pais": "PE", "es_importado": 0, "moneda": "EUR", "dias_credito": 30,
            "otif_historico": 5.0, "homologado": 1}

    res = imp.validar("maestro_proveedores", pd.DataFrame(buenos + [malo]), db)
    verificar(res.bloqueantes >= 3, "Se detectan los tres problemas de la fila mala",
              f"{res.bloqueantes} errores")

    r = imp.cargar(res, db, solo_validas=False)
    medio = int(db.consultar_escalar("SELECT COUNT(*) FROM maestro_proveedores;"))
    verificar(not r.exito and medio == antes,
              "Con 'no cargar nada si hay errores' la base queda intacta",
              f"{medio} filas, sin cambios")

    r = imp.cargar(res, db, solo_validas=True)
    despues = int(db.consultar_escalar("SELECT COUNT(*) FROM maestro_proveedores;"))
    verificar(r.exito and despues == antes + 3,
              "Con 'solo filas validas' entran exactamente las buenas",
              f"{antes} -> {despues}")
    verificar(r.filas_descartadas == 1, "La fila mala se descarta y se contabiliza")

    db.ejecutar("DELETE FROM maestro_proveedores WHERE proveedor_id LIKE 'TST%';")
    final = int(db.consultar_escalar("SELECT COUNT(*) FROM maestro_proveedores;"))
    verificar(final == antes, "La prueba deja la base como la encontro")


def t31_ida_y_vuelta(db: DatabaseManager) -> None:
    """La base exportada a Excel se vuelve a leer sin errores."""
    print("\nT31 | Ida y vuelta: exportar y reimportar")
    with tempfile.TemporaryDirectory() as tmp:
        ruta = imp.exportar_datos(Path(tmp) / "data.xlsx", db=db, limite_filas=150)
        verificar(ruta.is_file(), "El libro de data de prueba se genera",
                  f"{ruta.stat().st_size // 1024} KB")

        hojas = imp.leer_libro(ruta)
        verificar(len(hojas) == len(imp.ORDEN_CARGA),
                  "Todas las tablas vuelven a reconocerse al releer",
                  f"{len(hojas)} hojas")

        problemas = {}
        for tabla, df in hojas.items():
            res = imp.validar(tabla, df, db)
            if res.bloqueantes:
                problemas[tabla] = res.errores.head(2)["problema"].tolist()
        verificar(not problemas,
                  "Ninguna hoja exportada produce errores al reimportarse",
                  str(problemas) if problemas else "0 errores en 7 tablas")

        import openpyxl
        libro = openpyxl.load_workbook(ruta)
        verificar("RESUMEN" in libro.sheetnames, "El libro lleva hoja de resumen")
        textos = [str(c.value) for fila in libro["RESUMEN"].iter_rows() for c in fila]
        verificar(any("Semilla" in t for t in textos),
                  "El resumen declara la semilla del generador, para reproducibilidad")


def t32_integracion_ui() -> None:
    """La consola de carga se renderiza dentro de la aplicacion."""
    print("\nT32 | Integracion en la Torre de Control")
    try:
        from streamlit.testing.v1 import AppTest
    except ImportError:
        verificar(False, "Streamlit disponible")
        return

    at = AppTest.from_file(str(_RAIZ / "app.py"), default_timeout=240)
    at.run()
    verificar(len(at.exception) == 0, "La aplicacion sigue sin excepciones",
              "; ".join(str(e.value)[:100] for e in at.exception) or "ninguna")

    etiquetas = [b.label for b in at.button]
    verificar(any("Generar plantillas" in e for e in etiquetas),
              "Boton de generacion de plantillas presente")
    verificar(any("Exportar data actual" in e for e in etiquetas),
              "Boton de exportacion de data de prueba presente")

    subidas = getattr(at, "file_uploader", [])
    verificar(len(subidas) >= 1, "La consola ofrece carga de archivo Excel",
              f"{len(subidas)} cargadores")
    # `AppTest` no expone un accesor para `st.data_editor`, de modo que el
    # registro directo se comprueba por los controles que lo acompanan: el
    # selector de tabla y el boton de guardado.
    etiquetas_sel = [s.label for s in at.selectbox]
    verificar(any("Tabla a editar" in e for e in etiquetas_sel),
              "La consola ofrece seleccionar la tabla a registrar directamente",
              ", ".join(etiquetas_sel[:4]))
    verificar(any("Validar y guardar" in e for e in etiquetas),
              "El registro directo valida antes de guardar")


# =============================================================================
def main() -> int:
    """Ejecuta la bateria de la consola de carga."""
    print("=" * 78)
    print("  PRUEBAS DE ACEPTACION - CONSOLA DE CARGA DE DATOS")
    print("=" * 78)
    db = DatabaseManager()

    t26_plantillas()
    t27_normalizacion()
    t28_reglas_de_negocio(db)
    t29_derivadas(db)
    t30_transaccionalidad(db)
    t31_ida_y_vuelta(db)
    t32_integracion_ui()

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
