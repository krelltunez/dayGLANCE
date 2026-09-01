import React, { useState } from 'react';
import { X, Trash2 } from 'lucide-react';
import { FRAME_COLORS } from '../constants/frames.js';
import ClockTimePicker from './ClockTimePicker.jsx';
import { useTranslation } from 'react-i18next';
import { formatLocalizedDate, localizedWeekdays } from '../utils/localeFormatting.js';

const FrameEditor = ({ frame, onSave, onDelete, onCancel, allTags, darkMode, textPrimary, textSecondary, borderClass, cardBg, hoverBg, existingFrames, use24HourClock, isTablet }) => {
  const { t } = useTranslation();
  const dayLabels = localizedWeekdays('short');
  const [label, setLabel] = useState(frame?.label || '');
  const [days, setDays] = useState(frame?.days || [1, 2, 3, 4, 5]);
  const [start, setStart] = useState(frame?.start || '09:00');
  const [end, setEnd] = useState(frame?.end || '12:00');
  const [timePickerField, setTimePickerField] = useState(null); // 'start' | 'end' | null
  const [color, setColor] = useState(frame?.color || 'bg-indigo-200');
  const [tagAffinity, setTagAffinity] = useState(frame?.tagAffinity || []);
  const [energyLevel, setEnergyLevel] = useState(frame?.energyLevel || 'medium');
  const [bufferMinutes, setBufferMinutes] = useState(frame?.bufferMinutes ?? 5);
  const [enabled, setEnabled] = useState(frame?.enabled ?? true);
  const [singleDate, setSingleDate] = useState(frame?.singleDate || null);
  const [error, setError] = useState('');

  const energyLabels = {
    low: t('task.lowPriority'),
    medium: t('task.mediumPriority'),
    high: t('task.highPriority'),
  };
  const colorLabels = {
    Indigo: t('frames.colors.indigo', { defaultValue: 'Indigo' }),
    Amber: t('frames.colors.amber', { defaultValue: 'Amber' }),
    Green: t('frames.colors.green', { defaultValue: 'Green' }),
    Blue: t('frames.colors.blue', { defaultValue: 'Blue' }),
    Rose: t('frames.colors.rose', { defaultValue: 'Rose' }),
    Purple: t('frames.colors.purple', { defaultValue: 'Purple' }),
    Teal: t('frames.colors.teal', { defaultValue: 'Teal' }),
    Orange: t('frames.colors.orange', { defaultValue: 'Orange' }),
  };

  const toggleDay = (d) => {
    setDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort());
  };

  const toggleTag = (tag) => {
    setTagAffinity(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  const validate = () => {
    if (!label.trim()) return t('frames.nameRequired', { defaultValue: 'Frame needs a name' });
    if (!singleDate && days.length === 0) return t('frames.dayRequired', { defaultValue: 'Select at least one day' });
    if (start >= end) return t('frames.endAfterStart', { defaultValue: 'End time must be after start time' });
    // Check overlap with existing frames (same day)
    const otherFrames = existingFrames.filter(f => f.id !== frame?.id && f.enabled);
    for (const other of otherFrames) {
      if (singleDate) {
        // For single-date frames, check overlap on that specific date
        if (other.singleDate === singleDate || (!other.singleDate && other.days.includes(new Date(singleDate + 'T12:00:00').getDay()))) {
          if (start < other.end && end > other.start) {
            return t('frames.overlap', { frame: other.label, defaultValue: 'Overlaps with "{{frame}}"' });
          }
        }
      } else {
        const sharedDays = days.filter(d => other.days.includes(d));
        if (sharedDays.length > 0) {
          if (start < other.end && end > other.start) {
            return t('frames.overlapOnDays', {
              frame: other.label,
              days: sharedDays.map(d => dayLabels[d]).join(', '),
              defaultValue: 'Overlaps with "{{frame}}" on {{days}}',
            });
          }
        }
      }
    }
    return '';
  };

  const handleSave = () => {
    const err = validate();
    if (err) { setError(err); return; }
    const frameData = {
      ...(frame || {}),
      id: frame?.id || undefined,
      label: label.trim(),
      days,
      start,
      end,
      color,
      tagAffinity,
      energyLevel,
      bufferMinutes,
      enabled,
      exceptions: frame?.exceptions || {},
      lastModified: new Date().toISOString(),
    };
    if (singleDate) {
      frameData.singleDate = singleDate;
    } else {
      delete frameData.singleDate;
    }
    onSave(frameData);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className={`text-lg font-semibold ${textPrimary}`}>{frame ? t('frames.editFrame', { defaultValue: 'Edit Frame' }) : t('frames.newFrame')}</h3>
        <button onClick={onCancel} className={`p-1.5 rounded-lg ${hoverBg} transition-colors`} aria-label={t('common.close')}>
          <X size={18} className={textSecondary} />
        </button>
      </div>

      {error && <div className="p-2 rounded-lg bg-red-500/10 text-red-500 text-sm">{error}</div>}

      {/* Name */}
      <div>
        <label className={`text-xs font-medium ${textSecondary} block mb-1`}>{t('common.name')}</label>
        <input
          type="text"
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder={t('frames.namePlaceholder', { defaultValue: 'e.g. Morning Deep Work' })}
          className={`w-full px-3 py-2 rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-800 text-white' : 'bg-white text-stone-900'} text-sm`}
          autoFocus
        />
      </div>

      {/* Days / Single Date */}
      {singleDate ? (
        <div>
          <label className={`text-xs font-medium ${textSecondary} block mb-1`}>{t('common.schedule')}</label>
          <div className={`flex items-center justify-between px-3 py-2 rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-800' : 'bg-stone-50'}`}>
            <span className={`text-sm ${textPrimary}`}>
              {formatLocalizedDate(new Date(singleDate + 'T12:00:00'), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} · {t('frames.oneTime')}
            </span>
            <button
              onClick={() => { setSingleDate(null); setDays([new Date(singleDate + 'T12:00:00').getDay()]); }}
              className="text-xs text-blue-500 hover:text-blue-400 transition-colors"
            >
              {t('goals.hgRecurring')}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <label className={`text-xs font-medium ${textSecondary} block mb-1`}>{t('common.days')}</label>
          <div className="flex gap-1">
            {dayLabels.map((d, i) => (
              <button
                key={i}
                onClick={() => toggleDay(i)}
                className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${days.includes(i) ? 'bg-blue-600 text-white' : darkMode ? 'bg-gray-800 text-gray-400' : 'bg-stone-100 text-stone-500'}`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Time range */}
      <div className="flex gap-3">
        <div className="flex-1">
          <label className={`text-xs font-medium ${textSecondary} block mb-1`}>{t('common.start')}</label>
          <button type="button" onClick={() => setTimePickerField('start')}
            className={`w-full px-3 py-2 rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-800 text-white' : 'bg-white text-stone-900'} text-sm text-left`}>
            {start}
          </button>
        </div>
        <div className="flex-1">
          <label className={`text-xs font-medium ${textSecondary} block mb-1`}>{t('common.end')}</label>
          <button type="button" onClick={() => setTimePickerField('end')}
            className={`w-full px-3 py-2 rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-800 text-white' : 'bg-white text-stone-900'} text-sm text-left`}>
            {end}
          </button>
        </div>
      </div>

      {/* Color */}
      <div>
        <label className={`text-xs font-medium ${textSecondary} block mb-1`}>{t('common.color')}</label>
        <div className="flex gap-2 flex-wrap">
          {FRAME_COLORS.map(c => (
            <button
              key={c.class}
              onClick={() => setColor(c.class)}
              className={`w-7 h-7 rounded-full ${c.class} ${color === c.class ? 'ring-2 ring-blue-500 ring-offset-2' : ''} transition-all`}
              style={darkMode ? { ringOffsetColor: '#1f2937' } : {}}
              title={colorLabels[c.name] ?? c.name}
              aria-label={colorLabels[c.name] ?? c.name}
            />
          ))}
        </div>
      </div>

      {/* Energy Level */}
      <div>
        <label className={`text-xs font-medium ${textSecondary} block mb-1`}>{t('frames.energyLevel')}</label>
        <div className="flex gap-1">
          {['low', 'medium', 'high'].map(level => (
            <button
              key={level}
              onClick={() => setEnergyLevel(level)}
              className={`flex-1 py-1.5 rounded text-xs font-medium capitalize transition-colors ${energyLevel === level ? 'bg-blue-600 text-white' : darkMode ? 'bg-gray-800 text-gray-400' : 'bg-stone-100 text-stone-500'}`}
            >
              {energyLabels[level]}
            </button>
          ))}
        </div>
      </div>

      {/* Buffer */}
      <div>
        <label className={`text-xs font-medium ${textSecondary} block mb-1`}>
          {t('frames.taskBuffer', { minutes: bufferMinutes, defaultValue: 'Buffer between tasks: {{minutes}} min' })}
        </label>
        <input type="range" min={0} max={30} step={5} value={bufferMinutes} onChange={e => setBufferMinutes(Number(e.target.value))}
          className="w-full" />
      </div>

      {/* Tag Affinity */}
      {allTags.length > 0 && (
        <div>
          <label className={`text-xs font-medium ${textSecondary} block mb-1`}>{t('frames.tagAffinity')}</label>
          <div className="flex gap-1.5 flex-wrap">
            {allTags.map(tag => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={`px-2 py-1 rounded-full text-xs transition-colors ${tagAffinity.includes(tag) ? 'bg-blue-600 text-white' : darkMode ? 'bg-gray-800 text-gray-400' : 'bg-stone-100 text-stone-500'}`}
              >
                #{tag}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Enabled toggle */}
      <label className="flex items-center gap-3 cursor-pointer">
        <div className="relative">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="sr-only" />
          <div className={`w-10 h-5 rounded-full transition-colors ${enabled ? 'bg-blue-600' : darkMode ? 'bg-gray-700' : 'bg-stone-300'}`} />
          <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${enabled ? 'translate-x-5' : ''}`} />
        </div>
        <span className={`text-sm ${textPrimary}`}>{t('common.enabled')}</span>
      </label>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <button onClick={handleSave} className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
          {frame ? t('task.saveChanges') : t('frames.createFrame')}
        </button>
        {frame && (
          <button onClick={() => onDelete(frame.id)} className="px-4 py-2.5 bg-red-500/10 text-red-500 rounded-lg text-sm font-medium hover:bg-red-500/20 transition-colors" aria-label={t('common.delete')}>
            <Trash2 size={16} />
          </button>
        )}
      </div>
      {timePickerField && (
        <ClockTimePicker
          value={timePickerField === 'start' ? start : end}
          onChange={(t) => { if (timePickerField === 'start') setStart(t); else setEnd(t); setTimePickerField(null); }}
          onClose={() => setTimePickerField(null)}
          darkMode={darkMode} isTablet={isTablet ?? false} use24HourClock={use24HourClock}
        />
      )}
    </div>
  );
};

export default FrameEditor;
