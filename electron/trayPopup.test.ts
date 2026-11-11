import { describe, expect, it } from 'vitest';
import { BLUR_CLICK_WINDOW_MS, isClickAfterBlurHide, popupPosition, trayTooltip } from './trayPopup';

const size = { width: 320, height: 560 };

describe('popup placement', () => {
  it('macOS: centred under the menu bar icon, flush with gap 0 (the placement before the port)', () => {
    const workArea = { x: 0, y: 24, width: 1440, height: 876 };
    const icon = { x: 1000, y: 0, width: 24, height: 24 };
    expect(popupPosition(icon, size, workArea, { gap: 0, platform: 'darwin' })).toEqual({ x: 1000 + 12 - 160, y: 24 });
  });

  it('Windows, bottom taskbar: above the icon, inside the work area', () => {
    const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
    const icon = { x: 1700, y: 1044, width: 24, height: 32 };
    const pos = popupPosition(icon, size, workArea, { gap: 8, platform: 'win32' });
    expect(pos.y).toBe(1044 - 560 - 8);
    expect(pos.x).toBe(1700 + 12 - 160);
  });

  it('clamps an icon at the screen edge so the popup never hangs off it', () => {
    const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
    const icon = { x: 1900, y: 1044, width: 20, height: 32 };
    const pos = popupPosition(icon, size, workArea, { gap: 8, platform: 'win32' });
    expect(pos.x + size.width).toBeLessThanOrEqual(1920);
  });

  it('a top taskbar on Windows opens the popup below the icon', () => {
    const workArea = { x: 0, y: 40, width: 1920, height: 1040 };
    const icon = { x: 1700, y: 4, width: 24, height: 32 };
    expect(popupPosition(icon, size, workArea, { gap: 8, platform: 'win32' }).y).toBe(4 + 32 + 8);
  });

  it('a secondary display with negative coordinates is respected', () => {
    const workArea = { x: -1920, y: 0, width: 1920, height: 1040 };
    const icon = { x: -100, y: 1044, width: 24, height: 32 };
    const pos = popupPosition(icon, size, workArea, { gap: 8, platform: 'win32' });
    expect(pos.x).toBeGreaterThanOrEqual(-1920);
    expect(pos.x + size.width).toBeLessThanOrEqual(0);
  });

  it('no icon bounds: the corner where the tray lives (top right on macOS, bottom right on Windows)', () => {
    const workArea = { x: 0, y: 25, width: 1440, height: 875 };
    expect(popupPosition(null, size, workArea, { platform: 'darwin' })).toEqual({ x: 1440 - 320 - 8, y: 25 + 8 });
    expect(popupPosition({ x: 0, y: 0, width: 0, height: 0 }, size, workArea, { platform: 'win32' }))
      .toEqual({ x: 1440 - 320 - 8, y: 25 + 875 - 560 - 8 });
  });
});

describe('the click that blurred the popup closed', () => {
  it('is ignored just after a blur-hide, so the icon toggles the popup closed', () => {
    expect(isClickAfterBlurHide(1000, 900)).toBe(true);
  });
  it('a later click, or none before, opens it', () => {
    expect(isClickAfterBlurHide(1000 + BLUR_CLICK_WINDOW_MS, 1000)).toBe(false);
    expect(isClickAfterBlurHide(1000, null)).toBe(false);
    expect(isClickAfterBlurHide(1000, 2000)).toBe(false);
  });
});

describe('the Windows tooltip', () => {
  it('carries what the macOS menu bar title would: focus countdown first, then the reminder', () => {
    expect(trayTooltip({ focusTitle: '12:30', reminderOn: true })).toBe('dayGLANCE · 12:30');
    expect(trayTooltip({ focusTitle: '', reminderOn: true })).toBe('dayGLANCE · Reminder');
    expect(trayTooltip({ focusTitle: '', reminderOn: false })).toBe('dayGLANCE');
  });
});
