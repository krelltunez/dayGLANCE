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

const toHHMM = (ms) => {
  const t = new Date(ms);
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
};

/**
 * @param {{title?: string, startTime?: string, duration?: number}|null} entry
 *   today's current-or-next block ('HH:MM' start, minutes duration)
 * @param {number} nowMs epoch ms "now" (startTime is resolved against its day)
 * @param {(hhmm: string) => string} formatTime display formatter (12h/24h)
 * @returns {{title, inProgress, timeLabel, countdownStartMs, countdownEndMs}|null}
 */
export function buildUpNextFact(entry, nowMs, formatTime) {
  if (!entry || !entry.startTime) return null;
  const parts = String(entry.startTime).split(':').map(Number);
  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null;
  const d = new Date(nowMs);
  d.setHours(parts[0], parts[1], 0, 0);
  const startMs = d.getTime();
  const endMs = startMs + (entry.duration || 0) * 60000;
  const inProgress = nowMs >= startMs;
  return {
    title: entry.title || '',
    inProgress,
    timeLabel: inProgress ? `until ${formatTime(toHHMM(endMs))}` : `at ${formatTime(toHHMM(startMs))}`,
    countdownStartMs: inProgress ? startMs : nowMs,
    countdownEndMs: inProgress ? endMs : startMs,
  };
}
