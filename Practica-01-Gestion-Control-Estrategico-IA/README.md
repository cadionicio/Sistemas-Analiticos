# Práctica 01: Gestión y Control Estratégico con IA (GCE-IA)

Aplicación para hacer el planeamiento estratégico de una empresa con el **Balanced Scorecard**: se definen objetivos, indicadores y metas, se hace el control mensual y se simulan escenarios financieros. Incluye un motor de IA que sugiere objetivos e indicadores y genera un reporte en PowerPoint.

## Tecnologías

- **Python**: lenguaje de todo el sistema.
- **Streamlit**: crea la interfaz web (pantallas, formularios y tablas) desde Python.
- **SQLite**: base de datos local en un solo archivo, sin instalar un servidor.
- **pandas / NumPy**: cálculos con tablas y números.
- **Plotly**: gráficos interactivos.
- **python-pptx / openpyxl**: generan reportes en PowerPoint y leen o escriben Excel.
- **PyInstaller**: empaqueta la app como un `.exe` para Windows.

## Cómo ejecutarlo

```bash
pip install -r requirements.txt
streamlit run app.py
```

En Windows también puedes usar `Preparar_Entorno_GCE.bat` (instala dependencias) y luego `Iniciar_GCE_IA.bat`. Para generar el ejecutable: `Construir_EXE_GCE.bat`.

## Archivos principales

| Archivo | Para qué sirve |
|---|---|
| `app.py` | Punto de entrada de la aplicación |
| `config.py` | Rutas y parámetros generales |
| `db.py` | Acceso a la base de datos |
| `motor_ia.py` | Motor de IA que sugiere objetivos e indicadores |
| `finanzas.py`, `simulador.py` | Cálculos financieros y simulación de escenarios |
| `vistas_*.py`, `ui.py` | Pantallas de la aplicación |
| `reporte_ppt.py` | Genera el reporte en PowerPoint |
| `autoprueba.py` | Prueba automática del sistema |
