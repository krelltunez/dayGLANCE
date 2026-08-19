import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { newFeedId } from '../utils/icsFeedSync.js';

// Editor for additional ICS/CalDAV event calendars beyond the primary Calendar
// URL. Rendered inside the Calendar Sync section of both settings surfaces
// (SettingsModal and MobileSettingsPanel); pulls everything from context.
const AdditionalCalendars = () => {
  const { t } = useTranslation();
  const { colors, darkMode, textSecondary, borderClass } = useDayPlannerCtx();
  const { icsCalendars, setIcsCalendars } = useSyncCtx();

  const updateCal = (id, patch) =>
    setIcsCalendars(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
  const removeCal = (id) => setIcsCalendars(prev => prev.filter(c => c.id !== id));
  const addCal = () => setIcsCalendars(prev => [
    ...prev,
    { id: newFeedId(), name: '', url: '', username: '', password: '', color: 'bg-blue-600', enabled: true },
  ]);

  const inputClass = `w-full px-3 py-1.5 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-xs`;

  return (
    <div className="space-y-2">
      {icsCalendars.length > 0 && (
        <p className={`text-xs font-medium ${textSecondary}`}>{t('settings.additionalCalendars')}</p>
      )}
      {icsCalendars.map(cal => (
        <div key={cal.id} className={`space-y-2 p-2 border ${borderClass} rounded-lg`}>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder={t('settings.calendarNamePlaceholder')}
              value={cal.name || ''}
              onChange={(e) => updateCal(cal.id, { name: e.target.value })}
              className={inputClass}
            />
            <label className={`flex items-center gap-1 text-xs ${textSecondary} flex-shrink-0 cursor-pointer`}>
              <input
                type="checkbox"
                checked={cal.enabled !== false}
                onChange={(e) => updateCal(cal.id, { enabled: e.target.checked })}
              />
              {t('settings.calendarEnabled')}
            </label>
            <button
              onClick={() => removeCal(cal.id)}
              className={`p-1 rounded flex-shrink-0 ${darkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-stone-100 text-stone-500'}`}
              title={t('settings.removeCalendar')}
            >
              <Trash2 size={14} />
            </button>
          </div>
          <input
            type="url"
            placeholder="https://nextcloud.example.com/remote.php/dav/calendars/user/calendar-name/?export"
            value={cal.url || ''}
            onChange={(e) => updateCal(cal.id, { url: e.target.value.replace(/^webcal:\/\//i, 'https://') })}
            onPaste={(e) => { const text = e.clipboardData.getData('text'); if (/^webcal:\/\//i.test(text)) { e.preventDefault(); updateCal(cal.id, { url: text.replace(/^webcal:\/\//i, 'https://') }); } }}
            className={inputClass}
          />
          {cal.url && (
            <div className="flex gap-2">
              <input
                type="text"
                placeholder={t('common.username')}
                value={cal.username || ''}
                onChange={(e) => updateCal(cal.id, { username: e.target.value })}
                autoComplete="off"
                className={inputClass}
              />
              <input
                type="password"
                placeholder={t('common.password')}
                value={cal.password || ''}
                onChange={(e) => updateCal(cal.id, { password: e.target.value })}
                autoComplete="new-password"
                className={inputClass}
              />
            </div>
          )}
          <div className="flex items-center gap-1.5 flex-wrap">
            {[{ name: 'Gray', class: 'bg-gray-600' }, ...colors].map(c => (
              <button
                key={c.class}
                onClick={() => updateCal(cal.id, { color: c.class })}
                className={`w-5 h-5 rounded-full ${c.class} transition-all ${(cal.color || 'bg-gray-600') === c.class ? 'ring-2 ring-offset-1 ring-blue-500' + (darkMode ? ' ring-offset-gray-800' : '') : 'hover:scale-110'}`}
                title={c.name}
              />
            ))}
          </div>
        </div>
      ))}
      <button onClick={addCal} className={`flex items-center gap-1.5 text-xs ${textSecondary} hover:underline`}>
        <Plus size={14} /> {t('settings.addCalendar')}
      </button>
    </div>
  );
};

export default AdditionalCalendars;
