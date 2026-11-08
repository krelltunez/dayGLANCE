import { extractTags } from './taskUtils.js';

// Energy axis (summary strip phase 2): every timed block is either EFFORT
// (output — work, meetings, errands) or RESTORE (input — meals, movement,
// rest). Binary by design, and the labels are deliberately judgment-free:
// "Effort/Restore", never "Grind". Tone decides whether the strip reads as
// clarifying or as scolding.
//
// Resolution order:
//   1. Explicit per-block override (task.energy) — the user's word is final.
//   2. Keyword match on the block's #tags and title words → restore.
//   3. Everything else → effort.
//
// Effort is the fallback because scheduled blocks are output by default; the
// keyword list only argues a block INTO restore, never out of it, so a wrong
// guess is always one tap away from correct via the override.
//
// Deliberately NOT derived from GTD frame energyLevel: that field means energy
// REQUIRED for the frame's work ("high energy → deep/complex work, low energy →
// admin/easy tasks" — see ai-prompts.js). A low-energy frame is still effort,
// so mapping it to restore would misclassify exactly the admin blocks it
// describes.

export const ENERGY_EFFORT = 'effort';
export const ENERGY_RESTORE = 'restore';

// Conservative on purpose — false "restore" reads worse than false "effort",
// and the per-block override exists for everything this list misses. Matched
// against whole words only, so "restaurant" never matches "rest". The Android
// launcher provider keeps a copy for device events (LauncherDeviceEvents.kt);
// launcherDeviceEvents.fixture.test.js holds the two equal.
export const RESTORE_KEYWORDS = new Set([
  'health', 'gym', 'workout', 'exercise', 'run', 'running', 'walk', 'yoga',
  'meditate', 'meditation', 'breakfast', 'lunch', 'dinner', 'meal', 'eat',
  'break', 'rest', 'nap', 'sleep', 'recharge', 'recovery',
  'relax', 'relaxation', 'unwind', 'chill',
]);

/**
 * @param task Timeline block (needs title; energy optional).
 * @returns 'effort' | 'restore'
 */
export function deriveBlockEnergy(task) {
  if (task?.energy === ENERGY_RESTORE || task?.energy === ENERGY_EFFORT) return task.energy;
  const title = task?.title || '';
  const words = new Set([
    ...extractTags(title),
    ...title.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean),
  ]);
  for (const w of words) {
    if (RESTORE_KEYWORDS.has(w)) return ENERGY_RESTORE;
  }
  return ENERGY_EFFORT;
}

const isOverride = (energy) => energy === ENERGY_RESTORE || energy === ENERGY_EFFORT;

/**
 * What the block resolves to and why (#2331, the card's marker): `energy` as
 * deriveBlockEnergy gives it, and `setByUser` when that is the user's own
 * override rather than the derivation.
 */
export function blockEnergySource(task) {
  return { energy: deriveBlockEnergy(task), setByUser: isOverride(task?.energy) };
}

/**
 * The override a click on the card's marker writes: the other value, or null
 * (back to auto) when the derivation already gives the other value. So an
 * override is only ever stored where it disagrees with the derivation, and a
 * second click undoes the first. The context menu's cycle, which can also
 * return to auto, stays as it is.
 *
 * @returns 'effort' | 'restore' | null
 */
export function flipEnergyOverride(task) {
  const target = deriveBlockEnergy(task) === ENERGY_RESTORE ? ENERGY_EFFORT : ENERGY_RESTORE;
  const derived = deriveBlockEnergy({ ...task, energy: undefined });
  return derived === target ? null : target;
}

/**
 * The override, carried onto a task built from another (a series turned into
 * a one-off and back, an occurrence moved to another date or postponed):
 * every such path writes the new row field by field, and one that forgot
 * `energy` dropped the user's word (#2331). Spread it beside carryCreatedAt.
 */
export const carryEnergy = (source) => (isOverride(source?.energy) ? { energy: source.energy } : {});
