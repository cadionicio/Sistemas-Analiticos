<div align="center">

# Gestión y Control Estratégico IA

**Planeamiento estratégico y control de gestión con Balanced Scorecard asistido por inteligencia artificial**

![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=flat-square&logo=python&logoColor=white)
![Streamlit](https://img.shields.io/badge/Streamlit-FF4B4B?style=flat-square&logo=streamlit&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white)
![Plotly](https://img.shields.io/badge/Plotly-3F4F75?style=flat-square&logo=plotly&logoColor=white)
![Versión](https://img.shields.io/badge/versión-1.0.0-informational?style=flat-square)

</div>

---

## Descripción

**GCE-IA** acompaña a una empresa en todo el ciclo de su planeamiento estratégico: define la estrategia, la traduce a un **Balanced Scorecard** con sus cuatro perspectivas (financiera, clientes, procesos internos y aprendizaje), da seguimiento mensual a los indicadores y simula escenarios financieros.

Un motor de IA integrado sugiere objetivos, indicadores y metas coherentes con el sector de la empresa, para acelerar el trabajo del analista.

## Funcionalidades

- **Planeamiento estratégico**: misión, visión, objetivos estratégicos y mapa de la estrategia.
- **Balanced Scorecard**: indicadores por perspectiva, con metas, responsables y semáforos.
- **Control mensual**: registro de resultados reales frente a las metas.
- **Simulador financiero**: proyección de escenarios y cálculo de indicadores financieros.
- **Asistente de IA**: sugerencias de objetivos e indicadores según el sector.
- **Reportes ejecutivos**: generación automática de presentaciones en PowerPoint.

## Stack tecnológico

| Tecnología | Uso en el proyecto |
|---|---|
| **Python** | Lenguaje principal de todo el sistema |
| **Streamlit** | Interfaz web interactiva construida desde Python |
| **SQLite** | Base de datos local en un solo archivo, sin servidor |
| **pandas · NumPy** | Procesamiento de datos y cálculos |
| **Plotly** | Gráficos interactivos y tableros |
| **python-pptx · openpyxl** | Reportes en PowerPoint e intercambio con Excel |
| **PyInstaller** | Empaquetado como ejecutable de Windows |

## Instalación y uso

**Requisitos:** Python 3.11 o superior.

```bash
# 1. Instalar dependencias
pip install -r requirements.txt

# 2. Iniciar la aplicación
streamlit run app.py
```

La aplicación se abre en el navegador en `http://localhost:8501`.

**En Windows** también puedes usar los scripts incluidos:

| Script | Acción |
|---|---|
| `Preparar_Entorno_GCE.bat` | Instala las dependencias |
| `Iniciar_GCE_IA.bat` | Inicia la aplicación |
| `Construir_EXE_GCE.bat` | Genera el ejecutable `.exe` |
| `Construir_HTML_GCE.bat` | Genera la versión HTML |

## Pruebas

```bash
python autoprueba.py
```

## Estructura del proyecto

```
├── app.py               # Punto de entrada
├── config.py            # Rutas y parámetros globales
├── db.py                # Capa de acceso a datos (SQLite)
├── motor_ia.py          # Motor de IA: sugerencias estratégicas
├── finanzas.py          # Cálculos financieros
├── simulador.py         # Simulación de escenarios
├── vistas_plan.py       # Pantallas de planeamiento
├── vistas_bsc.py        # Pantallas del Balanced Scorecard
├── vistas_control.py    # Pantallas de control mensual
├── vistas_base.py       # Componentes comunes de las vistas
├── ui.py                # Estilos de la interfaz
├── reporte_ppt.py       # Generador de reportes PowerPoint
├── run_gce.py           # Lanzador del ejecutable
└── autoprueba.py        # Prueba automática
```

## Autor

**Cesar Alonso Dionicio Achachagua** · Universidad Nacional de Ingeniería
