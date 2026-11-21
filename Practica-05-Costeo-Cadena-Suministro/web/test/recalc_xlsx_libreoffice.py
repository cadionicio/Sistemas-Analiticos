import sys, subprocess, os, openpyxl
src = sys.argv[1]; out = os.path.join(os.path.dirname(src), "lo"); os.makedirs(out, exist_ok=True)
subprocess.run(["soffice", "--headless", "--calc", "--convert-to", "xlsx", "--outdir", out, src], check=True, capture_output=True)
lo = openpyxl.load_workbook(os.path.join(out, os.path.basename(src)), data_only=True)
fo = openpyxl.load_workbook(src); ca = openpyxl.load_workbook(src, data_only=True)
nform = ndif = nerr = nsin = 0; difs = []
for ws in fo.worksheets:
    for row in ws.iter_rows():
        for c in row:
            if isinstance(c.value, str) and c.value.startswith("="):
                nform += 1
                v = lo[ws.title][c.coordinate].value; esp = ca[ws.title][c.coordinate].value
                if isinstance(v, str) and v.startswith("#"): nerr += 1; difs.append((ws.title, c.coordinate, c.value, v)); continue
                if esp is None: nsin += 1; continue
                if isinstance(esp, (int, float)) and isinstance(v, (int, float)):
                    if abs(v - esp) > 1e-6 * max(1, abs(esp)) + 0.005: ndif += 1; difs.append((ws.title, c.coordinate, esp, v))
                elif str(esp) != str(v) and not (esp == "" and v in (None, "")): ndif += 1; difs.append((ws.title, c.coordinate, esp, v))
ctrl = [r[10].value for r in lo["Diagnostico_Presupuesto"].iter_rows(min_row=6) if isinstance(r[10].value, (int, float))] if "Diagnostico_Presupuesto" in lo.sheetnames else [0]
print({"hojas": fo.sheetnames, "formulas": nform, "comparadas": nform - nsin - nerr, "sin_resultado_previo_solo_sin_error": nsin, "diferencias": ndif, "errores": nerr, "control_diag_max_abs": max(abs(x) for x in ctrl), "n_control": len(ctrl), "muestra": difs[:8]})
