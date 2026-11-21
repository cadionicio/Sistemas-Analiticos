<#
.SYNOPSIS
    Comprueba si Nuitka puede compilar ALGO en este equipo, antes de intentarlo
    con la aplicacion completa.

.DESCRIPTION
    Compila un programa de doce lineas y lo ejecuta. Tarda dos o tres minutos
    frente a los veinte de la aplicacion.

    POR QUE EXISTE
    Cuando `build_exe.ps1` falla con "codigo 1", hay dos explicaciones muy
    distintas y la accion correcta es opuesta en cada caso:

      A) La cadena de compilacion no funciona en este equipo -falta el
         compilador de C, no se pudo descargar MinGW64, o Nuitka no soporta
         esta version de Python. Entonces no hay nada que arreglar en el
         codigo del proyecto.
      B) La cadena funciona, y lo que falla es el tamano o alguna dependencia
         concreta de la aplicacion -normalmente memoria insuficiente.

    Esta prueba las separa en tres minutos. Si el hola mundo compila y corre,
    el problema es (B) y hay que mirar memoria y dependencias. Si ni siquiera
    el hola mundo compila, es (A) y se ataca el entorno.

    El resultado queda en build\prueba_toolchain.txt.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$Salida  = Join-Path $PSScriptRoot "prueba_toolchain.txt"
$Trabajo = Join-Path $env:TEMP "sapa_toolchain"
$lineas  = New-Object System.Collections.Generic.List[string]

function Anotar([string]$t) {
    $lineas.Add($t) | Out-Null
    Write-Host $t
}

Anotar "SAPA - Prueba de la cadena de compilacion"
Anotar ("Generado: " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
Anotar ""

# =============================================================================
Anotar "[1/4] Preparando un programa minimo..."
if (Test-Path $Trabajo) { Remove-Item -Recurse -Force $Trabajo -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Path $Trabajo -Force | Out-Null

$fuente = Join-Path $Trabajo "hola.py"
@'
"""Programa minimo para comprobar la cadena de compilacion."""
import sys


def main() -> int:
    print("SAPA-TOOLCHAIN-OK")
    print("Python", sys.version.split()[0])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
'@ | Set-Content -Path $fuente -Encoding UTF8

Anotar ("      Archivo: " + $fuente)
try {
    $mem = [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB, 2)
    Anotar ("      Memoria libre ahora: " + $mem + " GB")
} catch { }

# =============================================================================
Anotar ""
Anotar "[2/4] Compilando (2 a 5 minutos la primera vez)..."
Anotar "      Si no hay compilador, Nuitka descargara MinGW64 ahora."

$logC = Join-Path $PSScriptRoot "prueba_toolchain_nuitka.log"
$inicio = Get-Date

Push-Location $Trabajo
& python -m nuitka --standalone --assume-yes-for-downloads `
    --output-dir="$Trabajo\salida" --output-filename=hola.exe `
    --windows-console-mode=force hola.py 2>&1 | Tee-Object -FilePath $logC
$codigo = $LASTEXITCODE
Pop-Location

$minutos = [math]::Round(((Get-Date) - $inicio).TotalMinutes, 1)
Anotar ("      Nuitka termino con codigo " + $codigo + " en " + $minutos + " minutos")

# =============================================================================
Anotar ""
Anotar "[3/4] Ejecutando el binario..."
$exe = Join-Path $Trabajo "salida\hola.dist\hola.exe"
$corrio = $false
if (Test-Path $exe) {
    $tam = [math]::Round((Get-Item $exe).Length / 1MB, 2)
    Anotar ("      Binario generado: " + $tam + " MB")
    try {
        $salidaExe = & $exe 2>&1 | Out-String
        Anotar ("      Salida: " + $salidaExe.Trim())
        $corrio = $salidaExe -match "SAPA-TOOLCHAIN-OK"
    } catch {
        Anotar ("      No se pudo ejecutar: " + $_.Exception.Message)
    }
} else {
    Anotar "      No se genero ningun binario."
}

# =============================================================================
Anotar ""
Anotar ("=" * 70)
Anotar "[4/4] VEREDICTO"
Anotar ("=" * 70)

if ($corrio) {
    Anotar "LA CADENA DE COMPILACION FUNCIONA."
    Anotar ""
    Anotar "Nuitka compila y el binario corre. Por tanto el fallo de la"
    Anotar "aplicacion completa NO es del entorno, sino de su tamano o de"
    Anotar "alguna dependencia concreta. Lo mas probable, por este orden:"
    Anotar "  1. Memoria insuficiente durante la compilacion."
    Anotar "     Cierre Chrome, Spotify y Office, y compile con -PocaMemoria."
    Anotar "  2. Una dependencia que Nuitka no resuelve."
    Anotar "     El archivo build\nuitka.log lo dira ahora que se captura."
} else {
    Anotar "LA CADENA DE COMPILACION NO FUNCIONA EN ESTE EQUIPO."
    Anotar ""
    Anotar "Ni un programa de doce lineas compila, de modo que el problema no"
    Anotar "esta en el codigo del proyecto. Causas habituales:"
    Anotar "  1. No hay compilador de C y la descarga de MinGW64 fallo."
    Anotar "     Instale Visual Studio Build Tools con la carga de trabajo"
    Anotar "     'Desarrollo para el escritorio con C++'."
    Anotar "  2. Nuitka no soporta esta version de Python."
    Anotar "     Python 3.14 es muy reciente; pruebe con 3.12."
    Anotar ""
    Anotar "Ultimas 30 lineas de la salida de Nuitka:"
    if (Test-Path $logC) {
        Get-Content $logC -Tail 30 | ForEach-Object { Anotar ("   " + $_) }
    }
}

try {
    $lineas | Set-Content -Path $Salida -Encoding UTF8
    Write-Host ""
    Write-Host ("Informe guardado en: " + $Salida) -ForegroundColor Green
    Write-Host ("Salida cruda de Nuitka en: " + $logC) -ForegroundColor Green
} catch {
    Write-Host ("No se pudo escribir el informe: " + $_.Exception.Message) -ForegroundColor Red
}

Remove-Item -Recurse -Force $Trabajo -ErrorAction SilentlyContinue
