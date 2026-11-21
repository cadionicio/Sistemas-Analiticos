"""Generador de la Torre de Control en HTML autocontenido.

La practica exige DOS vias de ejecucion: un .EXE y un archivo .HTML. Streamlit
no puede producir la segunda -es un servidor, no una pagina- de modo que este
modulo construye una version estatica e independiente del mismo tablero.

Decision de diseno: el archivo es AUTOCONTENIDO de verdad. La libreria de
graficos se incrusta completa (unos 4,7 MB) en lugar de enlazarse desde un CDN.
El enunciado permite conexion a Internet, pero un tablero que se ve en blanco
porque el aula no tiene red es un entregable fallido, y el riesgo no compensa
los megabytes ahorrados.

Lo que esta version SI hace: leer la base, elegir la ultima corrida completa,
volcar sus resultados a JSON dentro de la pagina y renderizar los mismos
graficos y tablas con filtros en el navegador.

Lo que NO hace, y se declara en la propia pagina: ejecutar los agentes. Una
pagina estatica no puede correr Wagner-Whitin ni Monte Carlo. Es una FOTO
trazable de una corrida, con su identificador y su fecha de corte a la vista.

Uso:
    python export_html.py
    python main.py exportar-html
"""

from __future__ import annotations

import html
import json
from datetime import datetime
from pathlib import Path

import pandas as pd

from config import settings
from db.db_manager import DatabaseManager, ErrorBaseDatos
from utils.logger import obtener_logger

_log = obtener_logger("export_html")

_COLORES = {
    "fondo": "#0B1220", "superficie": "#111C2E", "superficie_alta": "#16243A",
    "borde": "#22334D", "texto": "#E6EDF7", "tenue": "#8CA0BC",
    "acento": "#38BDF8", "ok": "#34D399", "aviso": "#FBBF24",
    "alerta": "#F87171", "critico": "#E11D48", "violeta": "#A78BFA",
}
_KRALJIC = {
    "ESTRATEGICO": "#F87171", "CUELLO_DE_BOTELLA": "#FBBF24",
    "APALANCADO": "#38BDF8", "RUTINARIO": "#64748B",
}


def _plotly_js() -> str:
    """Devuelve el codigo de plotly.js para incrustar en la pagina.

    Returns:
        str: contenido de plotly.min.js.

    Raises:
        RuntimeError: si la libreria no esta disponible en el entorno.
    """
    try:
        from plotly.offline import get_plotlyjs
        return get_plotlyjs()
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(
            "No se pudo incrustar plotly.js. Instale plotly: pip install plotly"
        ) from exc


def _recolectar(db: DatabaseManager, id_corrida: str) -> dict:
    """Extrae de la base todo lo que la pagina necesita.

    Args:
        db: gestor de base de datos.
        id_corrida: corrida a fotografiar.

    Returns:
        dict: estructura serializable a JSON.
    """
    def df(sql: str, params: tuple = ()) -> list[dict]:
        try:
            d = db.consultar_df(sql, params)
            return json.loads(d.to_json(orient="records")) if not d.empty else []
        except ErrorBaseDatos:
            return []

    cab = db.consultar_df(
        "SELECT id_corrida, fecha_corte, horizonte_meses, estado, usuario, "
        "ts_inicio, duracion_seg FROM ejecuciones WHERE id_corrida = ?;",
        (id_corrida,),
    )
    cabecera = {} if cab.empty else json.loads(cab.to_json(orient="records"))[0]

    metricas = {
        r["metrica"]: r["valor"]
        for r in df("SELECT metrica, valor FROM resultados_analisis WHERE id_corrida = ?;",
                    (id_corrida,))
    }

    return {
        "corrida": cabecera,
        "generado": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "version": settings.APP_VERSION,
        "metricas": metricas,
        "kraljic": df(
            "SELECT m.sku, m.descripcion, m.sector, m.clase_abc, m.clase_xyz, "
            "       m.segmento_kraljic, m.score_impacto_economico AS impacto, "
            "       m.score_riesgo_suministro AS riesgo, "
            "       COALESCE(SUM(d.demanda_atendida*m.costo_unitario),0) AS consumo "
            "FROM maestro_materiales m LEFT JOIN historico_demanda d ON d.sku=m.sku "
            "WHERE m.activo=1 GROUP BY m.sku;"
        ),
        "demanda": df(
            "SELECT periodo, SUM(unidades_atendidas) AS atendida, "
            "       SUM(unidades_perdidas) AS perdida FROM demanda_mensual "
            "WHERE id_corrida = ? GROUP BY periodo ORDER BY periodo;", (id_corrida,)
        ),
        "causa_raiz": df("SELECT * FROM v_causa_raiz_retrasos ORDER BY dias_retraso_acumulados DESC;"),
        "otif": df("SELECT razon_social, otif, entregas_evaluadas, retraso_medio_dias "
                   "FROM v_otif_proveedor ORDER BY otif;"),
        "hipotesis": df(
            "SELECT ambito, sku, hallazgo, naturaleza, evidencia, accion_sugerida, "
            "responsable FROM hipotesis_diagnostico WHERE id_corrida = ?;", (id_corrida,)
        ),
        "excepciones": df(
            "SELECT severidad, codigo, sku, descripcion, accion_sugerida, responsable "
            "FROM excepciones_plan WHERE id_corrida = ? ORDER BY CASE severidad "
            "WHEN 'BLOQUEANTE' THEN 1 WHEN 'ALTA' THEN 2 WHEN 'MEDIA' THEN 3 ELSE 4 END;",
            (id_corrida,)
        ),
        "pronostico": df(
            "SELECT sku, periodo, horizonte, escenario, modelo, p10, p50, p90, "
            "       intervalo_calibrado FROM pronosticos WHERE id_corrida = ?;", (id_corrida,)
        ),
        "historico": df(
            "SELECT sku, substr(fecha,1,7) AS periodo, "
            "       SUM(demanda_atendida) AS atendida, "
            "       SUM(demanda_atendida + COALESCE(demanda_perdida_estimada,0)) AS corregida "
            "FROM historico_demanda GROUP BY sku, periodo ORDER BY sku, periodo;"
        ),
        "canasta": df(
            "SELECT escenario, sku, proveedor_id, periodo, demanda_plan, inventario_inicial, "
            "       stock_seguridad, necesidad_neta, compra_propuesta, inventario_final, "
            "       faltante, fecha_emision, emision_vencida, precio_unitario, costo_compra, "
            "       metodo_lote, ajuste_presupuesto, nivel_riesgo "
            "FROM canasta_compras WHERE id_corrida = ? ORDER BY escenario, periodo, sku;",
            (id_corrida,)
        ),
        "simulacion": df(
            "SELECT escenario, metrica, unidad, n_iteraciones, media, p05, p50, p95 "
            "FROM simulacion_resultados WHERE id_corrida = ?;", (id_corrida,)
        ),
        "validacion": df(
            "SELECT sku, modelo, wape, mase, sesgo, cobertura, motivo_decision "
            "FROM validacion_modelos WHERE id_corrida = ? AND seleccionado = 1;",
            (id_corrida,)
        ),
    }


_ESTILO = """
:root{--fondo:#0B1220;--sup:#111C2E;--sup2:#16243A;--bor:#22334D;--txt:#E6EDF7;
--tenue:#8CA0BC;--acc:#38BDF8;--ok:#34D399;--avi:#FBBF24;--ale:#F87171;--cri:#E11D48;}
*{box-sizing:border-box}
body{margin:0;background:var(--fondo);color:var(--txt);
font-family:"Segoe UI",system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.5}
.wrap{max-width:1560px;margin:0 auto;padding:16px}
header{display:flex;justify-content:space-between;align-items:center;gap:16px;
padding:14px 20px;margin-bottom:16px;border:1px solid var(--bor);border-radius:12px;
background:linear-gradient(90deg,#16243A 0%,#0F1B2D 60%,#0B1220 100%)}
header h1{margin:0;font-size:1.1rem;letter-spacing:.05em;text-transform:uppercase}
header .sub{font-size:.76rem;color:var(--tenue);margin-top:3px}
header .marca{font-size:.7rem;color:var(--tenue);text-align:right;line-height:1.55}
nav{display:flex;gap:6px;border-bottom:1px solid var(--bor);margin-bottom:16px;flex-wrap:wrap}
nav button{background:transparent;border:1px solid transparent;border-bottom:none;
color:var(--tenue);padding:9px 16px;border-radius:8px 8px 0 0;cursor:pointer;
font-size:.83rem;font-weight:600;font-family:inherit}
nav button.on{background:var(--sup);color:var(--txt);border-color:var(--bor)}
.panel{display:none}.panel.on{display:block}
.grid{display:grid;gap:12px}
.g6{grid-template-columns:repeat(6,1fr)}.g4{grid-template-columns:repeat(4,1fr)}
.g2{grid-template-columns:2fr 1fr}.g11{grid-template-columns:1fr 1fr}
@media(max-width:1100px){.g6,.g4{grid-template-columns:repeat(2,1fr)}
.g2,.g11{grid-template-columns:1fr}}
.kpi{background:var(--sup);border:1px solid var(--bor);border-left:3px solid var(--acc);
border-radius:10px;padding:12px 14px}
.kpi .e{font-size:.66rem;text-transform:uppercase;letter-spacing:.07em;color:var(--tenue)}
.kpi .v{font-size:1.45rem;font-weight:700;margin-top:3px;font-variant-numeric:tabular-nums}
.kpi .n{font-size:.7rem;color:var(--tenue);margin-top:3px}
.card{background:var(--sup);border:1px solid var(--bor);border-radius:10px;
padding:12px 14px;margin-bottom:12px}
.card h3{margin:0 0 10px;font-size:.85rem;letter-spacing:.03em;text-transform:uppercase;
color:var(--tenue)}
.nota{background:rgba(56,189,248,.07);border:1px solid rgba(56,189,248,.25);
border-radius:8px;padding:10px 13px;margin:8px 0;font-size:.78rem;color:var(--tenue)}
.nota b{color:var(--txt)}
table{width:100%;border-collapse:collapse;font-size:.78rem}
th{position:sticky;top:0;background:var(--sup2);color:var(--tenue);text-align:left;
padding:7px 9px;font-size:.68rem;text-transform:uppercase;letter-spacing:.05em;
border-bottom:1px solid var(--bor);z-index:2}
td{padding:6px 9px;border-bottom:1px solid rgba(34,51,77,.55)}
tbody tr:hover{background:rgba(56,189,248,.06)}
.num{text-align:right;font-variant-numeric:tabular-nums}
.scroll{max-height:460px;overflow:auto;border:1px solid var(--bor);border-radius:8px}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:.66rem;
font-weight:700;letter-spacing:.04em}
.filtros{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center}
select,input{background:var(--sup2);border:1px solid var(--bor);color:var(--txt);
padding:6px 10px;border-radius:7px;font-size:.8rem;font-family:inherit}
.exc{background:var(--sup);border:1px solid var(--bor);border-left:4px solid var(--acc);
border-radius:8px;padding:9px 12px;margin-bottom:7px}
.exc .c{font-size:.7rem;color:var(--tenue);margin-bottom:3px}
.exc .a{font-size:.74rem;color:var(--tenue);margin-top:4px}
footer{color:var(--tenue);font-size:.72rem;text-align:center;padding:20px 0}
"""


def generar_html(
    destino: Path | None = None, id_corrida: str | None = None,
    db: DatabaseManager | None = None,
) -> Path:
    """Construye el tablero HTML autocontenido.

    Args:
        destino: ruta del archivo a escribir. Por defecto `exports/`.
        id_corrida: corrida a exportar. Por defecto, la ultima con canasta.
        db: gestor de base de datos.

    Returns:
        Path: ruta del archivo generado.

    Raises:
        RuntimeError: si no existe ninguna corrida con resultados.
    """
    db = db or DatabaseManager()

    if id_corrida is None:
        fila = db.consultar_df(
            "SELECT e.id_corrida FROM ejecuciones e WHERE EXISTS "
            "(SELECT 1 FROM canasta_compras c WHERE c.id_corrida = e.id_corrida) "
            "ORDER BY e.ts_inicio DESC, e.rowid DESC LIMIT 1;"
        )
        if fila.empty:
            raise RuntimeError(
                "No hay ninguna corrida con canasta de compras. "
                "Ejecute antes: python main.py correr"
            )
        id_corrida = str(fila.iloc[0]["id_corrida"])

    _log.info("Exportando corrida %s a HTML", id_corrida)
    datos = _recolectar(db, id_corrida)

    destino = destino or (settings.EXPORTS_DIR / "SAPA_TorreDeControl.html")
    destino.parent.mkdir(parents=True, exist_ok=True)

    payload = json.dumps(datos, ensure_ascii=False, allow_nan=False, default=str)
    # El JSON se inserta dentro de una etiqueta <script type="application/json">.
    # Se neutraliza cualquier '</' para que un dato no pueda cerrar la etiqueta
    # antes de tiempo: los textos vienen de la base y no son de confianza.
    payload = payload.replace("</", "<\\/")

    doc = f"""<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SAPA · Torre de Control WES</title>
<style>{_ESTILO}</style>
<script>{_plotly_js()}</script>
</head><body>
<div class="wrap">
<header>
  <div><h1>Torre de Control · Abastecimiento Predictivo</h1>
  <div class="sub" id="cab-sub"></div></div>
  <div class="marca">SAPA v{html.escape(settings.APP_VERSION)}<br>
  Super Agente IA · 5 especialistas<br>Version HTML autocontenida</div>
</header>
<nav>
  <button class="on" data-p="p1">1 · Orquestacion y E-Procurement</button>
  <button data-p="p2">2 · Inteligencia Logistica</button>
  <button data-p="p3">3 · Gemelo Digital</button>
</nav>

<section id="p1" class="panel on">
  <div class="grid g4" id="kpi1"></div>
  <div class="nota">Adaptacion de la matriz de <b>Kraljic (1983)</b>. Los ejes son
  scores persistidos y recalculables, no etiquetas escritas a mano. Corte de
  cuadrante en 0,50.</div>
  <div class="grid g2">
    <div class="card"><h3>Segmentacion estrategica</h3><div id="g-kraljic"></div></div>
    <div class="card"><h3>Concentracion por cuadrante</h3><div id="g-cuadrante"></div></div>
  </div>
  <div class="card"><h3>Maestro segmentado</h3>
    <div class="filtros">
      <select id="f-seg"><option value="">Todos los segmentos</option></select>
      <select id="f-abc"><option value="">Todas las clases ABC</option></select>
      <input id="f-sku" placeholder="Buscar SKU o descripcion" size="28">
    </div>
    <div class="scroll"><table id="t-maestro"></table></div>
  </div>
</section>

<section id="p2" class="panel">
  <div class="grid g6" id="kpi2"></div>
  <div class="grid g2">
    <div class="card"><h3>Demanda mensual conciliada</h3><div id="g-demanda"></div>
      <div class="nota">La serie roja es <b>estimacion, no observacion</b>: la demanda
      perdida se infiere por prorrateo de disponibilidad y se guarda en columna propia
      con su metodo declarado.</div></div>
    <div class="card"><h3>Causa raiz del retraso</h3><div id="g-causa"></div></div>
  </div>
  <div class="grid g11">
    <div class="card"><h3>OTIF por proveedor</h3><div id="g-otif"></div></div>
    <div class="card"><h3>Hallazgos del agente diagnostico</h3>
      <div class="nota">El sistema distingue <b>OBSERVACION</b> (hecho medido),
      <b>HIPOTESIS</b> (explicacion que exige validacion) y <b>SUPUESTO</b>
      (valor adoptado por decision).</div>
      <div id="l-hipotesis" style="max-height:330px;overflow:auto"></div></div>
  </div>
  <div class="card"><h3>Excepciones abiertas del plan</h3>
    <div id="l-excepciones" style="max-height:360px;overflow:auto"></div></div>
</section>

<section id="p3" class="panel">
  <div class="nota">Esta es una <b>foto trazable</b> de la corrida indicada arriba. Una
  pagina estatica no puede ejecutar Wagner-Whitin ni la simulacion Monte Carlo; para
  recalcular con otra politica use el ejecutable SAPA.exe.</div>
  <div class="card"><h3>Pronostico validado frente al referente</h3>
    <div class="filtros">
      <select id="f-sku-pron"></select>
      <select id="f-esc-pron"></select>
      <span id="pron-meta" style="font-size:.76rem;color:var(--tenue)"></span>
    </div>
    <div id="g-pronostico"></div>
  </div>
  <div class="card"><h3>Canasta de compras a 12 meses</h3>
    <div class="filtros">
      <select id="f-esc-can"></select>
      <select id="f-per-can"><option value="">Todos los periodos</option></select>
      <select id="f-rie-can"><option value="">Todos los riesgos</option></select>
      <label style="font-size:.78rem;color:var(--tenue)">
        <input type="checkbox" id="f-compra" checked> Solo lineas con compra</label>
      <span id="can-meta" style="font-size:.76rem;color:var(--tenue)"></span>
    </div>
    <div class="grid g4" id="kpi3" style="margin-bottom:10px"></div>
    <div class="scroll"><table id="t-canasta"></table></div>
  </div>
  <div class="grid g11">
    <div class="card"><h3>Compromiso de caja por periodo</h3><div id="g-caja"></div></div>
    <div class="card"><h3>Simulacion estocastica multiescenario</h3>
      <div id="g-sim"></div>
      <div class="scroll" style="max-height:220px;margin-top:8px">
        <table id="t-sim"></table></div></div>
  </div>
</section>

<footer>Generado el <span id="pie-fecha"></span> ·
Base local SQLite · Ninguna consulta sale del equipo ·
Los ejemplos numericos son simulados y estan identificados como tales</footer>
</div>

<script type="application/json" id="datos">{payload}</script>
<script>{_JS}</script>
</body></html>"""

    destino.write_text(doc, encoding="utf-8")
    tam = destino.stat().st_size / 1_048_576
    _log.info("HTML generado: %s (%.1f MB)", destino, tam)
    return destino


_JS = r"""
const D = JSON.parse(document.getElementById('datos').textContent);
const C = {fondo:'#0B1220',sup:'#111C2E',bor:'#22334D',txt:'#E6EDF7',tenue:'#8CA0BC',
acc:'#38BDF8',ok:'#34D399',avi:'#FBBF24',ale:'#F87171',cri:'#E11D48',vio:'#A78BFA'};
const KR = {ESTRATEGICO:'#F87171',CUELLO_DE_BOTELLA:'#FBBF24',APALANCADO:'#38BDF8',RUTINARIO:'#64748B'};
const SEV = {BLOQUEANTE:C.cri,ALTA:C.ale,MEDIA:C.avi,INFORMATIVA:C.acc};
const NAT = {OBSERVACION:C.acc,HIPOTESIS:C.avi,SUPUESTO:C.vio};

const nf = (v,d=0)=> (v===null||v===undefined||isNaN(v))?'—':
  Number(v).toLocaleString('es-PE',{minimumFractionDigits:d,maximumFractionDigits:d});
const pf = (v,d=1)=> (v===null||v===undefined||isNaN(v))?'—':(Number(v)*100).toFixed(d)+'%';
const esc = s => String(s===null||s===undefined?'':s).replace(/[&<>"']/g,
  c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const M = k => (D.metricas && D.metricas[k]!==undefined) ? D.metricas[k] : null;

const LAYOUT = t => ({template:'plotly_dark',paper_bgcolor:C.sup,plot_bgcolor:C.sup,
  font:{color:C.txt,size:11},title:{text:t||'',font:{size:12}},
  margin:{l:52,r:20,t:t?38:14,b:40},height:300,
  legend:{orientation:'h',y:1.02,x:0,font:{size:10},bgcolor:'rgba(0,0,0,0)'},
  xaxis:{gridcolor:C.bor,zerolinecolor:C.bor},yaxis:{gridcolor:C.bor,zerolinecolor:C.bor}});
const CFG = {displayModeBar:false,responsive:true};

/* ---------- navegacion ---------- */
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('nav button').forEach(x=>x.classList.remove('on'));
  document.querySelectorAll('.panel').forEach(x=>x.classList.remove('on'));
  b.classList.add('on');
  document.getElementById(b.dataset.p).classList.add('on');
  window.dispatchEvent(new Event('resize'));
});

/* ---------- cabecera ---------- */
const co = D.corrida || {};
document.getElementById('cab-sub').textContent =
  `Corte ${co.fecha_corte||'—'} · horizonte ${co.horizonte_meses||'—'} meses · `+
  `corrida ${co.id_corrida||'—'} · estado ${co.estado||'—'}`;
document.getElementById('pie-fecha').textContent = D.generado;

/* ---------- utilidades de tabla ---------- */
function tabla(el, filas, cols){
  if(!filas.length){el.innerHTML='<tbody><tr><td>Sin datos</td></tr></tbody>';return;}
  const th = cols.map(c=>`<th class="${c.num?'num':''}">${esc(c.t)}</th>`).join('');
  const tb = filas.map(f=>'<tr>'+cols.map(c=>{
    const v = c.f ? c.f(f[c.k], f) : esc(f[c.k]);
    return `<td class="${c.num?'num':''}">${v}</td>`;}).join('')+'</tr>').join('');
  el.innerHTML = `<thead><tr>${th}</tr></thead><tbody>${tb}</tbody>`;
}
function kpi(cont, items){
  cont.innerHTML = items.map(i=>`<div class="kpi" style="border-left-color:${i.c||C.acc}">
    <div class="e">${esc(i.e)}</div><div class="v">${esc(i.v)}</div>
    <div class="n">${esc(i.n||'')}</div></div>`).join('');
}
const pill = (t,c)=>`<span class="pill" style="background:${c}22;color:${c};border:1px solid ${c}55">${esc(t)}</span>`;

/* ================= PANEL 1 ================= */
kpi(document.getElementById('kpi1'), [
 {e:'Articulos activos', v:nf(D.kraljic.length), n:'maestro homologado'},
 {e:'Consumo valorizado', v:'S/ '+nf(D.kraljic.reduce((a,b)=>a+(b.consumo||0),0)),
  n:'acumulado del historico'},
 {e:'Corrida activa', v:co.id_corrida||'—', n:'estado '+(co.estado||'—')},
 {e:'Excepciones abiertas', v:nf(D.excepciones.length),
  n:'bloqueantes: '+D.excepciones.filter(e=>e.severidad==='BLOQUEANTE').length,
  c: D.excepciones.some(e=>e.severidad==='BLOQUEANTE')?C.cri:C.ok}]);

const segs = [...new Set(D.kraljic.map(r=>r.segmento_kraljic))];
Plotly.newPlot('g-kraljic', segs.map(s=>{
  const g = D.kraljic.filter(r=>r.segmento_kraljic===s);
  return {x:g.map(r=>r.riesgo), y:g.map(r=>r.impacto), mode:'markers',
    name:s.replace(/_/g,' '), type:'scatter',
    marker:{size:g.map(r=>Math.min(Math.max(Math.sqrt(r.consumo||1)/55,8),30)),
      color:KR[s]||'#64748B', line:{width:1,color:'rgba(255,255,255,.35)'},opacity:.82},
    text:g.map(r=>`${r.sku}<br>${r.descripcion}<br>Clase ${r.clase_abc}${r.clase_xyz}<br>`+
      `Consumo S/ ${nf(r.consumo)}`), hovertemplate:'%{text}<extra></extra>'};
}), Object.assign(LAYOUT(), {height:420,
  xaxis:{title:'Riesgo de suministro',range:[-.03,1.03],gridcolor:C.bor},
  yaxis:{title:'Impacto economico',range:[-.03,1.03],gridcolor:C.bor},
  shapes:[{type:'line',x0:.5,x1:.5,y0:-.03,y1:1.03,line:{color:C.bor,dash:'dash'}},
          {type:'line',x0:-.03,x1:1.03,y0:.5,y1:.5,line:{color:C.bor,dash:'dash'}}],
  annotations:[{x:.02,y:1.0,text:'APALANCADOS',showarrow:false,xanchor:'left',
    font:{size:9,color:C.tenue}},{x:.72,y:1.0,text:'ESTRATEGICOS',showarrow:false,
    xanchor:'left',font:{size:9,color:C.tenue}},{x:.02,y:.01,text:'RUTINARIOS',
    showarrow:false,xanchor:'left',font:{size:9,color:C.tenue}},{x:.62,y:.01,
    text:'CUELLO DE BOTELLA',showarrow:false,xanchor:'left',font:{size:9,color:C.tenue}}]
}), CFG);

const porSeg = segs.map(s=>({s, n:D.kraljic.filter(r=>r.segmento_kraljic===s).length,
  v:D.kraljic.filter(r=>r.segmento_kraljic===s).reduce((a,b)=>a+(b.consumo||0),0)}))
  .sort((a,b)=>a.v-b.v);
Plotly.newPlot('g-cuadrante', [{type:'bar',orientation:'h',
  x:porSeg.map(r=>r.v), y:porSeg.map(r=>r.s.replace(/_/g,' ')),
  marker:{color:porSeg.map(r=>KR[r.s]||'#64748B')},
  text:porSeg.map(r=>`${r.n} art. · S/ ${nf(r.v)}`), textposition:'auto',
  hovertemplate:'%{y}<br>S/ %{x:,.0f}<extra></extra>'}],
  Object.assign(LAYOUT(),{height:420,xaxis:{title:'Consumo valorizado (PEN)',gridcolor:C.bor}}), CFG);

const colsMaestro = [
 {k:'sku',t:'SKU'},{k:'descripcion',t:'Descripcion'},{k:'sector',t:'Sector'},
 {k:'segmento_kraljic',t:'Kraljic',f:v=>pill(String(v).replace(/_/g,' '),KR[v]||'#64748B')},
 {k:'clase_abc',t:'ABC'},{k:'clase_xyz',t:'XYZ'},
 {k:'impacto',t:'Impacto',num:1,f:v=>nf(v,2)},
 {k:'riesgo',t:'Riesgo',num:1,f:v=>nf(v,2)},
 {k:'consumo',t:'Consumo',num:1,f:v=>'S/ '+nf(v)}];
const selSeg=document.getElementById('f-seg'), selAbc=document.getElementById('f-abc');
segs.forEach(s=>selSeg.add(new Option(s.replace(/_/g,' '),s)));
[...new Set(D.kraljic.map(r=>r.clase_abc))].filter(Boolean).sort()
  .forEach(s=>selAbc.add(new Option('Clase '+s,s)));
function pintarMaestro(){
  const q=document.getElementById('f-sku').value.toLowerCase();
  let f = D.kraljic.filter(r=>
    (!selSeg.value||r.segmento_kraljic===selSeg.value)&&
    (!selAbc.value||r.clase_abc===selAbc.value)&&
    (!q||String(r.sku).toLowerCase().includes(q)||String(r.descripcion).toLowerCase().includes(q)));
  f.sort((a,b)=>b.consumo-a.consumo);
  tabla(document.getElementById('t-maestro'), f, colsMaestro);
}
['f-seg','f-abc','f-sku'].forEach(id=>document.getElementById(id).oninput=pintarMaestro);
pintarMaestro();

/* ================= PANEL 2 ================= */
const periodos = D.demanda.length;
const rot = (M('consumo_valorizado_pen')||0) / Math.max((periodos/12),1e-9)
          / Math.max(M('inventario_medio_pen')||1e-9,1e-9);
kpi(document.getElementById('kpi2'), [
 {e:'Fill rate', v:pf(M('fill_rate_global')), n:'atendidas / demandadas',
  c:(M('fill_rate_global')||0)>=.95?C.ok:C.avi},
 {e:'OTIF proveedor', v:pf(M('otif_global')), n:'completas y a tiempo',
  c:(M('otif_global')||0)>=.85?C.ok:C.ale},
 {e:'Rotacion', v:nf(rot,2)+'x', n:'consumo anualizado / inventario'},
 {e:'Cobertura', v:nf(M('dias_cobertura_media'),1)+' d', n:'dias de inventario'},
 {e:'Inventario medio', v:'S/ '+nf(M('inventario_medio_pen')), n:'capital inmovilizado'},
 {e:'Gasto de compras', v:'S/ '+nf(M('gasto_compras_pen')), n:`acumulado ${periodos} meses`}]);

Plotly.newPlot('g-demanda', [
 {type:'bar',x:D.demanda.map(r=>r.periodo),y:D.demanda.map(r=>r.atendida),
  name:'Atendida',marker:{color:C.acc}},
 {type:'bar',x:D.demanda.map(r=>r.periodo),y:D.demanda.map(r=>r.perdida),
  name:'Perdida estimada',marker:{color:C.ale}}],
 Object.assign(LAYOUT(),{barmode:'stack',height:300,
   yaxis:{title:'Unidades',gridcolor:C.bor}}), CFG);

Plotly.newPlot('g-causa', [{type:'bar',orientation:'h',
  x:D.causa_raiz.map(r=>r.dias_retraso_acumulados),
  y:D.causa_raiz.map(r=>String(r.causa_raiz_retraso).replace(/_/g,' ')),
  marker:{color:D.causa_raiz.map(r=>
    /FINANZAS|APROBACION/.test(r.causa_raiz_retraso)?C.avi:
    /SIN_RETRASO/.test(r.causa_raiz_retraso)?C.ok:C.vio)},
  text:D.causa_raiz.map(r=>nf(r.n_ordenes)+' OC'),textposition:'auto',
  hovertemplate:'%{y}<br>%{x:,.0f} dias<extra></extra>'}],
  Object.assign(LAYOUT(),{height:300,xaxis:{title:'Dias de retraso acumulados',gridcolor:C.bor}}), CFG);

Plotly.newPlot('g-otif', [{type:'bar',orientation:'h',
  x:D.otif.map(r=>r.otif), y:D.otif.map(r=>r.razon_social),
  marker:{color:D.otif.map(r=>r.otif>=.85?C.ok:r.otif>=.7?C.avi:C.ale)},
  text:D.otif.map(r=>pf(r.otif,0)),textposition:'auto',
  hovertemplate:'%{y}<br>OTIF %{x:.1%}<extra></extra>'}],
  Object.assign(LAYOUT(),{height:320,xaxis:{title:'OTIF',range:[0,1],tickformat:'.0%',gridcolor:C.bor}}), CFG);

document.getElementById('l-hipotesis').innerHTML = D.hipotesis.map(h=>`
 <div class="exc" style="border-left-color:${NAT[h.naturaleza]||C.acc}">
  <div class="c">${pill(h.naturaleza,NAT[h.naturaleza]||C.acc)}
   <span style="margin-left:6px">${esc(h.ambito)}${h.sku?' · '+esc(h.sku):''}</span></div>
  <div>${esc(h.hallazgo)}</div>
  <div class="a">Evidencia: ${esc(h.evidencia)}</div>
  ${h.accion_sugerida?`<div class="a">&rarr; ${esc(h.accion_sugerida)} — <i>${esc(h.responsable||'')}</i></div>`:''}
 </div>`).join('') || '<div style="color:var(--tenue)">Sin hallazgos.</div>';

document.getElementById('l-excepciones').innerHTML = D.excepciones.map(e=>`
 <div class="exc" style="border-left-color:${SEV[e.severidad]||C.acc}">
  <div class="c">${pill(e.severidad,SEV[e.severidad]||C.acc)}
   <span style="margin-left:6px">${esc(e.codigo)}${e.sku?' · '+esc(e.sku):''}</span></div>
  <div>${esc(e.descripcion)}</div>
  ${e.accion_sugerida?`<div class="a">&rarr; ${esc(e.accion_sugerida)} — <i>${esc(e.responsable||'')}</i></div>`:''}
 </div>`).join('') || '<div style="color:var(--tenue)">Sin excepciones abiertas.</div>';

/* ================= PANEL 3 ================= */
const escenarios = [...new Set(D.canasta.map(r=>r.escenario))];
const skusPron = [...new Set(D.pronostico.map(r=>r.sku))].sort();
const selSkuP=document.getElementById('f-sku-pron'), selEscP=document.getElementById('f-esc-pron');
skusPron.forEach(s=>selSkuP.add(new Option(s,s)));
[...new Set(D.pronostico.map(r=>r.escenario))].forEach(s=>selEscP.add(new Option(s,s)));
const validPorSku = Object.fromEntries(D.validacion.map(v=>[v.sku,v]));

function pintarPronostico(){
  const sku=selSkuP.value, e=selEscP.value;
  const h = D.historico.filter(r=>r.sku===sku);
  const p = D.pronostico.filter(r=>r.sku===sku && r.escenario===e)
             .sort((a,b)=>a.horizonte-b.horizonte);
  const ref = h.slice(-12).map(r=>r.corregida);
  const v = validPorSku[sku]||{};
  document.getElementById('pron-meta').innerHTML =
    pill(p.length?p[0].modelo:'—', C.acc)+' '+
    pill(p.length&&p[0].intervalo_calibrado?'intervalo calibrado':'sin calibrar',
         p.length&&p[0].intervalo_calibrado?C.ok:C.avi)+
    ` &nbsp; WAPE ${pf(v.wape)} · sesgo ${pf(v.sesgo)} · cobertura ${pf(v.cobertura)}`;
  const trazas=[
   {x:h.map(r=>r.periodo),y:h.map(r=>r.corregida),name:'Historico corregido',
    mode:'lines',line:{color:C.tenue,width:1.6}},
   {x:h.map(r=>r.periodo),y:h.map(r=>r.atendida),name:'Venta observada',
    mode:'lines',line:{color:C.bor,width:1,dash:'dot'}},
   {x:p.map(r=>r.periodo),y:p.map(r=>r.p90),mode:'lines',line:{width:0},
    showlegend:false,hoverinfo:'skip'},
   {x:p.map(r=>r.periodo),y:p.map(r=>r.p10),name:'Intervalo 80%',mode:'lines',
    line:{width:0},fill:'tonexty',fillcolor:'rgba(56,189,248,.18)',hoverinfo:'skip'},
   {x:p.map(r=>r.periodo),y:p.map(r=>r.p50),name:'Pronostico',mode:'lines+markers',
    line:{color:C.acc,width:2.4},marker:{size:5}}];
  if(ref.length===p.length&&p.length)
    trazas.push({x:p.map(r=>r.periodo),y:ref,name:'Referente ingenuo estacional',
      mode:'lines',line:{color:C.avi,width:1.6,dash:'dash'}});
  Plotly.newPlot('g-pronostico',trazas,
    Object.assign(LAYOUT(),{height:360,yaxis:{title:'Unidades por mes',gridcolor:C.bor}}),CFG);
}
selSkuP.onchange=selEscP.onchange=pintarPronostico;
if(skusPron.length) pintarPronostico();

const selEscC=document.getElementById('f-esc-can');
escenarios.forEach(s=>selEscC.add(new Option(s,s)));
const selPer=document.getElementById('f-per-can'), selRie=document.getElementById('f-rie-can');
[...new Set(D.canasta.map(r=>r.periodo))].sort().forEach(p=>selPer.add(new Option(p,p)));
['CRITICO','ALTO','MEDIO','BAJO'].forEach(r=>selRie.add(new Option(r,r)));
const RIE={CRITICO:C.cri,ALTO:C.ale,MEDIO:C.avi,BAJO:C.ok};

const colsCan=[
 {k:'sku',t:'SKU'},{k:'periodo',t:'Periodo'},
 {k:'demanda_plan',t:'Demanda',num:1,f:v=>nf(v)},
 {k:'inventario_inicial',t:'Inv. inicial',num:1,f:v=>nf(v)},
 {k:'stock_seguridad',t:'Reserva',num:1,f:v=>nf(v)},
 {k:'necesidad_neta',t:'Nec. neta',num:1,f:v=>nf(v)},
 {k:'compra_propuesta',t:'Compra',num:1,f:v=>nf(v)},
 {k:'inventario_final',t:'Inv. final',num:1,f:v=>nf(v)},
 {k:'faltante',t:'Faltante',num:1,f:v=>v>0?`<span style="color:${C.ale}">${nf(v)}</span>`:'—'},
 {k:'fecha_emision',t:'Emitir el'},
 {k:'emision_vencida',t:'Vencida',f:v=>v?pill('SI',C.ale):''},
 {k:'costo_compra',t:'Costo',num:1,f:v=>'S/ '+nf(v)},
 {k:'nivel_riesgo',t:'Riesgo',f:v=>pill(v,RIE[v]||C.tenue)},
 {k:'ajuste_presupuesto',t:'Recortada',f:v=>v?pill('CAJA',C.avi):''}];

function pintarCanasta(){
  const e=selEscC.value;
  let f=D.canasta.filter(r=>r.escenario===e);
  const total=f.reduce((a,b)=>a+(b.costo_compra||0),0);
  const falt =f.reduce((a,b)=>a+(b.faltante||0),0);
  const venc =f.filter(r=>r.emision_vencida).length;
  const rec  =f.filter(r=>r.ajuste_presupuesto).length;
  kpi(document.getElementById('kpi3'),[
   {e:'Compromiso total',v:'S/ '+nf(total),n:f.filter(r=>r.compra_propuesta>0).length+' lineas con compra'},
   {e:'Faltante proyectado',v:nf(falt),n:'unidades sin cobertura',c:falt?C.ale:C.ok},
   {e:'Emisiones vencidas',v:nf(venc),n:'fecha limite ya superada',c:venc?C.avi:C.ok},
   {e:'Recortes por caja',v:nf(rec),n:'lineas diferidas',c:rec?C.avi:C.ok}]);

  if(selPer.value) f=f.filter(r=>r.periodo===selPer.value);
  if(selRie.value) f=f.filter(r=>r.nivel_riesgo===selRie.value);
  if(document.getElementById('f-compra').checked) f=f.filter(r=>r.compra_propuesta>0);
  document.getElementById('can-meta').textContent=`${f.length} lineas`;
  tabla(document.getElementById('t-canasta'),f,colsCan);

  const porPer={};
  D.canasta.filter(r=>r.escenario===e).forEach(r=>{
    porPer[r.periodo]=(porPer[r.periodo]||0)+(r.costo_compra||0);});
  const per=Object.keys(porPer).sort();
  Plotly.newPlot('g-caja',[{type:'bar',x:per,y:per.map(p=>porPer[p]),
    marker:{color:C.acc},hovertemplate:'%{x}<br>S/ %{y:,.0f}<extra></extra>'}],
    Object.assign(LAYOUT(),{height:280,yaxis:{title:'PEN',gridcolor:C.bor}}),CFG);
}
[selEscC,selPer,selRie,document.getElementById('f-compra')]
  .forEach(el=>el.onchange=pintarCanasta);
if(escenarios.length) pintarCanasta();

const fr=D.simulacion.filter(r=>r.metrica==='fill_rate');
Plotly.newPlot('g-sim', fr.flatMap(r=>{
  const col={BASE:C.ok,DEMANDA_ALTA:C.avi,DISRUPCION:C.ale}[r.escenario]||C.acc;
  return [{x:[r.p05,r.p95],y:[r.escenario,r.escenario],mode:'lines',
    line:{color:col,width:10},opacity:.35,showlegend:false,hoverinfo:'skip'},
   {x:[r.p50],y:[r.escenario],mode:'markers',name:r.escenario,
    marker:{color:col,size:14,symbol:'diamond'},
    hovertemplate:`${r.escenario}<br>P50 %{x:.1%}<extra></extra>`}];
}), Object.assign(LAYOUT(),{height:260,
  xaxis:{title:'Fill rate simulado',tickformat:'.0%',gridcolor:C.bor}}), CFG);

tabla(document.getElementById('t-sim'), D.simulacion, [
 {k:'escenario',t:'Escenario'},{k:'metrica',t:'Metrica'},{k:'unidad',t:'Unidad'},
 {k:'p05',t:'P05',num:1,f:v=>nf(v,3)},{k:'p50',t:'P50',num:1,f:v=>nf(v,3)},
 {k:'p95',t:'P95',num:1,f:v=>nf(v,3)}]);
"""


def main() -> int:
    """Genera el tablero HTML desde la linea de comandos."""
    destino = generar_html()
    print(f"Tablero HTML generado: {destino}")
    print(f"Tamano: {destino.stat().st_size / 1_048_576:.1f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
