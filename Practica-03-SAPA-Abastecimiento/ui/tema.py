"""Sistema visual de la Torre de Control WES.

Streamlit por defecto produce una pagina que se reconoce a un metro de
distancia como un script de laboratorio: tipografia por defecto, metricas sin
jerarquia y tablas sin formato. Este modulo impone un lenguaje visual propio
-superficie oscura, acento ambar de alarma, tipografia condensada de sala de
control- para que la aplicacion se lea como el tablero de un WES y no como un
cuaderno de notas.

Todo el CSS se inyecta una sola vez por sesion. Las utilidades de render
devuelven HTML acotado; nunca interpolan contenido sin escapar, porque los
textos vienen de la base de datos y pueden contener caracteres de marcado.
"""

from __future__ import annotations

import html
from typing import Literal

import streamlit as st

# =============================================================================
# PALETA
# =============================================================================
COLORES: dict[str, str] = {
    "fondo": "#0B1220",
    "superficie": "#111C2E",
    "superficie_alta": "#16243A",
    "borde": "#22334D",
    "texto": "#E6EDF7",
    "texto_tenue": "#8CA0BC",
    "acento": "#38BDF8",
    "ok": "#34D399",
    "aviso": "#FBBF24",
    "alerta": "#F87171",
    "critico": "#E11D48",
    "violeta": "#A78BFA",
}

# Paleta categorica para los cuadrantes de Kraljic. Se fija aqui para que el
# color signifique lo mismo en todos los graficos de la aplicacion.
COLOR_KRALJIC: dict[str, str] = {
    "ESTRATEGICO": "#F87171",
    "CUELLO_DE_BOTELLA": "#FBBF24",
    "APALANCADO": "#38BDF8",
    "RUTINARIO": "#64748B",
}

COLOR_RIESGO: dict[str, str] = {
    "CRITICO": COLORES["critico"],
    "ALTO": COLORES["alerta"],
    "MEDIO": COLORES["aviso"],
    "BAJO": COLORES["ok"],
}

COLOR_SEVERIDAD: dict[str, str] = {
    "BLOQUEANTE": COLORES["critico"],
    "ALTA": COLORES["alerta"],
    "MEDIA": COLORES["aviso"],
    "INFORMATIVA": COLORES["acento"],
}

_CSS = """
<style>
:root {
  --sapa-fondo: #0B1220;
  --sapa-superficie: #111C2E;
  --sapa-superficie-alta: #16243A;
  --sapa-borde: #22334D;
  --sapa-texto: #E6EDF7;
  --sapa-tenue: #8CA0BC;
  --sapa-acento: #38BDF8;
}

.stApp { background: var(--sapa-fondo); }
section[data-testid="stSidebar"] {
  background: var(--sapa-superficie);
  border-right: 1px solid var(--sapa-borde);
}
section[data-testid="stSidebar"] * { color: var(--sapa-texto); }

/* Cabecera de sala de control */
.sapa-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 1rem; padding: 0.9rem 1.25rem; margin-bottom: 1rem;
  background: linear-gradient(90deg, #16243A 0%, #0F1B2D 60%, #0B1220 100%);
  border: 1px solid var(--sapa-borde); border-radius: 12px;
}
.sapa-header h1 {
  font-size: 1.15rem; font-weight: 700; letter-spacing: 0.04em;
  margin: 0; color: var(--sapa-texto); text-transform: uppercase;
}
.sapa-header .sub {
  font-size: 0.78rem; color: var(--sapa-tenue); margin-top: 2px;
  letter-spacing: 0.02em;
}
.sapa-header .marca {
  font-size: 0.7rem; color: var(--sapa-tenue); text-align: right;
  line-height: 1.5; white-space: nowrap;
}

/* Tarjetas de indicador */
.sapa-kpi {
  background: var(--sapa-superficie); border: 1px solid var(--sapa-borde);
  border-left: 3px solid var(--sapa-acento); border-radius: 10px;
  padding: 0.75rem 0.9rem; height: 100%;
}
.sapa-kpi .etiqueta {
  font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.07em;
  color: var(--sapa-tenue); margin-bottom: 0.3rem;
}
.sapa-kpi .valor {
  font-size: 1.5rem; font-weight: 700; color: var(--sapa-texto);
  line-height: 1.1; font-variant-numeric: tabular-nums;
}
.sapa-kpi .nota { font-size: 0.72rem; color: var(--sapa-tenue); margin-top: 0.25rem; }

/* Pildoras de estado */
.sapa-pill {
  display: inline-block; padding: 2px 9px; border-radius: 999px;
  font-size: 0.68rem; font-weight: 700; letter-spacing: 0.05em;
  text-transform: uppercase;
}

/* Tarjeta de excepcion */
.sapa-exc {
  background: var(--sapa-superficie); border: 1px solid var(--sapa-borde);
  border-left: 4px solid var(--sapa-acento); border-radius: 8px;
  padding: 0.6rem 0.85rem; margin-bottom: 0.5rem;
}
.sapa-exc .cab { font-size: 0.72rem; color: var(--sapa-tenue); margin-bottom: 0.2rem; }
.sapa-exc .txt { font-size: 0.86rem; color: var(--sapa-texto); }
.sapa-exc .acc { font-size: 0.75rem; color: var(--sapa-tenue); margin-top: 0.3rem; }

/* Pestanas */
.stTabs [data-baseweb="tab-list"] { gap: 4px; border-bottom: 1px solid var(--sapa-borde); }
.stTabs [data-baseweb="tab"] {
  background: transparent; border-radius: 8px 8px 0 0; padding: 0.5rem 1rem;
  font-size: 0.82rem; font-weight: 600; letter-spacing: 0.02em;
  color: var(--sapa-tenue);
}
.stTabs [aria-selected="true"] {
  background: var(--sapa-superficie); color: var(--sapa-texto);
  border: 1px solid var(--sapa-borde); border-bottom-color: var(--sapa-superficie);
}

/* Bloque de nota metodologica */
.sapa-nota {
  background: rgba(56,189,248,0.07); border: 1px solid rgba(56,189,248,0.25);
  border-radius: 8px; padding: 0.6rem 0.85rem; margin: 0.5rem 0;
  font-size: 0.78rem; color: var(--sapa-tenue); line-height: 1.5;
}
.sapa-nota b { color: var(--sapa-texto); }

div[data-testid="stDataFrame"] { border: 1px solid var(--sapa-borde); border-radius: 8px; }
.stButton > button {
  border-radius: 8px; font-weight: 600; letter-spacing: 0.02em;
  border: 1px solid var(--sapa-borde);
}
#MainMenu, footer { visibility: hidden; }
</style>
"""


def aplicar_tema() -> None:
    """Inyecta la hoja de estilos de la aplicacion una sola vez por sesion."""
    if st.session_state.get("_tema_aplicado"):
        return
    st.markdown(_CSS, unsafe_allow_html=True)
    st.session_state["_tema_aplicado"] = True


def cabecera(titulo: str, subtitulo: str, marca: str) -> None:
    """Dibuja la barra superior de la torre de control.

    Args:
        titulo: nombre del modulo activo.
        subtitulo: contexto de la corrida.
        marca: bloque de identificacion a la derecha.
    """
    st.markdown(
        f"""
        <div class="sapa-header">
          <div>
            <h1>{html.escape(titulo)}</h1>
            <div class="sub">{html.escape(subtitulo)}</div>
          </div>
          <div class="marca">{marca}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def kpi(
    etiqueta: str, valor: str, nota: str = "",
    color: str | None = None,
) -> None:
    """Tarjeta de indicador con jerarquia tipografica propia.

    Se usa en lugar de `st.metric` cuando la nota al pie debe explicar el
    supuesto del indicador: un numero sin su base de calculo es una afirmacion
    sin evidencia.
    """
    borde = color or COLORES["acento"]
    st.markdown(
        f"""
        <div class="sapa-kpi" style="border-left-color:{borde}">
          <div class="etiqueta">{html.escape(etiqueta)}</div>
          <div class="valor">{html.escape(valor)}</div>
          <div class="nota">{html.escape(nota)}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def pildora(texto: str, color: str) -> str:
    """Devuelve el HTML de una pildora de estado."""
    return (
        f'<span class="sapa-pill" style="background:{color}22;color:{color};'
        f'border:1px solid {color}55">{html.escape(texto)}</span>'
    )


def excepcion(
    severidad: str, codigo: str, descripcion: str,
    accion: str | None = None, responsable: str | None = None,
    sku: str | None = None,
) -> None:
    """Dibuja una tarjeta de excepcion del plan."""
    color = COLOR_SEVERIDAD.get(severidad.upper(), COLORES["acento"])
    ref = f" · {html.escape(sku)}" if sku else ""
    pie = ""
    if accion:
        resp = f" — <i>{html.escape(responsable)}</i>" if responsable else ""
        pie = f'<div class="acc">&rarr; {html.escape(accion)}{resp}</div>'
    st.markdown(
        f"""
        <div class="sapa-exc" style="border-left-color:{color}">
          <div class="cab">{pildora(severidad, color)}
            <span style="margin-left:6px">{html.escape(codigo)}{ref}</span></div>
          <div class="txt">{html.escape(descripcion)}</div>
          {pie}
        </div>
        """,
        unsafe_allow_html=True,
    )


def nota(texto_html: str) -> None:
    """Bloque de nota metodologica.

    Args:
        texto_html: HTML ya saneado por el llamador. Se usa solo con texto
            literal del codigo, nunca con contenido de la base de datos.
    """
    st.markdown(f'<div class="sapa-nota">{texto_html}</div>', unsafe_allow_html=True)


def plantilla_grafico(fig, alto: int = 340, titulo: str | None = None):
    """Aplica el tema oscuro de la aplicacion a una figura de Plotly.

    Args:
        fig: figura de Plotly.
        alto: altura en pixeles.
        titulo: titulo opcional.

    Returns:
        La misma figura, con el tema aplicado.
    """
    fig.update_layout(
        template="plotly_dark",
        paper_bgcolor=COLORES["superficie"],
        plot_bgcolor=COLORES["superficie"],
        font=dict(color=COLORES["texto"], size=12),
        title=dict(text=titulo or "", font=dict(size=13, color=COLORES["texto"])),
        margin=dict(l=48, r=24, t=44 if titulo else 18, b=40),
        height=alto,
        legend=dict(orientation="h", yanchor="bottom", y=1.0, x=0,
                    font=dict(size=11), bgcolor="rgba(0,0,0,0)"),
        hoverlabel=dict(bgcolor=COLORES["superficie_alta"],
                        bordercolor=COLORES["borde"]),
    )
    fig.update_xaxes(gridcolor=COLORES["borde"], zerolinecolor=COLORES["borde"])
    fig.update_yaxes(gridcolor=COLORES["borde"], zerolinecolor=COLORES["borde"])
    return fig


Severidad = Literal["BLOQUEANTE", "ALTA", "MEDIA", "INFORMATIVA"]
