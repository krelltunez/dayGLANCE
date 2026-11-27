import { useEffect } from 'react';

// Escape closes the side panel while it floats over the calendar (the overlay
// placement, utils/desktopColumns.js). Docked, the panel is part of the layout
// and Escape leaves it alone; Cmd/Ctrl+B and the header button still toggle it.
//
// The listener is on `window`, in the bubble phase, as useFullscreenEscape's
// is: the document-level closers (useModalClose, popovers, the notes panel,
// the tag filter) run first and preventDefault, so one press closes the
// innermost thing and only a press nothing else claimed reaches the panel.
// It also stands back while:
//   - focus is in a text field, where Escape means "cancel editing" (the
//     Inbox's own field sits in the panel);
//   - a timeline range is selected, whose Escape clears it without
//     preventDefault (useTimelineSelection).
// It preventDefaults what it handles, and useFullscreenEscape skips while the
// overlay is up, so the press does not also leave macOS fullscreen.

export const SIDE_PANEL_OVERLAY_SELECTOR = '[data-side-panel-frame="overlay"]';

export function overlayEscapeApplies(e, doc = typeof document !== 'undefined' ? document : null) {
  if (e.key !== 'Escape' || e.defaultPrevented) return false;
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return false;
  if (doc?.querySelector?.('[data-timeline-selection]')) return false;
  return true;
}

export default function useSidePanelOverlayEscape({ active, close }) {
  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (e) => {
      if (!overlayEscapeApplies(e)) return;
      e.preventDefault();
      close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, close]);
}
