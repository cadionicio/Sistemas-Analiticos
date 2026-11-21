# -*- coding: utf-8 -*-
"""
CANVAS MODEL IA - Motor predictivo y de simulación (forecast.py)
-----------------------------------------------------------------
- Predicción del mes +1 por KPI (P10 / P50 / P90) con jerarquía de modelos
  según la cantidad de observaciones (Propuesta Técnica, sección 8.2).
- Backtesting walk-forward (sin fuga temporal), MAE, WAPE, sesgo y mejora
  frente al modelo naive; selección campeón-retador; abstención (Gris).
- Semáforos de KPI (sección 8.4) y de proyectos (SPI / CPI).
- Simulación Monte Carlo multiperiodo y multiescenario.

Implementado solo con numpy/pandas para que funcione igual en el .EXE y en
la versión HTML (Pyodide).
"""
from __future__ import annotations

import hashlib
import json
from typing import Callable

import numpy as np
import pandas as pd

Z90 = 1.2816  # cuantil 90 % de la normal estándar


# ----------------------------------------------------------------------------
# Modelos de un paso (reciben la serie histórica y devuelven el siguiente valor)
# ----------------------------------------------------------------------------
def m_naive(y: np.ndarray) -> float:
    return float(y[-1])


def m_media_movil(y: np.ndarray, k: int = 3) -> float:
    return float(np.mean(y[-k:]))


def m_tendencia(y: np.ndarray) -> float:
    n = min(len(y), 12)
    x = np.arange(n)
    b, a = np.polyfit(x, y[-n:], 1)
    return float(a + b * n)


def m_naive_estacional(y: np.ndarray, s: int = 12) -> float:
    """Valor del mismo mes del año anterior ajustado por el nivel reciente."""
    if len(y) < 2 * s:
        return m_naive(y)
    ult = np.mean(y[-3:])
    ant = np.mean(y[-s - 3:-s])
    return float(y[-s] * (ult / ant if ant else 1.0))


def _holt(y: np.ndarray, alpha: float, beta: float, phi: float) -> tuple[float, float]:
    nivel, tend = y[0], (y[1] - y[0]) if len(y) > 1 else 0.0
    sse = 0.0
    for t in range(1, len(y)):
        pred = nivel + phi * tend
        sse += (y[t] - pred) ** 2
        nuevo = alpha * y[t] + (1 - alpha) * (nivel + phi * tend)
        tend = beta * (nuevo - nivel) + (1 - beta) * phi * tend
        nivel = nuevo
    return float(nivel + phi * tend), sse


def m_holt(y: np.ndarray) -> float:
    """Holt con tendencia amortiguada; parámetros por búsqueda en grilla (SSE)."""
    mejor = None
    for a in (0.2, 0.4, 0.6, 0.8):
        for b in (0.05, 0.15, 0.3):
            f, sse = _holt(y, a, b, 0.9)
            if mejor is None or sse < mejor[1]:
                mejor = (f, sse)
    return mejor[0]


def m_holt_winters(y: np.ndarray, s: int = 12) -> float:
    """Holt-Winters aditivo simplificado (requiere >= 2 temporadas)."""
    if len(y) < 2 * s:
        return m_holt(y)
    mejor = None
    for a in (0.2, 0.5):
        for g in (0.1, 0.3):
            nivel = np.mean(y[:s])
            tend = (np.mean(y[s:2 * s]) - np.mean(y[:s])) / s
            est = list(y[:s] - nivel)
            sse = 0.0
            for t in range(s, len(y)):
                pred = nivel + tend + est[t - s]
                sse += (y[t] - pred) ** 2
                nuevo = a * (y[t] - est[t - s]) + (1 - a) * (nivel + tend)
                tend = 0.1 * (nuevo - nivel) + 0.9 * tend
                est.append(g * (y[t] - nuevo) + (1 - g) * est[t - s])
                nivel = nuevo
            f = nivel + tend + est[len(y) - s]
            if mejor is None or sse < mejor[1]:
                mejor = (float(f), sse)
    return mejor[0]


MODELOS: dict[str, Callable[[np.ndarray], float]] = {
    "Naive": m_naive,
    "Media móvil 3": m_media_movil,
    "Tendencia lineal": m_tendencia,
    "Holt amortiguado": m_holt,
    "Naive estacional": m_naive_estacional,
    "Holt-Winters": m_holt_winters,
}


def candidatos(n: int) -> list[str]:
    """Jerarquía de modelos por número de observaciones (sección 8.2)."""
    if n < 6:
        return []
    c = ["Naive", "Media móvil 3", "Tendencia lineal"]
    if n >= 18:
        c.append("Holt amortiguado")
    if n >= 24:
        c.append("Naive estacional")
    if n >= 36:
        c.append("Holt-Winters")
    return c


def confianza(n: int) -> str:
    return "Sin predicción estadística" if n < 6 else "Baja" if n < 18 else "Media" if n < 36 else "Alta"


# ----------------------------------------------------------------------------
# Backtesting walk-forward
# ----------------------------------------------------------------------------
def backtest(y: np.ndarray, modelo: str, k: int) -> tuple[np.ndarray, np.ndarray]:
    """Pronostica cada uno de los últimos k puntos usando solo datos anteriores."""
    f = MODELOS[modelo]
    preds, reales = [], []
    for t in range(len(y) - k, len(y)):
        preds.append(f(y[:t]))
        reales.append(y[t])
    return np.array(preds), np.array(reales)


def metricas(pred: np.ndarray, real: np.ndarray) -> dict:
    err = real - pred
    denom = np.sum(np.abs(real))
    return {"mae": float(np.mean(np.abs(err))),
            "wape": float(np.sum(np.abs(err)) / denom * 100) if denom > 1e-9 else None,
            "sesgo": float(np.mean(pred - real)),
            "residuos": err}


# ----------------------------------------------------------------------------
# Semáforos
# ----------------------------------------------------------------------------
def semaforo_kpi(p10: float | None, p50: float | None, p90: float | None, meta: float | None,
                 tol_pct: float | None, sentido: str) -> str:
    """Verde / Ámbar / Rojo / Gris según la sección 8.4 de la propuesta técnica."""
    if p50 is None or meta is None or pd.isna(meta):
        return "Gris"
    tol = (tol_pct or 0) / 100
    if sentido == "Menor es mejor":
        umbral = meta * (1 + tol)
        if p50 <= meta and p90 <= umbral:
            return "Verde"
        if p50 > umbral and p10 > meta:
            return "Rojo"
        return "Ámbar"
    umbral = meta * (1 - tol)
    if p50 >= meta and p10 >= umbral:
        return "Verde"
    if p50 < umbral and p90 < meta:
        return "Rojo"
    return "Ámbar"


def semaforo_meta_mes(p10, p50, p90, plan, tol_pct, sentido) -> str:
    """Semáforo contra el valor planificado del mes (si existe) en vez de la meta final."""
    return semaforo_kpi(p10, p50, p90, plan, tol_pct, sentido)


def evm(avance_real: float | None, avance_plan: float | None, costo_real: float | None, presupuesto: float | None) -> dict:
    """Valor ganado simplificado: SPI y CPI."""
    spi = cpi = None
    if avance_real is not None and avance_plan:
        spi = avance_real / avance_plan
    if avance_real is not None and costo_real and presupuesto:
        cpi = (avance_real / 100 * presupuesto) / costo_real
    return {"spi": spi, "cpi": cpi}


def semaforo_proyecto(spi: float | None, cpi: float | None, verde: float = 0.95, ambar: float = 0.85) -> str:
    vals = [v for v in (spi, cpi) if v is not None and not pd.isna(v)]
    if not vals:
        return "Gris"
    m = min(vals)
    return "Verde" if m >= verde else ("Ámbar" if m >= ambar else "Rojo")


# ----------------------------------------------------------------------------
# Escenarios
# ----------------------------------------------------------------------------
def factor_escenario(kpi: dict, esc: dict | None) -> float:
    """Factor multiplicativo del escenario según la naturaleza del KPI."""
    if not esc:
        return 1.0
    fd, fp, fc = (float(esc.get("factor_demanda") or 1), float(esc.get("factor_precio") or 1),
                  float(esc.get("factor_costo") or 1))
    unidad = kpi.get("unidad") if isinstance(kpi.get("unidad"), str) else ""
    unidad = unidad.strip()
    if kpi.get("sentido") == "Menor es mejor":
        return fc  # costos / mermas / churn empeoran si sube el factor de costo
    if unidad in ("S/", "PEN", "USD", "$"):
        return fd * fp
    return fd


# ----------------------------------------------------------------------------
# Predicción del mes +1
# ----------------------------------------------------------------------------
def predecir(serie: pd.DataFrame, kpi: dict, esc: dict | None = None, min_obs: int = 6) -> dict:
    """Predice el mes siguiente de un KPI.

    serie: DataFrame con columnas periodo (AAAA-MM), valor_real, valor_plan.
    Retorna dict con modelo, p10, p50, p90, métricas, semáforo y advertencia.
    """
    s = serie.sort_values("periodo")
    reales = s.dropna(subset=["valor_real"])
    n = len(reales)
    fecha_corte = reales["periodo"].iloc[-1] if n else None
    if fecha_corte:
        objetivo = str(pd.Period(fecha_corte, "M") + 1)
    else:
        objetivo = str(pd.Timestamp.today().to_period("M"))
    plan_obj = s.loc[s["periodo"] == objetivo, "valor_plan"]
    plan_obj = float(plan_obj.iloc[0]) if len(plan_obj) and pd.notna(plan_obj.iloc[0]) else None
    fac = factor_escenario(kpi, esc)
    dataset_hash = hashlib.sha256(json.dumps(reales[["periodo", "valor_real"]].values.tolist(), default=str)
                                  .encode()).hexdigest()[:16]
    base = {"kpi_id": kpi.get("kpi_id"), "fecha_corte": fecha_corte or "-", "periodo_objetivo": objetivo,
            "n_obs": n, "dataset_hash": dataset_hash, "plan_objetivo": plan_obj, "confianza": confianza(n),
            "escenario_id": (esc or {}).get("escenario_id"), "backtest": None, "ranking": []}

    # --- Abstención: escenario experto (menos de min_obs observaciones) ---
    if n < max(min_obs, 1):
        ref = plan_obj if plan_obj is not None else (float(reales["valor_real"].iloc[-1]) if n else None)
        if ref is None:
            return {**base, "modelo": "Sin datos", "p10": None, "p50": None, "p90": None, "mae": None, "wape": None,
                    "sesgo": None, "mejora_vs_naive": None, "semaforo": "Gris",
                    "advertencia": "No hay evidencia suficiente: sin observaciones ni plan."}
        p50 = ref * fac
        return {**base, "modelo": "Escenario experto", "p10": p50 * 0.8, "p50": p50, "p90": p50 * 1.2,
                "mae": None, "wape": None, "sesgo": None, "mejora_vs_naive": None, "semaforo": "Gris",
                "advertencia": f"Datos insuficientes ({n} obs. < {min_obs}). Se muestra escenario experto "
                               "(bajo/base/alto = ±20 % del plan); no es una probabilidad calibrada."}

    y = reales["valor_real"].astype(float).to_numpy()
    k = max(2, min(6, n - 4))
    resultados = []
    for nombre in candidatos(n):
        p, r = backtest(y, nombre, k)
        met = metricas(p, r)
        resultados.append({"modelo": nombre, **met, "pred_bt": p, "real_bt": r})
    naive = next(x for x in resultados if x["modelo"] == "Naive")
    ranking = sorted(resultados, key=lambda x: x["mae"])
    campeon = ranking[0]
    # Ensamble de los dos mejores si mejora (n >= 36)
    if n >= 36 and len(ranking) >= 2:
        p_ens = (ranking[0]["pred_bt"] + ranking[1]["pred_bt"]) / 2
        met_e = metricas(p_ens, ranking[0]["real_bt"])
        if met_e["mae"] < campeon["mae"]:
            f1, f2 = MODELOS[ranking[0]["modelo"]], MODELOS[ranking[1]["modelo"]]
            campeon = {"modelo": f"Ensamble ({ranking[0]['modelo']} + {ranking[1]['modelo']})", **met_e,
                       "pred_bt": p_ens, "real_bt": ranking[0]["real_bt"],
                       "_fn": lambda z, f1=f1, f2=f2: (f1(z) + f2(z)) / 2}
    advert = []
    if campeon["mae"] >= naive["mae"] and campeon["modelo"] != "Naive":
        advert.append("El retador no supera al naive: se publica el naive (campeón vigente).")
        campeon = naive
    fn = campeon.get("_fn") or MODELOS[campeon["modelo"]]
    p50_base = fn(y)
    res = campeon["residuos"]
    if len(res) >= 5:
        q10, q90 = np.quantile(res, 0.10), np.quantile(res, 0.90)
        sd = float(np.std(res, ddof=1))
        q10, q90 = min(q10, -Z90 * sd * 0.5), max(q90, Z90 * sd * 0.5)
    else:
        sd = float(np.std(res, ddof=1)) if len(res) > 1 else abs(p50_base) * 0.1
        q10, q90 = -Z90 * sd * 1.25, Z90 * sd * 1.25
    p50 = p50_base * fac
    p10, p90 = p50 + q10 * fac, p50 + q90 * fac
    if kpi.get("unidad") == "%":
        p10, p50, p90 = (float(np.clip(v, 0, 100)) for v in (p10, p50, p90))
    elif min(y) >= 0:
        p10 = max(0.0, p10)
    if n < 18:
        advert.append(f"Confianza baja: solo {n} observaciones.")
    if campeon["wape"] is None:
        advert.append("WAPE no calculado (denominador ≈ 0).")
    q1_, q3_ = np.percentile(y, [25, 75])
    iqr = q3_ - q1_
    if iqr > 0 and ((y > q3_ + 3 * iqr) | (y < q1_ - 3 * iqr)).any():
        advert.append("Se detectaron valores atípicos en la historia.")
    if fac != 1:
        advert.append(f"Aplicado factor de escenario {fac:.3f}.")
    meta_ref = plan_obj if plan_obj is not None else kpi.get("meta")
    sem = semaforo_kpi(p10, p50, p90, meta_ref, kpi.get("tolerancia_pct"), kpi.get("sentido", "Mayor es mejor"))
    mejora = (1 - campeon["mae"] / naive["mae"]) * 100 if naive["mae"] > 0 else 0.0
    return {**base, "modelo": campeon["modelo"], "p10": float(p10), "p50": float(p50), "p90": float(p90),
            "mae": campeon["mae"], "wape": campeon["wape"], "sesgo": campeon["sesgo"],
            "mejora_vs_naive": float(mejora), "semaforo": sem,
            "advertencia": " ".join(advert) or "Sin alertas de calidad. Referencia del semáforo: " + (
                "plan del mes" if plan_obj is not None else "meta final"),
            "backtest": pd.DataFrame({"periodo": reales["periodo"].iloc[-k:].to_list(),
                                      "real": campeon["real_bt"], "pronostico": campeon["pred_bt"]}),
            "ranking": [{"modelo": r["modelo"], "MAE": r["mae"], "WAPE %": r["wape"], "Sesgo": r["sesgo"]} for r in ranking]}


# ----------------------------------------------------------------------------
# Simulación multiperiodo (Monte Carlo)
# ----------------------------------------------------------------------------
def simular(serie: pd.DataFrame, kpi: dict, esc: dict | None, horizonte: int = 12,
            iteraciones: int = 500, semilla: int = 42, rampa: int = 3) -> pd.DataFrame:
    """Simula trayectorias futuras del KPI bajo un escenario.

    - Pronóstico recursivo con el mejor modelo disponible.
    - El factor del escenario se aplica gradualmente durante 'rampa' meses.
    - Ruido gaussiano con la desviación de los residuos del backtesting.
    Retorna DataFrame: periodo, p10, p50, p90.
    """
    s = serie.sort_values("periodo")
    reales = s.dropna(subset=["valor_real"])
    n = len(reales)
    if n == 0:
        return pd.DataFrame(columns=["periodo", "p10", "p50", "p90"])
    y = reales["valor_real"].astype(float).to_numpy()
    ultimo = pd.Period(reales["periodo"].iloc[-1], "M")
    periodos = [str(ultimo + h) for h in range(1, horizonte + 1)]
    fac = factor_escenario(kpi, esc)
    rng = np.random.default_rng(int(semilla))
    if n < 6:
        # escenario experto: se usa el plan (o el último valor) con ±20 % uniforme
        planes = s.set_index("periodo")["valor_plan"].to_dict()
        base = np.array([planes.get(p, np.nan) for p in periodos], dtype=float)
        base = np.where(np.isnan(base), y[-1], base)
        mult = np.array([1 + (fac - 1) * min(1, (h + 1) / rampa) for h in range(horizonte)])
        sims = base * mult * rng.uniform(0.8, 1.2, size=(iteraciones, horizonte))
    else:
        cands = candidatos(n)
        k = max(2, min(6, n - 4))
        mejor, mejor_mae, res = "Naive", None, None
        for c in cands:
            p, r = backtest(y, c, k)
            mae = float(np.mean(np.abs(r - p)))
            if mejor_mae is None or mae < mejor_mae:
                mejor, mejor_mae, res = c, mae, r - p
        sd = float(np.std(res, ddof=1)) if res is not None and len(res) > 1 else abs(y[-1]) * 0.05
        f = MODELOS[mejor]
        # trayectoria central recursiva
        hist = list(y)
        central = []
        for h in range(horizonte):
            v = f(np.array(hist))
            central.append(v)
            hist.append(v)
        central = np.array(central)
        mult = np.array([1 + (fac - 1) * min(1, (h + 1) / rampa) for h in range(horizonte)])
        # caminata aleatoria: la incertidumbre crece con la raíz del horizonte
        ruido = np.cumsum(rng.normal(0, sd, size=(iteraciones, horizonte)), axis=1)
        sims = (central + ruido) * mult
    if kpi.get("unidad") == "%":
        sims = np.clip(sims, 0, 100)
    elif y.min() >= 0:
        sims = np.clip(sims, 0, None)
    return pd.DataFrame({"periodo": periodos,
                         "p10": np.percentile(sims, 10, axis=0),
                         "p50": np.percentile(sims, 50, axis=0),
                         "p90": np.percentile(sims, 90, axis=0)})
