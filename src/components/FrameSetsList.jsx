import React, { useState } from 'react';
import { Plus, Pencil, Trash2, X, Layers } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import useBackClose from '../hooks/useBackClose.js';
import { formatLocalizedDate } from '../utils/localeFormatting.js';
import { frameSetStatus } from '../utils/frameSetEdits.js';

// The Frames list grouped by frame set (#2305), shared by the desktop Frames
// modal and the mobile Frames settings page. Frames in no set (or in a set
// this device does not know, which apply as if they had none) come first,
// under "Always"; then one section per set, whose header switches the set on
// or off for today and opens its editor (name, planned periods, delete).
//
// Without any sets the list looks as it always did, plus a "New set" button.

const formatDay = (dateStr) => formatLocalizedDate(new Date(`${dateStr}T12:00:00`), { month: 'short', day: 'numeric', year: 'numeric' });

/** A period in words: "Jan 20, 2027 – Feb 20, 2027", "From …", "Until …", "Every date". */
export function describePeriod(t, period) {
  const from = period?.from || null;
  const until = period?.until || null;
  if (from && until) return t('frames.sets.periodRange', { from: formatDay(from), until: formatDay(until) });
  if (from) return t('frames.sets.periodFrom', { from: formatDay(from) });
  if (until) return t('frames.sets.periodUntil', { until: formatDay(until) });
  return t('frames.sets.periodAlways');
}

function FrameRow({ frame, onEdit, dimmed, darkMode, textPrimary, textSecondary, borderClass, rowBg, hoverBg, formatTime, dayLabels, offLabel, t }) {
  return (
    <div
      onClick={() => onEdit(frame)}
      data-frame-row={frame.id}
      className={`p-3 rounded-lg border ${borderClass} ${rowBg} cursor-pointer ${hoverBg} transition-colors ${dimmed ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center gap-2">
        <div className={`w-3 h-3 rounded-full ${frame.color}`} />
        <span className={`font-medium text-sm ${textPrimary}`}>{frame.label}</span>
        {frame.singleDate && <span className={`text-[10px] px-1.5 py-0.5 rounded ${darkMode ? 'bg-purple-900/50 text-purple-300' : 'bg-purple-100 text-purple-700'}`}>{t('frames.oneTime')}</span>}
        {!frame.enabled && <span className={`text-[10px] px-1.5 py-0.5 rounded ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} ${textSecondary}`}>{offLabel}</span>}
      </div>
      <div className={`text-xs ${textSecondary} mt-1`}>
        {formatTime(frame.start)} – {formatTime(frame.end)} · {frame.singleDate
          ? formatLocalizedDate(new Date(frame.singleDate + 'T12:00:00'), { month: 'short', day: 'numeric' })
          : (frame.days || []).map(d => dayLabels[d]).join(', ')}
        {frame.energyLevel && frame.energyLevel !== 'medium' && ` · ${frame.energyLevel} energy`}
      </div>
    </div>
  );
}

/** The switch for a set, on or off for today. */
export function FrameSetSwitch({ set, on, disabled, onSwitch, darkMode, t }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={t('frames.sets.switchLabel', { name: set.name })}
      data-frame-set-switch={set.id}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onSwitch(set.id, !on); }}
      className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${on ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'} ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
    >
      <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${on ? 'left-5' : 'left-1'}`} />
    </button>
  );
}

const toInput = (periods) => (Array.isArray(periods) ? periods : []).map((p) => ({ from: p?.from || '', until: p?.until || '' }));

/** Name, planned periods and delete, for one set. */
export function FrameSetEditor({ set, onSave, onDelete, onClose, isMobile, darkMode, textPrimary, textSecondary, borderClass, t }) {
  const [name, setName] = useState(set.name || '');
  const [periods, setPeriods] = useState(() => toInput(set.periods));
  const [error, setError] = useState('');
  useBackClose({ open: !!isMobile, key: 'dgFrameSetEditor', onClose });
  const inputClass = `px-2 py-1.5 rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-800 text-white' : 'bg-white text-stone-900'} text-sm`;

  const update = (i, field, value) => setPeriods((prev) => prev.map((p, j) => (j === i ? { ...p, [field]: value } : p)));
  const save = () => {
    if (!name.trim()) { setError(t('frames.sets.nameRequired')); return; }
    if (periods.some((p) => p.from && p.until && p.until < p.from)) { setError(t('frames.sets.periodInvalid')); return; }
    onSave({ name: name.trim(), periods: periods.map((p) => ({ from: p.from || null, until: p.until || null })) });
  };

  return (
    <div className={`p-3 rounded-lg border ${borderClass} space-y-3`} data-frame-set-editor={set.id} onClick={(e) => e.stopPropagation()}>
      {error && <div className="p-2 rounded-lg bg-red-500/10 text-red-500 text-sm">{error}</div>}
      <div>
        <label className={`text-xs font-medium ${textSecondary} block mb-1`}>{t('common.name')}</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={`w-full ${inputClass}`} data-frame-set-name />
      </div>
      <div>
        <div className={`text-xs font-medium ${textSecondary} mb-1`}>{t('frames.sets.periods')}</div>
        <p className={`text-xs ${textSecondary} mb-2`}>{t('frames.sets.periodsHint')}</p>
        {periods.length === 0 && <p className={`text-xs ${textSecondary} mb-2`} data-frame-set-no-periods>{t('frames.sets.noPeriods')}</p>}
        <div className="space-y-2">
          {periods.map((p, i) => (
            <div key={i} className="flex items-end gap-2" data-frame-set-period={i}>
              <label className="flex-1 min-w-0">
                <span className={`text-[11px] ${textSecondary} block`}>{t('frames.sets.from')}</span>
                <input type="date" value={p.from} onChange={(e) => update(i, 'from', e.target.value)} className={`w-full ${inputClass}`} aria-label={t('frames.sets.from')} />
              </label>
              <label className="flex-1 min-w-0">
                <span className={`text-[11px] ${textSecondary} block`}>{t('frames.sets.until')}</span>
                <input type="date" value={p.until} onChange={(e) => update(i, 'until', e.target.value)} className={`w-full ${inputClass}`} aria-label={t('frames.sets.until')} />
              </label>
              <button
                type="button"
                onClick={() => setPeriods((prev) => prev.filter((_, j) => j !== i))}
                className={`p-2 rounded-lg ${textSecondary} hover:text-red-500 transition-colors`}
                aria-label={t('frames.sets.removePeriod')}
                title={t('frames.sets.removePeriod')}
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setPeriods((prev) => [...prev, { from: '', until: '' }])}
          className="mt-2 text-xs text-blue-500 hover:text-blue-400 transition-colors flex items-center gap-1"
          data-frame-set-add-period
        >
          <Plus size={14} />
          {t('frames.sets.addPeriod')}
        </button>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={save} className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors" data-frame-set-save>
          {t('common.save')}
        </button>
        <button type="button" onClick={onClose} className={`px-3 py-2 rounded-lg border ${borderClass} text-sm ${textPrimary}`}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={() => onDelete(set.id)}
          className="px-3 py-2 bg-red-500/10 text-red-500 rounded-lg text-sm font-medium hover:bg-red-500/20 transition-colors"
          aria-label={t('frames.sets.deleteSet')}
          title={t('frames.sets.deleteSet')}
          data-frame-set-delete
        >
          <Trash2 size={16} />
        </button>
      </div>
      <p className={`text-[11px] ${textSecondary}`}>{t('frames.sets.deleteHint')}</p>
    </div>
  );
}

export default function FrameSetsList({
  frames, frameSets, frameSetsLoaded, todayStr,
  onEditFrame, onAddFrame,
  onSwitchSet, onRenameSet, onSetPeriods, onDeleteSet, onCreateSet,
  darkMode, textPrimary, textSecondary, borderClass, hoverBg, rowBg = '',
  formatTime, dayLabels, offLabel, isMobile = false,
}) {
  const { t } = useTranslation();
  const [editingSetId, setEditingSetId] = useState(null);
  const [newSetName, setNewSetName] = useState(null); // null: the input is closed
  const sets = Array.isArray(frameSets) ? frameSets : [];
  const known = new Set(sets.map((s) => String(s.id)));
  const inSet = (f) => f.setId != null && known.has(String(f.setId));
  const unassigned = frames.filter((f) => !inSet(f));
  const rowProps = { darkMode, textPrimary, textSecondary, borderClass, rowBg, hoverBg, formatTime, dayLabels, offLabel, t, onEdit: onEditFrame };

  const addButton = (setId, label) => (
    <button
      type="button"
      onClick={() => onAddFrame(setId)}
      data-frame-add={setId ?? ''}
      className={`w-full p-3 rounded-lg border border-dashed ${borderClass} text-sm ${textSecondary} flex items-center justify-center gap-2 ${hoverBg} transition-colors`}
    >
      <Plus size={16} />
      {label}
    </button>
  );

  const createSet = () => {
    const name = (newSetName || '').trim();
    if (!name) return;
    onCreateSet(name);
    setNewSetName(null);
  };

  return (
    <div className="space-y-4" data-frame-sets-list>
      {!frameSetsLoaded && (
        <p className={`text-xs ${textSecondary}`} data-frame-sets-unavailable>{t('frames.sets.unavailable')}</p>
      )}

      <div className="space-y-2" data-frame-set-section="">
        {sets.length > 0 && (
          <div>
            <h4 className={`text-xs font-semibold uppercase tracking-wide ${textSecondary}`}>{t('frames.sets.always')}</h4>
            <p className={`text-xs ${textSecondary}`}>{t('frames.sets.alwaysHint')}</p>
          </div>
        )}
        {unassigned.map((frame) => <FrameRow key={frame.id} frame={frame} {...rowProps} />)}
        {addButton(null, t('frames.addFrame'))}
      </div>

      {sets.map((set) => {
        const status = frameSetStatus(set, todayStr);
        const members = frames.filter((f) => inSet(f) && String(f.setId) === String(set.id));
        const statusText = status.on
          ? (status.until ? t('frames.sets.onUntil', { date: formatDay(status.until) }) : t('frames.sets.onToday'))
          : (status.next ? t('frames.sets.offNext', { period: describePeriod(t, status.next) }) : t('frames.sets.offToday'));
        const editing = editingSetId === String(set.id);
        return (
          <section key={set.id} className={`space-y-2 pt-3 border-t ${borderClass}`} data-frame-set-section={set.id}>
            <div className="flex items-center gap-2">
              <Layers size={16} className={textSecondary} />
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-semibold truncate ${textPrimary}`}>{set.name}</div>
                <div className={`text-xs ${status.on ? 'text-blue-500' : textSecondary}`} data-frame-set-status>{statusText}</div>
              </div>
              <button
                type="button"
                onClick={() => setEditingSetId(editing ? null : String(set.id))}
                disabled={!frameSetsLoaded}
                className={`p-1.5 rounded-lg ${hoverBg} transition-colors ${!frameSetsLoaded ? 'opacity-60 cursor-not-allowed' : ''}`}
                aria-label={t('frames.sets.edit', { name: set.name })}
                title={t('frames.sets.edit', { name: set.name })}
                data-frame-set-edit={set.id}
              >
                <Pencil size={16} className={textSecondary} />
              </button>
              <FrameSetSwitch set={set} on={status.on} disabled={!frameSetsLoaded} onSwitch={onSwitchSet} darkMode={darkMode} t={t} />
            </div>
            {editing && (
              <FrameSetEditor
                set={set}
                isMobile={isMobile}
                onClose={() => setEditingSetId(null)}
                onSave={({ name, periods }) => {
                  onRenameSet(set.id, name);
                  onSetPeriods(set.id, periods);
                  setEditingSetId(null);
                }}
                onDelete={(id) => { setEditingSetId(null); onDeleteSet(id); }}
                darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass} t={t}
              />
            )}
            {members.length === 0 && <p className={`text-xs ${textSecondary}`}>{t('frames.sets.empty')}</p>}
            {members.map((frame) => <FrameRow key={frame.id} frame={frame} dimmed={!status.on} {...rowProps} />)}
            {addButton(set.id, t('frames.sets.addFrameToSet', { name: set.name }))}
          </section>
        );
      })}

      {frameSetsLoaded && (newSetName === null ? (
        <button
          type="button"
          onClick={() => setNewSetName('')}
          className={`w-full p-3 rounded-lg border border-dashed ${borderClass} text-sm ${textSecondary} flex items-center justify-center gap-2 ${hoverBg} transition-colors`}
          data-frame-set-new
        >
          <Layers size={16} />
          {t('frames.sets.newSet')}
        </button>
      ) : (
        <div className={`p-3 rounded-lg border ${borderClass} space-y-2`} data-frame-set-new-form>
          <p className={`text-xs ${textSecondary}`}>{t('frames.sets.newSetHint')}</p>
          <input
            type="text"
            value={newSetName}
            onChange={(e) => setNewSetName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') createSet(); if (e.key === 'Escape') { e.stopPropagation(); setNewSetName(null); } }}
            placeholder={t('frames.sets.namePlaceholder')}
            aria-label={t('common.name')}
            className={`w-full px-3 py-2 rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-800 text-white' : 'bg-white text-stone-900'} text-sm`}
            autoFocus
            data-frame-set-new-name
          />
          <div className="flex gap-2">
            <button type="button" onClick={createSet} disabled={!newSetName.trim()} className={`flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors ${!newSetName.trim() ? 'opacity-60 cursor-not-allowed' : ''}`} data-frame-set-create>
              {t('frames.sets.create')}
            </button>
            <button type="button" onClick={() => setNewSetName(null)} className={`px-3 py-2 rounded-lg border ${borderClass} text-sm ${textPrimary}`}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
