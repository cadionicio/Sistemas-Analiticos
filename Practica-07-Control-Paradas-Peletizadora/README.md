# Práctica 07: Control de Paradas y Repuestos de una Peletizadora (P-01)

Sistema para el mantenimiento de una máquina peletizadora: registra las paradas, las órdenes de trabajo, el mantenimiento preventivo y los repuestos. Calcula indicadores (como disponibilidad y tiempos entre fallas), hace analítica, simula escenarios de mejora y exporta todo a Excel. Tiene manejo de usuarios.

Los datos son sintéticos.

## Tecnologías

- **JavaScript**: lenguaje de la aplicación.
- **esbuild**: junta todo el código en un solo archivo HTML.
- **sql.js**: SQLite dentro de la aplicación.
- **SheetJS (xlsx)**: lectura y escritura de Excel.
- **Electron**: programa de escritorio para Windows con el mismo código del HTML.
- **Python**: script que genera los datos de prueba.

## Cómo ejecutarlo

```bash
npm install
node build.js 1.0.2          # genera el HTML
npx electron-builder         # genera el .exe portable
```

## Estructura

| Carpeta | Contenido |
|---|---|
| `src/nucleo/` | Base de datos, cálculos, analítica y simulación |
| `src/ui/` | Pantallas: paradas, órdenes, preventivo, indicadores, simulación, usuarios |
| `src/adaptadores/` | Importar y exportar Excel, guardar datos |
| `electron/` | Programa de escritorio |
| `pruebas/` | Pruebas automáticas |
| `datos/` | Datos de entrada de ejemplo |
| `tools/` | Generador de datos de prueba |
