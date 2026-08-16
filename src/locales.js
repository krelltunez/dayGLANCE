// Translation bundles, derived from what is actually on disk.
//
// These were previously listed by hand in i18n.js, which drifted: de, es, it
// and pt had translation files but no entry in `resources`, so every string in
// those four languages silently fell back to English. Globbing the directory
// removes the second place that had to be kept in sync — adding a language is
// now just adding public/locales/<lng>/translation.json.
//
// Bundled rather than fetched from /locales at runtime: dayGLANCE's packaged
// builds serve the renderer from somewhere other than a web root — app:// in
// Electron, a relative base on iOS and Android — so a runtime request for
// /locales/<lng>/translation.json is not reliably resolvable across targets.
// Going through the bundler means the build resolves each path instead.
//
// Lazy, though, so only the language in use is downloaded. Eagerly inlining all
// six pushed the main chunk from 3.08 MB to 3.25 MB, past the 3 MiB PWA
// precache ceiling in vite.config.js — and made every user pay for five
// languages they cannot read. Each language is its own chunk instead, small
// enough to precache individually.
const loaderModules = import.meta.glob('../public/locales/*/translation.json', {
  import: 'default',
});

// "../public/locales/pt/translation.json" -> "pt"
function tagOf(path) {
  return path.split('/').at(-2);
}

export const loaders = Object.fromEntries(
  Object.entries(loaderModules).map(([path, load]) => [tagOf(path), load]),
);

// Sorted so the value is stable across platforms — glob key order follows the
// filesystem, which is not guaranteed to match between a dev machine and CI.
export const languages = Object.keys(loaders).sort();
