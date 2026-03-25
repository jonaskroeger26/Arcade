import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, 'app');

/** Emits dist/index.html so Vercel serves the game at /. */
export default defineConfig({
  root: 'app',
  publicDir: 'public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve(appDir, 'index.html'),
      },
    },
  },
});
