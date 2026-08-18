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

/**
 * Which regional variant a bare language tag means when more than one ships.
 *
 * Portuguese was a single "pt" locale, written in the European standard, until
 * it was split into pt-PT and pt-BR. Bare "pt" therefore has to keep resolving
 * to European: every existing Portuguese user has "pt" cached in localStorage,
 * and mapping it anywhere else would silently change the language under people
 * who never asked for it. Browsers reporting a Portuguese-speaking region we
 * do not ship (pt-AO, pt-MZ) land here too.
 */
const REGIONAL_DEFAULTS = { pt: 'pt-PT' };

/**
 * Map any language tag onto one this app actually ships.
 *
 * Used in two places that must agree: the detector, so a stored or browser tag
 * resolves before i18next sees it, and the picker, so the select always has a
 * matching option. If they disagreed, the UI would render one language while
 * the picker displayed another.
 */
export function resolveLanguage(reported, available = languages) {
  const fallback = available.includes('en') ? 'en' : available[0];
  if (!reported || typeof reported !== 'string') return fallback;

  if (available.includes(reported)) return reported;

  // "pt-br" from a browser that lower-cases the region.
  const exact = available.find((l) => l.toLowerCase() === reported.toLowerCase());
  if (exact) return exact;

  const base = reported.split('-')[0].toLowerCase();
  if (available.includes(base)) return base;

  const preferred = REGIONAL_DEFAULTS[base];
  if (preferred && available.includes(preferred)) return preferred;

  // A regional tag for a language we ship only regionally, with no default
  // declared — any variant beats falling through to English.
  const sameLanguage = available.find((l) => l.split('-')[0].toLowerCase() === base);
  return sameLanguage ?? fallback;
}
