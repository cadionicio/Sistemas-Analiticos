<#
.SYNOPSIS
    Recoge el estado del equipo antes de compilar y lo escribe en un archivo.

.DESCRIPTION
    No compila nada ni modifica nada. Solo mira y anota.

    Existe porque una compilacion que falla en una ventana que se cierra no
    deja evidencia, y sin evidencia el diagnostico es adivinanza. El resultado
    queda en build\diagnostico.txt, un archivo de texto que se puede abrir,
    leer y compartir.

    Comprueba, en este orden: que Python existe y es de 64 bits, que los
    paquetes indispensables estan instalados, que los recursos estaticos de
    Streamlit se encuentran donde deben, que hay un compilador de C, cuanto
    espacio libre queda y si la ruta del proyecto tiene alguna de las dos
    caracteristicas que rompen compilaciones en Windows: estar sincronizada
    con la nube o ser demasiado larga.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$RaizProyecto = Split-Path -Parent $PSScriptRoot
$Salida = Join-Path $PSScriptRoot "diagnostico.txt"
$lineas = New-Object System.Collections.Generic.List[string]

function Anotar([string]$texto) {
    $lineas.Add($texto) | Out-Null
    Write-Host $texto
}

function Titulo([string]$texto) {
    Anotar ""
    Anotar ("=" * 70)
    Anotar ("  " + $texto)
    Anotar ("=" * 70)
}

Anotar "SAPA - Diagnostico del entorno de compilacion"
Anotar ("Generado: " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))

# =============================================================================
Titulo "1. SISTEMA"
try {
    $so = Get-CimInstance Win32_OperatingSystem
    Anotar ("Sistema      : " + $so.Caption + " build " + $so.BuildNumber)
    Anotar ("Arquitectura : " + $so.OSArchitecture)
    Anotar ("Memoria libre: " + [math]::Round($so.FreePhysicalMemory / 1MB, 2) + " GB")
} catch {
    Anotar ("No se pudo leer la informacion del sistema: " + $_.Exception.Message)
}
Anotar ("PowerShell   : " + $PSVersionTable.PSVersion.ToString())

try {
    $disco = Get-PSDrive -Name C -ErrorAction Stop
    Anotar ("Libre en C:  : " + [math]::Round($disco.Free / 1GB, 1) + " GB")
    if ($disco.Free / 1GB -lt 6) {
        Anotar "  >> AVISO: Nuitka necesita unos 6 GB libres para compilar."
    }
} catch { }

# =============================================================================
Titulo "2. UBICACION DEL PROYECTO"
Anotar ("Ruta    : " + $RaizProyecto)
Anotar ("Longitud: " + $RaizProyecto.Length + " caracteres")
if ($RaizProyecto.Length -gt 90) {
    Anotar "  >> AVISO: ruta larga. Una distribucion de Nuitka anida cientos de"
    Anotar "     archivos y puede superar el limite de 260 caracteres de Windows."
}
if ($RaizProyecto -match "OneDrive") {
    Anotar "  >> AVISO: el proyecto esta dentro de OneDrive."
} else {
    Anotar "OneDrive: la ruta no lo menciona."
}
$docs = [Environment]::GetFolderPath("MyDocuments")
Anotar ("Carpeta Documentos real: " + $docs)
if ($docs -match "OneDrive") {
    Anotar "  >> IMPORTANTE: su carpeta Documentos ESTA redirigida a OneDrive."
    Anotar "     Compile con -SalidaEn C:\SAPA_build para sacar la salida de ahi."
}

# =============================================================================
Titulo "3. PYTHON"
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    Anotar ">> FALLA: 'python' no esta en el PATH."
    Anotar "   Instale Python 3.12 de 64 bits y marque 'Add python.exe to PATH',"
    Anotar "   o abra el Anaconda Prompt si usa Anaconda."
} else {
    Anotar ("Ejecutable: " + $python.Source)
    if ($python.Source -match "WindowsApps") {
        Anotar "  >> AVISO: apunta al alias de Microsoft Store, que abre la tienda"
        Anotar "     en lugar de ejecutar Python. Desactivelo en Configuracion >"
        Anotar "     Aplicaciones > Alias de ejecucion de aplicaciones."
    }
    try {
        Anotar ("Version   : " + (& python -c "import sys;print(sys.version.replace(chr(10),' '))"))
        Anotar ("Arquitect.: " + (& python -c "import platform;print(platform.architecture()[0])"))
        Anotar ("Prefijo   : " + (& python -c "import sys;print(sys.prefix)"))
    } catch {
        Anotar (">> FALLA al ejecutar python: " + $_.Exception.Message)
    }
}

# =============================================================================
Titulo "4. PAQUETES"
$paquetes = @("numpy", "pandas", "streamlit", "plotly", "openpyxl", "xlsxwriter", "nuitka")
foreach ($p in $paquetes) {
    try {
        $v = & python -c "import importlib.metadata as m;print(m.version('$p'))" 2>$null
        if ($LASTEXITCODE -eq 0 -and $v) {
            Anotar ("  {0,-12} {1}" -f $p, $v)
        } else {
            Anotar ("  {0,-12} NO INSTALADO" -f $p)
        }
    } catch {
        Anotar ("  {0,-12} NO INSTALADO" -f $p)
    }
}
Anotar ""
Anotar "Si falta alguno, desde la carpeta del proyecto ejecute:"
Anotar "   pip install -r requirements.txt"

# =============================================================================
Titulo "5. RECURSOS DE STREAMLIT"
try {
    $st = & python -c "import os,streamlit;print(os.path.join(os.path.dirname(streamlit.__file__),'static'))" 2>$null
    if ($st -and (Test-Path $st)) {
        $n = (Get-ChildItem $st -Recurse -File -ErrorAction SilentlyContinue).Count
        Anotar ("Carpeta static: " + $st)
        Anotar ("Archivos      : " + $n)
        Anotar "Estado        : OK"
    } else {
        Anotar ">> FALLA: no se encontro la carpeta static de Streamlit."
        Anotar "   Sin ella el .EXE arranca y el navegador muestra una pagina en blanco."
    }
} catch {
    Anotar ">> No se pudo comprobar (Streamlit no instalado)."
}

# =============================================================================
Titulo "6. COMPILADOR DE C"
$cl = Get-Command cl -ErrorAction SilentlyContinue
$gcc = Get-Command gcc -ErrorAction SilentlyContinue
if ($cl) {
    Anotar ("MSVC (cl.exe): " + $cl.Source)
} else {
    Anotar "MSVC (cl.exe): no esta en el PATH."
}
if ($gcc) {
    Anotar ("GCC          : " + $gcc.Source)
} else {
    Anotar "GCC          : no esta en el PATH."
}
$cacheNuitka = Join-Path $env:LOCALAPPDATA "Nuitka\Nuitka\Cache"
if (Test-Path $cacheNuitka) {
    Anotar ("Cache Nuitka : " + $cacheNuitka + " (existe)")
    $mingw = Get-ChildItem $cacheNuitka -Recurse -Filter "gcc.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($mingw) { Anotar ("MinGW64 ya descargado: " + $mingw.FullName) }
} else {
    Anotar "Cache Nuitka : no existe todavia."
}
if (-not $cl -and -not $gcc) {
    Anotar ""
    Anotar "Sin compilador en el PATH, Nuitka descarga MinGW64 en la primera"
    Anotar "compilacion. Necesita conexion a Internet en ese momento."
}

# =============================================================================
Titulo "7. INTENTO ANTERIOR"
$dist = Join-Path $RaizProyecto "dist"
if (Test-Path $dist) {
    foreach ($d in @("run_app.build", "run_app.dist")) {
        $ruta = Join-Path $dist $d
        if (Test-Path $ruta) {
            $n = (Get-ChildItem $ruta -Recurse -File -ErrorAction SilentlyContinue).Count
            Anotar ("  {0,-16} {1} archivos" -f $d, $n)
        } else {
            Anotar ("  {0,-16} no existe" -f $d)
        }
    }
    $exe = Join-Path $dist "run_app.dist\SAPA.exe"
    if (Test-Path $exe) {
        Anotar ("SAPA.exe: EXISTE - " + [math]::Round((Get-Item $exe).Length / 1MB, 1) + " MB")
    } else {
        Anotar "SAPA.exe: no existe. La compilacion no llego a terminar."
    }
} else {
    Anotar "No hay carpeta dist: no se ha compilado todavia."
}

$log = Join-Path $PSScriptRoot "ultimo_build.log"
if (Test-Path $log) {
    Anotar ""
    Anotar ("Ultimas 25 lineas de " + $log + ":")
    Get-Content $log -Tail 25 | ForEach-Object { Anotar ("   " + $_) }
} else {
    Anotar ""
    Anotar "No hay ultimo_build.log todavia."
}

# =============================================================================
Titulo "8. VEREDICTO"
$problemas = @($lineas | Where-Object { $_ -match ">> FALLA" })
if ($problemas.Count -eq 0) {
    Anotar "Sin bloqueos detectados. Puede compilar con:"
    Anotar "   .\build\build_exe.ps1 -Limpiar -SalidaEn C:\SAPA_build"
} else {
    Anotar ("Se encontraron " + $problemas.Count + " problemas que impiden compilar:")
    $problemas | ForEach-Object { Anotar ("   " + $_) }
}

# =============================================================================
try {
    $lineas | Set-Content -Path $Salida -Encoding UTF8
    Write-Host ""
    Write-Host ("Informe guardado en: " + $Salida) -ForegroundColor Green
} catch {
    Write-Host ("No se pudo escribir el informe: " + $_.Exception.Message) -ForegroundColor Red
}
