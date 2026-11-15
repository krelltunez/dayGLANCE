import { describe, it, expect } from 'vitest';
import { createOwnWriteRegistry, OWN_WRITE_PENDING_MAX_MS } from './obsidianOwnWrites.js';

// The line writes this device has sent to the vault and not yet seen back:
// a report showing a line as it read BEFORE such a write is not a vault edit.

const setup = () => {
  let t = 1_000_000;
  const reg = createOwnWriteRegistry(() => t);
  return { reg, tick: (ms) => { t += ms; } };
};
const task = (raw, id = 'obsidian-dg-aaaa1111') => ({ id, obsidianRawTitle: raw });

describe('createOwnWriteRegistry', () => {
  it('a report of the line as it was before our write is stale; any other text is not', () => {
    const { reg } = setup();
    reg.note('obsidian-dg-aaaa1111', 'Two', 'Two [scheduled:: 2026-09-10]');
    const existing = task('Two [scheduled:: 2026-09-10]');
    expect(reg.isStale(existing, 'Two')).toBe(true);
    expect(reg.isStale(existing, 'Two')).toBe(true); // every report until the write is seen
    expect(reg.isStale(existing, 'Two, edited in Obsidian')).toBe(false);
    expect(reg.isStale(task('Two [scheduled:: 2026-09-10]', 'another-task'), 'Two')).toBe(false);
  });

  it('the report that shows our write ends the wait: the old text is then a vault edit', () => {
    const { reg } = setup();
    reg.note('obsidian-dg-aaaa1111', 'Two', 'Two [scheduled:: 2026-09-10]');
    const existing = task('Two [scheduled:: 2026-09-10]');
    expect(reg.isStale(existing, 'Two [scheduled:: 2026-09-10]')).toBe(false);
    expect(reg.size()).toBe(0);
    // The user removed the schedule in Obsidian after our write landed.
    expect(reg.isStale(existing, 'Two')).toBe(false);
  });

  it('two writes before the first is seen: every text the line had on the way is stale', () => {
    const { reg } = setup();
    reg.note('t', 'Two', 'Two [scheduled:: 2026-09-10]');
    reg.note('t', 'Two [scheduled:: 2026-09-10]', 'Two [scheduled:: 2026-09-12]');
    const existing = task('Two [scheduled:: 2026-09-12]', 't');
    expect(reg.isStale(existing, 'Two')).toBe(true);
    expect(reg.isStale(existing, 'Two [scheduled:: 2026-09-10]')).toBe(true);
    expect(reg.isStale(existing, 'Two [scheduled:: 2026-09-12]')).toBe(false);
  });

  it('a write back to an earlier text does not leave that text marked stale', () => {
    const { reg } = setup();
    reg.note('t', 'Two', 'Two [scheduled:: 2026-09-10]');
    reg.note('t', 'Two [scheduled:: 2026-09-10]', 'Two'); // unscheduled again before either was seen
    const existing = task('Two', 't');
    expect(reg.isStale(existing, 'Two [scheduled:: 2026-09-10]')).toBe(true);
    expect(reg.isStale(existing, 'Two')).toBe(false); // that is our write, seen
  });

  it('is not waited for past ten minutes, or once the task\'s own text has moved on', () => {
    const a = setup();
    a.reg.note('t', 'Two', 'Two [scheduled:: 2026-09-10]');
    a.tick(OWN_WRITE_PENDING_MAX_MS);
    expect(a.reg.isStale(task('Two [scheduled:: 2026-09-10]', 't'), 'Two')).toBe(true);
    a.tick(1);
    expect(a.reg.isStale(task('Two [scheduled:: 2026-09-10]', 't'), 'Two')).toBe(false);
    expect(a.reg.size()).toBe(0);

    const b = setup();
    b.reg.note('t', 'Two', 'Two [scheduled:: 2026-09-10]');
    // Another device's write arrived by sync: the record is no longer about this text.
    expect(b.reg.isStale(task('Two [scheduled:: 2026-09-15]', 't'), 'Two')).toBe(false);
    expect(b.reg.size()).toBe(0);
  });

  it('follows the task to a new id', () => {
    const { reg } = setup();
    reg.note('legacy-id', 'Old title', 'New title');
    reg.rekey('legacy-id', 'obsidian-dg-bbbb2222');
    expect(reg.isStale(task('New title', 'legacy-id'), 'Old title')).toBe(false);
    expect(reg.isStale(task('New title', 'obsidian-dg-bbbb2222'), 'Old title')).toBe(true);
    reg.rekey('missing', 'x'); // nothing to move
    reg.rekey('obsidian-dg-bbbb2222', 'obsidian-dg-bbbb2222');
    expect(reg.size()).toBe(1);
  });

  it('records nothing for a write that changes no text, or without both texts', () => {
    const { reg } = setup();
    reg.note('t', 'Same', 'Same');
    reg.note('t', undefined, 'New');
    reg.note('t', 'Old', null);
    expect(reg.size()).toBe(0);
    expect(reg.isStale(null, 'x')).toBe(false);
  });
});
