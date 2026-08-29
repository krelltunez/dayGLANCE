import { describe, it, expect } from 'vitest';
import {
  parseTasksFromMarkdown,
  splitCompletionMarker,
  completionMarkerSuffix,
  deriveBlockId,
  legacyObsidianId,
} from './index.js';

// COMPLETION-MARKER GRAMMAR PINS, beside the code they pin (moved from
// dayGLANCE's obsidian.completionMarkers.test.js in the format-package
// extraction). The transport-level suites (write round trips, the no-op
// skip, native contract, plugin detection) stay in dayGLANCE.

const DATE = '2026-09-02';
const BLOCK = 'aaaa1111';
const ISO_LOCAL = '2026-09-02T20:15:30-05:00';

describe('splitCompletionMarker', () => {
  it('splits both formats; leaves everything else alone', () => {
    expect(splitCompletionMarker('Alpha ✅ 2026-09-02')).toEqual({ text: 'Alpha', completedAt: '2026-09-02' });
    expect(splitCompletionMarker('Alpha [completed:: 2026-09-02T20:15:30-05:00]'))
      .toEqual({ text: 'Alpha', completedAt: '2026-09-02T20:15:30-05:00' });
    expect(splitCompletionMarker('Alpha')).toEqual({ text: 'Alpha', completedAt: null });
    // Marker-shaped text NOT at the end stays put.
    expect(splitCompletionMarker('✅ 2026-09-02 first thing').completedAt).toBe(null);
  });

  it('a Dataview field with a non-ISO value is stripped but yields no timestamp', () => {
    expect(splitCompletionMarker('Alpha [completed:: yes]')).toEqual({ text: 'Alpha', completedAt: null });
  });
});

describe('completionMarkerSuffix — deterministic emission from the stored string', () => {
  it('tasks format is the stored value sliced to a date; dataview is the stored value verbatim', () => {
    expect(completionMarkerSuffix(true, ISO_LOCAL, 'tasks', 'Alpha')).toBe(' ✅ 2026-09-02');
    expect(completionMarkerSuffix(true, ISO_LOCAL, 'dataview', 'Alpha')).toBe(` [completed:: ${ISO_LOCAL}]`);
    // A date-only historical completedAt emits honestly as a date — no
    // fabricated midnight time.
    expect(completionMarkerSuffix(true, '2026-08-10', 'dataview', 'Alpha')).toBe(' [completed:: 2026-08-10]');
  });

  it("'' when uncompleted, when there is no timestamp, when format is null, or after a foreign block ref", () => {
    expect(completionMarkerSuffix(false, ISO_LOCAL, 'tasks', 'Alpha')).toBe('');
    expect(completionMarkerSuffix(true, null, 'tasks', 'Alpha')).toBe('');
    expect(completionMarkerSuffix(true, ISO_LOCAL, null, 'Alpha')).toBe('');
    // An Obsidian block reference must be the last thing on its line.
    expect(completionMarkerSuffix(true, ISO_LOCAL, 'tasks', 'Alpha ^myref')).toBe('');
  });
});

describe('parse: the identity scoping', () => {
  it('TAGGED line: marker split out of the title, absorbed into completedAt when checked', () => {
    const { scheduledTasks } = parseTasksFromMarkdown(
      `## Tasks\n- [x] ${DATE} Alpha ✅ 2026-09-02 ^dg-${BLOCK}\n`, DATE);
    expect(scheduledTasks).toHaveLength(1);
    expect(scheduledTasks[0].obsidianRawTitle).toBe('Alpha');
    expect(scheduledTasks[0].completedAt).toBe('2026-09-02');
    expect(scheduledTasks[0].obsidianBlockId).toBe(BLOCK);
  });

  it('both formats read back regardless of any plugin detection state', () => {
    const { scheduledTasks } = parseTasksFromMarkdown(
      `- [x] ${DATE} Alpha [completed:: ${ISO_LOCAL}] ^dg-${BLOCK}\n- [x] ${DATE} Beta ✅ 2026-09-01 ^dg-bbbb2222\n`, DATE);
    expect(scheduledTasks.map((t) => t.completedAt)).toEqual([ISO_LOCAL, '2026-09-01']);
    expect(scheduledTasks.map((t) => t.obsidianRawTitle)).toEqual(['Alpha', 'Beta']);
  });

  it('a marker on an UNCHECKED tagged line is stripped (invariant: tagged titles are marker-free) but yields no completedAt', () => {
    const { scheduledTasks } = parseTasksFromMarkdown(
      `- [ ] ${DATE} Alpha ✅ 2026-09-02 ^dg-${BLOCK}\n`, DATE);
    expect(scheduledTasks[0].obsidianRawTitle).toBe('Alpha');
    expect(scheduledTasks[0].completedAt).toBeUndefined();
  });

  it('UNTAGGED line stays byte-frozen: a hand-written marker is title text and part of the legacy identity', () => {
    const raw = 'Alpha ✅ 2026-08-10';
    const { scheduledTasks } = parseTasksFromMarkdown(`- [x] ${DATE} ${raw}\n`, DATE);
    expect(scheduledTasks[0].obsidianRawTitle).toBe(raw);
    expect(scheduledTasks[0].completedAt).toBeUndefined();
    expect(scheduledTasks[0].id).toBe(legacyObsidianId(DATE, raw));
  });

  it('the marker never perturbs identity: with and without it, a tagged line parses to the same id and rawTitle', () => {
    const withMarker = parseTasksFromMarkdown(`- [x] Alpha ✅ 2026-09-02 ^dg-${BLOCK}\n`, DATE);
    const without = parseTasksFromMarkdown(`- [x] Alpha ^dg-${BLOCK}\n`, DATE);
    expect(withMarker.inboxTasks[0].id).toBe(without.inboxTasks[0].id);
    expect(withMarker.inboxTasks[0].obsidianRawTitle).toBe(without.inboxTasks[0].obsidianRawTitle);
    expect(deriveBlockId(DATE, withMarker.inboxTasks[0].obsidianRawTitle))
      .toBe(deriveBlockId(DATE, without.inboxTasks[0].obsidianRawTitle));
  });
});
