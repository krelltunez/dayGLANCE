import React from 'react';

import { SIDE_PANEL_WIDTH } from '../utils/desktopColumns.js';

export { SIDE_PANEL_WIDTH };

// The slot a desktop side panel sits in, which closes to nothing (#2407).
//
// The panel inside keeps its own width and stays mounted and laid out, so what
// it held (scroll position, the open tab, a half-typed task) is there when it
// comes back; display:none would reset the scroll. Collapsed, the slot is zero
// wide and clips it, and the panel is out of sight, focus and the
// accessibility tree: `visibility` hides what `overflow` cannot reach (a
// fixed-position popover), `inert` takes the rest (React 18 wants the
// attribute as a string).
//
// Expanded, the slot adds nothing but its width: no overflow rule, so the
// panel's popovers may still reach past its edge.
//
// Overlaid (`overlay`), the slot leaves the row and floats over the start of
// what follows it, at the same width: the calendar keeps the whole window's
// layout on a laptop where the view on screen needs it (utils/desktopColumns.js).
// It sits above the timeline's own layers (z-30) and below its popovers (z-50).
const OVERLAY_STYLE = {
  position: 'absolute', top: 0, bottom: 0, left: 0, zIndex: 40,
  width: SIDE_PANEL_WIDTH, boxShadow: '4px 0 16px rgba(0, 0, 0, 0.18)',
};

export default function SidePanelFrame({ collapsed = false, overlay = false, children }) {
  return (
    <div
      data-side-panel-frame={collapsed ? 'collapsed' : overlay ? 'overlay' : 'open'}
      className="flex-shrink-0"
      style={collapsed
        ? { width: 0, height: '100%', overflow: 'hidden', visibility: 'hidden' }
        : overlay ? OVERLAY_STYLE
        : { width: SIDE_PANEL_WIDTH, height: '100%' }}
      aria-hidden={collapsed || undefined}
      inert={collapsed ? '' : undefined}
    >
      {children}
    </div>
  );
}
