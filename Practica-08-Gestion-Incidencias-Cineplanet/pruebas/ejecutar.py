"""Pruebas automáticas de la base SQLite y de los permisos de la solución EXE (se ejecutan antes de empaquetar)."""
import hashlib
import os
import sys
import tempfile

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(RAIZ, "exe"))
os.environ["PC08_DATOS"] = tempfile.mkdtemp(prefix="pc08_prueba_")
from pc08.db import migrar, Almacen  # noqa: E402
from pc08.puente import Puente  # noqa: E402

fallos = []


def caso(n, obt, esp):
    ok = obt == esp
    fallos.extend([] if ok else [n])
    print(f"{'PASA' if ok else 'FALLA':5} {n}: esperado={esp!r} obtenido={obt!r}")


def cuenta(correo, rol, amb, clave, ref, roles=None):
    sal = "00112233445566778899aabbccddeeff"
    return {"op": "insertar", "tabla": "usuario", "ref": ref, "fila": {"correo": correo, "nombre": correo.split("@")[0], "rol": rol, "roles": roles or rol, "sede_id": None, "ambito": amb, "sal": sal,
            "hash": hashlib.pbkdf2_hmac("sha256", clave.encode(), bytes.fromhex(sal), 100000).hex(), "iteraciones": 100000, "activo": 1}}


caso("migraciones aplicadas (001–004)", migrar(), 4)
caso("migración repetida sin cambios", migrar(), 4)
A = Almacen()
P = Puente(A)
caso("sin semilla", P.estado_semilla()["datos"], None)
semilla = [{"op": "insertar", "tabla": "proyecto", "ref": "p", "fila": {"codigo": "CP-C12", "caso_catalogo": 12, "nombre": "Prueba", "sector": "SERVICIOS", "tamano": "GRANDE", "naturaleza": "SINTETICO", "objetivo": "o", "alcance": "a", "creado_utc": 1}},
           {"op": "insertar", "tabla": "sede", "ref": "s", "fila": {"proyecto_id": {"$ref": "p"}, "codigo": "S01", "nombre": "CP Alcázar", "piloto": 1}},
           {"op": "insertar", "tabla": "configuracion", "fila": {"clave": "modo", "valor": "DEMO"}},
           {"op": "insertar", "tabla": "configuracion", "fila": {"clave": "semilla", "valor": "3"}},
           cuenta("cli@x.pe", "CLIENTE", "DEMO", "Demo2026", "c"), cuenta("dig@x.pe", "DIGITAL", "DEMO", "Demo2026", "d"),
           cuenta("personal@x.pe", "DIGITAL", "PRODUCCION", "personal2026", "sp", "DIGITAL,BOLETERIA,SUPERVISION"),
           {"op": "insertar", "tabla": "tipo_incidencia", "fila": {"codigo": "T01", "nombre": "n", "grupo": "g", "prioritario": 1, "responsable_defecto": "r", "accion_sugerida": "a", "regla": "R", "palabras_clave": "", "activo": 1, "version": 1}}]
TABLAS = ["verificacion_enlace", "verificacion", "evento", "contacto", "evidencia", "incidencia", "compra", "funcion", "tipo_incidencia", "usuario", "sede", "configuracion", "proyecto"]
caso("semilla inicial sin sesión", P.sembrar("3", TABLAS, semilla)["ok"], True)
caso("semilla repetida sin Supervisión rechazada", P.sembrar("3", TABLAS, semilla)["codigo"], "PERMISO")
caso("sin sesión no se escribe", P.aplicar([{"op": "insertar", "tabla": "evento", "fila": {}}])["codigo"], "SESION")
caso("sin sesión no se leen cuentas", P.leer("usuario")["codigo"], "PERMISO")
caso("contraseña incorrecta", P.iniciar_sesion("dig@x.pe", "x")["codigo"], "CREDENCIALES")
caso("cuenta de Producción rechazada en modo Demo", P.iniciar_sesion("personal@x.pe", "personal2026")["codigo"], "CREDENCIALES")
caso("inicio de sesión devuelve vistas autorizadas", P.iniciar_sesion("dig@x.pe", "Demo2026")["datos"]["roles"], ["DIGITAL"])
caso("sin elegir vista no se lee la operación", P.leer("incidencia")["codigo"], "PERMISO")
caso("vista no autorizada rechazada", P.elegir_rol("SUPERVISION")["codigo"], "PERMISO")
caso("elegir vista autorizada", P.elegir_rol("DIGITAL")["datos"]["rol"], "DIGITAL")
caso("hash y sal no se exponen", "hash" in P.leer("usuario")["datos"][0], False)
inc = {"proyecto_id": 1, "sede_id": 1, "tipo_codigo": "T01", "descripcion": "d", "canal_origen": "CLIENTE", "estado": "NUEVO", "provisional": 0, "responsable": "r", "siguiente_accion": "s", "naturaleza": "SINTETICO", "version": 1, "apertura_utc": 1, "actualizado_utc": 1}
caso("Atención Digital no crea incidencias de cliente", P.aplicar([{"op": "insertar", "tabla": "incidencia", "fila": dict(inc, codigo="INC-0001")}])["codigo"], "PERMISO")
P.iniciar_sesion("cli@x.pe", "Demo2026"); P.elegir_rol("CLIENTE")
uid = P.info()["datos"]["sesion"]["id"]
caso("cliente registra su caso", P.aplicar([{"op": "insertar", "tabla": "incidencia", "ref": "i", "fila": dict(inc, codigo="INC-0001", cliente_id=uid)}])["ok"], True)
caso("cliente no registra a nombre de otro", P.aplicar([{"op": "insertar", "tabla": "incidencia", "fila": dict(inc, codigo="INC-0002", cliente_id=None)}])["codigo"], "PERMISO")
A.aplicar([{"op": "insertar", "tabla": "incidencia", "fila": dict(inc, codigo="INC-0099", cliente_id=None)}])
caso("cliente solo ve sus casos", [i["codigo"] for i in P.leer("incidencia")["datos"]], ["INC-0001"])
caso("cliente no lee eventos ajenos", P.leer("evento", {"incidencia_id": 2})["codigo"], "PERMISO")
caso("cliente no modifica estados", P.aplicar([{"op": "actualizar", "tabla": "incidencia", "id": 1, "version": 1, "cambios": {"estado": "RESUELTO"}}])["codigo"], "PERMISO")
caso("siguiente código global", P.siguiente_codigo("incidencia", "INC-")["datos"], "INC-0100")
P.iniciar_sesion("dig@x.pe", "Demo2026"); P.elegir_rol("DIGITAL")
r1 = P.aplicar([{"op": "actualizar", "tabla": "incidencia", "id": 1, "version": 1, "cambios": {"estado": "EN_VERIFICACION"}}])
r2 = P.aplicar([{"op": "actualizar", "tabla": "incidencia", "id": 1, "version": 1, "cambios": {"estado": "ESCALADO"}}])
caso("R24 primer cambio confirmado", r1["ok"], True)
caso("R24 segundo cambio con versión vieja → conflicto", (r2["codigo"], r2["vigente"]["estado"]), ("CONFLICTO", "EN_VERIFICACION"))
caso("lote atómico ante dato inválido", P.aplicar([{"op": "insertar", "tabla": "evento", "fila": {"incidencia_id": 1, "utc": 1, "tipo": "X", "canal": "DIGITAL", "actor": "a", "detalle": "d"}},
                                                  {"op": "insertar", "tabla": "verificacion", "fila": {"incidencia_id": 1, "utc": 1, "actor": "a", "estado_compra": "MAL", "estado_pago": "CONFIRMADO", "estado_emision": "EMITIDA", "estado_ingreso": "NO_APLICA", "origen": "o", "nota": ""}}])["codigo"], "INTEGRIDAD")
caso("…y no quedó el evento parcial", len(A.leer("evento", {"tipo": "X"})), 0)
caso("tabla no permitida", P.leer("sqlite_master")["codigo"], "PERMISO")
caso("pasar a Producción", P.cambiar_modo("PRODUCCION", "")["datos"], "PRODUCCION")
caso("volver a Demo sin clave de Supervisión", P.cambiar_modo("DEMO", "x")["codigo"], "CREDENCIALES")
caso("cuenta del personal con tres vistas en Producción", P.iniciar_sesion("personal@x.pe", "personal2026")["datos"]["roles"], ["DIGITAL", "BOLETERIA", "SUPERVISION"])
caso("volver a Demo con la contraseña del personal", P.cambiar_modo("DEMO", "personal2026")["datos"], "DEMO")
P.cambiar_modo("PRODUCCION", ""); P.iniciar_sesion("personal@x.pe", "personal2026"); P.elegir_rol("SUPERVISION")
iv = {"proyecto_id": 1, "codigo": "EM1", "version": 1, "estado": "COMPLETA", "contenido": "{}", "naturaleza": "SIMULADO", "autor": "a", "fecha_utc": 1}
caso("Supervisión guarda versión de herramienta", P.aplicar([{"op": "insertar", "tabla": "instrumento_version", "fila": iv}])["ok"], True)
caso("versión repetida rechazada", P.aplicar([{"op": "insertar", "tabla": "instrumento_version", "fila": iv}])["codigo"], "UNICO")
caso("contenido JSON inválido rechazado", P.aplicar([{"op": "insertar", "tabla": "instrumento_version", "fila": dict(iv, version=2, contenido="{x")}])["codigo"], "INTEGRIDAD")
lote = {"proyecto_id": 1, "huella_sha256": "a" * 64, "archivo": "x.xlsx", "fecha_utc": 1, "usuario": "u", "filas_leidas": 1, "filas_nuevas": 1, "filas_existentes": 0, "resumen": "{}"}
caso("lote registrado", P.aplicar([{"op": "insertar", "tabla": "lote_importado", "fila": lote}])["ok"], True)
caso("mismo lote (huella) rechazado", P.aplicar([{"op": "insertar", "tabla": "lote_importado", "fila": lote}])["codigo"], "UNICO")
P.iniciar_sesion("personal@x.pe", "personal2026"); P.elegir_rol("DIGITAL")
caso("Atención Digital no edita Design Thinking", P.aplicar([{"op": "insertar", "tabla": "instrumento_version", "fila": dict(iv, version=3)}])["codigo"], "PERMISO")
caso("Atención Digital no crea respaldos", P.respaldar()["codigo"], "PERMISO")
P.elegir_rol("SUPERVISION")
r = P.respaldar(); caso("respaldo creado e íntegro", (r["ok"], r["datos"]["integridad"]), (True, "ok"))
antes = len(A.leer("incidencia"))
A.aplicar([{"op": "insertar", "tabla": "incidencia", "fila": dict(inc, codigo="INC-0500", cliente_id=None)}])
caso("listar respaldos", len(P.listar_respaldos()["datos"]) >= 1, True)
caso("restaurar respaldo", P.restaurar(r["datos"]["archivo"])["ok"], True)
caso("…vuelve al estado del respaldo", len(A.leer("incidencia")), antes)
caso("restaurar nombre inválido rechazado", P.restaurar("../x.sqlite3")["codigo"], "PERMISO")
# v0.7.0 · feriados oficiales (dato real por internet)
from pc08 import enlaces
P.iniciar_sesion("personal@x.pe", "personal2026"); P.elegir_rol("SUPERVISION")
caso("feriados: dominio no aprobado rechazado", enlaces.obtener_json("https://google.com/x")["estado"], "NO_VERIFICADO")
caso("feriados: año no válido", P.consultar_feriados("abc")["codigo"], "VALIDACION")
caso("configuración: solo se inserta la clave de feriados", P.aplicar([{"op": "insertar", "tabla": "configuracion", "fila": {"clave": "otra", "valor": "x"}}])["codigo"], "PERMISO")
caso("configuración: Supervisión guarda feriados", P.aplicar([{"op": "insertar", "tabla": "configuracion", "fila": {"clave": "feriados_PE", "valor": "{}"}}])["ok"], True)
P.elegir_rol("DIGITAL")
caso("Atención Digital no guarda feriados", P.aplicar([{"op": "insertar", "tabla": "configuracion", "fila": {"clave": "feriados_PE", "valor": "{}"}}])["codigo"], "PERMISO")
P.elegir_rol("SUPERVISION")
caso("integridad", A.integridad(), "ok")
print(f"\nResultado: {'FALLA' if fallos else 'PASA'} ({len(fallos)} fallos)")
sys.exit(1 if fallos else 0)
