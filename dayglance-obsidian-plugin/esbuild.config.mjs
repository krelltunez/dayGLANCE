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
});

if (prod) {
  await ctx.rebuild();
  process.exit(0);
} else {
  await ctx.watch();
}
