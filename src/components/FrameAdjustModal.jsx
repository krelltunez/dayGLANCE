import React from 'react';
import ClockTimePicker from './ClockTimePicker.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

const FrameAdjustModal = () => {
  const {
    frameAdjustModal, setFrameAdjustModal,
    frameAdjustTimeField, setFrameAdjustTimeField,
    saveFrameAdjust,
    darkMode, isTablet, use24HourClock,
    cardBg, borderClass, textPrimary, textSecondary, hoverBg,
  } = useDayPlannerCtx();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70]" onClick={() => setFrameAdjustModal(null)}>
      <div className={`${cardBg} rounded-lg shadow-xl p-5 border ${borderClass} w-72`} onClick={(e) => e.stopPropagation()}>
        <h3 className={`font-semibold ${textPrimary} mb-4`}>Adjust Frame Time</h3>
        <p className={`text-xs ${textSecondary} mb-3`}>For {frameAdjustModal.dateStr} only</p>
        <div className="space-y-3">
          <div>
            <label className={`text-xs font-medium ${textSecondary} block mb-1`}>Start</label>
            <button type="button" onClick={() => setFrameAdjustTimeField('start')}
              className={`w-full px-3 py-2 rounded-lg border ${borderClass} ${cardBg} ${textPrimary} text-sm text-left`}>
              {frameAdjustModal.start}
            </button>
          </div>
          <div>
            <label className={`text-xs font-medium ${textSecondary} block mb-1`}>End</label>
            <button type="button" onClick={() => setFrameAdjustTimeField('end')}
              className={`w-full px-3 py-2 rounded-lg border ${borderClass} ${cardBg} ${textPrimary} text-sm text-left`}>
              {frameAdjustModal.end}
            </button>
          </div>
        </div>
        {frameAdjustTimeField && (
          <ClockTimePicker
            value={frameAdjustTimeField === 'start' ? frameAdjustModal.start : frameAdjustModal.end}
            onChange={(t) => { setFrameAdjustModal(prev => ({ ...prev, [frameAdjustTimeField]: t })); setFrameAdjustTimeField(null); }}
            onClose={() => setFrameAdjustTimeField(null)}
            darkMode={darkMode} isTablet={isTablet} use24HourClock={use24HourClock}
          />
        )}
        <div className="flex gap-2 mt-4">
          <button onClick={() => setFrameAdjustModal(null)} className={`flex-1 px-3 py-2 rounded-lg text-sm ${textSecondary} ${hoverBg} transition-colors`}>Cancel</button>
          <button onClick={saveFrameAdjust} className="flex-1 px-3 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 transition-colors">Save</button>
        </div>
      </div>
    </div>
  );
};

export default FrameAdjustModal;
