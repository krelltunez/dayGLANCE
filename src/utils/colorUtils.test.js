import { describe, it, expect } from 'vitest';
import { getProjectColor, PROJECT_FALLBACK_COLOR } from './colorUtils.js';

describe('getProjectColor', () => {
  it('prefers the project own color', () => {
    expect(getProjectColor({ color: 'bg-red-500' }, { color: 'bg-green-500' })).toBe('bg-red-500');
  });

  it('falls back to the parent goal color when the project has none', () => {
    expect(getProjectColor({}, { color: 'bg-green-500' })).toBe('bg-green-500');
  });

  it('defaults to blue for standalone projects without a color', () => {
    expect(getProjectColor({}, null)).toBe(PROJECT_FALLBACK_COLOR);
    expect(getProjectColor(undefined, undefined)).toBe(PROJECT_FALLBACK_COLOR);
  });
});
