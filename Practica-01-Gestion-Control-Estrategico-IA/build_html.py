# -*- coding: utf-8 -*-
"""
build_html.py - Genera 8_GCE_IA.html (versión web local del sistema).

La página usa stlite (Streamlit sobre Pyodide/WebAssembly): el mismo código
Python del EXE se ejecuta dentro del navegador, sin servidor.
  * Incrusta todos los módulos .py y 10_Data_Prueba.xlsx en un único HTML.
  * La base SQLite se guarda en el almacenamiento del navegador (IndexedDB,
    carpeta virtual /gce), por lo que los datos persisten entre sesiones.
  * La primera carga descarga el motor Python (stlite/Pyodide) y las librerías
    desde CDN (jsdelivr y PyPI): requiere Internet; luego el navegador lo cachea.

Uso (desde la carpeta Entregable):   python build_html.py
"""
import sys
sys.dont_write_bytecode = True
import base64
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent
SALIDA = BASE / "8_GCE_IA.html"
STLITE = "1.9.1"
MODULOS = ["app.py", "config.py", "db.py", "ui.py", "finanzas.py", "simulador.py",
           "motor_ia.py", "reporte_ppt.py", "vistas_base.py", "vistas_plan.py",
           "vistas_bsc.py", "vistas_control.py"]
DATA = "10_Data_Prueba.xlsx"
REQUISITOS = ["plotly==6.3.0", "openpyxl==3.1.5", "python-pptx==1.0.2", "sqlite3"]
CARPETA_DATOS = "/gce"

PLANTILLA = r"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GESTIÓN Y CONTROL ESTRATÉGICO IA</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎯</text></svg>">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@stlite/browser@__STLITE__/build/stlite.css">
<style>
  html, body { margin: 0; height: 100%; background: #F5F8FA; font-family: "Segoe UI", Arial, sans-serif; }
  #carga { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 0; }
  #carga .caja { max-width: 520px; padding: 28px 32px; background: #fff; border-radius: 14px;
                 box-shadow: 0 4px 18px rgba(0,0,0,.08); color: #1F2D3D; text-align: center; }
  #carga h1 { font-size: 20px; color: #0B3C5D; margin: 8px 0 4px; }
  #carga p { font-size: 14px; line-height: 1.5; margin: 6px 0; }
  #carga .barra { height: 6px; background: #E3ECF1; border-radius: 3px; overflow: hidden; margin-top: 14px; }
  #carga .barra i { display: block; height: 100%; width: 40%; background: #0E7C86; animation: mov 1.4s infinite ease-in-out; }
  @keyframes mov { 0% { margin-left: -40%; } 100% { margin-left: 100%; } }
  #root { position: relative; z-index: 1; min-height: 100%; }
</style>
</head>
<body>
<div id="carga"><div class="caja">
  <div style="font-size:42px">🎯</div>
  <h1>GESTIÓN Y CONTROL ESTRATÉGICO IA</h1>
  <p>Versión HTML · <b id="estado">preparando el motor Python en el navegador…</b></p>
  <p style="color:#5B6B7A">La primera vez puede tardar 1–2 minutos (requiere Internet).
  Los datos se guardan en este navegador.</p>
  <div class="barra"><i></i></div>
  <p id="error" style="color:#C0392B"></p>
</div></div>
<div id="root"></div>
<script type="module">
const ARCHIVOS = __ARCHIVOS__;
const DATA_B64 = "__DATA__";
// Streamlit cambia la ruta (…/8_GCE_IA.html/dashboard) al navegar; en un archivo local
// eso rompe la recarga (F5). Se mantiene la URL original y la navegación sigue en memoria.
for (const f of ["pushState", "replaceState"]) {
  const orig = history[f].bind(history);
  history[f] = (estado, titulo) => orig(estado, titulo);
}
function b64(s) { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
try {
  const { mount } = await import("https://cdn.jsdelivr.net/npm/@stlite/browser@__STLITE__/build/stlite.js");
  const files = {};
  for (const [nombre, codigo] of Object.entries(ARCHIVOS)) files[nombre] = codigo;
  files["__DATA_NOMBRE__"] = { data: b64(DATA_B64) };
  document.getElementById("estado").textContent = "cargando librerías (pandas, plotly, python-pptx)…";
  mount({
    entrypoint: "app.py",
    files,
    requirements: __REQUISITOS__,
    idbfsMountpoints: ["__CARPETA__"],
    env: { GCE_BASE_DIR: "__CARPETA__", GCE_DATA_PRUEBA: "/home/pyodide/__DATA_NOMBRE__", PYTHONDONTWRITEBYTECODE: "1" },
    streamlitConfig: {
      "theme.base": "light",
      "theme.primaryColor": "#0E7C86",
      "client.toolbarMode": "minimal",
      "server.maxUploadSize": 50
    }
  }, document.getElementById("root"));
} catch (e) {
  document.getElementById("error").textContent = "No se pudo iniciar: " + e + ". Verifique su conexión a Internet.";
}
</script>
</body>
</html>
"""


def construir() -> Path:
    faltan = [m for m in MODULOS + [DATA] if not (BASE / m).exists()]
    if faltan:
        raise SystemExit(f"Faltan archivos en {BASE}: {', '.join(faltan)}")
    archivos = {m: (BASE / m).read_text(encoding="utf-8") for m in MODULOS}
    # json.dumps escapa comillas y saltos; se evita que "</script>" cierre la etiqueta
    js_archivos = json.dumps(archivos, ensure_ascii=False).replace("</", "<\\/")
    html = (PLANTILLA
            .replace("__ARCHIVOS__", js_archivos)
            .replace("__DATA__", base64.b64encode((BASE / DATA).read_bytes()).decode("ascii"))
            .replace("__DATA_NOMBRE__", DATA)
            .replace("__REQUISITOS__", json.dumps(REQUISITOS))
            .replace("__CARPETA__", CARPETA_DATOS)
            .replace("__STLITE__", STLITE))
    SALIDA.write_text(html, encoding="utf-8")
    return SALIDA


if __name__ == "__main__":
    ruta = construir()
    print(f"Generado {ruta.name} ({ruta.stat().st_size / 1024:.0f} KB) con {len(MODULOS)} módulos y {DATA}")
