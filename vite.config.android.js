/**
 * Vite config for the Android WebView bundle.
 *
 * Differences from the default web build:
 *   - base: './'     — relative asset paths required for file:// loading
 *   - No VitePWA     — service workers don't run on file:// URLs
 *   - outDir targets the Android assets folder directly
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  base: './',

  define: {
    __BUILD_TIMESTAMP__: JSON.stringify(new Date().toISOString()),
    __APP_VERSION__: JSON.stringify(pkg.version),
  },

  plugins: [
    react(),
    // Remove crossorigin attributes — they cause CORS errors on file:// URLs in Android WebView
    {
      name: 'remove-crossorigin',
      transformIndexHtml(html) {
        return html.replace(/ crossorigin/g, '');
      },
    },
  ],

  build: {
    outDir: 'dayglance-android/app/src/main/assets/web',
    emptyOutDir: true,
  },
});
