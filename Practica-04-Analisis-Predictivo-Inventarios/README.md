<div align="center">

# SADPGI: Sistema de Análisis de Datos y Predictivo de Gestión de Inventarios

**Analítica descriptiva, diagnóstica, predictiva y prescriptiva de inventarios, con copiloto de IA**

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white)
![Go](https://img.shields.io/badge/Go-1.24-00ADD8?style=flat-square&logo=go&logoColor=white)
![SQLite](https://img.shields.io/badge/sql.js-003B57?style=flat-square&logo=sqlite&logoColor=white)
![ECharts](https://img.shields.io/badge/ECharts-AA344D?style=flat-square&logo=apacheecharts&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=flat-square&logo=vitest&logoColor=white)

</div>

---

## Descripción

**SADPGI** importa el kardex y el registro de ventas de una empresa desde Excel, evalúa la calidad de los datos y ejecuta un análisis completo del inventario. Un **copiloto** explica los resultados en lenguaje natural y el sistema genera informes ejecutivos listos para presentar.

El mismo núcleo se distribuye de dos formas:

- **HTML autocontenido**: se abre en cualquier navegador, sin instalación ni internet.
- **Ejecutable de Windows**: ventana nativa en Go + WebView2 que no deja rastros fuera de su carpeta.

## Funcionalidades

- **Ingesta inteligente**: detecta el tipo de archivo, mapea columnas por sinónimos y evalúa la calidad de los datos.
- **Analítica descriptiva y diagnóstica**: clasificación ABC-XYZ, rotación y causas de quiebres y excesos.
- **Pronóstico**: media móvil, Holt, Holt-Winters y Croston, con selección del mejor modelo por *backtest*.
- **Analítica prescriptiva**: lote económico (EOQ), stock de seguridad y simulación Montecarlo.
- **Copiloto de IA**: funciona con reglas locales y, de forma opcional, con un LLM (Anthropic u OpenAI).
- **Informes**: exportación a Word, PDF y PowerPoint, con control de versiones.

## Stack tecnológico

| Tecnología | Uso en el proyecto |
|---|---|
| **TypeScript** | Lenguaje de toda la aplicación |
| **Vite** | Compilación en un único archivo HTML |
| **sql.js** | SQLite ejecutándose dentro del navegador |
| **ECharts** | Gráficos interactivos |
| **SheetJS (xlsx)** | Lectura de archivos Excel |
| **docx · jsPDF · PptxGenJS** | Informes en Word, PDF y PowerPoint |
| **Web Workers** | Cálculos pesados sin congelar la interfaz |
| **Vitest** | Pruebas unitarias |
| **Go + WebView2** | Ejecutable nativo de Windows |

## Instalación y uso

**Requisitos:** Node.js 20 o superior. Para el ejecutable, además: Go 1.24 y MinGW.

```bash
cd app
npm install

npm run dev        # Servidor de desarrollo
npm run build      # Genera el HTML final en app/dist/
npm test           # Ejecuta las pruebas
npm run typecheck  # Verifica los tipos
```

Para compilar el HTML y el ejecutable en un solo paso:

```bash
./construir.sh
```

## Estructura del proyecto

```
├── app/
│   ├── src/
│   │   ├── core/
│   │   │   ├── ingesta/     # Importación, mapeo y calidad de datos
│   │   │   ├── analitica/   # Descriptivo, diagnóstico, predictivo, prescriptivo
│   │   │   ├── agentes/     # Copiloto y evaluador
│   │   │   └── db/          # Esquema y acceso a SQLite
│   │   ├── ui/              # Pantallas, gráficos e informes
│   │   └── worker/          # Motor de cálculo en segundo plano
│   └── tests/               # Pruebas unitarias, e2e y datos de referencia
├── exe/                     # Ejecutable de Windows (Go + WebView2)
└── construir.sh             # Script de compilación
```

## Autor

**Cesar Alonso Dionicio Achachagua** · Universidad Nacional de Ingeniería
