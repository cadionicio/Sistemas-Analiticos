<div align="center">

# Sistema de Distribución Multimodal: caso Alprosa

**Gestión integral de la distribución de una empresa de alimentos: operación, planificación, control y analítica**

![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-47848F?style=flat-square&logo=electron&logoColor=white)
![SQLite](https://img.shields.io/badge/sql.js-003B57?style=flat-square&logo=sqlite&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=flat-square&logo=vitest&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat-square&logo=playwright&logoColor=white)

</div>

---

## Descripción

Sistema para gestionar la distribución multimodal de una empresa de alimentos, desde la operación diaria hasta la analítica de resultados. Cubre transporte, costos, envases retornables, pronóstico de demanda y simulación de escenarios, con control de acceso por roles.

> Los datos corresponden a una empresa de ejemplo ("NutriDemo") y son completamente sintéticos.

## Funcionalidades

| Área | Qué incluye |
|---|---|
| **Operación** | Registro de pedidos, despachos y movimientos de almacén con rotación FEFO |
| **Planificación** | Planificación del transporte y de los recorridos de distribución |
| **Control** | Indicadores (KPI), costos logísticos y alertas |
| **Analítica** | Diagnóstico, pronóstico de demanda y simulación de escenarios |
| **Retornables** | Seguimiento de envases y activos retornables |
| **Datos** | Carga desde Excel, migraciones y respaldos |
| **Seguridad** | Ingreso por PIN y permisos por rol |

**Roles del sistema:** Administrador · Responsable de datos · Encargado de pedidos · Encargado de almacén.

## Stack tecnológico

| Tecnología | Uso en el proyecto |
|---|---|
| **React 19** | Interfaz de usuario basada en componentes |
| **TypeScript** | Lenguaje de toda la aplicación |
| **Vite** | Compilación en un único archivo HTML |
| **sql.js** | SQLite embebido |
| **ExcelJS · docx · PptxGenJS** | Exportación a Excel, Word y PowerPoint |
| **Electron** | Aplicación de escritorio para Windows |
| **Vitest** | Pruebas unitarias y de rendimiento |
| **Playwright** | Pruebas de extremo a extremo de la interfaz |

## Instalación y uso

**Requisitos:** Node.js 20 o superior.

```bash
npm install

npm run build:html   # Genera la versión HTML
npm test             # Ejecuta las pruebas
npm run build:exe    # Genera el ejecutable portable de Windows
```

## Estructura del proyecto

```
├── src/
│   ├── core/          # Lógica de negocio
│   │   ├── transporte.ts, recorrido.ts     # Distribución y rutas
│   │   ├── costos.ts, economia.ts, kpi.ts  # Costos e indicadores
│   │   ├── pronostico.ts, simulacion.ts    # Analítica predictiva
│   │   ├── retornables.ts, alertas.ts      # Control operativo
│   │   └── permisos.ts, sesion.ts          # Seguridad
│   ├── ui/            # Pantallas en React
│   └── platform/      # Adaptador de almacenamiento
├── electron/          # Proceso principal de la aplicación de escritorio
└── tests/             # Pruebas unitarias, de casos y e2e
```

## Autor

**Cesar Alonso Dionicio Achachagua** · Universidad Nacional de Ingeniería
