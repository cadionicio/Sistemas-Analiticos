<div align="center">

# Canvas Model IA

**Modelamiento de negocios con Business Model Canvas, análisis de brechas y simulación de escenarios**

![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white)
![Streamlit](https://img.shields.io/badge/Streamlit-FF4B4B?style=flat-square&logo=streamlit&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white)
![Plotly](https://img.shields.io/badge/Plotly-3F4F75?style=flat-square&logo=plotly&logoColor=white)
![IA](https://img.shields.io/badge/IA-local%20%2B%20LLM%20opcional-8A2BE2?style=flat-square)

</div>

---

## Descripción

**Canvas Model IA** permite modelar un negocio con los nueve bloques del **Business Model Canvas** y comparar la situación actual (**AS IS**) con la situación deseada (**TO BE**). El sistema identifica y prioriza las brechas entre ambos modelos, propone los proyectos necesarios para cerrarlas y les da seguimiento con un diagrama de Gantt.

La IA funciona **sin conexión** con una base de conocimiento sectorial y reglas propias. De forma opcional, puede conectarse a un modelo de lenguaje compatible con las API de OpenAI o Anthropic. Toda propuesta de la IA queda marcada como **hipótesis** y requiere aprobación humana.

## Funcionalidades

- **Canvas AS IS / TO BE**: formulación asistida de los nueve bloques.
- **Validación**: reglas de integridad y coherencia entre bloques.
- **Análisis de brechas**: comparación de versiones, cálculo y priorización.
- **Cartera de proyectos**: propuesta automática y diagrama de Gantt.
- **Simulación**: varios periodos y varios escenarios.
- **Predicción**: pronóstico del mes siguiente.
- **Dashboard y reportes**: tablero de seguimiento y reporte en PowerPoint.

## Stack tecnológico

| Tecnología | Uso en el proyecto |
|---|---|
| **Python** | Lenguaje principal |
| **Streamlit** | Interfaz web interactiva |
| **SQLite** | Base de datos local |
| **pandas · NumPy** | Manejo de datos y cálculos |
| **Plotly** | Gráficos y diagrama de Gantt |
| **python-pptx · openpyxl** | Reportes en PowerPoint e intercambio con Excel |
| **PyInstaller** | Empaquetado como ejecutable de Windows |

## Instalación y uso

**Requisitos:** Python 3.10 o superior.

```bash
pip install -r requirements.txt
streamlit run canvas_app.py
```

**En Windows:** `iniciar_con_python.bat` inicia la aplicación y `build_exe.bat` genera el ejecutable.

## Pruebas

```bash
python pruebas_automaticas.py
```

## Estructura del proyecto

```
├── canvas_app.py            # Aplicación principal y pantallas
├── ia_engine.py             # Motor de IA: Canvas, brechas, proyectos y Gantt
├── forecast.py              # Pronóstico del mes siguiente
├── db.py                    # Capa de acceso a datos (SQLite)
├── reports.py               # Generador de reportes PowerPoint
├── run_canvas.py            # Lanzador del ejecutable
├── build_html.py            # Generador de la versión HTML
└── pruebas_automaticas.py   # Pruebas del sistema
```

## Autor

**Cesar Alonso Dionicio Achachagua** · Universidad Nacional de Ingeniería
