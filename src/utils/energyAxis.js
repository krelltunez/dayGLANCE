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
// against whole words only, so "restaurant" never matches "rest".
export const RESTORE_KEYWORDS = new Set([
  'health', 'gym', 'workout', 'exercise', 'run', 'running', 'walk', 'yoga',
  'meditate', 'meditation', 'breakfast', 'lunch', 'dinner', 'meal', 'eat',
  'break', 'rest', 'nap', 'sleep', 'recharge', 'recovery',
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
