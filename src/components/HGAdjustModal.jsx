import React from 'react';
import ClockTimePicker from './ClockTimePicker.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';

const HGAdjustModal = () => {
  const { darkMode, isTablet, use24HourClock, cardBg, borderClass, textPrimary, textSecondary, hoverBg } = useDayPlannerCtx();
  const { hgAdjustModal, setHgAdjustModal, hgAdjustTimeField, setHgAdjustTimeField, saveHGAdjust } = useFeaturesCtx();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70]" onClick={() => setHgAdjustModal(null)}>
      <div className={`${cardBg} rounded-lg shadow-xl p-5 border ${borderClass} w-72`} onClick={(e) => e.stopPropagation()}>
        <h3 className={`font-semibold ${textPrimary} mb-1`}>Adjust Session Time</h3>
        <p className={`text-xs ${textSecondary} mb-4`}>For {hgAdjustModal.date} only</p>
        <div>
          <label className={`text-xs font-medium ${textSecondary} block mb-1`}>Start time</label>
          <button
            type="button"
            onClick={() => setHgAdjustTimeField('start')}
            className={`w-full px-3 py-2 rounded-lg border ${borderClass} ${cardBg} ${textPrimary} text-sm text-left`}
          >
            {hgAdjustModal.time}
          </button>
        </div>
        {hgAdjustTimeField && (
          <ClockTimePicker
            value={hgAdjustModal.time}
            onChange={(t) => { setHgAdjustModal(prev => ({ ...prev, time: t })); setHgAdjustTimeField(null); }}
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
