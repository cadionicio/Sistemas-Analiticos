# -*- coding: utf-8 -*-
"""
db.py - Capa de datos y semántica (SQLite).

* Crea el esquema completo al primer uso (gce_ia.db dentro de Entregable/).
* CRUD genérico por tabla, bitácora de auditoría, flujo de aprobación y versiones.
* Importación transaccional desde Excel (una hoja por tabla) y exportación.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import io
import json
import os
import shutil
import sqlite3
from contextlib import contextmanager
from pathlib import Path

import pandas as pd

import config

# --------------------------------------------------------------------------- Esquema
# tabla -> (columnas [(nombre, tipo)], clave primaria natural o None = id autoincremental)
ESQUEMA: dict[str, tuple[list[tuple[str, str]], list[str] | None]] = {
    "empresas": ([("empresa_id", "TEXT NOT NULL"), ("razon_social", "TEXT NOT NULL"), ("ruc", "TEXT"),
                  ("sector", "TEXT"), ("tipo", "TEXT"), ("tamanio", "TEXT"), ("moneda", "TEXT"),
                  ("unidad_monto", "TEXT"), ("tasa_ir", "REAL"), ("anio_base", "INTEGER"),
                  ("horizonte_plan", "TEXT")], ["empresa_id"]),
    "identidad": ([("empresa_id", "TEXT NOT NULL"), ("cliente_prioritario", "TEXT"), ("necesidad_critica", "TEXT"),
                   ("oferta_diferenciada", "TEXT"), ("resultado_verificable", "TEXT"),
                   ("capacidades_distintivas", "TEXT"), ("principios_limites", "TEXT"), ("mision", "TEXT"),
                   ("vision", "TEXT"), ("valores", "TEXT"), ("estado", "TEXT")], ["empresa_id"]),
    "diagnostico": ([("empresa_id", "TEXT NOT NULL"), ("tipo", "TEXT"), ("categoria", "TEXT"),
                     ("descripcion", "TEXT"), ("fuente", "TEXT"), ("impacto", "TEXT"),
                     ("implicancia_decision", "TEXT")], None),
    "periodos": ([("periodo_id", "TEXT NOT NULL"), ("tipo", "TEXT"), ("fecha_inicio", "TEXT"),
                  ("fecha_fin", "TEXT"), ("estado", "TEXT")], ["periodo_id"]),
    "escenarios": ([("empresa_id", "TEXT NOT NULL"), ("anio", "TEXT NOT NULL"), ("escenario", "TEXT NOT NULL"),
                    ("ventas", "REAL"), ("margen_ebit", "REAL"), ("capital_invertido", "REAL"), ("wacc", "REAL"),
                    ("tasa_ir", "REAL"), ("probabilidad", "REAL"), ("supuestos", "TEXT")], None),
    "supuestos_mc": ([("empresa_id", "TEXT NOT NULL"), ("anio", "TEXT"), ("variable", "TEXT"),
                      ("distribucion", "TEXT"), ("minimo", "REAL"), ("moda", "REAL"), ("maximo", "REAL"),
                      ("unidad", "TEXT")], None),
    "financieros": ([("empresa_id", "TEXT NOT NULL"), ("periodo_id", "TEXT NOT NULL"), ("escenario", "TEXT"),
                     ("tipo_valor", "TEXT"), ("ventas", "REAL"), ("ebit", "REAL"), ("capital_invertido", "REAL"),
                     ("wacc_anual", "REAL"), ("tasa_ir", "REAL")], None),
    "estrategias": ([("empresa_id", "TEXT NOT NULL"), ("tipo", "TEXT"), ("descripcion", "TEXT"),
                     ("origen", "TEXT"), ("prioridad", "INTEGER"), ("estado", "TEXT")], None),
    "objetivos": ([("empresa_id", "TEXT NOT NULL"), ("objetivo_id", "TEXT NOT NULL"), ("perspectiva", "TEXT"),
                   ("nombre", "TEXT"), ("descripcion", "TEXT"), ("responsable", "TEXT"), ("orden", "INTEGER"),
                   ("estado", "TEXT")], ["empresa_id", "objetivo_id"]),
    "relaciones": ([("empresa_id", "TEXT NOT NULL"), ("objetivo_origen", "TEXT"), ("objetivo_destino", "TEXT"),
                    ("hipotesis", "TEXT"), ("peso", "REAL")], None),
    "kpis": ([("empresa_id", "TEXT NOT NULL"), ("kpi_id", "TEXT NOT NULL"), ("objetivo_id", "TEXT"),
              ("nombre", "TEXT"), ("formula", "TEXT"), ("unidad", "TEXT"), ("sentido", "TEXT"),
              ("linea_base", "REAL"), ("meta", "REAL"), ("tolerancia_ambar", "REAL"), ("frecuencia", "TEXT"),
              ("fuente", "TEXT"), ("tipo", "TEXT"), ("responsable", "TEXT")], ["empresa_id", "kpi_id"]),
    "kpi_valores": ([("empresa_id", "TEXT NOT NULL"), ("kpi_id", "TEXT NOT NULL"), ("periodo_id", "TEXT NOT NULL"),
                     ("tipo_valor", "TEXT NOT NULL"), ("valor", "REAL"), ("calidad_dato", "TEXT")], None),
    "criterios": ([("criterio_id", "TEXT NOT NULL"), ("criterio", "TEXT"), ("peso", "REAL"),
                   ("escala_1_5", "TEXT")], ["criterio_id"]),
    "iniciativas": ([("empresa_id", "TEXT NOT NULL"), ("iniciativa_id", "TEXT NOT NULL"), ("nombre", "TEXT"),
                     ("tipo", "TEXT"), ("objetivo_id", "TEXT"), ("responsable", "TEXT"), ("fecha_inicio", "TEXT"),
                     ("fecha_fin", "TEXT"), ("presupuesto", "REAL"), ("beneficio_bruto_anual", "REAL"),
                     ("costo_anual", "REAL"), ("capital_liberado", "REAL"), ("p_eva", "REAL"),
                     ("p_alineamiento", "REAL"), ("p_tiempo_valor", "REAL"), ("p_factibilidad", "REAL"),
                     ("p_adopcion", "REAL"), ("p_riesgo", "REAL"), ("puerta", "TEXT"), ("estado", "TEXT")],
                    ["empresa_id", "iniciativa_id"]),
    "seguimiento": ([("empresa_id", "TEXT NOT NULL"), ("iniciativa_id", "TEXT NOT NULL"),
                     ("periodo_id", "TEXT NOT NULL"), ("avance_plan", "REAL"), ("avance_real", "REAL"),
                     ("gasto_plan", "REAL"), ("gasto_real", "REAL"), ("beneficio_validado", "REAL"),
                     ("comentario", "TEXT")], None),
    "gantt_tareas": ([("empresa_id", "TEXT NOT NULL"), ("tarea_id", "TEXT NOT NULL"), ("iniciativa_id", "TEXT"),
                      ("tarea", "TEXT"), ("fecha_inicio", "TEXT"), ("fecha_fin", "TEXT"), ("dependencia", "TEXT"),
                      ("responsable", "TEXT"), ("avance", "REAL"), ("estado", "TEXT")], ["empresa_id", "tarea_id"]),
    "riesgos": ([("empresa_id", "TEXT NOT NULL"), ("riesgo_id", "TEXT"), ("riesgo", "TEXT"), ("senal", "TEXT"),
                 ("control_preventivo", "TEXT"), ("kri", "TEXT"), ("probabilidad_1_5", "REAL"),
                 ("impacto_1_5", "REAL"), ("responsable", "TEXT"), ("estado", "TEXT")], None),
    "gatillos": ([("empresa_id", "TEXT NOT NULL"), ("gatillo_id", "TEXT"), ("indicador", "TEXT"),
                  ("operador", "TEXT"), ("umbral", "TEXT"), ("condicion", "TEXT"), ("accion", "TEXT"),
                  ("responsable", "TEXT")], None),
    # ---- tablas del sistema (resultados, control y trazabilidad)
    "usuarios": ([("usuario", "TEXT NOT NULL"), ("nombre", "TEXT"), ("rol", "TEXT"), ("sal", "TEXT"),
                  ("hash_clave", "TEXT"), ("activo", "INTEGER DEFAULT 1")], ["usuario"]),
    "simulaciones": ([("empresa_id", "TEXT"), ("fecha", "TEXT"), ("usuario", "TEXT"), ("tipo", "TEXT"),
                      ("anio", "TEXT"), ("escenario", "TEXT"), ("parametros_json", "TEXT"), ("eva_det", "REAL"),
                      ("p10", "REAL"), ("p50", "REAL"), ("p90", "REAL"), ("prob_eva_pos", "REAL"),
                      ("resultado_json", "TEXT")], None),
    "flujo": ([("empresa_id", "TEXT NOT NULL"), ("entidad", "TEXT NOT NULL"), ("estado", "TEXT"),
               ("version", "INTEGER"), ("actualizado", "TEXT"), ("usuario", "TEXT"), ("comentario", "TEXT")],
              ["empresa_id", "entidad"]),
    "versiones": ([("empresa_id", "TEXT"), ("entidad", "TEXT"), ("version", "INTEGER"), ("estado", "TEXT"),
                   ("snapshot_json", "TEXT"), ("usuario", "TEXT"), ("fecha", "TEXT"), ("comentario", "TEXT")], None),
    "auditoria": ([("fecha", "TEXT"), ("usuario", "TEXT"), ("empresa_id", "TEXT"), ("entidad", "TEXT"),
                   ("accion", "TEXT"), ("detalle", "TEXT")], None),
    "reportes": ([("empresa_id", "TEXT"), ("periodo_id", "TEXT"), ("escenario", "TEXT"), ("archivo", "TEXT"),
                  ("fecha", "TEXT"), ("usuario", "TEXT")], None),
    "documento_plan": ([("empresa_id", "TEXT NOT NULL"), ("seccion", "TEXT NOT NULL"), ("orden", "INTEGER"),
                        ("contenido", "TEXT"), ("origen", "TEXT")], ["empresa_id", "seccion"]),
}

# Hoja de Excel -> tabla
HOJA_TABLA = {
    "Empresas": "empresas", "Identidad": "identidad", "Diagnostico": "diagnostico", "Periodos": "periodos",
    "Escenarios": "escenarios", "Supuestos_MonteCarlo": "supuestos_mc", "Financieros_Mensuales": "financieros",
    "Estrategias": "estrategias", "Objetivos": "objetivos", "Relaciones_Causales": "relaciones", "KPIs": "kpis",
    "KPI_Valores": "kpi_valores", "Criterios_Priorizacion": "criterios", "Iniciativas": "iniciativas",
    "Seguimiento_Iniciativas": "seguimiento", "Gantt_Tareas": "gantt_tareas", "Riesgos": "riesgos",
    "Gatillos": "gatillos",
}
TABLA_HOJA = {v: k for k, v in HOJA_TABLA.items()}
TABLAS_GLOBALES = {"periodos", "criterios"}          # no dependen de empresa
TABLAS_NEGOCIO = list(HOJA_TABLA.values())
NUMERICAS_OBLIGATORIAS = {
    "escenarios": ["ventas", "margen_ebit", "capital_invertido", "wacc", "tasa_ir"],
    "financieros": ["ventas", "ebit", "capital_invertido", "wacc_anual", "tasa_ir"],
    "kpis": ["linea_base", "meta"],
    "kpi_valores": ["valor"],
}
DOMINIOS = {
    ("objetivos", "perspectiva"): config.PERSPECTIVAS,
    ("kpis", "sentido"): config.SENTIDOS,
    ("kpi_valores", "tipo_valor"): config.TIPOS_VALOR,
    ("financieros", "tipo_valor"): config.TIPOS_VALOR,
    ("iniciativas", "tipo"): config.TIPOS_INICIATIVA,
}
PUNTAJES = ["p_eva", "p_alineamiento", "p_tiempo_valor", "p_factibilidad", "p_adopcion", "p_riesgo"]


def columnas(tabla: str) -> list[str]:
    return [c for c, _ in ESQUEMA[tabla][0]]


# --------------------------------------------------------------------------- Conexión
def _ahora() -> str:
    return dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


@contextmanager
def conectar(db_path: Path | str | None = None):
    con = sqlite3.connect(str(db_path or config.DB_PATH), timeout=30)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def inicializar(db_path: Path | str | None = None) -> None:
    """Crea tablas, índices, usuario administrador y criterios por defecto (idempotente)."""
    with conectar(db_path) as con:
        for tabla, (cols, pk) in ESQUEMA.items():
            defs = ([] if pk else ["id INTEGER PRIMARY KEY AUTOINCREMENT"]) + [f'"{c}" {t}' for c, t in cols]
            if pk:
                defs.append("PRIMARY KEY (" + ", ".join(pk) + ")")
            con.execute(f'CREATE TABLE IF NOT EXISTS "{tabla}" ({", ".join(defs)})')
        for tabla in ("financieros", "kpi_valores", "seguimiento"):
            con.execute(f"CREATE INDEX IF NOT EXISTS ix_{tabla}_emp_per ON {tabla}(empresa_id, periodo_id)")
        con.execute("CREATE INDEX IF NOT EXISTS ix_escenarios ON escenarios(empresa_id, anio)")
        con.execute("CREATE INDEX IF NOT EXISTS ix_auditoria ON auditoria(fecha)")
        if con.execute("SELECT COUNT(*) FROM usuarios").fetchone()[0] == 0:
            u, c = config.USUARIO_ADMIN_DEFECTO
            sal, h = _hash(c)
            con.execute("INSERT INTO usuarios VALUES (?,?,?,?,?,1)", (u, "Administrador del sistema", "Administrador", sal, h))
        if con.execute("SELECT COUNT(*) FROM criterios").fetchone()[0] == 0:
            nombres = {"p_eva": "EVA esperado ajustado por probabilidad", "p_alineamiento": "Alineamiento con propuesta de valor",
                       "p_tiempo_valor": "Tiempo a valor dentro de 12 meses", "p_factibilidad": "Factibilidad de datos/proceso",
                       "p_adopcion": "Adopción y capacidad", "p_riesgo": "Riesgo residual"}
            for i, (k, w) in enumerate(config.PESOS_PRIORIZACION.items(), 1):
                con.execute("INSERT INTO criterios VALUES (?,?,?,?)", (f"C{i}", nombres[k], w, "1 (bajo) - 5 (alto)"))


def _hash(clave: str, sal: str | None = None) -> tuple[str, str]:
    sal = sal or os.urandom(8).hex()
    return sal, hashlib.sha256((sal + clave).encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- Usuarios
def autenticar(usuario: str, clave: str) -> dict | None:
    with conectar() as con:
        r = con.execute("SELECT * FROM usuarios WHERE usuario=? AND activo=1", (usuario.strip(),)).fetchone()
    if r and _hash(clave, r["sal"])[1] == r["hash_clave"]:
        return {"usuario": r["usuario"], "nombre": r["nombre"], "rol": r["rol"]}
    return None


def guardar_usuario(usuario: str, nombre: str, rol: str, clave: str | None = None, activo: bool = True) -> None:
    if rol not in config.ROLES:
        raise ValueError("Rol no válido")
    with conectar() as con:
        existe = con.execute("SELECT sal, hash_clave FROM usuarios WHERE usuario=?", (usuario,)).fetchone()
        if clave:
            sal, h = _hash(clave)
        elif existe:
            sal, h = existe["sal"], existe["hash_clave"]
        else:
            raise ValueError("Debe indicar una clave para el usuario nuevo")
        con.execute("INSERT OR REPLACE INTO usuarios VALUES (?,?,?,?,?,?)", (usuario, nombre, rol, sal, h, int(activo)))


# --------------------------------------------------------------------------- Lectura / escritura
def leer(tabla: str, empresa_id: str | None = None, where: str = "", params: tuple = (), orden: str = "") -> pd.DataFrame:
    if tabla not in ESQUEMA:
        raise ValueError(f"Tabla desconocida: {tabla}")
    cond, p = [], list(params)
    if empresa_id is not None and "empresa_id" in columnas(tabla):
        cond.append("empresa_id = ?")
        p.insert(0, empresa_id)
    if where:
        cond.append(f"({where})")
    sql = f'SELECT * FROM "{tabla}"' + (" WHERE " + " AND ".join(cond) if cond else "")
    sql += f" ORDER BY {orden}" if orden else (" ORDER BY id" if ESQUEMA[tabla][1] is None else "")
    with conectar() as con:
        return pd.read_sql_query(sql, con, params=p)


def consulta(sql: str, params: tuple = ()) -> pd.DataFrame:
    with conectar() as con:
        return pd.read_sql_query(sql, con, params=list(params))


def ejecutar(sql: str, params: tuple = ()) -> None:
    with conectar() as con:
        con.execute(sql, params)


def _limpiar(df: pd.DataFrame, tabla: str) -> pd.DataFrame:
    cols = columnas(tabla)
    d = df.copy()
    d.columns = [str(c).strip() for c in d.columns]
    d = d[[c for c in d.columns if c in cols]]
    for c in cols:
        if c not in d.columns:
            d[c] = None
    d = d[cols]
    d = d.dropna(how="all")
    for c, t in ESQUEMA[tabla][0]:
        if t.startswith("TEXT"):
            d[c] = d[c].map(_a_texto)
        elif t.startswith("REAL"):
            d[c] = pd.to_numeric(d[c], errors="coerce")
        elif t.startswith("INTEGER"):
            d[c] = pd.to_numeric(d[c], errors="coerce").astype("Int64")
    return d


def _a_texto(v):
    if v is None or (isinstance(v, float) and pd.isna(v)) or v is pd.NaT:
        return None
    if isinstance(v, (pd.Timestamp, dt.datetime)):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, dt.date):
        return v.isoformat()
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    s = str(v).strip()
    return s if s else None


def _insertar(con, tabla: str, d: pd.DataFrame) -> int:
    cols = columnas(tabla)
    ph = ", ".join("?" for _ in cols)
    verbo = "INSERT OR REPLACE" if ESQUEMA[tabla][1] else "INSERT"
    filas = [tuple(_py(x) for x in fila) for fila in d.itertuples(index=False, name=None)]
    con.executemany(f'{verbo} INTO "{tabla}" ({", ".join(cols)}) VALUES ({ph})', filas)
    return len(filas)


def _py(x):
    """Convierte tipos numpy/pandas a tipos nativos de Python para sqlite3."""
    if x is None:
        return None
    try:
        if pd.isna(x):
            return None
    except (TypeError, ValueError):
        pass
    if hasattr(x, "item"):
        return x.item()
    return x


def reemplazar(tabla: str, df: pd.DataFrame, empresa_id: str | None = None, usuario: str = "sistema",
               detalle: str = "") -> int:
    """Reemplaza el contenido de una tabla (o de una empresa dentro de ella) por df."""
    d = _limpiar(df, tabla)
    if empresa_id is not None and "empresa_id" in d.columns:
        d["empresa_id"] = empresa_id
    errores = validar_tabla(tabla, d)
    if errores:
        raise ValueError("; ".join(errores[:10]))
    with conectar() as con:
        if empresa_id is not None and "empresa_id" in columnas(tabla):
            con.execute(f'DELETE FROM "{tabla}" WHERE empresa_id=?', (empresa_id,))
        else:
            con.execute(f'DELETE FROM "{tabla}"')
        n = _insertar(con, tabla, d)
        _auditar(con, usuario, empresa_id, tabla, "EDICION", detalle or f"{n} registros guardados")
    return n


def upsert(tabla: str, registro: dict, usuario: str = "sistema") -> None:
    d = _limpiar(pd.DataFrame([registro]), tabla)
    errores = validar_tabla(tabla, d)
    if errores:
        raise ValueError("; ".join(errores))
    with conectar() as con:
        _insertar(con, tabla, d)
        _auditar(con, usuario, registro.get("empresa_id"), tabla, "REGISTRO", json.dumps(registro, default=str)[:500])


def eliminar_empresa(empresa_id: str, usuario: str = "sistema") -> None:
    with conectar() as con:
        for tabla in ESQUEMA:
            if tabla != "auditoria" and "empresa_id" in columnas(tabla):
                con.execute(f'DELETE FROM "{tabla}" WHERE empresa_id=?', (empresa_id,))
        _auditar(con, usuario, empresa_id, "empresas", "ELIMINACION", "Empresa y datos asociados eliminados")


# --------------------------------------------------------------------------- Validación
def validar_tabla(tabla: str, d: pd.DataFrame) -> list[str]:
    err = []
    cols, pk = ESQUEMA[tabla]
    for c, t in cols:
        if "NOT NULL" in t and d[c].isna().any():
            filas = (d.index[d[c].isna()] + 2).tolist()[:5]
            err.append(f"{tabla}.{c}: valores vacíos (filas {filas})")
    if pk:
        dup = d.duplicated(subset=pk, keep=False)
        if dup.any():
            err.append(f"{tabla}: clave duplicada {pk} en filas {(d.index[dup] + 2).tolist()[:5]}")
    for c in NUMERICAS_OBLIGATORIAS.get(tabla, []):
        if d[c].isna().any():
            err.append(f"{tabla}.{c}: debe ser numérico (filas {(d.index[d[c].isna()] + 2).tolist()[:5]})")
    for (t, c), dominio in DOMINIOS.items():
        if t == tabla:
            malos = d[c].notna() & ~d[c].isin(dominio)
            if malos.any():
                err.append(f"{tabla}.{c}: valores no permitidos {sorted(d.loc[malos, c].unique())[:5]} (use {dominio})")
    if tabla == "iniciativas":
        for c in PUNTAJES:
            v = d[c].dropna()
            if ((v < 1) | (v > 5)).any():
                err.append(f"iniciativas.{c}: los puntajes deben estar entre 1 y 5")
    if tabla == "escenarios":
        if ((d["tasa_ir"] < 0) | (d["tasa_ir"] >= 1)).any() or ((d["wacc"] <= 0) | (d["wacc"] >= 1)).any():
            err.append("escenarios: tasa_ir y wacc deben expresarse como fracción (ej. 0.12)")
    return err


# --------------------------------------------------------------------------- Excel
def importar_excel(fuente, usuario: str = "sistema", modo: str = "reemplazar", validar_solo: bool = False) -> dict:
    """
    Importa un libro Excel (ruta o bytes). Cada hoja reconocida (HOJA_TABLA) se valida y
    se carga en una sola transacción: si hay errores, no se graba nada.
    modo="reemplazar": borra los datos previos de las empresas presentes en el archivo.
    """
    if isinstance(fuente, (bytes, bytearray)):
        fuente = io.BytesIO(fuente)
    xls = pd.ExcelFile(fuente, engine="openpyxl")
    resumen, errores, datos = {}, [], {}
    for hoja in xls.sheet_names:
        tabla = HOJA_TABLA.get(hoja.strip())
        if not tabla:
            continue
        crudo = xls.parse(hoja)
        if tabla == "criterios":
            crudo = crudo[crudo["criterio_id"].astype(str).str.upper().str.strip() != "TOTAL"]
        faltan = [c for c, t in ESQUEMA[tabla][0] if "NOT NULL" in t and c not in [str(x).strip() for x in crudo.columns]]
        if faltan:
            errores.append(f"Hoja {hoja}: faltan columnas obligatorias {faltan}")
            continue
        d = _limpiar(crudo, tabla)
        errores += [f"Hoja {hoja}: {e}" for e in validar_tabla(tabla, d)]
        datos[tabla] = d
        resumen[hoja] = len(d)
    if not datos:
        errores.append("El archivo no contiene hojas reconocidas. Use la plantilla del sistema.")
    if "criterios" in datos and not datos["criterios"].empty:
        s = datos["criterios"]["peso"].sum()
        if abs(s - 1) > 1e-6:
            errores.append(f"Hoja Criterios_Priorizacion: los pesos suman {s:.2%} (deben sumar 100%)")
    empresas_archivo = sorted({e for d in datos.values() if "empresa_id" in d.columns for e in d["empresa_id"].dropna()})
    if empresas_archivo and "empresas" not in datos:
        existentes = set(leer("empresas")["empresa_id"])
        faltantes = [e for e in empresas_archivo if e not in existentes]
        if faltantes:
            errores.append(f"Empresas no registradas: {faltantes}. Incluya la hoja Empresas.")
    salida = {"ok": not errores, "errores": errores, "resumen": resumen, "empresas": empresas_archivo}
    if errores or validar_solo:
        return salida
    with conectar() as con:
        for tabla, d in datos.items():
            if tabla in TABLAS_GLOBALES:
                _insertar(con, tabla, d)          # upsert por clave
                continue
            if modo == "reemplazar":
                for e in d["empresa_id"].dropna().unique():
                    con.execute(f'DELETE FROM "{tabla}" WHERE empresa_id=?', (str(e),))
            _insertar(con, tabla, d)
        for e in empresas_archivo:
            _auditar(con, usuario, e, "importacion", "IMPORTAR_EXCEL",
                     json.dumps(resumen, ensure_ascii=False))
    return salida


def exportar_excel(empresa_id: str | None = None, incluir_resultados: bool = True) -> bytes:
    """Genera un libro Excel con las tablas de negocio (y resultados del sistema)."""
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as xw:
        for tabla in TABLAS_NEGOCIO:
            df = leer(tabla, empresa_id if tabla not in TABLAS_GLOBALES else None)
            df.drop(columns=[c for c in ("id",) if c in df.columns]).to_excel(xw, sheet_name=TABLA_HOJA[tabla], index=False)
        if incluir_resultados:
            for tabla, hoja in (("simulaciones", "R_Simulaciones"), ("flujo", "R_Aprobaciones"),
                                ("auditoria", "R_Auditoria"), ("reportes", "R_Reportes")):
                leer(tabla, empresa_id).to_excel(xw, sheet_name=hoja, index=False)
    return buf.getvalue()


def plantilla_excel() -> bytes:
    """Libro vacío con todas las hojas y encabezados que reconoce el importador."""
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as xw:
        pd.DataFrame({"Instrucciones": [
            "Complete cada hoja respetando los encabezados (no los modifique).",
            "Porcentajes como fracción: 12% = 0.12. Fechas AAAA-MM-DD. Periodos 'AAAA' o 'AAAA-MM'.",
            "perspectiva: " + ", ".join(config.PERSPECTIVAS) + " | sentido: " + ", ".join(config.SENTIDOS),
            "tipo_valor: Meta o Real | tipo de iniciativa: IA o Tradicional | puntajes de 1 a 5.",
            "Vea 10_Data_Prueba.xlsx como ejemplo completo.",
        ]}).to_excel(xw, sheet_name="LEEME", index=False)
        for tabla in TABLAS_NEGOCIO:
            pd.DataFrame(columns=columnas(tabla)).to_excel(xw, sheet_name=TABLA_HOJA[tabla], index=False)
    return buf.getvalue()


# --------------------------------------------------------------------------- Auditoría, flujo y versiones
def _auditar(con, usuario, empresa_id, entidad, accion, detalle=""):
    con.execute("INSERT INTO auditoria (fecha, usuario, empresa_id, entidad, accion, detalle) VALUES (?,?,?,?,?,?)",
                (_ahora(), usuario, empresa_id, entidad, accion, str(detalle)[:2000]))


def auditar(usuario: str, empresa_id: str | None, entidad: str, accion: str, detalle: str = "") -> None:
    with conectar() as con:
        _auditar(con, usuario, empresa_id, entidad, accion, detalle)


def estado_flujo(empresa_id: str, entidad: str) -> dict:
    with conectar() as con:
        r = con.execute("SELECT * FROM flujo WHERE empresa_id=? AND entidad=?", (empresa_id, entidad)).fetchone()
    return dict(r) if r else {"empresa_id": empresa_id, "entidad": entidad, "estado": "Borrador", "version": 0,
                              "actualizado": None, "usuario": None, "comentario": None}


def cambiar_estado(empresa_id: str, entidad: str, nuevo: str, usuario: str, comentario: str = "",
                   snapshot: dict | None = None) -> dict:
    """Regla RN09. Al aprobar se incrementa la versión y se guarda una foto (snapshot)."""
    if nuevo not in config.ESTADOS_FLUJO:
        raise ValueError(f"Estado no válido: {nuevo}")
    actual = estado_flujo(empresa_id, entidad)
    version = int(actual["version"] or 0) + (1 if nuevo == "Aprobado" else 0)
    with conectar() as con:
        con.execute("INSERT OR REPLACE INTO flujo VALUES (?,?,?,?,?,?,?)",
                    (empresa_id, entidad, nuevo, version, _ahora(), usuario, comentario))
        con.execute("INSERT INTO versiones (empresa_id, entidad, version, estado, snapshot_json, usuario, fecha, comentario)"
                    " VALUES (?,?,?,?,?,?,?,?)",
                    (empresa_id, entidad, version, nuevo,
                     json.dumps(snapshot, ensure_ascii=False, default=str) if snapshot else None,
                     usuario, _ahora(), comentario))
        _auditar(con, usuario, empresa_id, entidad, f"ESTADO:{nuevo}", comentario)
    return estado_flujo(empresa_id, entidad)


def snapshot(empresa_id: str, tablas: list[str]) -> dict:
    return {t: leer(t, empresa_id).drop(columns=["id"], errors="ignore").to_dict("records") for t in tablas}


def guardar_simulacion(registro: dict) -> None:
    registro = {**registro, "fecha": registro.get("fecha") or _ahora()}
    for k in ("parametros_json", "resultado_json"):
        if isinstance(registro.get(k), (dict, list)):
            registro[k] = json.dumps(registro[k], ensure_ascii=False, default=str)
    cols = [c for c in columnas("simulaciones") if c in registro]
    with conectar() as con:
        con.execute(f"INSERT INTO simulaciones ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})",
                    tuple(_py(registro[c]) for c in cols))


def registrar_reporte(empresa_id, periodo_id, escenario, archivo, usuario) -> None:
    with conectar() as con:
        con.execute("INSERT INTO reportes (empresa_id, periodo_id, escenario, archivo, fecha, usuario) VALUES (?,?,?,?,?,?)",
                    (empresa_id, periodo_id, escenario, archivo, _ahora(), usuario))
        _auditar(con, usuario, empresa_id, "reportes", "GENERAR_PPT", archivo)


# --------------------------------------------------------------------------- Respaldo
def respaldar() -> Path:
    destino = config.ruta(f"gce_ia_respaldo_{dt.datetime.now():%Y%m%d_%H%M%S}.db")
    with conectar() as con:
        bk = sqlite3.connect(str(destino))
        con.backup(bk)
        bk.close()
    return destino


def restaurar(contenido: bytes) -> None:
    if not contenido.startswith(b"SQLite format 3"):
        raise ValueError("El archivo no es una base de datos SQLite válida.")
    tmp = config.ruta("gce_ia_restaurar.tmp")
    tmp.write_bytes(contenido)
    try:
        with conectar(tmp) as con:
            con.execute("SELECT COUNT(*) FROM empresas").fetchone()
        respaldar()
        shutil.copyfile(tmp, config.DB_PATH)
    finally:
        tmp.unlink(missing_ok=True)
    inicializar()


def reiniciar_base(usuario: str = "sistema") -> None:
    """Vacía las tablas de negocio (conserva usuarios y auditoría)."""
    with conectar() as con:
        for tabla in ESQUEMA:
            if tabla not in ("usuarios", "auditoria"):
                con.execute(f'DELETE FROM "{tabla}"')
        _auditar(con, usuario, None, "base", "REINICIAR", "Tablas de negocio vaciadas")
    inicializar()


def conteo_tablas() -> pd.DataFrame:
    with conectar() as con:
        filas = [(TABLA_HOJA.get(t, t), t, con.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]) for t in ESQUEMA]
    return pd.DataFrame(filas, columns=["Hoja / Entidad", "Tabla", "Registros"])


def empresas_lista() -> pd.DataFrame:
    return leer("empresas", orden="empresa_id")
