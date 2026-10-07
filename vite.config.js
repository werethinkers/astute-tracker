import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const local = process.env.VITE_BACKEND === 'local';
const outDir = path.join(here, local ? 'dist-local' : 'dist');

// GitHub Pages serves 404.html for unknown paths; a copy of index.html lets links like /projects/3 open directly.
const spaFallback = {
  name: 'spa-fallback',
  closeBundle() {
    const index = path.join(outDir, 'index.html');
    if (fs.existsSync(index)) fs.copyFileSync(index, path.join(outDir, '404.html'));
  },
};

export default defineConfig({
  root: 'web',
  envDir: here,
  base: '/',
  plugins: [react(), spaFallback],
  build: { outDir, emptyOutDir: true },
  server: {
    port: 5173,
    proxy: local ? { '/local': `http://localhost:${process.env.LOCAL_PORT || 4400}` } : undefined,
  },
});
