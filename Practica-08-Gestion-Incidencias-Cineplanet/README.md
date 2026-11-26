<div align="center">

# Gestión de Incidencias: caso Cineplanet

**Atención de incidencias de compra de entradas, con expediente único entre canales y Design Thinking integrado**

![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=flat-square&logo=python&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![pywebview](https://img.shields.io/badge/pywebview-WebView2-0078D4?style=flat-square)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white)
![IndexedDB](https://img.shields.io/badge/IndexedDB-FF6F00?style=flat-square)
![Sin dependencias](https://img.shields.io/badge/frontend-sin%20dependencias-success?style=flat-square)
![Versión](https://img.shields.io/badge/versión-0.8.2-informational?style=flat-square)

</div>

---

## Descripción

Sistema para atender las incidencias de los clientes al comprar entradas de cine: cobros sin entrada, pagos duplicados, entradas no emitidas o problemas al ingresar a la sala.

El problema de fondo es que un mismo caso pasaba por varios canales (web o app, Atención Digital y Boletería) y cada uno empezaba de cero. La solución crea un **expediente único** con un código compartido: todos los canales ven el mismo historial, el responsable y la siguiente acción. Además, el sistema prioriza cada caso según el tiempo que falta para el inicio de la función.

El proyecto se desarrolló con la metodología **Design Thinking**, que está integrada en la propia aplicación.

> Proyecto académico con datos sintéticos. No está afiliado a Cineplanet.

## Funcionalidades

**Gestión de incidencias**
- **Registro** del cliente desde la web o la app y **seguimiento** del estado de su caso.
- **Bandeja priorizada** según los minutos que faltan para la función: crítico (≤ 15 min), urgente (≤ 45 min) o normal.
- **Expediente único** compartido entre Atención Digital y Boletería, con detección de casos duplicados.
- **Verificación** del estado de compra, pago, emisión e ingreso antes de resolver.
- **Derivación entre canales** y registro de la resolución con su evidencia.

**Design Thinking (5 etapas, 10 herramientas)**

| Etapa | Herramientas |
|---|---|
| Empatizar | Mapa de empatía · Mapa del recorrido del cliente |
| Definir | Diagrama causa-efecto · Punto de vista y «¿Cómo podríamos…?» |
| Idear | Brainwriting · Matriz de priorización |
| Prototipar | Guion gráfico · Fichas de evidencia física del servicio |
| Probar | Prueba por tareas · Resultados y mejora |

Las herramientas se **generan automáticamente** a partir de los datos registrados. Las decisiones finales quedan pendientes de confirmación humana.

**Indicadores y datos**
- **Indicadores** de la operación piloto, simulación de escenarios y estimación del valor de la mejora.
- **Carga masiva desde Excel** con validación completa antes de guardar, de forma atómica e idempotente.
- **Exportación** de resultados a Excel.
- **Roles y permisos**: Cliente, Atención Digital, Boletería y Supervisión.
- **Respaldos** automáticos de la base de datos.

## Stack tecnológico

| Tecnología | Uso en el proyecto |
|---|---|
| **JavaScript (sin frameworks)** | Interfaz y reglas del negocio, sin dependencias externas |
| **Python** | Aplicación de escritorio y acceso a la base de datos |
| **pywebview (WebView2)** | Ventana nativa de Windows que muestra la interfaz web |
| **SQLite** | Base de datos de la versión de escritorio, con migraciones versionadas |
| **IndexedDB** | Base de datos del navegador para la versión HTML |
| **Lector/escritor XLSX propio** | Importa y exporta Excel sin librerías externas |
| **PBKDF2** | Protección de contraseñas, idéntica en Python y JavaScript |
| **PyInstaller** | Empaquetado como ejecutable de Windows |

## Arquitectura

El mismo núcleo de reglas se usa en las dos versiones; solo cambia dónde se guardan los datos.

```
                ┌──────────────────────────────┐
                │  Interfaz (app.js, dt.js...) │
                ├──────────────────────────────┤
                │  Núcleo de reglas (nucleo.js)│
                └──────────────┬───────────────┘
                 ┌─────────────┴─────────────┐
                 ▼                           ▼
       almacen_idb.js                 almacen_exe.js
       IndexedDB                      Puente Python (puente.py)
       ── PC08.html ──                valida sesión, rol y permisos
                                              │
                                           SQLite
                                      ── PC08.exe ──
```

## Instalación y uso

**Requisitos:** Python 3.11 o superior (Windows, para la versión de escritorio). Node.js solo para las pruebas del núcleo.

```bash
# Versión de escritorio
pip install -r requirements.txt
python lanzar_pc08.py
```

**Versión web:** abre `web/index.html` en el navegador. Para generar un único archivo HTML con todo incluido:

```bash
python build/html_unico.py PC08.html
```

**Ejecutable de Windows:** `construir_exe.cmd` genera `PC08.exe` y `PC08.html`.

## Pruebas

```bash
python pruebas/ejecutar.py            # Base de datos y permisos
node pruebas/nucleo.test.js           # Reglas del núcleo (prioridad, enlaces, contraseñas)
python pruebas/carga_concurrente.py   # Volumen y concurrencia: 1.000 incidencias, 5 sesiones
```

La prueba de carga verifica que las consultas respondan en menos de 1 s y los guardados en menos de 2 s (percentil 95), sin pérdidas ni escrituras parciales.

## Estructura del proyecto

```
├── web/
│   ├── index.html
│   ├── css/app.css
│   ├── img/                 # Logotipos
│   └── js/
│       ├── nucleo.js        # Reglas del negocio: prioridad, estados, validaciones
│       ├── app.js           # Interfaz de usuario
│       ├── dt.js            # Herramientas de Design Thinking
│       ├── dt_auto.js       # Generación automática del Design Thinking
│       ├── dt_graficos.js   # Gráficos de las herramientas
│       ├── resultados.js    # Indicadores, simulación y exportaciones
│       ├── carga.js         # Carga masiva desde Excel
│       ├── xlsx.js          # Lectura y escritura de XLSX
│       ├── almacen_idb.js   # Almacenamiento en IndexedDB (versión HTML)
│       └── almacen_exe.js   # Almacenamiento vía Python (versión EXE)
├── exe/pc08/
│   ├── principal.py         # Ventana de la aplicación
│   ├── puente.py            # Puente interfaz–base de datos con control de permisos
│   ├── db.py                # Acceso a SQLite
│   ├── enlaces.py           # Validación de enlaces externos
│   └── migraciones/         # Esquema versionado de la base de datos
├── pruebas/                 # Pruebas automáticas
├── build/                   # Configuración del empaquetado
├── construir_exe.cmd        # Script de compilación
└── lanzar_pc08.py           # Punto de entrada
```

## Autor

**Cesar Alonso Dionicio Achachagua** · Universidad Nacional de Ingeniería
