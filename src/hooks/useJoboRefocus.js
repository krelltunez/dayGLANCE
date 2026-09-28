import { useCallback, useEffect, useRef, useState } from 'react';

// JOBO's "Refocus timeline", on MULTI's rules (useTimelineScroll) over JOBO's
// own scroll area: on today, the toast shows once the now line is wholly out
// of view; refocusing scrolls back smoothly, with the check held off while
// the scroll animates; and the view refocuses itself at every :00 and :30.
//
// `nowOffset` is the now line's position in the Do/Plan lanes (pixels from
// the top of the first visible hour); the lanes start below the sticky
// header, whose height `headerRef` gives. `homeTop` is the scroll position
// to return to. `enabled` is false off today, before the ledger loads (no
// scroll area yet), and when now lies outside the hours on show.
/**
 * Whether the now line is wholly out of view: above the lanes' visible top
 * (the scroll position) or below their visible bottom (the scroll area less
 * the sticky header that covers its top).
 */
export function nowLineOutOfView({ scrollTop, clientHeight, headerHeight = 0, nowOffset }) {
  return nowOffset < scrollTop || nowOffset > scrollTop + clientHeight - headerHeight;
}

export default function useJoboRefocus({ scrollRef, headerRef, enabled, nowOffset, homeTop }) {
  const [scrolledAway, setScrolledAway] = useState(false);
  const suppressRef = useRef(false);
  const live = useRef({});
  live.current = { enabled, nowOffset, homeTop };

  const check = useCallback(() => {
    const el = scrollRef.current;
    const { enabled: on, nowOffset: y } = live.current;
    if (!el || !on || !Number.isFinite(y)) { setScrolledAway(false); return; }
    if (suppressRef.current) return;
    setScrolledAway(nowLineOutOfView({
      scrollTop: el.scrollTop, clientHeight: el.clientHeight,
      headerHeight: headerRef.current?.offsetHeight || 0, nowOffset: y,
    }));
  }, [scrollRef, headerRef]);

  const refocus = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    suppressRef.current = true;
    setScrolledAway(false);
    el.scrollTo({ top: Math.max(0, live.current.homeTop), behavior: 'smooth' });
    setTimeout(() => { suppressRef.current = false; }, 600);
  }, [scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !enabled) return undefined;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { ticking = false; check(); });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    // After the opening scroll has landed.
    const initial = setTimeout(check, 200);
    return () => { el.removeEventListener('scroll', onScroll); clearTimeout(initial); };
  }, [scrollRef, enabled, check]);

  // The now line moves every minute; the view can be scrolled past it
  // without a scroll event.
  useEffect(() => { check(); }, [check, enabled, nowOffset]);

  useEffect(() => {
    if (!enabled) return undefined;
    let interval = null;
    const now = new Date();
    const min = now.getMinutes();
    const msToNext = ((min < 30 ? 30 : 60) - min) * 60000 - now.getSeconds() * 1000 - now.getMilliseconds();
    const timeout = setTimeout(() => {
      if (live.current.enabled) refocus();
      interval = setInterval(() => { if (live.current.enabled) refocus(); }, 30 * 60000);
    }, msToNext);
    return () => { clearTimeout(timeout); if (interval) clearInterval(interval); };
  }, [enabled, refocus]);

  return { scrolledAway: !!enabled && scrolledAway, refocus };
}
