# Recalcula un libro con LibreOffice (recalculo forzado al cargar) y lista celdas con error y valores pedidos.
# Uso: python3 recalcular.py <xlsx> <salida_dir> [Hoja!Celda ...]
import sys, subprocess, os, json
from openpyxl import load_workbook
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
subprocess.run(['soffice', '-env:UserInstallation=file:///tmp/lo_perfil', '--headless', '--calc', '--convert-to', 'xlsx', '--outdir', out, src], check=True, capture_output=True, timeout=120)
dst = os.path.join(out, os.path.basename(src))
wb = load_workbook(dst, data_only=True)
errores = []
for ws in wb.worksheets:
    for row in ws.iter_rows():
        for c in row:
            if isinstance(c.value, str) and c.value.startswith('#') and c.value.rstrip('!?').upper() in ('#REF', '#VALUE', '#DIV/0', '#NAME', '#N/A', '#NUM', '#NULL'):
                errores.append(f'{ws.title}!{c.coordinate}={c.value}')
vals = {}
for ref in sys.argv[3:]:
    h, cel = ref.split('!')
    vals[ref] = wb[h][cel].value
print(json.dumps({'errores': errores, 'valores': vals, 'hojas': wb.sheetnames}, ensure_ascii=False))
