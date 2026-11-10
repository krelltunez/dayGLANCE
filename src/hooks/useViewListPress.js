import { useRef, useState } from 'react';

// The view button's two gestures, shared by the desktop and landscape-tablet
// cycler (ViewCycler) and the phone and portrait-tablet toggle
// (MobileViewToggle): a tap or click cycles to the next view, and a long press
// or a right-click opens the list of views to jump straight to one (#2347,
// #2362). The list itself is ViewMenu.
//
// A long press that opened the list swallows the click its release makes; the
// flag is reset by the next press, since a touch long press may not be
// followed by a click at all. A press that moves is a scroll or a drag, not a
// long press. A right-click is also what a touch long press fires on Android,
// and what Shift+F10 or the menu key fire on a focused button.

/** How long a press has to be held to open the view list instead of cycling. */
export const LONG_PRESS_MS = 500;
/** A press that moves further than this is a drag or a scroll, not a long press. */
const LONG_PRESS_SLOP_PX = 10;

/**
 * @returns {{
 *   buttonRef: object,
 *   menuAnchor: { left: number, top: number, bottom: number } | null,
 *   closeMenu: (opts?: { restoreFocus?: boolean }) => void,
 *   consumeClick: () => boolean,
 *   pressProps: object,
 * }}
 *   `menuAnchor` is the button's rect while the list is open, null otherwise.
 *   `consumeClick()` is true for the click that ends the long press that opened
 *   the list (the button's onClick returns early then). `pressProps` spread
 *   onto the button.
 */
export default function useViewListPress() {
  const buttonRef = useRef(null);
  const press = useRef(null); // { timer, x, y }
  const pressOpened = useRef(false);
  const [menuAnchor, setMenuAnchor] = useState(null);

  const openMenu = () => {
    const rect = buttonRef.current?.getBoundingClientRect?.();
    setMenuAnchor(rect ? { left: rect.left, top: rect.top, bottom: rect.bottom } : { left: 0, top: 0, bottom: 0 });
  };
  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  const closeMenu = ({ restoreFocus } = {}) => {
    setMenuAnchor(null);
    if (restoreFocus) buttonRef.current?.focus?.();
  };
  const consumeClick = () => {
    if (!pressOpened.current) return false;
    pressOpened.current = false;
    return true;
  };

  const pressProps = {
    onContextMenu: (e) => {
      e.preventDefault();
      cancelPress();
      openMenu();
    },
    onPointerDown: (e) => {
      pressOpened.current = false;
      if (e.button !== 0) return;
      cancelPress();
      press.current = {
        x: e.clientX,
        y: e.clientY,
        timer: setTimeout(() => {
          press.current = null;
          pressOpened.current = true;
          openMenu();
        }, LONG_PRESS_MS),
      };
    },
    onPointerMove: (e) => {
      const p = press.current;
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > LONG_PRESS_SLOP_PX) cancelPress();
    },
    onPointerUp: cancelPress,
    onPointerLeave: cancelPress,
    onPointerCancel: cancelPress,
  };

  return { buttonRef, menuAnchor, closeMenu, consumeClick, pressProps };
}
