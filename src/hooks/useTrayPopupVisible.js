import { useEffect, useState } from 'react';
import { isTrayMode } from '../utils/trayMode.js';

/**
 * Whether the macOS tray popup is currently on screen, as reported by the main
 * process over `tray:visibility`.
 *
 * The main process is the authority: it owns every show/hide call site (tray
 * click, global hotkey, blur, tray:open-main), so the renderer never has to
 * infer this from document.visibilityState — whose behaviour for a hidden
 * BrowserWindow is a Chromium/platform detail rather than something this app
 * controls.
 *
 * Always false outside the tray popup. The main window is never gated on it,
 * and returning a constant keeps the value inert in that renderer.
 */
export default function useTrayPopupVisible() {
  // The popup is created hidden (main.ts createTrayWindow passes show: false),
  // so false is the correct pre-IPC value. The main process re-pushes current
  // state on did-finish-load, so a reload that lands while the popup is open
  // corrects this without waiting for the next show/hide transition.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isTrayMode) return undefined;
    if (!window.electronAPI?.onTrayVisibility) return undefined;
    return window.electronAPI.onTrayVisibility((v) => setVisible(v === true));
  }, []);

  return isTrayMode && visible;
}
