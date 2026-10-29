import { useState, useEffect } from 'react';

// Landscape means the viewport is wider than tall AND the device itself is not
// held upright (#2258). The viewport alone is not enough: where the on-screen
// keyboard shrinks the page (a WebView-based browser such as Fulguris, whose
// window resizes for the keyboard), a phone held in portrait gets a short,
// wide viewport and the landscape blocker covered the note being typed. The
// device's own orientation does not change for the keyboard, so it vetoes that
// case. Where the browser does not report one, the viewport decides, as before.
// Requiring both also keeps a tablet's layout from flipping while it types.
export function isLandscapeNow(win = typeof window !== 'undefined' ? window : undefined) {
  if (!win) return false;
  if (!(win.innerWidth > win.innerHeight)) return false;
  const type = win.screen?.orientation?.type;
  if (typeof type === 'string') return !type.startsWith('portrait');
  // Older WebKit: window.orientation is 0 or 180 when upright.
  if (typeof win.orientation === 'number') return Math.abs(win.orientation) === 90;
  return true;
}

// Hook to detect landscape orientation
const useIsLandscape = () => {
  const [isLandscape, setIsLandscape] = useState(() => isLandscapeNow());

  useEffect(() => {
    const handleChange = () => setIsLandscape(isLandscapeNow());
    const orientation = window.screen?.orientation;
    window.addEventListener('resize', handleChange);
    window.addEventListener('orientationchange', handleChange);
    orientation?.addEventListener?.('change', handleChange);
    return () => {
      window.removeEventListener('resize', handleChange);
      window.removeEventListener('orientationchange', handleChange);
      orientation?.removeEventListener?.('change', handleChange);
    };
  }, []);

  return isLandscape;
};

export default useIsLandscape;
