import { useState } from 'react';
import GlanceSidebar from './GlanceSidebar.jsx';
import TrayHeader from './TrayHeader.jsx';
import TraySpotlight from './TraySpotlight.jsx';
import TrayVoice from './TrayVoice.jsx';

export default function TrayApp({ bgClass, darkMode }) {
  const [overlay, setOverlay] = useState(null); // 'spotlight' | 'voice' | null

  return (
    <div className={`${bgClass} flex flex-col`} style={{ height: '100vh' }}>
      <TrayHeader
        darkMode={darkMode}
        onSearchClick={() => setOverlay('spotlight')}
        onVoiceClick={() => setOverlay('voice')}
      />
      {overlay === 'spotlight' && (
        <TraySpotlight darkMode={darkMode} onClose={() => setOverlay(null)} />
      )}
      {overlay === 'voice' && (
        <TrayVoice darkMode={darkMode} onClose={() => setOverlay(null)} />
      )}
      {!overlay && (
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          <GlanceSidebar variant="tray" />
        </div>
      )}
    </div>
  );
}
