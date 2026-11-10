import { describe, expect, it } from 'vitest';
import {
  cardShowsSubtasks, cardTitleClamp, cardTitleLines, cardTitleTooltip,
  desktopCardTitleLines, desktopTitleExtraPx, mobileCardTitleLines, mobileTitleExtraPx,
  SUBTASKS_MAX_TITLE_LINES, TIMELINE_MAX_TITLE_LINES,
} from './cardTitle.js';

const subtasks = (n) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, title: `Subtask ${i + 1}` }));

describe('cardTitleLines (#2368)', () => {
  it('a short card keeps one line', () => {
    expect(cardTitleLines({ height: 30, linePx: 17.5 })).toBe(1);
    // Room for one and a half lines is still one.
    expect(cardTitleLines({ height: 8 + 30, linePx: 17.5 })).toBe(1);
  });

  it('a tall card wraps onto the lines that fit above the rows below the title', () => {
    expect(cardTitleLines({ height: 8 + 35, linePx: 17.5 })).toBe(2);
    expect(cardTitleLines({ height: 120, linePx: 17.5 })).toBe(6);
    expect(cardTitleLines({ height: 120, linePx: 17.5, belowPx: 36 })).toBe(4);
  });

  it('a card too narrow to wrap words whole keeps one line; an unmeasured one is not held back', () => {
    expect(cardTitleLines({ height: 200, linePx: 17.5, width: 130, minWidth: 180 })).toBe(1);
    expect(cardTitleLines({ height: 200, linePx: 17.5, width: 180, minWidth: 180 })).toBe(10);
    expect(cardTitleLines({ height: 200, linePx: 17.5, width: undefined, minWidth: 180 })).toBe(10);
    expect(desktopCardTitleLines({ height: 200, width: 130, hasMetaRow: false, hasTimeRow: false })).toBe(1);
    expect(mobileCardTitleLines({ height: 200, width: 120, hasProjectRow: false })).toBe(1);
    expect(mobileCardTitleLines({ height: 200, width: 160, hasProjectRow: false })).toBe(4);
  });

  it('maxLines caps the wrap', () => {
    expect(cardTitleLines({ height: 400, linePx: 17.5, maxLines: 3 })).toBe(3);
  });

  it('a height that is not a number is one line', () => {
    expect(cardTitleLines({ height: undefined, linePx: 17.5 })).toBe(1);
    expect(cardTitleLines({ height: NaN, linePx: 17.5 })).toBe(1);
  });
});

describe('the desktop and phone cards', () => {
  it('desktop: the tags/project row and the time row come off the room', () => {
    // 80px: 72 inside the padding. Alone: 4 lines; under a time row: 3; and a tags row: 2.
    expect(desktopCardTitleLines({ height: 80, hasMetaRow: false, hasTimeRow: false })).toBe(4);
    expect(desktopCardTitleLines({ height: 80, hasMetaRow: false, hasTimeRow: true })).toBe(3);
    expect(desktopCardTitleLines({ height: 80, hasMetaRow: true, hasTimeRow: true })).toBe(2);
  });

  it('a timeline card stops at four lines however tall it is', () => {
    expect(TIMELINE_MAX_TITLE_LINES).toBe(4);
    expect(desktopCardTitleLines({ height: 600, hasMetaRow: false, hasTimeRow: true })).toBe(4);
    expect(mobileCardTitleLines({ height: 600, hasProjectRow: false })).toBe(4);
    // A caller can lift the cap.
    expect(desktopCardTitleLines({ height: 600, hasMetaRow: false, hasTimeRow: true, maxLines: Infinity })).toBeGreaterThan(4);
  });

  it('phone: the project row (with the time) or, from 55px, the time row alone', () => {
    expect(mobileCardTitleLines({ height: 100, hasProjectRow: true })).toBe(3);
    expect(mobileCardTitleLines({ height: 100, hasProjectRow: false })).toBe(3);
    expect(mobileCardTitleLines({ height: 50, hasProjectRow: false })).toBe(2);
  });
});

describe('a card that lists subtasks', () => {
  // Desktop: the subtask fit reserves 48px at 120px (padding, title row, time
  // row); a second title line adds 13px. Each subtask row is 18px, after a 4px gap.
  it('desktop: two lines when every subtask still fits under them', () => {
    expect(SUBTASKS_MAX_TITLE_LINES).toBe(2);
    expect(desktopTitleExtraPx(2)).toBe(13);
    // 120px: room for 3 rows under a two-line title, so 2 subtasks fit.
    expect(desktopCardTitleLines({ height: 120, hasMetaRow: false, hasTimeRow: true, subtasks: subtasks(2) })).toBe(2);
    // Never more than two, however tall.
    expect(desktopCardTitleLines({ height: 600, hasMetaRow: false, hasTimeRow: true, subtasks: subtasks(2) })).toBe(2);
  });

  it('desktop: one line when the second would push a subtask out of sight', () => {
    // 120px holds 3 rows under two lines: 5 subtasks do not all fit.
    expect(desktopCardTitleLines({ height: 120, hasMetaRow: false, hasTimeRow: true, subtasks: subtasks(5) })).toBe(1);
    // 100px: both fit under one line (2 rows), only one under two lines.
    expect(desktopCardTitleLines({ height: 100, hasMetaRow: false, hasTimeRow: true, subtasks: subtasks(2) })).toBe(1);
  });

  it('subtasks without a title are not listed, so they do not count', () => {
    const list = [...subtasks(2), { id: 'blank', title: '  ' }, null];
    expect(desktopCardTitleLines({ height: 120, hasMetaRow: false, hasTimeRow: true, subtasks: list })).toBe(2);
  });

  it('phone: the same rule with its own rows (a second line adds 18px)', () => {
    expect(mobileTitleExtraPx(2)).toBe(18);
    expect(mobileCardTitleLines({ height: 110, hasProjectRow: false, subtasks: subtasks(2) })).toBe(2);
    expect(mobileCardTitleLines({ height: 100, hasProjectRow: false, subtasks: subtasks(2) })).toBe(1);
    expect(mobileCardTitleLines({ height: 600, hasProjectRow: false, subtasks: subtasks(2) })).toBe(2);
  });

  it('a short or narrow card keeps one line, subtasks or not', () => {
    expect(desktopCardTitleLines({ height: 40, hasMetaRow: false, hasTimeRow: false, subtasks: subtasks(1) })).toBe(1);
    expect(desktopCardTitleLines({ height: 400, width: 130, hasMetaRow: false, hasTimeRow: true, subtasks: subtasks(1) })).toBe(1);
  });
});

describe('cardShowsSubtasks', () => {
  it('needs the setting on and a subtask with a title', () => {
    const task = { subtasks: [{ id: 's', title: 'Buy nails' }] };
    expect(cardShowsSubtasks(task, true)).toBe(true);
    expect(cardShowsSubtasks(task, undefined)).toBe(true);
    expect(cardShowsSubtasks(task, false)).toBe(false);
    expect(cardShowsSubtasks({ subtasks: [{ id: 's', title: '  ' }] }, true)).toBe(false);
    expect(cardShowsSubtasks({ subtasks: [] }, true)).toBe(false);
    expect(cardShowsSubtasks({}, true)).toBe(false);
  });
});

describe('cardTitleClamp', () => {
  it('one line is the ellipsis; more is a line clamp; Infinity only wraps', () => {
    expect(cardTitleClamp(1)).toEqual({ className: 'truncate', style: undefined });
    const three = cardTitleClamp(3);
    expect(three.className).not.toContain('truncate');
    expect(three.style).toMatchObject({ display: '-webkit-box', WebkitLineClamp: 3, overflow: 'hidden' });
    const all = cardTitleClamp(Infinity);
    expect(all.className).not.toContain('truncate');
    expect(all.style).not.toHaveProperty('WebkitLineClamp');
  });
});

describe('cardTitleTooltip', () => {
  it('is the full title, with the hint on a second line when there is one', () => {
    expect(cardTitleTooltip('Call the roofer about the leak #home')).toBe('Call the roofer about the leak #home');
    expect(cardTitleTooltip('Call the roofer', 'Double-click to rename')).toBe('Call the roofer\nDouble-click to rename');
  });

  it('reads like the card: a wikilink is the task\'s note, not its words, unless it is the whole title', () => {
    expect(cardTitleTooltip('Read [[Roof notes|the notes]]')).toBe('Read');
    expect(cardTitleTooltip('[[Roof notes|the notes]]')).toBe('the notes');
  });

  it('is nothing for an empty title', () => {
    expect(cardTitleTooltip('')).toBeUndefined();
    expect(cardTitleTooltip(undefined, null)).toBeUndefined();
  });
});
