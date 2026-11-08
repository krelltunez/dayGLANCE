// Whether a frame would overlap another (#2305, #2335). One rule for the frame
// editor's save and for dragging a frame into another set, so a drop can never
// make a clash the editor would refuse. Pure; the callers put it into words.
//
// Two frames clash when they share a day (a weekday, or a single date that
// falls on one) and their times overlap. Frames in two DIFFERENT sets are
// alternatives (work and holiday on the same weekday) and may overlap; a frame
// in no set can meet any other, so it is always checked. A disabled frame is
// never in the way.

const noSet = (setId) => setId == null || setId === '';

/**
 * @param {{ id?, days?: number[], singleDate?: string, start: string, end: string, setId? }} candidate
 *   the frame as it would be saved; `setId` empty or absent for no set
 * @param {object[]} frames  every frame (the candidate's own row is skipped by id)
 * @returns {{ frame: object, days: number[]|null } | null}  the first frame it
 *   would overlap, with the weekdays they share (null for a single date)
 */
export function findFrameOverlap(candidate, frames = []) {
  const { id, days = [], singleDate, start, end, setId } = candidate || {};
  const inOtherSet = (other) => !noSet(setId) && !noSet(other.setId) && String(other.setId) !== String(setId);
  const others = (frames || []).filter((f) => f && (id == null || f.id !== id) && f.enabled && !inOtherSet(f));
  for (const other of others) {
    const otherDays = other.days || [];
    if (singleDate) {
      const sameDay = other.singleDate === singleDate
        || (!other.singleDate && otherDays.includes(new Date(`${singleDate}T12:00:00`).getDay()));
      if (sameDay && start < other.end && end > other.start) return { frame: other, days: null };
    } else {
      const shared = days.filter((d) => otherDays.includes(d));
      if (shared.length > 0 && start < other.end && end > other.start) return { frame: other, days: shared };
    }
  }
  return null;
}
