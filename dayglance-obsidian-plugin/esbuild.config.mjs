import esbuild from 'esbuild';
import process from 'node:process';

const prod = process.argv[2] === 'production';

// One self-contained main.js next to manifest.json — the shape Obsidian
// loads. `obsidian` (and Electron/CodeMirror internals) stay external: the
// app provides them at runtime.
const ctx = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
  format: 'cjs',
  target: 'es2020',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  outfile: 'main.js',
  // Build stamp, shown in the settings tab so a running copy is identifiable
  // ("which main.js is this vault actually loading?" — a recurring debugging
  // question). Stamped at BUNDLE time; in watch mode this is the watcher's
  // start time, which is close enough for dev.
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
});

if (prod) {
  await ctx.rebuild();
  process.exit(0);
} else {
  await ctx.watch();
}
