// The editor hiding rules (editorHidingRules.ts) are pure and pinned here;
// the decorations and CSS that act on them (editorHiding.ts) are display
// only and stay a manual check in a real editor.
import { describe, expect, it } from 'vitest';
import { isCompletedTaskLine, isCompletedTaskMarker, normalizeEditorHidingSettings, ownBlockIdSpan } from '../src/editorHidingRules';

describe('ownBlockIdSpan: only a well-formed dayGLANCE token in block-id position', () => {
  it('finds the token at the end of a task line, after whitespace', () => {
    const line = '- [ ] Review proposal ^dg-a1b2c3d4';
    const span = ownBlockIdSpan(line);
    expect(span).toEqual({ from: line.length - 12, to: line.length });
    expect(line.slice(span!.from, span!.to)).toBe('^dg-a1b2c3d4');
  });

  it('accepts a token that is the whole line', () => {
    expect(ownBlockIdSpan('^dg-00000000')).toEqual({ from: 0, to: 12 });
  });

  it("leaves a user's own block ids alone", () => {
    expect(ownBlockIdSpan('Some paragraph ^my-ref')).toBeNull();
    expect(ownBlockIdSpan('Some paragraph ^abc123')).toBeNull();
  });

  it('leaves a damaged line visible: a token mid-line, glued to text, or malformed', () => {
    // The 2026-08-31 merge corruptions: tokens spliced into the middle of a line.
    expect(ownBlockIdSpan('Test ^dg-9gbev5xzing again to see')).toBeNull();
    expect(ownBlockIdSpan('- [ ] 13: ^dg-q6wlym0v more words')).toBeNull();
    expect(ownBlockIdSpan('- [ ] glued^dg-a1b2c3d4')).toBeNull();
    expect(ownBlockIdSpan('- [ ] short ^dg-a1b2c3')).toBeNull();
    expect(ownBlockIdSpan('- [ ] upper ^dg-A1B2C3D4')).toBeNull();
    expect(ownBlockIdSpan('- [ ] trailing space ^dg-a1b2c3d4 ')).toBeNull();
  });

  it('with two tokens on one line, only the last (in position) is a candidate', () => {
    const line = '- [ ] Test ^dg-9gbev5xzing again ^dg-592baea0';
    expect(ownBlockIdSpan(line)).toEqual({ from: line.length - 12, to: line.length });
  });
});

describe('isCompletedTaskLine: the plugin grammar, checked', () => {
  it('matches x and X, with indentation', () => {
    expect(isCompletedTaskLine('- [x] done')).toBe(true);
    expect(isCompletedTaskLine('  - [X] done ^dg-a1b2c3d4')).toBe(true);
  });
  it('does not match open, other states, or non-dash lists', () => {
    expect(isCompletedTaskLine('- [ ] open')).toBe(false);
    expect(isCompletedTaskLine('- [-] cancelled')).toBe(false);
    expect(isCompletedTaskLine('- [/] partial')).toBe(false);
    expect(isCompletedTaskLine('* [x] star')).toBe(false);
    expect(isCompletedTaskLine('- [x]')).toBe(false);
    expect(isCompletedTaskLine('text - [x] not a list')).toBe(false);
  });
  it('reading view marker follows the same rule', () => {
    expect(isCompletedTaskMarker('x')).toBe(true);
    expect(isCompletedTaskMarker('X')).toBe(true);
    expect(isCompletedTaskMarker(' ')).toBe(false);
    expect(isCompletedTaskMarker('-')).toBe(false);
    expect(isCompletedTaskMarker(undefined)).toBe(false);
  });
});

describe('settings', () => {
  it('defaults: block ids hidden, completed lines shown', () => {
    expect(normalizeEditorHidingSettings(undefined)).toEqual({ hideBlockIds: true, hideCompletedInLinkedNotes: false });
    expect(normalizeEditorHidingSettings({})).toEqual({ hideBlockIds: true, hideCompletedInLinkedNotes: false });
  });
  it('keeps explicit values and ignores junk', () => {
    expect(normalizeEditorHidingSettings({ hideBlockIds: false, hideCompletedInLinkedNotes: true })).toEqual({ hideBlockIds: false, hideCompletedInLinkedNotes: true });
    expect(normalizeEditorHidingSettings({ hideBlockIds: 'yes' as unknown as boolean })).toEqual({ hideBlockIds: true, hideCompletedInLinkedNotes: false });
  });
});
