# Práctica 04: Sistema de Análisis de Datos y Predictivo de Gestión de Inventarios

Sistema que importa el kardex y las ventas de una empresa desde Excel, revisa la calidad de los datos y aplica análisis descriptivo, diagnóstico, predictivo (pronósticos con backtest) y prescriptivo (simulación Montecarlo). Tiene un copiloto que explica los resultados y genera informes en Word, PDF y PowerPoint.

El mismo código funciona de dos formas: como página HTML que se abre en el navegador y como programa de escritorio para Windows.

## Tecnologías

- **TypeScript**: lenguaje de la aplicación (JavaScript con tipos).
- **Vite**: compila la app en un solo archivo HTML.
- **sql.js**: SQLite que funciona dentro del navegador.
- **ECharts**: gráficos.
- **SheetJS (xlsx)**: lectura de archivos Excel.
- **docx / jsPDF / PptxGenJS**: generan informes en Word, PDF y PowerPoint.
- **Vitest**: pruebas automáticas.
- **Go + WebView2**: programa de Windows que muestra la app en una ventana nativa.

## Cómo ejecutarlo

```bash
cd app
npm install
npm run dev      # modo desarrollo en el navegador
npm test         # pruebas
npm run build    # genera el HTML final en app/dist/
```

Para generar el HTML y el `.exe` juntos (requiere Go y MinGW): `./construir.sh`.

## Estructura

| Carpeta | Contenido |
|---|---|
| `app/src/core/ingesta/` | Importación y limpieza de datos (kardex y ventas) |
| `app/src/core/analitica/` | Análisis descriptivo, diagnóstico, predictivo y prescriptivo |
| `app/src/core/agentes/` | Copiloto y evaluador |
| `app/src/ui/` | Pantallas, gráficos e informes |
| `app/tests/` | Pruebas automáticas y datos de ejemplo |
| `exe/` | Programa de Windows en Go |
