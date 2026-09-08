import { useState, useRef, useEffect } from 'react';
import { readTrmnlPushState } from '../utils/trmnlPushPolicy.js';

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
  // The push state (utils/trmnlPushPolicy.js) is persisted so a relaunch
  // resumes the floor, the backoff and the last content pushed instead of
  // starting again at full speed (field incident, 2026-09-08).
  const trmnlSyncTimerRef = useRef(null);
  const trmnlLastPushRef = useRef(
    (() => {
      const s = localStorage.getItem('day-planner-trmnl-last-synced');
      return Math.max(s ? new Date(s).getTime() : 0, readTrmnlPushState().lastPushAt || 0);
    })()
  ); // timestamp of last push attempt
  const trmnlBackoffUntilRef = useRef(readTrmnlPushState().backoffUntil || 0); // timestamp: skip auto-sync until this time (429 backoff)
  const trmnlBackoffCountRef = useRef(readTrmnlPushState().backoffCount || 0); // consecutive 429s — drives exponential backoff
  const trmnlLastFingerprintRef = useRef(readTrmnlPushState().lastFingerprint ?? null); // content of the last push, clock fields excluded
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
    trmnlLastFingerprintRef,
    trmnlSyncInProgressRef,
    performTrmnlSyncRef,
  };
};

export default useTrmnlSync;
