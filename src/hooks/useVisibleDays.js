import { useState, useEffect } from 'react';

// Hook to determine how many days to show based on window width
const useVisibleDays = () => {
  const [visibleDays, setVisibleDays] = useState(() => {
    if (typeof window !== 'undefined') {
      if (window.innerWidth >= 1600) return 3;
      if (window.innerWidth >= 1200) return 2;
    }
    return 1;
  });

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1600) setVisibleDays(3);
      else if (window.innerWidth >= 1200) setVisibleDays(2);
      else setVisibleDays(1);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return visibleDays;
};

export default useVisibleDays;
