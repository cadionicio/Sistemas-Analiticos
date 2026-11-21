#!/usr/bin/env bash
# Construcción reproducible PC05: HTML offline (ENT-12) + EXE Windows (ENT-11) + pruebas.
# Uso: ./build.sh 0.1.0-i1
set -euo pipefail
VER="${1:?versión requerida, ej. 0.1.0-i1}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="$ROOT/builds/v$VER"; mkdir -p "$OUT"
cd "$ROOT/datos" && python3 gen05.py 05_Datos_Entrada.xlsx > /dev/null
cd "$ROOT/datos" && python3 gen_empresa_grande.py Datos_Empresa_Gran_Escala.xlsx > /dev/null
cd "$ROOT/web"
./node_modules/.bin/esbuild test/domain.test.ts --bundle --platform=node --outfile="$OUT/domain.test.cjs" --log-level=warning
node --test "$OUT/domain.test.cjs" > "$OUT/pruebas_unitarias_dominio.txt" 2>&1 || { cat "$OUT/pruebas_unitarias_dominio.txt"; exit 1; }
rm -f "$OUT/domain.test.cjs"
./node_modules/.bin/esbuild test/analitica.test.ts --bundle --platform=node --outfile="$OUT/analitica.test.cjs" --log-level=warning
node --test "$OUT/analitica.test.cjs" > "$OUT/pruebas_unitarias_analitica.txt" 2>&1 || { cat "$OUT/pruebas_unitarias_analitica.txt"; exit 1; }
rm -f "$OUT/analitica.test.cjs"
./node_modules/.bin/esbuild test/simulacion.test.ts --bundle --platform=node --outfile="$OUT/simulacion.test.cjs" --log-level=warning
node --test "$OUT/simulacion.test.cjs" > "$OUT/pruebas_unitarias_simulacion_eva.txt" 2>&1 || { cat "$OUT/pruebas_unitarias_simulacion_eva.txt"; exit 1; }
rm -f "$OUT/simulacion.test.cjs"
./node_modules/.bin/esbuild test/integracion.test.ts --bundle --platform=node --external:exceljs --outfile="test/tmp/integracion.test.cjs" --log-level=warning
PC05_REF="$ROOT/ref" PC05_DATOS="$ROOT/datos/05_Datos_Entrada.xlsx" node --test test/tmp/integracion.test.cjs > "$OUT/pruebas_integracion.txt" 2>&1 || { cat "$OUT/pruebas_integracion.txt"; exit 1; }
node build.mjs "$VER" > "$OUT/build_html.json"
cp dist/12_Aplicacion_Offline.html "$OUT/12_Aplicacion_Offline.html"
cp dist/12_Aplicacion_Offline.html "$ROOT/host/assets/index.html"
cd "$ROOT/host"
GOFLAGS=-mod=mod GOPROXY=off GOSUMDB=off GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
  go build -trimpath -ldflags="-H windowsgui -s -w -X main.version=$VER" -o "$OUT/11_Aplicacion.exe" .
cd "$OUT"; sha256sum 11_Aplicacion.exe 12_Aplicacion_Offline.html > SHA256SUMS.txt
echo "OK $VER"; cat SHA256SUMS.txt
