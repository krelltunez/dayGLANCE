import { useCallback, useState } from 'react';

// The desktop side panel, shown or hidden (#2407): GLANCE and the Inbox beside
// the calendar, Goals and Projects in their own space. One switch for both,
// because it is one place on the screen; Cmd/Ctrl+B and the header button.
//
// Per device, and remembered: a window on a small screen is where the panel is
// in the way, and that does not follow the user to a large one. Never synced.
//
// `enabled` is false on the tablet and the phone, whose panel and tabs are
// their layout: there the panel is never collapsed, whatever was stored.

export const SIDE_PANEL_COLLAPSED_KEY = 'day-planner-side-panel-collapsed';

export function readSidePanelCollapsed() {
  try {
    return localStorage.getItem(SIDE_PANEL_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeSidePanelCollapsed(collapsed) {
  try {
    localStorage.setItem(SIDE_PANEL_COLLAPSED_KEY, collapsed ? 'true' : 'false');
  } catch { /* storage unavailable: the choice lasts for this session */ }
}

export default function useSidePanelCollapse({ enabled }) {
  const [stored, setStored] = useState(readSidePanelCollapsed);

  const set = useCallback((next) => {
    setStored((prev) => {
      const value = typeof next === 'function' ? !!next(prev) : !!next;
      if (value !== prev) writeSidePanelCollapsed(value);
      return value;
    });
  }, []);
  const toggleSidePanel = useCallback(() => { if (enabled) set((prev) => !prev); }, [enabled, set]);
  // For anything that points at the panel (a shortcut that picks one of its
  // tabs, a jump to the Inbox): what it shows has to be on screen.
  const expandSidePanel = useCallback(() => set(false), [set]);

  return {
    sidePanelCollapsible: !!enabled,
    sidePanelCollapsed: !!enabled && stored,
    toggleSidePanel,
    expandSidePanel,
  };
}
