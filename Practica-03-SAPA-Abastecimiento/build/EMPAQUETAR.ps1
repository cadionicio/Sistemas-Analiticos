<#
.SYNOPSIS
    Empaqueta SAPA en un ejecutable nativo SIN compilador de C, usando PyInstaller.

.DESCRIPTION
    POR QUE SE CAMBIO DE RUTA
    -------------------------
    La ruta anterior era Nuitka. Nuitka traduce el programa a C y despues llama a
    un compilador nativo. En este equipo esa cadena murio siempre en el mismo
    punto; el informe de fallo de Nuitka lo dice textualmente:

        module.altair.vegalite.v6.schema.core.c(166116) :
        fatal error C1002: el compilador no tiene espacio en el monton

    Altair (dependencia de Streamlit) genera su esquema Vega-Lite por codigo, y
    un solo modulo se traduce a un archivo C de 166 000 lineas. `cl.exe` agota su
    monton compilandolo. Con menos de 2 GB de RAM libre no hay bandera que lo
    arregle: el problema es el tamano del arbol de dependencias de Streamlit
    frente a la memoria del equipo, no el codigo del proyecto.

    PyInstaller no compila nada. Congela: copia el interprete, los .pyc y los
    datos junto a un arranque que YA VIENE COMPILADO dentro del wheel. Sin MSVC,
    sin MinGW, sin monton que agotar. Tarda minutos, no decenas de minutos.

    LO QUE NO CAMBIA
    ----------------
    Las reglas de empaquetado seguro son las mismas y viven en `sapa.spec`:
    modo carpeta (nunca autoextraible), UPX desactivado, recurso de version
    incrustado y `app.py` viajando como dato. SmartScreen se sigue tratando
    con `Unblock-File` al final y con DESBLOQUEAR.bat en el equipo destino.

.PARAMETER SalidaEn
    Carpeta donde dejar la distribucion. Por defecto `dist_exe` dentro del
    proyecto. Conviene un disco local si el proyecto esta sincronizado.

.PARAMETER Limpiar
    Borra la cache de analisis antes de empezar.

.EXAMPLE
    .\EMPAQUETAR.ps1
    .\EMPAQUETAR.ps1 -SalidaEn C:\SAPA_build -Limpiar
#>

[CmdletBinding()]
param(
    [string]$SalidaEn = "",
    [switch]$Limpiar
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$Raiz    = Split-Path -Parent $PSScriptRoot
$Spec    = Join-Path $PSScriptRoot "sapa.spec"
$LogPy   = Join-Path $PSScriptRoot "pyinstaller.log"
$LogRes  = Join-Path $PSScriptRoot "ultimo_empaquetado.log"
$resumen = New-Object System.Collections.Generic.List[string]

function Anotar([string]$t, [string]$color = "Gray") {
    $resumen.Add($t) | Out-Null
    Write-Host $t -ForegroundColor $color
}

function Terminar([int]$codigo) {
    try { $resumen | Set-Content -Path $LogRes -Encoding UTF8 } catch { }
    exit $codigo
}

Anotar ""
Anotar "===============================================================" "Cyan"
Anotar "  SAPA - Empaquetado a ejecutable (PyInstaller, sin compilador)" "Cyan"
Anotar "===============================================================" "Cyan"
Anotar ("  Proyecto : " + $Raiz)

if ([string]::IsNullOrWhiteSpace($SalidaEn)) {
    $SalidaEn = Join-Path $Raiz "dist_exe"
}
$Trabajo = Join-Path $SalidaEn "_trabajo"
$Destino = Join-Path $SalidaEn "SAPA"
Anotar ("  Salida   : " + $Destino)
Anotar ""

# =============================================================================
Anotar "[1/6] Verificando entorno..." "Yellow"

$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) {
    Anotar "      [ERROR] No se encontro 'python' en el PATH." "Red"
    Anotar "      Use el Anaconda Prompt, o reinstale Python marcando 'Add to PATH'." "Red"
    Terminar 1
}
$version = (& python -c "import sys;print('%d.%d.%d %s' % (sys.version_info[:3]+(('64bit' if sys.maxsize>2**32 else '32bit'),)))") 2>&1
Anotar ("      Python " + $version)

$tienePyi = (& python -c "import importlib.util,sys;sys.exit(0 if importlib.util.find_spec('PyInstaller') else 1)") 2>&1
if ($LASTEXITCODE -ne 0) {
    Anotar "      PyInstaller no esta instalado. Instalandolo ahora..." "Yellow"
    & python -m pip install --upgrade "pyinstaller>=6.16" 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) {
        Anotar "      [ERROR] No se pudo instalar PyInstaller." "Red"
        Anotar "      Ejecute a mano:  python -m pip install --upgrade pyinstaller" "Red"
        Terminar 1
    }
}
$vPyi = (& python -c "import PyInstaller;print(PyInstaller.__version__)") 2>&1
Anotar ("      PyInstaller " + $vPyi)

# Falta cualquiera de estos y el binario arranca y muere. Se comprueba antes.
$faltan = @()
foreach ($p in @("streamlit", "plotly", "pandas", "numpy", "openpyxl", "xlsxwriter")) {
    & python -c "import importlib.util,sys;sys.exit(0 if importlib.util.find_spec('$p') else 1)" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { $faltan += $p }
}
if ($faltan.Count -gt 0) {
    Anotar ("      [ERROR] Faltan paquetes: " + ($faltan -join ", ")) "Red"
    Anotar "      Ejecute:  python -m pip install -r requirements.txt" "Red"
    Terminar 1
}
Anotar "      Dependencias presentes"

try {
    $mem = [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB, 2)
    Anotar ("      Memoria libre: " + $mem + " GB")
    if ($mem -lt 1.0) {
        Anotar "      AVISO: poca memoria. PyInstaller necesita mucha menos que" "Yellow"
        Anotar "      Nuitka, pero cerrar el navegador acelera el analisis." "Yellow"
    }
} catch { }

if (-not (Test-Path $Spec)) {
    Anotar ("      [ERROR] No se encontro la receta: " + $Spec) "Red"
    Terminar 1
}

# =============================================================================
Anotar ""
Anotar "[2/6] Comprobando la base de datos..." "Yellow"
$db = Join-Path $Raiz "database\sapa.db"
if (Test-Path $db) {
    $mb = [math]::Round((Get-Item $db).Length / 1MB, 2)
    Anotar ("      database\sapa.db presente (" + $mb + " MB)")
} else {
    Anotar "      No existe. Generandola para que el .EXE viaje con datos..." "Yellow"
    Push-Location $Raiz
    & python main.py generar 2>&1 | Out-Host
    & python main.py correr  2>&1 | Out-Host
    Pop-Location
    if (-not (Test-Path $db)) {
        Anotar "      [AVISO] No se pudo generar. El .EXE arrancara con base vacia." "Yellow"
    }
}

# =============================================================================
Anotar ""
Anotar "[3/6] Preparando carpetas..." "Yellow"
if ($Limpiar -and (Test-Path $SalidaEn)) {
    Anotar "      Limpiando salida anterior..."
    Remove-Item -Recurse -Force $SalidaEn -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Path $SalidaEn -Force | Out-Null
Anotar ("      " + $SalidaEn)

# =============================================================================
Anotar ""
Anotar "[4/6] Empaquetando. Entre 3 y 8 minutos. No cierre la ventana." "Yellow"
Anotar "      (La barra puede quedarse quieta un rato: esta copiando miles"
Anotar "       de archivos de Streamlit. Es normal.)"
$inicio = Get-Date

Push-Location $Raiz
& python -m PyInstaller --noconfirm --clean --log-level=INFO `
    --distpath "$SalidaEn" --workpath "$Trabajo" "$Spec" 2>&1 |
    Tee-Object -FilePath $LogPy | Out-Host
$codigo = $LASTEXITCODE
Pop-Location

$minutos = [math]::Round(((Get-Date) - $inicio).TotalMinutes, 1)
Anotar ("      PyInstaller termino con codigo " + $codigo + " en " + $minutos + " minutos")

$exe = Join-Path $Destino "SAPA.exe"
if (($codigo -ne 0) -or (-not (Test-Path $exe))) {
    Anotar ""
    Anotar "  [ERROR] El empaquetado no produjo SAPA.exe." "Red"
    Anotar ("  Registro completo: " + $LogPy) "Red"
    Anotar ""
    Anotar "  Ultimas lineas del registro:" "Red"
    if (Test-Path $LogPy) {
        Get-Content $LogPy -Tail 25 | ForEach-Object { Anotar ("    " + $_) }
    }
    Terminar 1
}

# =============================================================================
Anotar ""
Anotar "[5/6] Completando la distribucion..." "Yellow"

# La base viaja JUNTO al .exe, no dentro de la carpeta interna: el evaluador
# debe poder verla, y SQLite debe poder escribir sobre ella.
foreach ($carpeta in @("database", "exports", "imports", "logs")) {
    New-Item -ItemType Directory -Path (Join-Path $Destino $carpeta) -Force | Out-Null
}
if (Test-Path $db) {
    Copy-Item $db (Join-Path $Destino "database\sapa.db") -Force
    Anotar "      Base de datos copiada junto al ejecutable"
}
foreach ($extra in @("build\DESBLOQUEAR.bat", "build\LEEME.txt")) {
    $origen = Join-Path $Raiz $extra
    if (Test-Path $origen) { Copy-Item $origen $Destino -Force }
}
$html = Join-Path $Raiz "exports\SAPA_TorreDeControl.html"
if (Test-Path $html) {
    Copy-Item $html (Join-Path $Destino "exports") -Force
    Anotar "      Tablero HTML autocontenido incluido"
}
Anotar "      Carpetas de trabajo creadas"

# =============================================================================
Anotar ""
Anotar "[6/6] Retirando la marca de procedencia (MotW)..." "Yellow"
# Windows marca todo archivo con origen Internet. Esa marca -no el contenido-
# es lo que dispara la pantalla azul de SmartScreen. Se retira aqui para que la
# carpeta recien generada no la traiga de fabrica.
try {
    Get-ChildItem -Path $Destino -Recurse -File | Unblock-File -ErrorAction SilentlyContinue
    Anotar "      Marca retirada de toda la distribucion"
} catch {
    Anotar ("      No se pudo retirar la marca: " + $_.Exception.Message) "Yellow"
}

$tam = [math]::Round(((Get-ChildItem -Path $Destino -Recurse -File |
        Measure-Object -Property Length -Sum).Sum / 1MB), 1)

Anotar ""
Anotar "===============================================================" "Green"
Anotar "  DISTRIBUCION LISTA" "Green"
Anotar "===============================================================" "Green"
Anotar ("  Carpeta   : " + $Destino)
Anotar  "  Ejecutable: SAPA.exe"
Anotar ("  Tamano    : " + $tam + " MB")
Anotar ""
Anotar "  Para probarlo:  doble clic en SAPA.exe"
Anotar "  Si Windows avisa: ejecute DESBLOQUEAR.bat y vuelva a abrirlo."
Anotar "  Para entregar:   copie la CARPETA COMPLETA, no solo el .exe."
Anotar ""
Terminar 0
