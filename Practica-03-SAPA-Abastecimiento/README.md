<div align="center">

# SAPA: Sistema Analítico Predictivo de Abastecimiento

**Superagente de analítica para la gestión del abastecimiento y los inventarios**

![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white)
![Streamlit](https://img.shields.io/badge/Streamlit-FF4B4B?style=flat-square&logo=streamlit&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white)
![pytest](https://img.shields.io/badge/pytest-0A9EDC?style=flat-square&logo=pytest&logoColor=white)
![Versión](https://img.shields.io/badge/versión-2.1.0-informational?style=flat-square)

</div>

---

## Descripción

**SAPA** analiza el abastecimiento de una empresa mediante un **superagente** que encadena cuatro agentes especializados, cada uno a cargo de una capa de la analítica:

```
Datos ──► Descriptivo ──► Diagnóstico ──► Predictivo ──► Prescriptivo ──► Tablero
          ¿qué pasa?      ¿por qué?       ¿qué pasará?   ¿qué hacer?
```

El resultado es un tablero de control con el estado del inventario, el pronóstico de la demanda y las recomendaciones de compra.

## Funcionalidades

- **Clasificación ABC-XYZ** de productos por valor y por variabilidad de la demanda.
- **Pronóstico de demanda** con Holt-Winters y Croston (para demanda intermitente).
- **Política de inventario**: lote económico (EOQ), stock de seguridad y punto de reorden.
- **Reglas de rotación** FIFO, LIFO y FEFO, según el tipo de producto.
- **Simulación Montecarlo** de escenarios de demanda y abastecimiento.
- **Validación de datos de carga**: rechaza registros inconsistentes indicando el motivo.
- **Tablero exportable** a HTML autocontenido, que funciona sin internet.

## Stack tecnológico

| Tecnología | Uso en el proyecto |
|---|---|
| **Python** | Lenguaje principal |
| **Streamlit** | Interfaz del tablero de control |
| **SQLite** | Base de datos local |
| **pandas · NumPy** | Procesamiento de datos y modelos de cálculo |
| **Plotly** | Visualizaciones del tablero |
| **openpyxl · XlsxWriter** | Lectura de plantillas de carga y exportación a Excel |
| **pytest** | Pruebas automáticas |
| **PyInstaller** | Empaquetado como ejecutable de Windows |

## Instalación y uso

**Requisitos:** Python 3.10 o superior.

```bash
# 1. Instalar dependencias
pip install -r requirements.txt

# 2. Generar la base con datos sintéticos
python main.py generar

# 3. Abrir el tablero
streamlit run app.py
```

### Comandos disponibles

| Comando | Descripción |
|---|---|
| `python main.py generar` | Regenera el conjunto de datos sintéticos |
| `python main.py diagnostico` | Muestra el estado de la base de datos |
| `python main.py correr` | Ejecuta el pipeline completo del superagente |
| `python main.py exportar-html` | Genera el tablero HTML autocontenido |
| `python main.py plantillas` | Genera las plantillas de carga en Excel |
| `python main.py exportar-excel` | Exporta los datos de prueba a Excel |
| `python main.py exportar-ddl` | Exporta el esquema de la base de datos |

## Pruebas

```bash
python -m pytest tests
```

## Estructura del proyecto

```
├── agents/          # Superagente y agentes descriptivo, diagnóstico, predictivo y prescriptivo
├── engine/          # Pronósticos, inventario, simulación, calendario y validación
├── db/              # Gestor de base de datos y esquema (DDL)
├── data/            # Generador de datos sintéticos e importador de Excel
├── ui/              # Componentes de la interfaz
├── config/          # Configuración central
├── utils/           # Utilidades (registro de eventos)
├── tests/           # Pruebas automáticas
├── build/           # Scripts de empaquetado del ejecutable
├── docs/esquema.sql # Esquema de la base de datos
├── app.py           # Interfaz Streamlit
├── main.py          # Línea de comandos
└── run_app.py       # Lanzador del ejecutable
```

## Autor

**Cesar Alonso Dionicio Achachagua** · Universidad Nacional de Ingeniería
