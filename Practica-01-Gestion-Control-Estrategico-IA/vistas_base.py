# -*- coding: utf-8 -*-
"""
vistas_base.py - Pantallas base: Acceso, Inicio, Base de Datos, Auditoría y Configuración.
"""
from __future__ import annotations

import datetime as dt
import platform

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

import config
import db
import finanzas as fz
import ui

NOMBRE_TABLA = {
    "empresas": "Empresas", "identidad": "Identidad (misión, visión)", "diagnostico": "Diagnóstico (hechos, PESTEL, FODA)",
    "periodos": "Periodos", "escenarios": "Escenarios", "supuestos_mc": "Supuestos Monte Carlo",
    "financieros": "Financieros mensuales", "estrategias": "Estrategias", "objetivos": "Objetivos",
    "relaciones": "Relaciones causa-efecto", "kpis": "KPI (ficha técnica)", "kpi_valores": "Valores de KPI",
    "criterios": "Criterios de priorización", "iniciativas": "Iniciativas", "seguimiento": "Seguimiento de iniciativas",
    "gantt_tareas": "Tareas del Gantt", "riesgos": "Riesgos", "gatillos": "Gatillos",
}
SELECTORES = {
    "perspectiva": config.PERSPECTIVAS, "sentido": config.SENTIDOS, "tipo_valor": config.TIPOS_VALOR,
    "calidad_dato": config.CALIDAD_DATO, "puerta": config.PUERTAS,
}


# ============================================================ Acceso
def pagina_login() -> None:
    ui.estilos()
    izq, centro, der = st.columns([1, 1.25, 1])
    with centro:
        st.markdown("<div style='height:6vh'></div>", unsafe_allow_html=True)
        st.markdown(f"<div style='text-align:center'><div style='font-size:3rem'>🎯</div>"
                    f"<h2 style='margin:.2rem 0'>{config.APP_NOMBRE}</h2>"
                    f"<p style='color:{config.COLOR['texto2']}'>Plan Estratégico · Balanced Scorecard · Simulación de valor (EVA)</p></div>",
                    unsafe_allow_html=True)
        with st.form("form_login", border=True):
            u = st.text_input("Usuario", value="admin")
            c = st.text_input("Clave", type="password", value="admin123")  # autocompletada para la revisión docente
            ok = st.form_submit_button("Ingresar", type="primary", width="stretch")
        if ok:
            datos = db.autenticar(u, c)
            if datos:
                st.session_state["usuario"] = datos
                db.auditar(datos["usuario"], None, "sesion", "INGRESO")
                st.rerun()
            else:
                st.error("Usuario o clave incorrectos.")
        st.caption("Acceso inicial: usuario **admin**, clave **admin123** (cámbiela en Configuración).")


# ============================================================ Inicio
def pagina_inicio() -> None:
    ui.mostrar_toast()
    c = ui.ctx()
    ui.encabezado("Inicio", "Resumen ejecutivo del ciclo estratégico")
    if not c["empresa_id"]:
        st.subheader("Bienvenido")
        st.write("Para comenzar, cargue la data de prueba o registre su organización en **Base de Datos**.")
        ui.boton_demo("demo_inicio")
        _guia(False)
        return
    e, anio, esc, per = c["empresa_id"], c["anio"], c["escenario"], c["periodo_id"]
    escen = ui.leer("escenarios", e)
    del_anio = escen[escen["anio"] == anio]
    tabla = fz.tabla_escenarios(del_anio)
    fila = tabla[tabla["escenario"] == esc]
    ev = fz.evaluar_kpis(ui.leer("kpis", e), ui.leer("kpi_valores", e), per)
    seg = ui.leer("seguimiento", e)
    seg_p = seg[seg["periodo_id"] == per]
    sem_ini = [fz.semaforo_iniciativa(a, b) for a, b in zip(seg_p["avance_plan"], seg_p["avance_real"])]

    st.markdown(f"**{ui.nombre_empresa(e)}** · Plan {anio} · Escenario **{esc}** · Control al **{per}**")
    k1, k2, k3, k4, k5 = st.columns(5)
    with k1:
        v = fila["eva"].iloc[0] if not fila.empty else None
        ui.tarjeta(f"EVA {esc} {anio}", fz.fmt_monto(v), "NOPAT − WACC × Capital",
                   config.COLOR["verde"] if (v or 0) > 0 else config.COLOR["rojo"])
    with k2:
        ui.tarjeta("EVA esperado", fz.fmt_monto(fz.eva_esperado(del_anio)) if not del_anio.empty else "—",
                   "Ponderado por probabilidad", config.COLOR["accion"])
    with k3:
        sp = fila["spread"].iloc[0] * 100 if not fila.empty else None
        ui.tarjeta("ROIC − WACC", f"{sp:+.2f} pp" if sp is not None else "—",
                   f"ROIC {fila['roic'].iloc[0]:.2%}" if not fila.empty else "", config.COLOR["marca"])
    with k4:
        n_v = int((ev["semaforo"] == "VERDE").sum())
        ui.tarjeta("KPI en verde", f"{n_v} / {len(ev)}",
                   f"Ámbar {int((ev['semaforo'] == 'AMBAR').sum())} · Rojo {int((ev['semaforo'] == 'ROJO').sum())} · "
                   f"Gris {int((ev['semaforo'] == 'GRIS').sum())}", config.COLOR["verde"])
    with k5:
        n_r = sem_ini.count("ROJO")
        ui.tarjeta("Iniciativas en rojo", str(n_r), f"{len(seg_p)} con seguimiento en {per}",
                   config.COLOR["rojo"] if n_r else config.COLOR["verde"])

    st.write("")
    g1, g2 = st.columns([1.1, 1])
    with g1:
        st.markdown("##### EVA por escenario (S/ m)")
        if not tabla.empty:
            colores = [config.COLOR["rojo"] if x < 0 else config.COLOR["accion"] for x in tabla["eva"]]
            fig = go.Figure(go.Bar(x=tabla["escenario"], y=tabla["eva"], marker_color=colores,
                                   text=[f"{x:,.2f}" for x in tabla["eva"]], textposition="outside"))
            fig.update_layout(height=300, margin=dict(l=10, r=10, t=10, b=10), plot_bgcolor="white",
                              yaxis=dict(gridcolor="#EEF1F5", zerolinecolor="#9AA7B8"))
            st.plotly_chart(fig, width="stretch", config={"displayModeBar": False})
        else:
            st.info("Sin escenarios para el año seleccionado.")
    with g2:
        st.markdown("##### Semáforo de KPI por perspectiva")
        obj = ui.leer("objetivos", e)[["objetivo_id", "perspectiva"]]
        d = ev.merge(obj, on="objetivo_id", how="left")
        if not d.empty:
            fig = go.Figure()
            for s in ["VERDE", "AMBAR", "ROJO", "GRIS", "N/A"]:
                cnt = d[d["semaforo"] == s].groupby("perspectiva").size().reindex(config.PERSPECTIVAS, fill_value=0)
                if cnt.sum():
                    fig.add_bar(y=cnt.index, x=cnt.values, orientation="h", name=ui.ETIQUETA_SEMAFORO[s],
                                marker_color=config.COLOR_SEMAFORO[s])
            fig.update_layout(barmode="stack", height=300, margin=dict(l=10, r=10, t=10, b=10),
                              plot_bgcolor="white", legend=dict(orientation="h", y=-0.15),
                              yaxis=dict(autorange="reversed"))
            st.plotly_chart(fig, width="stretch", config={"displayModeBar": False})
        else:
            st.info("Sin KPI registrados.")

    st.markdown("##### Estado del ciclo de gestión")
    cols = st.columns(3)
    for col, (ent, nom) in zip(cols, [("plan", "Plan Estratégico"), ("bsc", "Balanced Scorecard"), ("gantt", "Gantt de implementación")]):
        est = db.estado_flujo(e, ent)
        col.markdown(f"<div class='gce-card'><div class='lbl'>{nom}</div><div style='margin-top:.4rem'>"
                     f"{ui.chip_estado(est['estado'])} <span style='color:{config.COLOR['texto2']}'>versión {est['version']}</span>"
                     f"</div><div class='sub'>{est['actualizado'] or 'sin movimientos'}</div></div>", unsafe_allow_html=True)
    st.write("")
    with st.expander("Guía rápida de uso", expanded=False):
        _guia(True)


def _guia(hay_datos: bool) -> None:
    ui.paso(1, "Base de Datos", "Importe 10_Data_Prueba.xlsx o registre su empresa, escenarios y financieros.", hay_datos)
    ui.paso(2, "Plan Estratégico", "Genere la propuesta IA (misión, diagnóstico, estrategias), edítela y apruébela.")
    ui.paso(3, "Mapa y BSC", "Genere objetivos, relaciones, KPI y metas desde el plan aprobado; valide y apruebe.")
    ui.paso(4, "Seguimiento y Gantt", "Priorice iniciativas, apruebe el Gantt y registre el avance mensual.")
    ui.paso(5, "Dashboard, Simulador y Reportes", "Analice real vs proyectado, simule el EVA y genere el PPT.")


# ============================================================ Base de datos
def pagina_base_datos() -> None:
    ui.mostrar_toast()
    ui.encabezado("Base de Datos", "Carga desde Excel, registro manual, exportación y respaldo")
    t1, t2, t3, t4, t5 = st.tabs(["📊 Resumen", "📥 Importar Excel", "✏️ Registro y edición", "📤 Exportar / Plantilla", "💾 Respaldo"])
    with t1:
        conteo = db.conteo_tablas()
        a, b = st.columns([1, 1.4])
        a.dataframe(conteo, hide_index=True, width="stretch", height=560)
        with b:
            st.markdown("##### Empresas registradas")
            st.dataframe(ui.leer("empresas"), hide_index=True, width="stretch")
            st.caption(f"Archivo de base de datos: `{config.DB_PATH.name}` en la carpeta del sistema ({config.BASE_DIR}).")
            if ui.ctx()["empresa_id"] is None:
                ui.boton_demo("demo_bd")
    with t2:
        _importar()
    with t3:
        _registro()
    with t4:
        _exportar()
    with t5:
        _respaldo()


def _importar() -> None:
    st.markdown("Cargue un libro con una hoja por tabla (mismos encabezados que **10_Data_Prueba.xlsx** o la plantilla). "
                "La carga es **transaccional**: si hay errores no se graba nada.")
    origen = st.radio("Origen del archivo", ["Subir archivo", f"Usar {config.DATA_PRUEBA_XLSX.name} de la carpeta del sistema"],
                      horizontal=True)
    contenido = None
    if origen == "Subir archivo":
        f = st.file_uploader("Libro Excel (.xlsx)", type=["xlsx"])
        if f is not None:
            contenido = f.getvalue()
    elif config.DATA_PRUEBA_XLSX.exists():
        contenido = config.DATA_PRUEBA_XLSX.read_bytes()
    else:
        st.warning("No se encontró el archivo en la carpeta del sistema.")
    modo = st.selectbox("Modo", ["reemplazar", "agregar"], format_func=lambda m: {
        "reemplazar": "Reemplazar los datos de las empresas incluidas en el archivo",
        "agregar": "Agregar registros (sin borrar los existentes)"}[m])
    if contenido is None:
        return
    val = db.importar_excel(contenido, validar_solo=True)
    c1, c2 = st.columns([1, 1])
    with c1:
        st.markdown("##### Vista previa de validación")
        st.dataframe(pd.DataFrame(list(val["resumen"].items()), columns=["Hoja", "Registros"]),
                     hide_index=True, width="stretch")
    with c2:
        if val["ok"]:
            st.success(f"Validación correcta. Empresas en el archivo: {', '.join(val['empresas']) or '—'}")
        else:
            st.error("Se encontraron errores. Corrija el archivo y vuelva a cargarlo:")
            for err in val["errores"]:
                st.markdown(f"- {err}")
    if st.button("Importar a la base de datos", type="primary", disabled=not (val["ok"] and ui.puede("editar"))):
        r = db.importar_excel(contenido, usuario=ui.usuario()["usuario"], modo=modo)
        ui.refrescar()
        if r["ok"]:
            st.session_state["_toast"] = f"Importación completa: {sum(r['resumen'].values())} registros."
            st.rerun()
        else:
            st.error("\n".join(r["errores"]))


def _registro() -> None:
    e = ui.ctx()["empresa_id"]
    with st.expander("➕ Registrar nueva empresa", expanded=e is None):
        with st.form("form_nueva_empresa", clear_on_submit=True):
            a, b, c = st.columns(3)
            eid = a.text_input("Código (ej. EMP03)*")
            rs = b.text_input("Razón social*")
            ruc = c.text_input("RUC")
            sector = a.text_input("Sector")
            tipo = b.selectbox("Tipo", ["Industrial", "Comercial", "Servicios", "Pública", "Sin fines de lucro"])
            tam = c.selectbox("Tamaño", ["Micro", "Pequeña", "Mediana", "Grande"])
            tasa = a.number_input("Tasa de impuesto a la renta", 0.0, 0.99, 0.295, 0.005, format="%.3f")
            anio = b.number_input("Año base", 2000, 2100, dt.date.today().year - 1)
            hor = c.text_input("Horizonte del plan", str(dt.date.today().year))
            if st.form_submit_button("Guardar empresa", type="primary", disabled=not ui.puede("editar")):
                if not eid.strip() or not rs.strip():
                    st.error("Código y razón social son obligatorios.")
                else:
                    db.upsert("empresas", dict(empresa_id=eid.strip().upper(), razon_social=rs, ruc=ruc, sector=sector,
                                               tipo=tipo, tamanio=tam, moneda="PEN", unidad_monto="millones",
                                               tasa_ir=tasa, anio_base=int(anio), horizonte_plan=hor),
                              usuario=ui.usuario()["usuario"])
                    ui.refrescar()
                    st.session_state["empresa_id"] = eid.strip().upper()
                    st.session_state["_toast"] = "Empresa registrada."
                    st.rerun()

    tabla = st.selectbox("Tabla a registrar o editar", list(NOMBRE_TABLA), format_func=NOMBRE_TABLA.get)
    global_ = tabla in db.TABLAS_GLOBALES or tabla == "empresas"
    if not global_ and not e:
        st.info("Seleccione o registre una empresa primero.")
        return
    df = ui.leer(tabla, None if global_ else e).drop(columns=["id"], errors="ignore")
    if not global_:
        df = df.drop(columns=["empresa_id"])
    cfg = {}
    for col, opciones in SELECTORES.items():
        if col in df.columns:
            cfg[col] = st.column_config.SelectboxColumn(col, options=opciones)
    if tabla == "iniciativas":
        cfg["tipo"] = st.column_config.SelectboxColumn("tipo", options=config.TIPOS_INICIATIVA)
        cfg["estado"] = st.column_config.SelectboxColumn("estado", options=config.ESTADOS_INICIATIVA)
        for p in db.PUNTAJES:
            cfg[p] = st.column_config.NumberColumn(p, min_value=1, max_value=5, step=1)
    st.caption(("Tabla global (no depende de la empresa). " if global_ else f"Empresa: {ui.nombre_empresa(e)}. ")
               + "Agregue filas con el botón ➕ al pie de la tabla; seleccione filas y pulse 🗑 para eliminarlas.")
    editado = st.data_editor(df, num_rows="dynamic", width="stretch", height=420, column_config=cfg,
                             key=f"ed_{tabla}_{e}", disabled=not ui.puede("editar"))
    c1, c2 = st.columns([1, 4])
    if c1.button("💾 Guardar cambios", type="primary", disabled=not ui.puede("editar"), key=f"sv_{tabla}"):
        try:
            if tabla == "empresas":
                for eid in set(df["empresa_id"]) - set(editado["empresa_id"].dropna()):
                    db.eliminar_empresa(eid, ui.usuario()["usuario"])
                for r in editado.dropna(subset=["empresa_id"]).to_dict("records"):
                    db.upsert("empresas", r, ui.usuario()["usuario"])
                n = len(editado)
            else:
                n = db.reemplazar(tabla, editado, None if global_ else e, ui.usuario()["usuario"])
            ui.refrescar()
            st.session_state["_toast"] = f"{NOMBRE_TABLA[tabla]}: {n} registros guardados."
            st.rerun()
        except ValueError as ex:
            st.error(f"No se guardó. {ex}")
    c2.caption("Los cambios quedan registrados en la bitácora de auditoría.")


def _exportar() -> None:
    e = ui.ctx()["empresa_id"]
    a, b = st.columns(2)
    with a:
        st.markdown("##### Exportar datos y resultados")
        alcance = st.radio("Alcance", ["Empresa seleccionada", "Todas las empresas"], horizontal=True)
        emp = e if alcance == "Empresa seleccionada" else None
        nombre = f"GCE_IA_Export_{emp or 'TODAS'}_{dt.datetime.now():%Y%m%d_%H%M}.xlsx"
        datos = db.exportar_excel(emp)
        st.download_button("⬇️ Descargar Excel", datos, file_name=nombre, type="primary",
                           mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        if st.button("Guardar copia en la carpeta del sistema"):
            config.ruta(nombre).write_bytes(datos)
            st.success(f"Guardado: {nombre}")
    with b:
        st.markdown("##### Plantilla de carga")
        st.write("Libro vacío con todas las hojas y encabezados reconocidos por el importador.")
        st.download_button("⬇️ Descargar plantilla", db.plantilla_excel(), file_name=config.PLANTILLA_XLSX.name,
                           mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


def _respaldo() -> None:
    a, b = st.columns(2)
    with a:
        st.markdown("##### Crear respaldo")
        if st.button("💾 Respaldar base de datos", type="primary"):
            p = db.respaldar()
            db.auditar(ui.usuario()["usuario"], None, "base", "RESPALDO", p.name)
            st.success(f"Respaldo creado: {p.name}")
        if config.DB_PATH.exists():
            st.download_button("⬇️ Descargar gce_ia.db", config.DB_PATH.read_bytes(), file_name="gce_ia.db")
    with b:
        st.markdown("##### Restaurar respaldo")
        f = st.file_uploader("Archivo .db", type=["db"], key="restaurar")
        if f is not None and st.button("Restaurar", disabled=not ui.puede("administrar")):
            try:
                db.restaurar(f.getvalue())
                ui.refrescar()
                st.success("Base restaurada (se creó un respaldo previo).")
            except ValueError as ex:
                st.error(str(ex))
        if not ui.puede("administrar"):
            st.caption("Solo el Administrador puede restaurar.")


# ============================================================ Auditoría
def pagina_auditoria() -> None:
    ui.encabezado("Auditoría y trazabilidad", "Bitácora de acciones, versiones aprobadas y resultados guardados")
    e = ui.ctx()["empresa_id"]
    t1, t2, t3, t4 = st.tabs(["Bitácora", "Versiones y aprobaciones", "Simulaciones guardadas", "Reportes generados"])
    with t1:
        solo = st.toggle("Solo la empresa seleccionada", value=False)
        aud = db.leer("auditoria", e if solo else None, orden="id DESC")
        filtro = st.text_input("Filtrar por texto")
        if filtro:
            aud = aud[aud.astype(str).apply(lambda r: r.str.contains(filtro, case=False)).any(axis=1)]
        st.dataframe(aud.drop(columns=["id"]), hide_index=True, width="stretch", height=480)
    with t2:
        st.dataframe(db.leer("flujo", e), hide_index=True, width="stretch")
        ver = db.leer("versiones", e, orden="id DESC")
        st.dataframe(ver.drop(columns=["snapshot_json", "id"]), hide_index=True, width="stretch")
        if not ver.empty:
            sel = st.selectbox("Ver contenido de la versión", ver["id"].tolist(),
                               format_func=lambda i: " · ".join(str(x) for x in ver.set_index("id").loc[i, ["entidad", "version", "estado", "fecha"]]))
            snap = ver.set_index("id").loc[sel, "snapshot_json"]
            st.json(snap if snap else "{}", expanded=False)
    with t3:
        st.dataframe(db.leer("simulaciones", e, orden="id DESC").drop(columns=["id"]), hide_index=True, width="stretch")
    with t4:
        st.dataframe(db.leer("reportes", e, orden="id DESC").drop(columns=["id"]), hide_index=True, width="stretch")


# ============================================================ Configuración
def pagina_configuracion() -> None:
    ui.mostrar_toast()
    ui.encabezado("Configuración", "Usuarios, datos de demostración, parámetros y acerca del sistema")
    t1, t2, t3 = st.tabs(["Usuarios", "Datos", "Acerca del sistema"])
    with t1:
        if not ui.puede("administrar"):
            st.info("Solo el Administrador gestiona usuarios.")
            with st.form("form_mi_clave"):
                nueva = st.text_input("Nueva clave", type="password")
                if st.form_submit_button("Cambiar mi clave") and nueva:
                    u = ui.usuario()
                    db.guardar_usuario(u["usuario"], u["nombre"], u["rol"], nueva)
                    st.success("Clave actualizada.")
        else:
            usu = db.leer("usuarios")[["usuario", "nombre", "rol", "activo"]]
            st.dataframe(usu, hide_index=True, width="stretch")
            with st.form("form_usuario"):
                a, b, c, d = st.columns(4)
                u = a.text_input("Usuario*")
                n = b.text_input("Nombre")
                r = c.selectbox("Rol", config.ROLES, index=1)
                k = d.text_input("Clave (vacío = sin cambio)", type="password")
                act = st.checkbox("Activo", value=True)
                if st.form_submit_button("Guardar usuario", type="primary"):
                    try:
                        db.guardar_usuario(u.strip(), n or u, r, k or None, act)
                        db.auditar(ui.usuario()["usuario"], None, "usuarios", "GUARDAR", u)
                        st.session_state["_toast"] = "Usuario guardado."
                        st.rerun()
                    except ValueError as ex:
                        st.error(str(ex))
            st.caption("Roles: Administrador (todo) · Analista (editar y proponer) · Aprobador (aprobar) · Consulta (lectura y avance).")
    with t2:
        a, b = st.columns(2)
        with a:
            st.markdown("##### Datos de demostración")
            st.write("Carga las 2 empresas ficticias, 3 escenarios por año y 12 meses de 2027.")
            ui.boton_demo("demo_cfg")
        with b:
            st.markdown("##### Reiniciar base de datos")
            st.write("Vacía las tablas de negocio (se conservan usuarios y bitácora). Se crea un respaldo antes.")
            conf = st.checkbox("Confirmo que deseo vaciar la base")
            if st.button("Vaciar base", disabled=not (conf and ui.puede("administrar"))):
                db.respaldar()
                db.reiniciar_base(ui.usuario()["usuario"])
                ui.refrescar()
                st.session_state["_toast"] = "Base reiniciada (respaldo creado)."
                st.rerun()
        st.markdown("##### Parámetros metodológicos")
        st.dataframe(pd.DataFrame([
            ("Iteraciones Monte Carlo", config.MC_ITERACIONES), ("Semilla", config.MC_SEMILLA),
            ("Umbral P(EVA>0)", f"{config.UMBRAL_PROB_EVA:.0%}"),
            ("Objetivos del mapa", f"{config.MIN_OBJETIVOS}–{config.MAX_OBJETIVOS}"),
            ("KPI del BSC", f"{config.MIN_KPI}–{config.MAX_KPI} (máx. {config.MAX_KPI_POR_OBJETIVO} por objetivo)"),
            ("Pesos de priorización", ", ".join(f"{k[2:]} {v:.0%}" for k, v in config.PESOS_PRIORIZACION.items())),
        ], columns=["Parámetro", "Valor"]).astype(str), hide_index=True, width="stretch")
    with t3:
        st.markdown(f"**{config.APP_NOMBRE}** · versión {config.APP_VERSION}")
        st.write("Sistema informático inteligente para formular el Plan Estratégico y el Balanced Scorecard, "
                 "con simulación de valor (NOPAT, ROIC, WACC, EVA) en varios periodos y escenarios.")
        st.write("Metodología: Kaplan y Norton (sistema de gestión de circuito cerrado, *The Execution Premium*) y "
                 "guía *Planeamiento Estratégico, BSC e IA – Perú 2027*.")
        st.dataframe(pd.DataFrame([
            ("Carpeta del sistema", str(config.BASE_DIR)), ("Base de datos", config.DB_PATH.name),
            ("Python", platform.python_version()), ("Streamlit", st.__version__), ("pandas", pd.__version__),
            ("Plataforma", platform.platform()),
        ], columns=["Elemento", "Valor"]), hide_index=True, width="stretch")
        st.caption("El sistema no utiliza motores de búsqueda de información; toda la inteligencia se ejecuta localmente.")
