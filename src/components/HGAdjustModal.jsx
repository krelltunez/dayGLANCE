import React from 'react';
import ClockTimePicker from './ClockTimePicker.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';

const HGAdjustModal = () => {
  const { darkMode, isTablet, use24HourClock, cardBg, borderClass, textPrimary, textSecondary, hoverBg } = useDayPlannerCtx();
  const { hgAdjustModal, setHgAdjustModal, hgAdjustTimeField, setHgAdjustTimeField, saveHGAdjust } = useFeaturesCtx();

  const [startH, startM] = hgAdjustModal.time.split(':').map(Number);
  const startMins = startH * 60 + startM;
  const endMins = startMins + (hgAdjustModal.duration || 60);
  const endH = Math.floor(endMins / 60) % 24;
  const endM = endMins % 60;
  const endTimeStr = `${endH}:${String(endM).padStart(2, '0')}`;

  const fmt = (h, m) => {
    if (use24HourClock) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const ampm = h < 12 ? 'a' : 'p';
    return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70]" onClick={() => setHgAdjustModal(null)}>
      <div className={`${cardBg} rounded-lg shadow-xl p-5 border ${borderClass} w-72`} onClick={(e) => e.stopPropagation()}>
        <h3 className={`font-semibold ${textPrimary} mb-1`}>Adjust Session Time</h3>
        <p className={`text-xs ${textSecondary} mb-4`}>For {hgAdjustModal.date} only</p>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className={`text-xs font-medium ${textSecondary} block mb-1`}>Start time</label>
            <button
              type="button"
              onClick={() => setHgAdjustTimeField('start')}
              className={`w-full px-3 py-2 rounded-lg border ${borderClass} ${cardBg} ${textPrimary} text-sm text-left`}
            >
              {fmt(startH, startM)}
            </button>
          </div>
          <div className="flex-1">
            <label className={`text-xs font-medium ${textSecondary} block mb-1`}>End time</label>
            <button
              type="button"
              onClick={() => setHgAdjustTimeField('end')}
              className={`w-full px-3 py-2 rounded-lg border ${borderClass} ${cardBg} ${textPrimary} text-sm text-left`}
            >
              {fmt(endH, endM)}
            </button>
          </div>
        </div>
        {hgAdjustTimeField === 'start' && (
          <ClockTimePicker
            value={hgAdjustModal.time}
            onChange={(t) => {
              setHgAdjustModal(prev => ({ ...prev, time: t }));
              setHgAdjustTimeField(null);
            }}
            onClose={() => setHgAdjustTimeField(null)}
            darkMode={darkMode} isTablet={isTablet} use24HourClock={use24HourClock}
          />
        )}
        {hgAdjustTimeField === 'end' && (
          <ClockTimePicker
            value={endTimeStr}
            onChange={(t) => {
              const [eh, em] = t.split(':').map(Number);
              const newDuration = Math.max(15, eh * 60 + em - startMins);
              setHgAdjustModal(prev => ({ ...prev, duration: newDuration }));
              setHgAdjustTimeField(null);
            }}
            onClose={() => setHgAdjustTimeField(null)}
            darkMode={darkMode} isTablet={isTablet} use24HourClock={use24HourClock}
          />
        )}
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => setHgAdjustModal(null)}
            className={`flex-1 px-3 py-2 rounded-lg text-sm ${textSecondary} ${hoverBg} transition-colors`}
          >
            Cancel
          </button>
          <button
            onClick={saveHGAdjust}
            className="flex-1 px-3 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

export default HGAdjustModal;
