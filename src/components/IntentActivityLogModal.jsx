import React, { useState, useEffect } from 'react';
import { X, ArrowDownLeft, ArrowUpRight, ChevronRight, Trash2, Check, Clock, KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { getActivityLog, clearActivityLog } from '../intents/intentLog.js';
import { formatLocalizedDate } from '../utils/localeFormatting.js';

const EVENT_COLORS = {
  completed:   'bg-green-100 text-green-700',
  uncompleted: 'bg-yellow-100 text-yellow-700',
  deleted:     'bg-red-100 text-red-700',
  rescheduled: 'bg-blue-100 text-blue-700',
  updated:     'bg-stone-100 text-stone-600',
  create:      'bg-green-100 text-green-700',
  complete:    'bg-green-100 text-green-700',
  open:        'bg-blue-100 text-blue-700',
  query:       'bg-stone-100 text-stone-600',
  notify:      'bg-purple-100 text-purple-700',
  error:       'bg-red-100 text-red-700',
  warn:        'bg-amber-100 text-amber-700',
};

const EVENT_COLORS_DARK = {
  completed:   'bg-green-900/40 text-green-400',
  uncompleted: 'bg-yellow-900/40 text-yellow-400',
  deleted:     'bg-red-900/40 text-red-400',
  rescheduled: 'bg-blue-900/40 text-blue-400',
  updated:     'bg-gray-700 text-gray-400',
  create:      'bg-green-900/40 text-green-400',
  complete:    'bg-green-900/40 text-green-400',
  open:        'bg-blue-900/40 text-blue-400',
  query:       'bg-gray-700 text-gray-400',
  notify:      'bg-purple-900/40 text-purple-400',
  error:       'bg-red-900/40 text-red-400',
  warn:        'bg-amber-900/40 text-amber-400',
};

const EVENT_LABEL_KEYS = {
  completed: 'intentLog.eventCompleted',
  uncompleted: 'intentLog.eventUncompleted',
  deleted: 'intentLog.eventDeleted',
  rescheduled: 'intentLog.eventRescheduled',
  updated: 'intentLog.eventUpdated',
  create: 'intentLog.eventCreate',
  complete: 'intentLog.eventComplete',
  open: 'intentLog.eventOpen',
  query: 'intentLog.eventQuery',
  notify: 'intentLog.eventNotify',
  error: 'intentLog.eventError',
  warn: 'intentLog.eventWarn',
};

const CRYPTO_ERROR_KEYS = {
  NoKeyError:             'intentLog.errorNoKey',
  WrongKeyError:          'intentLog.errorWrongKey',
  NotEncryptedError:      'intentLog.errorNotEncrypted',
  MalformedEnvelopeError: 'intentLog.errorMalformedEnvelope',
  InvalidPayloadError:    'intentLog.errorInvalidPayload',
  setup_incomplete:       'intentLog.errorSetupIncomplete',
  no_root_key:            'intentLog.errorNoRootKey',
  no_key:                 'intentLog.errorKeyNotReady',
};

function badgeClass(entry, darkMode) {
  const key = entry.status === 'error' ? 'error' : entry.status === 'warn' ? 'warn' : (entry.event ?? entry.action);
  return darkMode ? (EVENT_COLORS_DARK[key] ?? EVENT_COLORS_DARK.updated) : (EVENT_COLORS[key] ?? EVENT_COLORS.updated);
}

function badgeLabel(entry, t) {
  const label = entry.status === 'error'
    ? 'error'
    : entry.status === 'warn'
      ? 'warn'
      : (entry.event ?? entry.action);
  return EVENT_LABEL_KEYS[label] ? t(EVENT_LABEL_KEYS[label]) : label;
}

function errorMessage(entry, t) {
  if (!entry.error) return null;
  return CRYPTO_ERROR_KEYS[entry.error] ? t(CRYPTO_ERROR_KEYS[entry.error]) : entry.error;
}

function errorTextClass(entry) {
  return entry.status === 'warn' ? 'text-amber-500' : 'text-red-500';
}

// Outbound delivery lifecycle chip: queued (in the outbox) → delivered (landed
// on the vault/WebDAV) — or held while the intents encryption key isn't ready.
// Inbound entries have no delivery field and render nothing here.
const DELIVERY_CHIPS = {
  queued:    { Icon: Clock,    labelKey: 'intentLog.deliveryQueued',    cls: 'text-stone-400' },
  held:      { Icon: KeyRound, labelKey: 'intentLog.deliveryHeld',      cls: 'text-amber-500' },
  delivered: { Icon: Check,    labelKey: 'intentLog.deliveryDelivered', cls: 'text-green-500' },
};

function DeliveryChip({ entry, t }) {
  if (entry.direction !== 'out' || !entry.delivery) return null;
  const chip = DELIVERY_CHIPS[entry.delivery];
  if (!chip) return null;
  const { Icon, labelKey, cls } = chip;
  const label = t(labelKey);
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] ${cls}`} title={label}>
      <Icon size={11} className="flex-shrink-0" />
      {label}
    </span>
  );
}

function shortApp(source_app) {
  if (!source_app) return null;
  // 'app.lastglance' → 'lastglance'
  return source_app.replace(/^app\./, '');
}

function formatTime(iso) {
  try {
    return formatLocalizedDate(new Date(iso), { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatDate(iso, t) {
  try {
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return t('common.today');
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return t('common.yesterday');
    return formatLocalizedDate(d, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

const IntentActivityLogModal = () => {
  const { t } = useTranslation();
  const { cardBg, borderClass, textPrimary, textSecondary, darkMode, hoverBg } = useDayPlannerCtx();
  const { showIntentActivityLog, setShowIntentActivityLog } = useSyncCtx();
  const [entries, setEntries] = useState(() => getActivityLog());
  const [expandedErrors, setExpandedErrors] = useState(new Set());

  useEffect(() => {
    if (showIntentActivityLog) {
      setEntries(getActivityLog());
      setExpandedErrors(new Set());
    }
  }, [showIntentActivityLog]);

  const toggleError = (id) => {
    setExpandedErrors(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (!showIntentActivityLog) return null;

  const handleClear = () => {
    clearActivityLog();
    setEntries([]);
  };

  const dividerBg = darkMode ? 'bg-gray-700' : 'bg-stone-200';

  // Group by date for display
  let lastDate = null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-[60]"
      onClick={() => setShowIntentActivityLog(false)}
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setShowIntentActivityLog(false); } }}
      tabIndex={-1}
      ref={el => el && el.focus()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="intent-activity-log-title"
    >
      <div
        className={`${cardBg} rounded-t-2xl sm:rounded-2xl shadow-xl border ${borderClass} w-full sm:max-w-md mx-0 sm:mx-4 flex flex-col`}
        style={{ maxHeight: '80vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-4 pt-4 pb-3 border-b ${borderClass} flex-shrink-0`}>
          <h3 id="intent-activity-log-title" className={`text-sm font-semibold ${textPrimary}`}>{t('shortcuts.intentLog')}</h3>
          <div className="flex items-center gap-1">
            {entries.length > 0 && (
              <button
                onClick={handleClear}
                className={`p-1.5 rounded-lg ${hoverBg} flex items-center gap-1`}
                title={t('intentLog.clearLog')}
                aria-label={t('intentLog.clearLog')}
              >
                <Trash2 size={14} className={textSecondary} />
              </button>
            )}
            <button
              onClick={() => setShowIntentActivityLog(false)}
              className={`p-1.5 rounded-lg ${hoverBg}`}
              title={t('common.close')}
              aria-label={t('common.close')}
            >
              <X size={16} className={textSecondary} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1">
          {entries.length === 0 ? (
            <div className={`text-sm ${textSecondary} text-center py-10 px-4`}>
              {t('intentLog.emptyTitle')}<br />
              <span className="text-xs">{t('intentLog.emptyHint')}</span>
            </div>
          ) : (
            <div className="py-1">
              {entries.map(entry => {
                const dateLabel = formatDate(entry.timestamp, t);
                const showDateDivider = dateLabel !== lastDate;
                lastDate = dateLabel;
                return (
                  <React.Fragment key={entry.id}>
                    {showDateDivider && (
                      <div className={`px-4 py-1.5 flex items-center gap-2`}>
                        <div className={`flex-1 h-px ${dividerBg}`} />
                        <span className={`text-xs ${textSecondary} flex-shrink-0`}>{dateLabel}</span>
                        <div className={`flex-1 h-px ${dividerBg}`} />
                      </div>
                    )}
                    <div className={`px-4 py-2.5 flex items-start gap-2.5`}>
                      {/* Direction icon */}
                      <div className="mt-0.5 flex-shrink-0">
                        {entry.direction === 'in'
                          ? <><ArrowDownLeft size={13} className="text-blue-500" /><span className="sr-only">{t('intentLog.inbound')}</span></>
                          : <><ArrowUpRight size={13} className="text-purple-500" /><span className="sr-only">{t('intentLog.outbound')}</span></>
                        }
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${badgeClass(entry, darkMode)}`}>
                            {badgeLabel(entry, t)}
                          </span>
                          {shortApp(entry.source_app) && (
                            <span className={`text-xs ${textSecondary}`}>{shortApp(entry.source_app)}</span>
                          )}
                          <DeliveryChip entry={entry} t={t} />
                        </div>
                        {entry.title && (
                          <p className={`text-xs ${textPrimary} mt-0.5 truncate`}>{entry.title}</p>
                        )}
                        {entry.error && (
                          <div className="mt-0.5">
                            <button
                              onClick={() => toggleError(entry.id)}
                              aria-expanded={expandedErrors.has(entry.id)}
                              className={`flex items-center gap-0.5 ${errorTextClass(entry)} hover:opacity-75 transition-opacity text-left w-full`}
                            >
                              <ChevronRight
                                size={11}
                                className={`flex-shrink-0 transition-transform ${expandedErrors.has(entry.id) ? 'rotate-90' : ''}`}
                              />
                              <span className="text-xs">{errorMessage(entry, t)}</span>
                            </button>
                            {expandedErrors.has(entry.id) && (
                              <pre className={`mt-1.5 text-[10px] font-mono rounded p-2 whitespace-pre-wrap break-all leading-relaxed ${darkMode ? 'bg-gray-900/60 text-gray-300' : 'bg-stone-100 text-stone-700'}`}>
                                {entry.error}
                              </pre>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Time */}
                      <span className={`text-xs ${textSecondary} flex-shrink-0 mt-0.5`}>{formatTime(entry.timestamp)}</span>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default IntentActivityLogModal;
