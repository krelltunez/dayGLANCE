import React, { useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useTranslation } from 'react-i18next';
import { hasActiveSchedFilters, schedFiltersEqual } from '../../utils/schedAgenda.js';

/**
 * Saved filter presets — shared by the desktop rail and the mobile filter
 * sheet. Renders the preset chips (tap to apply, tap again to clear, × to
 * delete) plus a "save current filters" row whenever the live combo isn't
 * already saved. Renders nothing when there are no presets and no active
 * filters.
 */
const SchedFilterPresets = ({ filters, filterPresets, applyFilterPreset, deleteFilterPreset, saveFilterPreset }) => {
  const { darkMode, borderClass, textSecondary, hoverBg } = useDayPlannerCtx();
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');

  const filtersActive = hasActiveSchedFilters(filters);
  const activePreset = filterPresets.find(p => schedFiltersEqual(p.filters, filters));

  if (filterPresets.length === 0 && !filtersActive) return null;

  const submit = (e) => {
    e.preventDefault();
    saveFilterPreset(name);
    setName('');
    setSaving(false);
  };

  return (
    <div className="flex flex-col gap-1.5">
      {filterPresets.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {filterPresets.map(p => {
            const active = activePreset?.id === p.id;
            return (
              <span key={p.id} className="inline-flex items-stretch">
                <button
                  onClick={() => applyFilterPreset(p)}
                  className={`pl-2.5 pr-1.5 py-1 rounded-l-full text-xs font-medium border border-r-0 transition-colors max-w-[140px] truncate ${
                    active ? 'bg-blue-600 text-white border-blue-600' : `${borderClass} ${textSecondary} ${hoverBg}`
                  }`}
                  title={active ? t('sched.clearPreset', 'Clear this preset') : t('sched.applyPreset', 'Apply "{{name}}"', { name: p.name })}
                >
                  {p.name}
                </button>
                <button
                  onClick={() => deleteFilterPreset(p.id)}
                  className={`pr-2 pl-1 rounded-r-full border border-l-0 flex items-center transition-colors ${
                    active ? 'bg-blue-600 text-white border-blue-600' : `${borderClass} ${textSecondary} ${hoverBg}`
                  }`}
                  title={t('sched.deletePreset', 'Delete preset "{{name}}"', { name: p.name })}
                  aria-label={t('sched.deletePreset', 'Delete preset "{{name}}"', { name: p.name })}
                >
                  <X size={10} />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {filtersActive && !activePreset && (
        saving ? (
          <form onSubmit={submit} className="flex gap-1.5">
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setSaving(false); setName(''); } }}
              placeholder={t('sched.presetNamePlaceholder', 'Preset name…')}
              className={`flex-1 min-w-0 px-2 py-1 text-xs rounded-lg border ${borderClass} focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                darkMode ? 'bg-gray-700 text-gray-100 placeholder-gray-500' : 'bg-white text-stone-900 placeholder-stone-400'
              }`}
            />
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-2 py-1 rounded-lg bg-blue-600 text-white disabled:opacity-40"
              aria-label={t('sched.savePreset', 'Save preset')}
            >
              <Check size={12} />
            </button>
          </form>
        ) : (
          <button
            onClick={() => setSaving(true)}
            className="flex items-center gap-1 text-xs font-medium text-blue-500 self-start"
          >
            <Plus size={11} />
            {t('sched.saveCurrentFilters', 'Save current filters')}
          </button>
        )
      )}
    </div>
  );
};

export default SchedFilterPresets;
