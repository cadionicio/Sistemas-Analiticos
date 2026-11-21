#!/usr/bin/env bash
# Construye los dos entregables desde el MISMO núcleo:
#   08_Sistema_Analisis_Predictivo_Inventarios.html (Vite + vite-plugin-singlefile)
#   07_Sistema_Analisis_Predictivo_Inventarios.exe  (Go + WebView2, subsistema GUI, recursos: ícono, manifiesto, versión)
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p entregables
( cd app && npx tsc --noEmit && npx vite build )
cp app/dist/index.html entregables/08_Sistema_Analisis_Predictivo_Inventarios.html
cp app/dist/index.html exe/web/index.html
# EXE CONGELADO (Paso 13, 30/09/2026): no se reconstruye salvo FORZAR=1 (cambiaría la huella enviada a Microsoft).
if [[ -f ../docs/EXE_CONGELADO.md && -f entregables/07_Sistema_Analisis_Predictivo_Inventarios.exe && "${FORZAR:-0}" != "1" ]]; then
  echo "EXE congelado: se conserva el binario verificado (use FORZAR=1 solo si es imprescindible y vuelva a congelar)."
  sha256sum entregables/*; exit 0
fi
( cd exe/recursos && x86_64-w64-mingw32-windres --preprocessor=cpp --preprocessor-arg=-P -c 65001 -i recursos.rc -O coff -o ../rsrc_windows_amd64.syso )
( cd exe && GOPROXY=direct GOSUMDB=off GOTOOLCHAIN=local GOFLAGS=-mod=mod GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
    go build -trimpath -ldflags "-H windowsgui -s -w -buildid=" -o ../entregables/07_Sistema_Analisis_Predictivo_Inventarios.exe . )
sha256sum entregables/*
