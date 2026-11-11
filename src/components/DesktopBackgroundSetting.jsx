import React, { useEffect, useState } from 'react';
import { MonitorDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

/** Whether this desktop build offers the background options (Windows only). */
export const desktopBackgroundSupported = () =>
  !!(window.electronAPI?.isElectron && window.electronAPI?.platform === 'win32' && window.electronAPI?.getBackgroundSettings);

/**
 * Settings › General › Background (Windows desktop): keep dayGLANCE running in
 * the tray when the window closes, and open it at login. The main process owns
 * both (electron/backgroundMode.ts, userData/desktop-settings.json), so this
 * reads them on mount and shows what the main process reports it applied.
 */
export default function DesktopBackgroundSetting() {
  const { t } = useTranslation();
  const { darkMode, textPrimary, textSecondary } = useDayPlannerCtx();
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    let live = true;
    window.electronAPI?.getBackgroundSettings?.()
      .then((s) => { if (live && s) setSettings(s); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const update = (patch) => {
    setSettings((s) => (s ? { ...s, ...patch } : s));
    window.electronAPI?.setBackgroundSettings?.(patch)
      .then((s) => { if (s) setSettings(s); })
      .catch(() => {});
  };

  if (!settings?.supported) return null;

  const toggle = (id, checked, onChange, label, hint) => (
    <div>
      <label htmlFor={id} className="flex items-center gap-3 cursor-pointer">
        <div className="relative">
          <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
          <div className={`w-10 h-6 rounded-full transition-colors ${checked ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : 'translate-x-1'}`} />
          </div>
        </div>
        <span className={`text-sm ${textPrimary}`}>{label}</span>
      </label>
      <p className={`text-xs ${textSecondary} mt-1 ml-[52px]`}>{hint}</p>
    </div>
  );

  return (
    <div className="space-y-3" data-desktop-background-setting>
      <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
        <MonitorDown size={16} className={textSecondary} />
        {t('settings.desktopBackground')}
      </h4>
      {toggle('desktop-keep-running', settings.keepRunning, (v) => update({ keepRunning: v }),
        t('settings.desktopKeepRunning'), t('settings.desktopKeepRunningHint'))}
      {toggle('desktop-open-at-login', settings.openAtLogin, (v) => update({ openAtLogin: v }),
        t('settings.desktopOpenAtLogin'), t('settings.desktopOpenAtLoginHint'))}
    </div>
  );
}
