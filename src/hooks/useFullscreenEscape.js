import { useEffect } from 'react';

// Escape exits native macOS (green-button) fullscreen. macOS/Electron don't do
// this by default, so users who enter fullscreen expect ESC to work and find
// only the green button / Ctrl+Cmd+F do.
//
// The listener is on `window`, in the bubble phase: document-level handlers
// (useModalClose, popover closers, …) run first, so an Escape that closed a
// modal arrives here already defaultPrevented and is ignored — one press closes
// the modal, a second press leaves fullscreen. Handlers that stopPropagation()
// keep the event from reaching window at all, which has the same effect.
// Escape inside a text field means "cancel editing", never "leave fullscreen".
// The main process no-ops unless its window is actually fullscreen, so this can
// fire unconditionally otherwise (and is harmless in the tray popup).
export default function useFullscreenEscape() {
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.isElectron || typeof api.exitFullscreen !== 'function') return undefined;

    const onKeyDown = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      api.exitFullscreen();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
