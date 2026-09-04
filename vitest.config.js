// Vitest config: the app's Vite config plus the bridge scenario harness
// (dayglance-obsidian-plugin/test). The `obsidian` module has no runtime of
// its own (Obsidian provides it in-process), so tests alias it to a stub.
import { fileURLToPath } from 'node:url';
import { mergeConfig } from 'vite';
import { defineConfig } from 'vitest/config';
import viteConfig from './vite.config.js';

export default mergeConfig(viteConfig, defineConfig({
  resolve: {
    alias: [
      { find: 'obsidian', replacement: fileURLToPath(new URL('./dayglance-obsidian-plugin/test/obsidianStub.ts', import.meta.url)) },
      // The plugin installs its own copy of @glance-apps/sync; in one test
      // process both sides must share ONE instance (the root key, the brake,
      // the own-write ring are module state).
      { find: /^@glance-apps\/sync(\/.*)?$/, replacement: fileURLToPath(new URL('./node_modules/@glance-apps/sync', import.meta.url)) + '$1' },
    ],
  },
  test: {
    include: ['**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    exclude: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/dist-electron/**'],
  },
}));
