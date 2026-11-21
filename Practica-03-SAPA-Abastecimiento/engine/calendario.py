"""Utilidades de calendario del horizonte de planificacion.

Los meses son una simplificacion pedagogica comoda para presentar el plan, pero
la emision real de una orden ocurre en una FECHA. Este modulo mantiene ambas
representaciones consistentes para que el sistema pueda declarar cuando una
compra del horizonte ya nace atrasada respecto de la fecha de corte.
"""

from __future__ import annotations

from datetime import date, timedelta

DIAS_MES: float = 30.4375


def siguiente_mes(anio: int, mes: int) -> tuple[int, int]:
    """Devuelve el mes siguiente como (anio, mes)."""
    return (anio + 1, 1) if mes == 12 else (anio, mes + 1)


def periodos_horizonte(fecha_corte: str, n_meses: int) -> list[str]:
    """Genera las etiquetas AAAA-MM del horizonte posterior a la fecha de corte.

    Args:
        fecha_corte: ultimo dia con informacion completa, ISO AAAA-MM-DD.
        n_meses: numero de meses a planificar.

    Returns:
        list[str]: etiquetas de periodo en orden cronologico.
    """
    f = date.fromisoformat(fecha_corte)
    anio, mes = siguiente_mes(f.year, f.month)
    salida: list[str] = []
    for _ in range(n_meses):
        salida.append(f"{anio:04d}-{mes:02d}")
        anio, mes = siguiente_mes(anio, mes)
    return salida


def inicio_de_periodo(periodo: str) -> date:
    """Primer dia del periodo AAAA-MM."""
    anio, mes = periodo.split("-")
    return date(int(anio), int(mes), 1)


def fin_de_periodo(periodo: str) -> date:
    """Ultimo dia del periodo AAAA-MM."""
    anio, mes = int(periodo[:4]), int(periodo[5:7])
    a2, m2 = siguiente_mes(anio, mes)
    return date(a2, m2, 1) - timedelta(days=1)


def dias_del_periodo(periodo: str) -> int:
    """Numero de dias calendario del periodo."""
    return fin_de_periodo(periodo).day


def fecha_emision(periodo_recepcion: str, lead_time_dias: float) -> date:
    """Fecha en que debe emitirse la orden para recibir al inicio del periodo.

    Args:
        periodo_recepcion: periodo en que el material debe estar disponible.
        lead_time_dias: plazo total desde emision hasta disponibilidad.

    Returns:
        date: fecha limite de emision.
    """
    return inicio_de_periodo(periodo_recepcion) - timedelta(days=int(round(lead_time_dias)))


def emision_vencida(periodo_recepcion: str, lead_time_dias: float, fecha_corte: str) -> bool:
    """Indica si la fecha limite de emision ya paso al momento del corte.

    Una canasta puede ser materialmente correcta y temporalmente inejecutable.
    Declararlo es obligatorio: el balance material no demuestra factibilidad.
    """
    return fecha_emision(periodo_recepcion, lead_time_dias) < date.fromisoformat(fecha_corte)


def meses_de_lead_time(lead_time_dias: float) -> float:
    """Convierte un plazo en dias a meses equivalentes."""
    return float(lead_time_dias) / DIAS_MES
