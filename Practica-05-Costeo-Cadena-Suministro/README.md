# Práctica 05: Sistema de Costeo de la Cadena de Suministro

Aplicación para calcular los costos de la cadena de suministro con **costeo ABC** (por actividades). Permite cargar los datos desde Excel, ver los resultados por producto y actividad, hacer analítica, simular escenarios y exportar los resultados a Excel, Word y PowerPoint.

Funciona como página HTML sin conexión y como programa de escritorio para Windows, con el mismo código en ambos.

## Tecnologías

- **TypeScript**: lenguaje de la aplicación.
- **esbuild**: compila el código en un solo archivo HTML.
- **sql.js**: SQLite dentro del navegador.
- **ExcelJS**: lectura y escritura de Excel.
- **docx / PptxGenJS**: exportan a Word y PowerPoint.
- **Go + WebView2**: programa de Windows que muestra la app y guarda la base de datos en el equipo.
- **Python**: scripts que generan los datos de prueba.

## Cómo ejecutarlo

```bash
cd web
npm install
node build.mjs 1.0.6     # genera el HTML en web/dist/
```

El script `build.sh` corre las pruebas, genera los datos de prueba, el HTML y el `.exe` (requiere Node, Python y Go).

## Estructura

| Carpeta | Contenido |
|---|---|
| `web/src/domain/` | Motor de costeo ABC, analítica y simulación |
| `web/src/app/` | Casos de uso y exportaciones |
| `web/src/import/` | Importación de datos desde Excel |
| `web/src/db/` | Base de datos |
| `web/src/ui/` | Pantallas y gráficos |
| `web/test/` | Pruebas unitarias, de integración y de extremo a extremo |
| `host/` | Programa de Windows en Go |
| `datos/` | Generadores de datos de prueba (Python) |
