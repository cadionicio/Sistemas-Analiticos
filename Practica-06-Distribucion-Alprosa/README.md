# Práctica 06: Sistema de Distribución Multimodal (caso Alprosa)

Sistema para gestionar la distribución de productos de una empresa de alimentos: operación diaria, planificación de rutas y transporte, control de costos y KPI, envases retornables, alertas, pronósticos y simulación de escenarios. Tiene usuarios con permisos e ingreso por PIN, y exporta resultados a Excel, Word y PowerPoint.

Los datos son sintéticos (empresa de ejemplo "NutriDemo").

## Tecnologías

- **React**: construye la interfaz con componentes.
- **TypeScript**: lenguaje de la aplicación.
- **Vite**: compila la app en un solo archivo HTML.
- **sql.js**: SQLite dentro de la aplicación.
- **ExcelJS / docx / PptxGenJS**: exportan a Excel, Word y PowerPoint.
- **Electron**: convierte la app web en un programa de escritorio para Windows.
- **Vitest / Playwright**: pruebas automáticas y de la interfaz.

## Cómo ejecutarlo

```bash
npm install
npm run build:html   # genera el HTML
npm test             # pruebas
npm run build:exe    # genera el .exe portable para Windows
```

## Estructura

| Carpeta | Contenido |
|---|---|
| `src/core/` | Lógica del negocio: transporte, costos, KPI, pronóstico, simulación, permisos |
| `src/ui/` | Pantallas en React |
| `electron/` | Programa de escritorio |
| `tests/` | Pruebas automáticas |
