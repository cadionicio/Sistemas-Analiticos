<#
.SYNOPSIS
    Compila SAPA a un ejecutable nativo de Windows con Nuitka.

.DESCRIPTION
    Genera una DISTRIBUCION EN CARPETA (--standalone), no un archivo unico.
    La eleccion no es estetica: un .exe de un solo archivo es un
    autoextraible que descomprime en %TEMP% y ejecuta desde alli, patron que
    Windows Defender puntua como sospechoso por heuristica y que ademas
    retrasa el arranque varios segundos en cada ejecucion.

    SOBRE SMARTSCREEN — lease antes de compilar
    --------------------------------------------
    SmartScreen NO se dispara por el empaquetado. Se dispara por FALTA DE
    REPUTACION sobre un archivo que lleva la marca Mark-of-the-Web (MotW), el
    flujo alternativo Zone.Identifier que Windows adjunta a todo archivo
    descargado de Internet, recibido por correo o sincronizado desde la nube.

    De ahi se siguen tres hechos que conviene no confundir:

      1. Ningun parametro de Nuitka elimina SmartScreen. Solo lo eliminan
         (a) que el archivo no lleve MotW, o (b) una firma de codigo con
         certificado OV/EV, que cuesta dinero y tarda dias en emitirse.
      2. Entregar la carpeta en un ZIP descargable SI propaga MotW a los
         archivos extraidos con el Explorador de Windows. Por eso se incluye
         DESBLOQUEAR.bat dentro de la distribucion: ejecuta Unblock-File de
         forma recursiva y retira la marca.
      3. Copiar la carpeta desde una memoria USB no aplica MotW, de modo que
         esa via no muestra ninguna advertencia.

    Lo que este script SI hace para reducir falsos positivos del antivirus:
    modo carpeta, sin compresion UPX, y metadatos de version completos
    (empresa, producto, descripcion), cuya ausencia es una de las senales que
    mas pesa en la heuristica de los motores comerciales.

.PARAMETER SoloVerificar
    Comprueba el entorno y muestra el comando sin compilar.

.PARAMETER Limpiar
    Elimina la carpeta de salida antes de compilar.

.EXAMPLE
    .\build_exe.ps1 -SoloVerificar
    .\build_exe.ps1 -Limpiar
#>

[CmdletBinding()]
param(
    [switch]$SoloVerificar,
    [switch]$Limpiar,
    # Carpeta de salida. Por defecto 'dist' dentro del proyecto, pero si el
    # proyecto vive en OneDrive o en una unidad de red conviene sacar la
    # compilacion a un disco local: Nuitka escribe decenas de miles de archivos
    # temporales y el cliente de sincronizacion los procesa uno a uno.
    [string]$SalidaEn = "dist",
    # Compila con un solo proceso y el modo de bajo consumo de Nuitka. Se activa
    # solo si el equipo tiene menos de 2 GB libres.
    [switch]$PocaMemoria
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# Todo lo que pase queda registrado en un archivo. Si la compilacion falla, ese
# log es la unica evidencia de por que: una ventana que se cierra no deja nada.
$Registro  = Join-Path $PSScriptRoot "ultimo_build.log"
$LogNuitka = Join-Path $PSScriptRoot "nuitka.log"
try { Start-Transcript -Path $Registro -Force | Out-Null } catch { }

# =============================================================================
# 0. UBICACION
# =============================================================================
$RaizProyecto = Split-Path -Parent $PSScriptRoot
$DirSalida    = if ([System.IO.Path]::IsPathRooted($SalidaEn)) { $SalidaEn } else { Join-Path $RaizProyecto $SalidaEn }
$NombreExe    = "SAPA"
$DirDist      = Join-Path $DirSalida "run_app.dist"
$EnOneDrive   = $RaizProyecto -match "OneDrive"

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host "  SAPA - Compilacion a ejecutable nativo (Nuitka standalone)"   -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host "  Proyecto : $RaizProyecto"
Write-Host "  Salida   : $DirDist"
Write-Host ""

Set-Location $RaizProyecto

# =============================================================================
# 1. VERIFICACION DEL ENTORNO
# =============================================================================
Write-Host "[1/5] Verificando entorno..." -ForegroundColor Yellow

$python = (Get-Command python -ErrorAction SilentlyContinue)
if (-not $python) { throw "Python no esta en el PATH. Instale Python 3.12 x64." }

$ver = & python -c "import sys;print(f'{sys.version_info.major}.{sys.version_info.minor}')"
$arq = & python -c "import platform;print(platform.architecture()[0])"
Write-Host "      Python $ver ($arq)"
if ($arq -ne "64bit") { throw "Se requiere Python de 64 bits." }

# Paquetes indispensables en tiempo de compilacion
$requeridos = @("nuitka", "streamlit", "plotly", "pandas", "numpy")
foreach ($p in $requeridos) {
    $ok = & python -c "import importlib.util,sys;sys.exit(0 if importlib.util.find_spec('$p') else 1)"
    if ($LASTEXITCODE -ne 0) { throw "Falta el paquete '$p'. Ejecute: pip install -r requirements.txt" }
}
Write-Host "      Paquetes requeridos presentes"

# Memoria libre. Es el limite real de una compilacion de Nuitka: el compilador
# de C mantiene en RAM el arbol de cada modulo, y numpy, pandas y streamlit
# juntos son varios GB. Por debajo de 2 GB libres el compilador muere y Nuitka
# devuelve un escueto "codigo 1" que no dice nada.
$memLibre = 0
try {
    $memLibre = [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB, 2)
    Write-Host "      Memoria libre: $memLibre GB"
} catch { }
if ($memLibre -gt 0 -and $memLibre -lt 2) {
    Write-Host "      AVISO: con $memLibre GB libres la compilacion probablemente" -ForegroundColor Red
    Write-Host "      muera sin explicacion. Cierre Chrome, Spotify y Office." -ForegroundColor Red
    Write-Host "      Se activa el modo de bajo consumo automaticamente." -ForegroundColor Yellow
    $PocaMemoria = $true
}

# Ruta de los recursos estaticos de Streamlit (JS, CSS y fuentes de la interfaz).
# Sin esta carpeta el servidor arranca y el navegador muestra una pagina en
# blanco: el fallo mas frecuente al compilar Streamlit y el mas dificil de
# diagnosticar, porque no produce ningun mensaje de error.
$StreamlitStatic = & python -c "import os,streamlit;print(os.path.join(os.path.dirname(streamlit.__file__),'static'))"
if (-not (Test-Path $StreamlitStatic)) { throw "No se encontro la carpeta static de Streamlit." }
Write-Host "      Recursos de Streamlit: $StreamlitStatic"

# El compilador de C. Nuitka usa MSVC si esta disponible y MinGW64 si no.
$msvc = & python -c "import shutil;print('si' if shutil.which('cl') else 'no')"
Write-Host "      Compilador MSVC en PATH: $msvc"
if ($msvc -eq "no") {
    Write-Host "      Se usara MinGW64 (Nuitka lo descarga la primera vez)." -ForegroundColor DarkGray
}

# =============================================================================
# 2. LIMPIEZA
# =============================================================================
if ($EnOneDrive -and -not [System.IO.Path]::IsPathRooted($SalidaEn)) {
    Write-Host "      AVISO: el proyecto esta bajo OneDrive. Nuitka escribe decenas de" -ForegroundColor Red
    Write-Host "      miles de archivos temporales y el cliente de sincronizacion los" -ForegroundColor Red
    Write-Host "      procesa uno a uno: la compilacion se vuelve muy lenta y puede" -ForegroundColor Red
    Write-Host "      fallar. Saque la salida a un disco local con:" -ForegroundColor Red
    Write-Host "        .\build\build_exe.ps1 -Limpiar -SalidaEn C:\SAPA_build" -ForegroundColor Yellow
}

if ($Limpiar -and (Test-Path $DirSalida)) {
    Write-Host "[2/5] Limpiando salida anterior..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $DirSalida
} else {
    Write-Host "[2/5] Limpieza omitida (use -Limpiar para forzarla)" -ForegroundColor Yellow
}

# =============================================================================
# 3. ARGUMENTOS DE NUITKA
# =============================================================================
Write-Host "[3/5] Construyendo la linea de compilacion..." -ForegroundColor Yellow

$argumentos = @(
    "-m", "nuitka",
    "run_app.py",

    # --- Modo de distribucion -------------------------------------------------
    # standalone = carpeta autocontenida. NO se usa --onefile: el autoextraible
    # es el principal detonante heuristico de Defender y ademas descomprime en
    # %TEMP% en cada arranque.
    "--standalone",
    "--output-dir=$DirSalida",
    "--output-filename=$NombreExe.exe",

    # Consola VISIBLE a proposito: muestra la direccion local y cualquier error
    # de arranque. Un ejecutable que se cierra en silencio es indistinguible de
    # uno bloqueado por el antivirus.
    "--windows-console-mode=force",

    # --- Metadatos de version -------------------------------------------------
    # Un binario sin metadatos puntua peor en la heuristica de los antivirus.
    "--company-name=UNI FIIS - Ingenieria de Sistemas",
    "--product-name=SAPA - Sistema Analitico Predictivo de Abastecimiento",
    "--file-description=Torre de Control WES - Abastecimiento Predictivo",
    "--file-version=3.0.0.0",
    "--product-version=3.0.0.0",
    "--copyright=Practica Calificada 03 - Sistemas Analiticos",

    # --- Optimizacion --------------------------------------------------------
    # anti-bloat recorta importaciones de desarrollo que arrastran las librerias
    # cientificas. NO se habilita el plugin UPX: la compresion de ejecutables es
    # una tecnica de empaquetado de malware y los motores la penalizan.
    "--enable-plugin=anti-bloat",
    "--assume-yes-for-downloads",
    "--remove-output",

    # --- Codigo propio del proyecto ------------------------------------------
    "--include-package=config",
    "--include-package=db",
    "--include-package=data",
    "--include-package=agents",
    "--include-package=engine",
    "--include-package=utils",
    "--include-package=ui",

    # --- Streamlit ------------------------------------------------------------
    # include-package: sigue las importaciones dinamicas que Nuitka no ve.
    # include-package-data: archivos no-Python del paquete.
    # include-data-dir: los estaticos de la interfaz, servidos por HTTP.
    # include-distribution-metadata: Streamlit consulta su propia version con
    #   importlib.metadata; sin la metadata falla DESPUES de arrancar.
    "--include-package=streamlit",
    "--include-package-data=streamlit",
    "--include-data-dir=$StreamlitStatic=streamlit/static",
    "--include-distribution-metadata=streamlit",

    # --- Dependencias de la capa de presentacion ------------------------------
    "--include-package=plotly",
    "--include-package-data=plotly",
    "--include-package=altair",
    "--include-package-data=altair",
    "--include-package=pyarrow",
    "--include-package=tornado",
    "--include-package=watchdog",
    "--include-distribution-metadata=plotly",
    "--include-distribution-metadata=altair",

    # --- Nucleo de calculo ----------------------------------------------------
    "--include-package=numpy",
    "--include-package=pandas",

    # --- Entrada y salida Excel -----------------------------------------------
    # pandas resuelve el motor de Excel POR NOMBRE en tiempo de ejecucion
    # (`import openpyxl` dentro de read_excel), de modo que Nuitka no lo ve por
    # analisis estatico. Sin estos dos paquetes el binario compila y la consola
    # de carga falla al abrir el primer archivo, que es justo el requisito que
    # la practica exige.
    "--include-package=openpyxl",
    "--include-package=xlsxwriter",
    "--include-distribution-metadata=openpyxl",

    # --- app.py viaja como DATO, no como codigo -------------------------------
    # Streamlit lee el script, lo reescribe con su transformacion AST y lo
    # ejecuta. Un modulo compilado dentro del binario no sirve para eso.
    "--include-data-files=app.py=app.py",
    "--include-data-files=requirements.txt=requirements.txt",
    "--include-data-dir=docs=docs",

    # --- Recorte ---------------------------------------------------------------
    "--nofollow-import-to=pytest",
    "--nofollow-import-to=tests",
    "--nofollow-import-to=setuptools",
    "--nofollow-import-to=tkinter",
    "--nofollow-import-to=IPython",
    "--nofollow-import-to=notebook"
)

if ($PocaMemoria) {
    # --low-memory hace que Nuitka compile en tandas mas pequenas y --jobs=1
    # evita varios procesos de C simultaneos. Es mas lento pero termina.
    $argumentos += "--low-memory"
    $argumentos += "--jobs=1"
    Write-Host "      Modo de bajo consumo activo (--low-memory --jobs=1)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  python $($argumentos -join ' ')" -ForegroundColor DarkGray
Write-Host ""

if ($SoloVerificar) {
    Write-Host "[OK] Verificacion completada. No se compilo nada." -ForegroundColor Green
    exit 0
}

# =============================================================================
# 4. COMPILACION
# =============================================================================
Write-Host "[4/5] Compilando. La primera vez puede tardar de 10 a 25 minutos..." -ForegroundColor Yellow
$inicio = Get-Date

# Nuitka escribe sus diagnosticos en STDERR. Sin `2>&1` el log recoge la orden y
# el codigo de salida pero NI UNA LINEA de la causa, que es justo lo unico que
# sirve para arreglar el problema. El cambio de ErrorActionPreference es
# obligatorio: con 'Stop', PowerShell 5.1 convierte cada linea de stderr de un
# programa nativo en un error terminante y aborta en la primera advertencia,
# aunque la compilacion fuese bien.
$previo = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& python @argumentos 2>&1 | Tee-Object -FilePath $LogNuitka
$codigo = $LASTEXITCODE
$ErrorActionPreference = $previo

if ($codigo -ne 0) {
    Write-Host ""
    Write-Host "  Nuitka termino con codigo $codigo." -ForegroundColor Red
    Write-Host "  Ultimas lineas de su salida:" -ForegroundColor Red
    if (Test-Path $LogNuitka) {
        Get-Content $LogNuitka -Tail 30 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    }
    Write-Host ""
    Write-Host "  Salida completa de Nuitka en: $LogNuitka" -ForegroundColor Yellow
    throw "Nuitka termino con codigo $codigo. Revise $LogNuitka"
}
$minutos = [math]::Round(((Get-Date) - $inicio).TotalMinutes, 1)
Write-Host "      Compilacion terminada en $minutos minutos" -ForegroundColor Green

# =============================================================================
# 5. POST-PROCESO
# =============================================================================
Write-Host "[5/5] Preparando la distribucion..." -ForegroundColor Yellow

if (-not (Test-Path $DirDist)) { throw "No se genero $DirDist." }

# Carpetas de trabajo del aplicativo, junto al .exe
foreach ($d in @("database", "exports", "imports", "logs")) {
    $ruta = Join-Path $DirDist $d
    if (-not (Test-Path $ruta)) { New-Item -ItemType Directory -Path $ruta | Out-Null }
}

# Base de datos ya poblada, para que el evaluador no tenga que generarla
$dbOrigen = Join-Path $RaizProyecto "database\sapa.db"
if (Test-Path $dbOrigen) {
    Copy-Item $dbOrigen (Join-Path $DirDist "database\sapa.db") -Force
    Write-Host "      Base de datos incluida en la distribucion"
} else {
    Write-Host "      AVISO: no hay sapa.db. Ejecute 'python main.py generar' antes de compilar." -ForegroundColor Red
}

# Script de desbloqueo de MotW dentro de la propia distribucion
Copy-Item (Join-Path $PSScriptRoot "DESBLOQUEAR.bat") $DirDist -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $PSScriptRoot "LEEME.txt")       $DirDist -Force -ErrorAction SilentlyContinue

# Se retira la marca de la carpeta recien generada, por si alguna dependencia
# llego descargada y arrastro su Zone.Identifier al binario final.
Get-ChildItem -Path $DirDist -Recurse -File | Unblock-File -ErrorAction SilentlyContinue

$tamano = [math]::Round((Get-ChildItem $DirDist -Recurse -File |
          Measure-Object -Property Length -Sum).Sum / 1MB, 1)

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Green
Write-Host "  DISTRIBUCION LISTA" -ForegroundColor Green
Write-Host "===============================================================" -ForegroundColor Green
Write-Host "  Carpeta   : $DirDist"
Write-Host "  Ejecutable: $NombreExe.exe"
Write-Host "  Tamano    : $tamano MB"
Write-Host ""
Write-Host "  ENTREGA: comprima la CARPETA COMPLETA. El .exe no funciona suelto." -ForegroundColor Yellow
Write-Host "  Si el destinatario la descarga de Internet o Drive, debe ejecutar"  -ForegroundColor Yellow
Write-Host "  DESBLOQUEAR.bat una vez antes del primer arranque."                 -ForegroundColor Yellow
Write-Host ""
Write-Host "  Prueba inmediata:" -ForegroundColor Cyan
Write-Host "    cd `"$DirDist`"; .\$NombreExe.exe"
Write-Host ""

try { Stop-Transcript | Out-Null } catch { }
Write-Host "  Registro completo de esta compilacion: $Registro" -ForegroundColor DarkGray
Write-Host ""
