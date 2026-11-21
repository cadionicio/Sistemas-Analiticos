// Configuración de compilación: genera UN SOLO archivo HTML autocontenido
// (JS, CSS, WASM de SQLite y datos embebidos) → 08_Sistema_Analisis_Predictivo_Inventarios.html
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  base: './',
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    target: 'es2022',
    assetsInlineLimit: 100_000_000, // todo (incluido sql-wasm.wasm) se incrusta como data: URI
    cssCodeSplit: false,
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: { environment: 'node', testTimeout: 60_000 },
} as any);
