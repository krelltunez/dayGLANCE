import { describe, it, expect } from 'vitest';
import {
  parseTasksFromMarkdown,
  deriveBlockId,
  dgFrontmatter, hasFrontmatter, withCreationFrontmatter,
} from './index.js';

// FRONTMATTER GRAMMAR PINS, beside the code they pin (moved from dayGLANCE's
// obsidian.frontmatter.test.js in the format-package extraction). The
// creation-only EMISSION premises exercise the transports and stay in
// dayGLANCE.

const DATE = '2026-09-01';
const FM = 'aaaa1111';

describe('the never-emit-a-task-line rule (tested, not observed)', () => {
  it("dayGLANCE's own emitted frontmatter parses to ZERO tasks through the real parser", () => {
    // The pin the field set must never break: run the emitted block through
    // the actual task parser. A future field addition whose value renders as
    // a task-shaped line fails here.
    const { scheduledTasks, inboxTasks } = parseTasksFromMarkdown(dgFrontmatter('2026-09-01'), DATE);
    expect(scheduledTasks).toEqual([]);
    expect(inboxTasks).toEqual([]);
  });

  it('canary: WHY the rule exists — the parser has no --- awareness, so a task-shaped line inside YAML WOULD parse', () => {
    // Documents the hazard the rule guards against, on every client version.
    // If this ever fails, the parser grew frontmatter awareness and the rule
    // (and this file's premises) should be revisited.
    const evil = '---\nnotes:\n- [ ] looks like a task\n---\n';
    const { inboxTasks } = parseTasksFromMarkdown(evil, DATE);
    expect(inboxTasks).toHaveLength(1);
  });
});

describe('the v4.7.0 parser premise (the pure half)', () => {
  it('the task parser skips frontmatter lines — same tasks, same identities, with or without the block', () => {
    const body = `## Tasks\n- [ ] Alpha ^dg-${FM}\n- [ ] Beta\n`;
    const bare = parseTasksFromMarkdown(body, DATE);
    const fronted = parseTasksFromMarkdown(`---\ntitle: My day\n---\n${body}`, DATE);
    expect(fronted.scheduledTasks.map((t) => t.id)).toEqual(bare.scheduledTasks.map((t) => t.id));
    expect(fronted.inboxTasks.map((t) => t.id)).toEqual(bare.inboxTasks.map((t) => t.id));
  });
});

describe('helpers', () => {
  it('hasFrontmatter / withCreationFrontmatter basics', () => {
    expect(hasFrontmatter('---\nx: 1\n---\n')).toBe(true);
    expect(hasFrontmatter('body')).toBe(false);
    expect(hasFrontmatter('')).toBe(false);
    expect(withCreationFrontmatter('body', '2026-09-01')).toBe('---\ncreated: 2026-09-01\nsource: dayGLANCE\n---\nbody');
    expect(withCreationFrontmatter('---\nmine\n---\n', '2026-09-01')).toBe('---\nmine\n---\n');
  });

  it('frontmatter presence does not perturb deterministic block-id derivation inputs', () => {
    // Belt and braces: derivation reads (date, rawTitle) only — a frontmatter
    // block in the file cannot reach it. Same tokens either way.
    const { scheduledTasks } = parseTasksFromMarkdown(`---\nx: 1\n---\n## Tasks\n- [ ] Gamma\n`, DATE);
    expect(deriveBlockId(DATE, scheduledTasks[0]?.obsidianRawTitle ?? 'Gamma')).toBe(deriveBlockId(DATE, 'Gamma'));
  });
});
