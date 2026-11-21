# -*- coding: utf-8 -*-
"""
CANVAS MODEL IA - Pruebas automáticas de extremo a extremo (pruebas_automaticas.py)
-----------------------------------------------------------------------------------
Recorre todas las pantallas con los 5 roles y ejecuta el flujo completo:
carga Excel -> Canvas AS IS con IA -> aprobación -> TO BE con IA -> brechas ->
proyecto -> aprobación -> Gantt -> avance -> predicción -> simulación -> PPTX ->
auditoría. Usa una base de datos separada (./Entregable/prueba_qa.db) y no
modifica los datos del usuario.

Uso (desde la carpeta que contiene Entregable):  python ./Entregable/pruebas_automaticas.py
"""
import os, sys, time, json
sys.dont_write_bytecode = True  # no crear __pycache__ en Entregable
BASE = os.path.dirname(os.path.abspath(__file__))
os.chdir(os.path.dirname(BASE))
sys.path.insert(0, BASE)
import db
db.DB_PATH = "./Entregable/prueba_qa.db"
if os.path.exists(db.DB_PATH): os.remove(db.DB_PATH)
from streamlit.testing.v1 import AppTest
APP = os.path.join(BASE, "canvas_app.py")
LOG = []
INICIO = time.time()
def check(at, etiqueta):
    errs = [e.value for e in at.exception] + [e.value for e in at.error]
    LOG.append((etiqueta, "FALLA" if errs else "OK", errs[:2]))
    if errs: print("!!", etiqueta, errs[:2])
    return not errs
def btn(at, texto):
    for b in at.button:
        if b.label.startswith(texto): return b
    raise KeyError(texto + " | " + str([b.label for b in at.button]))
def ir(at, pagina):
    at.sidebar.radio(key="menu").set_value(pagina).run(timeout=120)

at = AppTest.from_file(APP, default_timeout=120).run()
check(at, "login render")
at.text_input[0].set_value("admin"); at.text_input[1].set_value("Admin2026!")
at.button[0].click().run()
check(at, "login admin")
btn(at, "📥 Cargar data de prueba").click().run()
check(at, "CP-01 carga data prueba")
print("carga:", [s.value for s in at.success][:2])
MENU = at.sidebar.radio(key="menu").options
for org in ["EMP01", "EMP02", "EMP03"]:
    at.sidebar.selectbox(key="org_id").set_value(org).run()
    for m in MENU:
        t = time.time(); ir(at, m); check(at, f"{org} {m}")
        if time.time()-t > 5: print("lento", org, m, round(time.time()-t,1))

# ---- CP-02 cuarentena
at.sidebar.selectbox(key="org_id").set_value("EMP01").run()
ir(at, MENU[1])
# ---- CP-03 nueva organización
at.text_input(key=None) if False else None
form_inputs = [ti for ti in at.text_input if ti.label.startswith("Razón social")]
form_inputs[0].set_value("Nueva Empresa QA Demo S.A.C.")
[n for n in at.number_input if n.label.startswith("Ventas anuales")][0].set_value(2_000_000.0)
btn(at, "Guardar organización").click().run()
check(at, "CP-03 nueva organización")
print("org actual:", at.sidebar.selectbox(key="org_id").value, [s.value for s in at.success][:1])
# ---- CP-04 formular AS IS con IA
ir(at, MENU[2])
btn(at, "🤖 Formular AS IS con IA").click().run()
check(at, "CP-04 formular AS IS IA")
sel = [s for s in at.selectbox if s.label == "Versión"][0]
print("version seleccionada:", sel.value)
btn(at, "📤 Enviar a revisión").click().run(); check(at, "enviar revisión")
btn(at, "✅ Aprobar").click().run(); check(at, "CP-06 aprobar AS IS")
print([s.value for s in at.success][:1])
# ---- TO BE para nueva org
ir(at, MENU[3])
btn(at, "🤖 Formular TO BE con IA").click().run(); check(at, "CP-07 formular TO BE IA")
btn(at, "📤 Enviar a revisión").click().run(); check(at, "enviar revisión TO BE")
btn(at, "✅ Aprobar").click().run(); check(at, "aprobar TO BE")
print([s.value for s in at.success][:1])
# ---- Brechas
ir(at, MENU[4])
btn(at, "🤖 Calcular brechas con IA").click().run(); check(at, "CP-09 calcular brechas")
btn(at, "💾 Guardar brechas propuestas").click().run(); check(at, "guardar brechas")
print([s.value for s in at.success][:1])
btn(at, "🤖 Generar proyecto propuesto con IA").click().run(); check(at, "generar proyecto")
print([s.value for s in at.success][:1])
btn(at, "✅ Aprobar proyecto").click().run(); check(at, "CP-10 aprobar proyecto")
print([s.value for s in at.success][:1])
# ---- Gantt
ir(at, MENU[5]); check(at, "gantt")
btn(at, "✅ Aprobar Gantt").click().run(); check(at, "CP-11 aprobar gantt")
print([s.value for s in at.success][:1])
# ---- Seguimiento: registrar avance
ir(at, MENU[6])
btn(at, "💾 Registrar").click().run(); check(at, "CP-12 registrar avance")
print([s.value for s in at.success][:1], [e.value for e in at.error][:1])
# ---- EMP01 predicción y reportes
at.sidebar.selectbox(key="org_id").set_value("EMP01").run()
ir(at, MENU[8])
btn(at, "📢 Publicar predicciones").click().run(); check(at, "CP-13 publicar predicciones")
print([s.value for s in at.success][:1])
btn(at, "💾 Guardar simulación").click().run(); check(at, "CP-08 guardar simulación")
ir(at, MENU[9])
btn(at, "⚙️ Generar PPTX").click().run(); check(at, "CP-16 PPTX")
print([s.value for s in at.success][:1])
ir(at, MENU[10])
btn(at, "🔐 Verificar integridad").click().run(); check(at, "CP-17 auditoría")
print([s.value for s in at.success][:1])
# ---- CP-05 edición de versión aprobada bloqueada -> clonar
ir(at, MENU[2])
print("info editar:", [i.value[:80] for i in at.info][:2])
btn(at, "🧬 Clonar").click().run(); check(at, "CP-05 clonar")
print([s.value for s in at.success][:1])
# ---- Comparar TO BE (CP-07)
ir(at, MENU[3]); check(at, "TO BE comparar render")
# ---- recorrido final de todas las páginas con otros roles
for u, p in [("gerente","Gerente2026!"),("pmo","Pmo2026!"),("analista","Analista2026!"),("auditor","Auditor2026!")]:
    a2 = AppTest.from_file(APP, default_timeout=120).run()
    a2.text_input[0].set_value(u); a2.text_input[1].set_value(p); a2.button[0].click().run()
    check(a2, f"login {u}")
    for m in MENU:
        a2.sidebar.radio(key="menu").set_value(m).run(); check(a2, f"{u} {m}")
# ---- Configuración: kill switch
ir(at, MENU[11]); check(at, "config")
fallas = [l for l in LOG if l[1] != "OK"]
print("TOTAL", len(LOG), "FALLAS", len(fallas))
with open("./Entregable/resultado_pruebas.json", "w", encoding="utf-8") as f:
    json.dump([{"prueba": a, "resultado": b, "detalle": c} for a, b, c in LOG], f, ensure_ascii=False, indent=1)
print("Detalle guardado en ./Entregable/resultado_pruebas.json")
ok, n, _ = db.verificar_auditoria()
print("Auditoría íntegra:", ok, "eventos:", n)
for f in os.listdir("./Entregable"):
    if f.startswith("Reporte_Avance_") and os.path.getmtime("./Entregable/" + f) > INICIO:
        os.remove("./Entregable/" + f)
os.remove(db.DB_PATH)
sys.exit(1 if fallas else 0)
