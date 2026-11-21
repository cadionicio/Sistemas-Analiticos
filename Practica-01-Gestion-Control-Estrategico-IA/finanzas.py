# -*- coding: utf-8 -*-
"""
finanzas.py - Funciones puras de cálculo (sin interfaz ni base de datos).

Ecuaciones de control económico (guía BSC-IA 2027, p. 4):
    NOPAT = EBIT × (1 − t)
    ROIC  = NOPAT / Capital invertido
    EVA   = NOPAT − WACC × Capital = (ROIC − WACC) × Capital
"""
from __future__ import annotations

import math
from typing import Iterable

import pandas as pd

from config import PESOS_PRIORIZACION


# ------------------------------------------------------------ Valor económico
def nopat(ebit: float, tasa_ir: float) -> float:
    return float(ebit) * (1.0 - float(tasa_ir))


def roic(nopat_: float, capital: float) -> float:
    return float(nopat_) / float(capital) if capital else 0.0


def eva(nopat_: float, wacc: float, capital: float, meses: int = 12) -> float:
    """EVA del periodo. meses=12 para anual; meses=1 para un mes (cargo WACC/12)."""
    return float(nopat_) - float(wacc) * float(capital) * (meses / 12.0)


def resultado_valor(ventas: float, margen_ebit: float, capital: float, wacc: float, tasa_ir: float) -> dict:
    """Cascada completa para un escenario anual."""
    ebit = float(ventas) * float(margen_ebit)
    n = nopat(ebit, tasa_ir)
    r = roic(n, capital)
    cargo = float(wacc) * float(capital)
    return {"ventas": float(ventas), "ebit": ebit, "nopat": n, "capital": float(capital), "wacc": float(wacc),
            "cargo_capital": cargo, "eva": n - cargo, "roic": r, "spread": r - float(wacc)}


COLS_CALCULADAS = ["ebit", "nopat", "cargo_capital", "eva", "roic", "spread"]


def tabla_escenarios(df: pd.DataFrame) -> pd.DataFrame:
    """Agrega EBIT, NOPAT, cargo de capital, EVA, ROIC y spread a la tabla escenarios."""
    if df.empty:
        return df.assign(ebit=[], nopat=[], cargo_capital=[], eva=[], roic=[], spread=[])
    df = df.drop(columns=[c for c in COLS_CALCULADAS if c in df.columns])   # idempotente
    filas = [resultado_valor(r.ventas, r.margen_ebit, r.capital_invertido, r.wacc, r.tasa_ir) for r in df.itertuples()]
    calc = pd.DataFrame(filas, index=df.index)[["ebit", "nopat", "cargo_capital", "eva", "roic", "spread"]]
    return pd.concat([df, calc], axis=1)


def eva_esperado(df_esc: pd.DataFrame) -> float:
    """EVA ponderado por probabilidad (escenarios de un mismo año)."""
    t = tabla_escenarios(df_esc)
    if t.empty:
        return 0.0
    p = t["probabilidad"].fillna(0)
    return float((t["eva"] * p).sum() / p.sum()) if p.sum() else float(t["eva"].mean())


def tabla_financiera_mensual(df: pd.DataFrame) -> pd.DataFrame:
    """Agrega margen, NOPAT, cargo mensual y EVA mensual/acumulado a financieros."""
    if df.empty:
        return df
    d = df.copy().sort_values(["tipo_valor", "periodo_id"])
    d["margen_ebit"] = d["ebit"] / d["ventas"].where(d["ventas"] != 0)
    d["nopat"] = d["ebit"] * (1 - d["tasa_ir"])
    d["cargo_capital"] = d["wacc_anual"] / 12.0 * d["capital_invertido"]
    d["eva"] = d["nopat"] - d["cargo_capital"]
    d["eva_acum"] = d.groupby(["empresa_id", "escenario", "tipo_valor"])["eva"].cumsum()
    d["roic_anualizado"] = d["nopat"] * 12 / d["capital_invertido"]
    d["spread_pp"] = (d["roic_anualizado"] - d["wacc_anual"]) * 100
    return d


# ------------------------------------------------------------ Trayectoria
def trayectoria(base: float, meta: float, mes: int, meses: int = 12) -> float:
    """Meta del mes m = Base + (Meta − Base) × m / meses (regla RN02)."""
    mes = max(0, min(int(mes), meses))
    return float(base) + (float(meta) - float(base)) * mes / meses


def trayectoria_serie(base: float, meta: float, anio: int = 2027, meses: int = 12) -> list[tuple[str, float]]:
    return [(f"{anio}-{m:02d}", round(trayectoria(base, meta, m, meses), 6)) for m in range(1, meses + 1)]


# ------------------------------------------------------------ Semáforos
def semaforo_kpi(real, meta_traj, sentido: str = "MAX", tolerancia: float = 0.05,
                 calidad: str = "Certificado") -> str:
    """Regla RN03. Devuelve VERDE, AMBAR, ROJO, GRIS o N/A."""
    if real is None or meta_traj is None or _nan(real) or _nan(meta_traj):
        return "N/A"
    if str(calidad).strip().lower() != "certificado":
        return "GRIS"
    real, meta_traj = float(real), float(meta_traj)
    tol = abs(float(tolerancia or 0))
    s = (sentido or "MAX").upper()
    if s == "MAX":
        if real >= meta_traj:
            return "VERDE"
        return "AMBAR" if real >= meta_traj - abs(meta_traj) * tol else "ROJO"
    if s == "MIN":
        if real <= meta_traj:
            return "VERDE"
        return "AMBAR" if real <= meta_traj + abs(meta_traj) * tol else "ROJO"
    if s == "RANGO":
        lim = abs(meta_traj)
        if abs(real) <= lim:
            return "VERDE"
        return "AMBAR" if abs(real) <= lim * (1 + tol) else "ROJO"
    raise ValueError(f"Sentido desconocido: {sentido}")


def cumplimiento(real, meta_traj, sentido: str = "MAX") -> float | None:
    """Índice de cumplimiento (1.0 = en trayectoria; se acota a 0–150 % para lectura gerencial)."""
    v = _cumplimiento_bruto(real, meta_traj, sentido)
    return None if v is None else max(0.0, min(1.5, v))


def _cumplimiento_bruto(real, meta_traj, sentido: str = "MAX") -> float | None:
    if real is None or meta_traj is None or _nan(real) or _nan(meta_traj):
        return None
    real, meta_traj = float(real), float(meta_traj)
    s = (sentido or "MAX").upper()
    if s == "MAX":
        return real / meta_traj if meta_traj else (1.0 if real >= 0 else 0.0)
    if s == "MIN":
        return meta_traj / real if real else 1.0
    return abs(meta_traj) / abs(real) if real else 1.0


def semaforo_iniciativa(avance_plan, avance_real, tolerancia_pp: float = 0.05) -> str:
    """Regla RN10."""
    if avance_plan is None or _nan(avance_plan) or float(avance_plan) == 0:
        return "N/A"
    if avance_real is None or _nan(avance_real):
        return "GRIS"
    brecha = float(avance_real) - float(avance_plan)
    if brecha >= 0:
        return "VERDE"
    return "AMBAR" if brecha >= -tolerancia_pp - 1e-9 else "ROJO"


def evaluar_kpis(kpis: pd.DataFrame, valores: pd.DataFrame, periodo_id: str) -> pd.DataFrame:
    """Une ficha KPI + meta de trayectoria + real del periodo y calcula el semáforo."""
    cols = ["kpi_id", "objetivo_id", "nombre", "unidad", "sentido", "linea_base", "meta",
            "tolerancia_ambar", "responsable"]
    if kpis.empty:
        return pd.DataFrame(columns=cols + ["meta_periodo", "real", "calidad_dato", "semaforo", "cumplimiento"])
    base = kpis[[c for c in cols if c in kpis.columns]].copy()
    v = valores[valores["periodo_id"] == periodo_id] if not valores.empty else valores
    meta = v[v["tipo_valor"] == "Meta"][["kpi_id", "valor"]].rename(columns={"valor": "meta_periodo"})
    real = v[v["tipo_valor"] == "Real"][["kpi_id", "valor", "calidad_dato"]].rename(columns={"valor": "real"})
    out = base.merge(meta, on="kpi_id", how="left").merge(real, on="kpi_id", how="left")
    # Si no hay meta registrada para el periodo, se usa la trayectoria lineal.
    mes = _mes_de_periodo(periodo_id)
    faltan = out["meta_periodo"].isna()
    if mes and faltan.any():
        out.loc[faltan, "meta_periodo"] = [trayectoria(b, m, mes) for b, m in
                                            zip(out.loc[faltan, "linea_base"], out.loc[faltan, "meta"])]
    out["calidad_dato"] = out["calidad_dato"].fillna("Certificado")
    out["semaforo"] = [semaforo_kpi(r, m, s, t, c) for r, m, s, t, c in
                       zip(out["real"], out["meta_periodo"], out["sentido"], out["tolerancia_ambar"], out["calidad_dato"])]
    out["cumplimiento"] = [cumplimiento(r, m, s) for r, m, s in zip(out["real"], out["meta_periodo"], out["sentido"])]
    return out


# ------------------------------------------------------------ Priorización
def puntaje_priorizacion(puntajes: dict, pesos: dict | None = None) -> float:
    """Regla RN04: Σ(peso × calificación 1-5)."""
    pesos = pesos or PESOS_PRIORIZACION
    total = 0.0
    for k, w in pesos.items():
        v = puntajes.get(k)
        if v is None or _nan(v):
            continue
        v = float(v)
        if not 1 <= v <= 5:
            raise ValueError(f"Puntaje fuera de rango 1-5 en {k}: {v}")
        total += float(w) * v
    return round(total, 2)


def validar_pesos(pesos: dict) -> bool:
    return math.isclose(sum(float(x) for x in pesos.values()), 1.0, abs_tol=1e-6)


def beneficio_iniciativa(beneficio_bruto: float, costo_anual: float, capital_liberado: float,
                         wacc: float, tasa_ir: float = 0.295) -> dict:
    """Regla RN05: beneficio neto, beneficio de capital y EVA incremental."""
    neto = float(beneficio_bruto or 0) - float(costo_anual or 0)
    cap = float(capital_liberado or 0)
    return {"beneficio_neto": neto, "beneficio_capital": cap * float(wacc),
            "eva_incremental": neto * (1 - float(tasa_ir)) + cap * float(wacc)}


# ------------------------------------------------------------ Utilitarios
def _nan(x) -> bool:
    try:
        return x is None or (isinstance(x, float) and math.isnan(x)) or pd.isna(x)
    except (TypeError, ValueError):
        return False


def _mes_de_periodo(periodo_id: str) -> int | None:
    try:
        return int(str(periodo_id).split("-")[1])
    except (IndexError, ValueError):
        return None


def ultimo_periodo_con_real(valores: pd.DataFrame) -> str | None:
    if valores is None or valores.empty:
        return None
    r = valores[(valores["tipo_valor"] == "Real") & valores["periodo_id"].astype(str).str.contains("-")]
    return None if r.empty else str(r["periodo_id"].max())


def fmt_monto(x, dec: int = 2, moneda: str = "S/") -> str:
    if x is None or _nan(x):
        return "—"
    s = f"{abs(float(x)):,.{dec}f} m"
    return f"-{moneda} {s}" if float(x) < 0 else f"{moneda} {s}"


def fmt_valor(x, unidad: str = "") -> str:
    if x is None or _nan(x):
        return "—"
    x = float(x)
    if unidad == "%":
        return f"{x * 100:.1f}%"
    if unidad == "pp":
        return f"{x:+.2f} pp"
    if unidad == "S/ m":
        return fmt_monto(x)
    if unidad == "x":
        return f"{x:.2f}x"
    return f"{x:,.2f}"


def serie_meses(anio: int) -> Iterable[str]:
    return [f"{anio}-{m:02d}" for m in range(1, 13)]
