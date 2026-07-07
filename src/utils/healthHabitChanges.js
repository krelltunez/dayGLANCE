// Which health habits got a genuinely NEW value this sync.
//
// The Health Connect / HealthKit sync (src/hooks/useHabits.js) runs from an effect
// keyed on `habits`. It used to re-stamp lastModified + lastAutoSync on every
// health habit it read each run — so each run changed `habits`, which re-fired the
// effect, which re-stamped again … a self-perpetuating loop that re-pushed the
// health habits to the vault every cycle (the SSE self-nudge loop the Mac saw as
// `[pull] apply habits:…` on every drain).
//
// The fix: only touch state for habits whose count actually INCREASED. Health
// counts are merged with Math.max (never downgraded), so an idle device — no new
// steps/sleep — produces zero changes, makes no state update, and the effect goes
// quiet. A real step/sleep increase stamps once, then the immediate re-run reads
// the now-stored value, finds no change, and stops.
//
// @param {Record<string, Record<string, number>>} updates    freshly-read counts, by date then habit id
// @param {Record<string, Record<string, number>>} habitLogs  current stored counts
// @returns {Set<string>} ids of habits whose count increased vs stored
export function changedHealthHabitIds(updates, habitLogs) {
  const changed = new Set();
  for (const [dateStr, entries] of Object.entries(updates || {})) {
    const prevDay = (habitLogs && habitLogs[dateStr]) || {};
    for (const [habitId, count] of Object.entries(entries || {})) {
      if (count > (prevDay[habitId] || 0)) changed.add(habitId);
    }
  }
  return changed;
}
