# -*- coding: utf-8 -*-
"""
simulador.py - Motor de simulación (funciones puras).

* Escenarios deterministas (Protección / Base / Expansión u otros).
* Proyección multiperiodo del EVA.
* Sensibilidad (tornado) de las palancas de valor.
* Monte Carlo con distribuciones triangulares: P10 / P50 / P90 y P(EVA > 0).
* Simulación del BSC: logro de metas de KPI inductores -> resultado financiero.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

import config
import finanzas as fz

VARIABLES = ["ventas", "margen_ebit", "capital_invertido", "wacc", "tasa_ir"]
ETIQUETAS = {"ventas": "Ventas", "margen_ebit": "Margen EBIT", "capital_invertido": "Capital invertido",
             "wacc": "WACC", "tasa_ir": "Tasa de impuesto"}


def evaluar(p: dict) -> dict:
    return fz.resultado_valor(p["ventas"], p["margen_ebit"], p["capital_invertido"], p["wacc"], p["tasa_ir"])


# ----------------------------------------------------------------- Multiperiodo
def proyeccion_multiperiodo(base: dict, anio_inicial: int, n_anios: int, crec_ventas: float,
                            delta_margen_pp: float, crec_capital: float, delta_wacc_pp: float = 0.0) -> pd.DataFrame:
    """Proyecta n años a partir de un punto base aplicando tasas anuales constantes."""
    filas, p = [], dict(base)
    for i in range(1, n_anios + 1):
        p = {**p,
             "ventas": p["ventas"] * (1 + crec_ventas),
             "margen_ebit": p["margen_ebit"] + delta_margen_pp / 100,
             "capital_invertido": p["capital_invertido"] * (1 + crec_capital),
             "wacc": max(0.0001, p["wacc"] + delta_wacc_pp / 100)}
        r = evaluar(p)
        filas.append({"anio": str(anio_inicial + i), **r, "margen_ebit": p["margen_ebit"]})
    df = pd.DataFrame(filas)
    if not df.empty:
        df["eva_acumulado"] = df["eva"].cumsum()
    return df


# ----------------------------------------------------------------- Sensibilidad
def sensibilidad(base: dict, variacion: float = 0.10) -> pd.DataFrame:
    """Tornado: EVA con cada variable a ±variacion (relativa) manteniendo las demás."""
    eva0 = evaluar(base)["eva"]
    filas = []
    for v in ["ventas", "margen_ebit", "capital_invertido", "wacc", "tasa_ir"]:
        baja = evaluar({**base, v: base[v] * (1 - variacion)})["eva"]
        alta = evaluar({**base, v: base[v] * (1 + variacion)})["eva"]
        filas.append({"variable": ETIQUETAS[v], "eva_baja": baja, "eva_alta": alta,
                      "impacto": abs(alta - baja), "eva_base": eva0})
    return pd.DataFrame(filas).sort_values("impacto", ascending=True).reset_index(drop=True)


# ----------------------------------------------------------------- Monte Carlo
def supuestos_desde_escenarios(esc: pd.DataFrame) -> pd.DataFrame:
    """Si no hay supuestos Monte Carlo, usa mín/moda/máx de los escenarios del año."""
    filas = []
    for v in ["ventas", "margen_ebit", "capital_invertido", "wacc", "tasa_ir"]:
        s = esc[v].astype(float)
        moda = float(esc.loc[esc["escenario"] == "Base", v].iloc[0]) if (esc["escenario"] == "Base").any() else float(s.median())
        mn, mx = float(s.min()), float(s.max())
        filas.append({"variable": v, "distribucion": "Fija" if mn == mx else "Triangular",
                      "minimo": min(mn, moda), "moda": moda, "maximo": max(mx, moda)})
    return pd.DataFrame(filas)


def montecarlo(supuestos: pd.DataFrame, n: int = config.MC_ITERACIONES, semilla: int = config.MC_SEMILLA) -> dict:
    """Simula el EVA. supuestos: columnas variable, distribucion, minimo, moda, maximo."""
    rng = np.random.default_rng(int(semilla))
    muestras = {}
    sup = supuestos.set_index("variable")
    for v in VARIABLES:
        if v not in sup.index:
            raise ValueError(f"Falta el supuesto de '{v}' para la simulación.")
        r = sup.loc[v]
        lo, mo, hi = float(r["minimo"]), float(r["moda"]), float(r["maximo"])
        if str(r["distribucion"]).lower().startswith("fij") or lo == hi:
            muestras[v] = np.full(n, mo)
        elif str(r["distribucion"]).lower().startswith("uni"):
            muestras[v] = rng.uniform(lo, hi, n)
        else:
            if not lo <= mo <= hi:
                raise ValueError(f"Supuesto '{v}': debe cumplirse mínimo ≤ moda ≤ máximo.")
            muestras[v] = rng.triangular(lo, mo, hi, n)
    ebit = muestras["ventas"] * muestras["margen_ebit"]
    nopat = ebit * (1 - muestras["tasa_ir"])
    eva = nopat - muestras["wacc"] * muestras["capital_invertido"]
    roic = nopat / muestras["capital_invertido"]
    p10, p50, p90 = np.percentile(eva, [10, 50, 90])
    # Contribución a la varianza (correlación al cuadrado normalizada)
    contrib = {}
    for v in VARIABLES:
        if np.std(muestras[v]) > 0:
            contrib[ETIQUETAS[v]] = float(np.corrcoef(muestras[v], eva)[0, 1] ** 2)
    tot = sum(contrib.values()) or 1.0
    contrib = {k: v / tot for k, v in sorted(contrib.items(), key=lambda x: -x[1])}
    return {"eva": eva, "roic": roic, "p10": float(p10), "p50": float(p50), "p90": float(p90),
            "media": float(eva.mean()), "desv": float(eva.std()), "prob_eva_pos": float((eva > 0).mean()),
            "roic_p50": float(np.median(roic)), "contribucion": contrib, "n": int(n), "semilla": int(semilla),
            "alerta": float((eva > 0).mean()) < config.UMBRAL_PROB_EVA}


# ----------------------------------------------------------------- Simulación BSC
PESOS_BSC_DEFECTO = {"ventas_por_clientes": 0.7, "ventas_por_financiera": 0.3,
                     "margen_por_procesos": 0.7, "margen_por_financiera": 0.3,
                     "capital_por_procesos": 1.0, "efecto_aprendizaje": 0.3}


def logro_por_perspectiva(kpis: pd.DataFrame, logros: dict, objetivos: pd.DataFrame) -> dict:
    """Promedio del logro (0 = línea base, 1 = meta) de los KPI de cada perspectiva."""
    d = kpis.merge(objetivos[["objetivo_id", "perspectiva"]], on="objetivo_id", how="left")
    d["logro"] = d["kpi_id"].map(logros).fillna(1.0)
    return {p: float(d.loc[d["perspectiva"] == p, "logro"].mean()) if (d["perspectiva"] == p).any() else 1.0
            for p in config.PERSPECTIVAS}


def simular_bsc(base: dict, meta: dict, logro: dict, pesos: dict | None = None) -> dict:
    """
    Modelo causal simplificado (hipótesis del mapa estratégico):
      logro_P_efectivo = logro_P × (1 − a + a × logro_A)          (el aprendizaje habilita los procesos)
      Ventas  = Base + (Meta − Base) × (wC × logro_C + wF × logro_F)
      Margen  = Base + (Meta − Base) × (wP × logro_P_ef + wF × logro_F)
      Capital = Base + (Meta − Base) × logro_P_ef
    base y meta son escenarios (año base real y escenario del plan).
    """
    w = {**PESOS_BSC_DEFECTO, **(pesos or {})}
    a = w["efecto_aprendizaje"]
    lp = logro["Procesos"] * (1 - a + a * logro["Aprendizaje"])
    lv = w["ventas_por_clientes"] * logro["Clientes"] + w["ventas_por_financiera"] * logro["Financiera"]
    lm = w["margen_por_procesos"] * lp + w["margen_por_financiera"] * logro["Financiera"]
    p = {"ventas": base["ventas"] + (meta["ventas"] - base["ventas"]) * lv,
         "margen_ebit": base["margen_ebit"] + (meta["margen_ebit"] - base["margen_ebit"]) * lm,
         "capital_invertido": base["capital_invertido"] + (meta["capital_invertido"] - base["capital_invertido"]) * lp * w["capital_por_procesos"],
         "wacc": meta["wacc"], "tasa_ir": meta["tasa_ir"]}
    return {"parametros": p, "resultado": evaluar(p), "logro_procesos_efectivo": lp}
