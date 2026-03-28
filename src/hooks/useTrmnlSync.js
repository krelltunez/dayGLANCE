import { useState, useRef, useEffect } from 'react';

const useTrmnlSync = () => {
  const [trmnlConfig, setTrmnlConfig] = useState(() => {
    try {
      const saved = localStorage.getItem('day-planner-trmnl-config');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [trmnlSyncStatus, setTrmnlSyncStatus] = useState('idle'); // 'idle' | 'syncing' | 'success' | 'error'
  const [trmnlLastSynced, setTrmnlLastSynced] = useState(() =>
    localStorage.getItem('day-planner-trmnl-last-synced') || null
  );
  // Seed from persisted last-synced so the 2-min throttle survives page reloads
  const trmnlSyncTimerRef = useRef(null);
  const trmnlLastPushRef = useRef(
    (() => { const s = localStorage.getItem('day-planner-trmnl-last-synced'); return s ? new Date(s).getTime() : 0; })()
  ); // timestamp of last push attempt
  const trmnlBackoffUntilRef = useRef(0); // timestamp: skip auto-sync until this time (429 backoff)
  const trmnlBackoffCountRef = useRef(0); // consecutive 429s — drives exponential backoff
  const trmnlSyncInProgressRef = useRef(false); // prevents concurrent pushes
  const performTrmnlSyncRef = useRef(null);

  // Persist TRMNL config
  useEffect(() => {
    if (trmnlConfig) {
      localStorage.setItem('day-planner-trmnl-config', JSON.stringify(trmnlConfig));
    } else {
      localStorage.removeItem('day-planner-trmnl-config');
    }
  }, [trmnlConfig]);

  return {
    trmnlConfig, setTrmnlConfig,
    trmnlSyncStatus, setTrmnlSyncStatus,
    trmnlLastSynced, setTrmnlLastSynced,
    trmnlSyncTimerRef,
    trmnlLastPushRef,
    trmnlBackoffUntilRef,
    trmnlBackoffCountRef,
    trmnlSyncInProgressRef,
    performTrmnlSyncRef,
  };
};

export default useTrmnlSync;
