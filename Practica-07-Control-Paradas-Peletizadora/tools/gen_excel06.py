# -*- coding: utf-8 -*-
"""Generador del Excel 06 (entrada) · DATOS SINTÉTICOS · Contrato C06-1.0
Uso: python3 gen_excel06.py <salida.xlsx> [--sin-unidades | --ref-invalida | --volumen N]
Determinista: no usa azar salvo --volumen (semilla fija)."""
import sys, datetime as dt, random
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

CONTRATO = "C06-1.0"
EMPRESA = "Nutripellet Andino S.A.C. (empresa ficticia)"
D0 = dt.datetime(2026, 5, 1, 0, 0)
DCORTE = dt.datetime(2026, 11, 15, 23, 59)
H_INI, H_FIN = 6, 22  # ventana operativa 06:00-22:00, lunes a sábado

def f(d):
    return d.strftime("%Y-%m-%d %H:%M")

def P(s):
    return dt.datetime.strptime(s, "%Y-%m-%d %H:%M")

EQUIPOS = [
    ("P-01", "Peletizadora PL-300", "PELETIZADORA", "Peletizado", "ALTA", 16),
    ("M-01", "Mezcladora horizontal MX-2", "MEZCLADORA", "Mezclado", "MEDIA", 16),
    ("E-01", "Enfriador de contraflujo EC-5", "ENFRIADOR", "Peletizado", "MEDIA", 16),
]
PIEZAS = [  # codigo, nombre, unidad, costo S/, plazo normal días, plazo urgente h, mínimo, equipo
    ("0101", "Matriz (dado) 6 mm", "UND", 4800.00, 21, 50, 0, "P-01"),
    ("0102", "Juego de rodillos", "JGO", 2600.00, 14, 48, 1, "P-01"),
    ("0103", "Rodamiento principal 22320", "UND", 1450.00, 10, 46, 1, "P-01"),
    ("0104", "Correa de transmisión", "UND", 320.00, 3, 8, 2, "P-01"),
    ("0105", "Cuchilla de corte", "UND", 85.00, 5, 24, 2, "P-01"),
    ("0106", "Retén de eje principal", "UND", 120.00, 7, 24, 2, "P-01"),
    ("0201", "Paleta de mezcladora", "UND", 260.00, 7, 24, 1, "M-01"),
]
MODOS = [
    ("MF-01", "Desgaste de rodillos", "PELETIZADORA"),
    ("MF-02", "Falla de rodamiento principal", "PELETIZADORA"),
    ("MF-03", "Atoro de matriz", "PELETIZADORA"),
    ("MF-04", "Rotura o patinaje de correa", "PELETIZADORA"),
    ("MF-05", "Falla eléctrica del motor", "PELETIZADORA"),
    ("MF-06", "Desgaste de cuchilla de corte", "PELETIZADORA"),
    ("MF-07", "Rotura de paleta", "MEZCLADORA"),
    ("MF-08", "Falla de ventilador", "ENFRIADOR"),
]
SALDO_INICIAL = {"0101": 0, "0102": 1, "0103": 0, "0104": 3, "0105": 5, "0106": 2, "0201": 1}

# Paradas: (codigo, equipo, inicio, modo, sintoma, causa_estado, causa, evidencia,
#           tramos [(tipo, minutos)], consumos [(pieza, cant)], ingreso_urgente pieza|None,
#           reincidencia_de, reincidencia_estado, verif_fallida(bool))
EA, DX, ER, RP, VE, SC = "ESPERA_ATENCION", "DIAGNOSTICO", "ESPERA_REPUESTO", "REPARACION", "VERIFICACION", "SIN_CLASIFICAR"
PARADAS = [
    ("PAR-0001", "P-01", "2026-05-12 09:10", "MF-04", "Patinaje y olor a caucho", "CONFIRMADA", "Correa cristalizada por tensión insuficiente", "Foto de correa y medición de tensión",
     [(EA, 20), (DX, 30), (RP, 60), (VE, 20)], [("0104", 1)], None, "", "", False),
    ("PAR-0002", "P-01", "2026-05-27 14:00", "MF-02", "Vibración alta y temperatura en chumacera", "CONFIRMADA", "Rodamiento con pista picada por lubricación deficiente", "Lectura de vibración y foto del rodamiento",
     [(EA, 30), (DX, 90), (ER, 2940), (RP, 240), (VE, 40)], [("0103", 1)], "0103", "", "", False),
    ("PAR-0003", "P-01", "2026-06-08 07:30", "MF-06", "Pellet de longitud irregular", "CONFIRMADA", "Cuchillas desafiladas", "Muestra de pellet y foto de cuchillas",
     [(EA, 15), (DX, 20), (RP, 45), (VE, 15)], [("0105", 2)], None, "", "", False),
    ("PAR-0004", "P-01", "2026-06-19 10:00", "MF-01", "Baja producción y pellet desmoronado", "CONFIRMADA", "Rodillos con desgaste superior al límite", "Medición de holgura rodillo-matriz",
     [(EA, 25), (DX, 60), (RP, 300), (VE, 45)], [("0102", 1)], None, "", "", False),
    ("PAR-0005", "P-01", "2026-07-02 16:20", "MF-03", "Matriz atorada, motor se detiene", "CONFIRMADA", "Humedad alta del acondicionado", "Registro de humedad del lote",
     [(EA, 20), (DX, 45), (SC, 20), (RP, 150), (VE, 30)], [], None, "", "", False),
    ("PAR-0006", "P-01", "2026-07-15 08:40", "MF-01", "Baja producción y ruido en rodillos", "CONFIRMADA", "Rodillos con desgaste por ajuste incorrecto de holgura", "Medición de holgura rodillo-matriz",
     [(EA, 20), (DX, 50), (RP, 280), (VE, 40)], [("0102", 1)], None, "PAR-0004", "CONFIRMADA", False),
    ("PAR-0007", "P-01", "2026-07-30 13:00", "MF-04", "Correa rota", "CONFIRMADA", "Fatiga de correa", "Foto de correa",
     [(EA, 15), (DX, 25), (RP, 55), (VE, 15)], [("0104", 1)], None, "", "", False),
    ("PAR-0008", "P-01", "2026-08-11 06:30", "MF-02", "Vibración alta en arranque", "CONFIRMADA", "Rodamiento con jaula dañada", "Lectura de vibración y foto del rodamiento",
     [(EA, 40), (DX, 120), (ER, 2760), (RP, 270), (VE, 45)], [("0103", 1)], "0103", "", "", False),
    ("PAR-0009", "P-01", "2026-08-24 11:15", "MF-06", "Pellet de longitud irregular", "CONFIRMADA", "Cuchillas desafiladas", "Muestra de pellet",
     [(EA, 10), (DX, 15), (RP, 40), (VE, 15)], [("0105", 2)], None, "", "", False),
    ("PAR-0010", "P-01", "2026-09-05 09:00", "MF-05", "Motor no arranca", "CONFIRMADA", "Contactor principal quemado", "Prueba de continuidad y foto del contactor",
     [(EA, 30), (DX, 180), (RP, 240), (VE, 30), (RP, 60), (VE, 30)], [], None, "", "", True),
    ("PAR-0011", "P-01", "2026-09-18 15:40", "MF-01", "Baja producción", "CONFIRMADA", "Rodillos al final de su vida útil", "Medición de holgura rodillo-matriz",
     [(EA, 20), (DX, 45), (RP, 290), (VE, 40)], [("0102", 1)], None, "", "", False),
    ("PAR-0012", "P-01", "2026-09-30 07:00", "MF-03", "Matriz atorada", "CONFIRMADA", "Humedad alta del acondicionado", "Registro de humedad del lote",
     [(EA, 15), (DX, 30), (RP, 120), (VE, 30)], [], None, "", "", False),
    ("PAR-0013", "P-01", "2026-10-09 10:30", "MF-02", "Vibración alta", "CONFIRMADA", "Rodamiento con desgaste por contaminación", "Lectura de vibración",
     [(EA, 25), (DX, 90), (RP, 260), (VE, 40)], [("0103", 1)], None, "", "", False),
    ("PAR-0014", "P-01", "2026-10-21 14:10", "MF-04", "Patinaje de correa", "CONFIRMADA", "Correa estirada", "Medición de tensión",
     [(EA, 20), (DX, 20), (RP, 50), (VE, 15)], [("0104", 1)], None, "", "", False),
    ("PAR-0015", "P-01", "2026-10-28 08:00", "MF-03", "Matriz atorada y agrietada", "CONFIRMADA", "Matriz con grietas por fatiga", "Foto de grietas en la matriz",
     [(EA, 20), (DX, 60), (ER, 3000), (RP, 360), (VE, 60)], [("0101", 1)], "0101", "PAR-0012", "DESCARTADA", False),
    ("PAR-0016", "P-01", "2026-11-10 09:20", "MF-06", "Pellet de longitud irregular", "CONFIRMADA", "Cuchillas desafiladas", "Muestra de pellet",
     [(EA, 10), (DX, 20), (RP, 40), (VE, 15)], [("0105", 2)], None, "", "", False),
    ("PAR-0017", "P-01", "2026-11-13 16:00", "MF-04", "Ruido y patinaje de correa", "PENDIENTE", "", "",
     [(EA, 15), (DX, 40), (RP, 50), (VE, 20)], [("0104", 1)], None, "PAR-0014", "PENDIENTE", False),
    ("PAR-0018", "M-01", "2026-06-25 10:00", "MF-07", "Ruido metálico en mezcladora", "CONFIRMADA", "Paleta rota por objeto extraño", "Foto de paleta",
     [(EA, 20), (DX, 30), (RP, 120), (VE, 20)], [("0201", 1)], None, "", "", False),
    ("PAR-0019", "M-01", "2026-09-12 08:30", "MF-07", "Mezcla no homogénea", "HIPOTESIS", "Posible paleta deformada", "",
     [(EA, 15), (DX, 40), (ER, 1500), (RP, 90), (VE, 20)], [("0201", 1)], "0201", "", "", False),
    ("PAR-0020", "E-01", "2026-08-03 11:00", "MF-08", "Temperatura de pellet alta", "CONFIRMADA", "Rodamiento del ventilador trabado", "Foto del ventilador",
     [(EA, 20), (DX, 40), (RP, 100), (VE, 20)], [], None, "", "", False),
]
# Ingresos de reposición normal (no urgentes): (fecha, pieza, cantidad, referencia)
INGRESOS_NORMALES = [
    ("2026-06-15 10:00", "0105", 4, "Guía G-1021"),
    ("2026-07-03 11:00", "0102", 1, "Guía G-1045"),
    ("2026-07-29 09:30", "0102", 1, "Guía G-1077"),
    ("2026-08-05 15:00", "0104", 2, "Guía G-1083"),
    ("2026-08-25 10:00", "0103", 1, "Guía G-1090 (acción AC-02)"),
    ("2026-10-02 12:00", "0102", 1, "Guía G-1132"),
    ("2026-10-19 09:00", "0103", 1, "Guía G-1150 (reposición AC-02)"),
    ("2026-11-12 10:30", "0105", 2, "Guía G-1188"),
]
TAREAS = [  # codigo, equipo, modo, descripcion, frecuencia, justificacion, responsable, critica, criterio, primera
    ("TP-01", "P-01", "MF-01", "Inspeccionar y ajustar holgura de rodillos", 14, "Dos fallas MF-01 en 26 días; acción AC-01 reduce de 30 a 14 días", "Técnico mecánico", "SI", "Holgura entre 0.1 y 0.3 mm registrada", "2026-05-04"),
    ("TP-02", "P-01", "MF-02", "Lubricar rodamiento principal", 7, "Recomendación del manual del fabricante (ficticio)", "Técnico mecánico", "SI", "Grasa aplicada y temperatura < 70 °C", "2026-05-03"),
    ("TP-03", "P-01", "MF-04", "Verificar tensión de correas", 30, "Historial de tres fallas de correa en el semestre", "Técnico mecánico", "NO", "Deflexión dentro de tabla del fabricante", "2026-05-10"),
    ("TP-04", "P-01", "MF-06", "Cambiar cuchillas de corte", 45, "Vida útil observada de cuchillas", "Técnico mecánico", "NO", "Longitud de pellet dentro de especificación", "2026-05-20"),
    ("TP-05", "P-01", "MF-03", "Limpiar matriz y controlar humedad del acondicionado", 14, "Dos atoros asociados a humedad", "Supervisor de producción", "SI", "Humedad del acondicionado entre 15 y 17 %", "2026-05-06"),
]
ACCIONES = [
    ("AC-01", "Reincidencia de desgaste de rodillos (MF-01)", "Reducir la frecuencia de inspección de rodillos de 30 a 14 días y registrar holgura", "TECNICA",
     "Jefe de mantenimiento", "2026-07-20", "0 reincidencias MF-01 confirmadas por cada 1000 h de operación", "Reincidencias MF-01 confirmadas / 1000 h de operación",
     "2026-07-20", "2026-11-15", "", "PAR-0006", "", "MF-01"),
    ("AC-02", "Esperas prolongadas por falta de rodamiento principal", "Mantener 1 rodamiento 22320 disponible y pedir reposición al consumirlo", "ALMACEN",
     "Jefe de almacén", "2026-08-25", "Reducir la espera media por intervención que requirió rodamiento a menos de 60 min", "Minutos de espera de pieza / intervención que requirió la pieza 0103",
     "2026-08-25", "2026-11-15", "", "PAR-0008", "0103", ""),
]
PARAMETROS = [
    ("ventana_reincidencia_dias", 30, "días", "Ventana para alertar posible reincidencia por equipo y modo de falla"),
    ("costo_hora_parada_soles", 1800.00, "S/ por hora", "Valor de una hora improductiva de la peletizadora (margen perdido)"),
    ("costo_posesion_anual_pct", 25.00, "% anual", "Costo de mantener inventario sobre el costo unitario"),
    ("recargo_urgencia_pct", 30.00, "%", "Recargo por compra urgente"),
    ("horas_plan_dia", 16.00, "horas", "Horas planificadas por día laborable (lunes a sábado)"),
    ("semilla_defecto", 20261119, "entero", "Semilla del generador aleatorio de la simulación"),
    ("repeticiones_defecto", 2000, "corridas", "Repeticiones por política en la simulación"),
    ("horizonte_defecto_dias", 180, "días", "Horizonte de proyección por defecto"),
]

def construir():
    filas = {}
    filas["Equipos"] = [list(e) for e in EQUIPOS]
    filas["Piezas"] = [list(p) for p in PIEZAS]
    filas["Modos_Falla"] = [list(m) for m in MODOS]
    par_rows, tra_rows, ver_rows, ord_rows, int_rows, con_rows, mov_rows = [], [], [], [], [], [], []
    eventos_stock = []  # (fecha, pieza, delta)
    for p in PIEZAS:
        mov_rows.append(None)
    mov_rows = []
    nmov = 0
    for cod, cant in SALDO_INICIAL.items():
        nmov += 1
        mov_rows.append([f"MOV-{nmov:04d}", cod, "SALDO_INICIAL", cant, f(D0), f(D0), "", "Inventario físico al inicio", "Jefe de almacén", "Saldo inicial del período"])
        eventos_stock.append((D0, cod, cant))
    nord = nint = ncon = nver = 0
    paradas_int = []
    for (cod, eq, ini, modo, sint, cest, causa, evid, tramos, consumos, urg, rde, rest, vfall) in PARADAS:
        t = P(ini)
        inicio = t
        seq = 0
        rep_ini = None
        esp_fin = None
        ver_list = []
        for (tipo, mins) in tramos:
            seq += 1
            t2 = t + dt.timedelta(minutes=mins)
            ev = {EA: "Aviso de Producción", DX: "Hoja de diagnóstico", ER: "Pedido urgente de compra", RP: "Orden de trabajo", VE: "Prueba de retorno", SC: "Sin registro de actividad"}[tipo]
            tra_rows.append([cod, seq, tipo, f(t), f(t2), ev])
            if tipo == RP and rep_ini is None:
                rep_ini = t
            if tipo == ER:
                esp_fin = t2
            if tipo == VE:
                ver_list.append(t2)
            t = t2
        fin = t
        registro = inicio + dt.timedelta(minutes=5 if eq == "P-01" else 10)
        par_rows.append([cod, eq, f(inicio), f(fin), f(registro), sint, modo, cest, causa, evid,
                         "Operador de turno", "Supervisor de producción", rde, rest])
        paradas_int.append((eq, inicio, fin))
        for i, tv in enumerate(ver_list):
            nver += 1
            ok = not (vfall and i == 0)
            ver_rows.append([f"VER-{nver:04d}", cod, f(tv), "APTO" if ok else "NO_APTO", "Supervisor de producción",
                             "Producción a ritmo nominal" if ok else "Vibración persiste; se retoma reparación"])
        nord += 1
        ot = f"OT-{nord:04d}"
        ord_rows.append([ot, "CORRECTIVA", eq, cod, "", f(inicio + dt.timedelta(minutes=6)), f(fin), "CERRADA", "Jefe de mantenimiento", f"Correctivo {modo}: {sint}"])
        nint += 1
        req = "SI" if consumos else "NO"
        pz = consumos[0][0] if consumos else ""
        int_rows.append([f"INT-{nint:04d}", ot, f(inicio), f(fin), "Técnico mecánico" if modo != "MF-05" else "Electricista", f"Atender {sint.lower()}", req, pz])
        if urg:
            nmov += 1
            mov_rows.append([f"MOV-{nmov:04d}", urg, "INGRESO", 1, f(esp_fin), f(esp_fin + dt.timedelta(minutes=10)), ot, "Compra urgente", "Jefe de almacén", "Ingreso por compra urgente"])
            eventos_stock.append((esp_fin, urg, 1))
        for (pieza, cant) in consumos:
            ncon += 1
            tc = rep_ini
            con_rows.append([f"CON-{ncon:04d}", ot, pieza, cant, f(tc), f(tc + dt.timedelta(minutes=15)), "Jefe de almacén"])
            eventos_stock.append((tc, pieza, -cant))
    for (fe, pieza, cant, ref) in INGRESOS_NORMALES:
        nmov += 1
        mov_rows.append([f"MOV-{nmov:04d}", pieza, "INGRESO", cant, fe, f(P(fe) + dt.timedelta(minutes=20)), "", ref, "Jefe de almacén", "Reposición normal"])
        eventos_stock.append((P(fe), pieza, cant))
    # Preventivos: ejecuciones y mantenimiento programado (22:00-23:30, fuera de la ventana operativa)
    tar_rows, eje_rows, mp_rows = [], [], []
    neje = nmp = 0
    abierta_ot = None
    for (tc, eq, modo, desc, frec, just, resp, crit, crit_ac, prim) in TAREAS:
        tar_rows.append([tc, eq, modo, desc, frec, just, resp, crit, crit_ac, prim])
        venc = dt.datetime.strptime(prim, "%Y-%m-%d")
        k = 0
        while venc <= DCORTE:
            k += 1
            fr = frec
            if tc == "TP-01" and venc < dt.datetime(2026, 7, 20):
                fr = 30
            # Reglas de ejecución sintéticas: TP-01 último vencimiento sin ejecutar; algunas tardías
            ejecutar = True
            atraso = 0
            if tc == "TP-01" and venc >= dt.datetime(2026, 11, 8):
                ejecutar = False
            if tc == "TP-02" and k in (6, 15):
                atraso = 2
            if tc == "TP-05" and k == 4:
                atraso = 3
            nord += 1
            ot = f"OT-{nord:04d}"
            if ejecutar:
                fe = venc + dt.timedelta(days=atraso, hours=22)
                # no se ejecuta un preventivo durante una parada del mismo equipo: se posterga al día siguiente del cierre
                for (e2, a, b) in paradas_int:
                    if e2 == eq and fe < b and a < fe + dt.timedelta(minutes=90):
                        fe = (b + dt.timedelta(days=1)).replace(hour=22, minute=0)
                ord_rows.append([ot, "PREVENTIVA", eq, "", tc, f(fe - dt.timedelta(hours=1)), f(fe + dt.timedelta(minutes=90)), "CERRADA", resp, desc])
                neje += 1
                eje_rows.append([f"EJ-{neje:04d}", tc, ot, venc.strftime("%Y-%m-%d"), f(fe + dt.timedelta(minutes=90)), "CONFORME", f"Checklist {tc} firmado"])
                nmp += 1
                mp_rows.append([f"MP-{nmp:04d}", eq, f(fe), f(fe + dt.timedelta(minutes=90)), ot, desc])
            else:
                ord_rows.append([ot, "PREVENTIVA", eq, "", tc, f(venc - dt.timedelta(days=1) + dt.timedelta(hours=8)), "", "ABIERTA", resp, desc + " (pendiente)"])
            venc = venc + dt.timedelta(days=fr)
    # Orden preventiva abierta con reserva de 2 cuchillas (prueba de Almacén)
    nord += 1
    ot_res = f"OT-{nord:04d}"
    ord_rows.append([ot_res, "PREVENTIVA", "P-01", "", "TP-04", "2026-11-14 08:00", "", "ABIERTA", "Técnico mecánico", "Cambiar cuchillas de corte (programado 17/11/2026)"])
    res_rows = [["RES-0001", ot_res, "0105", 2, "2026-11-14 08:10", "VIGENTE"]]
    # Verificar existencias no negativas
    eventos_stock.sort(key=lambda x: (x[0], -x[2]))
    saldo = {}
    for (fe, pz, d) in eventos_stock:
        saldo[pz] = saldo.get(pz, 0) + d
        assert saldo[pz] >= 0, (fe, pz, saldo[pz])
    # Horas de operación
    ho_rows = []
    dia = D0
    prev = {}
    while dia.date() <= DCORTE.date():
        for (eq, *_rest) in EQUIPOS:
            if dia.weekday() == 6:
                h = 0.0
            else:
                w0 = dia.replace(hour=H_INI)
                w1 = dia.replace(hour=H_FIN)
                perd = 0
                for (e2, a, b) in paradas_int:
                    if e2 != eq:
                        continue
                    lo, hi = max(a, w0), min(b, w1)
                    if hi > lo:
                        perd += (hi - lo).total_seconds() / 60
                h = round((16 * 60 - perd) / 60, 2)
            ho_rows.append([eq, dia.strftime("%Y-%m-%d"), h])
        dia += dt.timedelta(days=1)
    filas.update({
        "Horas_Operacion": ho_rows, "Paradas": par_rows, "Tramos": tra_rows, "Verificaciones": ver_rows,
        "Ordenes": ord_rows, "Intervenciones": int_rows, "Consumos": con_rows, "Movimientos": mov_rows,
        "Reservas": res_rows, "Tareas_Preventivas": tar_rows, "Ejecuciones_Preventivas": eje_rows,
        "Mant_Programado": mp_rows, "Acciones": [list(a) for a in ACCIONES], "Parametros": [list(p) for p in PARAMETROS],
    })
    return filas, saldo

ENCABEZADOS = {
    "Equipos": ["codigo_equipo", "nombre", "tipo_equipo", "area", "criticidad", "horas_plan_dia"],
    "Piezas": ["codigo_pieza", "nombre", "unidad", "costo_unitario_soles", "plazo_normal_dias", "plazo_urgente_horas", "stock_minimo", "codigo_equipo"],
    "Modos_Falla": ["codigo_modo", "nombre", "tipo_equipo"],
    "Horas_Operacion": ["codigo_equipo", "fecha", "horas_efectivas"],
    "Paradas": ["codigo_parada", "codigo_equipo", "inicio", "fin", "registro", "sintoma", "codigo_modo", "estado_causa", "causa", "evidencia_causa", "reportado_por", "verificado_por", "reincidencia_de", "estado_reincidencia"],
    "Tramos": ["codigo_parada", "secuencia", "tipo_tramo", "inicio", "fin", "evidencia"],
    "Verificaciones": ["codigo_verificacion", "codigo_parada", "fecha_hora", "resultado", "verificado_por", "observacion"],
    "Ordenes": ["codigo_orden", "tipo_orden", "codigo_equipo", "codigo_parada", "codigo_tarea", "apertura", "cierre", "estado", "responsable", "descripcion"],
    "Intervenciones": ["codigo_intervencion", "codigo_orden", "inicio", "fin", "tecnico", "descripcion", "requirio_pieza", "codigo_pieza"],
    "Consumos": ["codigo_consumo", "codigo_orden", "codigo_pieza", "cantidad", "fecha_efectiva", "fecha_registro", "responsable"],
    "Movimientos": ["codigo_movimiento", "codigo_pieza", "tipo_movimiento", "cantidad", "fecha_efectiva", "fecha_registro", "codigo_orden", "referencia", "responsable", "motivo"],
    "Reservas": ["codigo_reserva", "codigo_orden", "codigo_pieza", "cantidad", "fecha", "estado"],
    "Tareas_Preventivas": ["codigo_tarea", "codigo_equipo", "codigo_modo", "descripcion", "frecuencia_dias", "justificacion", "responsable", "critica", "criterio_aceptacion", "primer_vencimiento"],
    "Ejecuciones_Preventivas": ["codigo_ejecucion", "codigo_tarea", "codigo_orden", "fecha_vencimiento", "fecha_ejecucion", "resultado", "evidencia"],
    "Mant_Programado": ["codigo_periodo", "codigo_equipo", "inicio", "fin", "codigo_orden", "descripcion"],
    "Acciones": ["codigo_accion", "problema", "accion", "tipo_accion", "responsable", "fecha", "objetivo", "indicador", "revision_desde", "revision_hasta", "resultado", "codigo_parada", "codigo_pieza", "codigo_modo"],
    "Parametros": ["clave", "valor", "unidad", "descripcion"],
}
UNIDADES = [  # hoja, columna, unidad
    ("Equipos", "horas_plan_dia", "horas por día"),
    ("Piezas", "costo_unitario_soles", "soles (S/), 2 decimales"),
    ("Piezas", "plazo_normal_dias", "días calendario"),
    ("Piezas", "plazo_urgente_horas", "horas calendario"),
    ("Piezas", "stock_minimo", "unidades de la pieza"),
    ("Horas_Operacion", "horas_efectivas", "horas de operación, 2 decimales"),
    ("Tramos", "inicio / fin", "fecha y hora de Lima"),
    ("Consumos", "cantidad", "unidades de la pieza (entero)"),
    ("Movimientos", "cantidad", "unidades de la pieza (entero positivo)"),
    ("Reservas", "cantidad", "unidades de la pieza (entero)"),
    ("Tareas_Preventivas", "frecuencia_dias", "días calendario"),
    ("Parametros", "valor", "según columna unidad"),
]
TEXTO = {"codigo_pieza", "codigo_equipo", "codigo_parada", "codigo_orden", "codigo_tarea", "codigo_modo"}

PERIODO = ["2026-05-01", "2026-11-15"]

def escribir(ruta, filas, variante=None):
    wb = Workbook()
    ws = wb.active
    ws.title = "LEEME"
    neg = Font(bold=True)
    gris = PatternFill("solid", fgColor="D9D9D9")
    meta = [
        ("Clave", "Valor"),
        ("Empresa", EMPRESA),
        ("Rotulo", "DATOS SINTÉTICOS"),
        ("Version_contrato", CONTRATO),
        ("Periodo_desde", PERIODO[0]),
        ("Periodo_hasta", PERIODO[1]),
        ("Zona_horaria", "America/Lima (UTC-05:00), sin horario de verano"),
        ("Formato_fecha", "AAAA-MM-DD para fechas; AAAA-MM-DD HH:MM para fecha y hora (texto)"),
        ("Unidades", "Ver tabla «Unidades por columna» debajo; importes en soles con punto decimal"),
        ("Codigos", "Los códigos son texto; conservar ceros iniciales (por ejemplo 0101)"),
        ("Separadores", "En pantalla y en Excel se muestra coma para miles y punto decimal"),
    ]
    if variante == "sin_unidades":
        meta = [m for m in meta if m[0] != "Unidades"]
    for i, (k, v) in enumerate(meta, start=1):
        ws.cell(i, 1, k); ws.cell(i, 2, v)
        if i == 1:
            ws.cell(i, 1).font = neg; ws.cell(i, 2).font = neg
            ws.cell(i, 1).fill = gris; ws.cell(i, 2).fill = gris
    r = len(meta) + 2
    ws.cell(r, 1, "Unidades por columna").font = neg
    r += 1
    for j, h in enumerate(["Hoja", "Columna", "Unidad"], start=1):
        c = ws.cell(r, j, h); c.font = neg; c.fill = gris
    if variante != "sin_unidades":
        for (h, c_, u) in UNIDADES:
            r += 1
            ws.cell(r, 1, h); ws.cell(r, 2, c_); ws.cell(r, 3, u)
    r += 2
    ws.cell(r, 1, "Conteos esperados").font = neg
    r += 1
    for j, h in enumerate(["Hoja", "Filas de datos"], start=1):
        c = ws.cell(r, j, h); c.font = neg; c.fill = gris
    for hoja in ENCABEZADOS:
        r += 1
        ws.cell(r, 1, hoja); ws.cell(r, 2, len(filas[hoja]))
    ws.column_dimensions["A"].width = 26
    ws.column_dimensions["B"].width = 70
    ws.column_dimensions["C"].width = 34
    for hoja, enc in ENCABEZADOS.items():
        w = wb.create_sheet(hoja)
        for j, h in enumerate(enc, start=1):
            c = w.cell(1, j, h); c.font = neg; c.fill = gris
        for i, fila in enumerate(filas[hoja], start=2):
            for j, v in enumerate(fila, start=1):
                c = w.cell(i, j, v)
                col = enc[j - 1]
                if col in TEXTO or isinstance(v, str):
                    c.number_format = "@"
                elif isinstance(v, float):
                    c.number_format = "#,##0.00;[Red]-#,##0.00"
                elif isinstance(v, int):
                    c.number_format = "0;[Red]-0"
        for j, h in enumerate(enc, start=1):
            mx = max([len(str(h))] + [len(str(fl[j - 1])) for fl in filas[hoja][:200]])
            w.column_dimensions[get_column_letter(j)].width = min(60, max(10, mx + 2))
        w.freeze_panes = "A2"
    wb.save(ruta)

def construir_denominador():
    """Caso de prueba «Denominador»: dos intervenciones que requieren la pieza 0103;
    la primera espera 4 h y tiene dos líneas de consumo; la segunda no espera. Espera media esperada: 2 h."""
    f2 = lambda s: s
    filas = {k: [] for k in ENCABEZADOS}
    filas["Equipos"] = [list(EQUIPOS[0])]
    filas["Piezas"] = [list(p) for p in PIEZAS if p[7] == "P-01"]
    filas["Modos_Falla"] = [list(m) for m in MODOS if m[2] == "PELETIZADORA"]
    d = dt.datetime(2026, 10, 1)
    while d <= dt.datetime(2026, 10, 31):
        filas["Horas_Operacion"].append(["P-01", d.strftime("%Y-%m-%d"), 0.0 if d.weekday() == 6 else 16.0])
        d += dt.timedelta(days=1)
    filas["Paradas"] = [
        ["PAR-0001", "P-01", "2026-10-05 08:00", "2026-10-05 16:00", "2026-10-05 08:05", "Vibración alta", "MF-02", "CONFIRMADA", "Rodamiento dañado", "Lectura de vibración", "Operador de turno", "Supervisor de producción", "", ""],
        ["PAR-0002", "P-01", "2026-10-20 09:00", "2026-10-20 12:00", "2026-10-20 09:05", "Vibración alta", "MF-02", "CONFIRMADA", "Rodamiento dañado", "Lectura de vibración", "Operador de turno", "Supervisor de producción", "", ""]]
    filas["Tramos"] = [
        ["PAR-0001", 1, "DIAGNOSTICO", "2026-10-05 08:00", "2026-10-05 09:00", "Hoja de diagnóstico"],
        ["PAR-0001", 2, "ESPERA_REPUESTO", "2026-10-05 09:00", "2026-10-05 13:00", "Rodamiento sin stock"],
        ["PAR-0001", 3, "REPARACION", "2026-10-05 13:00", "2026-10-05 15:00", "Orden de trabajo"],
        ["PAR-0001", 4, "VERIFICACION", "2026-10-05 15:00", "2026-10-05 16:00", "Prueba de retorno"],
        ["PAR-0002", 1, "DIAGNOSTICO", "2026-10-20 09:00", "2026-10-20 10:00", "Hoja de diagnóstico"],
        ["PAR-0002", 2, "REPARACION", "2026-10-20 10:00", "2026-10-20 11:30", "Orden de trabajo"],
        ["PAR-0002", 3, "VERIFICACION", "2026-10-20 11:30", "2026-10-20 12:00", "Prueba de retorno"]]
    filas["Verificaciones"] = [["VER-0001", "PAR-0001", "2026-10-05 16:00", "APTO", "Supervisor de producción", ""], ["VER-0002", "PAR-0002", "2026-10-20 12:00", "APTO", "Supervisor de producción", ""]]
    filas["Ordenes"] = [["OT-0001", "CORRECTIVA", "P-01", "PAR-0001", "", "2026-10-05 08:10", "2026-10-05 16:00", "CERRADA", "Jefe de mantenimiento", "Cambio de rodamiento"],
                        ["OT-0002", "CORRECTIVA", "P-01", "PAR-0002", "", "2026-10-20 09:10", "2026-10-20 12:00", "CERRADA", "Jefe de mantenimiento", "Cambio de rodamiento"]]
    filas["Intervenciones"] = [["INT-0001", "OT-0001", "2026-10-05 08:00", "2026-10-05 16:00", "Técnico mecánico", "Cambio de rodamiento", "SI", "0103"],
                               ["INT-0002", "OT-0002", "2026-10-20 09:00", "2026-10-20 12:00", "Técnico mecánico", "Cambio de rodamiento", "SI", "0103"]]
    filas["Consumos"] = [["CON-0001", "OT-0001", "0103", 1, "2026-10-05 13:00", "2026-10-05 13:10", "Jefe de almacén"],
                         ["CON-0002", "OT-0001", "0106", 1, "2026-10-05 13:05", "2026-10-05 13:15", "Jefe de almacén"],
                         ["CON-0003", "OT-0002", "0103", 1, "2026-10-20 10:00", "2026-10-20 10:10", "Jefe de almacén"]]
    filas["Movimientos"] = [["MOV-0001", "0103", "SALDO_INICIAL", 0, "2026-10-01 00:00", "2026-10-01 00:00", "", "Inventario", "Jefe de almacén", ""],
                            ["MOV-0002", "0106", "SALDO_INICIAL", 2, "2026-10-01 00:00", "2026-10-01 00:00", "", "Inventario", "Jefe de almacén", ""],
                            ["MOV-0003", "0103", "INGRESO", 2, "2026-10-05 13:00", "2026-10-05 13:00", "OT-0001", "Compra urgente", "Jefe de almacén", ""]]
    filas["Parametros"] = [list(p) for p in PARAMETROS]
    return filas

def construir_volumen(anios=5, semilla=20261119):
    """Historial sintético ampliado: varios años con fallas aleatorias reproducibles (prueba de volumen)."""
    rnd = random.Random(semilla)
    filas, _ = construir()
    for k in ["Paradas", "Tramos", "Verificaciones", "Ordenes", "Intervenciones", "Consumos", "Movimientos", "Reservas", "Ejecuciones_Preventivas", "Mant_Programado", "Acciones", "Horas_Operacion"]:
        filas[k] = []
    ini = dt.datetime(2026 - anios, 11, 16)
    fin = dt.datetime(2026, 11, 15, 23, 59)
    modos_eq = {"P-01": ["MF-01", "MF-02", "MF-03", "MF-04", "MF-05", "MF-06"], "M-01": ["MF-07"], "E-01": ["MF-08"]}
    pieza_modo = {"MF-01": "0102", "MF-02": "0103", "MF-03": "0101", "MF-04": "0104", "MF-06": "0105", "MF-07": "0201"}
    nmov = 0
    for cod in SALDO_INICIAL:
        nmov += 1
        filas["Movimientos"].append([f"MOV-{nmov:05d}", cod, "SALDO_INICIAL", 50, f(ini), f(ini), "", "Inventario", "Jefe de almacén", ""])
    npar = nord = ncon = nver = nint = 0
    intervalos = {}
    for eq, tasa in [("P-01", 9.0), ("M-01", 2.0), ("E-01", 1.5)]:
        t = ini + dt.timedelta(days=rnd.uniform(1, 10))
        prev_fin = ini
        while True:
            t = t + dt.timedelta(days=rnd.expovariate(1 / tasa))
            t = t.replace(hour=rnd.randint(6, 20), minute=rnd.choice([0, 10, 20, 30, 40, 50]), second=0, microsecond=0)
            if t < prev_fin + dt.timedelta(hours=1):
                t = (prev_fin + dt.timedelta(hours=1)).replace(second=0, microsecond=0)
                t = t.replace(minute=(t.minute // 10) * 10) + dt.timedelta(minutes=10)
            if t > fin - dt.timedelta(days=3):
                break
            modo = rnd.choice(modos_eq[eq])
            tramos = [(EA, rnd.randint(10, 40)), (DX, rnd.randint(15, 120))]
            pz = pieza_modo.get(modo)
            usa = pz is not None and rnd.random() < 0.8
            if usa and rnd.random() < 0.3:
                tramos.append((ER, rnd.randint(240, 3000)))
            tramos += [(RP, rnd.randint(40, 360)), (VE, rnd.randint(10, 60))]
            npar += 1; nord += 1
            cp, ot = f"PAR-{npar:05d}", f"OT-{nord:05d}"
            tt = t; rep_ini = None
            for i, (tipo, m) in enumerate(tramos, start=1):
                t2 = tt + dt.timedelta(minutes=m)
                filas["Tramos"].append([cp, i, tipo, f(tt), f(t2), "Registro sintético"])
                if tipo == RP and rep_ini is None: rep_ini = tt
                tt = t2
            filas["Paradas"].append([cp, eq, f(t), f(tt), f(t + dt.timedelta(minutes=5)), "Síntoma sintético", modo, "CONFIRMADA", "Causa sintética", "Evidencia sintética", "Operador de turno", "Supervisor de producción", "", ""])
            nver += 1
            filas["Verificaciones"].append([f"VER-{nver:05d}", cp, f(tt), "APTO", "Supervisor de producción", ""])
            filas["Ordenes"].append([ot, "CORRECTIVA", eq, cp, "", f(t + dt.timedelta(minutes=6)), f(tt), "CERRADA", "Jefe de mantenimiento", "Correctivo " + modo])
            nint += 1
            filas["Intervenciones"].append([f"INT-{nint:05d}", ot, f(t), f(tt), "Técnico mecánico", "Intervención sintética", "SI" if usa else "NO", pz if usa else ""])
            if usa:
                nmov += 1
                filas["Movimientos"].append([f"MOV-{nmov:05d}", pz, "INGRESO", 1, f(rep_ini - dt.timedelta(minutes=1)), f(rep_ini), ot, "Reposición", "Jefe de almacén", ""])
                ncon += 1
                filas["Consumos"].append([f"CON-{ncon:05d}", ot, pz, 1, f(rep_ini), f(rep_ini + dt.timedelta(minutes=10)), "Jefe de almacén"])
            intervalos.setdefault(eq, []).append((t, tt))
            prev_fin = tt
            t = tt
    d = ini.replace(hour=0, minute=0)
    while d.date() <= fin.date():
        for eq in ["P-01", "M-01", "E-01"]:
            if d.weekday() == 6: h = 0.0
            else:
                w0, w1 = d.replace(hour=6), d.replace(hour=22)
                perd = sum(max(0, (min(b, w1) - max(a, w0)).total_seconds()) for a, b in intervalos.get(eq, [])) / 60
                h = round(max(0, 960 - perd) / 60, 2)
            filas["Horas_Operacion"].append([eq, d.strftime("%Y-%m-%d"), h])
        d += dt.timedelta(days=1)
    return filas

if __name__ == "__main__":
    salida = sys.argv[1]
    variante = sys.argv[2] if len(sys.argv) > 2 else None
    filas, saldo = construir()
    if variante == "--volumen":
        anios = int(sys.argv[3]) if len(sys.argv) > 3 else 5
        filas = construir_volumen(anios); variante = None
        PERIODO[0] = (dt.datetime(2026 - anios, 11, 16)).strftime("%Y-%m-%d")
    if variante == "--denominador":
        filas = construir_denominador(); variante = None
        PERIODO[0], PERIODO[1] = "2026-10-01", "2026-10-31"
    if variante == "--ref-invalida":
        filas["Consumos"][3][2] = "0999"  # pieza inexistente
        variante = "ref_invalida"
    elif variante == "--sin-unidades":
        variante = "sin_unidades"
    escribir(salida, filas, variante)
    print("Saldos finales:", saldo)
    print({k: len(v) for k, v in filas.items()})
