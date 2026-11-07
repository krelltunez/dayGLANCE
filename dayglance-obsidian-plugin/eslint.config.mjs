// Obsidian's own lint rules (eslint-plugin-obsidianmd), the ones the
// community directory's automated review is built on. Errors fail CI (the
// Bridge mirror workflow runs `npm run lint`); warnings are reported only.
import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';
// The rule's own brand list (the package has no exports map; this is the
// list its sentence-case rule defaults to), plus the product names this
// plugin's UI cannot avoid. Without them every "Add to dayGLANCE" or
// "GLANCEvault" string reads as a casing mistake.
import { DEFAULT_BRANDS } from 'eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js';

export default defineConfig([
  // Not plugin code: build output, installs, the shared packages the mirror
  // copies in, the scenario harness (it drives the dayGLANCE app), the
  // mirror-only files, and the Node build script.
  { ignores: ['main.js', 'node_modules/', 'packages/', 'test/', 'mirror/', 'esbuild.config.mjs'] },
  ...obsidianmd.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      'obsidianmd/ui/sentence-case': ['warn', { brands: [...DEFAULT_BRANDS, 'dayGLANCE', 'GLANCEvault'] }],
    },
  },
]);
