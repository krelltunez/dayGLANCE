// THE LINE-OWNED FIELDS CONTRACT, app side (2026-09-06; the field-finding
// record in docs/obsidian-buildout-spec.md, Phase 7).
//
// The app carries an Obsidian task's fields across a re-parse BY EXCLUSION
// of the line-owned set (utils/mergeObsidianTasks.js
// preserveObsidianAppFields): everything the line does not own survives
// untouched, and a line-owned key is whatever the line and the per-field
// ownership rulings say. Three shapes hold that up, and they are the
// durable part of the change, not verification of it:
//
//  1. THE KEY CONTRACT — the parser PLUS the per-note merge, over the marker
//     corpus, emit exactly the app's line-owned set. The parser's own copy
//     of this contract (taskLines.contract.test.js) covers its keys; this
//     one adds the two the per-note merge contributes. The corpus is the
//     parser's fixture (taskLineCorpus.js), so a marker's line joins it
//     where the marker is added — the mechanism's own dependency.
//  2. REMOVAL — one test per line-owned key with clearing semantics: a
//     line-owned key ABSENT from the scan is cleared (or, for the
//     null-on-removal fields, nulled), never carried. This is the bug class
//     the inversion could have introduced, pinned shut.
//  3. THE PROPERTY — a made-up future field survives a re-parse. This is
//     the test that proves the inversion actually inverted.
import { describe, it, expect } from 'vitest';
import { parseTasksFromMarkdown } from '@glance-apps/obsidian-format';
import { TASK_LINE_CORPUS, DAILY_NOTE_DATE, parseCorpusEntry } from '@glance-apps/obsidian-format/src/taskLineCorpus.js';
import { buildExistingObsidianTaskContext, mergeParsedObsidianTasks } from './obsidian.js';
import { mergeObsidianTasks, preserveObsidianAppFields, APP_LINE_OWNED_TASK_FIELDS } from './utils/mergeObsidianTasks.js';

const resolveProject = (ref) => (/Home/.test(String(ref)) ? 'p-home' : null);

/** The per-note merge over one corpus entry (or a bare line), against the given existing lists. */
function perNoteMerge(entryOrLine, tasks = [], inbox = []) {
  const entry = typeof entryOrLine === 'string' ? { line: entryOrLine } : entryOrLine;
  const ctx = buildExistingObsidianTaskContext(tasks, inbox);
  ctx.resolveProject = resolveProject;
  const out = { allScheduled: [], allInbox: [], lineSchedule: {} };
  const opts = {};
  if (entry.notePath) opts.notePath = entry.notePath;
  if (entry.completedSince) opts.completedSince = entry.completedSince;
  mergeParsedObsidianTasks(parseTasksFromMarkdown(`# Tasks\n${entry.line}\n`, DAILY_NOTE_DATE, new Set(), opts), ctx, null, out);
  return out;
}

/** The whole inbound pass as the hook runs it: per-note merge, then the list merge with the app's carry. */
function inbound(line, tasks = [], inbox = []) {
  const out = perNoteMerge(line, tasks, inbox);
  const scannedIds = new Set([...out.allScheduled, ...out.allInbox].map((t) => String(t.id)));
  return {
    tasks: mergeObsidianTasks(tasks, out.allScheduled, scannedIds, preserveObsidianAppFields),
    inbox: mergeObsidianTasks(inbox, out.allInbox, scannedIds, preserveObsidianAppFields),
  };
}
const only = (r) => { const all = [...r.tasks, ...r.inbox]; expect(all).toHaveLength(1); return all[0]; };
const plain = (t) => JSON.parse(JSON.stringify(t));
/** Import a line fresh, returning the app's stored copy of it. */
const imported = (line) => plain(only(inbound(line)));

describe('1. the key contract: parser + per-note merge emit exactly the app line-owned set', () => {
  it('over the marker corpus, against a first import and against an existing copy', () => {
    const emitted = new Set();
    for (const entry of TASK_LINE_CORPUS) {
      expect(parseCorpusEntry(parseTasksFromMarkdown, entry).length, entry.pins).toBeGreaterThan(0);
      const fresh = perNoteMerge(entry);
      const freshTasks = [...fresh.allScheduled, ...fresh.allInbox];
      for (const t of freshTasks) for (const k of Object.keys(t)) emitted.add(k);
      // Against its own import (the everyday case: an unchanged line re-parsed).
      const again = perNoteMerge(entry, fresh.allScheduled.map(plain), fresh.allInbox.map(plain));
      for (const t of [...again.allScheduled, ...again.allInbox]) for (const k of Object.keys(t)) emitted.add(k);
    }
    const listed = new Set(APP_LINE_OWNED_TASK_FIELDS);
    expect([...emitted].filter((k) => !listed.has(k)), 'emitted but not listed').toEqual([]);
    expect([...listed].filter((k) => !emitted.has(k)), 'listed but no corpus line produces it').toEqual([]);
  });
});

describe('2. removal: a line-owned key absent from the scan is cleared, never carried', () => {
  it('an un-scheduled line (⏳ removed) clears date, startTime and isAllDay: the inbox copy carries none of them', () => {
    const stored = imported('- [ ] Call the plumber ⏳ 2026-09-08 ^dg-8w230vhc');
    expect(stored.date).toBe('2026-09-08');
    const after = inbound('- [ ] Call the plumber ^dg-8w230vhc', [stored], []);
    expect(after.tasks).toHaveLength(0);
    const inboxCopy = plain(after.inbox[0]);
    expect(inboxCopy).not.toHaveProperty('date');
    expect(inboxCopy).not.toHaveProperty('startTime');
    expect(inboxCopy).not.toHaveProperty('isAllDay');
    // And at the carry itself, whichever list the old copy is found in.
    const carry = preserveObsidianAppFields(stored, { id: stored.id, completed: false, priority: 0 });
    for (const k of ['date', 'startTime', 'isAllDay', 'duration', 'title', 'obsidianRawTitle']) expect(carry).not.toHaveProperty(k);
  });

  it('a removed due marker (📅) nulls the deadline', () => {
    const stored = imported('- [ ] Call the plumber 📅 2026-09-10 ^dg-8w230vhc');
    expect(stored.deadline).toBe('2026-09-10');
    const after = only(inbound('- [ ] Call the plumber ^dg-8w230vhc', [], [stored]));
    expect(after.deadline).toBeNull();
  });

  it('a removed project field unassigns', () => {
    const stored = imported('- [ ] Call the plumber [project:: Home] ^dg-8w230vhc');
    expect(stored.projectId).toBe('p-home');
    const after = only(inbound('- [ ] Call the plumber ^dg-8w230vhc', [], [stored]));
    expect(after.projectId ?? null).toBeNull();
  });

  it('a stripped block token drops the block id and the legacy hint at the carry', () => {
    const stored = imported('- [ ] Call the plumber ^dg-8w230vhc');
    expect(stored.obsidianBlockId).toBe('8w230vhc');
    const untagged = { id: 'obsidian-2026-09-06-2e8nje', completed: false, priority: 0 };
    const carry = preserveObsidianAppFields(stored, untagged);
    expect(carry).not.toHaveProperty('obsidianBlockId');
    expect(carry).not.toHaveProperty('obsidianLegacyId');
    expect(carry).not.toHaveProperty('id');
  });

  it('a removed completion marker leaves the app\'s completedAt alone (app wins when it has a value)', () => {
    const stored = { ...imported('- [x] 14:00 Call the plumber ✅ 2026-09-05 ^dg-8w230vhc'), completedAt: '2026-09-05T10:00:00-06:00' };
    const after = only(inbound('- [x] 14:00 Call the plumber ^dg-8w230vhc', [stored], []));
    expect(after.completed).toBe(true);
    expect(after.completedAt).toBe('2026-09-05T10:00:00-06:00');
    // The adoption case still imports a marker the app lacks.
    const blank = imported('- [ ] 14:00 Call the plumber ^dg-8w230vhc');
    expect(blank).not.toHaveProperty('completedAt');
    const adopted = only(inbound('- [x] 14:00 Call the plumber ✅ 2026-09-06 ^dg-8w230vhc', [blank], []));
    expect(adopted.completedAt).toBe('2026-09-06');
  });
});

describe('3. the property: what the line does not own survives a re-parse', () => {
  it('a made-up future field, and the fields the audit found being wiped, all survive', () => {
    const stored = {
      ...imported('- [ ] 14:00 Call the plumber ^dg-8w230vhc'),
      zzzFutureField: { nested: true, added: 'later' },
      focusMinutes: 42,
      bucketId: 'b1',
      hyperglanceSessionDate: '2026-09-06',
      energy: 'deep',
      archived: false,
      assignedUserSyncIds: ['u1'],
    };
    const after = plain(only(inbound('- [ ] 14:00 Call the plumber ^dg-8w230vhc', [stored], [])));
    expect(after).toEqual(stored);
  });

  it('an explicitly undefined app value is not carried as a key', () => {
    const carry = preserveObsidianAppFields({ id: 'a', energy: undefined, focusMinutes: 3 }, { id: 'a' });
    expect(carry).not.toHaveProperty('energy');
    expect(carry.focusMinutes).toBe(3);
  });
});
