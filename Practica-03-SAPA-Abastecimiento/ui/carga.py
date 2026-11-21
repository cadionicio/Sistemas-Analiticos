"""Consola de carga de datos y registro directo.

Cubre el requisito: "permitir cargar data de entrada desde Excel, o registrarla
directamente". Tres vias, en orden de volumen:

    1. Plantillas   - el sistema genera el libro de Excel con las columnas, las
       listas desplegables y las validaciones de rango ya puestas.
    2. Importacion  - se sube el libro, se valida entero en memoria y se muestra
       cada problema con su fila de Excel. Nada se escribe hasta aceptar.
    3. Registro directo - edicion en pantalla de maestros y restricciones, con
       la misma validacion que la importacion.

El flujo nunca escribe a ciegas: entre subir el archivo y aplicar el lote hay
siempre una pantalla de revision. Un importador que guarda al vuelo obliga a
descubrir los errores dentro de la base, que es el lugar mas caro para
encontrarlos.
"""

from __future__ import annotations

import pandas as pd
import streamlit as st

from data import importador as imp
from ui import datos as dd
from ui import tema

# Tablas que admiten edicion directa en pantalla. Las tablas de hechos
# -demanda, inventario, ordenes- tienen decenas de miles de filas y editarlas a
# mano no es un caso de uso real: para esas, la via es el Excel.
_EDITABLES: tuple[str, ...] = (
    "maestro_proveedores", "maestro_materiales", "sku_proveedor",
    "restricciones_periodo",
)


def _resumen_tablas() -> pd.DataFrame:
    """Conteo actual de filas por tabla importable."""
    filas = []
    for tabla in imp.ORDEN_CARGA:
        try:
            n = dd.gestor().consultar_escalar(f"SELECT COUNT(*) FROM {tabla};") or 0
        except Exception:  # noqa: BLE001
            n = -1
        filas.append({
            "tabla": tabla,
            "titulo": imp.PLANTILLAS[tabla].titulo,
            "filas": int(n),
            "clave": " + ".join(imp.PLANTILLAS[tabla].clave),
        })
    return pd.DataFrame(filas)


def consola_carga() -> None:
    """Dibuja la consola completa de carga y registro."""
    st.markdown("#### Estado de las tablas")
    resumen = _resumen_tablas()

    cols = st.columns(len(resumen))
    for c, (_, r) in zip(cols, resumen.iterrows()):
        with c:
            tema.kpi(r["titulo"], f"{int(r['filas']):,}",
                     f"clave: {r['clave']}",
                     tema.COLORES["ok"] if r["filas"] > 0 else tema.COLORES["aviso"])

    st.divider()
    t_plant, t_excel, t_manual = st.tabs([
        "  Plantillas y exportacion  ", "  Cargar desde Excel  ", "  Registro directo  ",
    ])

    with t_plant:
        _seccion_plantillas()
    with t_excel:
        _seccion_excel()
    with t_manual:
        _seccion_registro_directo()


# =============================================================================
# 1 · PLANTILLAS Y EXPORTACION
# =============================================================================
def _seccion_plantillas() -> None:
    """Genera el libro de plantillas y exporta la data actual."""
    tema.nota(
        "Las plantillas se generan <b>desde el propio esquema</b>, no se escriben a "
        "mano: cada columna lleva su ayuda, las de dominio cerrado llevan lista "
        "desplegable y las numericas, validacion de rango. La mayoria de los errores "
        "se evitan en Excel en lugar de descubrirse al cargar."
    )

    c1, c2 = st.columns(2)

    with c1:
        st.markdown("##### Plantillas de carga")
        st.caption(
            "Un libro con una hoja por tabla, la fila de ayuda, una fila de ejemplo "
            "y las validaciones puestas. Las columnas derivadas aparecen sombreadas."
        )
        if st.button("Generar plantillas", type="primary", width="stretch"):
            with st.spinner("Construyendo el libro…"):
                try:
                    ruta = imp.generar_plantillas()
                    st.session_state["_ruta_plantillas"] = str(ruta)
                except Exception as exc:  # noqa: BLE001
                    st.error(f"No se pudo generar: {exc}")
        ruta = st.session_state.get("_ruta_plantillas")
        if ruta:
            try:
                with open(ruta, "rb") as fh:
                    st.download_button(
                        "Descargar SAPA_Plantillas_de_Carga.xlsx", fh.read(),
                        file_name="SAPA_Plantillas_de_Carga.xlsx",
                        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        width="stretch")
                st.caption(f"Guardado tambien en: {ruta}")
            except OSError as exc:
                st.warning(f"El archivo ya no esta disponible: {exc}")

    with c2:
        st.markdown("##### Data de prueba (entregable)")
        st.caption(
            "Exporta el contenido actual de la base con los mismos nombres de hoja "
            "que las plantillas, de modo que el libro puede volver a importarse tal "
            "cual y reproducir el mismo proceso."
        )
        if st.button("Exportar data actual", width="stretch"):
            with st.spinner("Volcando la base a Excel…"):
                try:
                    ruta = imp.exportar_datos(db=dd.gestor())
                    st.session_state["_ruta_datos"] = str(ruta)
                except Exception as exc:  # noqa: BLE001
                    st.error(f"No se pudo exportar: {exc}")
        ruta = st.session_state.get("_ruta_datos")
        if ruta:
            try:
                with open(ruta, "rb") as fh:
                    st.download_button(
                        "Descargar SAPA_Data_de_Prueba.xlsx", fh.read(),
                        file_name="SAPA_Data_de_Prueba.xlsx",
                        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        width="stretch")
                st.caption(f"Guardado tambien en: {ruta}")
            except OSError as exc:
                st.warning(f"El archivo ya no esta disponible: {exc}")

    st.divider()
    st.markdown("##### Contrato de las tablas")
    filas = []
    for tabla, p in imp.PLANTILLAS.items():
        filas.append({
            "tabla": tabla, "titulo": p.titulo, "proposito": p.proposito,
            "clave": " + ".join(p.clave),
            "columnas_a_llenar": len(p.visibles),
            "columnas_derivadas": len(p.columnas) - len(p.visibles),
        })
    st.dataframe(
        pd.DataFrame(filas), width="stretch", hide_index=True, height=290,
        column_config={
            "tabla": st.column_config.TextColumn("Tabla", width="small"),
            "titulo": st.column_config.TextColumn("Titulo", width="small"),
            "proposito": st.column_config.TextColumn("Para que sirve", width="large"),
            "clave": st.column_config.TextColumn("Clave"),
            "columnas_a_llenar": st.column_config.NumberColumn("A llenar", format="%d"),
            "columnas_derivadas": st.column_config.NumberColumn("Derivadas", format="%d"),
        },
    )


# =============================================================================
# 2 · CARGA DESDE EXCEL
# =============================================================================
def _seccion_excel() -> None:
    """Sube un libro, lo valida y lo aplica tras revision."""
    archivo = st.file_uploader(
        "Libro de Excel con una hoja por tabla",
        type=["xlsx", "xlsm"],
        help="Las hojas deben llamarse como las tablas. El sistema ignora el resto.",
    )
    if archivo is None:
        tema.nota(
            "Suba el libro y el sistema lo validara <b>entero antes de escribir nada</b>. "
            "Cada problema se reporta con su fila de Excel exacta, su columna y la razon "
            "en lenguaje de negocio, no como un error de base de datos."
        )
        return

    try:
        hojas = imp.leer_libro(archivo)
    except ValueError as exc:
        st.error(str(exc))
        return
    except Exception as exc:  # noqa: BLE001
        st.error(f"No se pudo leer el libro: {exc}")
        return

    st.success(
        f"Hojas reconocidas: {', '.join(hojas)} · "
        f"{sum(len(d) for d in hojas.values()):,} filas en total"
    )

    c1, c2, c3 = st.columns([2, 2, 1])
    with c1:
        modo = st.selectbox(
            "Modo de aplicacion",
            ["INSERT OR REPLACE", "INSERT OR IGNORE", "INSERT"],
            help="REPLACE actualiza lo que ya existe. IGNORE conserva lo existente y "
                 "solo agrega lo nuevo. INSERT falla ante cualquier duplicado.",
        )
    with c2:
        solo_validas = st.radio(
            "Ante errores",
            ["Cargar solo las filas validas", "No cargar nada si hay errores"],
            index=0,
        ) == "Cargar solo las filas validas"
    with c3:
        st.markdown("&nbsp;")
        validar = st.button("Validar", type="primary", width="stretch")

    if validar or st.session_state.get("_validado"):
        if validar:
            resultados = {}
            with st.spinner("Validando…"):
                for tabla in imp.ORDEN_CARGA:
                    if tabla in hojas:
                        resultados[tabla] = imp.validar(tabla, hojas[tabla], dd.gestor())
            st.session_state["_validado"] = True
            st.session_state["_resultados"] = resultados
        resultados = st.session_state.get("_resultados", {})

        total_err = sum(r.bloqueantes for r in resultados.values())
        total_ok = sum(len(r.filas_validas) for r in resultados.values())

        k1, k2, k3 = st.columns(3)
        with k1:
            tema.kpi("Filas leidas", f"{sum(r.filas_leidas for r in resultados.values()):,}",
                     f"{len(resultados)} hojas reconocidas")
        with k2:
            tema.kpi("Filas validas", f"{total_ok:,}", "pasan todas las reglas",
                     tema.COLORES["ok"] if total_ok else tema.COLORES["alerta"])
        with k3:
            tema.kpi("Errores bloqueantes", f"{total_err:,}",
                     "impiden cargar su fila",
                     tema.COLORES["ok"] if total_err == 0 else tema.COLORES["alerta"])

        for tabla, r in resultados.items():
            with st.expander(
                f"{imp.PLANTILLAS[tabla].titulo} · {len(r.filas_validas)} de "
                f"{r.filas_leidas} filas validas",
                expanded=bool(r.bloqueantes),
            ):
                if not r.errores.empty:
                    st.dataframe(
                        r.errores, width="stretch", hide_index=True, height=220,
                        column_config={
                            "fila_excel": st.column_config.NumberColumn("Fila", format="%d", width="small"),
                            "columna": st.column_config.TextColumn("Columna"),
                            "valor": st.column_config.TextColumn("Valor"),
                            "problema": st.column_config.TextColumn("Problema", width="large"),
                            "severidad": st.column_config.TextColumn("Severidad", width="small"),
                        },
                    )
                    st.download_button(
                        f"Descargar errores de {tabla} (CSV)",
                        r.errores.to_csv(index=False).encode("utf-8-sig"),
                        file_name=f"errores_{tabla}.csv", mime="text/csv",
                        key=f"err_{tabla}")
                else:
                    st.success("Sin errores.")
                if not r.datos.empty:
                    st.caption("Vista previa de los datos normalizados (primeras 8 filas):")
                    st.dataframe(r.datos.head(8), width="stretch", hide_index=True)

        st.divider()
        if st.button("Aplicar a la base de datos", type="primary", width="stretch"):
            aplicados = []
            with st.spinner("Aplicando en transaccion…"):
                for tabla in imp.ORDEN_CARGA:
                    if tabla not in resultados:
                        continue
                    aplicados.append(imp.cargar(
                        resultados[tabla], dd.gestor(), modo=modo, solo_validas=solo_validas))
            dd.limpiar_cache()
            st.session_state["_validado"] = False
            for a in aplicados:
                if a.exito:
                    st.success(f"{a.tabla}: {a.mensaje}"
                               + (f" · {a.filas_descartadas} descartadas" if a.filas_descartadas else ""))
                else:
                    st.error(f"{a.tabla}: {a.mensaje}")
            st.info("Ejecute el pipeline en la consola 1 para recalcular con los datos nuevos.")


# =============================================================================
# 3 · REGISTRO DIRECTO
# =============================================================================
def _seccion_registro_directo() -> None:
    """Edicion en pantalla de maestros y restricciones."""
    tema.nota(
        "El registro directo usa <b>exactamente la misma validacion</b> que la "
        "importacion. Las tablas de hechos no son editables aqui a proposito: tienen "
        "decenas de miles de filas y editarlas a mano no es un caso de uso real."
    )

    tabla = st.selectbox(
        "Tabla a editar", _EDITABLES,
        format_func=lambda t: f"{imp.PLANTILLAS[t].titulo}  ({t})",
    )
    plantilla = imp.PLANTILLAS[tabla]
    st.caption(plantilla.proposito)

    visibles = [c.nombre for c in plantilla.visibles]
    try:
        actual = dd.gestor().consultar_df(
            f"SELECT {', '.join(visibles)} FROM {tabla} LIMIT 500;")
    except Exception as exc:  # noqa: BLE001
        st.error(f"No se pudo leer la tabla: {exc}")
        return

    if actual.empty:
        actual = pd.DataFrame(columns=visibles)

    config = {}
    for col in plantilla.visibles:
        etiqueta = col.nombre.replace("_", " ")
        if col.dominio:
            config[col.nombre] = st.column_config.SelectboxColumn(
                etiqueta, options=list(col.dominio), help=col.ayuda or None)
        elif col.tipo == "entero":
            config[col.nombre] = st.column_config.NumberColumn(
                etiqueta, format="%d", min_value=col.minimo, max_value=col.maximo,
                help=col.ayuda or None)
        elif col.tipo == "decimal":
            config[col.nombre] = st.column_config.NumberColumn(
                etiqueta, min_value=col.minimo, max_value=col.maximo,
                help=col.ayuda or None)
        else:
            config[col.nombre] = st.column_config.TextColumn(
                etiqueta, help=col.ayuda or None)

    st.caption(
        f"Clave: {' + '.join(plantilla.clave)} · "
        f"{len(plantilla.columnas) - len(plantilla.visibles)} columnas derivadas se "
        "calculan al guardar"
    )
    editado = st.data_editor(
        actual, width="stretch", height=420, num_rows="dynamic",
        column_config=config, key=f"editor_{tabla}",
    )

    c1, c2 = st.columns([1, 3])
    with c1:
        guardar = st.button("Validar y guardar", type="primary", width="stretch")
    with c2:
        st.caption(
            "Se valida el contenido completo del editor y se aplica en una sola "
            "transaccion con INSERT OR REPLACE."
        )

    if guardar:
        resultado = imp.validar(tabla, editado, dd.gestor())
        if resultado.bloqueantes:
            st.error(f"{resultado.bloqueantes} errores bloqueantes. No se guardo nada.")
            st.dataframe(resultado.errores, width="stretch", hide_index=True, height=240)
            return
        aplicado = imp.cargar(resultado, dd.gestor(), modo="INSERT OR REPLACE",
                              solo_validas=False)
        if aplicado.exito:
            dd.limpiar_cache()
            st.success(aplicado.mensaje)
            derivadas = [c.nombre for c in plantilla.columnas if c.derivada]
            if derivadas:
                st.caption(f"Columnas derivadas recalculadas: {', '.join(derivadas)}")
        else:
            st.error(aplicado.mensaje)
