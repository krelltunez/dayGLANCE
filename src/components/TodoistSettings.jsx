import React, { useId, useState } from 'react';
import { CheckSquare, RefreshCw, Link, Unlink, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { active } from '../todoist/core.js';

export default function TodoistSettings({ variant = 'section' }) {
  const { t, i18n } = useTranslation();
  const { darkMode, borderClass, textPrimary, textSecondary, collapsedSettings, toggleSettingsSection } = useDayPlannerCtx();
  const { todoist: sync } = useSyncCtx();
  const [input, setInput] = useState('');
  // Desktop owns its collapse state in the shared settings model. The mobile
  // route is a full page and must not inherit the desktop section's visibility.
  const isPage = variant === 'page';
  const collapsed = collapsedSettings?.todoist !== false;
  const showBody = isPage || !collapsed;
  const id = useId();
  if (!sync) return null;
  const { settings, updateSettings, catalog, selected, status, connected, report } = sync;
  const mode = settings.mode || 'filtered';
  const scope = mode;
  const busy = status === 'syncing';
  const disabled = busy || sync.multiUserEnabled;
  const fieldClass = `w-full rounded-lg border p-2 text-sm ${borderClass} ${darkMode ? 'bg-gray-900 text-gray-100' : 'bg-white text-gray-900'}`;
  const buttonClass = `rounded-lg border px-3 py-2 text-sm ${borderClass} disabled:opacity-40`;
  const toggle = (field, value) => updateSettings({ [field]: settings[field].includes(value)
    ? settings[field].filter(item => item !== value) : [...settings[field], value] });
  const choices = field => {
    const result = new Map();
    for (const item of Object.values(catalog?.[field] || {})) {
      if (item.is_deleted || item.is_archived) continue;
      result.set(field === 'projects' ? String(item.id) : item.name, item.name);
    }
    for (const value of settings[field]) if (!result.has(value)) result.set(value, t('todoist.missing', { name: value }));
    return [...result].sort((a, b) => a[1].localeCompare(b[1], i18n.resolvedLanguage));
  };
  const checkboxList = field => <details className={`rounded-lg border ${borderClass} p-3`}>
    <summary className="cursor-pointer text-sm font-medium">{t(`todoist.${field}`)} · {settings[field].length}</summary>
    <div className="max-h-40 overflow-y-auto space-y-2 mt-3">
      {!catalog && <p className={`text-xs ${textSecondary}`}>{t('todoist.noCatalog')}</p>}
      {choices(field).map(([value, name]) => <label key={value} className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={settings[field].includes(value)} disabled={disabled}
          onChange={() => toggle(field, value)} className="mt-1" />
        <span className="break-words min-w-0">{name}</span>
      </label>)}
      <label className="flex items-center gap-2 text-sm pt-2">
        <input type="checkbox" checked={field === 'projects' ? settings.subprojects : settings.labelMatch === 'all'}
          onChange={event => updateSettings(field === 'projects' ? { subprojects: event.target.checked }
            : { labelMatch: event.target.checked ? 'all' : 'any' })} />
        {t(`todoist.${field === 'projects' ? 'subprojects' : 'labelAll'}`)}
      </label>
    </div>
  </details>;
  const scanned = catalog ? Object.values(catalog.items || {}).filter(active).length : 0;
  const emptyReason = scanned === 0 ? 'noActive' : scope === 'today' || (scope === 'filtered' && settings.todayOnly) ? 'noToday' : 'noMatch';
  return <section aria-labelledby={`${id}-title`} className={`space-y-3 ${textPrimary}`}>
    {isPage ? <h3 id={`${id}-title`} className="font-medium">{t('todoist.title')}</h3> :
      <button type="button" onClick={() => toggleSettingsSection('todoist')} aria-expanded={!collapsed}
        aria-controls={`${id}-body`} className="font-medium flex items-center gap-2 w-full text-left">
        <CheckSquare size={16} className={textSecondary} />
        <span id={`${id}-title`}>{t('todoist.title')}</span>
        {connected && <span className="w-2 h-2 rounded-full bg-green-500" aria-label={t('todoist.connected')} />}
        <ChevronDown size={16} className={`ml-auto flex-shrink-0 ${textSecondary} transition-transform ${collapsed ? '' : 'rotate-180'}`} />
      </button>}
    {showBody && <div id={`${id}-body`} className="space-y-4">
      <p className={`text-xs leading-relaxed ${textSecondary}`}>{t('todoist.intro')}</p>
      {sync.multiUserEnabled && <p role="alert" className="text-sm text-amber-600 dark:text-amber-400">{t('todoist.errors.multiUser')}</p>}
      {!connected ? <form className="space-y-2" onSubmit={async event => {
        event.preventDefault(); if (await sync.connect(input)) setInput('');
      }}>
        <label htmlFor={`${id}-token`} className="block text-sm font-medium">{t('todoist.token')}</label>
        <input id={`${id}-token`} type="password" value={input} autoComplete="off" spellCheck={false}
          onChange={event => setInput(event.target.value)} disabled={disabled} className={fieldClass} />
        <p className={`text-xs ${textSecondary}`}>{t('todoist.tokenHelp')}</p>
        <button type="submit" disabled={disabled || !input.trim()} className={`${buttonClass} inline-flex items-center gap-2`}>
          <Link size={14} />{t('todoist.connect')}
        </button>
      </form> : <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm min-w-0 break-words">{t('todoist.account', { name: catalog?.user?.full_name || sync.account })}</p>
          <button type="button" onClick={sync.disconnect} className={`${buttonClass} flex gap-2 items-center shrink-0`}>
            <Unlink size={14} />{t('todoist.disconnect')}
          </button>
        </div>
        {!report && <p className="text-xs text-amber-700 dark:text-amber-400">{t('todoist.connectedNotImported')}</p>}
      </div>}
      <fieldset disabled={disabled} className="space-y-3">
        <legend className="font-medium mb-2">{t('todoist.mode')}</legend>
        <select aria-label={t('todoist.mode')} className={fieldClass} value={mode} onChange={event => updateSettings({
          mode: event.target.value, destination: event.target.value === 'today' ? 'today' : 'due',
        })}>
          {['today', 'all', 'filtered'].map(value => <option key={value} value={value}>{t(`todoist.modes.${value}`)}</option>)}
        </select>
        <p className={`text-xs leading-relaxed ${textSecondary}`}>{t(`todoist.modeHelp.${mode}`)}</p>
        {scope === 'filtered' && <details className={`rounded-lg border ${borderClass} p-3`}>
          <summary className="cursor-pointer text-sm font-medium">{t('todoist.advanced')}</summary>
          <div className="space-y-3 mt-3">
            <p className={`text-xs ${textSecondary}`}>{t('todoist.ruleHelp')}</p>
            <details className={`rounded-lg border ${borderClass} p-3`}>
              <summary className="cursor-pointer text-sm font-medium">{t('todoist.priorities')} · {settings.priorities.length}</summary>
              <div className="flex items-center flex-wrap gap-3 mt-3">
                {[1, 2, 3, 4].map(priority => <label key={priority} className="flex items-center gap-1 text-sm">
                  <input type="checkbox" checked={settings.priorities.includes(priority)} onChange={() => toggle('priorities', priority)} />P{priority}
                </label>)}
              </div>
            </details>
            {checkboxList('projects')}{checkboxList('labels')}
            <select aria-label={t('todoist.filters')} className={fieldClass} value={settings.match} onChange={event => updateSettings({ match: event.target.value })}>
              <option value="all">{t('todoist.all')}</option><option value="any">{t('todoist.any')}</option>
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!settings.todayOnly} onChange={event => updateSettings({ todayOnly: event.target.checked })} />{t('todoist.todayOnly')}
            </label>
          </div>
        </details>}
        {(scope === 'today' || (scope === 'filtered' && settings.todayOnly)) && <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!settings.includeOverdue} onChange={event => updateSettings({ includeOverdue: event.target.checked })} />{t('todoist.overdue')}
        </label>}
        <label className="block text-sm space-y-1">
          <span>{t('todoist.destination')}</span>
          <select aria-label={t('todoist.destination')} className={fieldClass} value={settings.destination || 'inbox'} onChange={event => updateSettings({ destination: event.target.value })}>
            {['due', 'today', 'inbox'].map(value => <option value={value} key={value}>{t(`todoist.destinations.${value}`)}</option>)}
          </select>
        </label>
      </fieldset>
      {catalog && <div className={`rounded-lg border ${borderClass} p-3 space-y-2`} aria-live="polite">
        <p className="text-sm font-medium">{t('todoist.preview', { count: selected.length })}</p>
        <p className={`text-xs ${textSecondary}`}>{t('todoist.scanned', { count: scanned })}</p>
        <p className={`text-xs ${textSecondary}`}>{t('todoist.timezone', { zone: catalog.user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone })}</p>
        <p className={`text-xs ${textSecondary}`}>{t('todoist.placement', { target: t(`todoist.destinations.${settings.destination || 'inbox'}`) })}</p>
        {selected.slice(0, 6).map(item => <p className={`text-xs break-words ${textSecondary}`} key={item.id}>
          P{5 - item.priority} · {item.content}{item.due?.date ? ` · ${t('todoist.due', { date: item.due.date })}` : ''}
        </p>)}
        {!selected.length && <p className="text-xs text-amber-700 dark:text-amber-400">{t(`todoist.reasons.${emptyReason}`)}</p>}
      </div>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={disabled || !connected} className={`${buttonClass} flex items-center gap-2 font-medium`} onClick={sync.syncNow}>
          <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />{t('todoist.sync')}
        </button>
        <button type="button" disabled={disabled || !connected} className={buttonClass} onClick={sync.preview}>{t('todoist.refresh')}</button>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={settings.enabled} disabled={disabled || !connected}
          onChange={event => updateSettings({ enabled: event.target.checked })} />{t('todoist.enabled')}
      </label>
      <label className="block text-sm space-y-1">
        <span>{t('todoist.interval')}</span>
        <select aria-label={t('todoist.interval')} className={fieldClass} value={settings.intervalMinutes} disabled={disabled}
          onChange={event => updateSettings({ intervalMinutes: Number(event.target.value) })}>
          {[0, 1, 5, 15].map(value => <option value={value} key={value}>{value ? t('todoist.minutes', { count: value }) : t('todoist.manual')}</option>)}
        </select>
      </label>
      <div role="status" aria-live="polite" className={`space-y-1 text-xs ${textSecondary}`}>
        <p>{t('todoist.status')}: {t(`todoist.${status}`)}</p>
        {sync.lastSynced && <p>{t('todoist.last', { date: new Date(sync.lastSynced).toLocaleString(i18n.resolvedLanguage) })}</p>}
        {sync.pending > 0 && <p>{t('todoist.pending', { count: sync.pending })}</p>}
      </div>
      {sync.error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{t(`todoist.errors.${sync.error}`, { defaultValue: t('todoist.errors.unknown') })}</p>}
      {report && <div className={`rounded-lg border ${borderClass} p-3 space-y-2`} aria-live="polite">
        <h5 className="text-sm font-medium">{t('todoist.result')}</h5>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {['scanned', 'matched', 'added', 'updated', 'unchanged', 'suppressed', 'unknown'].map(field => <p className="text-xs" key={field}>
            {t(`todoist.counts.${field}`)}: <strong>{report[field] || 0}</strong>
          </p>)}
        </div>
        <p className="text-xs">{t('todoist.locations', { calendar: report.calendar, inbox: report.inbox })}</p>
        <p className={`text-xs ${textSecondary}`}>{t(`todoist.reasons.${report.reason}`)}</p>
        {!!report.unknown && <p className="text-xs text-amber-700 dark:text-amber-400">{t('todoist.unknownWarning')}</p>}
      </div>}
      <details className={`text-xs ${textSecondary}`}>
        <summary className="cursor-pointer">{t('todoist.writeOptions')}</summary>
        <div className="space-y-2 mt-3">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={settings.completionWriteback} disabled={disabled}
              onChange={event => updateSettings({ completionWriteback: event.target.checked })} />{t('todoist.writeback')}
          </label>
          <p className="leading-relaxed text-amber-700 dark:text-amber-400">{t('todoist.writeWarning')}</p>
          {!!sync.blockedWrites.length && <p>{t('todoist.blocked', { count: sync.blockedWrites.length })} {sync.blockedWrites.slice(0, 10).map(task => task.title).join(' · ')}</p>}
        </div>
      </details>
      {!!sync.conflicts.length && <div className={`border rounded-lg ${borderClass} p-3 space-y-3`}>
        <p className="text-xs">{t('todoist.conflicts')}</p>
        {sync.conflicts.map(task => <div key={task.id} className="space-y-1">
          <p className="text-sm break-words">{task.title}</p>
          {Object.entries(task.todoist.conflicts).map(([field, value]) => <p key={field} className={`text-xs break-words ${textSecondary}`}>
            {field}: {String(task[field] ?? '-')} → {String(value ?? '-')}
          </p>)}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass} disabled={busy} onClick={() => sync.resolveConflict(task.id, true)}>{t('todoist.remote')}</button>
            <button type="button" className={buttonClass} disabled={busy} onClick={() => sync.resolveConflict(task.id, false)}>{t('todoist.local')}</button>
          </div>
        </div>)}
      </div>}
      <details className={`text-xs ${textSecondary}`}>
        <summary className="cursor-pointer">{t('todoist.securityTitle')}</summary>
        <p className="mt-2 leading-relaxed">{t('todoist.security')}</p>
        <p className="mt-2 leading-relaxed">{t('todoist.privacy')}</p>
        <p className="mt-2 leading-relaxed">{t('todoist.recurring')}</p>
        <p className="mt-2 leading-relaxed">{t('todoist.safety')}</p>
      </details>
    </div>}
  </section>;
}
