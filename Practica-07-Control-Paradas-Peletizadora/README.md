<div align="center">

# Control de Paradas y Repuestos: Peletizadora P-01

**Gestión del mantenimiento industrial: paradas, órdenes de trabajo, repuestos e indicadores de confiabilidad**

![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![Electron](https://img.shields.io/badge/Electron-33-47848F?style=flat-square&logo=electron&logoColor=white)
![esbuild](https://img.shields.io/badge/esbuild-FFCF00?style=flat-square&logo=esbuild&logoColor=black)
![SQLite](https://img.shields.io/badge/sql.js-003B57?style=flat-square&logo=sqlite&logoColor=white)
![Python](https://img.shields.io/badge/Python-3776AB?style=flat-square&logo=python&logoColor=white)
![Versión](https://img.shields.io/badge/versión-1.0.2-informational?style=flat-square)

</div>

---

## Descripción

Sistema para gestionar el mantenimiento de una **peletizadora industrial (P-01)**. Registra cada parada de la máquina, las órdenes de trabajo y el consumo de repuestos, y calcula los indicadores clave de mantenimiento para orientar la mejora continua.

> Todos los datos son sintéticos.

## Funcionalidades

- **Registro de paradas**: tipo, causa, duración e impacto en la producción.
- **Órdenes de trabajo**: correctivas y preventivas, con su ciclo de vida.
- **Mantenimiento preventivo**: planificación y seguimiento.
- **Control de repuestos**: consumo y disponibilidad.
- **Indicadores de confiabilidad**: MTBF, MTTR, disponibilidad y análisis de Pareto.
- **Simulación** de escenarios de mejora.
- **Gestión de usuarios** y trazabilidad de los registros.
- **Exportación** de resultados operativos, analítica y proyecciones a Excel.

## Stack tecnológico

| Tecnología | Uso en el proyecto |
|---|---|
| **JavaScript** | Lenguaje de la aplicación |
| **esbuild** | Empaqueta todo el código en un único HTML |
| **sql.js** | SQLite embebido |
| **SheetJS (xlsx)** | Importación y exportación de Excel |
| **Electron** | Aplicación de escritorio para Windows con el mismo código del HTML |
| **Python** | Generador de datos sintéticos |

## Instalación y uso

**Requisitos:** Node.js 20 o superior.

```bash
npm install

node build.js 1.0.2     # Genera el HTML autocontenido
npx electron-builder    # Genera el ejecutable portable de Windows
```

## Arquitectura

```
          src/main.js  (punto de entrada común)
                 │
     ┌───────────┼────────────┐
     ▼           ▼            ▼
   ui/       nucleo/      adaptadores/
 pantallas   cálculos,    Excel, exportación
             analítica,   y persistencia
             simulación
                 │
            sql.js (SQLite)
```

## Estructura del proyecto

```
├── src/
│   ├── nucleo/        # Base de datos, operaciones, analítica y simulación
│   ├── ui/            # Vistas: paradas, órdenes, preventivo, indicadores, simulación, usuarios
│   ├── adaptadores/   # Importación y exportación de Excel, persistencia
│   └── plantilla.html # Plantilla del HTML final
├── electron/          # Aplicación de escritorio
├── pruebas/           # Pruebas automáticas y de paridad HTML/EXE
├── datos/             # Datos de entrada de ejemplo
├── tools/             # Generador de datos sintéticos
├── recursos/          # Íconos e ilustraciones
└── build.js           # Script de compilación
```

## Autor

**Cesar Alonso Dionicio Achachagua** · Universidad Nacional de Ingeniería
