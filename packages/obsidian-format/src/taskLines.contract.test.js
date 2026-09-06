// THE LINE-OWNED FIELDS CONTRACT (2026-09-06; see LINE_OWNED_TASK_FIELDS).
//
// dayGLANCE carries an Obsidian task's app-side fields across a re-parse BY
// EXCLUSION of this list, so the list must be exactly what the parser can
// emit: a key the parser emits that is NOT listed would be carried from the
// app's copy when the line meant to clear it (the new bug class the
// inversion could introduce); a listed key NO corpus line produces means the
// corpus has not learned a marker (or the list is stale) and the corpus is
// what makes the first check see anything. Equality holds both.
import { describe, it, expect } from 'vitest';
import { parseTasksFromMarkdown, LINE_OWNED_TASK_FIELDS } from './index.js';
import { TASK_LINE_CORPUS, parseCorpusEntry } from './taskLineCorpus.js';

describe('LINE_OWNED_TASK_FIELDS', () => {
  it('equals the set of keys the parser emits over the marker corpus (every emitted key listed, every listed key exercised)', () => {
    const emitted = new Set();
    const byKey = {};
    for (const entry of TASK_LINE_CORPUS) {
      const tasks = parseCorpusEntry(parseTasksFromMarkdown, entry);
      expect(tasks.length, `corpus line produced no task: ${entry.pins}`).toBeGreaterThan(0);
      for (const t of tasks) for (const k of Object.keys(t)) { emitted.add(k); (byKey[k] ??= []).push(entry.pins); }
    }
    const listed = new Set(LINE_OWNED_TASK_FIELDS);
    const unlisted = [...emitted].filter((k) => !listed.has(k)).map((k) => `${k} (from: ${byKey[k].join('; ')})`);
    const unexercised = [...listed].filter((k) => !emitted.has(k));
    expect(unlisted, 'parser emits keys LINE_OWNED_TASK_FIELDS does not list — add them beside the parser').toEqual([]);
    expect(unexercised, 'listed keys no corpus line produces — add a corpus line for the marker, or drop the stale key').toEqual([]);
  });

  it('never emits an undefined-valued key (absence is the signal the carry reads)', () => {
    for (const entry of TASK_LINE_CORPUS) {
      for (const t of parseCorpusEntry(parseTasksFromMarkdown, entry)) {
        for (const [k, v] of Object.entries(t)) expect(v, `${entry.pins}: ${k}`).not.toBeUndefined();
      }
    }
  });
});
