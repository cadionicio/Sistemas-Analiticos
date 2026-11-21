# Práctica 03: SAPA, Sistema Analítico Predictivo de Abastecimiento

Sistema que analiza el abastecimiento y el inventario de una empresa. Funciona con un "superagente" que encadena cuatro tipos de análisis:

1. **Descriptivo**: qué está pasando con el inventario.
2. **Diagnóstico**: por qué está pasando.
3. **Predictivo**: pronóstico de la demanda.
4. **Prescriptivo**: qué conviene comprar y cuándo.

Además incluye simulación, validación de los datos de carga y un tablero de control que se puede exportar a HTML.

## Tecnologías

- **Python**: lenguaje de todo el sistema.
- **Streamlit**: interfaz web del tablero.
- **SQLite**: base de datos local.
- **pandas / NumPy**: procesamiento de datos y cálculos.
- **Plotly**: gráficos del tablero.
- **openpyxl / XlsxWriter**: leen las plantillas de carga y exportan reportes a Excel.
- **PyInstaller**: empaqueta la app como `.exe` (scripts en `build/`).

## Cómo ejecutarlo

```bash
pip install -r requirements.txt
python main.py generar      # crea la base con datos de prueba
streamlit run app.py        # abre el tablero
```

Otros comandos útiles:

```bash
python main.py correr          # ejecuta el superagente
python main.py exportar-html   # genera el tablero en HTML
python -m pytest tests         # pruebas
```

## Estructura

| Carpeta | Contenido |
|---|---|
| `agents/` | Agentes descriptivo, diagnóstico, predictivo y prescriptivo |
| `engine/` | Pronósticos, inventario, simulación y validación |
| `db/` | Base de datos y su esquema |
| `data/` | Generador de datos de prueba e importador de Excel |
| `ui/` | Componentes de la interfaz |
| `config/` | Configuración general |
| `tests/` | Pruebas automáticas |
| `build/` | Scripts para generar el `.exe` |
| `docs/esquema.sql` | Esquema de la base de datos |
