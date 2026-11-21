# -*- coding: utf-8 -*-
"""
autoprueba.py - Pruebas automáticas (QA01-QA18 de 10_Data_Prueba.xlsx, unitarias y motor IA/simulación).

Uso (desde la carpeta Entregable):   python autoprueba.py
Usa una base temporal (gce_ia_prueba.db); no modifica gce_ia.db.
"""
import sys
sys.dont_write_bytecode = True  # carpeta única: no crear __pycache__ en Entregable/
import os
from pathlib import Path

os.environ.setdefault("GCE_BASE_DIR", str(Path(__file__).resolve().parent))

import config  # noqa: E402
import db  # noqa: E402
import finanzas as fz  # noqa: E402

config.DB_PATH = config.ruta("gce_ia_prueba.db")
RESULTADOS = []


def verificar(codigo, descripcion, obtenido, esperado, tol=0.0):
    if isinstance(esperado, str):
        ok = str(obtenido) == esperado
    else:
        ok = obtenido is not None and abs(float(obtenido) - float(esperado)) <= tol
    RESULTADOS.append((codigo, descripcion, obtenido, esperado, "OK" if ok else "FALLA"))


def main() -> int:
    if config.DB_PATH.exists():
        config.DB_PATH.unlink()
    db.inicializar()
    r = db.importar_excel(str(config.DATA_PRUEBA_XLSX), usuario="autoprueba")
    verificar("IMP01", "Importación sin errores", r["ok"], True, 0)
    esc = fz.tabla_escenarios(db.leer("escenarios", "EMP01")).set_index(["anio", "escenario"])
    verificar("QA01", "EVA base 2026", esc.loc[("2026", "Real"), "eva"], 0.060, 0.001)
    verificar("QA02", "EVA 2027 Protección", esc.loc[("2027", "Protección"), "eva"], -0.1506, 0.005)
    verificar("QA03", "EVA 2027 Base", esc.loc[("2027", "Base"), "eva"], 1.6727, 0.005)
    verificar("QA04", "EVA 2027 Expansión", esc.loc[("2027", "Expansión"), "eva"], 2.4352, 0.005)
    verificar("QA05", "ROIC 2027 Base", esc.loc[("2027", "Base"), "roic"], 0.14323, 0.0005)
    e27 = db.leer("escenarios", "EMP01", "anio = ?", ("2027",))
    verificar("QA06", "EVA esperado ponderado 2027", fz.eva_esperado(e27), 1.4075, 0.005)
    fm = fz.tabla_financiera_mensual(db.leer("financieros", "EMP01"))
    meta, real = fm[fm.tipo_valor == "Meta"], fm[fm.tipo_valor == "Real"]
    verificar("QA07", "Ventas meta 2027", meta.ventas.sum(), 127.2, 0.01)
    verificar("QA08", "EBIT meta 2027", meta.ebit.sum(), 14.628, 0.01)
    verificar("QA09", "EVA meta acumulado M1-M6", meta[meta.periodo_id <= "2027-06"].eva.sum(), 0.3637, 0.01)
    verificar("QA10", "EVA real acumulado M1-M6", real.eva.sum(), 0.2672, 0.01)
    verificar("QA11", "Suma de pesos", db.leer("criterios").peso.sum(), 1.0, 1e-6)
    ini = db.leer("iniciativas", "EMP01").set_index("iniciativa_id")
    verificar("QA12", "Puntaje ponderado I01", fz.puntaje_priorizacion(ini.loc["I01", db.PUNTAJES].to_dict()), 4.50, 0.01)
    ia = ini[ini.tipo == "IA"]
    verificar("QA13", "Beneficio neto iniciativas IA", (ia.beneficio_bruto_anual - ia.costo_anual).sum(), 1.65, 0.01)
    verificar("QA14", "N.° objetivos EMP01", len(db.leer("objetivos", "EMP01")), 12, 0)
    verificar("QA15", "N.° KPI EMP01", len(db.leer("kpis", "EMP01")), 17, 0)
    ev = fz.evaluar_kpis(db.leer("kpis", "EMP01"), db.leer("kpi_valores", "EMP01"), "2027-06").set_index("kpi_id")
    verificar("QA16", "Semáforo K05 jun-27", ev.loc["K05", "semaforo"], "VERDE")
    verificar("QA17", "Semáforo K16 jun-27", ev.loc["K16", "semaforo"], "GRIS")
    s = db.leer("seguimiento", "EMP01", "iniciativa_id=? AND periodo_id=?", ("I08", "2027-06")).iloc[0]
    verificar("QA18", "Semáforo I08 jun-27", fz.semaforo_iniciativa(s.avance_plan, s.avance_real), "ROJO")
    # Pruebas unitarias adicionales
    verificar("UT01", "Semáforo MIN ámbar", fz.semaforo_kpi(0.028, 0.027, "MIN", 0.10), "AMBAR")
    verificar("UT02", "Semáforo MAX rojo", fz.semaforo_kpi(0.80, 0.95, "MAX", 0.02), "ROJO")
    verificar("UT03", "Trayectoria mes 6", fz.trayectoria(0.88, 0.95, 6), 0.915, 1e-9)
    verificar("UT04", "Flujo de aprobación versiona", db.cambiar_estado("EMP01", "plan", "Aprobado", "autoprueba")["version"], 1, 0)
    verificar("UT05", "Exportación re-importable", db.importar_excel(db.exportar_excel("EMP01"), validar_solo=True)["ok"], True, 0)
    malo = db.leer("kpis", "EMP01").assign(sentido="SUBIR")
    try:
        db.reemplazar("kpis", malo, "EMP01")
        verificar("UT06", "Validación rechaza dominio inválido", "no rechazó", "rechazó")
    except ValueError:
        verificar("UT06", "Validación rechaza dominio inválido", "rechazó", "rechazó")

    # Paso 4: motor IA y simulación
    import motor_ia as ia  # noqa: E402
    import simulador as sim  # noqa: E402
    mc = sim.montecarlo(db.leer("supuestos_mc", "EMP01", "anio = ?", ("2027",)))
    verificar("UT07", "Monte Carlo EVA P50 2027", mc["p50"], 1.31, 0.05)
    verificar("UT08", "Monte Carlo P(EVA>0) ≥ 60%", mc["prob_eva_pos"] >= 0.60, True, 0)
    emp = db.leer("empresas", "EMP01").iloc[0].to_dict()
    diag = db.leer("diagnostico", "EMP01")
    prop = ia.propuesta_bsc(emp, diag, ia.proponer_estrategias("EMP01", diag, emp["tipo"]),
                            db.leer("escenarios", "EMP01"), "2027")
    verificar("UT09", "Propuesta IA: objetivos", len(prop["objetivos"]), 12, 0)
    verificar("UT10", "Propuesta IA: KPI entre 15 y 25", 15 <= len(prop["kpis"]) <= 25, True, 0)
    val = ia.validar_bsc(prop["objetivos"], prop["relaciones"], prop["kpis"], prop["iniciativas"])
    verificar("UT11", "Propuesta IA sin errores de coherencia", int((val["nivel"] == "ERROR").sum()), 0, 0)
    verificar("UT12", "Meta KPI EVA = EVA escenario Base", prop["kpis"].set_index("nombre").loc["EVA acumulado del año", "meta"], 1.6727, 0.001)
    lp = {p: 1.0 for p in config.PERSPECTIVAS}
    verificar("UT13", "Simulación BSC al 100% = EVA meta", sim.simular_bsc(prop["base_fin"], prop["meta_fin"], lp)["resultado"]["eva"], 1.6727, 0.001)
    lp0 = {p: 0.0 for p in config.PERSPECTIVAS}
    verificar("UT14", "Simulación BSC al 0% = EVA base", sim.simular_bsc(prop["base_fin"], prop["meta_fin"], lp0)["resultado"]["eva"], 0.0600, 0.001)
    base = prop["meta_fin"] | {"capital_invertido": prop["meta_fin"]["capital"]}
    proy = sim.proyeccion_multiperiodo(base, 2027, 3, 0.05, 0.5, 0.02)
    verificar("UT15", "Proyección multiperiodo: 3 años", len(proy), 3, 0)
    verificar("UT16", "Sensibilidad: 5 palancas", len(sim.sensibilidad(base)), 5, 0)

    # Paso 5: Gantt, control, gatillos y reporte PPT
    import io, zipfile  # noqa: E401,E402
    import vistas_control as vc  # noqa: E402
    import reporte_ppt  # noqa: E402
    ini = db.leer("iniciativas", "EMP01")
    gp = ia.proponer_gantt("EMP01", ini, "2027")
    verificar("UT17", "Gantt propuesto: hoja de ruta + 3 fases por iniciativa", len(gp), 7 + 3 * len(ini), 0)
    verificar("UT18", "Gantt propuesto sin errores", int((ia.validar_gantt(gp, ini)["nivel"] == "ERROR").sum()), 0, 0)
    verificar("UT19", "Ruta crítica identificada", bool(ia.analizar_gantt(gp)["critica"].any()), True, 0)
    verificar("UT20", "Avance planificado I01 a jun-27", ia.avance_planificado("2027-02-01", "2027-09-30", "2027-06"), 0.62, 0.01)
    d = vc.calcular_control("EMP01", "2027", "Base", "2027-06")
    verificar("UT21", "EVA acumulado real (control)", d["eva_real"], 0.2672, 0.001)
    verificar("UT22", "Iniciativas en rojo jun-27", ",".join(d["rojas"]), "I08,I10")
    g = d["gat"].set_index("gatillo")
    verificar("UT23", "Gatillo G01 (WAPE) evaluado", g.loc["G01", "estado"], "OK")
    verificar("UT24", "Pronóstico de cierre calculado", int(d["pron"]["cierre_pronosticado"].notna().sum()), 17, 0)
    ppt = reporte_ppt.generar(vc.contexto_reporte("EMP01", "2027", "Base", "2027-06", "autoprueba"))
    n_sl = len([n for n in zipfile.ZipFile(io.BytesIO(ppt)).namelist() if n.startswith("ppt/slides/slide") and n.endswith(".xml")])
    verificar("UT25", "Reporte PPTX con 11 diapositivas", n_sl, 11, 0)

    ancho = max(len(x[1]) for x in RESULTADOS)
    for c, d, o, e, st in RESULTADOS:
        o_ = f"{o:.4f}" if isinstance(o, float) else str(o)
        print(f"{c:6} {d:<{ancho}}  obtenido={o_:<12} esperado={e!s:<10} {st}")
    fallas = sum(1 for x in RESULTADOS if x[4] != "OK")
    print(f"\nTotal: {len(RESULTADOS)} pruebas · OK: {len(RESULTADOS) - fallas} · Fallas: {fallas}")
    config.DB_PATH.unlink(missing_ok=True)
    return 1 if fallas else 0


if __name__ == "__main__":
    sys.exit(main())
