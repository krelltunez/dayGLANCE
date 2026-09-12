import { describe, it, expect } from 'vitest';
import { monthCellMetrics } from './monthCellMetrics.js';
import { MONTH_CELL_LAYOUT } from '../constants/monthView.js';

const C = MONTH_CELL_LAYOUT.cell;

describe('monthCellMetrics', () => {
  it('scales the gutter and its marks with the cell instead of fixing them', () => {
    const small = monthCellMetrics(96, 120);
    const big = monthCellMetrics(200, 200);
    expect(small.gutterWidth).toBe(12);
    expect(big.gutterWidth).toBe(26);
    expect(big.markerSize).toBeGreaterThan(small.markerSize);
    expect(big.inset).toBeGreaterThan(small.inset);
    expect(big.headerHeight).toBeGreaterThan(small.headerHeight);
  });

  it('drops the gutter below the width threshold and puts the marks in the header instead', () => {
    const phone = monthCellMetrics(53, 96);
    expect(phone.gutterWidth).toBe(0);
    expect(phone.hasGutter).toBe(false);
    expect(phone.markerSize).toBeGreaterThanOrEqual(C.headerMarker.min);
    expect(monthCellMetrics(C.gutterMinWidth, 120).hasGutter).toBe(true);
    expect(monthCellMetrics(C.gutterMinWidth - 1, 120).hasGutter).toBe(false);
  });

  it('honours an explicit gutter override', () => {
    expect(monthCellMetrics(160, 140, { gutter: 0 }).gutterWidth).toBe(0);
    expect(monthCellMetrics(60, 100, { gutter: 12 }).gutterWidth).toBe(12);
  });

  it('keeps every value inside its clamp', () => {
    for (const [w, h] of [[30, 40], [53, 96], [96, 120], [160, 140], [200, 200], [400, 400]]) {
      const m = monthCellMetrics(w, h);
      expect(m.headerHeight).toBeGreaterThanOrEqual(C.header.min);
      expect(m.headerHeight).toBeLessThanOrEqual(C.header.max);
      expect(m.inset).toBeGreaterThanOrEqual(C.inset.min);
      expect(m.inset).toBeLessThanOrEqual(C.inset.max);
      expect(m.pointSize).toBeGreaterThanOrEqual(C.point.min);
      expect(m.radius).toBeLessThanOrEqual(C.radius.max);
      expect(m.timelineWidth + m.gutterWidth + 2 * m.inset).toBe(w);
      expect(m.timelineTop + m.timelineHeight + m.padY).toBe(h);
    }
  });
});
