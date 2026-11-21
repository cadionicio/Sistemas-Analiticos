# -*- coding: utf-8 -*-
"""
CANVAS MODEL IA - Capa de datos (db.py)
---------------------------------------
Base de datos SQLite local, esquema, reglas de integridad (triggers),
auditoría append-only con hash encadenado, CRUD genérico con auditoría,
carga de datos desde Excel con validación y cuarentena, y exportación.

Todas las rutas apuntan a ./Entregable/
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
import sqlite3
from datetime import datetime
from typing import Any

import pandas as pd

# ----------------------------------------------------------------------------
# Rutas (todo el proyecto vive en ./Entregable/)
# ----------------------------------------------------------------------------
BASE_DIR = "./Entregable/"
DB_PATH = "./Entregable/canvas_model_ia.db"
DATA_PRUEBA_PATH = "./Entregable/10_Data_Prueba.xlsx"


def asegurar_directorio() -> None:
    """Garantiza que ./Entregable/ exista respecto del directorio de trabajo."""
    if not os.path.isdir(BASE_DIR) and os.path.basename(os.getcwd()).lower() == "entregable":
        os.chdir("..")
    os.makedirs(BASE_DIR, exist_ok=True)


def ruta_data_prueba() -> str | None:
    """Ubica el Excel de prueba (en ./Entregable/ o junto a la app en la versión HTML)."""
    for p in (DATA_PRUEBA_PATH, "./10_Data_Prueba.xlsx"):
        if os.path.exists(p):
            return p
    return None


# ----------------------------------------------------------------------------
# Catálogos
# ----------------------------------------------------------------------------
SECTORES = ["Industrial", "Comercial", "Servicios"]
TAMANOS = ["Micro", "Pequeña", "Mediana", "Grande"]
ROLES = ["Administrador", "Gerente", "PMO", "Analista", "Auditor"]
BLOQUES = ["SC", "PV", "CH", "RC", "FI", "RK", "AC", "SK", "EC"]
TIPOS_ESCENARIO = ["Pesimista", "Base", "Optimista", "Personalizado"]
TIPOS_CANVAS = ["AS IS", "TO BE"]
ESTADOS_VERSION = ["Borrador", "En revisión", "Aprobado", "Rechazado", "Reemplazado"]
NATURALEZAS = ["Hecho", "Hipótesis", "Supuesto"]
CONFIANZAS = ["Baja", "Media", "Alta"]
TIPOS_CAMBIO = ["Crear", "Modificar", "Eliminar", "Mantener", "N/A"]
ORIGENES = ["Manual", "IA", "Excel"]
ESTADOS_HIP = ["Pendiente", "Validada", "Refutada"]
TIPOS_PROY = ["Proyecto", "Experimento"]
ESTADOS_PROY = ["Propuesto", "Aprobado", "En ejecución", "En pausa", "Cerrado", "Cancelado", "Rechazado"]
ESTADOS_APROB = ["Propuesto", "Aprobado", "Rechazado"]
SENTIDOS = ["Mayor es mejor", "Menor es mejor"]
CALIDADES = ["OK", "Estimado", "Observado"]
ESTADOS_RIESGO = ["Abierto", "Materializado", "Cerrado"]


def _in(cat: list[str]) -> str:
    return "(" + ",".join("'" + c + "'" for c in cat) + ")"


# ----------------------------------------------------------------------------
# Esquema
# ----------------------------------------------------------------------------
SCHEMA = f"""
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organizacion (
    org_id TEXT PRIMARY KEY,
    razon_social TEXT NOT NULL,
    ruc TEXT,
    sector TEXT NOT NULL CHECK (sector IN {_in(SECTORES)}),
    tamano TEXT NOT NULL CHECK (tamano IN {_in(TAMANOS)}),
    ventas_anuales_pen REAL DEFAULT 0 CHECK (ventas_anuales_pen >= 0),
    madurez_digital INTEGER DEFAULT 1 CHECK (madurez_digital BETWEEN 1 AND 5),
    moneda TEXT DEFAULT 'PEN',
    fecha_alta TEXT,
    activo INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS usuario (
    user_id TEXT PRIMARY KEY,
    usuario TEXT UNIQUE NOT NULL,
    nombre TEXT,
    pwd_hash TEXT NOT NULL,
    rol TEXT NOT NULL CHECK (rol IN {_in(ROLES)}),
    org_id TEXT,
    activo INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS parametro (
    clave TEXT PRIMARY KEY,
    valor TEXT,
    descripcion TEXT
);

CREATE TABLE IF NOT EXISTS escenario (
    escenario_id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizacion(org_id),
    nombre TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN {_in(TIPOS_ESCENARIO)}),
    horizonte_meses INTEGER DEFAULT 12 CHECK (horizonte_meses BETWEEN 1 AND 36),
    factor_demanda REAL DEFAULT 1 CHECK (factor_demanda > 0),
    factor_precio REAL DEFAULT 1 CHECK (factor_precio > 0),
    factor_costo REAL DEFAULT 1 CHECK (factor_costo > 0),
    probabilidad REAL DEFAULT 0 CHECK (probabilidad BETWEEN 0 AND 1),
    descripcion TEXT
);

CREATE TABLE IF NOT EXISTS canvas_version (
    version_id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizacion(org_id),
    tipo TEXT NOT NULL CHECK (tipo IN {_in(TIPOS_CANVAS)}),
    escenario_id TEXT REFERENCES escenario(escenario_id),
    numero INTEGER DEFAULT 1,
    estado TEXT NOT NULL DEFAULT 'Borrador' CHECK (estado IN {_in(ESTADOS_VERSION)}),
    fecha_corte TEXT,
    deriva_de TEXT REFERENCES canvas_version(version_id),
    horizonte_meses INTEGER DEFAULT 0,
    autor TEXT,
    aprobador TEXT,
    fecha_aprobacion TEXT,
    comentario TEXT,
    hash_contenido TEXT,
    creado_en TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS canvas_elemento (
    elemento_id TEXT PRIMARY KEY,
    version_id TEXT NOT NULL REFERENCES canvas_version(version_id),
    bloque TEXT NOT NULL CHECK (bloque IN {_in(BLOQUES)}),
    descripcion TEXT NOT NULL,
    naturaleza TEXT DEFAULT 'Hipótesis' CHECK (naturaleza IN {_in(NATURALEZAS)}),
    evidencia TEXT,
    fuente TEXT,
    confianza TEXT DEFAULT 'Media' CHECK (confianza IN {_in(CONFIANZAS)}),
    responsable TEXT,
    kpi_id TEXT,
    tipo_cambio TEXT DEFAULT 'N/A' CHECK (tipo_cambio IN {_in(TIPOS_CAMBIO)}),
    elemento_origen_id TEXT,
    origen TEXT DEFAULT 'Manual' CHECK (origen IN {_in(ORIGENES)})
);

CREATE TABLE IF NOT EXISTS hipotesis (
    hip_id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizacion(org_id),
    elemento_id TEXT REFERENCES canvas_elemento(elemento_id),
    enunciado TEXT NOT NULL,
    evidencia_requerida TEXT,
    criterio_validacion TEXT,
    umbral TEXT,
    fecha_limite TEXT,
    responsable TEXT,
    estado TEXT DEFAULT 'Pendiente' CHECK (estado IN {_in(ESTADOS_HIP)})
);

CREATE TABLE IF NOT EXISTS brecha (
    brecha_id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizacion(org_id),
    version_asis_id TEXT REFERENCES canvas_version(version_id),
    version_tobe_id TEXT REFERENCES canvas_version(version_id),
    bloque TEXT CHECK (bloque IN {_in(BLOQUES)}),
    as_is TEXT,
    to_be TEXT,
    tipo_cambio TEXT CHECK (tipo_cambio IN {_in(TIPOS_CAMBIO)}),
    impacto INTEGER CHECK (impacto BETWEEN 1 AND 5),
    esfuerzo INTEGER CHECK (esfuerzo BETWEEN 1 AND 5),
    riesgo INTEGER CHECK (riesgo BETWEEN 1 AND 5),
    score REAL,
    prioridad TEXT,
    justificacion TEXT,
    proyecto_id TEXT
);

CREATE TABLE IF NOT EXISTS proyecto (
    proyecto_id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizacion(org_id),
    brecha_id TEXT REFERENCES brecha(brecha_id),
    nombre TEXT NOT NULL,
    tipo TEXT DEFAULT 'Proyecto' CHECK (tipo IN {_in(TIPOS_PROY)}),
    objetivo TEXT,
    responsable TEXT,
    sponsor TEXT,
    presupuesto_pen REAL DEFAULT 0 CHECK (presupuesto_pen >= 0),
    fecha_inicio TEXT,
    fecha_fin TEXT,
    estado TEXT DEFAULT 'Propuesto' CHECK (estado IN {_in(ESTADOS_PROY)}),
    aprobado_por TEXT,
    fecha_aprobacion TEXT,
    kpi_principal TEXT,
    criterio_parada TEXT,
    CHECK (fecha_fin IS NULL OR fecha_inicio IS NULL OR fecha_fin >= fecha_inicio)
);

CREATE TABLE IF NOT EXISTS hito (
    hito_id TEXT PRIMARY KEY,
    proyecto_id TEXT NOT NULL REFERENCES proyecto(proyecto_id),
    tarea TEXT NOT NULL,
    responsable TEXT,
    fecha_inicio TEXT NOT NULL,
    fecha_fin TEXT NOT NULL,
    dependencia TEXT,
    peso_pct REAL DEFAULT 0,
    avance_plan_pct REAL DEFAULT 0 CHECK (avance_plan_pct BETWEEN 0 AND 100),
    avance_real_pct REAL DEFAULT 0 CHECK (avance_real_pct BETWEEN 0 AND 100),
    estado_aprobacion TEXT DEFAULT 'Propuesto' CHECK (estado_aprobacion IN {_in(ESTADOS_APROB)}),
    version_gantt INTEGER DEFAULT 1,
    CHECK (fecha_fin >= fecha_inicio)
);

CREATE TABLE IF NOT EXISTS avance_mensual (
    proyecto_id TEXT NOT NULL REFERENCES proyecto(proyecto_id),
    periodo TEXT NOT NULL,
    avance_plan_pct REAL CHECK (avance_plan_pct BETWEEN 0 AND 100),
    avance_real_pct REAL CHECK (avance_real_pct IS NULL OR avance_real_pct BETWEEN 0 AND 100),
    costo_plan_pen REAL,
    costo_real_pen REAL,
    comentario TEXT,
    PRIMARY KEY (proyecto_id, periodo)
);

CREATE TABLE IF NOT EXISTS riesgo (
    riesgo_id TEXT PRIMARY KEY,
    proyecto_id TEXT NOT NULL REFERENCES proyecto(proyecto_id),
    descripcion TEXT NOT NULL,
    probabilidad INTEGER CHECK (probabilidad BETWEEN 1 AND 5),
    impacto INTEGER CHECK (impacto BETWEEN 1 AND 5),
    mitigacion TEXT,
    responsable TEXT,
    estado TEXT DEFAULT 'Abierto' CHECK (estado IN {_in(ESTADOS_RIESGO)})
);

CREATE TABLE IF NOT EXISTS kpi (
    kpi_id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizacion(org_id),
    proyecto_id TEXT REFERENCES proyecto(proyecto_id),
    nombre TEXT NOT NULL,
    formula TEXT,
    unidad TEXT,
    frecuencia TEXT DEFAULT 'Mensual',
    linea_base REAL,
    meta REAL,
    tolerancia_pct REAL DEFAULT 5,
    sentido TEXT DEFAULT 'Mayor es mejor' CHECK (sentido IN {_in(SENTIDOS)}),
    dueno TEXT,
    fuente TEXT
);

CREATE TABLE IF NOT EXISTS kpi_observacion (
    kpi_id TEXT NOT NULL REFERENCES kpi(kpi_id),
    periodo TEXT NOT NULL,
    valor_plan REAL,
    valor_real REAL,
    calidad TEXT DEFAULT 'OK' CHECK (calidad IN {_in(CALIDADES)}),
    fuente TEXT,
    cargado_en TEXT DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (kpi_id, periodo)
);

CREATE TABLE IF NOT EXISTS prediccion (
    pred_id INTEGER PRIMARY KEY AUTOINCREMENT,
    kpi_id TEXT NOT NULL REFERENCES kpi(kpi_id),
    escenario_id TEXT,
    fecha_corte TEXT NOT NULL,
    periodo_objetivo TEXT NOT NULL,
    modelo TEXT NOT NULL,
    n_obs INTEGER,
    p10 REAL, p50 REAL, p90 REAL,
    mae REAL, wape REAL, sesgo REAL, mejora_vs_naive REAL,
    semaforo TEXT CHECK (semaforo IN ('Verde','Ámbar','Rojo','Gris')),
    advertencia TEXT NOT NULL,
    dataset_hash TEXT,
    creado_en TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS simulacion (
    sim_id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id TEXT, escenario_id TEXT, kpi_id TEXT, periodo TEXT,
    p10 REAL, p50 REAL, p90 REAL,
    creado_en TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS carga_datos (
    carga_id INTEGER PRIMARY KEY AUTOINCREMENT,
    archivo TEXT, hash_sha256 TEXT, hojas TEXT,
    filas_ok INTEGER, filas_error INTEGER, filas_omitidas INTEGER,
    usuario TEXT, fecha TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS cuarentena (
    cuar_id INTEGER PRIMARY KEY AUTOINCREMENT,
    carga_id INTEGER REFERENCES carga_datos(carga_id),
    hoja TEXT, fila INTEGER, error TEXT, datos_json TEXT
);

CREATE TABLE IF NOT EXISTS ia_ejecucion (
    ia_id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id TEXT, tarea TEXT, motor TEXT, prompt_version TEXT,
    entrada TEXT, salida_json TEXT, estado_revision TEXT DEFAULT 'Pendiente de revisión',
    usuario TEXT, fecha TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS auditoria (
    audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL,
    usuario TEXT,
    entidad TEXT,
    entidad_id TEXT,
    accion TEXT,
    antes_json TEXT,
    despues_json TEXT,
    hash_prev TEXT,
    hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reporte (
    reporte_id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id TEXT, tipo TEXT, archivo TEXT,
    fecha TEXT DEFAULT (datetime('now','localtime')), usuario TEXT
);

-- ---------------- Reglas de inmutabilidad (RN-07) ----------------
CREATE TRIGGER IF NOT EXISTS trg_elem_upd_bloqueado
BEFORE UPDATE ON canvas_elemento
WHEN (SELECT estado FROM canvas_version WHERE version_id = OLD.version_id) IN ('Aprobado','Reemplazado')
BEGIN SELECT RAISE(ABORT, 'Versión aprobada: inmutable. Use Clonar para crear una nueva versión.'); END;

CREATE TRIGGER IF NOT EXISTS trg_elem_del_bloqueado
BEFORE DELETE ON canvas_elemento
WHEN (SELECT estado FROM canvas_version WHERE version_id = OLD.version_id) IN ('Aprobado','Reemplazado')
BEGIN SELECT RAISE(ABORT, 'Versión aprobada: inmutable. Use Clonar para crear una nueva versión.'); END;

CREATE TRIGGER IF NOT EXISTS trg_elem_ins_bloqueado
BEFORE INSERT ON canvas_elemento
WHEN (SELECT estado FROM canvas_version WHERE version_id = NEW.version_id) IN ('Aprobado','Reemplazado')
BEGIN SELECT RAISE(ABORT, 'Versión aprobada: inmutable. No se pueden agregar elementos.'); END;

CREATE TRIGGER IF NOT EXISTS trg_version_bloqueada
BEFORE UPDATE ON canvas_version
WHEN OLD.estado IN ('Aprobado','Reemplazado')
 AND NOT (OLD.estado = 'Aprobado' AND NEW.estado = 'Reemplazado')
 AND NOT (OLD.estado = NEW.estado AND OLD.hash_contenido IS NEW.hash_contenido
          AND OLD.comentario IS NEW.comentario AND OLD.fecha_corte IS NEW.fecha_corte)
BEGIN SELECT RAISE(ABORT, 'Versión aprobada: inmutable.'); END;

CREATE TRIGGER IF NOT EXISTS trg_version_del
BEFORE DELETE ON canvas_version
WHEN OLD.estado IN ('Aprobado','Reemplazado')
BEGIN SELECT RAISE(ABORT, 'Versión aprobada: no se puede eliminar.'); END;

-- ---------------- Auditoría append-only (RNF-07) ----------------
CREATE TRIGGER IF NOT EXISTS trg_audit_no_update
BEFORE UPDATE ON auditoria
BEGIN SELECT RAISE(ABORT, 'La auditoría es append-only.'); END;

CREATE TRIGGER IF NOT EXISTS trg_audit_no_delete
BEFORE DELETE ON auditoria
BEGIN SELECT RAISE(ABORT, 'La auditoría es append-only.'); END;

CREATE INDEX IF NOT EXISTS ix_elem_version ON canvas_elemento(version_id);
CREATE INDEX IF NOT EXISTS ix_obs_kpi ON kpi_observacion(kpi_id);
CREATE INDEX IF NOT EXISTS ix_pred_kpi ON prediccion(kpi_id);
CREATE INDEX IF NOT EXISTS ix_audit_ent ON auditoria(entidad, entidad_id);
"""

# Clave primaria por tabla (para CRUD genérico)
PK: dict[str, list[str]] = {
    "organizacion": ["org_id"], "usuario": ["user_id"], "parametro": ["clave"],
    "escenario": ["escenario_id"], "canvas_version": ["version_id"],
    "canvas_elemento": ["elemento_id"], "hipotesis": ["hip_id"], "brecha": ["brecha_id"],
    "proyecto": ["proyecto_id"], "hito": ["hito_id"], "avance_mensual": ["proyecto_id", "periodo"],
    "riesgo": ["riesgo_id"], "kpi": ["kpi_id"], "kpi_observacion": ["kpi_id", "periodo"],
}

# Orden de carga respetando claves foráneas
ORDEN_CARGA = ["organizacion", "usuario", "parametro", "escenario", "canvas_version",
               "canvas_elemento", "hipotesis", "brecha", "proyecto", "hito",
               "avance_mensual", "riesgo", "kpi", "kpi_observacion"]

PARAMETROS_DEFECTO = [
    ("UIT_2026", "5500", "Valor de la UIT 2026 en soles (D.S. N.° 301-2025-EF)"),
    ("LIMITE_MICRO_UIT", "150", "Ley 30056: microempresa hasta 150 UIT"),
    ("LIMITE_PEQUENA_UIT", "1700", "Ley 30056: pequeña hasta 1 700 UIT"),
    ("LIMITE_MEDIANA_UIT", "2300", "Ley 30056: mediana hasta 2 300 UIT"),
    ("SEMAFORO_PROY_VERDE", "0.95", "SPI y CPI mínimos para Verde"),
    ("SEMAFORO_PROY_AMBAR", "0.85", "SPI y CPI mínimos para Ámbar"),
    ("MIN_OBS_PREDICCION", "6", "Menos observaciones = escenario experto (Gris)"),
    ("SIM_ITERACIONES", "500", "Iteraciones Monte Carlo"),
    ("SIM_SEMILLA", "42", "Semilla para reproducibilidad"),
    ("IA_HABILITADA", "1", "Interruptor de apagado del asistente IA (1 = activo)"),
    ("IA_MOTOR", "Local", "Local | LLM (requiere clave de API; sin motores de búsqueda)"),
    ("PRIORIDAD_ALTA", "75", "Score >= 75 = prioridad Alta"),
    ("PRIORIDAD_MEDIA", "55", "Score 55-74 = prioridad Media"),
]


# ----------------------------------------------------------------------------
# Conexión y utilidades
# ----------------------------------------------------------------------------
def get_conn() -> sqlite3.Connection:
    """Abre una conexión SQLite con claves foráneas activas."""
    asegurar_directorio()
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def ahora() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _pbkdf2_sha256(password: bytes, salt: bytes, iteraciones: int, dklen: int = 32) -> bytes:
    """PBKDF2-HMAC-SHA256. Usa hashlib nativo; en el navegador (Pyodide) usa la versión en Python puro."""
    if hasattr(hashlib, "pbkdf2_hmac"):
        return hashlib.pbkdf2_hmac("sha256", password, salt, iteraciones, dklen)
    inner, outer = hashlib.sha256(), hashlib.sha256()
    if len(password) > 64:
        password = hashlib.sha256(password).digest()
    password = password + b"\x00" * (64 - len(password))
    inner.update(password.translate(bytes((x ^ 0x36) for x in range(256))))
    outer.update(password.translate(bytes((x ^ 0x5C) for x in range(256))))

    def prf(msg: bytes) -> bytes:
        icpy, ocpy = inner.copy(), outer.copy()
        icpy.update(msg)
        ocpy.update(icpy.digest())
        return ocpy.digest()

    dkey, bloque = b"", 1
    while len(dkey) < dklen:
        prev = prf(salt + bloque.to_bytes(4, "big"))
        rkey = int.from_bytes(prev, "big")
        for _ in range(iteraciones - 1):
            prev = prf(prev)
            rkey ^= int.from_bytes(prev, "big")
        dkey += rkey.to_bytes(32, "big")
        bloque += 1
    return dkey[:dklen]


def hash_password(password: str, salt: str | None = None, iteraciones: int | None = None) -> str:
    """Hash PBKDF2-SHA256 (RNF-09). Formato: pbkdf2$iteraciones$salt$hash"""
    salt = salt or os.urandom(8).hex()
    if iteraciones is None:
        iteraciones = 100_000 if hasattr(hashlib, "pbkdf2_hmac") else 50_000
    dk = _pbkdf2_sha256(password.encode("utf-8"), salt.encode("utf-8"), iteraciones)
    return f"pbkdf2${iteraciones}${salt}${dk.hex()}"


def verificar_password(password: str, almacenado: str) -> bool:
    try:
        _, it, salt, _h = almacenado.split("$")
        return hash_password(password, salt, int(it)) == almacenado
    except Exception:
        return False


def _limpio(v: Any) -> Any:
    """Convierte NaN/NaT/Timestamps/numpy a tipos nativos de SQLite."""
    if v is None:
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(v, (pd.Timestamp, datetime)):
        return v.strftime("%Y-%m-%d")
    if hasattr(v, "item"):
        return v.item()
    if isinstance(v, str):
        v = v.strip()
        return v if v != "" else None
    return v


def _json(d: Any) -> str | None:
    if d is None:
        return None
    return json.dumps(d, ensure_ascii=False, default=str, sort_keys=True)


def init_db() -> None:
    """Crea el esquema, parámetros por defecto y el usuario administrador."""
    with get_conn() as conn:
        conn.executescript(SCHEMA)
        for clave, valor, desc in PARAMETROS_DEFECTO:
            conn.execute("INSERT OR IGNORE INTO parametro(clave, valor, descripcion) VALUES (?,?,?)",
                         (clave, valor, desc))
        n = conn.execute("SELECT COUNT(*) FROM usuario").fetchone()[0]
        if n == 0:
            conn.execute("INSERT INTO usuario(user_id, usuario, nombre, pwd_hash, rol) VALUES (?,?,?,?,?)",
                         ("U01", "admin", "Administrador del Sistema", hash_password("Admin2026!"), "Administrador"))
            auditar(conn, "sistema", "usuario", "U01", "CREAR", None, {"usuario": "admin"})


# ----------------------------------------------------------------------------
# Auditoría con hash encadenado
# ----------------------------------------------------------------------------
def _hash_evento(prev: str, fecha: str, usuario: str, entidad: str, eid: str, accion: str, despues: str | None) -> str:
    base = f"{prev}|{fecha}|{usuario}|{entidad}|{eid}|{accion}|{despues or ''}"
    return hashlib.sha256(base.encode("utf-8")).hexdigest()


def auditar(conn: sqlite3.Connection, usuario: str, entidad: str, entidad_id: Any, accion: str,
            antes: Any = None, despues: Any = None) -> None:
    """Registra un evento en la auditoría (append-only, hash encadenado)."""
    row = conn.execute("SELECT hash FROM auditoria ORDER BY audit_id DESC LIMIT 1").fetchone()
    prev = row[0] if row else "GENESIS"
    fecha = ahora()
    dj = _json(despues)
    h = _hash_evento(prev, fecha, usuario or "", entidad, str(entidad_id), accion, dj)
    conn.execute("""INSERT INTO auditoria(fecha, usuario, entidad, entidad_id, accion, antes_json, despues_json, hash_prev, hash)
                    VALUES (?,?,?,?,?,?,?,?,?)""",
                 (fecha, usuario, entidad, str(entidad_id), accion, _json(antes), dj, prev, h))


def verificar_auditoria() -> tuple[bool, int, int | None]:
    """Recalcula la cadena de hash. Retorna (íntegra, n_eventos, id_primer_error)."""
    with get_conn() as conn:
        filas = conn.execute("SELECT audit_id, fecha, usuario, entidad, entidad_id, accion, despues_json, hash_prev, hash "
                             "FROM auditoria ORDER BY audit_id").fetchall()
    prev = "GENESIS"
    for r in filas:
        h = _hash_evento(prev, r["fecha"], r["usuario"] or "", r["entidad"], r["entidad_id"], r["accion"], r["despues_json"])
        if r["hash_prev"] != prev or r["hash"] != h:
            return False, len(filas), int(r["audit_id"])
        prev = r["hash"]
    return True, len(filas), None


# ----------------------------------------------------------------------------
# Consultas y CRUD genérico
# ----------------------------------------------------------------------------
def q(sql: str, params: tuple | list = ()) -> pd.DataFrame:
    """Ejecuta un SELECT parametrizado y retorna un DataFrame."""
    with get_conn() as conn:
        cur = conn.execute(sql, params)
        cols = [c[0] for c in cur.description] if cur.description else []
        return pd.DataFrame([tuple(r) for r in cur.fetchall()], columns=cols)


def q1(sql: str, params: tuple | list = ()) -> dict | None:
    """Retorna la primera fila como diccionario (o None)."""
    with get_conn() as conn:
        r = conn.execute(sql, params).fetchone()
        return dict(r) if r else None


def param(clave: str, defecto: str = "") -> str:
    r = q1("SELECT valor FROM parametro WHERE clave=?", (clave,))
    return r["valor"] if r and r["valor"] is not None else defecto


def columnas(tabla: str) -> list[str]:
    with get_conn() as conn:
        return [r[1] for r in conn.execute(f"PRAGMA table_info({tabla})").fetchall()]


def obtener(tabla: str, pk_vals: dict, conn: sqlite3.Connection | None = None) -> dict | None:
    cond = " AND ".join(f"{k}=?" for k in PK[tabla])
    sql = f"SELECT * FROM {tabla} WHERE {cond}"
    vals = [pk_vals[k] for k in PK[tabla]]
    if conn is not None:
        r = conn.execute(sql, vals).fetchone()
        return dict(r) if r else None
    return q1(sql, vals)


def guardar(tabla: str, fila: dict, usuario: str, conn: sqlite3.Connection | None = None) -> str:
    """Inserta o actualiza (upsert) una fila con auditoría. Retorna 'CREAR', 'ACTUALIZAR' o 'SIN CAMBIOS'."""
    if tabla not in PK:
        raise ValueError(f"Tabla no permitida: {tabla}")
    cols_validas = set(columnas(tabla))
    fila = {k: _limpio(v) for k, v in fila.items() if k in cols_validas}
    propia = conn is None
    conn = conn or get_conn()
    try:
        antes = obtener(tabla, fila, conn)
        if antes is None:
            ks = list(fila.keys())
            conn.execute(f"INSERT INTO {tabla}({','.join(ks)}) VALUES ({','.join('?' * len(ks))})",
                         [fila[k] for k in ks])
            accion = "CREAR"
        else:
            cambios = {k: v for k, v in fila.items() if k not in PK[tabla] and antes.get(k) != v}
            if not cambios:
                return "SIN CAMBIOS"
            sets = ", ".join(f"{k}=?" for k in cambios)
            cond = " AND ".join(f"{k}=?" for k in PK[tabla])
            conn.execute(f"UPDATE {tabla} SET {sets} WHERE {cond}",
                         list(cambios.values()) + [fila[k] for k in PK[tabla]])
            accion = "ACTUALIZAR"
        eid = "|".join(str(fila[k]) for k in PK[tabla])
        despues = {k: v for k, v in fila.items() if k != "pwd_hash"}
        antes_a = {k: v for k, v in (antes or {}).items() if k != "pwd_hash"} or None
        auditar(conn, usuario, tabla, eid, accion, antes_a, despues)
        if propia:
            conn.commit()
        return accion
    finally:
        if propia:
            conn.close()


def eliminar(tabla: str, pk_vals: dict, usuario: str) -> None:
    """Elimina una fila con auditoría (los triggers protegen versiones aprobadas)."""
    with get_conn() as conn:
        antes = obtener(tabla, pk_vals, conn)
        if antes is None:
            return
        cond = " AND ".join(f"{k}=?" for k in PK[tabla])
        conn.execute(f"DELETE FROM {tabla} WHERE {cond}", [pk_vals[k] for k in PK[tabla]])
        auditar(conn, usuario, tabla, "|".join(str(pk_vals[k]) for k in PK[tabla]), "ELIMINAR", antes, None)


def ejecutar(sql: str, params: tuple | list, usuario: str, entidad: str, entidad_id: Any,
             accion: str, detalle: Any = None) -> None:
    """Ejecuta una sentencia de escritura con registro de auditoría."""
    with get_conn() as conn:
        conn.execute(sql, params)
        auditar(conn, usuario, entidad, entidad_id, accion, None, detalle)


def siguiente_id(tabla: str, campo: str, prefijo: str, ancho: int = 2) -> str:
    """Genera el siguiente identificador con prefijo (p. ej. P-10, BR-13)."""
    df = q(f"SELECT {campo} AS c FROM {tabla} WHERE {campo} LIKE ?", (prefijo + "%",))
    mx = 0
    for v in df["c"] if not df.empty else []:
        m = re.search(r"(\d+)$", str(v))
        if m:
            mx = max(mx, int(m.group(1)))
    return f"{prefijo}{mx + 1:0{ancho}d}"


def registrar_ia(org_id: str, tarea: str, motor: str, entrada: Any, salida: Any, usuario: str) -> None:
    with get_conn() as conn:
        conn.execute("""INSERT INTO ia_ejecucion(org_id, tarea, motor, prompt_version, entrada, salida_json, usuario)
                        VALUES (?,?,?,?,?,?,?)""",
                     (org_id, tarea, motor, "PV-1.0", _json(entrada), _json(salida), usuario))
        auditar(conn, usuario, "ia_ejecucion", org_id, "IA_" + tarea.upper(), None, {"motor": motor})


# ----------------------------------------------------------------------------
# Versionado del Canvas
# ----------------------------------------------------------------------------
def hash_version(version_id: str, conn: sqlite3.Connection | None = None) -> str:
    sql = """SELECT bloque, descripcion, naturaleza, evidencia, fuente, confianza, responsable,
                    tipo_cambio, elemento_origen_id FROM canvas_elemento WHERE version_id=?
             ORDER BY elemento_id"""
    if conn is not None:
        rows = [dict(r) for r in conn.execute(sql, (version_id,)).fetchall()]
    else:
        rows = q(sql, (version_id,)).to_dict("records")
    return hashlib.sha256(_json(rows).encode("utf-8")).hexdigest()


def cambiar_estado_version(version_id: str, nuevo: str, usuario: str, comentario: str = "") -> None:
    """Flujo de estados del Canvas. Al aprobar: calcula hash y reemplaza la aprobada anterior."""
    with get_conn() as conn:
        v = dict(conn.execute("SELECT * FROM canvas_version WHERE version_id=?", (version_id,)).fetchone())
        if nuevo == "Aprobado":
            h = hash_version(version_id, conn)
            anteriores = conn.execute(
                """SELECT version_id FROM canvas_version WHERE org_id=? AND tipo=? AND estado='Aprobado'
                   AND IFNULL(escenario_id,'')=IFNULL(?, '') AND version_id<>?""",
                (v["org_id"], v["tipo"], v["escenario_id"], version_id)).fetchall()
            for (vid,) in anteriores:
                conn.execute("UPDATE canvas_version SET estado='Reemplazado' WHERE version_id=?", (vid,))
                auditar(conn, usuario, "canvas_version", vid, "REEMPLAZAR", {"estado": "Aprobado"}, {"estado": "Reemplazado"})
            conn.execute("""UPDATE canvas_version SET estado='Aprobado', aprobador=?, fecha_aprobacion=?,
                            hash_contenido=?, comentario=COALESCE(NULLIF(?,''), comentario) WHERE version_id=?""",
                         (usuario, ahora()[:10], h, comentario, version_id))
            auditar(conn, usuario, "canvas_version", version_id, "APROBAR", {"estado": v["estado"]},
                    {"estado": "Aprobado", "hash": h})
        else:
            conn.execute("UPDATE canvas_version SET estado=?, comentario=COALESCE(NULLIF(?,''), comentario) WHERE version_id=?",
                         (nuevo, comentario, version_id))
            auditar(conn, usuario, "canvas_version", version_id, "ESTADO", {"estado": v["estado"]}, {"estado": nuevo})


def crear_version(org_id: str, tipo: str, usuario: str, escenario_id: str | None = None,
                  deriva_de: str | None = None, horizonte: int = 0, comentario: str = "",
                  elementos: list[dict] | None = None, origen: str = "Manual") -> str:
    """Crea una nueva versión (Borrador) con sus elementos."""
    pref = "ASIS" if tipo == "AS IS" else "TOBE"
    n2 = org_id[-2:] if org_id[-2:].isdigit() else org_id
    vid = siguiente_id("canvas_version", "version_id", f"CV{n2}-{pref}-", 1)
    num = (q1("SELECT MAX(numero) m FROM canvas_version WHERE org_id=? AND tipo=?", (org_id, tipo)) or {}).get("m") or 0
    with get_conn() as conn:
        fila = dict(version_id=vid, org_id=org_id, tipo=tipo, escenario_id=escenario_id or None,
                    numero=int(num) + 1, estado="Borrador", fecha_corte=ahora()[:10],
                    deriva_de=deriva_de, horizonte_meses=horizonte, autor=usuario, comentario=comentario)
        guardar("canvas_version", fila, usuario, conn)
        for i, e in enumerate(elementos or [], 1):
            e = dict(e)
            e["elemento_id"] = f"{vid}-E{i:02d}"
            e["version_id"] = vid
            e.setdefault("origen", origen)
            guardar("canvas_elemento", e, usuario, conn)
    return vid


def clonar_version(version_id: str, usuario: str, comentario: str = "Clon para modificación") -> str:
    v = q1("SELECT * FROM canvas_version WHERE version_id=?", (version_id,))
    els = q("SELECT * FROM canvas_elemento WHERE version_id=? ORDER BY elemento_id", (version_id,)).to_dict("records")
    for e in els:
        if v["tipo"] == "AS IS":
            e["elemento_origen_id"] = e["elemento_origen_id"]
        e.pop("elemento_id", None)
    return crear_version(v["org_id"], v["tipo"], usuario, v["escenario_id"], version_id,
                         v["horizonte_meses"] or 0, comentario, els)


# ----------------------------------------------------------------------------
# Validación de filas (ingesta y registro manual)
# ----------------------------------------------------------------------------
CATALOGOS = {
    ("organizacion", "sector"): SECTORES, ("organizacion", "tamano"): TAMANOS,
    ("usuario", "rol"): ROLES, ("escenario", "tipo"): TIPOS_ESCENARIO,
    ("canvas_version", "tipo"): TIPOS_CANVAS, ("canvas_version", "estado"): ESTADOS_VERSION,
    ("canvas_elemento", "bloque"): BLOQUES, ("canvas_elemento", "naturaleza"): NATURALEZAS,
    ("canvas_elemento", "confianza"): CONFIANZAS, ("canvas_elemento", "tipo_cambio"): TIPOS_CAMBIO,
    ("canvas_elemento", "origen"): ORIGENES, ("hipotesis", "estado"): ESTADOS_HIP,
    ("brecha", "bloque"): BLOQUES, ("brecha", "tipo_cambio"): TIPOS_CAMBIO,
    ("proyecto", "tipo"): TIPOS_PROY, ("proyecto", "estado"): ESTADOS_PROY,
    ("hito", "estado_aprobacion"): ESTADOS_APROB, ("kpi", "sentido"): SENTIDOS,
    ("kpi_observacion", "calidad"): CALIDADES, ("riesgo", "estado"): ESTADOS_RIESGO,
}
OBLIGATORIOS = {
    "organizacion": ["org_id", "razon_social", "sector", "tamano"],
    "usuario": ["user_id", "usuario", "rol"],
    "parametro": ["clave"],
    "escenario": ["escenario_id", "org_id", "nombre", "tipo"],
    "canvas_version": ["version_id", "org_id", "tipo"],
    "canvas_elemento": ["elemento_id", "version_id", "bloque", "descripcion"],
    "hipotesis": ["hip_id", "org_id", "enunciado"],
    "brecha": ["brecha_id", "org_id"],
    "proyecto": ["proyecto_id", "org_id", "nombre"],
    "hito": ["hito_id", "proyecto_id", "tarea", "fecha_inicio", "fecha_fin"],
    "avance_mensual": ["proyecto_id", "periodo"],
    "riesgo": ["riesgo_id", "proyecto_id", "descripcion"],
    "kpi": ["kpi_id", "org_id", "nombre"],
    "kpi_observacion": ["kpi_id", "periodo"],
}
FKS = {
    ("escenario", "org_id"): ("organizacion", "org_id"),
    ("canvas_version", "org_id"): ("organizacion", "org_id"),
    ("canvas_version", "escenario_id"): ("escenario", "escenario_id"),
    ("canvas_elemento", "version_id"): ("canvas_version", "version_id"),
    ("hipotesis", "org_id"): ("organizacion", "org_id"),
    ("hipotesis", "elemento_id"): ("canvas_elemento", "elemento_id"),
    ("brecha", "org_id"): ("organizacion", "org_id"),
    ("proyecto", "org_id"): ("organizacion", "org_id"),
    ("proyecto", "brecha_id"): ("brecha", "brecha_id"),
    ("hito", "proyecto_id"): ("proyecto", "proyecto_id"),
    ("avance_mensual", "proyecto_id"): ("proyecto", "proyecto_id"),
    ("riesgo", "proyecto_id"): ("proyecto", "proyecto_id"),
    ("kpi", "org_id"): ("organizacion", "org_id"),
    ("kpi", "proyecto_id"): ("proyecto", "proyecto_id"),
    ("kpi_observacion", "kpi_id"): ("kpi", "kpi_id"),
}
RE_PERIODO = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
RE_FECHA = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CAMPOS_PCT = {"avance_plan_pct", "avance_real_pct", "peso_pct"}


def _es_fecha(v: str) -> bool:
    if not RE_FECHA.match(str(v)):
        return False
    try:
        datetime.strptime(str(v), "%Y-%m-%d")
        return True
    except ValueError:
        return False


def validar_fila(tabla: str, fila: dict, conn: sqlite3.Connection, duplicado_es_error: bool = False) -> list[str]:
    """Valida una fila antes de insertarla. Retorna la lista de errores."""
    err: list[str] = []
    for c in OBLIGATORIOS.get(tabla, []):
        if fila.get(c) in (None, ""):
            err.append(f"Campo obligatorio vacío: {c}")
    for (t, c), cat in CATALOGOS.items():
        if t == tabla and fila.get(c) is not None and fila[c] not in cat:
            err.append(f"Valor '{fila[c]}' fuera de catálogo en {c} (permitidos: {', '.join(cat)})")
    for (t, c), (rt, rc) in FKS.items():
        if t == tabla and fila.get(c) not in (None, ""):
            if conn.execute(f"SELECT 1 FROM {rt} WHERE {rc}=?", (fila[c],)).fetchone() is None:
                err.append(f"Referencia inexistente: {c}='{fila[c]}' no existe en {rt}")
    if "periodo" in fila and fila.get("periodo") is not None and not RE_PERIODO.match(str(fila["periodo"])):
        err.append(f"Periodo con formato inválido '{fila['periodo']}' (use AAAA-MM)")
    for c in ("fecha_inicio", "fecha_fin", "fecha_limite", "fecha_alta", "fecha_corte"):
        if fila.get(c) not in (None, "") and not _es_fecha(fila[c]):
            err.append(f"Fecha inválida en {c}: '{fila[c]}' (use AAAA-MM-DD)")
    if fila.get("fecha_inicio") and fila.get("fecha_fin") and _es_fecha(fila["fecha_inicio"]) and _es_fecha(fila["fecha_fin"]):
        if str(fila["fecha_fin"]) < str(fila["fecha_inicio"]):
            err.append("La fecha fin es anterior a la fecha inicio")
    for c in CAMPOS_PCT:
        v = fila.get(c)
        if v is not None:
            try:
                if not 0 <= float(v) <= 100:
                    err.append(f"{c} fuera de rango 0-100: {v}")
            except (TypeError, ValueError):
                err.append(f"{c} no numérico: {v}")
    for c in ("presupuesto_pen", "costo_plan_pen", "costo_real_pen", "ventas_anuales_pen"):
        v = fila.get(c)
        if v is not None:
            try:
                if float(v) < 0:
                    err.append(f"{c} no puede ser negativo: {v}")
            except (TypeError, ValueError):
                err.append(f"{c} no numérico: {v}")
    for c in ("impacto", "esfuerzo", "riesgo", "probabilidad"):
        v = fila.get(c)
        if v is not None and tabla in ("brecha", "riesgo"):
            try:
                if not 1 <= int(v) <= 5:
                    err.append(f"{c} debe estar entre 1 y 5: {v}")
            except (TypeError, ValueError):
                err.append(f"{c} no numérico: {v}")
    if tabla == "kpi_observacion" and fila.get("kpi_id"):
        k = conn.execute("SELECT unidad FROM kpi WHERE kpi_id=?", (fila["kpi_id"],)).fetchone()
        if k and k[0] == "%":
            for c in ("valor_plan", "valor_real"):
                v = fila.get(c)
                if v is not None and (float(v) < 0 or float(v) > 100):
                    err.append(f"Porcentaje fuera de rango 0-100 en {c}: {v}")
    if duplicado_es_error and tabla in PK and all(fila.get(k) is not None for k in PK[tabla]):
        if obtener(tabla, fila, conn) is not None:
            err.append("Clave duplicada: " + ", ".join(f"{k}={fila[k]}" for k in PK[tabla]))
    return err


# ----------------------------------------------------------------------------
# Carga desde Excel (RF-02)
# ----------------------------------------------------------------------------
def cargar_excel(contenido: bytes, archivo: str, usuario: str) -> dict:
    """Carga un libro Excel cuyas hojas se llaman como las tablas destino.

    - Valida cada fila; las filas con error van a cuarentena.
    - Es idempotente: filas idénticas se omiten; versiones aprobadas no se alteran.
    - Registra el linaje (hash SHA-256 del archivo) en carga_datos.
    """
    h = hashlib.sha256(contenido).hexdigest()
    libro = pd.read_excel(io.BytesIO(contenido), sheet_name=None, dtype=object)
    resumen: dict[str, dict] = {}
    ok = errores = omitidas = 0
    cuarentena: list[tuple] = []
    with get_conn() as conn:
        # 1) Versiones que ya existen aprobadas: no se tocan (inmutables)
        inmutables = {r[0] for r in conn.execute(
            "SELECT version_id FROM canvas_version WHERE estado IN ('Aprobado','Reemplazado')").fetchall()}
        estados_finales: dict[str, str] = {}
        for tabla in ORDEN_CARGA:
            if tabla not in libro:
                continue
            df = libro[tabla]
            r = {"ok": 0, "error": 0, "omitidas": 0}
            for i, fila in enumerate(df.to_dict("records"), start=2):
                fila = {k: _limpio(v) for k, v in fila.items()}
                try:
                    if tabla == "usuario":
                        pwd = fila.pop("password_demo", None) or "Cambiar2026!"
                        fila.pop("org_id", None) if not fila.get("org_id") else None
                        existente = conn.execute("SELECT pwd_hash FROM usuario WHERE user_id=?", (fila["user_id"],)).fetchone()
                        fila["pwd_hash"] = existente[0] if existente else hash_password(str(pwd))
                    if tabla == "canvas_version":
                        if fila.get("version_id") in inmutables:
                            r["omitidas"] += 1
                            continue
                        fila["estado"] = fila.get("estado") or "Borrador"
                        if fila["estado"] in ("Aprobado", "Reemplazado"):
                            # se congela al final, después de cargar sus elementos
                            estados_finales[fila["version_id"]] = fila["estado"]
                            fila["estado"] = "Borrador"
                    if tabla == "canvas_elemento" and fila.get("version_id") in inmutables:
                        r["omitidas"] += 1
                        continue
                    errs = validar_fila(tabla, fila, conn)
                    if errs:
                        raise ValueError("; ".join(errs))
                    res = guardar(tabla, fila, usuario, conn)
                    if res == "SIN CAMBIOS":
                        r["omitidas"] += 1
                    else:
                        r["ok"] += 1
                except Exception as ex:  # noqa: BLE001
                    r["error"] += 1
                    estados_finales.pop(fila.get("version_id"), None) if tabla == "canvas_version" else None
                    cuarentena.append((tabla, i, str(ex), _json(fila)))
            resumen[tabla] = r
            ok += r["ok"]; errores += r["error"]; omitidas += r["omitidas"]
        # 2) Fijar estados finales de las versiones (con hash si están aprobadas)
        for vid, est in estados_finales.items():
            hv = hash_version(vid, conn)
            conn.execute("UPDATE canvas_version SET hash_contenido=? WHERE version_id=?", (hv, vid))
            conn.execute("UPDATE canvas_version SET estado=? WHERE version_id=?", (est, vid))
        # 3) Hoja de datos inválidos de prueba: se validan y van a cuarentena
        if "Datos_Invalidos_Prueba" in libro:
            r = {"ok": 0, "error": 0, "omitidas": 0}
            for i, fila in enumerate(libro["Datos_Invalidos_Prueba"].to_dict("records"), start=2):
                tabla = str(fila.get("tabla_destino"))
                try:
                    datos = json.loads(str(fila.get("datos_json")))
                except json.JSONDecodeError as ex:
                    cuarentena.append(("Datos_Invalidos_Prueba", i, f"JSON inválido: {ex}", None)); r["error"] += 1
                    continue
                errs = validar_fila(tabla, datos, conn, duplicado_es_error=True) if tabla in PK else [f"Tabla desconocida {tabla}"]
                msg = "; ".join(errs) if errs else "NO DETECTADO (revisar validaciones)"
                cuarentena.append((f"Datos_Invalidos_Prueba→{tabla}", i, msg, _json(datos)))
                r["error"] += 1
            resumen["Datos_Invalidos_Prueba"] = r
            errores += r["error"]
        cur = conn.execute("""INSERT INTO carga_datos(archivo, hash_sha256, hojas, filas_ok, filas_error, filas_omitidas, usuario)
                              VALUES (?,?,?,?,?,?,?)""",
                           (archivo, h, ",".join(resumen.keys()), ok, errores, omitidas, usuario))
        carga_id = cur.lastrowid
        conn.executemany("INSERT INTO cuarentena(carga_id, hoja, fila, error, datos_json) VALUES (?,?,?,?,?)",
                         [(carga_id, *c) for c in cuarentena])
        auditar(conn, usuario, "carga_datos", carga_id, "CARGA_EXCEL", None,
                {"archivo": archivo, "hash": h, "ok": ok, "error": errores, "omitidas": omitidas})
    return {"carga_id": carga_id, "hash": h, "ok": ok, "error": errores, "omitidas": omitidas, "detalle": resumen}


def exportar_excel() -> bytes:
    """Exporta todas las tablas de la BD a un libro Excel (RF-17)."""
    buf = io.BytesIO()
    tablas = ORDEN_CARGA + ["prediccion", "simulacion", "carga_datos", "cuarentena", "ia_ejecucion", "auditoria", "reporte"]
    with pd.ExcelWriter(buf, engine="openpyxl") as w:
        for t in tablas:
            df = q(f"SELECT * FROM {t}")
            if t == "usuario" and not df.empty:
                df = df.drop(columns=["pwd_hash"])
            df.to_excel(w, sheet_name=t[:31], index=False)
    return buf.getvalue()


def reiniciar_bd() -> None:
    """Elimina la base de datos y la recrea vacía (solo administrador)."""
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    init_db()
