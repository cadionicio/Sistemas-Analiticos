# -*- coding: utf-8 -*-
"""
motor_ia.py - Capa de inteligencia local (sin motores de búsqueda externos).

Funciones de la guía BSC-IA 2027: DESCRIBIR, PREDECIR, PRESCRIBIR y EXPLICAR.
Implementación: base de conocimiento metodológica (Kaplan y Norton; guía 2027) +
reglas de coincidencia con el diagnóstico de la empresa + plantillas de redacción
+ pronóstico estadístico. Toda salida queda en estado «Propuesto» hasta que una
persona la revise y apruebe (control humano).
"""
from __future__ import annotations

import datetime as dt
import re
import unicodedata

import numpy as np
import pandas as pd

import config
import finanzas as fz

ORIGEN = "IA-GCE"


def _norm(t) -> str:
    t = unicodedata.normalize("NFKD", str(t or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", t)


def _txt(v, defecto=""):
    return defecto if v is None or (isinstance(v, float) and np.isnan(v)) or str(v).strip() in ("", "None", "nan") else str(v).strip()


# ============================================================ Identidad
PRUEBAS_MISION = [
    ("Relevancia", "¿Resuelve un trabajo importante del cliente?", ["cliente_prioritario", "necesidad_critica"]),
    ("Diferenciación", "¿Explica por qué elegirnos?", ["oferta_diferenciada", "capacidades_distintivas"]),
    ("Credibilidad", "¿Tenemos capacidades para cumplirla?", ["capacidades_distintivas"]),
    ("Medición", "¿Puede observarse el resultado?", ["resultado_verificable"]),
    ("Economía / principios", "¿Declara límites y principios?", ["principios_limites"]),
]
COMPONENTES_MISION = ["cliente_prioritario", "necesidad_critica", "oferta_diferenciada",
                      "resultado_verificable", "capacidades_distintivas", "principios_limites"]


def proponer_misiones(ident: dict) -> list[dict]:
    """Tres alternativas de misión (fórmula de 6 componentes de la guía, p. 7)."""
    c = {k: _txt(ident.get(k), f"[{k.replace('_', ' ')}]") for k in COMPONENTES_MISION}
    alternativas = [
        ("Fórmula completa",
         f"Para {c['cliente_prioritario']}, resolvemos {c['necesidad_critica']} mediante {c['oferta_diferenciada']}, "
         f"generando {c['resultado_verificable']}, gracias a {c['capacidades_distintivas']}, con {c['principios_limites']}."),
        ("Centrada en el cliente",
         f"Ayudamos a {c['cliente_prioritario']} a {c['necesidad_critica']} con {c['oferta_diferenciada']}, "
         f"respaldados por {c['capacidades_distintivas']} y comprometidos con {c['principios_limites']}."),
        ("Centrada en el resultado",
         f"Existimos para que {c['cliente_prioritario']} logre {c['resultado_verificable']}: "
         f"resolvemos {c['necesidad_critica']} mediante {c['oferta_diferenciada']}, gracias a {c['capacidades_distintivas']}."),
    ]
    faltan = [k for k in COMPONENTES_MISION if not _txt(ident.get(k))]
    salida = []
    for nombre, texto in alternativas:
        evaluacion = []
        for prueba, pregunta, campos in PRUEBAS_MISION:
            ok = all(_txt(ident.get(x)) for x in campos)
            evaluacion.append({"prueba": prueba, "pregunta": pregunta, "cumple": "Sí" if ok else "Falta evidencia"})
        salida.append({"enfoque": nombre, "mision": texto, "palabras": len(texto.split()),
                       "evaluacion": evaluacion, "componentes_faltantes": faltan,
                       "riesgo": "Promesa excesiva: verifique con KPI de cliente y proceso." if len(texto.split()) > 55 else "Extensión adecuada."})
    return salida


def proponer_vision(empresa: dict, ident: dict, horizonte: int | None = None) -> str:
    anio = horizonte or (int(empresa.get("anio_base") or dt.date.today().year) + 4)
    cliente = _txt(ident.get("cliente_prioritario"), "nuestros clientes prioritarios")
    return (f"Al {anio}, ser la organización más confiable del Perú para {cliente}, "
            f"reconocida por {_txt(ident.get('resultado_verificable'), 'resultados verificables')} "
            f"y con un ROIC sostenido superior al WACC.")


def proponer_valores(ident: dict) -> str:
    base = ["Orientación al cliente", "Integridad", "Excelencia", "Innovación responsable", "Trabajo en equipo"]
    p = _norm(ident.get("principios_limites"))
    if "segur" in p:
        base.insert(2, "Seguridad")
    if "sosten" in p:
        base.append("Sostenibilidad")
    return "; ".join(dict.fromkeys(base))


# ============================================================ Diagnóstico
PESTEL_BASE = [
    ("Político", "Marco nacional de IA (Ley 31814 y su reglamento D.S. 115-2025-PCM)", "Clasificar casos de IA y documentar expedientes"),
    ("Económico", "Volatilidad de tipo de cambio, tasas e inflación", "Escenarios y gatillos de caja, precio y capital"),
    ("Social", "Clientes más exigentes en experiencia, rapidez y trazabilidad", "Reforzar la propuesta de valor medible"),
    ("Tecnológico", "Adopción acelerada de IA generativa y analítica", "Formación y copilotos con datos certificados"),
    ("Ecológico", "Presión por sostenibilidad y economía circular", "Incorporar metas ambientales en procesos"),
    ("Legal", "Protección de datos personales (Ley 29733, D.S. 016-2024-JUS)", "Privacidad por diseño y control de accesos"),
]
FODA_BASE = [
    ("Fortaleza", "Relación de confianza con clientes clave"),
    ("Debilidad", "Datos dispersos y pocos indicadores certificados"),
    ("Oportunidad", "Uso de IA para mejorar pronóstico, precio y servicio"),
    ("Amenaza", "Competidores con precios agresivos"),
]


def proponer_diagnostico_base(empresa_id: str) -> pd.DataFrame:
    filas = [{"empresa_id": empresa_id, "tipo": "PESTEL", "categoria": c, "descripcion": d, "fuente": "Plantilla IA (validar)",
              "impacto": "Medio", "implicancia_decision": i} for c, d, i in PESTEL_BASE]
    filas += [{"empresa_id": empresa_id, "tipo": "FODA", "categoria": c, "descripcion": d, "fuente": "Plantilla IA (validar)",
               "impacto": "Medio", "implicancia_decision": ""} for c, d in FODA_BASE]
    return pd.DataFrame(filas)


def resumen_diagnostico(diag: pd.DataFrame) -> dict:
    if diag.empty:
        return {"hechos": 0, "pestel": 0, "foda": {}, "alto_impacto": 0, "brechas": ["Sin diagnóstico registrado"]}
    foda = diag[diag["tipo"] == "FODA"]["categoria"].value_counts().to_dict()
    pest = set(diag[diag["tipo"] == "PESTEL"]["categoria"])
    brechas = [f"PESTEL sin factor {x}" for x in ["Político", "Económico", "Social", "Tecnológico", "Ecológico", "Legal"] if x not in pest]
    brechas += [f"FODA sin {x}" for x in ["Fortaleza", "Debilidad", "Oportunidad", "Amenaza"] if x not in foda]
    hechos = int((diag["tipo"] == "HECHO").sum())
    if hechos < 5:
        brechas.append(f"Solo {hechos} hechos críticos (se recomiendan hasta 10 con evidencia cuantitativa)")
    sin_fuente = int(diag["fuente"].isna().sum())
    if sin_fuente:
        brechas.append(f"{sin_fuente} registros sin fuente: son hipótesis, no hechos")
    return {"hechos": hechos, "pestel": len(pest), "foda": foda,
            "alto_impacto": int((diag["impacto"] == "Alto").sum()), "brechas": brechas}


# ============================================================ Estrategias
def proponer_estrategias(empresa_id: str, diag: pd.DataFrame, tipo_empresa: str = "") -> pd.DataFrame:
    """Matriz FODA cruzada (FO, DO, FA, DA) + apuestas y renuncias."""
    def items(cat):
        d = diag[(diag["tipo"] == "FODA") & (diag["categoria"] == cat)]
        return [_txt(x).rstrip(".") for x in d["descripcion"]][:3]
    F, D, O, A = items("Fortaleza"), items("Debilidad"), items("Oportunidad"), items("Amenaza")
    filas = []

    def add(tipo, texto, pr):
        filas.append({"empresa_id": empresa_id, "tipo": tipo, "descripcion": texto, "origen": ORIGEN,
                      "prioridad": pr, "estado": "Propuesto"})
    for i, (f, o) in enumerate([(f, o) for f in F for o in O][:3]):
        add("FO", f"Aprovechar «{f.lower()}» para capturar «{o.lower()}».", i + 1)
    for i, (d_, o) in enumerate([(d_, o) for d_ in D for o in O][:2]):
        add("DO", f"Superar «{d_.lower()}» aprovechando «{o.lower()}».", i + 1)
    for i, (f, a) in enumerate([(f, a) for f in F for a in A][:2]):
        add("FA", f"Usar «{f.lower()}» para mitigar «{a.lower()}».", i + 1)
    for i, (d_, a) in enumerate([(d_, a) for d_ in D for a in A][:2]):
        add("DA", f"Reducir «{d_.lower()}» para limitar la exposición a «{a.lower()}».", i + 1)
    hechos = diag[(diag["tipo"] == "HECHO")]
    hechos = hechos.assign(_o=hechos["impacto"].map({"Alto": 0, "Medio": 1, "Bajo": 2}).fillna(3)).sort_values("_o")
    for i, r in enumerate(hechos.head(5).itertuples()):
        acc = _txt(r.implicancia_decision) or f"Actuar sobre: {_txt(r.descripcion)}"
        add("Apuesta", f"{acc} (evidencia: {_txt(r.descripcion)}).", i + 1)
    renuncias = {
        "Industrial": ["Pedidos pequeños no rentables sin precio diferenciado", "Personalizaciones sin margen mínimo"],
        "Comercial": ["SKU de baja rotación y bajo margen", "Descuentos no autorizados"],
        "Servicios": ["Contratos sin SLA rentable", "Atenciones fuera de zona sin tarifa"],
    }.get(tipo_empresa, ["Proyectos sin caso de negocio ni dueño", "Clientes que destruyen valor de forma persistente"])
    for i, t in enumerate(renuncias):
        add("Renuncia", t + ".", i + 1)
    if not filas:
        add("Apuesta", "Complete el FODA y los hechos críticos para generar estrategias específicas.", 1)
    return pd.DataFrame(filas)


def generica_sugerida(diag: pd.DataFrame, tipo_empresa: str) -> tuple[str, str]:
    """Sugiere la estrategia genérica de Kaplan y Norton según el diagnóstico."""
    t = _norm(" ".join(diag["descripcion"].astype(str)) + " " + " ".join(diag["implicancia_decision"].astype(str))) if not diag.empty else ""
    puntos = {
        "Excelencia operativa": sum(t.count(k) for k in ["costo", "oee", "inventario", "parada", "eficien", "productiv", "otif"]),
        "Intimidad con el cliente": sum(t.count(k) for k in ["cliente", "retencion", "reclamo", "experiencia", "servicio", "sla"]),
        "Liderazgo de producto": sum(t.count(k) for k in ["innovacion", "nuevo", "producto", "tecnolog", "lanzamiento"]),
    }
    g = max(puntos, key=puntos.get)
    razon = ", ".join(f"{k}: {v}" for k, v in puntos.items())
    return g, f"Coincidencias en el diagnóstico → {razon}"


# ============================================================ Base de conocimiento del BSC
# Cada plantilla: perspectiva, nombre, descripción, responsable, palabras clave, tipos de empresa,
# destinos causales, KPI (1-2) e iniciativa sugerida.
K = lambda **kw: kw  # noqa: E731
CATALOGO = [
    # ------------------------------------------------ Financiera
    K(clave="F_CREC", p="Financiera", nombre="Crecer ingresos rentables", desc="Crecimiento de ventas con margen mínimo",
      resp="Gerente General / Comercial", kw=["crecim", "venta", "ingreso", "mercado"], siempre=True, dest=["F_EVA"],
      kpis=[K(nombre="Crecimiento de ventas con margen ≥ piso", formula="(Ventas año / Ventas año anterior) − 1", unidad="%",
              sentido="MAX", fin="crecimiento", tol=0.10, frec="Mensual", fuente="ERP Ventas", tipo="Resultado")]),
    K(clave="F_MARG", p="Financiera", nombre="Elevar el margen EBIT", desc="Mejorar margen por precio, mezcla y costo",
      resp="Gerente de Finanzas", kw=["margen", "costo", "precio", "descuento"], siempre=True, dest=["F_EVA"],
      kpis=[K(nombre="Margen EBIT", formula="EBIT / Ventas", unidad="%", sentido="MAX", fin="margen", tol=0.05,
              frec="Mensual", fuente="Estados financieros", tipo="Resultado")]),
    K(clave="F_EVA", p="Financiera", nombre="Mejorar el ROIC y crear valor (EVA)", desc="ROIC superior al WACC y EVA creciente",
      resp="Gerente de Finanzas", kw=["eva", "roic", "wacc", "valor"], siempre=True, dest=[],
      kpis=[K(nombre="EVA acumulado del año", formula="Σ (NOPAT − WACC/12 × Capital invertido)", unidad="S/ m",
              sentido="MAX", fin="eva", tol=0.30, frec="Mensual", fuente="Modelo EVA", tipo="Resultado"),
            K(nombre="Spread ROIC − WACC", formula="ROIC − WACC (puntos porcentuales)", unidad="pp", sentido="MAX",
              fin="spread", tol=0.25, frec="Trimestral", fuente="Modelo EVA", tipo="Resultado")]),
    K(clave="F_CAP", p="Financiera", nombre="Optimizar el capital de trabajo", desc="Menos inventario, mora y activos ociosos",
      resp="Gerente de Finanzas", kw=["inventario", "capital", "cobranza", "mora", "rotacion"], siempre=False, dest=["F_EVA"],
      kpis=[K(nombre="Días de capital de trabajo", formula="(Inventario + CxC − CxP) / Ventas diarias", unidad="días",
              sentido="MIN", base=75, meta=67, tol=0.10, frec="Mensual", fuente="Balance", tipo="Resultado")]),
    # ------------------------------------------------ Clientes
    K(clave="C_PROM", p="Clientes", nombre="Cumplir la propuesta de valor", desc="Entregas completas y a tiempo al segmento prioritario",
      resp="Gerente de Operaciones", kw=["otif", "entrega", "quiebre", "abastec", "reposic"], tipos=["Industrial", "Comercial"],
      dest=["C_RET", "F_MARG"],
      kpis=[K(nombre="OTIF del segmento prioritario", formula="Pedidos completos y a tiempo / Pedidos", unidad="%",
              sentido="MAX", base=0.88, meta=0.95, tol=0.02, frec="Semanal", fuente="ERP Despachos", tipo="Resultado")]),
    K(clave="C_SLA", p="Clientes", nombre="Asegurar la continuidad operativa del cliente", desc="Disponibilidad y cumplimiento de SLA",
      resp="Jefe de Servicio", kw=["sla", "ticket", "disponib", "continuidad", "servicio"], tipos=["Servicios"], dest=["C_RET"],
      kpis=[K(nombre="% atenciones dentro del SLA", formula="Atenciones en SLA / Atenciones", unidad="%", sentido="MAX",
              base=0.70, meta=0.92, tol=0.03, frec="Semanal", fuente="Mesa de ayuda", tipo="Resultado")]),
    K(clave="C_RET", p="Clientes", nombre="Retener y crecer clientes rentables", desc="Retención de margen y valor de vida del cliente",
      resp="Gerente Comercial", kw=["retenc", "cliente", "margen", "fideli"], siempre=True, dest=["F_CREC"],
      kpis=[K(nombre="Retención de margen de clientes", formula="Margen de clientes retenidos / Margen año anterior",
              unidad="%", sentido="MAX", base=0.92, meta=0.95, tol=0.02, frec="Mensual", fuente="CRM + ERP", tipo="Resultado"),
            K(nombre="Relación CLV / CAC", formula="Valor de vida del cliente / Costo de adquisición", unidad="x",
              sentido="MAX", base=3.2, meta=4.0, tol=0.05, frec="Mensual", fuente="CRM", tipo="Resultado")]),
    K(clave="C_CONF", p="Clientes", nombre="Generar confianza y buena experiencia", desc="Menos reclamos y mejor experiencia",
      resp="Jefe de Calidad", kw=["reclamo", "calidad", "experiencia", "confianza", "nps", "trazab"], siempre=False, dest=["C_RET"],
      kpis=[K(nombre="Reclamos por 1 000 pedidos", formula="Reclamos / Pedidos × 1 000", unidad="n", sentido="MIN",
              base=14, meta=8, tol=0.10, frec="Mensual", fuente="Registro de reclamos", tipo="Resultado")]),
    K(clave="C_NUEVO", p="Clientes", nombre="Captar nuevos segmentos rentables", desc="Adquisición de clientes en segmentos objetivo",
      resp="Gerente Comercial", kw=["nuevo", "segmento", "oportunidad", "expansi"], siempre=False, dest=["F_CREC"],
      kpis=[K(nombre="Clientes nuevos rentables", formula="Clientes nuevos con margen ≥ piso", unidad="n", sentido="MAX",
              base=20, meta=35, tol=0.10, frec="Mensual", fuente="CRM", tipo="Resultado")]),
    # ------------------------------------------------ Procesos
    K(clave="P_SOP", p="Procesos", nombre="Integrar pronóstico y plan (S&OP)", desc="Pronóstico preciso y plan integrado de demanda y suministro",
      resp="Jefe de Supply Chain", kw=["pronost", "demanda", "wape", "inventario", "quiebre", "reposic"], tipos=["Industrial", "Comercial"],
      dest=["C_PROM", "F_CAP"],
      kpis=[K(nombre="WAPE de demanda", formula="Σ|real − pronóstico| / Σ real", unidad="%", sentido="MIN",
              base=0.24, meta=0.14, tol=0.10, frec="Semanal", fuente="Planeamiento", tipo="Inductor")]),
    K(clave="P_OPER", p="Procesos", nombre="Lograr excelencia operativa y calidad", desc="OEE alto y bajo costo de no calidad",
      resp="Jefe de Planta / Operaciones", kw=["oee", "parada", "planta", "defecto", "producc", "mantenim"], tipos=["Industrial"],
      dest=["C_PROM", "C_CONF", "F_MARG"],
      kpis=[K(nombre="OEE de líneas cuello de botella", formula="Disponibilidad × Rendimiento × Calidad", unidad="%",
              sentido="MAX", base=0.68, meta=0.76, tol=0.03, frec="Diaria", fuente="MES Planta", tipo="Inductor"),
            K(nombre="Costo de no calidad", formula="Costo de no calidad / Ventas", unidad="%", sentido="MIN",
              base=0.032, meta=0.022, tol=0.10, frec="Mensual", fuente="Costos", tipo="Inductor")]),
    K(clave="P_SERV", p="Procesos", nombre="Atender con rapidez y resolución", desc="Ruteo y resolución al primer contacto",
      resp="Coordinador de Operaciones", kw=["ticket", "sla", "ruteo", "atencion", "tecnic"], tipos=["Servicios", "Comercial"],
      dest=["C_SLA", "C_CONF"],
      kpis=[K(nombre="Resolución al primer contacto", formula="Casos resueltos al primer contacto / Casos", unidad="%",
              sentido="MAX", base=0.65, meta=0.80, tol=0.03, frec="Semanal", fuente="Mesa de ayuda", tipo="Inductor")]),
    K(clave="P_INNO", p="Procesos", nombre="Innovar en oferta y servicio", desc="Ventas de ofertas nuevas",
      resp="Jefe de Innovación", kw=["innovac", "nuevo", "oportunidad", "servicio", "reciclab"], siempre=False, dest=["C_RET", "C_NUEVO"],
      kpis=[K(nombre="% ventas de ofertas nuevas", formula="Ventas de ofertas < 24 meses / Ventas", unidad="%",
              sentido="MAX", base=0.04, meta=0.08, tol=0.10, frec="Mensual", fuente="ERP Ventas", tipo="Inductor")]),
    K(clave="P_PRECIO", p="Procesos", nombre="Gestionar precio y mezcla con disciplina", desc="Pisos de margen y control de descuentos",
      resp="Gerente Comercial", kw=["precio", "descuento", "mix", "mezcla", "margen"], siempre=False, dest=["F_MARG"],
      kpis=[K(nombre="Fuga de margen por descuentos", formula="Descuentos no autorizados / Ventas", unidad="%",
              sentido="MIN", base=0.007, meta=0.002, tol=0.10, frec="Mensual", fuente="Facturación", tipo="Inductor")]),
    # ------------------------------------------------ Aprendizaje
    K(clave="A_DATOS", p="Aprendizaje", nombre="Contar con datos confiables", desc="KPI críticos certificados con linaje",
      resp="Jefe de Datos / Finanzas", kw=["dato", "certific", "linaje", "kpi"], siempre=True, dest=["P_SOP", "P_OPER", "P_SERV", "P_PRECIO"],
      kpis=[K(nombre="% KPI críticos certificados", formula="KPI certificados / KPI críticos", unidad="%", sentido="MAX",
              base=0.35, meta=0.95, tol=0.05, frec="Mensual", fuente="Catálogo de datos", tipo="Inductor")]),
    K(clave="A_TAL", p="Aprendizaje", nombre="Desarrollar talento aumentado con IA", desc="Adopción útil de copilotos y tiempo ahorrado",
      resp="Gerente de Recursos Humanos", kw=["talento", "capacit", "ia", "copilot", "tecnic"], siempre=True, dest=["P_SOP", "P_INNO", "P_SERV"],
      kpis=[K(nombre="Adopción útil de copilotos", formula="Usuarios activos útiles / Usuarios objetivo", unidad="%",
              sentido="MAX", base=0.0, meta=0.70, tol=0.10, frec="Mensual", fuente="Telemetría IA", tipo="Inductor")]),
    K(clave="A_GOB", p="Aprendizaje", nombre="Gobernar la IA con responsabilidad", desc="Casos de IA con expediente y monitoreo",
      resp="Jefe de Riesgos / TI", kw=["ley", "norma", "privacidad", "riesgo", "31814", "29733"], siempre=True, dest=["P_OPER", "C_CONF"],
      kpis=[K(nombre="% casos de IA con expediente y monitoreo", formula="Casos conformes / Casos de IA activos",
              unidad="%", sentido="MAX", base=0.0, meta=1.0, tol=0.05, frec="Mensual", fuente="Registro de IA", tipo="Inductor")]),
    K(clave="A_CLIMA", p="Aprendizaje", nombre="Fortalecer la cultura y retener talento clave", desc="Clima y retención de personal crítico",
      resp="Gerente de Recursos Humanos", kw=["rotacion", "clima", "cultura", "personal"], siempre=False, dest=["P_SERV", "P_OPER"],
      kpis=[K(nombre="Retención de talento clave", formula="Personal clave que permanece / Personal clave", unidad="%",
              sentido="MAX", base=0.85, meta=0.92, tol=0.03, frec="Trimestral", fuente="RR.HH.", tipo="Inductor")]),
]
INICIATIVAS_CAT = {
    "F_MARG": ("Pricing y mezcla asistidos con pisos de margen", "IA", 0.30, 0.90, 0.22, 0.0, [5, 4, 4, 3, 3, 3]),
    "F_CAP": ("Programa de capital de trabajo por segmento", "Tradicional", 0.08, 0.20, 0.05, 1.5, [4, 4, 4, 4, 4, 4]),
    "C_PROM": ("Promesa de entrega confiable por segmento", "Tradicional", 0.10, 0.25, 0.06, 0.0, [3, 5, 4, 4, 4, 4]),
    "C_SLA": ("Ruteo inteligente de técnicos", "IA", 0.10, 0.35, 0.06, 0.0, [4, 5, 4, 3, 4, 4]),
    "C_RET": ("Modelo de churn y siguiente mejor acción", "IA", 0.18, 0.45, 0.10, 0.0, [4, 5, 3, 3, 3, 4]),
    "C_CONF": ("Gestión de reclamos por causa raíz con IA de voz del cliente", "IA", 0.08, 0.15, 0.04, 0.0, [3, 5, 4, 4, 4, 4]),
    "C_NUEVO": ("Motor de prospección de segmentos rentables", "IA", 0.12, 0.30, 0.08, 0.0, [3, 4, 3, 3, 3, 4]),
    "P_SOP": ("Pronóstico jerárquico y reposición con IA", "IA", 0.45, 0.65, 0.30, 2.0, [5, 5, 4, 4, 4, 4]),
    "P_OPER": ("Mantenimiento predictivo en activos cuello de botella", "IA", 0.40, 0.75, 0.25, 0.0, [4, 4, 4, 3, 4, 4]),
    "P_SERV": ("Base de conocimiento y copiloto de atención", "IA", 0.10, 0.20, 0.06, 0.0, [3, 4, 5, 4, 4, 4]),
    "P_INNO": ("Laboratorio de nuevas ofertas de servicio", "Tradicional", 0.25, 0.40, 0.15, 0.0, [4, 5, 2, 3, 3, 3]),
    "P_PRECIO": ("Control de descuentos y aprobaciones comerciales", "Tradicional", 0.05, 0.30, 0.03, 0.0, [4, 4, 5, 4, 3, 5]),
    "A_DATOS": ("Certificación de KPI críticos y catálogo de datos", "Tradicional", 0.15, 0.00, 0.08, 0.0, [3, 4, 5, 4, 4, 5]),
    "A_TAL": ("Copiloto de causas y acciones del BSC + academia 70/20/10", "IA", 0.20, 0.30, 0.18, 0.0, [3, 4, 5, 4, 4, 4]),
    "A_GOB": ("Registro y expediente de casos de IA (NIST AI RMF / ISO 42001)", "Tradicional", 0.05, 0.00, 0.03, 0.0, [2, 3, 5, 5, 4, 5]),
    "A_CLIMA": ("Programa de retención y carrera para talento clave", "Tradicional", 0.06, 0.05, 0.04, 0.0, [2, 4, 3, 4, 5, 5]),
    "F_EVA": ("Oficina de Gestión Estratégica y registro de beneficios (EVA)", "Tradicional", 0.06, 0.10, 0.04, 0.0, [4, 5, 5, 4, 4, 5]),
    "F_CREC": ("Plan comercial de cuentas prioritarias", "Tradicional", 0.10, 0.40, 0.08, 0.0, [4, 5, 4, 4, 4, 4]),
}
POR_PERSPECTIVA = {"Financiera": 3, "Clientes": 3, "Procesos": 3, "Aprendizaje": 3}


def _puntaje_plantilla(pl: dict, texto: str, tipo_empresa: str) -> float:
    s = 100.0 if pl.get("siempre") else 0.0
    s += sum(texto.count(k) for k in pl["kw"]) * 3
    if pl.get("tipos"):
        s += 8 if tipo_empresa in pl["tipos"] else -15
    return s


def seleccionar_plantillas(diag: pd.DataFrame, estrategias: pd.DataFrame, tipo_empresa: str,
                           por_perspectiva: dict | None = None) -> list[dict]:
    texto = _norm(" ".join(diag.get("descripcion", pd.Series(dtype=str)).astype(str)) + " "
                  + " ".join(diag.get("implicancia_decision", pd.Series(dtype=str)).astype(str)) + " "
                  + " ".join(estrategias.get("descripcion", pd.Series(dtype=str)).astype(str)))
    cupo = por_perspectiva or POR_PERSPECTIVA
    elegidas = []
    for p in config.PERSPECTIVAS:
        cands = sorted([pl for pl in CATALOGO if pl["p"] == p],
                       key=lambda pl: -_puntaje_plantilla(pl, texto, tipo_empresa))
        elegidas += cands[:cupo.get(p, 3)]
    orden = {pl["clave"]: i for i, pl in enumerate(CATALOGO)}
    return sorted(elegidas, key=lambda pl: (config.PERSPECTIVAS.index(pl["p"]), orden[pl["clave"]]))


def propuesta_bsc(empresa: dict, diag: pd.DataFrame, estrategias: pd.DataFrame, escenarios: pd.DataFrame,
                  anio: str, escenario: str = "Base", por_perspectiva: dict | None = None) -> dict:
    """Genera objetivos, relaciones, KPI (ficha + metas), trayectoria mensual e iniciativas."""
    eid = empresa["empresa_id"]
    tipo = _txt(empresa.get("tipo"))
    pls = seleccionar_plantillas(diag, estrategias, tipo, por_perspectiva)
    # ---- objetivos
    ids, objetivos = {}, []
    cont = {p: 0 for p in config.PERSPECTIVAS}
    for orden, pl in enumerate(pls, 1):
        cont[pl["p"]] += 1
        oid = f"{config.PREFIJO_PERSPECTIVA[pl['p']]}{cont[pl['p']]}"
        ids[pl["clave"]] = oid
        objetivos.append({"empresa_id": eid, "objetivo_id": oid, "perspectiva": pl["p"], "nombre": pl["nombre"],
                          "descripcion": pl["desc"], "responsable": pl["resp"], "orden": orden, "estado": "Propuesto"})
    # ---- relaciones causa-efecto
    nivel = {p: i for i, p in enumerate(config.PERSPECTIVAS)}      # 0 = Financiera (arriba)
    relaciones = []
    for pl in pls:
        destinos = [d for d in pl["dest"] if d in ids]
        if not destinos and pl["p"] != "Financiera":
            superior = [x for x in pls if nivel[x["p"]] == nivel[pl["p"]] - 1]
            destinos = [superior[0]["clave"]] if superior else []
        for d in destinos:
            relaciones.append({"empresa_id": eid, "objetivo_origen": ids[pl["clave"]], "objetivo_destino": ids[d],
                               "hipotesis": f"Si «{pl['nombre'].lower()}», entonces «{next(x['nombre'] for x in pls if x['clave'] == d).lower()}»",
                               "peso": 1.0})
    # objetivos sin relaciones entrantes (excepto Aprendizaje): se conectan desde el primer objetivo del nivel inferior
    destinos_con = {r["objetivo_destino"] for r in relaciones}
    for pl in pls:
        if pl["p"] != "Aprendizaje" and ids[pl["clave"]] not in destinos_con:
            inferior = [x for x in pls if nivel[x["p"]] == nivel[pl["p"]] + 1]
            if inferior:
                relaciones.append({"empresa_id": eid, "objetivo_origen": ids[inferior[0]["clave"]], "objetivo_destino": ids[pl["clave"]],
                                   "hipotesis": f"Si «{inferior[0]['nombre'].lower()}», entonces «{pl['nombre'].lower()}»", "peso": 0.5})
    # ---- parámetros financieros (año base real y escenario del plan)
    base_fin, meta_fin = _base_meta_financiera(empresa, escenarios, anio, escenario)
    # ---- KPI
    kpis, n = [], 0
    for pl in pls:
        for k in pl["kpis"]:
            n += 1
            b, m = _base_meta_kpi(k, base_fin, meta_fin)
            kpis.append({"empresa_id": eid, "kpi_id": f"K{n:02d}", "objetivo_id": ids[pl["clave"]], "nombre": k["nombre"],
                         "formula": k["formula"], "unidad": k["unidad"], "sentido": k["sentido"],
                         "linea_base": round(b, 4), "meta": round(m, 4), "tolerancia_ambar": k["tol"],
                         "frecuencia": k["frec"], "fuente": k["fuente"], "tipo": k["tipo"], "responsable": pl["resp"],
                         "_fin": k.get("fin")})
    kpis_df = pd.DataFrame(kpis)
    trayect = trayectorias(kpis_df, anio, base_fin, meta_fin)
    # ---- iniciativas
    inis, n = [], 0
    ini_anio = int(anio)
    for pl in pls:
        if pl["clave"] not in INICIATIVAS_CAT:
            continue
        nom, tp, pres, ben, cos, cap, pts = INICIATIVAS_CAT[pl["clave"]]
        n += 1
        inicio = dt.date(ini_anio, min(1 + (n - 1) % 5, 12), 1 if n % 2 else 15)
        dur = 5 if tp == "Tradicional" else 8
        fin = min(dt.date(ini_anio, 12, 31), _sumar_meses(inicio, dur))
        inis.append({"empresa_id": eid, "iniciativa_id": f"I{n:02d}", "nombre": nom, "tipo": tp,
                     "objetivo_id": ids[pl["clave"]], "responsable": pl["resp"], "fecha_inicio": inicio.isoformat(),
                     "fecha_fin": fin.isoformat(), "presupuesto": pres, "beneficio_bruto_anual": ben, "costo_anual": cos,
                     "capital_liberado": cap, **dict(zip(["p_eva", "p_alineamiento", "p_tiempo_valor", "p_factibilidad",
                                                          "p_adopcion", "p_riesgo"], pts)),
                     "puerta": "G0", "estado": "No iniciada"})
    ini_df = pd.DataFrame(inis)
    if not ini_df.empty:
        ini_df["puntaje"] = [fz.puntaje_priorizacion(r) for r in ini_df[list(config.PESOS_PRIORIZACION)].to_dict("records")]
        ini_df = ini_df.sort_values("puntaje", ascending=False).reset_index(drop=True)
        ini_df["iniciativa_id"] = [f"I{i + 1:02d}" for i in range(len(ini_df))]
    return {"objetivos": pd.DataFrame(objetivos), "relaciones": pd.DataFrame(relaciones),
            "kpis": kpis_df.drop(columns=["_fin"]), "kpi_valores": trayect, "iniciativas": ini_df,
            "base_fin": base_fin, "meta_fin": meta_fin,
            "generica": generica_sugerida(diag, tipo)}


def _sumar_meses(d: dt.date, m: int) -> dt.date:
    y, mo = divmod(d.month - 1 + m, 12)
    return dt.date(d.year + y, mo + 1, min(d.day, 28))


def _base_meta_financiera(empresa, esc, anio, escenario):
    anio_base = str(_txt(empresa.get("anio_base"), str(int(anio) - 1)))
    b = esc[esc["anio"] == anio_base]
    m = esc[(esc["anio"] == str(anio)) & (esc["escenario"] == escenario)]
    if m.empty:
        m = esc[esc["anio"] == str(anio)]
    if b.empty:
        b = m
    if m.empty:
        return None, None
    def _v(r):
        return fz.resultado_valor(r["ventas"], r["margen_ebit"], r["capital_invertido"], r["wacc"], r["tasa_ir"]) | {
            "margen_ebit": float(r["margen_ebit"]), "capital_invertido": float(r["capital_invertido"]), "tasa_ir": float(r["tasa_ir"])}
    return _v(b.iloc[0].to_dict()), _v(m.iloc[0].to_dict())


def _base_meta_kpi(k, bf, mf):
    fin = k.get("fin")
    if fin and bf and mf:
        if fin == "crecimiento":
            return 0.0, mf["ventas"] / bf["ventas"] - 1
        if fin == "margen":
            return bf["margen_ebit"], mf["margen_ebit"]
        if fin == "eva":
            return 0.0, mf["eva"]
        if fin == "spread":
            return bf["spread"] * 100, mf["spread"] * 100
    return float(k.get("base", 0)), float(k.get("meta", 1))


def trayectorias(kpis: pd.DataFrame, anio: str, bf=None, mf=None) -> pd.DataFrame:
    """Metas mensuales (tipo_valor = Meta). EVA acumulado con cargo mensual; resto lineal (regla RN02)."""
    filas = []
    for r in kpis.to_dict("records"):
        for mes in range(1, 13):
            if r.get("_fin") == "eva" and mf:
                v = r["meta"] * mes / 12
            else:
                v = fz.trayectoria(r["linea_base"], r["meta"], mes)
            filas.append({"empresa_id": r["empresa_id"], "kpi_id": r["kpi_id"], "periodo_id": f"{anio}-{mes:02d}",
                          "tipo_valor": "Meta", "valor": round(v, 6), "calidad_dato": "Certificado"})
    return pd.DataFrame(filas)


# ============================================================ Validación de coherencia
def validar_bsc(objetivos: pd.DataFrame, relaciones: pd.DataFrame, kpis: pd.DataFrame,
                iniciativas: pd.DataFrame | None = None) -> pd.DataFrame:
    """Regla RN08 + detección de contradicciones. Devuelve (nivel, regla, detalle)."""
    a = []

    def add(nivel, regla, detalle):
        a.append({"nivel": nivel, "regla": regla, "detalle": detalle})
    n_o, n_k = len(objetivos), len(kpis)
    add("OK" if config.MIN_OBJETIVOS <= n_o <= config.MAX_OBJETIVOS else "ALERTA", "Objetivos 10–15", f"{n_o} objetivos")
    add("OK" if config.MIN_KPI <= n_k <= config.MAX_KPI else "ALERTA", "KPI 15–25", f"{n_k} indicadores")
    for p in config.PERSPECTIVAS:
        c = int((objetivos["perspectiva"] == p).sum()) if n_o else 0
        if c == 0:
            add("ERROR", "Cuatro perspectivas", f"La perspectiva {p} no tiene objetivos")
    if n_o:
        por_obj = kpis.groupby("objetivo_id").size() if n_k else pd.Series(dtype=int)
        for r in objetivos.itertuples():
            c = int(por_obj.get(r.objetivo_id, 0))
            if c == 0:
                add("ERROR", "1–2 KPI por objetivo", f"{r.objetivo_id} «{r.nombre}» no tiene KPI")
            elif c > config.MAX_KPI_POR_OBJETIVO:
                add("ALERTA", "1–2 KPI por objetivo", f"{r.objetivo_id} tiene {c} KPI (use tableros operativos)")
            if not _txt(r.responsable):
                add("ERROR", "Responsable", f"{r.objetivo_id} sin responsable")
            primera = _txt(r.nombre).split(" ")[0].lower() if _txt(r.nombre) else ""
            if primera and not re.search(r"(ar|er|ir)$", primera):
                add("ALERTA", "Verbo en infinitivo", f"{r.objetivo_id} «{r.nombre}» no inicia con verbo")
            if r.perspectiva != "Financiera":
                sale = relaciones[relaciones["objetivo_origen"] == r.objetivo_id] if not relaciones.empty else relaciones
                if sale.empty:
                    add("ALERTA", "Causalidad", f"{r.objetivo_id} no tiene relación hacia un objetivo superior")
            if r.perspectiva != "Aprendizaje":
                entra = relaciones[relaciones["objetivo_destino"] == r.objetivo_id] if not relaciones.empty else relaciones
                if entra.empty:
                    add("ALERTA", "Causalidad", f"{r.objetivo_id} no recibe relaciones (¿qué lo impulsa?)")
        if not relaciones.empty:
            niv = dict(zip(objetivos["objetivo_id"], objetivos["perspectiva"].map({p: i for i, p in enumerate(config.PERSPECTIVAS)})))
            for r in relaciones.itertuples():
                if r.objetivo_origen not in niv or r.objetivo_destino not in niv:
                    add("ERROR", "Integridad", f"Relación {r.objetivo_origen}→{r.objetivo_destino} con objetivo inexistente")
                elif niv[r.objetivo_origen] < niv[r.objetivo_destino]:
                    add("ALERTA", "Sentido causal", f"{r.objetivo_origen}→{r.objetivo_destino} va de arriba hacia abajo")
    if n_k:
        huer = set(kpis["objetivo_id"]) - set(objetivos["objetivo_id"])
        for h in huer:
            add("ERROR", "Integridad", f"KPI asociados a objetivo inexistente {h}")
        for r in kpis.itertuples():
            if any(pd.isna(getattr(r, c)) for c in ("linea_base", "meta")):
                add("ERROR", "Ficha técnica", f"{r.kpi_id} sin línea base o meta")
            if not _txt(r.formula) or not _txt(r.fuente):
                add("ALERTA", "Ficha técnica", f"{r.kpi_id} sin fórmula o fuente")
            if r.sentido == "MAX" and r.meta < r.linea_base or r.sentido == "MIN" and r.meta > r.linea_base:
                add("ALERTA", "Meta retadora", f"{r.kpi_id} la meta empeora la línea base")
        tipos = set(kpis["tipo"].dropna())
        if not {"Resultado", "Inductor"} <= tipos:
            add("ALERTA", "Balance de indicadores", "Faltan indicadores de resultado o inductores")
    if iniciativas is not None and not iniciativas.empty and n_o:
        sin = set(objetivos["objetivo_id"]) - set(iniciativas["objetivo_id"])
        if sin:
            add("INFO", "Iniciativas", f"Objetivos sin iniciativa: {', '.join(sorted(sin))}")
        malas = set(iniciativas["objetivo_id"]) - set(objetivos["objetivo_id"])
        if malas:
            add("ERROR", "Integridad", f"Iniciativas asociadas a objetivos inexistentes: {', '.join(sorted(malas))}")
    return pd.DataFrame(a, columns=["nivel", "regla", "detalle"])


# ============================================================ Pronóstico y narrativa
def pronostico_cierre(serie_real: list[float], meses_restantes: int, alfa: float = 0.5, beta: float = 0.3) -> float | None:
    """Suavizamiento exponencial doble (Holt) para proyectar el valor de cierre."""
    s = [float(x) for x in serie_real if x is not None and not pd.isna(x)]
    if not s:
        return None
    if len(s) == 1:
        return s[0]
    nivel, tend = s[0], s[1] - s[0]
    for x in s[1:]:
        ant = nivel
        nivel = alfa * x + (1 - alfa) * (nivel + tend)
        tend = beta * (nivel - ant) + (1 - beta) * tend
    return nivel + tend * meses_restantes


def narrativa_escenarios(tabla: pd.DataFrame, mc: dict | None, empresa: str, anio: str) -> str:
    """Narrativa que distingue dato, inferencia, pronóstico y recomendación."""
    if tabla.empty:
        return "Sin escenarios registrados."
    t = tabla.set_index("escenario")
    peor, mejor = t["eva"].idxmin(), t["eva"].idxmax()
    lineas = [f"**Dato.** Para {empresa} en {anio}, el EVA va de S/ {t['eva'].min():,.2f} m ({peor}) a "
              f"S/ {t['eva'].max():,.2f} m ({mejor})."]
    neg = t[t["eva"] < 0]
    if not neg.empty:
        lineas.append(f"**Inferencia.** En {', '.join(neg.index)} el ROIC ({neg['roic'].min():.2%}) no cubre el WACC: "
                      "el crecimiento de ventas no basta; se requieren gatillos de caja, mezcla, inventario y gasto.")
    else:
        lineas.append("**Inferencia.** Todos los escenarios crean valor (ROIC > WACC).")
    if mc:
        lineas.append(f"**Pronóstico.** Monte Carlo ({mc['n']:,} iteraciones): EVA P10 S/ {mc['p10']:,.2f} m · "
                      f"P50 S/ {mc['p50']:,.2f} m · P90 S/ {mc['p90']:,.2f} m; P(EVA>0) = {mc['prob_eva_pos']:.0%}. "
                      f"Mayor contribución a la incertidumbre: {next(iter(mc['contribucion']), '—')}.")
        if mc["alerta"]:
            lineas.append(f"**Recomendación.** P(EVA>0) está por debajo de {config.UMBRAL_PROB_EVA:.0%}: repriorizar iniciativas y capital (gatillo G04).")
        else:
            lineas.append("**Recomendación.** Mantener el portafolio priorizado y vigilar los gatillos mensuales del principal impulsor de incertidumbre.")
    lineas.append("_Fuente: tabla de escenarios y supuestos Monte Carlo de la base GCE-IA. Requiere aprobación humana._")
    return "\n\n".join(lineas)


SECCIONES_PLAN = ["1. Mandato", "2. Identidad", "3. Diagnóstico", "4. Escenarios", "5. Estrategia", "6. Mapa estratégico",
                  "7. Balanced Scorecard", "8. Iniciativas", "9. Finanzas", "10. Ejecución", "11. Gobierno", "12. Aprendizaje"]


def documento_plan(empresa: dict, ident: dict, diag: pd.DataFrame, estr: pd.DataFrame, esc_tabla: pd.DataFrame,
                   objetivos: pd.DataFrame, kpis: pd.DataFrame, inis: pd.DataFrame, riesgos: pd.DataFrame,
                   anio: str) -> pd.DataFrame:
    """Redacta las 12 secciones del plan estratégico anual (guía 2027, p. 34)."""
    nom = _txt(empresa.get("razon_social"))
    rd = resumen_diagnostico(diag)
    gen, _ = generica_sugerida(diag, _txt(empresa.get("tipo")))
    def lista(df, col, n=6):
        return "; ".join(_txt(x) for x in df[col].head(n)) if not df.empty else "pendiente"
    hechos = diag[diag["tipo"] == "HECHO"] if not diag.empty else diag
    sec = {
        "1. Mandato": f"Plan estratégico anual {anio} de {nom} ({_txt(empresa.get('sector'))}). Horizonte: {_txt(empresa.get('horizonte_plan'), anio)}. "
                      "Gobierno: directorio y comité de estrategia; la Oficina de Gestión Estratégica coordina el ciclo "
                      "(formular → traducir → alinear → ejecutar → controlar → adaptar). Revisión BSC mensual y estratégica trimestral.",
        "2. Identidad": f"Misión: {_txt(ident.get('mision'), 'pendiente')}\nVisión: {_txt(ident.get('vision'), 'pendiente')}\nValores: {_txt(ident.get('valores'), 'pendiente')}",
        "3. Diagnóstico": f"{rd['hechos']} hechos críticos, {rd['pestel']} factores PESTEL y FODA {rd['foda']}. "
                          f"Hechos principales: {lista(hechos, 'descripcion', 5)}. Brechas: {'; '.join(rd['brechas']) or 'ninguna'}.",
        "4. Escenarios": "; ".join(f"{r.escenario}: ventas S/ {r.ventas:,.1f} m, margen {r.margen_ebit:.1%}, EVA S/ {r.eva:,.2f} m (prob. {r.probabilidad:.0%})"
                                   for r in esc_tabla.itertuples()) or "pendiente",
        "5. Estrategia": f"Estrategia genérica sugerida: {gen}. Apuestas: {lista(estr[estr['tipo'] == 'Apuesta'], 'descripcion', 5) if not estr.empty else 'pendiente'}. "
                         f"Renuncias: {lista(estr[estr['tipo'] == 'Renuncia'], 'descripcion', 4) if not estr.empty else 'pendiente'}.",
        "6. Mapa estratégico": "; ".join(f"{r.objetivo_id} {r.nombre}" for r in objetivos.itertuples()) or "Se genera en el módulo Mapa y BSC.",
        "7. Balanced Scorecard": f"{len(kpis)} indicadores con ficha técnica, línea base, meta, trayectoria mensual, fuente y responsable." if len(kpis) else "Se genera en el módulo Mapa y BSC.",
        "8. Iniciativas": (f"{len(inis)} iniciativas ({int((inis['tipo'] == 'IA').sum())} de IA). Presupuesto total S/ {inis['presupuesto'].sum():,.2f} m; "
                           f"beneficio neto anual esperado S/ {(inis['beneficio_bruto_anual'] - inis['costo_anual']).sum():,.2f} m.") if len(inis) else "pendiente",
        "9. Finanzas": "EVA = NOPAT − WACC × Capital. " + ("; ".join(f"{r.escenario}: ROIC {r.roic:.2%} vs WACC {r.wacc:.2%}" for r in esc_tabla.itertuples()) or ""),
        "10. Ejecución": "Planes de 90 días por iniciativa; diagrama de Gantt aprobado; reunión mensual de 90 minutos "
                         "(señales, valor, causas, iniciativas, decisiones) con reporte PPT automático.",
        "11. Gobierno": f"{len(riesgos)} riesgos registrados; expediente por caso de IA (NIST AI RMF, ISO/IEC 42001); "
                        "Ley 31814, Ley 29733; control humano antes de decisiones materiales.",
        "12. Aprendizaje": "Revisión trimestral de hipótesis del mapa con datos reales, simulación Monte Carlo y decisión: corregir, escalar o detener.",
    }
    return pd.DataFrame([{"empresa_id": empresa["empresa_id"], "seccion": s, "orden": i + 1, "contenido": sec[s], "origen": ORIGEN}
                         for i, s in enumerate(SECCIONES_PLAN)])


# ============================================================ Gantt de implementación
FASES_IA = [("G0-G1 Problema y datos", 0.20), ("G2 Piloto con grupo de control", 0.40), ("G3 Producción y adopción", 0.40)]
FASES_TRAD = [("Diseño y plan de 90 días", 0.30), ("Implementación", 0.50), ("Cierre y medición de beneficios", 0.20)]
HOJA_RUTA = [  # guía 2027, p. 24: frentes de 12 meses (mes inicio, mes fin)
    ("Estrategia y misión", 1, 3, "Oficina de Estrategia"), ("Datos y KPI", 1, 5, "Jefe de Datos"),
    ("MVP cockpit BSC", 3, 6, "Oficina de Estrategia"), ("Casos IA ola 1", 4, 7, "Comité de IA"),
    ("Escalamiento", 6, 11, "Comité de IA"), ("Beneficios y EVA", 7, 12, "Gerente de Finanzas"),
    ("Gobierno de IA", 1, 12, "Jefe de Riesgos"),
]


def proponer_gantt(empresa_id: str, iniciativas: pd.DataFrame, anio: str) -> pd.DataFrame:
    """Hoja de ruta de 12 meses + fases por iniciativa (puertas G0–G4 para IA) con dependencias."""
    import calendar
    y = int(anio)
    filas = []
    prev = None
    for i, (nom, m0, m1, resp) in enumerate(HOJA_RUTA, 1):
        tid = f"H{i:02d}"
        dep = "H01" if nom in ("Datos y KPI",) else ("H02" if nom == "MVP cockpit BSC" else
                                                     ("H03" if nom == "Casos IA ola 1" else ("H04" if nom in ("Escalamiento", "Beneficios y EVA") else "")))
        filas.append({"empresa_id": empresa_id, "tarea_id": tid, "iniciativa_id": "FASE", "tarea": nom,
                      "fecha_inicio": dt.date(y, m0, 1).isoformat(),
                      "fecha_fin": dt.date(y, m1, calendar.monthrange(y, m1)[1]).isoformat(),
                      "dependencia": dep, "responsable": resp, "avance": 0.0, "estado": "Propuesto"})
    for r in iniciativas.sort_values("fecha_inicio").itertuples():
        try:
            ini, fin = dt.date.fromisoformat(str(r.fecha_inicio)[:10]), dt.date.fromisoformat(str(r.fecha_fin)[:10])
        except ValueError:
            continue
        if fin <= ini:
            fin = ini + dt.timedelta(days=90)
        total = (fin - ini).days
        fases = FASES_IA if r.tipo == "IA" else FASES_TRAD
        cursor, prev = ini, "H02" if r.tipo == "IA" else ""
        for j, (fase, peso) in enumerate(fases, 1):
            fin_f = fin if j == len(fases) else cursor + dt.timedelta(days=max(7, round(total * peso)) - 1)
            tid = f"{r.iniciativa_id}-{j}"
            filas.append({"empresa_id": empresa_id, "tarea_id": tid, "iniciativa_id": r.iniciativa_id,
                          "tarea": f"{r.nombre[:48]} · {fase}", "fecha_inicio": cursor.isoformat(), "fecha_fin": fin_f.isoformat(),
                          "dependencia": prev or "", "responsable": r.responsable, "avance": 0.0, "estado": "Propuesto"})
            prev, cursor = tid, fin_f + dt.timedelta(days=1)
    return pd.DataFrame(filas)


def analizar_gantt(t: pd.DataFrame) -> pd.DataFrame:
    """Ruta crítica (holgura = inicio más tardío − inicio programado) sobre fechas y dependencias."""
    if t.empty:
        return t.assign(duracion=[], holgura=[], critica=[])
    d = t.copy()
    d["ini"] = pd.to_datetime(d["fecha_inicio"], errors="coerce")
    d["fin"] = pd.to_datetime(d["fecha_fin"], errors="coerce")
    d["duracion"] = (d["fin"] - d["ini"]).dt.days + 1
    fin_proy = d["fin"].max()
    sucesores = {}
    for r in d.itertuples():
        for p in [x.strip() for x in str(r.dependencia or "").replace(";", ",").split(",") if x.strip() and x.strip() != "None"]:
            sucesores.setdefault(p, []).append(r.tarea_id)
    idx = d.set_index("tarea_id")
    lf = {}

    def ultimo_fin(tid, pila=()):
        if tid in lf:
            return lf[tid]
        if tid in pila:                       # ciclo: se corta
            return fin_proy
        sus = [s for s in sucesores.get(tid, []) if s in idx.index]
        if not sus:
            v = fin_proy
        else:
            v = min(ultimo_fin(s, pila + (tid,)) - pd.Timedelta(days=int(idx.loc[s, "duracion"])) for s in sus)
        lf[tid] = v
        return v
    d["holgura"] = [int((ultimo_fin(r.tarea_id) - r.fin).days) if pd.notna(r.fin) else None for r in d.itertuples()]
    d["critica"] = d["holgura"].fillna(99) <= 0
    return d.drop(columns=["ini", "fin"])


def validar_gantt(t: pd.DataFrame, iniciativas: pd.DataFrame) -> pd.DataFrame:
    a = []
    ids = set(t["tarea_id"])
    fin = dict(zip(t["tarea_id"], pd.to_datetime(t["fecha_fin"], errors="coerce")))
    for r in t.itertuples():
        i0, f0 = pd.to_datetime(r.fecha_inicio, errors="coerce"), pd.to_datetime(r.fecha_fin, errors="coerce")
        if pd.isna(i0) or pd.isna(f0):
            a.append(("ERROR", r.tarea_id, "Fecha inválida (use AAAA-MM-DD)"))
            continue
        if f0 < i0:
            a.append(("ERROR", r.tarea_id, "La fecha de fin es anterior al inicio"))
        for p in [x.strip() for x in str(r.dependencia or "").replace(";", ",").split(",") if x.strip() and x.strip() != "None"]:
            if p not in ids:
                a.append(("ERROR", r.tarea_id, f"Depende de una tarea inexistente: {p}"))
            elif pd.notna(fin[p]) and fin[p] >= i0:
                a.append(("ALERTA", r.tarea_id, f"Inicia antes de que termine su predecesora {p}"))
        if r.iniciativa_id not in ("FASE", None) and r.iniciativa_id not in set(iniciativas["iniciativa_id"]):
            a.append(("ALERTA", r.tarea_id, f"Iniciativa {r.iniciativa_id} no existe en el portafolio"))
    sin = set(iniciativas["iniciativa_id"]) - set(t["iniciativa_id"])
    if sin:
        a.append(("INFO", "—", f"Iniciativas sin tareas en el Gantt: {', '.join(sorted(sin))}"))
    if not a:
        a.append(("OK", "—", "Cronograma consistente"))
    return pd.DataFrame(a, columns=["nivel", "tarea", "detalle"])


# ============================================================ Control: avance, gatillos y narrativa
def avance_planificado(fecha_inicio, fecha_fin, periodo_id: str) -> float:
    """Avance lineal esperado al cierre del periodo (AAAA-MM)."""
    import calendar
    try:
        ini, fin = dt.date.fromisoformat(str(fecha_inicio)[:10]), dt.date.fromisoformat(str(fecha_fin)[:10])
        y, m = map(int, periodo_id.split("-"))
    except (ValueError, AttributeError):
        return 0.0
    corte = dt.date(y, m, calendar.monthrange(y, m)[1])
    if corte < ini:
        return 0.0
    if corte >= fin:
        return 1.0
    return round((corte - ini).days / max(1, (fin - ini).days), 2)


def evaluar_gatillos(gatillos: pd.DataFrame, ev_kpis: pd.DataFrame, historico: pd.DataFrame,
                     simulaciones: pd.DataFrame, kpis: pd.DataFrame) -> pd.DataFrame:
    """Evalúa los gatillos registrados contra los datos disponibles (regla RN07)."""
    filas = []
    sims = simulaciones[simulaciones["tipo"] == "Monte Carlo"] if not simulaciones.empty else simulaciones
    ultima = sims.iloc[-1] if not sims.empty else None
    for g in gatillos.itertuples():
        ind = _norm(g.indicador)
        estado, valor, detalle = "SIN DATO", None, "No hay datos para evaluar"
        try:
            if "wape" in ind:
                k = kpis[kpis["nombre"].str.contains("WAPE", case=False, na=False)]
                if not k.empty:
                    serie = historico[(historico["kpi_id"] == k.iloc[0]["kpi_id"]) & (historico["tipo_valor"] == "Real")].sort_values("periodo_id")
                    if not serie.empty:
                        ult2 = serie["valor"].tail(2).tolist()
                        valor = ult2[-1]
                        umbral = float(g.umbral)
                        estado = "ACTIVADO" if len(ult2) == 2 and all(v > umbral for v in ult2) else "OK"
                        detalle = f"Últimos valores {', '.join(f'{v:.1%}' for v in ult2)} vs umbral {umbral:.0%}"
            elif "margen" in ind:
                k = ev_kpis[ev_kpis["nombre"].str.contains("Margen EBIT", case=False, na=False)]
                if not k.empty and pd.notna(k.iloc[0]["real"]):
                    valor, meta = float(k.iloc[0]["real"]), float(k.iloc[0]["meta_periodo"])
                    estado = "ACTIVADO" if valor < meta - 0.02 else "OK"
                    detalle = f"Real {valor:.2%} vs trayectoria {meta:.2%} (tolerancia −2 pp)"
            elif "p(eva" in ind and ultima is not None:
                valor = float(ultima["prob_eva_pos"])
                estado = "ACTIVADO" if valor < float(g.umbral) else "OK"
                detalle = f"Última simulación ({ultima['fecha']}): P(EVA>0) = {valor:.0%}"
            elif "eva p50" in ind and ultima is not None:
                valor = float(ultima["p50"])
                estado = "ACTIVADO" if valor < float(g.umbral) else "OK"
                detalle = f"EVA P50 = S/ {valor:,.2f} m vs umbral S/ {float(g.umbral):,.2f} m"
            elif "capital" in ind:
                k = ev_kpis[ev_kpis["nombre"].str.contains("capital de trabajo", case=False, na=False)]
                if not k.empty and pd.notna(k.iloc[0]["real"]):
                    valor, meta = float(k.iloc[0]["real"]), float(k.iloc[0]["meta_periodo"])
                    estado = "ACTIVADO" if valor > meta + 8 else "OK"
                    detalle = f"Real {valor:.0f} días vs trayectoria {meta:.0f} (+8)"
        except (TypeError, ValueError):
            estado, detalle = "SIN DATO", "Umbral no numérico: evaluación manual"
        filas.append({"gatillo": g.gatillo_id, "indicador": g.indicador, "estado": estado, "detalle": detalle,
                      "accion": g.accion, "responsable": g.responsable})
    return pd.DataFrame(filas)


def pronostico_kpis(ev: pd.DataFrame, historico: pd.DataFrame, anio: str) -> pd.DataFrame:
    """Pronóstico de cierre de año por KPI (Holt) y probabilidad cualitativa de lograr la meta."""
    filas = []
    for r in ev.itertuples():
        serie = historico[(historico["kpi_id"] == r.kpi_id) & (historico["tipo_valor"] == "Real")
                          & historico["periodo_id"].astype(str).str.startswith(str(anio))].sort_values("periodo_id")
        if serie.empty:
            filas.append({"kpi_id": r.kpi_id, "cierre_pronosticado": None, "logra_meta": "Sin datos"})
            continue
        ult_mes = int(str(serie["periodo_id"].iloc[-1])[-2:])
        p = pronostico_cierre(serie["valor"].tolist(), 12 - ult_mes)
        if r.sentido == "MAX":
            ok = p >= r.meta
        elif r.sentido == "MIN":
            ok = p <= r.meta
        else:
            ok = abs(p) <= abs(r.meta)
        filas.append({"kpi_id": r.kpi_id, "cierre_pronosticado": p, "logra_meta": "Probable" if ok else "En riesgo"})
    return pd.DataFrame(filas)


def narrativa_control(empresa: str, periodo: str, ev: pd.DataFrame, eva_meta: float | None, eva_real: float | None,
                      ini_rojas: list[str], gatillos_act: list[str], pron: pd.DataFrame | None = None) -> str:
    """Narrativa ejecutiva del periodo de control (dato → inferencia → pronóstico → recomendación)."""
    n = len(ev)
    cuenta = ev["semaforo"].value_counts().to_dict() if n else {}
    lineas = [f"**Dato.** Al {periodo}, {empresa} tiene {cuenta.get('VERDE', 0)} de {n} KPI en verde, "
              f"{cuenta.get('AMBAR', 0)} en ámbar, {cuenta.get('ROJO', 0)} en rojo y {cuenta.get('GRIS', 0)} sin dato certificado."]
    if eva_meta is not None and eva_real is not None:
        brecha = eva_real - eva_meta
        lineas.append(f"El EVA acumulado real es S/ {eva_real:,.2f} m frente a S/ {eva_meta:,.2f} m de trayectoria "
                      f"({'+' if brecha >= 0 else '−'}S/ {abs(brecha):,.2f} m).")
    peores = ev[ev["semaforo"].isin(["ROJO", "AMBAR"])].sort_values("cumplimiento").head(3) if n else ev
    if len(peores):
        lineas.append("**Inferencia.** Los desvíos se concentran en: " +
                      "; ".join(f"{r.kpi_id} {r.nombre} ({r.cumplimiento:.0%} de la trayectoria)" for r in peores.itertuples()) + ".")
    if pron is not None and not pron.empty:
        riesgo = pron[pron["logra_meta"] == "En riesgo"]
        lineas.append(f"**Pronóstico.** Con la tendencia actual (Holt), {len(pron) - len(riesgo) - int((pron['logra_meta'] == 'Sin datos').sum())} "
                      f"KPI alcanzarían su meta anual y {len(riesgo)} están en riesgo"
                      + (f": {', '.join(riesgo['kpi_id'].head(6))}." if len(riesgo) else "."))
    rec = []
    if ini_rojas:
        rec.append(f"remover bloqueos de las iniciativas en rojo ({', '.join(ini_rojas)})")
    if gatillos_act:
        rec.append(f"ejecutar las acciones de los gatillos activados ({', '.join(gatillos_act)})")
    if not rec:
        rec.append("sostener la ejecución y documentar aprendizajes")
    lineas.append("**Recomendación.** " + "; ".join(rec).capitalize() + ".")
    lineas.append("_Fuente: base GCE-IA (KPI, seguimiento, simulaciones). Requiere validación del comité._")
    return "\n\n".join(lineas)
