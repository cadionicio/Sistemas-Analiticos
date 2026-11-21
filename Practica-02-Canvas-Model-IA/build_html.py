# -*- coding: utf-8 -*-
"""
CANVAS MODEL IA - Generador de la versión HTML (build_html.py)
--------------------------------------------------------------
Empaqueta el mismo código Python y la data de prueba dentro de
./Entregable/CANVAS_MODEL_IA.html usando stlite (Streamlit + Pyodide/WebAssembly).

Uso:  python ./Entregable/build_html.py
"""
from __future__ import annotations

import base64
import json
import os

STLITE = "1.9.1"
BASE = os.path.dirname(os.path.abspath(__file__))
SALIDA = os.path.join(BASE, "CANVAS_MODEL_IA.html")
MODULOS = ["canvas_app.py", "db.py", "ia_engine.py", "forecast.py", "reports.py"]

PLANTILLA = """<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
<title>CANVAS MODEL IA</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@stlite/browser@__V__/build/stlite.css">
<style>
  body {{ margin: 0; font-family: "Segoe UI", Arial, sans-serif; background: #F5F7FA; }}
  .cm-splash {{ min-height: 100vh; display: flex; align-items: center; justify-content: center; }}
  .cm-card {{ background: #0B3C5D; color: #fff; padding: 36px 44px; border-radius: 14px; max-width: 560px;
             box-shadow: 0 10px 30px rgba(11,60,93,.25); }}
  .cm-card h1 {{ margin: 0 0 8px 0; font-size: 28px; }}
  .cm-card p {{ margin: 6px 0; color: #D6E4F0; line-height: 1.45; }}
  .cm-bar {{ height: 6px; background: #1D70B8; border-radius: 3px; margin-top: 18px; overflow: hidden; position: relative; }}
  .cm-bar::after {{ content: ""; position: absolute; left: -40%; width: 40%; height: 100%; background: #F59E0B;
                   animation: cm 1.4s infinite; }}
  @keyframes cm {{ from {{ left: -40%; }} to {{ left: 100%; }} }}
</style>
</head>
<body>
<div id="root">
  <div class="cm-splash"><div class="cm-card">
    <h1>&#129517; CANVAS MODEL IA</h1>
    <p>Cargando el sistema en su navegador (Python + WebAssembly)...</p>
    <p>La primera carga puede tardar entre 1 y 3 minutos y requiere conexión a internet para descargar el motor.
       Los datos se guardan en este navegador (IndexedDB).</p>
    <p>Usuario demo: <b>admin</b> &nbsp; Contraseña: <b>Admin2026!</b></p>
    <div class="cm-bar"></div>
  </div></div>
</div>
<script type="module">
import {{ mount }} from "https://cdn.jsdelivr.net/npm/@stlite/browser@__V__/build/stlite.js";
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const archivos = {archivos};
archivos["10_Data_Prueba.xlsx"] = {{ data: b64({xlsx}) }};
mount({{
  entrypoint: "canvas_app.py",
  prebuiltPackageNames: ["sqlite3"],
  requirements: ["pandas", "numpy", "plotly", "openpyxl", "python-pptx"],
  idbfsMountpoints: ["/home/pyodide/Entregable"],
  streamlitConfig: {{
    "theme.base": "light",
    "theme.primaryColor": "#1D70B8",
    "client.toolbarMode": "viewer"
  }},
  files: archivos
}}, document.getElementById("root"));
</script>
</body>
</html>
"""


def main() -> None:
    archivos = {}
    for m in MODULOS:
        with open(os.path.join(BASE, m), encoding="utf-8") as f:
            archivos[m] = f.read()
    with open(os.path.join(BASE, "10_Data_Prueba.xlsx"), "rb") as f:
        xlsx = base64.b64encode(f.read()).decode("ascii")
    html = PLANTILLA.format(archivos=json.dumps(archivos, ensure_ascii=False).replace("</", "<\\/"),
                            xlsx=json.dumps(xlsx)).replace("__V__", STLITE)
    with open(SALIDA, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"Generado: {SALIDA} ({os.path.getsize(SALIDA) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
