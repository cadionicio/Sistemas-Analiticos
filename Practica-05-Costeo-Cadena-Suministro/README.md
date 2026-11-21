<div align="center">

# Sistema de Costeo de la Cadena de Suministro

**Costeo basado en actividades (ABC), analítica y simulación de la cadena de suministro**

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![esbuild](https://img.shields.io/badge/esbuild-FFCF00?style=flat-square&logo=esbuild&logoColor=black)
![Go](https://img.shields.io/badge/Go-1.22-00ADD8?style=flat-square&logo=go&logoColor=white)
![SQLite](https://img.shields.io/badge/sql.js-003B57?style=flat-square&logo=sqlite&logoColor=white)
![Python](https://img.shields.io/badge/Python-3776AB?style=flat-square&logo=python&logoColor=white)
![Versión](https://img.shields.io/badge/versión-1.0.6-informational?style=flat-square)

</div>

---

## Descripción

Este sistema calcula el costo real de la cadena de suministro con la metodología de **costeo basado en actividades (ABC)**: asigna los recursos a las actividades y las actividades a los productos, para saber cuánto cuesta realmente cada uno.

A partir de esos costos ofrece analítica, simulación de escenarios y cálculo del **valor económico agregado (EVA)**, con exportación de resultados para la toma de decisiones.

Funciona como **HTML offline** y como **ejecutable de Windows**, con un único núcleo de cálculo compartido.

## Funcionalidades

- **Carga de datos** desde plantillas de Excel, con validación.
- **Motor de costeo ABC**: recursos → actividades → productos.
- **Analítica**: análisis de costos por producto y por actividad, con gráficos de resultados.
- **Simulación de escenarios** y cálculo del EVA.
- **Exportación** de resultados a Excel, Word y PowerPoint.
- **Persistencia segura** en el ejecutable: escritura atómica y respaldos automáticos.

## Stack tecnológico

| Tecnología | Uso en el proyecto |
|---|---|
| **TypeScript** | Lenguaje de la aplicación y del motor de costeo |
| **esbuild** | Compilación en un único archivo HTML |
| **sql.js** | SQLite dentro del navegador |
| **ExcelJS** | Lectura y escritura de Excel |
| **docx · PptxGenJS** | Exportación a Word y PowerPoint |
| **Go + WebView2** | Ejecutable de Windows con almacenamiento local |
| **Python** | Generadores de datos sintéticos |
| **Node test runner** | Pruebas unitarias y de integración |

## Instalación y uso

**Requisitos:** Node.js 20 o superior y Python 3. Para el ejecutable, además: Go 1.22.

```bash
cd web
npm install
node build.mjs 1.0.6     # Genera el HTML en web/dist/
```

El script `build.sh` ejecuta el proceso completo: genera los datos de prueba, corre las pruebas y compila el HTML y el ejecutable.

```bash
./build.sh 1.0.6
```

## Arquitectura

```
┌─────────────────────────────────────────────┐
│  UI (pantallas, gráficos, resultados)       │
├─────────────────────────────────────────────┤
│  Casos de uso · Importación · Exportación   │
├─────────────────────────────────────────────┤
│  Dominio: motor ABC · analítica · EVA       │
├─────────────────────────────────────────────┤
│  Almacenamiento: sql.js (SQLite)            │
└─────────────────────────────────────────────┘
        ▲                         ▲
   Navegador (HTML)        Host Go + WebView2 (EXE)
```

## Estructura del proyecto

```
├── web/
│   ├── src/
│   │   ├── domain/   # Motor de costeo ABC, analítica, simulación y EVA
│   │   ├── app/      # Casos de uso y exportaciones
│   │   ├── import/   # Importación de plantillas Excel
│   │   ├── db/       # Esquema y almacenamiento
│   │   └── ui/       # Interfaz de usuario
│   └── test/         # Pruebas unitarias, de integración y e2e
├── host/             # Ejecutable de Windows (Go + WebView2)
├── datos/            # Generadores de datos sintéticos (Python)
└── build.sh          # Compilación y pruebas
```

## Autor

**Cesar Alonso Dionicio Achachagua** · Universidad Nacional de Ingeniería
