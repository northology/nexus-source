import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The cockpit is served by the nexus server from cockpit/dist; there is no dev server (the server injects the
// answer token into index.html, which a Vite dev server would not). Develop with `pnpm cockpit:watch` plus
// `pnpm serve:example`.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
});
