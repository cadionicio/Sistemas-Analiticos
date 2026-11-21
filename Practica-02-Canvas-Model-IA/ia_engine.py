# -*- coding: utf-8 -*-
"""
CANVAS MODEL IA - Motor de Inteligencia Artificial (ia_engine.py)
------------------------------------------------------------------
Formulación asistida del Canvas AS IS y TO BE, validación de reglas de
integridad, comparación de versiones, cálculo y priorización de brechas,
propuesta de proyectos y de diagrama de Gantt.

Motor por defecto: LOCAL (base de conocimiento sectorial + reglas), funciona
sin internet. Motor opcional: LLM compatible con la API de OpenAI o de
Anthropic, SIN herramientas de búsqueda web; su salida se valida contra un
esquema JSON y, si falla, se usa el motor local.

Toda salida de IA se marca como origen='IA' y naturaleza='Hipótesis' y
requiere revisión y aprobación humana.
"""
from __future__ import annotations

import difflib
import json
import re
from datetime import date, timedelta

BLOQUES = {
    "RK": "Socios clave", "AC": "Actividades clave", "SK": "Recursos clave",
    "PV": "Propuesta de valor", "RC": "Relaciones con clientes", "CH": "Canales",
    "SC": "Segmentos de clientes", "EC": "Estructura de costos", "FI": "Fuentes de ingresos",
}
ORDEN_BLOQUES = ["SC", "PV", "CH", "RC", "FI", "RK", "AC", "SK", "EC"]
RESPONSABLE_BLOQUE = {
    "SC": "Gerente Comercial", "PV": "Gerente General", "CH": "Gerente Comercial",
    "RC": "Jefe de Servicio al Cliente", "FI": "Gerente de Finanzas", "RK": "Jefe de Compras",
    "AC": "Jefe de Operaciones", "SK": "Jefe de Operaciones", "EC": "Gerente de Finanzas",
}

# ----------------------------------------------------------------------------
# Base de conocimiento sectorial (AS IS típico por sector)
# ----------------------------------------------------------------------------
KB_ASIS = {
    "Industrial": {
        "SC": ["Distribuidores y mayoristas nacionales", "Clientes industriales con compras recurrentes"],
        "PV": ["Productos estandarizados a precio competitivo", "Capacidad de producir por volumen"],
        "CH": ["Fuerza de ventas directa", "Distribuidores regionales"],
        "RC": ["Atención reactiva ante pedidos y reclamos"],
        "FI": ["Venta de productos por volumen con crédito comercial"],
        "RK": ["Proveedores locales de materia prima", "Transportistas tercerizados"],
        "AC": ["Producción y control de calidad al final de la línea", "Compras de insumos"],
        "SK": ["Planta y maquinaria", "Personal operario con experiencia"],
        "EC": ["Materia prima y mano de obra directa", "Mermas y retrabajos no medidos"],
    },
    "Comercial": {
        "SC": ["Clientes del entorno geográfico cercano", "Compradores frecuentes de bajo ticket"],
        "PV": ["Cercanía, surtido y atención personalizada", "Precios accesibles"],
        "CH": ["Punto de venta físico"],
        "RC": ["Trato personal sin registro de clientes"],
        "FI": ["Venta de mercadería al contado"],
        "RK": ["Distribuidores y mayoristas"],
        "AC": ["Compra y reposición de mercadería", "Atención en tienda"],
        "SK": ["Local comercial", "Inventario de mercadería"],
        "EC": ["Costo de mercadería", "Alquiler y servicios", "Mermas por vencimiento no medidas"],
    },
    "Servicios": {
        "SC": ["Empresas que contratan servicios por evento", "Clientes referidos"],
        "PV": ["Servicio especializado a demanda", "Experiencia del equipo profesional"],
        "CH": ["Referidos y visitas comerciales"],
        "RC": ["Atención por teléfono y correo"],
        "FI": ["Cobro por hora o por servicio prestado"],
        "RK": ["Proveedores de tecnología y licencias"],
        "AC": ["Prestación del servicio en sitio", "Gestión comercial"],
        "SK": ["Personal profesional certificado", "Herramientas y conocimiento técnico"],
        "EC": ["Planilla profesional", "Movilidad y viáticos"],
    },
}

# Reglas de transformación TO BE: (patrón en el AS IS) -> (texto TO BE, tipo, KPI sugerido)
REGLAS_TOBE = [
    (r"venta.*(presencial|directa|campo)|fuerza de ventas", "Canal digital de autoservicio + ventas consultivas", "Modificar", "% pedidos digitales"),
    (r"punto de venta f[ií]sico|mostrador|tienda", "Punto de venta físico + pedidos por mensajería y delivery", "Modificar", "Pedidos digitales/mes"),
    (r"referidos", "Referidos + web con cotizador en línea y marketing digital", "Modificar", "Leads digitales/mes"),
    (r"reactiv|reclamo|sin registro|trato personal", "Gestión de relación con CRM, fidelización y alertas de recompra", "Modificar", "Tasa de recompra"),
    (r"tel[eé]fono|llamada|correo", "Mesa de ayuda con tickets, SLA y encuesta NPS", "Modificar", "% cumplimiento SLA"),
    (r"por hora|por evento|por servicio", "Suscripción mensual con niveles de servicio", "Modificar", "Ingreso recurrente mensual"),
    (r"contado", "Cobro al contado y con pagos digitales / QR", "Modificar", "% ventas con pago digital"),
    (r"no medid", "Medición mensual por causa con tablero de control", "Modificar", "% merma / retrabajo"),
    (r"control de calidad al final|producci[oó]n", "Producción con control estadístico de procesos y trazabilidad por lote", "Modificar", "% retrabajo"),
    (r"reposici[oó]n|compra", "Reposición basada en pronóstico de demanda", "Modificar", "% quiebre de stock"),
    (r"proveedores locales|distribuidores y mayoristas|mayoristas", "Proveedores homologados con acuerdos de nivel de servicio", "Modificar", "OTIF de proveedores"),
    (r"en sitio", "Monitoreo remoto y mantenimiento preventivo", "Modificar", "% incidentes preventivos"),
    (r"planta|maquinaria|local|inventario", None, "Mantener", None),
    (r"personal|equipo|planilla", "Personal capacitado en herramientas digitales", "Modificar", "Horas de capacitación"),
]

# Nuevos elementos (Crear) por sector y tipo de escenario
KB_CREAR = {
    "Industrial": [("SC", "Clientes de exportación en nichos sostenibles"), ("FI", "Servicios de maquila y desarrollo de producto"),
                   ("SK", "ERP de producción e inteligencia de negocios"), ("AC", "Gestión de mermas y mejora continua")],
    "Comercial": [("CH", "Catálogo y pedidos por WhatsApp / redes sociales"), ("SK", "Sistema POS con control de inventario"),
                  ("FI", "Comisiones por servicios de agente (recargas y pagos)"), ("SC", "Negocios vecinos como clientes mayoristas")],
    "Servicios": [("SC", "Nuevo vertical especializado (salud / educación)"), ("SK", "Plataforma de monitoreo remoto y mesa de ayuda"),
                  ("RK", "Alianza con proveedor de nube"), ("FI", "Servicios gestionados por suscripción")],
}
KB_CREAR_EXTRA = {  # escenario optimista: expansión
    "Industrial": [("CH", "Marketplace B2B internacional")],
    "Comercial": [("RC", "Programa de puntos de fidelidad")],
    "Servicios": [("CH", "Web con cotizador y agenda en línea")],
}

# Plantillas de proyectos por bloque
PLANTILLA_PROYECTO = {
    "CH": ("Implementación de canal digital", "Digitalizar la venta y medir la adopción", "% pedidos digitales", "%",
           ["Levantamiento de requisitos", "Diseño de la experiencia", "Desarrollo e integración", "Piloto con clientes", "Despliegue y capacitación"]),
    "RC": ("Programa de gestión de relación con clientes", "Elevar la recompra y la satisfacción", "Tasa de recompra", "%",
           ["Segmentación de clientes", "Configuración de CRM", "Campañas de fidelización", "Seguimiento y ajuste"]),
    "EC": ("Sistema de medición y reducción de costos", "Medir y reducir costos por causa", "% merma / retrabajo", "%",
           ["Diagnóstico de causas", "Diseño del registro", "Implementación de controles", "Capacitación", "Estabilización"]),
    "SC": ("Piloto de nuevo segmento", "Validar la demanda del nuevo segmento", "Clientes nuevos del segmento", "clientes",
           ["Investigación del segmento", "Propuesta y muestras", "Primeras ventas", "Evaluación del experimento"]),
    "FI": ("Nuevo modelo de ingresos", "Aumentar el ingreso recurrente", "Ingreso recurrente mensual", "S/",
           ["Diseño de la oferta y precios", "Ajuste de contratos", "Migración de clientes", "Campaña comercial", "Consolidación"]),
    "PV": ("Rediseño de la propuesta de valor", "Diferenciar la oferta con evidencia", "NPS", "puntos",
           ["Entrevistas a clientes", "Prototipo de propuesta", "Prueba con clientes", "Lanzamiento"]),
    "RK": ("Desarrollo de socios clave", "Asegurar socios con acuerdos de nivel de servicio", "OTIF de proveedores", "%",
           ["Evaluación de socios", "Negociación de acuerdos", "Implementación", "Evaluación de desempeño"]),
    "AC": ("Mejora de procesos clave", "Estandarizar y medir actividades clave", "Tiempo de ciclo", "días",
           ["Mapeo del proceso", "Rediseño", "Implementación", "Control"]),
    "SK": ("Implementación de recurso tecnológico", "Dotar a la organización del recurso clave", "% uso del sistema", "%",
           ["Selección de solución", "Configuración y carga de datos", "Capacitación", "Operación asistida"]),
}
PRESUPUESTO_BASE = {"Micro": 3000, "Pequeña": 25000, "Mediana": 60000, "Grande": 150000}


# ----------------------------------------------------------------------------
# Formulación AS IS
# ----------------------------------------------------------------------------
def formular_asis(org: dict, kpis: list[dict] | None = None) -> list[dict]:
    """Propone un Canvas AS IS con 1-3 elementos por bloque según sector, tamaño y madurez."""
    sector = org.get("sector") or "Comercial"
    tamano = org.get("tamano") or "Pequeña"
    madurez = int(org.get("madurez_digital") or 1)
    kb = KB_ASIS.get(sector, KB_ASIS["Comercial"])
    limite = 1 if tamano == "Micro" else 2
    elementos: list[dict] = []
    for b in ORDEN_BLOQUES:
        for texto in kb[b][:limite]:
            elementos.append(_elem(b, texto, "Hipótesis", "Base de conocimiento sectorial (IA)", "Baja", "N/A"))
    ventas = float(org.get("ventas_anuales_pen") or 0)
    if ventas > 0:
        elementos.append(_elem("FI", f"Ventas anuales de S/ {ventas:,.0f} ({tamano})", "Hecho",
                               "Dato registrado de la organización", "Alta", "N/A", fuente="Registro de organización"))
    if madurez <= 2:
        elementos.append(_elem("AC", "Procesos mayormente manuales (madurez digital baja)", "Hipótesis",
                               f"Madurez digital declarada = {madurez}/5", "Media", "N/A"))
    for k in (kpis or [])[:3]:
        elementos.append(_elem("AC", f"Se mide el KPI '{k.get('nombre')}' (línea base {k.get('linea_base')})", "Hecho",
                               "KPI registrado en el sistema", "Alta", "N/A", fuente="Tabla kpi"))
    return elementos


def _elem(bloque: str, texto: str, naturaleza: str, evidencia: str, confianza: str, tipo: str,
          origen_id: str | None = None, fuente: str = "Motor IA local") -> dict:
    return {"bloque": bloque, "descripcion": texto, "naturaleza": naturaleza, "evidencia": evidencia,
            "fuente": fuente, "confianza": confianza, "responsable": RESPONSABLE_BLOQUE[bloque],
            "tipo_cambio": tipo, "elemento_origen_id": origen_id, "origen": "IA"}


# ----------------------------------------------------------------------------
# Formulación TO BE
# ----------------------------------------------------------------------------
def transformar(texto: str) -> tuple[str, str, str | None]:
    """Aplica las reglas de transformación a un elemento AS IS."""
    t = texto.lower()
    for patron, nuevo, tipo, kpi in REGLAS_TOBE:
        if re.search(patron, t):
            return (nuevo or texto), tipo, kpi
    return texto, "Mantener", None


def formular_tobe(org: dict, asis: list[dict], escenario: dict | None = None) -> list[dict]:
    """Propone un Canvas TO BE a partir del AS IS aprobado y del escenario."""
    sector = org.get("sector") or "Comercial"
    tipo_esc = (escenario or {}).get("tipo", "Base")
    salida: list[dict] = []
    for e in asis:
        nuevo, tipo, _kpi = transformar(e["descripcion"])
        if tipo_esc == "Pesimista" and tipo == "Modificar" and e["bloque"] in ("SC", "FI"):
            nuevo, tipo = e["descripcion"], "Mantener"  # prudencia: no se expande el negocio
        if e["bloque"] == "EC" and re.search(r"impreso|papel", e["descripcion"].lower()):
            nuevo, tipo = "[Eliminar] " + e["descripcion"], "Eliminar"
        salida.append(_elem(e["bloque"], nuevo, "Hipótesis" if tipo != "Mantener" else "Hecho",
                            f"Transformación sugerida por IA ({tipo_esc})", "Media" if tipo != "Mantener" else e.get("confianza", "Media"),
                            tipo, e.get("elemento_id")))
    existentes = {s["descripcion"].lower() for s in salida}
    nuevos = list(KB_CREAR.get(sector, []))
    if tipo_esc == "Optimista":
        nuevos += KB_CREAR_EXTRA.get(sector, [])
    if tipo_esc == "Pesimista":
        nuevos = nuevos[:1]
    for b, texto in nuevos:
        if texto.lower() not in existentes:
            salida.append(_elem(b, texto, "Hipótesis", f"Oportunidad sectorial ({tipo_esc})", "Baja", "Crear"))
    if tipo_esc == "Pesimista":
        salida.append(_elem("EC", "Programa de eficiencia y reducción de costos fijos", "Hipótesis",
                            "Respuesta a escenario pesimista", "Media", "Crear"))
    return salida


# ----------------------------------------------------------------------------
# Reglas de integridad (RN-01 ... RN-08)
# ----------------------------------------------------------------------------
def validar_reglas(elementos: list[dict], tipo: str, brechas: list[dict] | None = None) -> list[dict]:
    """Retorna hallazgos [{nivel, regla, mensaje}] para una versión del Canvas."""
    h: list[dict] = []
    por_bloque = {b: [e for e in elementos if e.get("bloque") == b] for b in ORDEN_BLOQUES}
    vacios = [BLOQUES[b] for b, v in por_bloque.items() if not v]
    if vacios:
        h.append({"nivel": "Error", "regla": "RN-08", "mensaje": "Bloques sin elementos: " + ", ".join(vacios)})
    if por_bloque["PV"] and not por_bloque["SC"]:
        h.append({"nivel": "Error", "regla": "RN-01", "mensaje": "La propuesta de valor no tiene segmento de clientes asociado"})
    for e in por_bloque["PV"]:
        if not (e.get("evidencia") or "").strip():
            h.append({"nivel": "Advertencia", "regla": "RN-01", "mensaje": f"Propuesta de valor sin evidencia: {e['descripcion'][:60]}"})
    for b in ("CH", "RC"):
        for e in por_bloque[b]:
            if not (e.get("responsable") or "").strip() and not (e.get("kpi_id") or "").strip():
                h.append({"nivel": "Advertencia", "regla": "RN-02", "mensaje": f"{BLOQUES[b]} sin responsable ni KPI: {e['descripcion'][:60]}"})
    for b in ("FI", "EC"):
        for e in por_bloque[b]:
            if not (e.get("fuente") or "").strip():
                h.append({"nivel": "Advertencia", "regla": "RN-03", "mensaje": f"{BLOQUES[b]} sin fuente: {e['descripcion'][:60]}"})
    if tipo == "TO BE":
        for e in elementos:
            if e.get("tipo_cambio") not in ("Crear", "Modificar", "Eliminar", "Mantener"):
                h.append({"nivel": "Error", "regla": "RN-04", "mensaje": f"Cambio sin clasificar: {e['descripcion'][:60]}"})
        if brechas is not None:
            materiales = [e for e in elementos if e.get("tipo_cambio") in ("Crear", "Modificar", "Eliminar")]
            cubiertos = {(b.get("bloque"), _norm(b.get("to_be"))) for b in brechas
                         if (b.get("proyecto_id") or (b.get("justificacion") or "").strip())}
            sin = [e for e in materiales if (e["bloque"], _norm(e["descripcion"])) not in cubiertos]
            if sin:
                h.append({"nivel": "Advertencia", "regla": "RN-05",
                          "mensaje": f"{len(sin)} cambio(s) material(es) aún sin proyecto ni justificación (se resuelve en 4. Brechas y proyectos)"})
    ia = [e for e in elementos if e.get("origen") == "IA"]
    if ia:
        h.append({"nivel": "Info", "regla": "IA", "mensaje": f"{len(ia)} elemento(s) generados por IA: requieren revisión humana"})
    if not h:
        h.append({"nivel": "OK", "regla": "-", "mensaje": "La versión cumple todas las reglas de integridad"})
    return h


def puede_aprobar(hallazgos: list[dict]) -> bool:
    return not any(x["nivel"] == "Error" for x in hallazgos)


def _norm(t: str | None) -> str:
    return re.sub(r"\s+", " ", (t or "").strip().lower())


# ----------------------------------------------------------------------------
# Comparación de versiones y brechas
# ----------------------------------------------------------------------------
def _similitud(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, _norm(a), _norm(b)).ratio()


def comparar(origen: list[dict], destino: list[dict]) -> list[dict]:
    """Empareja elementos de dos versiones y clasifica la diferencia por bloque."""
    filas: list[dict] = []
    usados: set = set()
    ids_origen = {e.get("elemento_id") for e in origen}
    for d in destino:
        match = None
        if d.get("elemento_origen_id") in ids_origen:
            match = next(o for o in origen if o.get("elemento_id") == d["elemento_origen_id"])
        else:
            cands = [(o, _similitud(o["descripcion"], d["descripcion"])) for o in origen
                     if o["bloque"] == d["bloque"] and o.get("elemento_id") not in usados]
            cands = [c for c in cands if c[1] >= 0.6]
            if cands:
                match = max(cands, key=lambda c: c[1])[0]
        if match is not None:
            usados.add(match.get("elemento_id"))
            if d.get("tipo_cambio") in ("Eliminar",):
                tipo = "Eliminar"
            elif _norm(match["descripcion"]) == _norm(d["descripcion"]):
                tipo = "Mantener"
            else:
                tipo = d.get("tipo_cambio") if d.get("tipo_cambio") in ("Modificar", "Mantener") else "Modificar"
            filas.append({"bloque": d["bloque"], "as_is": match["descripcion"], "to_be": d["descripcion"], "tipo_cambio": tipo})
        else:
            filas.append({"bloque": d["bloque"], "as_is": "(no existe)", "to_be": d["descripcion"],
                          "tipo_cambio": "Eliminar" if d.get("tipo_cambio") == "Eliminar" else "Crear"})
    for o in origen:
        if o.get("elemento_id") not in usados and not any(f["as_is"] == o["descripcion"] for f in filas):
            filas.append({"bloque": o["bloque"], "as_is": o["descripcion"], "to_be": "(se elimina)", "tipo_cambio": "Eliminar"})
    orden = {b: i for i, b in enumerate(ORDEN_BLOQUES)}
    return sorted(filas, key=lambda f: orden.get(f["bloque"], 99))


IMPACTO_BLOQUE = {"PV": 5, "SC": 5, "FI": 5, "CH": 4, "RC": 4, "EC": 4, "AC": 3, "SK": 3, "RK": 3}


def score(impacto: int, esfuerzo: int, riesgo: int) -> float:
    """Score de priorización 20-100: ((2*impacto)+(6-esfuerzo)+(6-riesgo))/4*20."""
    return round(((2 * int(impacto)) + (6 - int(esfuerzo)) + (6 - int(riesgo))) / 4 * 20, 1)


def prioridad(s: float, alta: float = 75, media: float = 55) -> str:
    return "Alta" if s >= alta else ("Media" if s >= media else "Baja")


def calcular_brechas(asis: list[dict], tobe: list[dict], tamano: str = "Pequeña") -> list[dict]:
    """Genera la matriz de brechas con impacto, esfuerzo, riesgo, score y prioridad."""
    salida = []
    for f in comparar(asis, tobe):
        if f["tipo_cambio"] == "Mantener":
            continue
        imp = IMPACTO_BLOQUE.get(f["bloque"], 3)
        esf = {"Crear": 4, "Modificar": 3, "Eliminar": 1}[f["tipo_cambio"]]
        rie = {"Crear": 4, "Modificar": 2, "Eliminar": 1}[f["tipo_cambio"]]
        if f["tipo_cambio"] == "Eliminar":
            imp = max(1, imp - 3)
        if tamano == "Micro" and f["tipo_cambio"] == "Crear":
            esf = max(1, esf - 2)
        s = score(imp, esf, rie)
        salida.append({**f, "impacto": imp, "esfuerzo": esf, "riesgo": rie, "score": s, "prioridad": prioridad(s),
                       "justificacion": "Cambio operativo menor; no requiere proyecto" if f["tipo_cambio"] == "Eliminar" else ""})
    return sorted(salida, key=lambda x: -x["score"])


# ----------------------------------------------------------------------------
# Propuesta de proyectos y Gantt
# ----------------------------------------------------------------------------
def proponer_proyecto(brecha: dict, org: dict, inicio: date | None = None) -> dict:
    """Convierte una brecha en un proyecto/experimento propuesto con KPI e hitos."""
    b = brecha.get("bloque", "AC")
    nombre, objetivo, kpi, unidad, tareas = PLANTILLA_PROYECTO.get(b, PLANTILLA_PROYECTO["AC"])
    _, _, kpi_regla = transformar(brecha.get("as_is") or "")
    kpi = kpi_regla or kpi
    tipo = "Experimento" if brecha.get("tipo_cambio") == "Crear" and int(brecha.get("riesgo") or 3) >= 4 else "Proyecto"
    esfuerzo = int(brecha.get("esfuerzo") or 3)
    meses = 2 + esfuerzo * 2 if tipo == "Proyecto" else 3 + esfuerzo
    base = PRESUPUESTO_BASE.get(org.get("tamano"), 25000)
    presupuesto = round(base * (0.6 + 0.35 * esfuerzo), -2)
    inicio = inicio or (date.today().replace(day=1) + timedelta(days=32)).replace(day=1)
    fin = _sumar_meses(inicio, meses) - timedelta(days=1)
    return {
        "nombre": f"{nombre}: {str(brecha.get('to_be'))[:60]}",
        "tipo": tipo,
        "objetivo": f"{objetivo} ({BLOQUES.get(b, b)})",
        "responsable": RESPONSABLE_BLOQUE.get(b, "Gerente General"),
        "sponsor": "Gerente General",
        "presupuesto_pen": presupuesto,
        "fecha_inicio": inicio.isoformat(),
        "fecha_fin": fin.isoformat(),
        "estado": "Propuesto",
        "kpi_principal": None,
        "criterio_parada": ("Cancelar si no hay evidencia de demanda a la mitad del plazo" if tipo == "Experimento"
                            else "Escalar si SPI < 0,85 durante dos meses"),
        "_kpi_sugerido": {"nombre": kpi, "unidad": unidad},
        "_tareas": tareas,
    }


def _sumar_meses(d: date, meses: int) -> date:
    m = d.month - 1 + meses
    y = d.year + m // 12
    return date(y, m % 12 + 1, 1)


def proponer_hitos(proyecto_id: str, tareas: list[str], inicio: str, fin: str, responsable: str) -> list[dict]:
    """Distribuye las tareas en el plazo del proyecto con dependencias fin-inicio."""
    di, df = date.fromisoformat(inicio), date.fromisoformat(fin)
    total = max((df - di).days + 1, len(tareas))
    tramo = total / len(tareas)
    hitos, prev = [], None
    for i, t in enumerate(tareas):
        s = di + timedelta(days=round(tramo * i))
        e = df if i == len(tareas) - 1 else di + timedelta(days=round(tramo * (i + 1)) - 1)
        hid = f"{proyecto_id}-H{i + 1}"
        hitos.append({"hito_id": hid, "proyecto_id": proyecto_id, "tarea": t, "responsable": responsable,
                      "fecha_inicio": s.isoformat(), "fecha_fin": max(e, s).isoformat(), "dependencia": prev,
                      "peso_pct": round(100 / len(tareas), 1), "avance_plan_pct": 0, "avance_real_pct": 0,
                      "estado_aprobacion": "Propuesto", "version_gantt": 1})
        prev = hid
    return hitos


def proponer_gantt(proyectos: list[dict], inicio_portafolio: date | None = None, capacidad_paralela: int = 2) -> list[dict]:
    """Secuencia el portafolio por prioridad respetando una capacidad de proyectos en paralelo."""
    inicio = inicio_portafolio or (date.today().replace(day=1) + timedelta(days=32)).replace(day=1)
    carriles = [inicio] * max(1, capacidad_paralela)
    plan = []
    for p in sorted(proyectos, key=lambda x: -(x.get("score") or 0)):
        try:
            dur = (date.fromisoformat(p["fecha_fin"]) - date.fromisoformat(p["fecha_inicio"])).days
        except (TypeError, ValueError, KeyError):
            dur = 120
        k = min(range(len(carriles)), key=lambda i: carriles[i])
        s = carriles[k]
        e = s + timedelta(days=dur)
        carriles[k] = e + timedelta(days=1)
        plan.append({"proyecto_id": p["proyecto_id"], "fecha_inicio": s.isoformat(), "fecha_fin": e.isoformat()})
    return plan


# ----------------------------------------------------------------------------
# Motor LLM opcional (sin motores de búsqueda)
# ----------------------------------------------------------------------------
PROMPT_SISTEMA = (
    "Eres un consultor experto en Business Model Canvas para empresas peruanas. "
    "Responde SOLO con JSON válido: {\"elementos\": [{\"bloque\": \"SC|PV|CH|RC|FI|RK|AC|SK|EC\", "
    "\"descripcion\": str, \"naturaleza\": \"Hecho|Hipótesis|Supuesto\", \"tipo_cambio\": \"Crear|Modificar|Eliminar|Mantener|N/A\"}]}. "
    "No inventes datos: todo lo no sustentado es 'Hipótesis'. No uses herramientas de búsqueda."
)


def llm_formular(org: dict, tipo: str, cfg: dict, contexto: list[dict] | None = None,
                 escenario: dict | None = None) -> list[dict]:
    """Llama a un LLM (OpenAI-compatible o Anthropic). Lanza excepción si falla (el llamador usa el motor local)."""
    import urllib.request

    usuario = json.dumps({"organizacion": {k: org.get(k) for k in ("razon_social", "sector", "tamano", "madurez_digital")},
                          "tipo_canvas": tipo, "escenario": escenario,
                          "as_is": [{"bloque": e["bloque"], "descripcion": e["descripcion"]} for e in (contexto or [])]},
                         ensure_ascii=False)
    proveedor = cfg.get("proveedor", "OpenAI compatible")
    if proveedor == "Anthropic":
        url = cfg.get("url") or "https://api.anthropic.com/v1/messages"
        body = {"model": cfg["modelo"], "max_tokens": 2000, "system": PROMPT_SISTEMA,
                "messages": [{"role": "user", "content": usuario}]}
        headers = {"x-api-key": cfg["api_key"], "anthropic-version": "2023-06-01", "content-type": "application/json"}
    else:
        url = cfg.get("url") or "https://api.openai.com/v1/chat/completions"
        body = {"model": cfg["modelo"], "temperature": 0.2,
                "messages": [{"role": "system", "content": PROMPT_SISTEMA}, {"role": "user", "content": usuario}]}
        headers = {"Authorization": f"Bearer {cfg['api_key']}", "Content-Type": "application/json"}
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:  # noqa: S310 (URL configurada por el administrador)
        data = json.loads(r.read().decode("utf-8"))
    texto = data["content"][0]["text"] if proveedor == "Anthropic" else data["choices"][0]["message"]["content"]
    m = re.search(r"\{.*\}", texto, re.S)
    return validar_salida_llm(json.loads(m.group(0) if m else texto), tipo)


def validar_salida_llm(obj: dict, tipo: str) -> list[dict]:
    """Valida el JSON del LLM contra el esquema; descarta elementos inválidos."""
    if not isinstance(obj, dict) or not isinstance(obj.get("elementos"), list):
        raise ValueError("Salida del LLM sin la lista 'elementos'")
    salida = []
    for e in obj["elementos"]:
        if not isinstance(e, dict) or e.get("bloque") not in BLOQUES or not str(e.get("descripcion", "")).strip():
            continue
        tc = e.get("tipo_cambio") if tipo == "TO BE" else "N/A"
        if tc not in ("Crear", "Modificar", "Eliminar", "Mantener", "N/A"):
            tc = "Modificar" if tipo == "TO BE" else "N/A"
        salida.append(_elem(e["bloque"], str(e["descripcion"])[:300], "Hipótesis", "Propuesta de LLM (sin búsqueda web)",
                            "Baja", tc, fuente="LLM externo"))
    if len({e["bloque"] for e in salida}) < 9:
        raise ValueError("La salida del LLM no cubre los 9 bloques")
    return salida
