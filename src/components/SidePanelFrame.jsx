import React from 'react';

export const SIDE_PANEL_WIDTH = 340;

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
export default function SidePanelFrame({ collapsed = false, children }) {
  return (
    <div
      data-side-panel-frame={collapsed ? 'collapsed' : 'open'}
      className="flex-shrink-0"
      style={collapsed
        ? { width: 0, height: '100%', overflow: 'hidden', visibility: 'hidden' }
        : { width: SIDE_PANEL_WIDTH, height: '100%' }}
      aria-hidden={collapsed || undefined}
      inert={collapsed ? '' : undefined}
    >
      {children}
    </div>
  );
}
