import { describe, it, expect, vi } from 'vitest';
import {
  columnTimeFromEvent, dragBlockRange, anchorDragImageAtTop, DRAG_BLOCK_FALLBACK_MINUTES,
} from './dragUtils.js';

// #2277: while a task is dragged, the timeline shows the block it becomes if
// dropped now. The cursor's time is the new start (unchanged); the block runs
// for the item's own duration and is clamped exactly as the drop clamps it.

describe('dragBlockRange', () => {
  it('runs from the preview start for the item\'s duration', () => {
    expect(dragBlockRange(9 * 60, 45)).toEqual({
      startMinute: 540, endMinute: 585, startTime: '09:00', endTime: '09:45',
    });
  });

  it('clamps the start as the drop does, so the block ends by midnight', () => {
    // MULTI's drop: getTimeFromCursorPosition(e, { maxMinutes: 24 * 60, taskDuration })
    expect(dragBlockRange(23 * 60 + 30, 60)).toMatchObject({ startMinute: 23 * 60, endMinute: 24 * 60 });
    expect(dragBlockRange(-15, 30)).toMatchObject({ startMinute: 0, endMinute: 30 });
  });

  it('labels a block ending at the end of the day as midnight', () => {
    expect(dragBlockRange(23 * 60, 60)).toMatchObject({ startTime: '23:00', endTime: '00:00' });
  });

  it('clamps to a window (WEEK\'s visible hours, a DAY column)', () => {
    const win = { minMinute: 8 * 60, maxMinute: 16 * 60 };
    expect(dragBlockRange(15 * 60 + 45, 60, win)).toMatchObject({ startMinute: 15 * 60, endMinute: 16 * 60 });
    expect(dragBlockRange(7 * 60, 30, win)).toMatchObject({ startMinute: 8 * 60, endMinute: 8 * 60 + 30 });
  });

  it('an item longer than the window starts at its top and is clipped at its bottom', () => {
    expect(dragBlockRange(10 * 60, 10 * 60, { minMinute: 8 * 60, maxMinute: 16 * 60 }))
      .toMatchObject({ startMinute: 8 * 60, endMinute: 16 * 60 });
  });

  it('is a no-op on a start the column handler already clamped', () => {
    // The same handler sets the preview and computes the drop.
    const colEl = { getBoundingClientRect: () => ({ top: 0 }) };
    const opts = { startMinute: 8 * 60, hourHeight: 60, maxMinute: 16 * 60, taskDuration: 90 };
    for (const clientY of [0, 100, 410, 470, 479]) {
      const [h, m] = columnTimeFromEvent({ clientY }, colEl, opts).split(':').map(Number);
      const start = h * 60 + m;
      expect(dragBlockRange(start, 90, { minMinute: 8 * 60, maxMinute: 16 * 60 }).startMinute).toBe(start);
    }
  });

  it('draws an item with no duration at the fallback length without moving its start', () => {
    // The drop clamps such an item with a duration of 0; so does the block.
    for (const duration of [undefined, null, 0, NaN, -5]) {
      expect(dragBlockRange(23 * 60 + 45, duration)).toEqual({
        startMinute: 23 * 60 + 45, endMinute: 24 * 60, startTime: '23:45', endTime: '00:00',
      });
      expect(dragBlockRange(600, duration).endMinute).toBe(600 + DRAG_BLOCK_FALLBACK_MINUTES);
    }
  });

  it('draws nothing for a start that is not a number', () => {
    expect(dragBlockRange(NaN, 30)).toBeNull();
    expect(dragBlockRange(undefined, 30)).toBeNull();
  });
});

describe('anchorDragImageAtTop', () => {
  const card = () => ({ getBoundingClientRect: () => ({ left: 100, top: 300, width: 200, height: 80 }) });
  const dragStart = (el, over = {}) => ({
    currentTarget: el, target: el, clientX: 160, clientY: 340,
    dataTransfer: { setDragImage: vi.fn() }, ...over,
  });

  it('holds the card by its top edge, at the point it was grabbed across', () => {
    const el = card();
    const e = dragStart(el);
    expect(anchorDragImageAtTop(e)).toBe(true);
    expect(e.dataTransfer.setDragImage).toHaveBeenCalledWith(el, 60, 0);
  });

  it('keeps the horizontal offset inside the card', () => {
    const el = card();
    const e = dragStart(el, { clientX: 500 });
    anchorDragImageAtTop(e);
    expect(e.dataTransfer.setDragImage).toHaveBeenCalledWith(el, 200, 0);
  });

  it('leaves a drag of something inside the card (a link, a nested draggable) alone', () => {
    const e = dragStart(card(), { target: { tagName: 'A' } });
    expect(anchorDragImageAtTop(e)).toBe(false);
    expect(e.dataTransfer.setDragImage).not.toHaveBeenCalled();
  });

  it('is harmless without a real event or drag image support', () => {
    expect(anchorDragImageAtTop({ dataTransfer: {} })).toBe(false);
    expect(anchorDragImageAtTop(undefined)).toBe(false);
    const el = card();
    expect(anchorDragImageAtTop({ currentTarget: el, target: el, dataTransfer: {} })).toBe(false);
  });
});
