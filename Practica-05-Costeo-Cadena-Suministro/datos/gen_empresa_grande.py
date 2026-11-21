# Generador reproducible de un conjunto de datos de GRAN ESCALA (DATOS SINTÉTICOS, empresa ficticia).
# Formato normalizado del sistema (mismas hojas y columnas que 05_Datos_Entrada.xlsx).
# Semilla fija; 24 meses (nov-2024 a oct-2026). Los resultados de costeo NO se escriben aquí:
# los calcula exclusivamente el motor del sistema.
import random, math, sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

SEED = 20261105
rnd = random.Random(SEED)
OUT = sys.argv[1] if len(sys.argv) > 1 else "Datos_Empresa_Gran_Escala.xlsx"
EMPRESA = "Distribuidora Integral Andes Sur S.A.C. — DATOS SINTÉTICOS (empresa ficticia)"

MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"]
periodos = []
y, m = 2024, 11
for i in range(24):
    periodos.append((f"{y}-{m:02d}", f"{MESES[m-1]} {y}", i + 1, m, y))
    m += 1
    if m == 13: m, y = 1, y + 1
ESTAC = {1:0.90, 2:0.87, 3:0.95, 4:0.97, 5:1.00, 6:1.02, 7:1.09, 8:1.00, 9:0.98, 10:1.03, 11:1.11, 12:1.28}
def r2(x): return round(x + 1e-12, 2)
def r4(x): return round(x + 1e-12, 4)
def g(x, s=0.03): return x * rnd.gauss(1, s)

# =====================================================================================
# 1. CLIENTES (objetos de costo): 47 clientes / carteras en 4 regiones
# =====================================================================================
REG = ["LIMA", "NORTE", "SUR", "CENTRO"]
# segmento: (pedidos/mes base, líneas por pedido, entregas por pedido, % devolución, % error, ticket S/, peso kg por pedido, % compras importadas)
SEG = {
    "MAY": (290, 18.0, 0.55, 0.010, 0.012, 4600, 820, 0.35),
    "SUP": (420, 26.0, 0.80, 0.015, 0.015, 3300, 540, 0.30),
    "MIN": (1450, 4.5, 0.95, 0.025, 0.022, 380, 38, 0.20),
    "FAR": (220, 11.0, 0.90, 0.012, 0.010, 950, 60, 0.45),
    "ECO": (3400, 1.8, 1.00, 0.070, 0.035, 145, 4, 0.25),
    "MKT": (1100, 1.6, 1.00, 0.085, 0.040, 160, 5, 0.25),
    "COR": (80, 34.0, 0.45, 0.008, 0.008, 6100, 1300, 0.40),
    "EXP": (9, 60.0, 0.12, 0.004, 0.005, 46000, 9500, 0.60),
}
SEG_NOM = {"MAY": "Mayorista", "SUP": "Supermercados y autoservicios", "MIN": "Cartera minorista", "FAR": "Farmacias y boticas",
           "ECO": "E-commerce", "MKT": "Marketplace", "COR": "Corporativo e institucional", "EXP": "Exportación"}
clientes = []  # (codigo, nombre, segmento, region, factor de tamaño)
def cli(nombre, seg, reg, f=1.0): clientes.append((f"CL{len(clientes)+1:02d}", nombre, seg, reg, f))
for n, r, f in [("Comercial Mirasol del Pacífico", "LIMA", 1.4), ("Distribuidora Huaral Centro", "LIMA", 1.1), ("Mayorista Puerta Norte", "LIMA", 0.9),
                ("Abarrotes Valle Rímac", "LIMA", 1.0), ("Mercantil Santa Inés", "LIMA", 0.8), ("Comercial Ribera Moche", "NORTE", 1.0),
                ("Distribuidora Sol de Lambayeque", "NORTE", 0.9), ("Mayorista Altiplano Misti", "SUR", 1.1), ("Comercial Valle Sagrado Andino", "SUR", 0.7),
                ("Abastos Mantaro", "CENTRO", 0.9)]:
    cli(n, "MAY", r, f)
for n, r, f in [("Autoservicios Buenaventura", "LIMA", 1.5), ("Supermercados Nuevo Día", "LIMA", 1.2), ("Market Las Palmeras", "LIMA", 0.9),
                ("Hipermercados Costa Verde", "LIMA", 1.3), ("Supermercados Norteño Plus", "NORTE", 1.0), ("Autoservicios Chimú", "NORTE", 0.7),
                ("Supermercados Ciudad Blanca", "SUR", 1.0), ("Autoservicios Wanka", "CENTRO", 0.8)]:
    cli(n, "SUP", r, f)
for z, r, f in [("Lima Norte", "LIMA", 1.3), ("Lima Sur", "LIMA", 1.1), ("Lima Este", "LIMA", 1.25), ("Lima Centro", "LIMA", 1.0), ("Callao", "LIMA", 0.9),
                ("Trujillo", "NORTE", 0.8), ("Chiclayo", "NORTE", 0.7), ("Piura", "NORTE", 0.75), ("Arequipa", "SUR", 0.85), ("Cusco", "SUR", 0.6),
                ("Tacna", "SUR", 0.45), ("Huancayo", "CENTRO", 0.6)]:
    cli(f"Cartera minorista (bodegas) — {z}", "MIN", r, f)
for n, r, f in [("Boticas Salud Plena", "LIMA", 1.3), ("Farmacias Vida Andina", "LIMA", 1.0), ("Boticas del Norte Unidas", "NORTE", 0.8), ("Farmacias Sur Vital", "SUR", 0.7)]:
    cli(n, "FAR", r, f)
cli("Tienda en línea propia", "ECO", "LIMA", 1.0)
cli("Marketplace Compralisto", "MKT", "LIMA", 1.0)
cli("Marketplace Mercado Andino", "MKT", "LIMA", 0.7)
for n, r, f in [("Clínica San Gabriel del Sur", "LIMA", 1.0), ("Hoteles Cadena Horizonte", "LIMA", 1.2), ("Universidad Privada del Pacífico", "LIMA", 0.8),
                ("Concesionaria de Comedores Andinos", "LIMA", 1.4), ("Minera Cerro Azul (campamentos)", "SUR", 1.5), ("Agroexportadora Valle Verde", "NORTE", 1.1),
                ("Red de Hospitales Regional Centro", "CENTRO", 0.9), ("Constructora Pirámide Andina", "LIMA", 0.7)]:
    cli(n, "COR", r, f)
cli("Cliente de exportación — Bolivia", "EXP", "SUR", 1.0)
cli("Cliente de exportación — Ecuador", "EXP", "NORTE", 0.8)

# métricas por cliente y período
MET = {}
crec = {"MAY": 0.004, "SUP": 0.006, "MIN": 0.005, "FAR": 0.007, "ECO": 0.022, "MKT": 0.028, "COR": 0.003, "EXP": 0.010}
for (cod, _, i, mes, anio) in periodos:
    for (cc, _, seg, reg, f) in clientes:
        b, lin, ent, dev, err, tic, kg, imp = SEG[seg]
        est = ESTAC[mes] if seg not in ("COR", "EXP") else (1 + (ESTAC[mes] - 1) * 0.3)
        ped = max(1, round(b * f * ((1 + crec[seg]) ** (i - 1)) * est * rnd.gauss(1, 0.04)))
        MET[(cod, cc)] = {"pedidos": ped, "lineas": g(ped * lin), "entregas": g(ped * ent), "devol": g(ped * dev, 0.12), "error": g(ped * err, 0.12),
                          "ventas": g(ped * tic, 0.02), "kg": g(ped * kg), "imp": imp, "reg": reg, "seg": seg}
tot = {p[0]: sum(MET[(p[0], c[0])]["pedidos"] for c in clientes) for p in periodos}
tot0 = tot[periodos[0][0]]
REL = {p: tot[p] / tot0 for p in tot}

# =====================================================================================
# 2. CENTROS, ACTIVIDADES Y ESTRUCTURA
# =====================================================================================
centros = [
    ("CA01", "Planeamiento de demanda y abastecimiento", "PARCIAL", 0.60, "El 60 % de su capacidad atiende la cadena (planes de reposición); el resto es planeamiento comercial", "LIMA"),
    ("CA02", "Compras nacionales", "PARTICIPA", None, "", "LIMA"),
    ("CA03", "Compras de importación y comercio exterior", "PARTICIPA", None, "", "LIMA"),
    ("CA04", "Recepción — Centro de distribución Lima", "PARTICIPA", None, "", "LIMA"),
    ("CA05", "Almacenamiento — Centro de distribución Lima", "PARTICIPA", None, "", "LIMA"),
    ("CA06", "Preparación de pedidos — Centro de distribución Lima", "PARTICIPA", None, "", "LIMA"),
    ("CA07", "Empaque y servicios de valor agregado", "PARTICIPA", None, "", "LIMA"),
    ("CA08", "Almacén regional Norte (Trujillo)", "PARTICIPA", None, "", "NORTE"),
    ("CA09", "Almacén regional Sur (Arequipa)", "PARTICIPA", None, "", "SUR"),
    ("CA10", "Almacén regional Centro (Huancayo)", "PARTICIPA", None, "", "CENTRO"),
    ("CA11", "Distribución Lima Metropolitana", "PARTICIPA", None, "", "LIMA"),
    ("CA12", "Transporte interprovincial", "PARTICIPA", None, "", "LIMA"),
    ("CA13", "Logística inversa y devoluciones", "PARTICIPA", None, "", "LIMA"),
    ("CA14", "Control de calidad", "PARCIAL", 0.45, "El 45 % de su capacidad son inspecciones de la cadena; el resto es aseguramiento de normas", "LIMA"),
    ("CA15", "Mantenimiento de flota y equipos", "PARCIAL", 0.70, "El 70 % atiende flota y equipos de la cadena; el resto, instalaciones administrativas", "LIMA"),
    ("CA16", "Tecnología de información", "NO_PARTICIPA", None, "Centro de soporte fuera de la cadena", "LIMA"),
    ("CA17", "Administración y finanzas", "NO_PARTICIPA", None, "Centro de soporte fuera de la cadena", "LIMA"),
    ("CA18", "Comercial y atención al cliente", "NO_PARTICIPA", None, "Centro de soporte fuera de la cadena", "LIMA"),
    ("CA19", "Gestión del talento humano", "NO_PARTICIPA", None, "Centro de soporte fuera de la cadena", "LIMA"),
]
CEN = {c[0]: c for c in centros}
PART = [c[0] for c in centros if c[2] != "NO_PARTICIPA"]
# actividad: (codigo, nombre, centro, alcance, clase, métrica AC_OC, inductor AC_OC, unidad)
A = []
def act(cod, nom, ca, met, ind, uni, clase="AV", alcance="INCLUIDA"):
    A.append((cod, nom, ca, alcance, clase, met, ind, uni))
act("A01", "Pronosticar la demanda por cliente", "CA01", "pedidos", "Pedidos atendidos", "pedido", "AV")
act("A02", "Planificar la reposición de inventarios", "CA01", "lineas", "Líneas de pedido", "línea", "AV")
act("X01", "Elaborar planes comerciales de temporada", "CA01", None, None, None, None, "EXCLUIDA")
act("A03", "Evaluar y homologar proveedores nacionales", "CA02", "compra_nac", "Volumen de compra nacional asociado", "S/ mil", "NAVN")
act("A04", "Emitir órdenes de compra nacionales", "CA02", "compra_nac", "Volumen de compra nacional asociado", "S/ mil", "AV")
act("A05", "Hacer seguimiento a proveedores nacionales", "CA02", "plano", "Reparto plano (sin registro por cliente)", "destino", "NAVN")
act("A06", "Gestionar órdenes de importación", "CA03", "compra_imp", "Volumen de compra importada asociado", "S/ mil", "AV")
act("A07", "Tramitar despacho aduanero", "CA03", "compra_imp", "Volumen de compra importada asociado", "S/ mil", "NAVN")
act("A08", "Recibir y descargar mercadería", "CA04", "kg_lima", "Kilogramos despachados desde Lima", "kg", "AV")
act("A09", "Inspeccionar la recepción", "CA04", "kg_lima", "Kilogramos despachados desde Lima", "kg", "NAVN")
act("A10", "Registrar ingresos en el WMS", "CA04", "lineas_lima", "Líneas despachadas desde Lima", "línea", "NAVN")
act("A11", "Ubicar y almacenar pallets", "CA05", "kg_lima", "Kilogramos despachados desde Lima", "kg", "AV")
act("A12", "Reabastecer ubicaciones de picking", "CA05", "lineas_lima", "Líneas despachadas desde Lima", "línea", "AV")
act("A13", "Controlar inventario (conteo cíclico)", "CA05", "lineas_lima", "Líneas despachadas desde Lima", "línea", "NAVN")
act("A14", "Reubicar mercadería mal ubicada", "CA05", "lineas_lima", "Líneas despachadas desde Lima", "línea", "NAVI")
act("X02", "Capacitar al personal del centro de distribución", "CA05", None, None, None, None, "EXCLUIDA")
act("A15", "Preparar pedidos (picking por línea)", "CA06", "lineas_lima", "Líneas preparadas en Lima", "línea", "AV")
act("A16", "Consolidar pedidos por ruta", "CA06", "pedidos_lima", "Pedidos preparados en Lima", "pedido", "AV")
act("A17", "Reprocesar pedidos con error", "CA06", "error", "Pedidos reprocesados", "pedido", "NAVI")
act("A18", "Empacar y etiquetar pedidos", "CA07", "pedidos_lima", "Pedidos empacados en Lima", "pedido", "AV")
act("A19", "Armar kits y exhibidores promocionales", "CA07", "kits", "Kits armados", "kit", "AV")
act("A20", "Rotular pedidos de comercio electrónico", "CA07", "pedidos_eco", "Pedidos digitales rotulados", "pedido", "AV")
for ca, rg, base in [("CA08", "NORTE", 21), ("CA09", "SUR", 26), ("CA10", "CENTRO", 31)]:
    nm = CEN[ca][1].split("(")[1].rstrip(")")
    act(f"A{base}", f"Recibir transferencias en {nm}", ca, f"kg_{rg}", f"Kilogramos despachados desde {nm}", "kg", "AV")
    act(f"A{base+1}", f"Almacenar mercadería en {nm}", ca, f"kg_{rg}", f"Kilogramos despachados desde {nm}", "kg", "AV")
    act(f"A{base+2}", f"Preparar pedidos en {nm}", ca, f"lineas_{rg}", f"Líneas preparadas en {nm}", "línea", "AV")
    act(f"A{base+3}", f"Despachar pedidos regionales en {nm}", ca, f"entregas_{rg}", f"Entregas realizadas en {nm}", "entrega", "AV")
    if ca == "CA09":
        act(f"A{base+4}", f"Regularizar diferencias de inventario en {nm}", ca, f"lineas_{rg}", f"Líneas preparadas en {nm}", "línea", "NAVI")
act("A36", "Planificar rutas de reparto en Lima", "CA11", "entregas_LIMA", "Entregas realizadas en Lima", "entrega", "AV")
act("A37", "Cargar unidades de reparto", "CA11", "kg_LIMA", "Kilogramos entregados en Lima", "kg", "AV")
act("A38", "Repartir pedidos en Lima Metropolitana", "CA11", "entregas_LIMA", "Entregas realizadas en Lima", "entrega", "AV")
act("A39", "Reprogramar entregas fallidas", "CA11", "fallidas", "Entregas reprogramadas", "entrega", "NAVI")
act("X03", "Elaborar reportes gerenciales de distribución", "CA11", None, None, None, None, "EXCLUIDA")
act("A40", "Planificar transferencias interprovinciales", "CA12", "kg_prov", "Kilogramos transferidos a provincias", "kg", "AV")
act("A41", "Transportar carga a almacenes regionales", "CA12", "kg_prov", "Kilogramos transferidos a provincias", "kg", "AV")
act("A42", "Transportar pedidos de exportación a frontera", "CA12", "kg_exp", "Kilogramos exportados", "kg", "AV")
act("A43", "Recibir y clasificar devoluciones", "CA13", "devol", "Devoluciones recibidas", "devolución", "NAVI")
act("A44", "Reacondicionar productos devueltos", "CA13", "devol", "Devoluciones recibidas", "devolución", "NAVI")
act("A45", "Gestionar notas de crédito por devolución", "CA13", "devol", "Devoluciones recibidas", "devolución", "NAVN")
act("A46", "Inspeccionar lotes de recepción", "CA14", "kg_lima", "Kilogramos despachados desde Lima", "kg", "NAVN")
act("A47", "Auditar pedidos antes del despacho", "CA14", "pedidos", "Pedidos auditados (muestra proporcional)", "pedido", "NAVN")
act("X04", "Gestionar certificaciones y normas", "CA14", None, None, None, None, "EXCLUIDA")
act("A48", "Mantener la flota de reparto", "CA15", "entregas", "Entregas realizadas", "entrega", "NAVN")
act("A49", "Mantener montacargas y equipos del almacén", "CA15", "kg", "Kilogramos despachados", "kg", "NAVN")
act("X05", "Mantener instalaciones administrativas", "CA15", None, None, None, None, "EXCLUIDA")
act("X06", "Dar soporte a sistemas", "CA16", None, None, None, None, "EXCLUIDA")
act("X07", "Gestionar contabilidad y tesorería", "CA17", None, None, None, None, "EXCLUIDA")
act("X08", "Atender clientes y gestionar ventas", "CA18", None, None, None, None, "EXCLUIDA")
act("X09", "Gestionar planillas y selección", "CA19", None, None, None, None, "EXCLUIDA")
ACT = {a[0]: a for a in A}
acts_ca = {}
for a in A: acts_ca.setdefault(a[2], []).append(a[0])

def metrica(cod_per, cc, met):
    M = MET[(cod_per, cc)]
    lima_share = 1.0 if M["reg"] == "LIMA" else 0.0
    if met == "pedidos": return M["pedidos"]
    if met == "lineas": return M["lineas"]
    if met == "entregas": return M["entregas"]
    if met == "kg": return M["kg"]
    if met == "error": return M["error"]
    if met == "devol": return M["devol"]
    if met == "compra_nac": return M["ventas"] * 0.68 * (1 - M["imp"]) / 1000
    if met == "compra_imp": return M["ventas"] * 0.68 * M["imp"] / 1000
    # el CD Lima abastece a Lima y transfiere a provincias (recibe todo; prepara solo Lima)
    if met == "kg_lima": return M["kg"]
    if met == "lineas_lima": return M["lineas"] * lima_share + M["lineas"] * 0.15 * (1 - lima_share)
    if met == "pedidos_lima": return M["pedidos"] * lima_share
    if met == "pedidos_eco": return M["pedidos"] if M["seg"] in ("ECO", "MKT") else 0
    if met == "kits": return M["pedidos"] * (0.06 if M["seg"] in ("SUP", "MAY") else 0.01 if M["seg"] == "FAR" else 0)
    if met == "fallidas": return M["entregas"] * lima_share * (0.07 if M["seg"] in ("ECO", "MKT") else 0.03 if M["seg"] == "MIN" else 0.012)
    if met == "kg_prov": return M["kg"] * (1 - lima_share) * (0 if M["seg"] == "EXP" else 1)
    if met == "kg_exp": return M["kg"] if M["seg"] == "EXP" else 0
    if met.startswith("kg_"): return M["kg"] * (1 if M["reg"] == met[3:] else 0)
    if met.startswith("lineas_"): return M["lineas"] * (1 if M["reg"] == met[7:] else 0)
    if met.startswith("entregas_"): return M["entregas"] * (1 if M["reg"] == met[9:] else 0)
    raise KeyError(met)

# =====================================================================================
# 3. PUESTOS Y PERSONAS (350 personas)
# =====================================================================================
puestos = []
def pu(nom, tipo, rem): puestos.append((f"PU{len(puestos)+1:02d}", nom, tipo, rem)); return puestos[-1][0]
P_PLAN = pu("Planificador de demanda", "DIRECTO", 5200); P_COMP = pu("Comprador", "DIRECTO", 4600); P_ACOMP = pu("Asistente de compras", "DIRECTO", 2600)
P_JCOMP = pu("Jefe de compras", "DIRECTO", 9800); P_COMEX = pu("Analista de comercio exterior", "DIRECTO", 5400); P_ACOMEX = pu("Asistente de importaciones", "DIRECTO", 2800)
P_AREC = pu("Asistente de recepción", "DIRECTO", 2300); P_OPE = pu("Operario de almacén", "DIRECTO", 1650); P_MONT = pu("Operador de montacargas", "DIRECTO", 2250)
P_CINV = pu("Controlador de inventarios", "DIRECTO", 2700); P_PREP = pu("Preparador de pedidos", "DIRECTO", 1600); P_AWMS = pu("Asistente WMS", "DIRECTO", 2400)
P_EMP = pu("Empacador", "DIRECTO", 1550); P_ETI = pu("Etiquetador de valor agregado", "DIRECTO", 1600); P_PRUT = pu("Planificador de rutas", "DIRECTO", 4100)
P_COND = pu("Conductor de reparto", "DIRECTO", 2450); P_AUX = pu("Auxiliar de reparto", "DIRECTO", 1600); P_CDES = pu("Coordinador de despacho", "DIRECTO", 3300)
P_CONDP = pu("Conductor interprovincial", "DIRECTO", 3400); P_OINV = pu("Operario de logística inversa", "DIRECTO", 1700); P_AINV = pu("Analista de devoluciones", "DIRECTO", 3200)
P_INSP = pu("Inspector de calidad", "DIRECTO", 3300); P_MEC = pu("Técnico mecánico", "DIRECTO", 3200); P_TEQ = pu("Técnico de equipos", "DIRECTO", 2900)
P_SUP = pu("Supervisor de operaciones", "INDIRECTO", 5600); P_JEF = pu("Jefe de área", "INDIRECTO", 9200); P_GER = pu("Gerente de cadena de suministro", "INDIRECTO", 21000)
P_TI = pu("Especialista de TI", "INDIRECTO", 6100); P_CONT = pu("Analista contable", "INDIRECTO", 4300); P_ADM = pu("Asistente administrativo", "INDIRECTO", 2500)
P_EJC = pu("Ejecutivo comercial", "INDIRECTO", 4200); P_ATC = pu("Asesor de atención al cliente", "INDIRECTO", 2100); P_RRHH = pu("Analista de talento humano", "INDIRECTO", 3900)
REM = {p[0]: p[3] for p in puestos}; TIPO = {p[0]: p[2] for p in puestos}

NOMBRES = ["Ana","Bruno","Carla","Diego","Elena","Fabio","Gina","Hugo","Irene","Jorge","Karen","Luis","Marta","Néstor","Olga","Pablo","Rosa","Saúl","Tania","Ulises",
           "Vilma","Walter","Ximena","Yuri","Zoila","Alberto","Beatriz","César","Daniela","Eduardo","Fiorella","Gustavo","Héctor","Isabel","Javier","Katia","Lorena",
           "Manuel","Nadia","Óscar","Patricia","Raúl","Sandra","Tomás","Úrsula","Víctor","Wendy","Yesenia","Alicia","Benjamín","Claudia","Dante","Estela","Felipe",
           "Gabriela","Iván","Julia","Kevin","Liliana","Mario","Noemí","Omar","Pilar","Renato","Silvia","Teodoro","Valeria","Wilmer","Abel","Brenda","Cristian","Doris"]
APELLIDOS = ["Rojas","Salas","Quispe","Huamán","Castro","Ramos","Torres","Paredes","Vargas","Medina","Flores","Cárdenas","Ríos","Gil","Soto","Chávez","León","Ortiz",
             "Mejía","Vega","Arce","Ponce","Luna","Campos","Tapia","Mendoza","Gutiérrez","Sánchez","Díaz","Romero","Mamani","Condori","Espinoza","Reyes","Morales",
             "Cruz","Aguilar","Herrera","Silva","Ccori","Palomino","Alarcón","Benites","Cáceres","Zevallos","Inga","Pacheco","Villanueva","Lozano","Saavedra",
             "Calderón","Navarro","Valdivia","Poma","Yupanqui","Ayala","Figueroa","Bustamante","Carrasco","Delgado","Huerta","Málaga","Pinto","Quiroz","Taipe"]
usados = set()
def nombre():
    while True:
        n = f"{rnd.choice(NOMBRES)} {rnd.choice(APELLIDOS)} {rnd.choice(APELLIDOS)[0]}."
        if n not in usados: usados.add(n); return n

personas = []  # (codigo, nombre, puesto, centro, rem, horas, reparto)
def per(puesto, ca, rep, n=1, horas=192, var=0.12):
    for _ in range(n):
        rem = round(REM[puesto] * rnd.uniform(1 - var, 1 + var), -1)
        hd = horas if rnd.random() > 0.15 else rnd.choice([176, 184, 200, 208]) if TIPO[puesto] == "DIRECTO" else horas
        rr = None
        if rep:
            ws = {a: max(0.02, w * rnd.uniform(0.85, 1.15)) for a, w in rep.items()}
            s = sum(ws.values()); rr = {a: w / s for a, w in ws.items()}
        personas.append((f"P{len(personas)+1:04d}", nombre(), puesto, ca, rem, hd, rr))

# Planeamiento
per(P_PLAN, "CA01", {"A01": 0.45, "A02": 0.45, "X01": 0.10}, 5); per(P_JEF, "CA01", None)
# Compras nacionales
per(P_JCOMP, "CA02", {"A03": 0.40, "A04": 0.30, "A05": 0.30}); per(P_COMP, "CA02", {"A03": 0.25, "A04": 0.45, "A05": 0.30}, 6); per(P_ACOMP, "CA02", {"A04": 0.60, "A05": 0.40}, 4)
# Importaciones
per(P_JCOMP, "CA03", {"A06": 0.55, "A07": 0.45}); per(P_COMEX, "CA03", {"A06": 0.50, "A07": 0.50}, 4); per(P_ACOMEX, "CA03", {"A06": 0.35, "A07": 0.65}, 2)
# Recepción Lima
per(P_SUP, "CA04", None); per(P_AREC, "CA04", {"A08": 0.30, "A09": 0.30, "A10": 0.40}, 6); per(P_OPE, "CA04", {"A08": 0.75, "A09": 0.25}, 18); per(P_MONT, "CA04", {"A08": 1.0}, 4)
# Almacenamiento Lima
per(P_SUP, "CA05", None); per(P_CINV, "CA05", {"A13": 0.75, "A14": 0.15, "X02": 0.10}, 5); per(P_OPE, "CA05", {"A11": 0.40, "A12": 0.40, "A14": 0.20}, 20); per(P_MONT, "CA05", {"A11": 0.60, "A12": 0.40}, 6)
# Picking Lima
per(P_SUP, "CA06", None, 2); per(P_PREP, "CA06", {"A15": 0.72, "A16": 0.18, "A17": 0.10}, 55); per(P_AWMS, "CA06", {"A16": 0.60, "A17": 0.40}, 4)
# Empaque y VA
per(P_SUP, "CA07", None); per(P_EMP, "CA07", {"A18": 0.70, "A20": 0.30}, 22); per(P_ETI, "CA07", {"A19": 0.80, "A18": 0.20}, 3)
# Regionales
for ca, b in [("CA08", 21), ("CA09", 26), ("CA10", 31)]:
    extra = {f"A{b+4}": 0.10} if ca == "CA09" else {}
    per(P_JEF, ca, None)
    per(P_OPE, ca, {f"A{b}": 0.45, f"A{b+1}": 0.55, **extra}, 4)
    per(P_PREP, ca, {f"A{b+2}": 0.75, f"A{b+3}": 0.25}, 6)
    per(P_AREC, ca, {f"A{b}": 0.30, f"A{b+3}": 0.70}, 2)
# Distribución Lima
per(P_JEF, "CA11", None); per(P_PRUT, "CA11", {"A36": 0.80, "A39": 0.10, "X03": 0.10}, 2); per(P_COND, "CA11", {"A37": 0.12, "A38": 0.80, "A39": 0.08}, 24, horas=208)
per(P_AUX, "CA11", {"A37": 0.25, "A38": 0.68, "A39": 0.07}, 24, horas=208); per(P_CDES, "CA11", {"A36": 0.35, "A37": 0.35, "A39": 0.30}, 3)
# Interprovincial
per(P_JEF, "CA12", None); per(P_PRUT, "CA12", {"A40": 1.0}, 2); per(P_CONDP, "CA12", {"A41": 0.85, "A42": 0.15}, 10, horas=208); per(P_ACOMEX, "CA12", {"A40": 0.5, "A42": 0.5}, 2)
# Logística inversa
per(P_SUP, "CA13", None); per(P_OINV, "CA13", {"A43": 0.50, "A44": 0.50}, 8); per(P_AINV, "CA13", {"A43": 0.20, "A45": 0.80}, 2)
# Calidad
per(P_JEF, "CA14", None); per(P_INSP, "CA14", {"A46": 0.50, "A47": 0.35, "X04": 0.15}, 5)
# Mantenimiento
per(P_JEF, "CA15", None); per(P_MEC, "CA15", {"A48": 0.85, "X05": 0.15}, 6); per(P_TEQ, "CA15", {"A49": 0.85, "X05": 0.15}, 3)
# Gerencia y soporte (indirectos)
per(P_GER, "CA06", None, var=0.0)
per(P_TI, "CA16", None, 8); per(P_JEF, "CA16", None)
per(P_CONT, "CA17", None, 6); per(P_ADM, "CA17", None, 5); per(P_JEF, "CA17", None)
per(P_EJC, "CA18", None, 9); per(P_ATC, "CA18", None, 6); per(P_JEF, "CA18", None)
per(P_RRHH, "CA19", None, 5); per(P_JEF, "CA19", None)

def componentes(R, bono=0.0):
    return {"remuneracion": r2(R), "essalud": r2(R * 0.09), "gratificacion": r2(R * 2 * 1.09 / 12), "cts": r2(R * (7 / 6) / 12), "vacaciones": r2(R / 12), "bonos": r2(bono), "otros": 0.0}
costos, horas = [], []
costo_ind_ca = {}
direct_cost = {}
sobre = {}
for (cod, _, i, mes, anio) in periodos:
    raise_f = 1.0 if (anio, mes) < (2025, 1) else (1.035 if (anio, mes) < (2026, 1) else 1.035 * 1.04)
    util = min(0.95, 0.80 + 0.13 * REL[cod] / max(REL.values()))
    for k, (pc, nm, puc, ca, R, hd, rep) in enumerate(personas):
        bono = 0.0
        if mes == 12 and TIPO[puc] == "DIRECTO" and ca in ("CA06", "CA07", "CA11"): bono = 250.0  # bono por campaña navideña
        if mes == 7 and TIPO[puc] == "DIRECTO" and ca in ("CA06", "CA11"): bono = 150.0  # bono de fiestas patrias
        c = componentes(R * raise_f, bono)
        h = hd
        # las vacaciones se cubren con la provisión mensual (componente «vacaciones»): las horas contractuales no cambian
        aut, just = "NO", ""
        u = util
        if rep and mes == 12 and ca in ("CA06", "CA11") and k % 9 == 0:
            u = 1.06; aut = "SI"; just = "Horas extra pagadas en campaña navideña (incluidas en bonos y remuneración del mes)"
        costos.append((pc, cod, c, h, aut, just))
        tot_c = sum(c.values())
        if rep:
            for a, sh in rep.items():
                horas.append((pc, a, cod, r2(h * u * sh)))
            direct_cost[(cod, ca)] = direct_cost.get((cod, ca), 0) + tot_c
        else:
            costo_ind_ca[(cod, ca)] = costo_ind_ca.get((cod, ca), 0) + tot_c

# =====================================================================================
# 4. MATERIALES Y SERVICIOS DIRECTOS
# =====================================================================================
materiales = [
    ("MT01", "Caja de cartón corrugado mediana", "unid", "paquete x 25", 105.00, 1, 25),
    ("MT02", "Caja de cartón corrugado grande", "unid", "paquete x 20", 128.00, 1, 20),
    ("MT03", "Stretch film", "m", "rollo x 300 m", 64.00, 1, 300),
    ("MT04", "Etiqueta térmica", "unid", "rollo x 1 000", 39.00, 1, 1000),
    ("MT05", "Cinta de embalaje", "m", "caja x 36 rollos de 100 m", 215.00, 1, 3600),
    ("MT06", "Bolsa de seguridad para comercio electrónico", "unid", "paquete x 100", 46.00, 1, 100),
    ("MT07", "Relleno de papel kraft", "m", "rollo x 450 m", 88.00, 1, 450),
    ("MT08", "Pallet de madera", "unid", "lote x 10", 360.00, 1, 10),
    ("MT09", "Esquinero de cartón", "unid", "paquete x 200", 96.00, 1, 200),
    ("MT10", "Fleje plástico", "m", "rollo x 1 500 m", 118.00, 1, 1500),
    ("MT11", "Precinto de seguridad", "unid", "bolsa x 500", 70.00, 1, 500),
    ("MT12", "Papel bond A4", "hoja", "caja x 10 paquetes de 500", 188.00, 1, 5000),
    ("MT13", "Exhibidor promocional de cartón", "unid", "paquete x 10", 145.00, 1, 10),
    ("MT14", "Bolsa para devoluciones", "unid", "paquete x 100", 38.00, 1, 100),
]
precios, consumos = [], []
for (cod, _, i, mes, anio) in periodos:
    P = {cc: MET[(cod, cc)] for (cc, *_) in clientes}
    ped = sum(x["pedidos"] for x in P.values()); lin = sum(x["lineas"] for x in P.values()); ent = sum(x["entregas"] for x in P.values())
    pedeco = sum(x["pedidos"] for x in P.values() if x["seg"] in ("ECO", "MKT")); kg = sum(x["kg"] for x in P.values()); dev = sum(x["devol"] for x in P.values())
    kits = sum(metrica(cod, cc, "kits") for (cc, *_) in clientes); kgprov = sum(metrica(cod, cc, "kg_prov") for (cc, *_) in clientes)
    for (mc, _, _, _, pf, _, _) in materiales:
        precios.append((mc, cod, r2(pf * (1.0028 ** (i - 1)) * rnd.gauss(1, 0.012))))
    pal = kg / 650
    regs = {"CA08": "NORTE", "CA09": "SUR", "CA10": "CENTRO"}
    kgreg = {r: sum(x["kg"] for x in P.values() if x["reg"] == r) for r in regs.values()}
    lista = [("A18", "MT01", (ped - pedeco) * 0.9), ("A18", "MT02", (ped - pedeco) * 0.35), ("A11", "MT03", pal * 9), ("A37", "MT03", pal * 4), ("A41", "MT03", kgprov / 650 * 8),
             ("A18", "MT04", ped * 1.6), ("A08", "MT04", pal * 1.2), ("A20", "MT04", pedeco * 1.1), ("A18", "MT05", ped * 1.1), ("A20", "MT06", pedeco * 1.02), ("A20", "MT07", pedeco * 0.8),
             ("A11", "MT08", pal * 0.03), ("A41", "MT08", kgprov / 650 * 0.08), ("A42", "MT08", sum(metrica(cod, cc, "kg_exp") for (cc, *_) in clientes) / 650),
             ("A41", "MT09", kgprov / 650 * 4), ("A41", "MT10", kgprov / 650 * 6), ("A41", "MT11", kgprov / 650 * 0.5), ("A42", "MT11", 30),
             ("A04", "MT12", ped / 35 * 3), ("A06", "MT12", ped / 400 * 25), ("A45", "MT12", dev * 2), ("A19", "MT13", kits * 0.9), ("A43", "MT14", dev * 1.05),
             ("A17", "MT01", sum(x["error"] for x in P.values()) * 0.5), ("A44", "MT01", dev * 0.25)]
    for ca, rg in regs.items():
        b = {"CA08": 21, "CA09": 26, "CA10": 31}[ca]
        lista += [(f"A{b+1}", "MT03", kgreg[rg] / 650 * 6), (f"A{b+3}", "MT04", sum(x["pedidos"] for x in P.values() if x["reg"] == rg) * 1.5),
                  (f"A{b+3}", "MT05", sum(x["pedidos"] for x in P.values() if x["reg"] == rg) * 0.9)]
    for (a, mc, q) in lista:
        consumos.append((a, mc, cod, r2(max(0.0, q) * rnd.gauss(1, 0.03))))

servicios = []
for (cod, _, i, mes, anio) in periodos:
    P = {cc: MET[(cod, cc)] for (cc, *_) in clientes}
    eco = sum(x["entregas"] for x in P.values() if x["seg"] in ("ECO", "MKT"))
    servicios.append(("A38", cod, "Courier Rápido Lima S.A.C. (ficticio)", "Courier de última milla para comercio electrónico", r2(eco * 0.55), "envío", r2(7.80 * (1.003 ** (i - 1))), f"F001-{3000+i}"))
    servicios.append(("A38", cod, "Envíos Express Metropolitano E.I.R.L. (ficticio)", "Courier de última milla en horario extendido", r2(eco * 0.12), "envío", r2(9.40 * (1.003 ** (i - 1))), f"F004-{1200+i}"))
    servicios.append(("A08", cod, "Estibas Callao E.I.R.L. (ficticio)", "Estiba tercerizada en recepción", r2(tot[cod] / 22), "hora", 18.50, f"F002-{2000+i}"))
    kgp = sum(metrica(cod, cc, "kg_prov") for (cc, *_) in clientes)
    servicios.append(("A41", cod, "Transportes Panamericana S.A. (ficticio)", "Flete tercerizado interprovincial", r2(kgp * 0.35 / 1000), "tonelada", r2(185.0 * (1.002 ** (i - 1))), f"F010-{500+i}"))
    servicios.append(("A07", cod, "Agencia de Aduanas Frontera Sur S.A.C. (ficticio)", "Honorarios de agenciamiento aduanero", r2(sum(metrica(cod, cc, "compra_imp") for (cc, *_) in clientes) / 380), "declaración", 420.00, f"F020-{80+i}"))
    servicios.append(("A44", cod, "Lavandería Industrial Andina (ficticio)", "Limpieza y reacondicionamiento de productos devueltos", r2(sum(x["devol"] for x in P.values()) * 0.3), "unidad", 2.40, f"F030-{40+i}"))

# =====================================================================================
# 5. ELEMENTOS DE COSTO INDIRECTO Y REGLAS
# =====================================================================================
ecs = [("EC01","Personal indirecto","personal"),("EC02","Alquiler del centro de distribución Lima","fijo"),("EC03","Alquiler de almacenes regionales","fijo"),
       ("EC04","Energía eléctrica","variable"),("EC05","Agua y saneamiento","variable"),("EC06","Combustible de la flota","variable"),("EC07","Peajes","variable"),
       ("EC08","Mantenimiento de flota (repuestos)","semivariable"),("EC09","Repuestos de montacargas y equipos","semivariable"),("EC10","Depreciación de montacargas y racks","fijo"),
       ("EC11","Depreciación de la flota","fijo"),("EC12","Depreciación de equipos de cómputo","fijo"),("EC13","Licencias WMS, TMS y ERP","fijo"),("EC14","Internet y telefonía","fijo"),
       ("EC15","Seguros patrimoniales y de carga","fijo"),("EC16","Seguridad y vigilancia","fijo"),("EC17","Limpieza y fumigación","fijo"),("EC18","Equipos de protección personal","variable")]
m2 = {"CA01":120,"CA02":160,"CA03":110,"CA04":2400,"CA05":9800,"CA06":5200,"CA07":1900,"CA08":3200,"CA09":3600,"CA10":2100,"CA11":900,"CA12":450,"CA13":1100,
      "CA14":260,"CA15":700,"CA16":180,"CA17":300,"CA18":420,"CA19":140}
LIMA_CD = ["CA01","CA02","CA03","CA04","CA05","CA06","CA07","CA11","CA12","CA13","CA14","CA15","CA16","CA17","CA18","CA19"]
kwh0 = {"CA01":1400,"CA02":1700,"CA03":1200,"CA04":9800,"CA05":21000,"CA06":17500,"CA07":8200,"CA08":7400,"CA09":8100,"CA10":5200,"CA11":3100,"CA12":1600,"CA13":3900,
        "CA14":1300,"CA15":5600,"CA16":6800,"CA17":2100,"CA18":2600,"CA19":900}
headcount = {}
for (pc, nm, puc, ca, *_r) in personas: headcount[ca] = headcount.get(ca, 0) + 1
vehic = {"CA11": 26, "CA12": 9, "CA08": 2, "CA09": 2, "CA10": 1}
km0 = {"CA11": 96000, "CA12": 118000, "CA08": 6200, "CA09": 7100, "CA10": 3900}
equipos = {"CA04": 6, "CA05": 14, "CA06": 8, "CA07": 2, "CA08": 4, "CA09": 4, "CA10": 3, "CA13": 2}
pcs = {ca: max(2, round(headcount.get(ca, 2) * (0.9 if ca in ("CA16","CA17","CA18","CA19","CA01","CA02","CA03") else 0.18))) for ca in m2}
usuarios = {ca: max(1, round(pcs[ca] * (1.4 if ca in ("CA04","CA05","CA06","CA07","CA08","CA09","CA10","CA11","CA12","CA13") else 0.7))) for ca in m2}
anex = {ca: max(1, round(pcs[ca] * 0.5)) for ca in m2}
valor_act = {"CA01":90000,"CA02":120000,"CA03":95000,"CA04":1150000,"CA05":4800000,"CA06":1900000,"CA07":620000,"CA08":1300000,"CA09":1450000,"CA10":820000,
             "CA11":3900000,"CA12":2800000,"CA13":380000,"CA14":140000,"CA15":560000,"CA16":610000,"CA17":210000,"CA18":240000,"CA19":90000}

reglas, bases, montos = [], [], []
def regla(cod, nivel, origen, centro, ind, uni, tipo, base_desde=""):
    reglas.append((cod, nivel, origen, centro, ind, uni, tipo, base_desde))
# nivel EC_CA: (inductor, unidad, tipo, función base por centro y período)
EC_CA = {
 "EC01": ("Costo del personal indirecto del centro", "S/", "importe", None),
 "EC02": ("Área ocupada en el centro de distribución Lima", "m²", "cantidad", lambda ca, p: m2[ca] if ca in LIMA_CD else 0),
 "EC03": ("Área ocupada en almacenes regionales", "m²", "cantidad", lambda ca, p: m2[ca] if ca in ("CA08","CA09","CA10") else 0),
 "EC04": ("Consumo de energía (submedidores)", "kWh", "cantidad", None),
 "EC05": ("Personas por centro", "persona", "cantidad", lambda ca, p: headcount.get(ca, 0)),
 "EC06": ("Kilómetros recorridos", "km", "cantidad", None),
 "EC07": ("Kilómetros recorridos en vías con peaje", "km", "cantidad", None),
 "EC08": ("Vehículos asignados", "vehículo", "cantidad", lambda ca, p: vehic.get(ca, 0)),
 "EC09": ("Equipos de manipulación asignados", "equipo", "cantidad", lambda ca, p: equipos.get(ca, 0)),
 "EC10": ("Equipos de manipulación asignados", "equipo", "cantidad", lambda ca, p: equipos.get(ca, 0)),
 "EC11": ("Vehículos asignados", "vehículo", "cantidad", lambda ca, p: vehic.get(ca, 0)),
 "EC12": ("Computadoras asignadas", "PC", "cantidad", lambda ca, p: pcs[ca]),
 "EC13": ("Usuarios de sistemas", "usuario", "cantidad", lambda ca, p: usuarios[ca]),
 "EC14": ("Anexos y líneas móviles", "línea", "cantidad", lambda ca, p: anex[ca]),
 "EC15": ("Valor de activos asegurados", "S/", "cantidad", lambda ca, p: valor_act[ca]),
 "EC16": ("Área vigilada", "m²", "cantidad", lambda ca, p: m2[ca]),
 "EC17": ("Área atendida", "m²", "cantidad", lambda ca, p: m2[ca]),
 "EC18": ("Personal operativo con EPP", "persona", "cantidad", lambda ca, p: headcount.get(ca, 0) if ca in ("CA04","CA05","CA06","CA07","CA08","CA09","CA10","CA11","CA12","CA13","CA15") else 0),
}
for ec, (ind, uni, tipo, _) in EC_CA.items():
    regla(f"R-{ec}-CA", "EC_CA", ec, "", ind, uni, tipo, "PERSONAL_INDIRECTO" if ec == "EC01" else "")

# reglas CA → AC: por (EC, centro participante) con base > 0
# pesos de dedicación de recursos por actividad (estáticos con ruido mensual leve)
def peso_act(ec, a):
    cl = ACT[a][4]; nm = ACT[a][1].lower()
    w = 1.0
    if ec in ("EC02", "EC03", "EC16", "EC17"): w = 3.0 if any(k in nm for k in ("almacen", "ubicar", "preparar", "picking")) else 1.2 if "recib" in nm else 0.6
    if ec in ("EC09", "EC10"): w = 3.0 if any(k in nm for k in ("ubicar", "recib", "almacen", "reabastec", "cargar")) else 0.4
    if ec in ("EC06", "EC07", "EC08", "EC11"): w = 4.0 if any(k in nm for k in ("repartir", "transport", "despach", "flota")) else 0.6 if "reprogram" in nm else 0.3
    if ec == "EC04": w = 2.0 if any(k in nm for k in ("preparar", "empac", "almacen", "ubicar")) else 1.0
    if a.startswith("X"): w *= 0.6
    return w
CA_AC_TIPO = {"EC01": ("% de dedicación del personal indirecto", "%", "porcentaje")}
ca_ac = {}  # (ec, ca) -> pesos
for ec in EC_CA:
    for ca in PART:
        acts = acts_ca.get(ca, [])
        if not acts: continue
        ca_ac[(ec, ca)] = {a: peso_act(ec, a) for a in acts}
        ind, uni, tipo = CA_AC_TIPO[ec] if ec in CA_AC_TIPO else (({"EC02": "Área ocupada por la actividad", "EC03": "Área ocupada por la actividad", "EC04": "Horas de equipos encendidos",
                                              "EC05": "Personas que realizan la actividad", "EC06": "Kilómetros por actividad", "EC07": "Kilómetros con peaje por actividad",
                                              "EC08": "Horas de uso de vehículos", "EC09": "Horas-máquina", "EC10": "Horas-máquina", "EC11": "Horas de uso de vehículos",
                                              "EC12": "Computadoras por actividad", "EC13": "Transacciones en sistemas", "EC14": "Líneas por actividad",
                                              "EC15": "Valor asegurado usado por la actividad", "EC16": "Área vigilada por actividad", "EC17": "Área atendida por actividad",
                                              "EC18": "Personal con EPP por actividad"}[ec], {"EC02": "m²", "EC03": "m²", "EC04": "h-equipo", "EC05": "persona", "EC06": "km", "EC07": "km",
                                              "EC08": "h-vehículo", "EC09": "h-máquina", "EC10": "h-máquina", "EC11": "h-vehículo", "EC12": "PC", "EC13": "transacción", "EC14": "línea",
                                              "EC15": "S/", "EC16": "m²", "EC17": "m²", "EC18": "persona"}[ec], "cantidad"))
        regla(f"R-{ec}-{ca}", "CA_AC", ec, ca, ind, uni, tipo)

for (cod, _, i, mes, anio) in periodos:
    rel = REL[cod]
    raise_y = 1.0 if (anio, mes) < (2025, 1) else (1.04 if (anio, mes) < (2026, 1) else 1.04 * 1.05)
    kwh = {ca: b * (0.78 + 0.22 * rel) * rnd.gauss(1, 0.03) for ca, b in kwh0.items()}
    km = {ca: b * rel * rnd.gauss(1, 0.04) for ca, b in km0.items()}
    kmpe = {ca: km[ca] * (0.08 if ca == "CA11" else 0.65 if ca == "CA12" else 0.15) for ca in km}
    diesel = 16.1 * (1 + 0.05 * math.sin(i / 3)) * rnd.gauss(1, 0.015)
    ec01 = r2(sum(costo_ind_ca.get((cod, ca), 0) for ca in m2))
    montos += [("EC01", cod, ec01), ("EC02", cod, r2(168000 * raise_y)), ("EC03", cod, r2(61500 * raise_y)), ("EC04", cod, r2(sum(kwh.values()) * 0.64)),
               ("EC05", cod, r2(6200 * (0.9 + 0.1 * rel))), ("EC06", cod, r2(sum(km.values()) / 7.8 * diesel)), ("EC07", cod, r2(sum(kmpe.values()) * 0.21)),
               ("EC08", cod, r2(21000 + 0.085 * sum(km.values()))), ("EC09", cod, r2(9800 * (0.85 + 0.15 * rel))), ("EC10", cod, 38500.00), ("EC11", cod, 52800.00),
               ("EC12", cod, 9400.00), ("EC13", cod, r2(31500 * raise_y)), ("EC14", cod, r2(11800 * raise_y)), ("EC15", cod, r2(24600 * raise_y)),
               ("EC16", cod, r2(46200 * raise_y)), ("EC17", cod, r2(19800 * raise_y)), ("EC18", cod, r2(28.0 * sum(headcount.get(ca, 0) for ca in m2)))]
    for ec, (ind, uni, tipo, fn) in EC_CA.items():
        if ec == "EC01": continue
        for ca in m2:
            if ec == "EC04": v = r2(kwh[ca]); met = "Lectura de submedidores"
            elif ec == "EC06": v = r2(km.get(ca, 0)); met = "TMS: kilómetros por unidad"
            elif ec == "EC07": v = r2(kmpe.get(ca, 0)); met = "TMS: rutas con peaje"
            else: v = fn(ca, cod); met = {"EC02": "Plano del centro de distribución", "EC03": "Contratos de alquiler regionales", "EC05": "Planilla del mes",
                                          "EC08": "Registro de flota", "EC09": "Registro de activos", "EC10": "Registro de activos", "EC11": "Registro de flota",
                                          "EC12": "Inventario TI", "EC13": "Licencias asignadas", "EC14": "Central telefónica", "EC15": "Póliza de seguros",
                                          "EC16": "Contrato de vigilancia", "EC17": "Contrato de limpieza", "EC18": "Planilla operativa"}[ec]
            bases.append((f"R-{ec}-CA", ca, cod, v, "REAL", met))
    # CA → AC
    for (ec, ca), pesos in ca_ac.items():
        acts = list(pesos)
        if ec == "EC01":
            raw = {a: pesos[a] * rnd.uniform(0.9, 1.1) for a in acts}
            s = sum(raw.values()); bp = {a: int(raw[a] / s * 10000) for a in acts}
            bp[acts[0]] += 10000 - sum(bp.values())
            for a in acts: bases.append((f"R-{ec}-{ca}", a, cod, bp[a] / 10000, "REAL", "Encuesta de dedicación del personal indirecto"))
        else:
            for a in acts:
                v = pesos[a] * 10 * (rnd.uniform(0.95, 1.05) if ec in ("EC04", "EC06", "EC07", "EC08", "EC09", "EC13") else 1.0)
                if ec in ("EC05", "EC18"):
                    v = sum(1 for p in personas if p[3] == ca and p[6] and a in p[6]) or 0.5
                bases.append((f"R-{ec}-{ca}", a, cod, r2(v), "REAL", "Estudio de dedicación / registro operativo"))

# AC → OC (clientes)
objetos = [(c[0], c[1], "# pedidos", "OBJETO") for c in clientes]
for a in A:
    if a[3] == "EXCLUIDA": continue
    met = a[5]
    tipo = "plano" if met == "plano" else "cantidad"
    regla(f"R-{a[0]}-OC", "AC_OC", a[0], "", a[6], a[7], tipo)
magn = []
for (cod, _, i, mes, anio) in periodos:
    for (cc, *_) in clientes: magn.append((cc, cod, MET[(cod, cc)]["pedidos"]))
    for a in A:
        if a[3] == "EXCLUIDA": continue
        met = a[5]
        for (cc, nm, seg, reg, f) in clientes:
            if met == "plano":
                bases.append((f"R-{a[0]}-OC", cc, cod, 1, "ESTIMADO", "Reparto plano justificado: el seguimiento no se registra por cliente (menor precisión)"))
                continue
            v = metrica(cod, cc, met)
            est, mt = "REAL", {"pedidos": "ERP: pedidos facturados", "lineas": "WMS: líneas", "error": "Registro de no conformidades", "devol": "Registro de devoluciones",
                               "kits": "Órdenes de valor agregado", "fallidas": "TMS: entregas reprogramadas"}.get(met.split("_")[0], "WMS/TMS: registro operativo")
            if met.startswith("compra"): mt = "ERP: compras asociadas a la demanda del cliente (S/ miles)"
            if met == "error" and seg == "COR" and mes in (5, 6): est, mt = "ESTIMADO", "Promedio histórico de 3 meses (registro no disponible)"
            bases.append((f"R-{a[0]}-OC", cc, cod, r2(v), est, mt))

# =====================================================================================
# 6. PRESUPUESTO, FINANZAS, EVA Y ESCENARIOS
# =====================================================================================
import os
PPTO_FIJO = float(os.environ.get("PPTO_FIJO", "1462000"))
presup, finanzas = [], []
for (cod, _, i, mes, anio) in periodos:
    # volumen planificado: tendencia del primer mes desestacionalizada × estacionalidad del mes (sin doble estacionalidad)
    plan = tot0 / ESTAC[periodos[0][3]] * (1.0062 ** (i - 1)) * ESTAC[mes]
    presup.append((cod, "Volumen de pedidos presupuestado", round(plan), "pedidos"))
    idx = 1.0 if anio == 2024 else 1.03 if anio == 2025 else 1.065
    presup.append((cod, "Costo logístico total presupuestado", r2((PPTO_FIJO + 33.0 * plan) * idx), "S/"))  # presupuesto flexible: fijo + variable por pedido
    ventas = sum(MET[(cod, cc)]["ventas"] for (cc, *_) in clientes)
    finanzas.append((cod, r2(ventas), r2(ventas * 0.69), r2(ventas * 0.105), 0.295))
eva_param = [("capital_invertido", 168000000, "S/", "Capital invertido operativo (sintético)"), ("ke", 0.138, "tasa anual", "Costo del patrimonio"),
             ("kd", 0.088, "tasa anual", "Costo de la deuda antes de impuestos"), ("deuda", 70000000, "S/", "Deuda financiera"),
             ("patrimonio", 98000000, "S/", "Patrimonio"), ("tasa_impuesto", 0.295, "tasa", "Impuesto a la renta (parámetro editable)")]
escenarios = [("Base","volumen_pedidos","triangular",0.94,1.00,1.07),("Base","tarifa_courier","triangular",0.98,1.00,1.06),
              ("Base","precio_combustible","triangular",0.90,1.00,1.14),("Base","remuneraciones","triangular",1.00,1.00,1.05),
              ("Base","precio_materiales","triangular",0.97,1.00,1.06),
              ("Optimista","volumen_pedidos","triangular",1.00,1.06,1.14),("Optimista","precio_combustible","triangular",0.88,0.95,1.02),
              ("Pesimista","volumen_pedidos","triangular",0.82,0.92,1.00),("Pesimista","precio_combustible","triangular",1.00,1.10,1.25),
              ("Pesimista","tarifa_courier","triangular",1.00,1.05,1.12)]

# =====================================================================================
# 7. ESCRITURA
# =====================================================================================
wb = Workbook()
HDR = PatternFill("solid", fgColor="6554C8"); HF = Font(bold=True, color="FFFFFF")
def hoja(nombre, cols, filas, anchos=None):
    ws = wb.create_sheet(nombre); ws.append(cols)
    for c in ws[1]: c.fill = HDR; c.font = HF; c.alignment = Alignment(wrap_text=True, vertical="center")
    for f in filas: ws.append(list(f))
    ws.freeze_panes = "A2"; ws.auto_filter.ref = ws.dimensions
    for j, c in enumerate(cols, 1): ws.column_dimensions[get_column_letter(j)].width = (anchos or {}).get(c, max(12, min(42, len(c) + 4)))
    return ws
ins = wb.active; ins.title = "Instrucciones"
n_dir = sum(1 for p in personas if TIPO[p[2]] == "DIRECTO")
lines = ["Datos de carga — Sistema Informático Dinámico Inteligente Estocástico Predictivo de Costeo de la Cadena de Suministro Integral",
         f"DATOS SINTÉTICOS: empresa ficticia «{EMPRESA.split(' — ')[0]}». Todas las personas, clientes y proveedores son ficticios; no representan entidades reales.",
         f"Escala: {len(personas)} personas ({n_dir} directas y {len(personas) - n_dir} indirectas), {len(centros)} centros de actividad, {len(A)} actividades, {len(clientes)} clientes (objetos de costo), {len(materiales)} materiales, {len(ecs)} elementos de costo indirecto y 24 meses ({periodos[0][1]} a {periodos[-1][1]}).",
         "Operación: centro de distribución en Lima, tres almacenes regionales (Trujillo, Arequipa y Huancayo), flota propia de reparto, transporte interprovincial, comercio electrónico, marketplaces y exportación.",
         f"Generado con semilla fija {SEED}; reproducible con el generador gen_empresa_grande.py.",
         "Cómo usarlo: pestaña 4 «Modelo de Costeo» → «Gestión de modelos» → botón «Importar Excel de datos (formato normalizado)». La importación es atómica: si hay un error, no se guarda nada y se informa hoja y fila.",
         "Después: pestaña 10 «Resultados» → «Ejecutar costeo de todos los períodos».",
         "Cada hoja tiene encabezados en la fila 1; el sistema las lee por nombre de hoja y de columna (no por posición). Ver hoja «Diccionario».",
         "Los resultados de costeo no están en este archivo: los calcula el motor del sistema."]
for l in lines: ins.append([l])
ins["A1"].font = Font(bold=True, size=13); ins["A2"].font = Font(bold=True, color="B45309"); ins.column_dimensions["A"].width = 170
hoja("Empresa", ["clave","valor"], [("nombre", EMPRESA),("moneda","PEN"),("igv",0.18),("sintetico","SI"),("codigo_modelo","DEMO"),("nombre_modelo","Demostración: empresa de gran escala, 24 meses (datos sintéticos)")], {"valor":70})
hoja("Periodos", ["codigo","nombre","orden"], [(p[0], p[1], p[2]) for p in periodos])
hoja("Centros", ["codigo","nombre","participacion","pct_participacion","nota"], [c[:5] for c in centros], {"nota":90,"nombre":50})
hoja("Actividades", ["codigo","nombre","centro","alcance","pct_alcance","clase","orden","nota"],
     [(a[0], a[1], a[2], a[3], None, a[4], k + 1, "Otra actividad del centro, fuera de la cadena" if a[3] == "EXCLUIDA" else "") for k, a in enumerate(A)], {"nombre":52,"nota":46})
hoja("Puestos", ["codigo","nombre","tipo"], [p[:3] for p in puestos], {"nombre":36})
hoja("Personas", ["codigo","nombre","puesto","centro"], [(p[0], p[1], p[2], p[3]) for p in personas], {"nombre":30})
hoja("CostoPersona", ["persona","periodo","remuneracion","essalud","gratificacion","cts","vacaciones","bonos","otros","horas_disponibles","sobreimputacion_autorizada","justificacion"],
     [(pc, cod, c["remuneracion"], c["essalud"], c["gratificacion"], c["cts"], c["vacaciones"], c["bonos"], c["otros"], h, aut, just) for (pc, cod, c, h, aut, just) in costos])
hoja("Horas", ["persona","actividad","periodo","horas"], horas)
hoja("Materiales", ["codigo","nombre","unidad_consumo","unidad_factura","costo_factura","cantidad_factura","equivalencia","incluye_igv","igv_recuperable","validado"],
     [(m[0], m[1], m[2], m[3], m[4], m[5], m[6], "SI", "SI", "SI") for m in materiales], {"nombre":44,"unidad_factura":28})
hoja("PreciosMaterial", ["material","periodo","costo_factura"], precios)
hoja("ConsumoMaterial", ["actividad","material","periodo","cantidad"], consumos)
hoja("ServiciosDirectos", ["actividad","periodo","proveedor","servicio","cantidad","unidad","tarifa","documento"], servicios, {"proveedor":46,"servicio":50})
hoja("ElementosCosto", ["codigo","nombre","tipo"], ecs, {"nombre":44})
hoja("MontosEC", ["ec","periodo","monto"], montos)
hoja("ObjetosCosto", ["codigo","nombre","magnitud","clase"], objetos, {"nombre":52})
hoja("MagnitudObjeto", ["objeto","periodo","cantidad"], magn)
hoja("Reglas", ["codigo","nivel","origen","centro","inductor","unidad","tipo_base","base_desde"], reglas, {"inductor":50})
hoja("Bases", ["regla","destino","periodo","valor","estado","metodo"], bases, {"metodo":60})
hoja("Presupuesto", ["periodo","concepto","monto","unidad"], presup, {"concepto":40})
hoja("FinanzasEVA", ["periodo","ventas","costo_ventas_sin_logistica","otros_gastos_operativos","tasa_impuesto"], finanzas)
hoja("ParametrosEVA", ["clave","valor","unidad","descripcion"], eva_param, {"descripcion":46})
hoja("Escenarios", ["escenario","variable","distribucion","minimo","moda","maximo"], escenarios)
hoja("Clientes", ["codigo","nombre","segmento","region","pedidos_promedio_mes","ventas_promedio_mes"],
     [(c[0], c[1], SEG_NOM[c[2]], c[3].title(), round(sum(MET[(p[0], c[0])]["pedidos"] for p in periodos) / 24), r2(sum(MET[(p[0], c[0])]["ventas"] for p in periodos) / 24)) for c in clientes],
     {"nombre":52,"segmento":30})
dic = [("Empresa","clave/valor","Parámetros de la empresa: nombre, moneda, igv (fracción), sintetico SI/NO","—","Sí"),
       ("Periodos","codigo","Período mensual AAAA-MM","texto","Sí"),("Centros","participacion","PARTICIPA / NO_PARTICIPA / PARCIAL","texto","Sí"),
       ("Centros","pct_participacion","Fracción 0–1 que continúa a la cadena si es PARCIAL","fracción","Si PARCIAL"),
       ("Actividades","alcance","INCLUIDA / EXCLUIDA (otra actividad) / PARCIAL","texto","Sí"),("Actividades","clase","AV / NAVN / NAVI","texto","No"),
       ("Puestos","tipo","DIRECTO (personal directo, P3) o INDIRECTO (va a P4a por persona)","texto","Sí"),
       ("CostoPersona","remuneracion…otros","Componentes del costo empresa mensual","S/","Sí"),("CostoPersona","horas_disponibles","Horas contractuales del mes","h","Sí"),
       ("CostoPersona","sobreimputacion_autorizada","SI cuando las horas imputadas superan las disponibles con autorización justificada","texto","No"),
       ("Horas","horas","Horas imputadas por persona a la actividad en el período","h","Sí"),
       ("Materiales","costo_factura","Precio de la unidad de factura (con IGV si incluye_igv=SI)","S/","Sí"),("Materiales","equivalencia","Unidades de consumo por unidad de factura","unid","Sí"),
       ("ConsumoMaterial","cantidad","Cantidad consumida por la actividad (unidad de consumo)","unid","Sí"),
       ("ServiciosDirectos","tarifa","Tarifa del servicio directo atribuible a la actividad","S/","Sí"),
       ("MontosEC","monto","Costo indirecto del período por elemento","S/","Sí"),
       ("Reglas","nivel","EC_CA (4a), CA_AC (4b), AC_OC (4c)","texto","Sí"),("Reglas","tipo_base","cantidad / porcentaje / importe / directo / plano","texto","Sí"),
       ("Reglas","base_desde","PERSONAL_INDIRECTO: la base se calcula con el costo de las personas indirectas del centro","texto","No"),
       ("Bases","estado","REAL / ESTIMADO / AJUSTADO / PENDIENTE","texto","Sí"),("Bases","metodo","Fuente o método de estimación del valor","texto","Sí"),
       ("ObjetosCosto / MagnitudObjeto","—","Clientes y carteras como objetos de costo; magnitud = pedidos del mes","pedidos","Sí"),
       ("Presupuesto","monto","Presupuesto flexible: costo fijo + costo variable por pedido planificado","S/ o unid","No"),
       ("FinanzasEVA / ParametrosEVA","—","Datos sintéticos para NOPAT, WACC y EVA","S/ / tasa","No"),
       ("Escenarios","minimo/moda/maximo","Factores multiplicativos para Monte Carlo","factor","No"),
       ("Clientes","—","Hoja informativa con segmento y región de cada cliente (no se importa)","—","No")]
hoja("Diccionario", ["hoja","columna","descripcion","unidad","obligatorio"], dic, {"descripcion":90})
wb.save(OUT)
print("ok", OUT, "| personas", len(personas), "directas", n_dir, "| centros", len(centros), "| actividades", len(A), "| clientes", len(clientes),
      "| CostoPersona", len(costos), "| Horas", len(horas), "| Bases", len(bases), "| Reglas", len(reglas), "| pedidos/mes", tot[periodos[0][0]], "→", tot[periodos[-1][0]])
