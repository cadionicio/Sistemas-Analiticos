"""Prueba de volumen y concurrencia de la solución EXE (base SQLite real y unidad de trabajo de la aplicación).
Escenario: 1.000 incidencias acumuladas (con contactos y eventos) y 5 sesiones simuladas durante 60 s con 70 % lecturas y 30 % escrituras.
Metas: p95 ≤ 1 s en consultas paginadas; p95 ≤ 2 s en guardados; cero pérdidas, duplicados indebidos o escrituras parciales."""
import json, os, platform, random, sqlite3, statistics, sys, tempfile, threading, time
RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(RAIZ, "exe"))
os.environ["PC08_DATOS"] = tempfile.mkdtemp(prefix="pc08_carga_")
from pc08.db import migrar, Almacen, ErrorAlmacen, conectar  # noqa: E402

DURACION = int(os.environ.get("PC08_DURACION", "60")); SESIONES = 5; N = 1000
rnd = random.Random(20261126)
migrar(); A = Almacen(); t0 = int(time.time())
ops = [{"op": "insertar", "tabla": "proyecto", "ref": "p", "fila": {"codigo": "CP-C12", "caso_catalogo": 12, "nombre": "Carga", "sector": "SERVICIOS", "tamano": "GRANDE", "naturaleza": "SINTETICO", "objetivo": "o", "alcance": "a", "creado_utc": t0}},
       {"op": "insertar", "tabla": "sede", "ref": "s", "fila": {"proyecto_id": {"$ref": "p"}, "codigo": "S01", "nombre": "CP Alcázar", "piloto": 1}},
       {"op": "insertar", "tabla": "tipo_incidencia", "fila": {"codigo": "T01", "nombre": "Cobro sin entrada", "grupo": "g", "prioritario": 1, "responsable_defecto": "Atención Digital", "accion_sugerida": "a", "regla": "R11", "palabras_clave": "", "activo": 1, "version": 1}}]
for f in range(40):
    ops.append({"op": "insertar", "tabla": "funcion", "ref": f"f{f}", "fila": {"proyecto_id": {"$ref": "p"}, "sede_id": {"$ref": "s"}, "codigo": f"FUN-{f:03d}", "pelicula": "Avengers: Doomsday", "sala": "Sala 1", "inicio_utc": t0 + f * 900, "horario_estado": "CONFIRMADO", "naturaleza": "SINTETICO"}})
for i in range(N):
    ops.append({"op": "insertar", "tabla": "incidencia", "ref": f"i{i}", "fila": {"proyecto_id": {"$ref": "p"}, "codigo": f"INC-{i + 1:05d}", "funcion_id": {"$ref": f"f{i % 40}"}, "sede_id": {"$ref": "s"}, "tipo_codigo": "T01", "descripcion": "Carga sintética", "canal_origen": "CLIENTE", "estado": "NUEVO", "provisional": 0, "responsable": "Atención Digital", "siguiente_accion": "Verificar", "naturaleza": "SINTETICO", "version": 1, "apertura_utc": t0 - rnd.randint(60, 3600), "actualizado_utc": t0}})
    for k in range(1 + i % 3):
        ops.append({"op": "insertar", "tabla": "contacto", "fila": {"incidencia_id": {"$ref": f"i{i}"}, "canal": "CLIENTE", "clave_origen": f"c-{i}-{k}", "registrado_utc": t0, "detalle": "x"}})
    ops.append({"op": "insertar", "tabla": "evento", "fila": {"incidencia_id": {"$ref": f"i{i}"}, "utc": t0, "tipo": "REPORTE_RECIBIDO", "canal": "CLIENTE", "actor": "Cliente", "detalle": "x", "regla": "R01"}})
ini = time.perf_counter(); A.aplicar(ops); carga_s = time.perf_counter() - ini
ids = [r["id"] for r in A.leer("incidencia")]

lect, escr, conflictos, exitos, errores = [], [], [0], [0], []
bloqueo = threading.Lock(); fin = time.time() + DURACION
def sesion(n):
    r = random.Random(n); a = Almacen()
    while time.time() < fin:
        try:
            if r.random() < 0.7:  # consulta paginada de la bandeja (como Nucleo.listar) o apertura de expediente
                s = time.perf_counter()
                if r.random() < 0.5:
                    filas = a.leer("incidencia", {"proyecto_id": 1}); a.leer("funcion", {"proyecto_id": 1}); sorted(filas, key=lambda x: x["apertura_utc"])[:25]
                else:
                    i = r.choice(ids); a.obtener("incidencia", i); a.leer("evento", {"incidencia_id": i}); a.leer("contacto", {"incidencia_id": i})
                d = time.perf_counter() - s
                with bloqueo: lect.append(d)
            else:  # derivación con control de versión: actualiza incidencia + inserta evento en una sola transacción
                i = r.choice(ids); v = a.obtener("incidencia", i)["version"]; s = time.perf_counter()
                try:
                    a.aplicar([{"op": "actualizar", "tabla": "incidencia", "id": i, "version": v, "cambios": {"estado": "EN_ATENCION", "actualizado_utc": int(time.time())}},
                               {"op": "insertar", "tabla": "evento", "fila": {"incidencia_id": i, "utc": int(time.time()), "tipo": "PRUEBA_CARGA", "canal": "DIGITAL", "actor": f"S{n}", "detalle": "x", "regla": "R24"}}])
                    with bloqueo: exitos[0] += 1
                except ErrorAlmacen as e:
                    if e.codigo != "CONFLICTO": raise
                    with bloqueo: conflictos[0] += 1
                d = time.perf_counter() - s
                with bloqueo: escr.append(d)
        except Exception as e:  # noqa: BLE001
            with bloqueo: errores.append(repr(e))
hilos = [threading.Thread(target=sesion, args=(k,)) for k in range(SESIONES)]
[h.start() for h in hilos]; [h.join() for h in hilos]

con = conectar()
ev = con.execute("SELECT COUNT(*) FROM evento WHERE tipo='PRUEBA_CARGA'").fetchone()[0]
suma_versiones = con.execute("SELECT SUM(version - 1) FROM incidencia").fetchone()[0]
dup = con.execute("SELECT COUNT(*) FROM (SELECT codigo FROM incidencia GROUP BY codigo HAVING COUNT(*) > 1)").fetchone()[0]
integ = con.execute("PRAGMA integrity_check").fetchone()[0]; fk = len(con.execute("PRAGMA foreign_key_check").fetchall())
con.close()
p95 = lambda xs: statistics.quantiles(xs, n=20)[18] if len(xs) >= 20 else max(xs or [0])
r = {"equipo": f"{platform.system()} {platform.release()} · {platform.machine()} · Python {platform.python_version()} · SQLite {sqlite3.sqlite_version}",
     "incidencias": N, "filas_carga": len(ops), "carga_s": round(carga_s, 2), "sesiones": SESIONES, "duracion_s": DURACION,
     "lecturas": len(lect), "escrituras": len(escr), "p95_lectura_s": round(p95(lect), 4), "p95_escritura_s": round(p95(escr), 4),
     "escrituras_confirmadas": exitos[0], "conflictos_detectados": conflictos[0], "eventos_registrados": ev, "versiones_incrementadas": suma_versiones,
     "duplicados": dup, "integridad": integ, "fk_errores": fk, "errores": errores[:5]}
r["sin_perdidas"] = ev == exitos[0] == suma_versiones
r["cumple"] = r["p95_lectura_s"] <= 1 and r["p95_escritura_s"] <= 2 and r["sin_perdidas"] and not dup and integ == "ok" and not fk and not errores
print(json.dumps(r, ensure_ascii=False, indent=1))
sys.exit(0 if r["cumple"] else 1)
