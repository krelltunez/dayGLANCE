// Ambient-mode preferences for the Day Dial — shared between the dial's
// Layers panel (which edits them) and the app-level screensaver watcher
// (which only reads them, straight from storage each check, so the two
// never need state plumbing between them).
//
// Device-local by design, like the dial's layer toggles: a wall kiosk wants
// the screensaver, a laptop doesn't, and syncing the choice would make the
// two fight.
//
//   auto        — start ambient after idle while the dial is open
//   fromPlanner — ALSO start from anywhere in the planner (the true
//                 screensaver; only meaningful with auto on)
//   delayMin    — idle minutes before starting

export const DIAL_AMBIENT_KEY = 'day-planner-dial-ambient';
export const DEFAULT_AMBIENT_PREFS = { auto: false, fromPlanner: false, delayMin: 5 };
export const AMBIENT_DELAY_OPTIONS = [1, 5, 15, 30];

export function loadAmbientPrefs() {
  try {
    return { ...DEFAULT_AMBIENT_PREFS, ...JSON.parse(localStorage.getItem(DIAL_AMBIENT_KEY) || '{}') };
  } catch {
    return DEFAULT_AMBIENT_PREFS;
  }
}

export function saveAmbientPrefs(prefs) {
  try {
    localStorage.setItem(DIAL_AMBIENT_KEY, JSON.stringify(prefs));
  } catch { /* view pref only */ }
}
