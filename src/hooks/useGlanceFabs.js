import { useState } from 'react';
import { readGlanceFabsCollapsed, writeGlanceFabsCollapsed } from '../utils/glanceFabs.js';

/**
 * Collapsed state for a layout's GLANCE action buttons.
 *
 * MobileLayout and DesktopLayout never render together (App picks one on
 * isMobile), so an instance per layout is not a split source of truth — they
 * read and write the same key, so whichever layout a device lands in, the
 * choice is the one it was left in. Deliberately not lifted into context: no
 * other surface needs to know, and the buttons are self-contained.
 */
export default function useGlanceFabs() {
  const [collapsed, setCollapsed] = useState(readGlanceFabsCollapsed);

  const toggle = () => setCollapsed((c) => {
    writeGlanceFabsCollapsed(!c);
    return !c;
  });

  return { collapsed, toggle };
}
