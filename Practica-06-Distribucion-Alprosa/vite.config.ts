import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  define: { __BUILD_TIME__: JSON.stringify(new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 16).replace(/[-:T]/g, '') + 'L') },
  build: { outDir: 'dist-html', assetsInlineLimit: 100000000, chunkSizeWarningLimit: 10000 },
});
