import { useState, useEffect } from 'react';

// Hook to detect device type using touch-primary detection + viewport width.
// Touch-primary (pointer: coarse + hover: none) distinguishes tablets from
// small desktop/laptop screens that happen to be under 1200px wide.
const useDeviceType = () => {
  const compute = () => {
    if (typeof window === 'undefined') return { isPhone: false, isMobile: false, isTablet: false };
    const w = window.innerWidth;
    const touchPrimary = window.matchMedia('(pointer: coarse) and (hover: none)').matches
      || (navigator.maxTouchPoints > 0 && !window.matchMedia('(pointer: fine)').matches);
    // Use screen dimensions for phone detection — Math.min gives the
    // physical short side regardless of current orientation.
    const shortSide = Math.min(screen.width, screen.height);
    const isPhone = touchPrimary && shortSide < 600;
    const isMobile = isPhone || w < 721;
    const isTablet = !isPhone && touchPrimary && w >= 721 && w < 1200;
    return { isPhone, isMobile, isTablet };
  };

  const [device, setDevice] = useState(compute);

  useEffect(() => {
    // Use a functional update so we can return the previous state object unchanged
    // when the computed values haven't actually changed (e.g. keyboard show/hide
    // on Android adjustResize fires resize events without changing isMobile/isTablet).
    // Returning the same reference lets React bail out and avoids a full app re-render
    // on every keyboard open/close.
    const update = () => setDevice(prev => {
      const next = compute();
      if (prev.isPhone === next.isPhone && prev.isMobile === next.isMobile && prev.isTablet === next.isTablet) {
        return prev;
      }
      return next;
    });
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    // Also listen for pointer/hover changes (e.g. tablet keyboard attached/detached)
    const mq = window.matchMedia('(pointer: coarse) and (hover: none)');
    mq.addEventListener('change', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      mq.removeEventListener('change', update);
    };
  }, []);

  return device;
};

export default useDeviceType;
