import { describe, it, expect } from 'vitest';

// NORMALIZE-THEN-OBSERVE (§3.10 ruling 7) — the stamper's contract is PARSE
// PARITY: it stamps exactly the lines parseTasksFromMarkdown would import
// untagged, deriving each token from exactly the rawTitle the parse
// produces, so the plugin and the dayGLANCE-side backstop mint UNANIMOUSLY
// (deriveBlockId's whole point). The structural property pinned first is
// the one the ruling exists for: after stamping, a parse of the note
// yields NO task without a block id.

import { stampUntaggedTaskLines, planStampInsertions, parseTasksFromMarkdown } from './taskLines.js';
import { bridgeConfigAllowsStamping } from './bridgeStream.js';
import { deriveBlockId } from './identity.js';

const D = '2026-08-30';

const parseAll = (content) => {
  const { scheduledTasks, inboxTasks } = parseTasksFromMarkdown(content, D, new Set());
  return [...scheduledTasks, ...inboxTasks];
};

describe('stampUntaggedTaskLines (normalize-then-observe)', () => {
  it('THE STRUCTURAL PROPERTY: after stamping, no parsed task lacks a block id — and each token is exactly what dayGLANCE would mint for that line', () => {
    const note = [
      '# Day',
      '',
      '## Tasks',
      '- [ ] Plain inbox task',
      '- [x] 09:00-10:00 Timed and completed',
      '- [ ] 2026-09-01 All-day on another date',
      '- [ ] 2026-09-01 14:00 Date and time',
      '- [ ] With metadata 📅 2026-08-30 ⏫',
      '  - [ ] Indented checkbox line',
      '',
      'Prose that mentions - [ ] but is not a list item? No: ',
      '- not a checkbox',
    ].join('\n');

    const { text, changed, stamped } = stampUntaggedTaskLines(note, D);
    expect(changed).toBe(true);
    expect(stamped).toHaveLength(6);

    const tasks = parseAll(text);
    expect(tasks).toHaveLength(6);
    for (const t of tasks) {
      expect(t.obsidianBlockId, `unstamped after normalize: ${t.title}`).toBeTruthy();
      // UNANIMITY: the token on the line equals deriveBlockId(NOTE date,
      // the parse's own rawTitle) — the exact mint the dayGLANCE writeback
      // (stamp-on-sight backstop) would produce for this task.
      expect(t.obsidianBlockId).toBe(deriveBlockId(D, t.obsidianRawTitle));
    }
    // Idempotent: a second pass changes nothing.
    const second = stampUntaggedTaskLines(text, D);
    expect(second.changed).toBe(false);
    expect(second.text).toBe(text);
  });

  it('preserves line content byte-for-byte apart from the appended token — identity inputs untouched', () => {
    const note = '- [ ] 2026-09-01 14:00 Dentist 📅 2026-09-02 🔁 every week';
    const { text } = stampUntaggedTaskLines(note, D);
    const token = deriveBlockId(D, 'Dentist 📅 2026-09-02 🔁 every week');
    expect(text).toBe(`${note} ^dg-${token}`);
  });

  it('skips: already-tagged lines, duplicate-token lines, and lines ending in a user-authored block reference', () => {
    const tagged = '- [ ] Already tagged ^dg-abc12345';
    const dup = `- [ ] Copy one ^dg-zz999999\n- [ ] Copy one ^dg-zz999999`;
    const foreign = '- [ ] Quote source ^myref';
    expect(stampUntaggedTaskLines(tagged, D).changed).toBe(false);
    // Both duplicate-token lines textually carry a token — neither is
    // stamped; the parse's first-occurrence-wins corner stays as it is.
    expect(stampUntaggedTaskLines(dup, D).changed).toBe(false);
    expect(stampUntaggedTaskLines(foreign, D).changed).toBe(false);
  });

  it('leaves non-task lines alone and handles empty/blank content', () => {
    const note = '# Heading\n\nprose\n- plain bullet\n* [ ] star checkbox is not the format\n';
    expect(stampUntaggedTaskLines(note, D)).toEqual({ text: note, changed: false, stamped: [] });
    expect(stampUntaggedTaskLines('', D)).toEqual({ text: '', changed: false, stamped: [] });
  });

  it('PLAN ≡ STAMP (the buffer-safe write path, post-2026-08-31): applying planStampInsertions to any content reproduces stampUntaggedTaskLines byte for byte', () => {
    // The stamper is BUILT ON the planner, so this pin is the receipt that
    // the editor-transaction path (which applies the plan to a live buffer)
    // and the Vault.process path (which applies the stamper to a closed
    // file) can never write different bytes for the same input — parse
    // parity and every skip rule are inherited, not re-implemented.
    const battery = [
      '## Tasks\n- [ ] Plain line\n- [x] 09:00 Timed done   \n\t- [ ] Indented, trailing tab\t\n- [ ] Tagged stays ^dg-abc12345\n- [ ] Ref stays ^myref\nprose\n',
      '- [ ] 2026-09-01 14:00 Dated timed 📅 2026-09-02  ',
      '- [ ] Solo',
      '',
      '# No tasks at all\n',
    ];
    for (const content of battery) {
      const plan = planStampInsertions(content, D);
      const lines = content.split('\n');
      for (const p of plan) {
        expect(p.toCh).toBe(lines[p.line].length); // span ends at line end
        expect(lines[p.line].slice(p.fromCh)).toMatch(/^\s*$/); // replaces only trailing whitespace
        expect(p.insert).toBe(` ^dg-${p.blockId}`);
        lines[p.line] = lines[p.line].slice(0, p.fromCh) + p.insert;
      }
      expect(lines.join('\n')).toBe(stampUntaggedTaskLines(content, D).text);
    }
    // Skip rules come with the parity: tagged, duplicate-token, and
    // foreign-ref lines yield NO plan entries.
    expect(planStampInsertions('- [ ] a ^dg-abc12345\n- [ ] a ^dg-abc12345\n- [ ] q ^myref', D)).toEqual([]);
  });

  it('THE FAIL-CLOSED GATE: stamping is allowed ONLY on blockIdWrites === true — write gate off means no stamping, no config row seen means no stamping', () => {
    // The two commissioned negative pins, on the exact decision the plugin
    // calls. Not stamping is recoverable (the dayGLANCE backstop covers
    // it); stamping against the user's setting is not — so everything that
    // is not an explicit true refuses.
    expect(bridgeConfigAllowsStamping({ blockIdWrites: true })).toBe(true);
    expect(bridgeConfigAllowsStamping({ blockIdWrites: false })).toBe(false); // gate off
    expect(bridgeConfigAllowsStamping(null)).toBe(false); // no config row yet
    expect(bridgeConfigAllowsStamping(undefined)).toBe(false);
    expect(bridgeConfigAllowsStamping({})).toBe(false); // row from a pre-field dayGLANCE build
    expect(bridgeConfigAllowsStamping({ blockIdWrites: 'true' })).toBe(false); // merely truthy never passes
    expect(bridgeConfigAllowsStamping({ blockIdWrites: 1 })).toBe(false);
  });

  it('an untagged line with a hand-written completion marker keeps the marker inside the identity input, exactly as the parse treats it', () => {
    // On UNTAGGED lines the parse leaves a marker as title text (it strips
    // markers only on tagged lines), so the stamper must hash it too —
    // otherwise the plugin and the backstop would mint different tokens for
    // the same line.
    const note = '- [x] Done thing ✅ 2026-08-29';
    const { text } = stampUntaggedTaskLines(note, D);
    const [t] = parseAll(text);
    expect(t.obsidianBlockId).toBe(deriveBlockId(D, 'Done thing ✅ 2026-08-29'));
    expect(text).toContain(`^dg-${t.obsidianBlockId}`);
  });
});
