/**
 * Vite config for the iOS WKWebView bundle.
 *
 * Identical to vite.config.android.js — relative asset paths required for
 * the custom local:// URL scheme, no PWA service worker, no crossorigin attrs.
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
    {
      name: 'remove-crossorigin',
      transformIndexHtml(html) {
        return html.replace(/ crossorigin/g, '');
      },
    },
  ],

  build: {
    outDir: 'dayglance-ios/DayGlance/Resources/web',
    emptyOutDir: true,
  },
});
