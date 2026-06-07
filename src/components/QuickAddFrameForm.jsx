import React, { useState, useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import { FRAME_COLORS } from '../constants/frames.js';
import ClockTimePicker from './ClockTimePicker.jsx';
import { useTranslation } from 'react-i18next';

const QuickAddFrameForm = ({ dateStr, dateDisplay, defaultStart, defaultEnd, defaultColor, existingFrames, getFrameInstancesForDate, onSave, onCancel, darkMode, textPrimary, textSecondary, borderClass, hoverBg, formatTime, isTablet, use24HourClock }) => {
  const { t } = useTranslation();
  const [label, setLabel] = useState('');
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);
  const [color, setColor] = useState(defaultColor);
  const [energyLevel, setEnergyLevel] = useState('medium');
  const [bufferMinutes, setBufferMinutes] = useState(5);
  const [error, setError] = useState('');
  const [timePickerField, setTimePickerField] = useState(null); // 'start' | 'end' | null
  const labelRef = useRef(null);

  useEffect(() => {
    if (labelRef.current) labelRef.current.focus();
  }, []);

  const validate = () => {
    if (!label.trim()) return 'Frame needs a name';
    if (start >= end) return 'End time must be after start time';
    // Check overlap with existing frames on this date
    const date = new Date(dateStr + 'T12:00:00');
    const existingInstances = getFrameInstancesForDate(date);
    for (const inst of existingInstances) {
      if (start < inst.end && end > inst.start) {
        return `Overlaps with "${inst.label}"`;
      }
    }
    return '';
  };

  const handleSave = () => {
    const err = validate();
    if (err) { setError(err); return; }
    onSave({
      label: label.trim(),
      days: [],
      start,
      end,
      color,
      tagAffinity: [],
      energyLevel,
      bufferMinutes,
      enabled: true,
      exceptions: {},
      singleDate: dateStr,
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-1">
        <h3 className={`text-lg font-semibold ${textPrimary}`}>{t('frames.newFrame')}</h3>
        <button onClick={onCancel} className={`p-1.5 rounded-lg ${hoverBg} transition-colors`}>
          <X size={18} className={textSecondary} />
        </button>
      </div>

      <div className={`text-xs ${textSecondary} px-1`}>{dateDisplay} only</div>

      {error && <div className="p-2 rounded-lg bg-red-500/10 text-red-500 text-sm">{error}</div>}

      <div>
        <label className={`text-xs font-medium ${textSecondary} block mb-1`}>Name</label>
        <input
          ref={labelRef}
          type="text"
          value={label}
          onChange={e => setLabel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
          placeholder="e.g. Afternoon Focus"
          className={`w-full px-3 py-2 rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-800 text-white' : 'bg-white text-stone-900'} text-sm`}
        />
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label className={`text-xs font-medium ${textSecondary} block mb-1`}>Start</label>
          <button type="button" onClick={() => setTimePickerField('start')}
            className={`w-full px-3 py-2 rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-800 text-white' : 'bg-white text-stone-900'} text-sm text-left`}>
            {formatTime(start)}
          </button>
        </div>
        <div className="flex-1">
          <label className={`text-xs font-medium ${textSecondary} block mb-1`}>End</label>
          <button type="button" onClick={() => setTimePickerField('end')}
            className={`w-full px-3 py-2 rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-800 text-white' : 'bg-white text-stone-900'} text-sm text-left`}>
            {formatTime(end)}
          </button>
        </div>
      </div>

      <div>
        <label className={`text-xs font-medium ${textSecondary} block mb-1`}>Color</label>
        <div className="flex gap-2 flex-wrap">
          {FRAME_COLORS.map(c => (
            <button
              key={c.class}
              onClick={() => setColor(c.class)}
              className={`w-7 h-7 rounded-full ${c.class} ${color === c.class ? 'ring-2 ring-blue-500 ring-offset-2' : ''} transition-all`}
              style={darkMode ? { ringOffsetColor: '#1f2937' } : {}}
              title={c.name}
            />
          ))}
        </div>
      </div>

      <div>
        <label className={`text-xs font-medium ${textSecondary} block mb-1`}>Energy Level</label>
        <div className="flex gap-1">
          {['low', 'medium', 'high'].map(level => (
            <button
              key={level}
              onClick={() => setEnergyLevel(level)}
              className={`flex-1 py-1.5 rounded text-xs font-medium capitalize transition-colors ${energyLevel === level ? 'bg-blue-600 text-white' : darkMode ? 'bg-gray-800 text-gray-400' : 'bg-stone-100 text-stone-500'}`}
            >
              {level}
            </button>
          ))}
        </div>
      </div>

      <button onClick={handleSave} className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
        Create Frame
      </button>
      {timePickerField && (
        <ClockTimePicker
          value={timePickerField === 'start' ? start : end}
          onChange={(t) => { if (timePickerField === 'start') setStart(t); else setEnd(t); setTimePickerField(null); }}
          onClose={() => setTimePickerField(null)}
          darkMode={darkMode} isTablet={isTablet ?? false} use24HourClock={use24HourClock ?? false}
        />
      )}
    </div>
  );
};

export default QuickAddFrameForm;
