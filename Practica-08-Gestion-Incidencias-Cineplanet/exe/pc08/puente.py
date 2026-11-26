"""Puente entre la interfaz y la base SQLite. Valida sesión, rol y permisos en el lado de la aplicación.
Solo expone métodos (los atributos con «_» no son visibles para la interfaz)."""
import hashlib
import hmac
import logging
import os
import threading

from pc08 import config, enlaces
from pc08.db import Almacen, ErrorAlmacen

log = logging.getLogger("pc08")
PUBLICAS = {"configuracion", "proyecto", "sede"}
OPERATIVAS = {"funcion", "compra", "tipo_incidencia", "incidencia", "contacto", "evento", "evidencia", "verificacion", "verificacion_enlace", "lote_importado", "instrumento_version"}
LEER = {None: PUBLICAS, "CLIENTE": PUBLICAS | {"funcion", "tipo_incidencia", "compra", "incidencia", "contacto", "evento", "evidencia", "verificacion"},
        "DIGITAL": PUBLICAS | OPERATIVAS | {"usuario"}, "BOLETERIA": PUBLICAS | OPERATIVAS | {"usuario"},
        "SUPERVISION": PUBLICAS | OPERATIVAS | {"usuario"}}
INSERTAR = {None: set(), "CLIENTE": {"incidencia", "contacto", "evento", "evidencia", "verificacion_enlace"},
            "DIGITAL": {"contacto", "evento", "evidencia", "verificacion", "verificacion_enlace"},
            "BOLETERIA": {"contacto", "evento", "evidencia", "verificacion", "verificacion_enlace"},
            "SUPERVISION": {"contacto", "evento", "evidencia", "verificacion", "verificacion_enlace", "tipo_incidencia",
                            "funcion", "compra", "incidencia", "lote_importado", "instrumento_version", "configuracion"}}
ACTUALIZAR = {None: set(), "CLIENTE": set(), "DIGITAL": {"incidencia", "contacto"}, "BOLETERIA": {"incidencia", "contacto"},
              "SUPERVISION": {"incidencia", "contacto", "funcion", "tipo_incidencia", "configuracion", "instrumento_version", "compra"}}
OCULTAS = {"usuario": {"sal", "hash", "iteraciones"}}


def _hash(clave, sal, it):
    return hashlib.pbkdf2_hmac("sha256", clave.encode("utf-8"), bytes.fromhex(sal), int(it)).hex()


def _seguro(fn):
    def envoltura(self, *a):
        try:
            return {"ok": True, "datos": fn(self, *a)}
        except ErrorAlmacen as e:
            return {"ok": False, "codigo": e.codigo, "mensaje": e.mensaje, "vigente": e.vigente}
        except Exception as e:  # noqa: BLE001
            log.exception("Error en el puente")
            return {"ok": False, "codigo": "INTERNO", "mensaje": f"Error interno: {e}. Los datos confirmados se conservan."}
    envoltura.__name__ = fn.__name__
    return envoltura


class Puente:
    def __init__(self, almacen: Almacen):
        self._a = almacen
        self._u = None  # sesión activa (una ventana, un usuario)

    # ---------------------------------------------------- utilidades internas
    def _rol(self):
        return self._u.get("rol") if self._u else None

    def _modo(self):
        f = self._a.leer("configuracion", {"clave": "modo"})
        return f[0]["valor"] if f else "DEMO"

    def _propia(self, incidencia_id):
        i = self._a.obtener("incidencia", incidencia_id)
        return bool(i and self._u and i.get("cliente_id") == self._u["id"])

    # ---------------------------------------------------- semilla, sesión y modo
    @_seguro
    def estado_semilla(self):
        try:
            f = self._a.leer("configuracion", {"clave": "semilla"})
        except ErrorAlmacen:
            return None
        return f[0]["valor"] if f else None

    @_seguro
    def sembrar(self, version, tablas, ops):
        actual = self._a.leer("configuracion", {"clave": "semilla"})
        if actual and actual[0]["valor"] == version and self._rol() != "SUPERVISION":
            raise ErrorAlmacen("PERMISO", "Solo Supervisión puede restablecer los datos de demostración.")
        self._a.aplicar(ops, vaciar=tablas)
        self._u = None if self._rol() != "SUPERVISION" else self._u
        return True

    @_seguro
    def iniciar_sesion(self, correo, clave):
        u = next(iter(self._a.leer("usuario", {"correo": (correo or "").strip().lower()})), None)
        modo = self._modo()
        if not u or not u["activo"] or u["ambito"] != modo or not hmac.compare_digest(_hash(clave or "", u["sal"], u["iteraciones"]), u["hash"]):
            raise ErrorAlmacen("CREDENCIALES", "Correo o contraseña incorrectos.")
        sede = self._a.obtener("sede", u["sede_id"]) if u["sede_id"] else None
        roles = [r for r in (u.get("roles") or u["rol"]).split(",") if r]
        self._u = {"id": u["id"], "correo": u["correo"], "nombre": u["nombre"], "roles": roles, "rol": None,
                   "sede_id": u["sede_id"], "sede": sede["nombre"] if sede else None}
        log.info("Sesión iniciada: %s (%s)", u["correo"], ",".join(roles))
        return self._u

    @_seguro
    def elegir_rol(self, rol):
        if not self._u or rol not in self._u["roles"]:
            raise ErrorAlmacen("PERMISO", "Esta vista no está autorizada para su cuenta.")
        self._u["rol"] = rol
        return self._u

    @_seguro
    def cerrar_sesion(self):
        self._u = None
        return True

    @_seguro
    def cambiar_modo(self, nuevo, clave_supervision):
        if nuevo not in ("DEMO", "PRODUCCION"):
            raise ErrorAlmacen("DATO", "Modo no válido")
        actual = self._modo()
        if nuevo == actual:
            return actual
        if nuevo == "DEMO":
            sups = [u for u in self._a.leer("usuario", {"ambito": "PRODUCCION"}) if u["activo"] and "SUPERVISION" in (u.get("roles") or u["rol"]).split(",")]
            if not any(hmac.compare_digest(_hash(clave_supervision or "", u["sal"], u["iteraciones"]), u["hash"]) for u in sups):
                raise ErrorAlmacen("CREDENCIALES", "Contraseña del personal incorrecta.")
        c = self._a.leer("configuracion", {"clave": "modo"})[0]
        self._a.aplicar([{"op": "actualizar", "tabla": "configuracion", "id": c["id"], "cambios": {"valor": nuevo}}])
        self._u = None
        return nuevo

    # ---------------------------------------------------- datos con permisos
    @_seguro
    def leer(self, tabla, filtro=None, columnas=None):
        filtro = dict(filtro or {})
        if tabla not in LEER[self._rol()]:
            raise ErrorAlmacen("PERMISO", "Su rol no tiene acceso a esta información.")
        if self._rol() == "CLIENTE":
            if tabla == "incidencia":
                filtro["cliente_id"] = self._u["id"]
            elif tabla in ("contacto", "evento", "evidencia", "verificacion"):
                iid = filtro.get("incidencia_id")
                if tabla == "contacto" and "clave_origen" in filtro and not iid:
                    return [{k: r[k] for k in ("id", "incidencia_id")} for r in self._a.leer(tabla, filtro) if self._propia(r["incidencia_id"])]
                if not iid or not self._propia(iid):
                    raise ErrorAlmacen("PERMISO", "Solo puede consultar sus propios casos.")
        filas = self._a.leer(tabla, filtro, columnas or None)
        ocultas = OCULTAS.get(tabla, set())
        return [{k: v for k, v in f.items() if k not in ocultas} for f in filas] if ocultas else filas

    @_seguro
    def obtener(self, tabla, id_):
        r = self.leer(tabla, {"id": id_})
        if not r["ok"]:
            raise ErrorAlmacen(r["codigo"], r["mensaje"])
        return r["datos"][0] if r["datos"] else None

    @_seguro
    def aplicar(self, ops):
        rol = self._rol()
        if rol is None:
            raise ErrorAlmacen("SESION", "Inicie sesión para continuar.")
        for o in ops:
            permitido = INSERTAR[rol] if o.get("op") == "insertar" else ACTUALIZAR[rol]
            if o.get("tabla") not in permitido:
                raise ErrorAlmacen("PERMISO", f"Su rol ({rol.title()}) no puede modificar {o.get('tabla')}.")
            if o["tabla"] == "configuracion" and o.get("op") == "insertar" and (o.get("fila") or {}).get("clave") != "feriados_PE":
                raise ErrorAlmacen("PERMISO", "Solo se pueden registrar los feriados descargados.")
            if rol == "CLIENTE" and o["tabla"] == "incidencia" and o["fila"].get("cliente_id") != self._u["id"]:
                raise ErrorAlmacen("PERMISO", "El caso debe quedar asociado a su cuenta.")
        return self._a.aplicar(ops)

    @_seguro
    def siguiente_codigo(self, tabla, prefijo):
        if self._rol() is None or tabla not in ("incidencia", "evidencia"):
            raise ErrorAlmacen("PERMISO", "Operación no permitida.")
        return self._a.siguiente_codigo(tabla, prefijo)

    # ---------------------------------------------------- servicios
    @_seguro
    def consultar_enlace(self, url):
        if self._rol() is None:
            raise ErrorAlmacen("SESION", "Inicie sesión para continuar.")
        return enlaces.consultar(url)

    @_seguro
    def consultar_feriados(self, anio):
        """Descarga real de feriados oficiales del Perú (Nager.Date). Solo lectura de internet; el guardado pasa por aplicar()."""
        if self._rol() is None:
            raise ErrorAlmacen("SESION", "Inicie sesión para continuar.")
        try:
            anio = int(anio)
        except (TypeError, ValueError):
            anio = 0
        if not 2000 <= anio <= 2100:
            raise ErrorAlmacen("VALIDACION", "Año no válido.")
        return enlaces.obtener_json(f"https://date.nager.at/api/v3/PublicHolidays/{anio}/PE")

    @_seguro
    def info(self):
        return {"modo_app": "EXE", "almacen": "SQLite local", "ubicacion": str(config.base_datos()),
                "integridad": self._a.integridad(), "version_app": config.VERSION, "sesion": self._u}

    @_seguro
    def guardar_archivo(self, nombre, base64_datos):
        """Guarda un archivo generado (Excel) en la carpeta que elija el usuario; por defecto, Documentos."""
        import base64
        from pathlib import Path
        if self._rol() is None:
            raise ErrorAlmacen("SESION", "Inicie sesión para continuar.")
        nombre = "".join(c for c in str(nombre) if c not in '<>:"/\\|?*').strip() or "archivo.xlsx"
        ext = Path(nombre).suffix.lower()
        if ext not in (".xlsx", ".json"):
            ext, nombre = ".xlsx", nombre + ".xlsx"
        filtro = "Libro de Excel (*.xlsx)" if ext == ".xlsx" else "Archivo JSON (*.json)"
        datos = base64.b64decode(base64_datos)
        ruta = None
        try:
            import webview
            if webview.windows:
                tipo = webview.FileDialog.SAVE if hasattr(webview, "FileDialog") else webview.SAVE_DIALOG
                r = webview.windows[0].create_file_dialog(tipo, directory=str(Path.home() / "Documents"), save_filename=nombre, file_types=(filtro,))
                if not r:
                    return {"guardado": False}
                ruta = Path(r if isinstance(r, str) else r[0])
        except Exception:  # noqa: BLE001
            ruta = None
        if ruta is None:
            ruta = config.carpeta_app() / "exportaciones" / nombre
        if ruta.suffix.lower() != ext:  # el usuario borró o cambió la extensión: se conserva el formato real
            ruta = ruta.with_name(ruta.name + ext)
        ruta.parent.mkdir(parents=True, exist_ok=True)
        ruta.write_bytes(datos)
        return {"guardado": True, "ruta": str(ruta), "bytes": len(datos)}

    # ---------------------------------------------------- respaldo y restauración (Supervisión)
    def _solo_supervision(self):
        if self._rol() != "SUPERVISION":
            raise ErrorAlmacen("PERMISO", "Solo Supervisión puede gestionar respaldos.")

    @_seguro
    def respaldar(self):
        import sqlite3, time as _t
        self._solo_supervision()
        carpeta = config.carpeta_app() / "respaldos"
        destino = carpeta / f"pc08_{_t.strftime('%Y%m%d_%H%M%S')}.sqlite3"
        origen = sqlite3.connect(str(config.base_datos()))
        copia = sqlite3.connect(str(destino))
        try:
            origen.backup(copia)
            ok = copia.execute("PRAGMA integrity_check").fetchone()[0] == "ok" and not copia.execute("PRAGMA foreign_key_check").fetchall()
            conteo = copia.execute("SELECT COUNT(*) FROM incidencia").fetchone()[0]
        finally:
            copia.close(); origen.close()
        if not ok:
            raise ErrorAlmacen("RESPALDO", "La copia no superó la verificación de integridad; se conserva la base actual.")
        for viejo in sorted(carpeta.glob("pc08_*.sqlite3"))[:-5]:
            viejo.unlink(missing_ok=True)
        return {"archivo": destino.name, "ruta": str(destino), "bytes": destino.stat().st_size, "incidencias": conteo, "integridad": "ok"}

    @_seguro
    def listar_respaldos(self):
        self._solo_supervision()
        carpeta = config.carpeta_app() / "respaldos"
        return [{"archivo": f.name, "bytes": f.stat().st_size, "fecha_utc": int(f.stat().st_mtime)} for f in sorted(carpeta.glob("pc08_*.sqlite3"), reverse=True)]

    @_seguro
    def restaurar(self, archivo):
        import sqlite3, shutil
        self._solo_supervision()
        carpeta = config.carpeta_app() / "respaldos"
        origen = carpeta / str(archivo)
        if origen.parent != carpeta or not origen.name.startswith("pc08_") or not origen.exists():
            raise ErrorAlmacen("RESPALDO", "Respaldo no encontrado.")
        prueba = carpeta / "_validacion.sqlite3"
        shutil.copyfile(origen, prueba)
        c = sqlite3.connect(str(prueba))
        try:
            if c.execute("PRAGMA integrity_check").fetchone()[0] != "ok" or c.execute("PRAGMA foreign_key_check").fetchall():
                raise ErrorAlmacen("RESPALDO", "La copia elegida no es íntegra; no se restauró nada.")
            conteo = c.execute("SELECT COUNT(*) FROM incidencia").fetchone()[0]
            seguridad = carpeta / "pc08_antes_de_restaurar.sqlite3"
            actual = sqlite3.connect(str(config.base_datos()))
            try:
                s2 = sqlite3.connect(str(seguridad)); actual.backup(s2); s2.close()
                c.backup(actual)  # reemplazo atómico del contenido de la base
            finally:
                actual.close()
        finally:
            c.close(); prueba.unlink(missing_ok=True)
        self._u = None
        return {"restaurado": origen.name, "incidencias": conteo, "copia_previa": "pc08_antes_de_restaurar.sqlite3"}

    @_seguro
    def cerrar(self):
        threading.Timer(0.4, lambda: os._exit(0)).start()
        return True
