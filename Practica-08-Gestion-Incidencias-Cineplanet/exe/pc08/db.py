"""Base SQLite de la solución EXE: migraciones y unidad de trabajo atómica."""
import hashlib
import sqlite3
import time

from pc08 import config


class ErrorAlmacen(Exception):
    def __init__(self, codigo, mensaje, vigente=None):
        super().__init__(mensaje)
        self.codigo, self.mensaje, self.vigente = codigo, mensaje, vigente


def conectar(ruta=None):
    con = sqlite3.connect(str(ruta or config.base_datos()), timeout=5, isolation_level=None)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA busy_timeout = 5000")
    con.execute("PRAGMA synchronous = FULL")
    return con


def migrar(ruta=None):
    con = conectar(ruta)
    try:
        con.execute("PRAGMA journal_mode = WAL")
        con.execute("CREATE TABLE IF NOT EXISTS migracion (version INTEGER PRIMARY KEY, aplicada_utc INTEGER NOT NULL,"
                    " huella_sha256 TEXT NOT NULL CHECK (length(huella_sha256) = 64)) STRICT")
        hechas = {r[0] for r in con.execute("SELECT version FROM migracion")}
        for archivo in sorted(config.MIGRACIONES_DIR.glob("*.sql")):
            version = int(archivo.name.split("_")[0])
            if version in hechas:
                continue
            sql = archivo.read_text(encoding="utf-8")
            con.execute("BEGIN IMMEDIATE")
            try:
                for sentencia in sql.split(";"):
                    if sentencia.strip():
                        con.execute(sentencia)
                con.execute("INSERT INTO migracion VALUES (?,?,?)", (version, int(time.time()), hashlib.sha256(sql.encode()).hexdigest()))
                con.execute("COMMIT")
            except BaseException:
                con.execute("ROLLBACK")
                raise
        return con.execute("SELECT COALESCE(MAX(version),0) FROM migracion").fetchone()[0]
    finally:
        con.close()


class Almacen:
    """Operaciones genéricas con lista blanca de tablas y columnas tomada del esquema."""

    def __init__(self, ruta=None):
        self.ruta = ruta
        con = conectar(ruta)
        try:
            tablas = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('migracion') AND name NOT LIKE 'sqlite_%'")]
            self.columnas = {t: {r[1] for r in con.execute(f"PRAGMA table_info({t})")} for t in tablas}
        finally:
            con.close()

    def _tabla(self, t):
        if t not in self.columnas:
            raise ErrorAlmacen("TABLA", f"Tabla no permitida: {t}")
        return t

    def _cols(self, t, cols):
        malas = set(cols) - self.columnas[t]
        if malas:
            raise ErrorAlmacen("COLUMNA", f"Columnas no válidas en {t}: {', '.join(sorted(malas))}")
        return list(cols)

    def leer(self, tabla, filtro=None, columnas=None):
        t = self._tabla(tabla)
        filtro = filtro or {}
        cols = self._cols(t, filtro.keys())
        sel = ", ".join(self._cols(t, columnas)) if columnas else "*"
        cond = [f"{c} IS NULL" if filtro[c] is None else f"{c} = ?" for c in cols]
        par = [filtro[c] for c in cols if filtro[c] is not None]
        con = conectar(self.ruta)
        try:
            sql = f"SELECT {sel} FROM {t}" + (" WHERE " + " AND ".join(cond) if cond else "")
            return [dict(r) for r in con.execute(sql, par)]
        finally:
            con.close()

    def obtener(self, tabla, id_):
        f = self.leer(tabla, {"id": id_})
        return f[0] if f else None

    def _ejecutar(self, con, ops):
        refs, ids = {}, []
        res = lambda v: refs[v["$ref"]] if isinstance(v, dict) and "$ref" in v else v
        for o in ops:
            t = self._tabla(o["tabla"])
            if o["op"] == "insertar":
                fila = {k: res(v) for k, v in o["fila"].items()}
                cols = self._cols(t, fila.keys())
                cur = con.execute(f"INSERT INTO {t} ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})", [fila[c] for c in cols])
                ids.append(cur.lastrowid)
                if o.get("ref"):
                    refs[o["ref"]] = cur.lastrowid
            elif o["op"] == "actualizar":
                cambios = {k: res(v) for k, v in o["cambios"].items()}
                cols = self._cols(t, cambios.keys())
                sets = ", ".join(f"{c} = ?" for c in cols)
                par = [cambios[c] for c in cols]
                id_ = res(o["id"])
                if o.get("version") is not None:
                    cur = con.execute(f"UPDATE {t} SET {sets}, version = version + 1 WHERE id = ? AND version = ?", par + [id_, o["version"]])
                else:
                    cur = con.execute(f"UPDATE {t} SET {sets} WHERE id = ?", par + [id_])
                if cur.rowcount == 0:
                    vig = con.execute(f"SELECT * FROM {t} WHERE id = ?", (id_,)).fetchone()
                    if vig is None:
                        raise ErrorAlmacen("NO_EXISTE", "Registro inexistente")
                    raise ErrorAlmacen("CONFLICTO", "Otro usuario guardó un cambio antes.", dict(vig))
                ids.append(id_)
            else:
                raise ErrorAlmacen("OPERACION", f"Operación no válida: {o['op']}")
        return {"ids": ids, "refs": refs}

    def aplicar(self, ops, vaciar=()):
        con = conectar(self.ruta)
        try:
            con.execute("BEGIN IMMEDIATE")
            for t in vaciar:
                con.execute(f"DELETE FROM {self._tabla(t)}")
            r = self._ejecutar(con, ops)
            con.execute("COMMIT")
            return r
        except sqlite3.IntegrityError as e:
            con.execute("ROLLBACK")
            m = str(e)
            raise ErrorAlmacen("UNICO" if "UNIQUE" in m else "INTEGRIDAD", "Registro duplicado" if "UNIQUE" in m else f"Dato no válido: {m}")
        except BaseException:
            if con.in_transaction:
                con.execute("ROLLBACK")
            raise
        finally:
            con.close()

    def siguiente_codigo(self, tabla, prefijo):
        con = conectar(self.ruta)
        try:
            n = con.execute(f"SELECT COALESCE(MAX(CAST(substr(codigo, ?) AS INTEGER)), 0) FROM {self._tabla(tabla)} WHERE codigo LIKE ?",
                            (len(prefijo) + 1, prefijo + "%")).fetchone()[0]
            return f"{prefijo}{n + 1:04d}"
        finally:
            con.close()

    def integridad(self):
        con = conectar(self.ruta)
        try:
            return con.execute("PRAGMA quick_check").fetchone()[0]
        finally:
            con.close()
