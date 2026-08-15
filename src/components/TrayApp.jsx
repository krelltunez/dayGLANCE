import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { addPending, resolvePending, expirePending } from '../utils/trayActionAcks.js';
import GlanceSidebar from './GlanceSidebar.jsx';
import TrayHeader from './TrayHeader.jsx';
import TrayFocus from './TrayFocus.jsx';
import TrayReminders from './TrayReminders.jsx';
import TrayNowBar from './TrayNowBar.jsx';
import TraySpotlight from './TraySpotlight.jsx';
import TrayVoice from './TrayVoice.jsx';

// sessionStorage key carrying the "action did not land" notice across the
// popup reload that expiry triggers (state cannot survive location.reload).
const ACK_NOTICE_KEY = 'dayglance-tray-ack-failed';

export default function TrayApp({ bgClass, darkMode }) {
  const [overlay, setOverlay] = useState(null); // 'spotlight' | 'voice' | null
  const [focusState, setFocusState] = useState(null);
  const [reminders, setReminders] = useState([]);
  const [currentTask, setCurrentTask] = useState(null);
  // True right after a reload that an expired ack triggered: this render IS
  // the "reload from storage" half of the revert; the banner is the notice
  // half. The initializer only READS the flag (useState initializers must be
  // pure; StrictMode invokes them twice and an impure remove-on-read loses
  // the flag to its own second call); the mount effect below consumes it.
  const [ackNotice, setAckNotice] = useState(() => {
    try {
      return !!sessionStorage.getItem(ACK_NOTICE_KEY);
    } catch { /* storage unavailable: skip the banner, never break the popup */ }
    return false;
  });
  const pendingAcksRef = useRef([]);

  useEffect(() => {
    try { sessionStorage.removeItem(ACK_NOTICE_KEY); } catch { /* best-effort */ }
  }, []);

  useEffect(() => {
    if (!ackNotice) return undefined;
    const t = setTimeout(() => setAckNotice(false), 6000);
    return () => clearTimeout(t);
  }, [ackNotice]);

  // End-to-end delivery watch for relayed background actions: every send gets
  // a pending entry, every ack from the main renderer settles one, and a
  // sweep expires the rest (3s, deliberately long; see trayActionAcks.js).
  // Expiry means the optimistic update in this popup's state is a lie, so the
  // honest revert is the popup's own normal update mechanism: reload from
  // storage, with the notice flag carried across the reload. No per-action
  // rollback; one mechanism for all fourteen send sites.
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onActionSent || !api?.onActionApplied) return undefined;
    const offSent = api.onActionSent((id) => {
      pendingAcksRef.current = addPending(pendingAcksRef.current, id, Date.now());
    });
    const offApplied = api.onActionApplied((id) => {
      pendingAcksRef.current = resolvePending(pendingAcksRef.current, id);
    });
    const sweep = setInterval(() => {
      const { expired, remaining } = expirePending(pendingAcksRef.current, Date.now());
      pendingAcksRef.current = remaining;
      if (expired.length > 0) {
        try { sessionStorage.setItem(ACK_NOTICE_KEY, '1'); } catch { /* banner is best-effort */ }
        window.location.reload();
      }
    }, 500);
    return () => { offSent?.(); offApplied?.(); clearInterval(sweep); };
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onFocusState) return;
    return window.electronAPI.onFocusState((state) => {
      setFocusState(state?.active ? state : null);
    });
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onReminders) return;
    return window.electronAPI.onReminders((r) => {
      setReminders(Array.isArray(r) ? r : []);
    });
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onCurrentTask) return;
    return window.electronAPI.onCurrentTask((task) => {
      setCurrentTask(task ?? null);
    });
  }, []);

  return (
    <div className={`${bgClass} flex flex-col`} style={{ height: '100vh' }}>
      <TrayHeader
        darkMode={darkMode}
        onSearchClick={() => setOverlay('spotlight')}
        onVoiceClick={() => setOverlay('voice')}
      />
      {ackNotice && (
        <div className={`flex-shrink-0 px-3 py-2 text-xs font-medium ${darkMode ? 'bg-red-900/40 text-red-300' : 'bg-red-100 text-red-700'}`}>
          A change did not reach dayGLANCE and was not saved. Make sure dayGLANCE is running, then try again.
        </div>
      )}
      {focusState ? (
        <TrayFocus darkMode={darkMode} focusState={focusState} />
      ) : (
        <>
          <TrayReminders darkMode={darkMode} reminders={reminders} />
          <TrayNowBar darkMode={darkMode} currentTask={currentTask} />
          {overlay === 'spotlight' && (
            <TraySpotlight darkMode={darkMode} onClose={() => setOverlay(null)} />
          )}
          {overlay === 'voice' && (
            <TrayVoice darkMode={darkMode} onClose={() => setOverlay(null)} autoStart />
          )}
          {!overlay && (
            <div className="flex-1 overflow-y-auto px-3 py-3">
              <GlanceSidebar variant="tray" />
            </div>
          )}
        </>
      )}
    </div>
  );
}
