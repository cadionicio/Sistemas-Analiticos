# Práctica 02: Canvas Model IA

Sistema para modelar negocios con el **Business Model Canvas**, comparando la situación actual (AS IS) con la deseada (TO BE). Calcula y prioriza las brechas entre ambos, propone proyectos con su diagrama de Gantt, simula varios periodos y escenarios, y predice el mes siguiente.

La IA funciona sin internet con una base de conocimiento propia y reglas. De forma opcional puede conectarse a un modelo de lenguaje (API compatible con OpenAI o Anthropic). Todo lo que propone la IA queda marcado como hipótesis hasta que una persona lo aprueba.

## Tecnologías

- **Python**: lenguaje de todo el sistema.
- **Streamlit**: interfaz web creada desde Python.
- **SQLite**: base de datos local en un solo archivo.
- **pandas / NumPy**: manejo de datos y cálculos.
- **Plotly**: gráficos y diagrama de Gantt.
- **python-pptx / openpyxl**: reportes en PowerPoint y lectura o escritura de Excel.
- **PyInstaller**: empaqueta la app como `.exe`.

## Cómo ejecutarlo

```bash
pip install -r requirements.txt
streamlit run canvas_app.py
```

En Windows: `iniciar_con_python.bat`. Para generar el ejecutable: `build_exe.bat`.

## Archivos principales

| Archivo | Para qué sirve |
|---|---|
| `canvas_app.py` | Aplicación principal (pantallas) |
| `ia_engine.py` | Motor de IA: Canvas, brechas, proyectos y Gantt |
| `forecast.py` | Predicción del mes siguiente |
| `db.py` | Base de datos |
| `reports.py` | Reporte en PowerPoint |
| `pruebas_automaticas.py` | Pruebas del sistema |
