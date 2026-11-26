"""Genera PC08.html: la solución HTML en un único archivo (estilos, reglas, almacén IndexedDB y logotipos incluidos)."""
import base64
import re
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parents[1] / "web"
destino = Path(sys.argv[1])
html = (WEB / "index.html").read_text(encoding="utf-8")


def datos_img(ruta):
    b = (WEB / ruta).read_bytes()
    return "data:image/svg+xml;base64," + base64.b64encode(b).decode()


def imagenes(texto):
    return re.sub(r"img/([A-Za-z0-9_.-]+\.svg)", lambda m: datos_img("img/" + m.group(1)), texto)


html = html.replace('<link rel="stylesheet" href="css/app.css">', "<style>\n" + imagenes((WEB / "css/app.css").read_text(encoding="utf-8")) + "\n</style>")
for js in ("xlsx", "dt", "nucleo", "carga", "resultados", "almacen_idb", "almacen_exe", "dt_auto", "dt_graficos", "app"):
    codigo = imagenes((WEB / f"js/{js}.js").read_text(encoding="utf-8"))
    assert "</script" not in codigo.lower(), js
    html = html.replace(f'<script src="js/{js}.js"></script>', f"<script>\n{codigo}\n</script>")
html = imagenes(html)
assert 'src="js/' not in html and 'href="css/' not in html and "img/" not in html.replace("data:image", "")
destino.write_text(html, encoding="utf-8")
print(f"PC08.html generado: {destino} ({len(html.encode()) // 1024} KB)")
