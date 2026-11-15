// The line writes this device has sent to the vault and not yet seen back.
//
// When dayGLANCE changes a task line's text (a schedule written as metadata,
// a retitle), it records the new text on the task at once (obsidianRawTitle:
// commit on enqueue, useObsidianSync), because the outbox is durable and the
// enqueue is the write. The plugin applies it a moment later. Any report of
// that note generated in between still shows the OLD line, and the per-note
// merge reads "the line differs from what we last wrote" as an edit made in
// Obsidian: a schedule dayGLANCE had just written looked like the vault
// removing it, and the task went back to the inbox; a retitle looked like the
// vault restoring the old title.
//
// That window is routine, not rare: scheduling two tasks of one note a few
// seconds apart (an assistant does exactly that) means the report produced by
// the first write is read after the second was queued.
//
// So a report that shows a line EXACTLY as it read before a write of ours
// that has not been seen back says nothing new about that line. This is the
// registry of those writes: per task, the texts the line had before, and the
// text it will have. It is cleared by the report that shows our write, by the
// task's text moving on by another route, or by time.
//
// Device-local and in memory on purpose. Another device has no such record
// and may still misread the same report; its copy then meets this device's
// newer one in sync. After a reload the record is gone and the old behaviour
// applies for that one report.

/** How long an unseen write is waited for before a report of the old line is believed again. */
export const OWN_WRITE_PENDING_MAX_MS = 10 * 60 * 1000;

export function createOwnWriteRegistry(now = Date.now) {
  const pending = new Map(); // task id → { bases: Set<string>, expected: string, at: number }
  return {
    /** A write of ours takes the line from `baseRaw` to `expectedRaw`. */
    note(id, baseRaw, expectedRaw) {
      if (typeof baseRaw !== 'string' || typeof expectedRaw !== 'string' || baseRaw === expectedRaw) return;
      const key = String(id);
      const entry = pending.get(key);
      // A second write before the first was seen back: every text the line
      // had on the way is still "before our write".
      const bases = entry && entry.expected === baseRaw ? entry.bases : new Set();
      bases.add(baseRaw);
      bases.delete(expectedRaw);
      pending.set(key, { bases, expected: expectedRaw, at: now() });
    },
    /** The task's id changed (a retitle of an untagged line, a block id assigned). */
    rekey(fromId, toId) {
      const from = String(fromId);
      const to = String(toId);
      if (from === to || !pending.has(from)) return;
      pending.set(to, pending.get(from));
      pending.delete(from);
    },
    /**
     * Does a report showing `observedRaw` for this task show the line as it
     * was before a write of ours it has not caught up with?
     */
    isStale(existing, observedRaw) {
      if (!existing) return false;
      const key = String(existing.id);
      const entry = pending.get(key);
      if (!entry) return false;
      // Too old to wait for, or the task's text moved on by another route.
      if (now() - entry.at > OWN_WRITE_PENDING_MAX_MS || existing.obsidianRawTitle !== entry.expected) {
        pending.delete(key);
        return false;
      }
      // Our write, seen back: from here a different line is the vault's.
      if (observedRaw === entry.expected) {
        pending.delete(key);
        return false;
      }
      return entry.bases.has(observedRaw);
    },
    size: () => pending.size,
  };
}
