# Generador reproducible del entregable 05_Datos_Entrada.xlsx (DATOS SINTÉTICOS, D-12).
# Semilla fija; 24 meses (nov-2024 a oct-2026). Los resultados de costeo NO se escriben aquí:
# los calcula exclusivamente el motor del sistema (D-12 punto 7).
import random, math, sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

SEED = 20261104
rnd = random.Random(SEED)
OUT = sys.argv[1] if len(sys.argv) > 1 else "05_Datos_Entrada.xlsx"

MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"]
periodos = []
y, m = 2024, 11
for i in range(24):
    periodos.append((f"{y}-{m:02d}", f"{MESES[m-1]} {y}", i + 1, m, y))
    m += 1
    if m == 13: m, y = 1, y + 1

ESTAC = {1:0.90, 2:0.88, 3:0.95, 4:0.97, 5:1.00, 6:1.02, 7:1.08, 8:1.00, 9:0.98, 10:1.03, 11:1.10, 12:1.26}
def r2(x): return round(x + 1e-12, 2)

# ---------------- volumen (impulsor maestro) ----------------
vol = {}
for (cod, _, i, mes, anio) in periodos:
    base = 2400 * (1.006 ** (i - 1)) * ESTAC[mes] * rnd.gauss(1, 0.025)
    sh_ecom = 0.22 + 0.006 * (i - 1)
    sh_may, sh_corp = 0.33, 0.07
    sh_min = 1 - sh_ecom - sh_may - sh_corp
    vol[cod] = {"total": base, "OC01": base * sh_may, "OC02": base * sh_min, "OC03": base * sh_ecom, "OC04": base * sh_corp}
vmax = max(v["total"] for v in vol.values())

centros = [
    ("CA01","Compras y abastecimiento","PARTICIPA",None,""),
    ("CA02","Recepción y almacén","PARTICIPA",None,""),
    ("CA03","Preparación de pedidos","PARTICIPA",None,""),
    ("CA04","Distribución y transporte","PARTICIPA",None,""),
    ("CA05","Calidad","PARCIAL",0.40,"Supuesto sintético: 40 % de su capacidad atiende la cadena (inspecciones); el resto es gestión de normas (D-07)"),
    ("CA06","Administración y finanzas","NO_PARTICIPA",None,"Centro de soporte fuera de la cadena (D-07)"),
    ("CA07","Ventas y marketing","NO_PARTICIPA",None,"Centro de soporte fuera de la cadena (D-07)"),
]
actividades = [
    ("A01","Planificar requerimientos de compra","CA01","INCLUIDA","AV"),
    ("A02","Cotizar y evaluar proveedores","CA01","INCLUIDA","AV"),
    ("A03","Emitir órdenes de compra","CA01","INCLUIDA","AV"),
    ("A04","Hacer seguimiento a proveedores","CA01","INCLUIDA","NAVN"),
    ("X02","Atender auditorías internas","CA01","EXCLUIDA",None),
    ("A05","Recibir y descargar mercadería","CA02","INCLUIDA","AV"),
    ("A06","Inspeccionar la recepción","CA02","INCLUIDA","NAVN"),
    ("A07","Ubicar y almacenar","CA02","INCLUIDA","AV"),
    ("A08","Controlar inventario (conteo cíclico)","CA02","INCLUIDA","NAVN"),
    ("X01","Capacitar al personal de almacén","CA02","EXCLUIDA",None),
    ("A09","Preparar pedidos (picking)","CA03","INCLUIDA","AV"),
    ("A10","Empacar y etiquetar","CA03","INCLUIDA","AV"),
    ("A11","Reprocesar pedidos con error","CA03","INCLUIDA","NAVI"),
    ("A12","Planificar rutas de reparto","CA04","INCLUIDA","AV"),
    ("A13","Despachar y transportar","CA04","INCLUIDA","AV"),
    ("A14","Gestionar devoluciones","CA04","INCLUIDA","NAVI"),
    ("X03","Elaborar reportes gerenciales de distribución","CA04","EXCLUIDA",None),
    ("A15","Inspeccionar calidad de lotes","CA05","INCLUIDA","NAVN"),
    ("X04","Gestionar certificaciones y normas","CA05","EXCLUIDA",None),
]
puestos = [
    ("PU01","Jefe de compras","DIRECTO"),("PU02","Analista de compras","DIRECTO"),("PU03","Asistente de almacén","DIRECTO"),
    ("PU04","Operario de almacén","DIRECTO"),("PU05","Preparador de pedidos","DIRECTO"),("PU06","Conductor repartidor","DIRECTO"),
    ("PU07","Planificador de rutas","DIRECTO"),("PU08","Inspector de calidad","DIRECTO"),
    ("PU09","Supervisor de almacén","INDIRECTO"),("PU10","Jefe de distribución","INDIRECTO"),("PU11","Jefe de calidad","INDIRECTO"),
    ("PU12","Asistente administrativo","INDIRECTO"),("PU13","Ejecutivo comercial","INDIRECTO"),("PU14","Coordinador de abastecimiento","INDIRECTO"),
    ("PU15","Coordinador de despacho","INDIRECTO"),
]
NOMBRES = ["Ana Rojas","Bruno Salas","Carla Quispe","Diego Huamán","Elena Castro","Fabio Ramos","Gina Torres","Hugo Paredes","Irene Vargas",
           "Jorge Medina","Karen Flores","Luis Cárdenas","Marta Ríos","Néstor Gil","Olga Soto","Pablo Chávez","Rosa León","Saúl Ortiz",
           "Tania Mejía","Ulises Vega","Vilma Arce","Walter Ponce","Ximena Luna","Yuri Campos","Zoila Tapia"]
# código, puesto, centro, remuneración base, horas disponibles, reparto de su tiempo
personas = [
    ("P001","PU01","CA01",6200,192,{"A01":0.35,"A02":0.20,"A03":0.15,"A04":0.20,"X02":0.10}),
    ("P002","PU02","CA01",2900,160,{"A02":0.45,"A03":0.40,"A04":0.15}),
    ("P003","PU02","CA01",3470,168,{"A01":0.30,"A02":0.30,"A03":0.25,"A04":0.15}),
    ("P004","PU03","CA02",2300,192,{"A05":0.30,"A06":0.25,"A08":0.35,"X01":0.10}),
    ("P005","PU03","CA02",2450,192,{"A05":0.30,"A06":0.25,"A08":0.35,"X01":0.10}),
    ("P006","PU04","CA02",1650,192,{"A05":0.40,"A07":0.45,"A08":0.15}),
    ("P007","PU04","CA02",1720,192,{"A05":0.40,"A07":0.45,"A08":0.15}),
    ("P008","PU04","CA02",1800,176,{"A05":0.40,"A07":0.45,"A08":0.15}),
    ("P009","PU05","CA03",1700,192,{"A09":0.55,"A10":0.35,"A11":0.10}),
    ("P010","PU05","CA03",1750,192,{"A09":0.55,"A10":0.35,"A11":0.10}),
    ("P011","PU05","CA03",1820,184,{"A09":0.55,"A10":0.35,"A11":0.10}),
    ("P012","PU06","CA04",2200,208,{"A13":0.85,"A14":0.15}),
    ("P013","PU06","CA04",2300,208,{"A13":0.85,"A14":0.15}),
    ("P014","PU06","CA04",2350,200,{"A13":0.85,"A14":0.15}),
    ("P015","PU07","CA04",3300,192,{"A12":0.70,"A14":0.20,"X03":0.10}),
    ("P016","PU08","CA05",3100,192,{"A15":0.75,"A06":0.15,"X04":0.10}),
    ("P101","PU09","CA02",4800,192,None),("P102","PU10","CA04",6000,192,None),("P103","PU11","CA05",5200,192,None),
    ("P104","PU12","CA06",2500,192,None),("P105","PU12","CA06",2600,192,None),("P106","PU13","CA07",3200,192,None),
    ("P107","PU13","CA07",3400,192,None),("P108","PU14","CA01",3900,192,None),("P109","PU15","CA03",3600,192,None),
]
puesto_nom = {p[0]: p[1] for p in puestos}

def componentes(R):
    return {"remuneracion": r2(R), "essalud": r2(R*0.09), "gratificacion": r2(R*2*1.09/12), "cts": r2(R*(7/6)/12), "vacaciones": r2(R/12), "bonos": 0.0, "otros": 0.0}

costos, horas = [], []
costo_ind_ca = {}  # (periodo, centro) -> suma costo empresa personal indirecto
for (cod, _, i, mes, anio) in periodos:
    raise_f = 1.0 if (anio, mes) < (2025, 1) else (1.035 if (anio, mes) < (2026, 1) else 1.035 * 1.04)
    util = min(0.96, 0.78 + 0.16 * vol[cod]["total"] / vmax)
    for (pc, pu, ca, R, hd, rep) in personas:
        c = componentes(R * raise_f)
        if pc in ("P007",) and mes == 2: c["bonos"] = 300.0  # bono puntual sintético
        h = hd
        if pc == "P006" and mes == 3: h = 96  # vacaciones parciales
        costos.append((pc, cod, c, h))
        if rep:
            for a, sh in rep.items():
                horas.append((pc, a, cod, r2(h * util * sh)))
        else:
            costo_ind_ca[(cod, ca)] = costo_ind_ca.get((cod, ca), 0) + sum(c.values())

materiales = [
    ("MT01","Caja de cartón corrugado","unid","paquete x 25",95.00,1,25),
    ("MT02","Stretch film","m","rollo x 300 m",62.00,1,300),
    ("MT03","Etiqueta térmica","unid","rollo x 1 000",38.00,1,1000),
    ("MT04","Cinta de embalaje","m","caja x 36 rollos de 100 m",210.00,1,3600),
    ("MT05","Papel bond A4","hoja","caja x 10 paquetes de 500",185.00,1,5000),
]
precios, consumos = [], []
for (cod, _, i, mes, anio) in periodos:
    v = vol[cod]["total"]
    for (mc, _, _, _, pf, _, _) in materiales:
        precios.append((mc, cod, r2(pf * (1.0025 ** (i - 1)) * rnd.gauss(1, 0.01))))
    oc_n = v / 18
    for (a, mc, q) in [("A10","MT01",v*1.15),("A07","MT02",v*0.9),("A13","MT02",v*0.35),("A10","MT03",v*2.0),("A05","MT03",v*0.2),("A10","MT04",v*1.4),
                       ("A03","MT05",oc_n*4),("A01","MT05",oc_n*2),("A13","MT05",v*0.5),("A11","MT01",v*0.06),("A14","MT03",v*0.08)]:
        consumos.append((a, mc, cod, r2(q * rnd.gauss(1, 0.03))))

servicios = []
for (cod, _, i, mes, anio) in periodos:
    v = vol[cod]
    servicios.append(("A13", cod, "Rápido Courier S.A.C. (ficticio)", "Entrega última milla e-commerce", r2(v["OC03"]*0.6), "envío", r2(7.50*(1.003**(i-1))), f"F001-{1000+i}"))
    servicios.append(("A05", cod, "Estibas Lima E.I.R.L. (ficticio)", "Estiba tercerizada de recepción", r2(v["total"]/28*1.5), "hora", 18.00, f"F002-{2000+i}"))

ecs = [("EC01","Personal indirecto","personal"),("EC02","Alquiler de almacén","fijo"),("EC03","Energía eléctrica","variable"),("EC04","Combustible","variable"),
       ("EC05","Mantenimiento de flota","semivariable"),("EC06","Depreciación de montacargas y equipos","fijo"),("EC07","Depreciación de equipos TI","fijo"),
       ("EC08","Internet y telefonía","fijo"),("EC09","Seguros","fijo"),("EC10","Materiales indirectos (limpieza, EPP)","variable"),("EC11","Seguridad y vigilancia","fijo")]
m2 = {"CA01":100,"CA02":1800,"CA03":900,"CA04":300,"CA05":80,"CA06":120,"CA07":100}
equipos = {"CA02":4,"CA03":2,"CA04":1}
pcs = {"CA01":5,"CA02":4,"CA03":4,"CA04":4,"CA05":2,"CA06":8,"CA07":6}
anex = {"CA01":3,"CA02":2,"CA03":2,"CA04":3,"CA05":1,"CA06":5,"CA07":6}
valor_act = {"CA01":60000,"CA02":820000,"CA03":310000,"CA04":540000,"CA05":45000,"CA06":90000,"CA07":70000}
pct_mat = {"CA01":0.05,"CA02":0.35,"CA03":0.30,"CA04":0.15,"CA05":0.05,"CA06":0.06,"CA07":0.04}
montos, bases, reglas = [], [], []
def regla(cod, nivel, origen, centro, ind, uni, tipo, base_desde=""):
    reglas.append((cod, nivel, origen, centro, ind, uni, tipo, base_desde))
regla("R-EC01-CA","EC_CA","EC01","","Remuneración del personal indirecto del centro","S/","importe","PERSONAL_INDIRECTO")
regla("R-EC02-CA","EC_CA","EC02","","Área ocupada","m²","cantidad")
regla("R-EC03-CA","EC_CA","EC03","","Consumo de energía","kWh","cantidad")
regla("R-EC04-CA","EC_CA","EC04","","Directo a distribución","destino","directo")
regla("R-EC05-CA","EC_CA","EC05","","Directo a distribución","destino","directo")
regla("R-EC06-CA","EC_CA","EC06","","Número de equipos","equipo","cantidad")
regla("R-EC07-CA","EC_CA","EC07","","Número de computadoras","PC","cantidad")
regla("R-EC08-CA","EC_CA","EC08","","Número de anexos","anexo","cantidad")
regla("R-EC09-CA","EC_CA","EC09","","Valor de activos asegurados","S/","cantidad")
regla("R-EC10-CA","EC_CA","EC10","","% de asignación","%","porcentaje")
regla("R-EC11-CA","EC_CA","EC11","","Área vigilada","m²","cantidad")

acts_ca = {}
for a in actividades: acts_ca.setdefault(a[2], []).append(a[0])
# pesos CA→AC por elemento (estáticos salvo indicación)
W = {
 "EC01": {"CA01":{"A01":0.30,"A02":0.25,"A03":0.20,"A04":0.15,"X02":0.10},"CA02":{"A05":0.25,"A06":0.10,"A07":0.30,"A08":0.25,"X01":0.10},
          "CA03":{"A09":0.50,"A10":0.30,"A11":0.20},"CA04":{"A12":0.25,"A13":0.50,"A14":0.15,"X03":0.10},"CA05":{"A15":0.60,"X04":0.40}},
 "EC02": {"CA01":{"A01":30,"A02":25,"A03":25,"A04":20},"CA02":{"A05":300,"A06":120,"A07":1250,"A08":100,"X01":30},"CA03":{"A09":520,"A10":330,"A11":50},
          "CA04":{"A12":40,"A13":200,"A14":60},"CA05":{"A15":60,"X04":20}},
 "EC03": {"CA01":{"A01":1,"A02":1,"A03":1,"A04":1},"CA02":{"A05":3,"A06":1,"A07":4,"A08":2,"X01":1},"CA03":{"A09":4,"A10":3,"A11":1},"CA04":{"A12":1,"A13":2,"A14":1,"X03":1},"CA05":{"A15":2,"X04":1}},
 "EC04": {"CA04":{"A13":0.88,"A14":0.12}},
 "EC05": {"CA04":{"A13":0.85,"A14":0.15}},
 "EC06": {"CA02":{"A05":120,"A07":260,"A08":40},"CA03":{"A09":150,"A10":30},"CA04":{"A13":160,"A14":20}},
 "EC07": {"CA01":{"A01":1,"A02":2,"A03":1,"A04":1},"CA02":{"A05":1,"A06":1,"A08":2},"CA03":{"A09":2,"A10":1,"A11":1},"CA04":{"A12":2,"A13":1,"X03":1},"CA05":{"A15":1,"X04":1}},
 "EC08": {"CA01":{"A02":1,"A03":1,"A04":1},"CA02":{"A05":1,"A08":1},"CA03":{"A09":1,"A11":1},"CA04":{"A12":1,"A13":1,"A14":1},"CA05":{"A15":1}},
 "EC09": {"CA01":{"A01":0.25,"A02":0.25,"A03":0.25,"A04":0.25},"CA02":{"A05":0.25,"A07":0.55,"A08":0.20},"CA03":{"A09":0.6,"A10":0.4},"CA04":{"A13":0.9,"A14":0.1},"CA05":{"A15":0.7,"X04":0.3}},
 "EC10": {"CA01":{"A01":0.25,"A02":0.25,"A03":0.25,"A04":0.25},"CA02":{"A05":0.3,"A06":0.1,"A07":0.4,"A08":0.2},"CA03":{"A09":0.5,"A10":0.4,"A11":0.1},"CA04":{"A13":0.8,"A14":0.2},"CA05":{"A15":1.0}},
 "EC11": None,  # usa los mismos m² que EC02
}
TIPO_CA = {"EC01":("% de dedicación del personal indirecto","%","porcentaje"),"EC02":("Área ocupada por la actividad","m²","cantidad"),"EC03":("Equipos que consumen energía","equipo","cantidad"),
           "EC04":("% de kilómetros recorridos","%","porcentaje"),"EC05":("% de uso de flota","%","porcentaje"),"EC06":("Horas-máquina","h-máquina","cantidad"),
           "EC07":("Computadoras por actividad","PC","cantidad"),"EC08":("Anexos por actividad","anexo","cantidad"),"EC09":("% del valor asegurado usado","%","porcentaje"),
           "EC10":("% de asignación","%","porcentaje"),"EC11":("Área vigilada por actividad","m²","cantidad")}
ec_ca = {"EC04":["CA04"],"EC05":["CA04"],"EC06":["CA02","CA03","CA04"]}
for ec, *_ in ecs:
    cas = ec_ca.get(ec, ["CA01","CA02","CA03","CA04","CA05"])
    for ca in cas:
        ind, uni, tipo = TIPO_CA[ec]
        regla(f"R-{ec}-{ca}","CA_AC",ec,ca,ind,uni,tipo)

for (cod, _, i, mes, anio) in periodos:
    v = vol[cod]["total"]; rel = v / 2400
    raise_y = 1.0 if (anio, mes) < (2025, 1) else (1.04 if (anio, mes) < (2026, 1) else 1.04 * 1.05)
    kwh = {ca: base * (0.75 + 0.25 * rel) * rnd.gauss(1, 0.03) for ca, base in {"CA01":900,"CA02":5200,"CA03":3900,"CA04":1400,"CA05":500,"CA06":1500,"CA07":1100}.items()}
    km = 18500 * rel * rnd.gauss(1, 0.04)
    diesel = 15.8 * (1 + 0.04 * math.sin(i / 3)) * rnd.gauss(1, 0.015)
    montos += [("EC01", cod, r2(sum(costo_ind_ca.get((cod, ca), 0) for ca in m2))),
               ("EC02", cod, r2(18500 * raise_y)), ("EC03", cod, r2(sum(kwh.values()) * 0.62)), ("EC04", cod, r2(km / 9.5 * diesel)),
               ("EC05", cod, r2(3200 + 0.11 * km)), ("EC06", cod, 4200.00), ("EC07", cod, 1850.00), ("EC08", cod, r2(1450 * raise_y)),
               ("EC09", cod, r2(2600 * raise_y)), ("EC10", cod, r2(2.2 * v)), ("EC11", cod, r2(7800 * raise_y))]
    for ca in m2:
        bases.append(("R-EC02-CA", ca, cod, m2[ca], "REAL", "Plano de distribución del almacén"))
        bases.append(("R-EC11-CA", ca, cod, m2[ca], "REAL", "Plano de distribución del almacén"))
        bases.append(("R-EC03-CA", ca, cod, r2(kwh[ca]), "REAL", "Lectura de submedidores"))
        bases.append(("R-EC07-CA", ca, cod, pcs[ca], "REAL", "Inventario TI"))
        bases.append(("R-EC08-CA", ca, cod, anex[ca], "REAL", "Central telefónica"))
        bases.append(("R-EC09-CA", ca, cod, valor_act[ca], "REAL", "Póliza de seguros"))
        bases.append(("R-EC10-CA", ca, cod, pct_mat[ca], "REAL", "Vales de almacén de suministros"))
    for ca, n in equipos.items(): bases.append(("R-EC06-CA", ca, cod, n, "REAL", "Registro de activos"))
    bases.append(("R-EC04-CA", "CA04", cod, 1, "REAL", "Combustible solo de flota propia"))
    bases.append(("R-EC05-CA", "CA04", cod, 1, "REAL", "Mantenimiento solo de flota propia"))
    for ec, *_ in ecs:
        for ca in ec_ca.get(ec, ["CA01","CA02","CA03","CA04","CA05"]):
            w = W["EC02"][ca] if ec == "EC11" else W[ec].get(ca, {})
            for a, val in w.items():
                vv = val
                if ec in ("EC03","EC06") : vv = r2(val * (0.8 + 0.2 * rel)) if ec == "EC06" else val
                bases.append((f"R-{ec}-{ca}", a, cod, vv, "REAL", "Estudio de dedicación / registro operativo"))

objetos = [("OC01","Pedidos del canal mayorista","# pedidos","OBJETO"),("OC02","Pedidos del canal minorista","# pedidos","OBJETO"),
           ("OC03","Pedidos e-commerce","# pedidos","OBJETO"),("OC04","Pedidos de clientes corporativos","# pedidos","OBJETO")]
IND_OC = {"A01":("% de dedicación por canal","%","porcentaje"),"A02":("Número de cotizaciones","cotización","cantidad"),"A03":("Número de órdenes de compra","OC","cantidad"),
          "A04":("Reparto plano (sin registro por canal)","destino","plano"),"A05":("Número de recepciones","recepción","cantidad"),"A06":("Lotes inspeccionados","lote","cantidad"),
          "A07":("Pallets ubicados","pallet","cantidad"),"A08":("SKU contados","SKU","cantidad"),"A09":("Líneas de pedido preparadas","línea","cantidad"),
          "A10":("Pedidos empacados","pedido","cantidad"),"A11":("Pedidos reprocesados","pedido","cantidad"),"A12":("Rutas planificadas","ruta","cantidad"),
          "A13":("Entregas realizadas","entrega","cantidad"),"A14":("Devoluciones gestionadas","devolución","cantidad"),"A15":("Lotes inspeccionados","lote","cantidad")}
for a, (ind, uni, tipo) in IND_OC.items(): regla(f"R-{a}-OC","AC_OC",a,"",ind,uni,tipo)
magn = []
for (cod, _, i, mes, anio) in periodos:
    V = vol[cod]
    for o, *_ in objetos: magn.append((o, cod, round(V[o])))
    tot = sum(V[o] for o in ("OC01","OC02","OC03","OC04"))
    lineas = {"OC01":9.0,"OC02":4.0,"OC03":2.2,"OC04":12.0}
    entregas = {"OC01":0.35,"OC02":0.6,"OC03":1.0,"OC04":0.5}
    devol = {"OC01":0.01,"OC02":0.02,"OC03":0.06,"OC04":0.01}
    error = {"OC01":0.015,"OC02":0.02,"OC03":0.035,"OC04":0.01}
    compra = {"OC01":0.42,"OC02":0.30,"OC03":0.18,"OC04":0.10}
    for o, *_ in objetos:
        n = V[o]; g = lambda x: r2(x * rnd.gauss(1, 0.03))
        bases.append(("R-A01-OC", o, cod, round(n / tot, 4), "REAL", "Estudio de dedicación por canal"))
        bases.append(("R-A02-OC", o, cod, g(tot / 40 * compra[o]), "REAL", "Registro de cotizaciones"))
        bases.append(("R-A03-OC", o, cod, g(tot / 18 * compra[o]), "REAL", "ERP: órdenes de compra"))
        bases.append(("R-A04-OC", o, cod, 1, "ESTIMADO", "Reparto plano justificado: el seguimiento no se registra por canal (D-15, menor precisión)"))
        bases.append(("R-A05-OC", o, cod, g(tot / 28 * compra[o]), "REAL", "WMS: recepciones"))
        bases.append(("R-A06-OC", o, cod, g(tot / 35 * compra[o]), "REAL", "Registro de inspección"))
        bases.append(("R-A07-OC", o, cod, g(n * 0.3), "REAL", "WMS: ubicaciones"))
        bases.append(("R-A08-OC", o, cod, g(n * 0.5), "REAL", "WMS: conteos"))
        bases.append(("R-A09-OC", o, cod, g(n * lineas[o]), "REAL", "WMS: líneas preparadas"))
        bases.append(("R-A10-OC", o, cod, g(n), "REAL", "WMS: pedidos empacados"))
        est = "ESTIMADO" if (o == "OC04" and mes in (5, 6)) else "REAL"
        bases.append(("R-A11-OC", o, cod, g(n * error[o]), est, "Promedio histórico de 3 meses (registro no disponible)" if est == "ESTIMADO" else "Registro de no conformidades"))
        bases.append(("R-A12-OC", o, cod, g(n * entregas[o] / 25), "REAL", "TMS: rutas"))
        bases.append(("R-A13-OC", o, cod, g(n * entregas[o]), "REAL", "TMS: entregas"))
        bases.append(("R-A14-OC", o, cod, g(n * devol[o]), "REAL", "Registro de devoluciones"))
        bases.append(("R-A15-OC", o, cod, g(tot / 35 * compra[o]), "REAL", "Registro de inspección"))

presup, finanzas = [], []
for (cod, _, i, mes, anio) in periodos:
    plan = 2400 * (1.006 ** (i - 1)) * ESTAC[mes]
    presup.append((cod, "Volumen de pedidos presupuestado", round(plan), "pedidos"))
    presup.append((cod, "Costo logístico total presupuestado", r2((112000.0 + 26.0 * plan) * (1.0 if anio == 2024 else 1.03 if anio == 2025 else 1.06)), "S/"))  # presupuesto flexible: fijo + variable por pedido
    V = vol[cod]
    ventas = V["OC01"]*520 + V["OC02"]*175 + V["OC03"]*130 + V["OC04"]*900
    finanzas.append((cod, r2(ventas), r2(ventas * 0.62), r2(ventas * 0.11), 0.295))
eva_param = [("capital_invertido", 6500000, "S/", "Capital invertido operativo (sintético)"), ("ke", 0.145, "tasa anual", "Costo del patrimonio"),
             ("kd", 0.092, "tasa anual", "Costo de la deuda antes de impuestos"), ("deuda", 2600000, "S/", "Deuda financiera"),
             ("patrimonio", 3900000, "S/", "Patrimonio"), ("tasa_impuesto", 0.295, "tasa", "Impuesto a la renta Perú (parámetro editable)")]
escenarios = [("Base","volumen_pedidos","triangular",0.95,1.00,1.06),("Base","tarifa_courier","triangular",0.98,1.00,1.05),
              ("Base","precio_combustible","triangular",0.92,1.00,1.12),("Base","remuneraciones","triangular",1.00,1.00,1.05),
              ("Optimista","volumen_pedidos","triangular",1.00,1.05,1.12),("Pesimista","volumen_pedidos","triangular",0.85,0.93,1.00),
              ("Pesimista","precio_combustible","triangular",1.00,1.08,1.20)]

# ---------------- escritura ----------------
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
lines = ["05_Datos_Entrada.xlsx — Datos de carga del Sistema Informático Dinámico Inteligente Estocástico Predictivo de Costeo de la Cadena de Suministro Integral",
         "DATOS SINTÉTICOS: empresa ficticia «Distribuidora Andina Demo S.A.C.». No representan una empresa real (D-12).",
         f"Generado con semilla fija {SEED}; 24 meses ({periodos[0][1]} a {periodos[-1][1]}). Reproducible con PC05_DESARROLLO/codigo/datos/gen05.py.",
         "Cómo usarlo: en el sistema, pestaña «Modelo de Costeo» → «Importar 05_Datos_Entrada.xlsx». La importación es atómica: si hay un error, no se guarda nada y se informa hoja y fila.",
         "Cada hoja tiene encabezados en la fila 1; el sistema las lee por nombre de hoja y de columna (no por posición). Ver hoja «Diccionario».",
         "Los resultados de costeo no están en este archivo: los calcula el motor del sistema (entregables 06, 07, 08).",
         "Reglas aplicadas: D-02 costo por componentes, D-03 horas contractuales, D-05 personal indirecto por persona, D-06 P2 servicios directos, D-07 centro parcial y fuera de la cadena, D-08 otras actividades, D-10 IGV recuperable, D-15 inductores estimados rotulados."]
for l in lines: ins.append([l])
ins["A1"].font = Font(bold=True, size=13); ins["A2"].font = Font(bold=True, color="B45309"); ins.column_dimensions["A"].width = 160
hoja("Empresa", ["clave","valor"], [("nombre","Distribuidora Andina Demo S.A.C. — DATOS SINTÉTICOS"),("moneda","PEN"),("igv",0.18),("sintetico","SI"),("codigo_modelo","M03"),("nombre_modelo","Demostración 24 meses (datos sintéticos)")], {"valor":60})
hoja("Periodos", ["codigo","nombre","orden"], [(p[0], p[1], p[2]) for p in periodos])
hoja("Centros", ["codigo","nombre","participacion","pct_participacion","nota"], centros, {"nota":80,"nombre":30})
hoja("Actividades", ["codigo","nombre","centro","alcance","pct_alcance","clase","orden","nota"], [(a[0],a[1],a[2],a[3],None,a[4],k+1,"Otra actividad del centro, fuera de la cadena (D-08)" if a[3]=="EXCLUIDA" else "") for k, a in enumerate(actividades)], {"nombre":44,"nota":50})
hoja("Puestos", ["codigo","nombre","tipo"], puestos, {"nombre":32})
hoja("Personas", ["codigo","nombre","puesto","centro"], [(p[0], f"{NOMBRES[k]} (sintético)", p[1], p[2]) for k, p in enumerate(personas)], {"nombre":30})
hoja("CostoPersona", ["persona","periodo","remuneracion","essalud","gratificacion","cts","vacaciones","bonos","otros","horas_disponibles","sobreimputacion_autorizada","justificacion"],
     [(pc, cod, c["remuneracion"], c["essalud"], c["gratificacion"], c["cts"], c["vacaciones"], c["bonos"], c["otros"], h, "NO", "") for (pc, cod, c, h) in costos])
hoja("Horas", ["persona","actividad","periodo","horas"], horas)
hoja("Materiales", ["codigo","nombre","unidad_consumo","unidad_factura","costo_factura","cantidad_factura","equivalencia","incluye_igv","igv_recuperable","validado"],
     [(m[0], m[1], m[2], m[3], m[4], m[5], m[6], "SI", "SI", "SI") for m in materiales], {"nombre":30,"unidad_factura":28})
hoja("PreciosMaterial", ["material","periodo","costo_factura"], precios)
hoja("ConsumoMaterial", ["actividad","material","periodo","cantidad"], consumos)
hoja("ServiciosDirectos", ["actividad","periodo","proveedor","servicio","cantidad","unidad","tarifa","documento"], servicios, {"proveedor":34,"servicio":36})
hoja("ElementosCosto", ["codigo","nombre","tipo"], ecs, {"nombre":40})
hoja("MontosEC", ["ec","periodo","monto"], montos)
hoja("ObjetosCosto", ["codigo","nombre","magnitud","clase"], objetos, {"nombre":36})
hoja("MagnitudObjeto", ["objeto","periodo","cantidad"], magn)
hoja("Reglas", ["codigo","nivel","origen","centro","inductor","unidad","tipo_base","base_desde"], reglas, {"inductor":46})
hoja("Bases", ["regla","destino","periodo","valor","estado","metodo"], bases, {"metodo":60})
hoja("Presupuesto", ["periodo","concepto","monto","unidad"], presup, {"concepto":40})
hoja("FinanzasEVA", ["periodo","ventas","costo_ventas_sin_logistica","otros_gastos_operativos","tasa_impuesto"], finanzas)
hoja("ParametrosEVA", ["clave","valor","unidad","descripcion"], eva_param, {"descripcion":46})
hoja("Escenarios", ["escenario","variable","distribucion","minimo","moda","maximo"], escenarios)
dic = [("Empresa","clave/valor","Parámetros de la empresa: nombre, moneda, igv (fracción), sintetico SI/NO","—","Sí"),
       ("Periodos","codigo","Período mensual AAAA-MM","texto","Sí"),("Centros","participacion","PARTICIPA / NO_PARTICIPA / PARCIAL (D-07)","texto","Sí"),
       ("Centros","pct_participacion","Fracción 0–1 que continúa a la cadena si es PARCIAL","fracción","Si PARCIAL"),
       ("Actividades","alcance","INCLUIDA / EXCLUIDA (otra actividad) / PARCIAL (D-08)","texto","Sí"),("Actividades","clase","AV / NAVN / NAVI","texto","No"),
       ("Puestos","tipo","DIRECTO (P3) o INDIRECTO (va a P4a por persona, D-05)","texto","Sí"),
       ("CostoPersona","remuneracion…otros","Componentes del costo empresa mensual (D-02)","S/","Sí"),("CostoPersona","horas_disponibles","Horas contractuales del mes (D-03)","h","Sí"),
       ("Horas","horas","Horas imputadas por persona a la actividad en el período","h","Sí"),
       ("Materiales","costo_factura","Precio de la unidad de factura (con IGV si incluye_igv=SI)","S/","Sí"),("Materiales","equivalencia","Unidades de consumo por unidad de factura","unid","Sí"),
       ("ConsumoMaterial","cantidad","Cantidad consumida por la actividad (unidad de consumo)","unid","Sí"),
       ("ServiciosDirectos","tarifa","Tarifa del servicio directo atribuible a la actividad (D-06)","S/","Sí"),
       ("MontosEC","monto","Costo indirecto del período por elemento","S/","Sí"),
       ("Reglas","nivel","EC_CA (4a), CA_AC (4b), AC_OC (4c)","texto","Sí"),("Reglas","tipo_base","cantidad / porcentaje / importe / directo / plano","texto","Sí"),
       ("Reglas","base_desde","PERSONAL_INDIRECTO: la base se calcula con el costo de las personas indirectas del centro (D-05)","texto","No"),
       ("Bases","estado","REAL / ESTIMADO / AJUSTADO / PENDIENTE (D-15)","texto","Sí"),("Bases","metodo","Fuente o método de estimación del valor","texto","Sí"),
       ("MagnitudObjeto","cantidad","Magnitud para el costo unitario del objeto","unid","No"),
       ("Presupuesto","monto","Valores predeterminados/presupuestados para el dashboard (I3)","S/ o unid","No"),
       ("FinanzasEVA / ParametrosEVA","—","Datos sintéticos para NOPAT, WACC y EVA (I4)","S/ / tasa","No"),
       ("Escenarios","minimo/moda/maximo","Factores multiplicativos para Monte Carlo (I4)","factor","No")]
hoja("Diccionario", ["hoja","columna","descripcion","unidad","obligatorio"], dic, {"descripcion":90})
wb.save(OUT)
print("ok", OUT, "periodos", len(periodos), "personas", len(personas), "horas", len(horas), "bases", len(bases), "reglas", len(reglas))
