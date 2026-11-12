// Where the tray popup goes, and when a tray click is the tail of the click
// that just dismissed it. Pure, tested without Electron (trayPopup.test.ts);
// main.ts applies them. The placement rule is lastGLANCE's (its
// electron/trayModel.ts popupPosition), so the two GLANCE apps' popups sit the
// same way on both platforms.

export interface Rect { x: number; y: number; width: number; height: number }

/**
 * Place a popup of `size` against the tray icon's bounds. An icon in the top
 * half of its display (the macOS menu bar, a top taskbar) gets the popup below
 * it; one in the bottom half (the default Windows taskbar) gets it above. The
 * result is clamped inside the work area, so a popup never hangs off an edge
 * or under the taskbar. With no usable icon bounds (a menu bar item that
 * failed to render, a hotkey with no icon) it sits in the corner of the work
 * area nearest where the tray lives: top right on macOS, bottom right on
 * Windows.
 */
export function popupPosition(
  icon: Rect | null | undefined,
  size: { width: number; height: number },
  workArea: Rect,
  opts: { gap?: number; platform?: NodeJS.Platform } = {},
): { x: number; y: number } {
  const gap = opts.gap ?? 6;
  const margin = 8;
  const clampX = (x: number) => Math.min(Math.max(x, workArea.x + margin), workArea.x + workArea.width - size.width - margin);
  // Vertically only the work area itself: the popup sits against the bar the
  // icon is in (flush under the macOS menu bar, as it always has).
  const clampY = (y: number) => Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - size.height);
  if (!icon || icon.width <= 0 || icon.height <= 0) {
    const x = workArea.x + workArea.width - size.width - margin;
    const y = opts.platform === 'win32'
      ? workArea.y + workArea.height - size.height - margin
      : workArea.y + margin;
    return { x: Math.round(x), y: Math.round(y) };
  }
  const below = icon.y + icon.height / 2 < workArea.y + workArea.height / 2;
  const x = Math.round(icon.x + icon.width / 2 - size.width / 2);
  const y = Math.round(below ? icon.y + icon.height + gap : icon.y - size.height - gap);
  return { x: clampX(x), y: clampY(y) };
}

/**
 * On Windows a click on the tray icon while the popup is open first takes
 * focus from the popup (blur hides it), and only then delivers the click,
 * which would find the popup hidden and show it again: the icon could never
 * close its own popup. A click this soon after a blur-hide is that same click,
 * so it leaves the popup closed.
 */
export const BLUR_CLICK_WINDOW_MS = 300;

export function isClickAfterBlurHide(now: number, lastBlurHideAt: number | null): boolean {
  return lastBlurHideAt != null && now - lastBlurHideAt >= 0 && now - lastBlurHideAt < BLUR_CLICK_WINDOW_MS;
}

/**
 * The tray tooltip. macOS shows the focus countdown and the reminder dot as
 * the menu bar title (Tray.setTitle); Windows has no tray title, so the same
 * information goes in the tooltip.
 */
export function trayTooltip(parts: { focusTitle: string; reminderOn: boolean; reminderLabel?: string }): string {
  if (parts.focusTitle) return `dayGLANCE · ${parts.focusTitle}`;
  if (parts.reminderOn) return `dayGLANCE · ${parts.reminderLabel ?? 'Reminder'}`;
  return 'dayGLANCE';
}

/**
 * The Windows tray icon's sizes, one per display scale from 100% to 300%
 * (electron/resources/tray/tray-<px>.png, scripts/gen-tray-icons.mjs).
 */
export const WINDOWS_TRAY_SCALES: ReadonlyArray<readonly [scaleFactor: number, px: number]> = [
  [1, 16], [1.25, 20], [1.5, 24], [2, 32], [2.5, 40], [3, 48],
];
