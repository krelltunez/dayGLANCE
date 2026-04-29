import { useState, useEffect } from 'react';
import GlanceSidebar from './GlanceSidebar.jsx';
import TrayHeader from './TrayHeader.jsx';
import TrayFocus from './TrayFocus.jsx';
import TrayReminders from './TrayReminders.jsx';
import TraySpotlight from './TraySpotlight.jsx';
import TrayVoice from './TrayVoice.jsx';

export default function TrayApp({ bgClass, darkMode }) {
  const [overlay, setOverlay] = useState(null); // 'spotlight' | 'voice' | null
  const [focusState, setFocusState] = useState(null);
  const [reminders, setReminders] = useState([]);

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

  return (
    <div className={`${bgClass} flex flex-col`} style={{ height: '100vh' }}>
      <TrayHeader
        darkMode={darkMode}
        onSearchClick={() => setOverlay('spotlight')}
        onVoiceClick={() => setOverlay('voice')}
      />
      {focusState ? (
        <TrayFocus darkMode={darkMode} focusState={focusState} />
      ) : (
        <>
          <TrayReminders darkMode={darkMode} reminders={reminders} />
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
