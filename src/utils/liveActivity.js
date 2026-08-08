// Live Activity "Up Next" projection — turns the snapshot's unified up-next
// entry (task or hyperGLANCE session; see nextUpNext in App.jsx) into the
// schedule FACTS the Dynamic Island renders.
//
// Phrasing rule: every string must stay true no matter when it is glanced at.
// A no-backend app cannot update a Live Activity in the background, so claims
// about "now" ("In progress: X") go wrong the moment a block boundary passes
// with the app closed. "Deep work until 2:00 PM" / "Standup at 3:30 PM" do
// not — they describe the schedule, not the present.
//
// The live part is delegated to the OS: countdownStartMs..countdownEndMs is
// the interval for SwiftUI's Text(timerInterval:), which ticks every second
// with zero updates and zero pushes. In progress → the block itself (counts
// down time remaining); upcoming → now..start (counts down to the start).
// After the interval passes without an update it reads 0:00 next to a label
// that is still factual, and the activity's staleDate dims it.
//
// The fact also carries the block's ENERGY ('effort' | 'restore'), which tints
// the island's countdown ring and picks the bolt/leaf glyph inside it — the
// same pairing the in-app strip uses. Callers that already resolved it (the
// snapshot builder does, from the unstripped source block) pass it on the entry
// and deriveBlockEnergy returns it untouched; anything else falls back to
// deriving from the title, so the field is never absent.

import { deriveBlockEnergy } from './energyAxis.js';

const toHHMM = (ms) => {
  const t = new Date(ms);
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
};

/**
 * @param {{title?: string, startTime?: string, duration?: number, energy?: string}|null} entry
 *   today's current-or-next block ('HH:MM' start, minutes duration, optional
 *   resolved 'effort'|'restore')
 * @param {number} nowMs epoch ms "now" (startTime is resolved against its day)
 * @param {(hhmm: string) => string} formatTime display formatter (12h/24h)
 * @param {{until?: string, at?: string}} [words] localized label words
 *   (defaults are English so tests and non-localized callers stay stable)
 * @returns {{title, inProgress, timeLabel, energy, countdownStartMs, countdownEndMs}|null}
 */
export function buildUpNextFact(entry, nowMs, formatTime, words) {
  if (!entry || !entry.startTime) return null;
  const parts = String(entry.startTime).split(':').map(Number);
  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null;
  const w = { until: 'until', at: 'at', ...(words || {}) };
  const d = new Date(nowMs);
  d.setHours(parts[0], parts[1], 0, 0);
  const startMs = d.getTime();
  const endMs = startMs + (entry.duration || 0) * 60000;
  const inProgress = nowMs >= startMs;
  return {
    title: entry.title || '',
    inProgress,
    timeLabel: inProgress ? `${w.until} ${formatTime(toHHMM(endMs))}` : `${w.at} ${formatTime(toHHMM(startMs))}`,
    energy: deriveBlockEnergy(entry),
    countdownStartMs: inProgress ? startMs : nowMs,
    countdownEndMs: inProgress ? endMs : startMs,
  };
}
