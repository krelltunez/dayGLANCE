import { useEffect } from 'react';
import { isTrayMode } from '../utils/trayMode.js';
import { loadAmbientPrefs } from '../utils/dialPrefs.js';

// The true screensaver: after the configured idle delay anywhere in the
// planner, open the Day Dial directly in ambient mode. Opt-in twice over
// (Auto ambient + "also from planner", set in the dial's Layers panel).
//
// The dial merely overlays the planner — nothing underneath is torn down —
// so exiting ambient lands the user exactly where they were, which is why
// this doesn't need to know about the planner's dozens of modals. Prefs
// are read fresh from storage on each check, so a toggle flipped in the
// dial takes effect with no state plumbing. Never runs in the tray popup.
export default function useAmbientScreensaver({ showDayDialRef, setShowDayDial }) {
  useEffect(() => {
    if (isTrayMode || typeof window === 'undefined') return undefined;

    let lastActive = Date.now();
    const stamp = () => { lastActive = Date.now(); };
    const events = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'];
    events.forEach((ev) => window.addEventListener(ev, stamp, { passive: true }));

    const interval = setInterval(() => {
      const prefs = loadAmbientPrefs();
      if (!prefs.auto || !prefs.fromPlanner) return;
      if (showDayDialRef.current) return; // dial open — it runs its own idle clock
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastActive >= prefs.delayMin * 60_000) {
        setShowDayDial('ambient');
      }
    }, 30_000);

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, stamp));
      clearInterval(interval);
    };
    // Setter and ref are stable; mount-once by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
