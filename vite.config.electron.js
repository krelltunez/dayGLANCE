import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

// Inject the Content-Security-Policy as a <meta> tag into the Electron build's
// index.html. index.html is SHARED with the web/Android/iOS builds so it cannot
// carry an Electron-only CSP, and main.ts's onHeadersReceived header only covers
// documents loaded over a protocol that emits response headers. This meta tag is
// the belt-and-braces enforcement for the file:// entry document. The policy MUST
// stay byte-identical to the CSP constant in electron/main.ts.
function electronCspMetaPlugin() {
  const CSP = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self' https:",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ');
  return {
    name: 'electron-csp-meta',
    transformIndexHtml() {
      return [{
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
        injectTo: 'head-prepend',
      }];
    },
  };
}

// Electron renderer build — no PWA, no dev proxy, base must be './' for file:// loading
export default defineConfig({
  base: './',
  define: {
    __BUILD_TIMESTAMP__: JSON.stringify(new Date().toISOString()),
    __APP_VERSION__: JSON.stringify(pkg.version),
    __IS_ELECTRON__: 'true',
  },
  build: {
    sourcemap: false,
    outDir: 'dist',
    emptyOutDir: true,
  },
  plugins: [react(), electronCspMetaPlugin()],
});
