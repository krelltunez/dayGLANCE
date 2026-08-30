import { describe, it, expect } from 'vitest';

// NORMALIZE-THEN-OBSERVE, the dayGLANCE-side pins (§3.10 ruling 7). The
// package-level pins (packages/obsidian-format/src/normalizeObserve.test.js)
// cover the stamper's parse parity and the fail-closed gate; these cover
// what the ruling buys END TO END: an observation that went through the
// plugin's normalize step imports fully-stamped, an add-then-rename in
// Obsidian is ONE task at every point (the founding duplicate never
// exists, even transiently), and tasks dayGLANCE already imported untagged
// still resolve through the existing hint adoption. The plugin's TS wiring
// is exercised here by running the SAME shared stamper it calls, against
// the REAL observation apply and merge.

import { stampUntaggedTaskLines, legacyObsidianId, deriveBlockId, appIdForBlockId } from '@glance-apps/obsidian-format';
import { applyBridgeObservations } from './obsidianBridgeInbound.js';
import { mergeObsidianTasks, noteMtimesFromDailyNotes } from './mergeObsidianTasks.js';

const D = '2026-08-30';
const noPreserve = () => ({});

// One plugin-observed sync round: normalize (what the plugin does before
// reporting), apply, merge — returns the next task state.
function observeRound({ noteText, mtime, tasks, inbox }) {
  const normalized = stampUntaggedTaskLines(noteText, D);
  const applied = applyBridgeObservations(
    [{ path: `${D}.md`, content: normalized.text, mtime }],
    { existingTasks: tasks, existingInbox: inbox, dailyNotesPath: '', dailyNotePattern: 'yyyy-MM-dd' },
  );
  const mtimes = noteMtimesFromDailyNotes(applied.dailyNotes);
  return {
    noteText: normalized.text,
    tasks: mergeObsidianTasks(tasks, applied.scheduledTasks, applied.scannedIds, noPreserve, {}, mtimes),
    inbox: mergeObsidianTasks(inbox, applied.inboxTasks, applied.scannedIds, noPreserve, {}, mtimes),
  };
}
const all = (s) => [...s.tasks, ...s.inbox];

describe('normalize-then-observe, end to end (§3.10 ruling 7)', () => {
  it('THE STRUCTURAL PROPERTY, loudly: a normalized observation imports NO task without a block id', () => {
    const note = [
      '## Tasks',
      '- [ ] Plain new line',
      '- [ ] 09:00-09:30 Timed line',
      '- [ ] 2026-09-01 Dated line 📅 2026-09-02',
    ].join('\n');
    const s = observeRound({ noteText: note, mtime: Date.parse('2026-08-30T10:00:00Z'), tasks: [], inbox: [] });
    expect(all(s)).toHaveLength(3);
    for (const t of all(s)) {
      // If this ever fails, the ruling's invariant — "visible in dayGLANCE
      // implies already stamped" — has stopped holding. That is the class
      // regression, not a cosmetic one.
      expect(t.obsidianBlockId, `UNSTAMPED TASK REACHED dayGLANCE: ${t.title}`).toBeTruthy();
      expect(String(t.id).startsWith('obsidian-dg-')).toBe(true);
    }
  });

  it('THE FOUNDING FLOW: a line added in Obsidian and renamed immediately is ONE task at every point — no transient duplicate', () => {
    // Add: the plugin stamps before reporting, so the first thing dayGLANCE
    // ever sees is the tagged line.
    const s1 = observeRound({
      noteText: '## Tasks\n- [ ] Buy milk',
      mtime: Date.parse('2026-08-30T10:00:00Z'),
      tasks: [], inbox: [],
    });
    expect(all(s1)).toHaveLength(1);
    const id = String(all(s1)[0].id);
    expect(id).toBe(appIdForBlockId(deriveBlockId(D, 'Buy milk')));

    // Rename in Obsidian, immediately: the user edits the words; the token
    // at end of line survives (that is what block ids are for). The plugin
    // has nothing to stamp — the observation reports the retitled line.
    const renamed = s1.noteText.replace('Buy milk', 'Buy oat milk');
    const s2 = observeRound({
      noteText: renamed,
      mtime: Date.parse('2026-08-30T10:00:30Z'),
      tasks: s1.tasks, inbox: s1.inbox,
    });
    // One task, SAME identity, new title — a retitle, not delete+create.
    // Before this ruling the same gesture on a not-yet-stamped line split
    // the task and only the janitor un-split it a cycle later.
    expect(all(s2)).toHaveLength(1);
    expect(String(all(s2)[0].id)).toBe(id);
    expect(all(s2)[0].title).toContain('Buy oat milk');
  });

  it('BACKSTOP COMPATIBILITY: a task dayGLANCE already imported untagged resolves through hint adoption when the plugin-stamped line arrives — one task, app fields carried', () => {
    const L = legacyObsidianId(D, 'Buy milk');
    const preRuling = {
      id: L, importSource: 'obsidian', obsidianRawTitle: 'Buy milk', obsidianFileDate: D,
      title: 'Buy milk #obsidian', completed: false, color: 'bg-red-500',
      lastModified: '2026-08-30T09:00:00.000Z',
    };
    const s = observeRound({
      noteText: '## Tasks\n- [ ] Buy milk',
      mtime: Date.parse('2026-08-30T10:00:00Z'),
      tasks: [], inbox: [preRuling],
    });
    expect(all(s)).toHaveLength(1);
    const [t] = all(s);
    // The tagged line advertises the legacy id as its hint; the adoption
    // machinery and the merge's hint lookup collapse the copies (the
    // stamped-orphan sweep covers the DB tier, pinned in
    // utils/obsidianGhostRows.test.js).
    expect(String(t.id)).toBe(appIdForBlockId(deriveBlockId(D, 'Buy milk')));
    expect(t.obsidianLegacyId).toBe(L);
    expect(t.color).toBe('bg-red-500'); // carried, not re-defaulted
  });
});
