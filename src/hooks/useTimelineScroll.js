import { useState, useRef, useCallback, useEffect } from 'react';
import { dateToString } from '../utils/taskUtils.js';

export default function useTimelineScroll({
  calendarRef, timeGridRef,
  selectedDate,
  isMobile, isTablet,
  mobileActiveTab,
}) {
  const [timelineScrolledAway, setTimelineScrolledAway] = useState(false);
  const suppressScrollAwayRef = useRef(false);

  // Scroll timeline to start of current hour on date change / tab switch
  const scrollToCurrentHour = useCallback((smooth = false) => {
    const currentHour = new Date().getHours();
    const hourHeight = timeGridRef.current?.children?.[1]?.offsetHeight || 161;
    const scrollPosition = Math.max(0, currentHour * hourHeight);
    if (calendarRef.current) {
      if (smooth) {
        // Suppress scroll-away detection during the smooth scroll animation
        suppressScrollAwayRef.current = true;
        calendarRef.current.scrollTo({ top: scrollPosition, behavior: 'smooth' });
        // Re-enable after animation completes (smooth scroll typically takes ~300-500ms)
        setTimeout(() => { suppressScrollAwayRef.current = false; }, 600);
      } else {
        calendarRef.current.scrollTop = scrollPosition;
      }
    }
  }, []);

  // Scroll timeline to a specific time string (e.g. "08:00")
  const scrollToHour = useCallback((timeStr, smooth = false) => {
    const [h, m] = timeStr.split(':').map(Number);
    const hourHeight = timeGridRef.current?.children?.[1]?.offsetHeight || 161;
    const scrollPosition = Math.max(0, (h + m / 60) * hourHeight);
    if (calendarRef.current) {
      if (smooth) {
        calendarRef.current.scrollTo({ top: scrollPosition, behavior: 'smooth' });
      } else {
        calendarRef.current.scrollTop = scrollPosition;
      }
    }
  }, []);

  useEffect(() => {
    const isToday = dateToString(selectedDate) === dateToString(new Date());
    if (isToday && calendarRef.current && (!isMobile || mobileActiveTab === 'timeline')) {
      setTimeout(() => scrollToCurrentHour(false), 100);
    }
  }, [selectedDate, isMobile, mobileActiveTab, scrollToCurrentHour]);

  // Detect when user scrolls away from current time (all form factors)
  useEffect(() => {
    // On mobile, only track when on timeline tab
    if (isMobile && mobileActiveTab !== 'timeline') { setTimelineScrolledAway(false); return; }
    const isToday = dateToString(selectedDate) === dateToString(new Date());
    if (!isToday) { setTimelineScrolledAway(false); return; }
    const el = calendarRef.current;
    if (!el) return;
    let ticking = false;
    const onScroll = () => {
      if (ticking || suppressScrollAwayRef.current) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        if (suppressScrollAwayRef.current) return;
        const now = new Date();
        const hourHeight = timeGridRef.current?.children?.[1]?.offsetHeight || 161;
        const nowPos = (now.getHours() + now.getMinutes() / 60) * hourHeight;
        const viewTop = el.scrollTop;
        const viewBottom = viewTop + el.clientHeight;
        // Consider "scrolled away" when the current time line is fully outside the visible area
        setTimelineScrolledAway(nowPos < viewTop || nowPos > viewBottom);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    // Delay initial check so the scroll-to-current-hour effect (100ms timeout) runs first
    const initialCheckTimer = setTimeout(onScroll, 200);
    return () => { el.removeEventListener('scroll', onScroll); clearTimeout(initialCheckTimer); };
  }, [isMobile, isTablet, selectedDate, mobileActiveTab]);

  // Auto-refocus timeline every 30 minutes on tablet and desktop
  useEffect(() => {
    if (isMobile) return;
    let intervalId = null;
    const now = new Date();
    // Calculate ms until next :00 or :30
    const min = now.getMinutes();
    const sec = now.getSeconds();
    const msToNext = ((min < 30 ? 30 : 60) - min) * 60000 - sec * 1000 - now.getMilliseconds();
    const timeoutId = setTimeout(() => {
      const isToday = dateToString(selectedDate) === dateToString(new Date());
      if (isToday && calendarRef.current) { setTimelineScrolledAway(false); scrollToCurrentHour(true); }
      // After the first aligned fire, set a regular 30-minute interval
      intervalId = setInterval(() => {
        const isTodayNow = dateToString(selectedDate) === dateToString(new Date());
        if (isTodayNow && calendarRef.current) { setTimelineScrolledAway(false); scrollToCurrentHour(true); }
      }, 30 * 60000);
    }, msToNext);
    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [isMobile, selectedDate, scrollToCurrentHour]);

  return { timelineScrolledAway, setTimelineScrolledAway, scrollToCurrentHour, scrollToHour };
}
