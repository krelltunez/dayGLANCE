import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { newFeedId, PRIMARY_FEED_ID, defaultPrimaryCalendarMeta } from '../utils/icsFeedSync.js';

// Unified editor for all subscribed ICS/CalDAV event calendars. The primary
// calendar (legacy single Calendar URL) renders as the first card: its URL and
// credentials are backed by the legacy syncUrl/calendarUrlAuth stores, its
// name/color/enabled by primaryCalendarMeta. Additional calendars are regular
// icsCalendars entries. Rendered inside the Calendar Sync section of both
// settings surfaces; pulls everything from context.
const CalendarList = () => {
  const { t } = useTranslation();
  const { colors, darkMode, textPrimary, textSecondary, borderClass } = useDayPlannerCtx();
  const {
    icsCalendars, setIcsCalendars,
    syncUrl, setSyncUrl,
    calendarUrlAuth, setCalendarUrlAuth,
    primaryCalendarMeta, setPrimaryCalendarMeta,
    showCalendarUrlHint, setShowCalendarUrlHint,
  } = useSyncCtx();

  // The primary card stays visible while its URL field is being edited (even
  // through empty); it only disappears when explicitly removed. New installs
  // never show it — their calendars are all regular entries.
  const [primaryVisible, setPrimaryVisible] = useState(() => !!syncUrl);
  useEffect(() => { if (syncUrl) setPrimaryVisible(true); }, [syncUrl]);

  const cards = [
    ...(primaryVisible ? [{
      id: PRIMARY_FEED_ID,
      name: primaryCalendarMeta.name || '',
      url: syncUrl,
      username: calendarUrlAuth.username || '',
      password: calendarUrlAuth.password || '',
      color: primaryCalendarMeta.color || 'bg-gray-600',
      enabled: primaryCalendarMeta.enabled !== false,
    }] : []),
    ...icsCalendars,
  ];

  const updateCard = (id, patch) => {
    if (id === PRIMARY_FEED_ID) {
      if (patch.url !== undefined) setSyncUrl(patch.url);
      if (patch.username !== undefined) setCalendarUrlAuth(prev => ({ ...prev, username: patch.username }));
      if (patch.password !== undefined) setCalendarUrlAuth(prev => ({ ...prev, password: patch.password }));
      const metaPatch = {};
      for (const k of ['name', 'color', 'enabled']) if (patch[k] !== undefined) metaPatch[k] = patch[k];
      if (Object.keys(metaPatch).length) setPrimaryCalendarMeta(prev => ({ ...prev, ...metaPatch }));
    } else {
      setIcsCalendars(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
    }
  };

  const removeCard = (id) => {
    if (id === PRIMARY_FEED_ID) {
      setSyncUrl('');
      setCalendarUrlAuth({ username: '', password: '' });
      setPrimaryCalendarMeta(defaultPrimaryCalendarMeta());
      setPrimaryVisible(false);
    } else {
      setIcsCalendars(prev => prev.filter(c => c.id !== id));
    }
  };

  const addCal = () => setIcsCalendars(prev => [
    ...prev,
    { id: newFeedId(), name: '', url: '', username: '', password: '', color: 'bg-blue-600', enabled: true },
  ]);

  const inputClass = `w-full px-3 py-1.5 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-xs`;

  return (
    <div className="space-y-2">
      {cards.map(cal => (
        <div key={cal.id} className={`space-y-2 p-2 border ${borderClass} rounded-lg`}>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder={t('settings.calendarNamePlaceholder')}
              value={cal.name || ''}
              onChange={(e) => updateCard(cal.id, { name: e.target.value })}
              className={inputClass}
            />
            <label className={`flex items-center gap-1 text-xs ${textSecondary} flex-shrink-0 cursor-pointer`}>
              <input
                type="checkbox"
                checked={cal.enabled !== false}
                onChange={(e) => updateCard(cal.id, { enabled: e.target.checked })}
              />
              {t('settings.calendarEnabled')}
            </label>
            <button
              onClick={() => removeCard(cal.id)}
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
            onChange={(e) => updateCard(cal.id, { url: e.target.value.replace(/^webcal:\/\//i, 'https://') })}
            onPaste={(e) => { const text = e.clipboardData.getData('text'); if (/^webcal:\/\//i.test(text)) { e.preventDefault(); updateCard(cal.id, { url: text.replace(/^webcal:\/\//i, 'https://') }); } }}
            className={inputClass}
          />
          {cal.url && (
            <div className="flex gap-2">
              <input
                type="text"
                placeholder={t('common.username')}
                value={cal.username || ''}
                onChange={(e) => updateCard(cal.id, { username: e.target.value })}
                autoComplete="off"
                className={inputClass}
              />
              <input
                type="password"
                placeholder={t('common.password')}
                value={cal.password || ''}
                onChange={(e) => updateCard(cal.id, { password: e.target.value })}
                autoComplete="new-password"
                className={inputClass}
              />
            </div>
          )}
          <div className="flex items-center gap-1.5 flex-wrap">
            {[{ name: 'Gray', class: 'bg-gray-600' }, ...colors].map(c => (
              <button
                key={c.class}
                onClick={() => updateCard(cal.id, { color: c.class })}
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
      <p className={`text-xs ${textSecondary}`}>
        {showCalendarUrlHint
          ? <>Paste any public ICS/iCal URL. <strong className={textPrimary}>Google Calendar:</strong> Settings → [your calendar] → "Secret address in iCal format". <strong className={textPrimary}>Outlook:</strong> Settings → View all → Calendar → Shared calendars → Publish → ICS link. <strong className={textPrimary}>Nextcloud (public):</strong> Calendar → Settings → Copy the public link. <strong className={textPrimary}>Nextcloud (private):</strong> use the internal CalDAV URL with ?export appended (e.g. …/remote.php/dav/calendars/user/personal/?export) and enter credentials. <button onClick={() => setShowCalendarUrlHint(false)} className="underline">Show less</button></>
          : <>Where do I find these URLs? <button onClick={() => setShowCalendarUrlHint(true)} className="underline">Show more</button></>
        }
      </p>
    </div>
  );
};

export default CalendarList;
