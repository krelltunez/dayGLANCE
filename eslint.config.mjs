import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

// Flat ESLint config. Intentionally conservative on first adoption: the
// bug-catching rules (undefined references, misused hooks) are ERRORS and gate
// CI; the stylistic/heuristic rules (unused vars, hook dependency arrays) are
// WARNINGS so a large pre-existing codebase doesn't turn the build red. Tighten
// warnings to errors over time as the warning count is driven down.
export default [
  {
    ignores: [
      'dist/**',
      'dist-electron/**',
      'dev-dist/**',
      'build/**',
      'coverage/**',
      'node_modules/**',
    ],
  },

  // Application source (browser runtime).
  {
    files: ['src/**/*.{js,jsx}'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
        // Native bridge injected by the Android/iOS wrappers.
        DayGlanceNative: 'readonly',
        // Vite `define` compile-time constants (see vite.config.*.js).
        __APP_VERSION__: 'readonly',
        __BUILD_TIMESTAMP__: 'readonly',
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // Bug-catchers — these gate CI.
      'no-undef': 'error',
      'react-hooks/rules-of-hooks': 'error',
      // Heuristic/stylistic — informational for now.
      'react-hooks/exhaustive-deps': 'warn',
      // Deferred: ~2900 pre-existing hits, almost all benign (unused destructured
      // context values and imports), which would bury the useful warnings above.
      // Re-enable as 'warn' (with the ^_ ignore patterns) after a cleanup pass.
      'no-unused-vars': 'off',
      'no-empty': 'warn',
      'no-constant-condition': ['warn', { checkLoops: false }],
      'no-useless-escape': 'warn',
      'no-prototype-builtins': 'warn',
      'no-cond-assign': 'warn',
      'no-control-regex': 'off',
    },
  },

  // Test files (Vitest) — add the test + Node globals the suites rely on.
  {
    files: ['src/**/*.{test,spec}.{js,jsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
  },
];
