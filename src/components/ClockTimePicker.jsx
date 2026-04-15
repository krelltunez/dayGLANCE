import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';

const ClockTimePicker = ({ value, onChange, onClose, darkMode, isTablet, use24HourClock }) => {
  const [selectedHour, setSelectedHour] = useState(parseInt(value.split(':')[0]));
  const [selectedMinute, setSelectedMinute] = useState(parseInt(value.split(':')[1]));
  const [isAM, setIsAM] = useState(parseInt(value.split(':')[0]) < 12);
  const [mode, setMode] = useState('hour');

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [onClose]);

  const cardBg = darkMode ? 'bg-gray-800' : 'bg-white';
  const borderClass = darkMode ? 'border-gray-700' : 'border-stone-300';
  const textPrimary = darkMode ? 'text-gray-100' : 'text-stone-900';
  const textSecondary = darkMode ? 'text-gray-400' : 'text-stone-600';
  const hoverBg = darkMode ? 'hover:bg-gray-700' : 'hover:bg-stone-100';

  const clockSize = isTablet ? 280 : 240;
  const cx = clockSize / 2;
  const outerR = isTablet ? 114 : 97;
  const innerR = Math.round(outerR * 0.62);
  const outerBtn = isTablet ? 44 : 36;
  const innerBtn = isTablet ? 36 : 28;

  const handleConfirm = () => {
    onChange(`${selectedHour.toString().padStart(2, '0')}:${selectedMinute.toString().padStart(2, '0')}`);
    onClose();
  };

  const toggleAMPM = () => {
    const newIsAM = !isAM;
    setIsAM(newIsAM);
    if (newIsAM && selectedHour >= 12) setSelectedHour(selectedHour - 12);
    else if (!newIsAM && selectedHour < 12) setSelectedHour(selectedHour + 12);
  };

  const displayHour = use24HourClock
    ? selectedHour.toString().padStart(2, '0')
    : (selectedHour === 0 ? 12 : selectedHour > 12 ? selectedHour - 12 : selectedHour).toString();

  // position on ring: angle in degrees, (0,0) at top, clockwise
  const pos = (angleDeg, r) => ({
    x: cx + r * Math.cos((angleDeg - 90) * Math.PI / 180),
    y: cx + r * Math.sin((angleDeg - 90) * Math.PI / 180),
  });

  const renderClock = () => {
    const faceStyle = {
      background: darkMode
        ? 'radial-gradient(circle at 38% 33%, #374151 0%, #1a2233 80%)'
        : 'radial-gradient(circle at 38% 33%, #ffffff 0%, #dde1e7 80%)',
      boxShadow: darkMode
        ? 'inset 0 3px 12px rgba(0,0,0,0.55), inset 0 -1px 4px rgba(255,255,255,0.04)'
        : 'inset 0 3px 12px rgba(0,0,0,0.09), inset 0 -1px 4px rgba(255,255,255,0.95)',
    };

    if (mode === 'minute') {
      const minutes = Array.from({ length: 12 }, (_, i) => i * 5);
      const handDeg = selectedMinute * 6;
      const { x: hx, y: hy } = pos(handDeg, outerR);
      return (
        <div className="relative rounded-full" style={{ width: clockSize, height: clockSize, ...faceStyle }}>
          <svg width={clockSize} height={clockSize} className="absolute inset-0 pointer-events-none">
            <line x1={cx} y1={cx} x2={hx} y2={hy} stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" opacity="0.65" />
            <circle cx={hx} cy={hy} r="5" fill="#3b82f6" opacity="0.35" />
            <circle cx={cx} cy={cx} r="5" fill="#3b82f6" />
          </svg>
          {minutes.map(min => {
            const { x, y } = pos(min * 6, outerR);
            return (
              <button type="button"key={min} onClick={() => setSelectedMinute(min)}
                className={`absolute rounded-full flex items-center justify-center font-medium transition-all ${isTablet ? 'text-sm' : 'text-xs'} ${min === selectedMinute ? 'bg-blue-600 text-white shadow-md' : darkMode ? 'text-gray-200 hover:bg-white/10' : 'text-stone-700 hover:bg-black/8'}`}
                style={{ width: outerBtn, height: outerBtn, left: x - outerBtn / 2, top: y - outerBtn / 2 }}>
                {min.toString().padStart(2, '0')}
              </button>
            );
          })}
        </div>
      );
    }

    // Hour mode — dual ring in 24hr, single ring in 12hr
    if (use24HourClock) {
      let handDeg, handR;
      if (selectedHour === 12) { handDeg = 0; handR = outerR; }
      else if (selectedHour >= 1 && selectedHour <= 11) { handDeg = selectedHour * 30; handR = outerR; }
      else if (selectedHour === 0) { handDeg = 0; handR = innerR; }
      else { handDeg = (selectedHour - 12) * 30; handR = innerR; }
      const { x: hx, y: hy } = pos(handDeg, handR);

      return (
        <div className="relative rounded-full" style={{ width: clockSize, height: clockSize, ...faceStyle }}>
          <svg width={clockSize} height={clockSize} className="absolute inset-0 pointer-events-none">
            <line x1={cx} y1={cx} x2={hx} y2={hy} stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" opacity="0.65" />
            <circle cx={hx} cy={hy} r="5" fill="#3b82f6" opacity="0.35" />
            <circle cx={cx} cy={cx} r="5" fill="#3b82f6" />
          </svg>
          {Array.from({ length: 12 }, (_, i) => {
            const label = i === 0 ? 12 : i;
            const { x, y } = pos(i * 30, outerR);
            const sel = label === 12 ? selectedHour === 12 : selectedHour === label;
            return (
              <button type="button"key={`o${label}`} onClick={() => { setSelectedHour(label); setMode('minute'); }}
                className={`absolute rounded-full flex items-center justify-center font-medium transition-all ${isTablet ? 'text-sm' : 'text-xs'} ${sel ? 'bg-blue-600 text-white shadow-md' : darkMode ? 'text-gray-200 hover:bg-white/10' : 'text-stone-700 hover:bg-black/8'}`}
                style={{ width: outerBtn, height: outerBtn, left: x - outerBtn / 2, top: y - outerBtn / 2 }}>
                {label}
              </button>
            );
          })}
          {Array.from({ length: 12 }, (_, i) => {
            const label = i === 0 ? 0 : i + 12;
            const { x, y } = pos(i * 30, innerR);
            const sel = selectedHour === label;
            return (
              <button type="button"key={`i${label}`} onClick={() => { setSelectedHour(label); setMode('minute'); }}
                className={`absolute rounded-full flex items-center justify-center transition-all ${isTablet ? 'text-xs' : 'text-[10px]'} ${sel ? 'bg-blue-600 text-white shadow-md' : darkMode ? 'text-gray-400 hover:bg-white/10' : 'text-stone-500 hover:bg-black/8'}`}
                style={{ width: innerBtn, height: innerBtn, left: x - innerBtn / 2, top: y - innerBtn / 2 }}>
                {label.toString().padStart(2, '0')}
              </button>
            );
          })}
        </div>
      );
    }

    // 12hr mode: single outer ring 12, 1–11
    const hour12 = selectedHour === 0 ? 12 : selectedHour > 12 ? selectedHour - 12 : selectedHour;
    const handDeg = (hour12 % 12) * 30;
    const { x: hx, y: hy } = pos(handDeg, outerR);
    return (
      <div className="relative rounded-full" style={{ width: clockSize, height: clockSize, ...faceStyle }}>
        <svg width={clockSize} height={clockSize} className="absolute inset-0 pointer-events-none">
          <line x1={cx} y1={cx} x2={hx} y2={hy} stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" opacity="0.65" />
          <circle cx={hx} cy={hy} r="5" fill="#3b82f6" opacity="0.35" />
          <circle cx={cx} cy={cx} r="5" fill="#3b82f6" />
        </svg>
        {[12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((label, i) => {
          const { x, y } = pos(i * 30, outerR);
          const sel = hour12 === label;
          return (
            <button type="button"key={label} onClick={() => {
              const h24 = isAM ? (label === 12 ? 0 : label) : (label === 12 ? 12 : label + 12);
              setSelectedHour(h24); setMode('minute');
            }}
              className={`absolute rounded-full flex items-center justify-center font-medium transition-all ${isTablet ? 'text-sm' : 'text-xs'} ${sel ? 'bg-blue-600 text-white shadow-md' : darkMode ? 'text-gray-200 hover:bg-white/10' : 'text-stone-700 hover:bg-black/8'}`}
              style={{ width: outerBtn, height: outerBtn, left: x - outerBtn / 2, top: y - outerBtn / 2 }}>
              {label}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[90]" onClick={onClose}>
      <div className={`${cardBg} rounded-3xl shadow-2xl ${isTablet ? 'p-7' : 'p-5'}`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className={`${isTablet ? 'text-base' : 'text-sm'} font-semibold tracking-wide uppercase ${textSecondary}`}>Select Time</h3>
          <button type="button"onClick={onClose} className={`${isTablet ? 'p-2' : 'p-1'} rounded-full ${hoverBg} transition-colors`}>
            <X size={isTablet ? 20 : 17} className={textSecondary} />
          </button>
        </div>

        <div className="flex justify-center mb-5">
          <div className={`flex items-center gap-1 px-4 py-2 rounded-2xl ${darkMode ? 'bg-gray-900/60' : 'bg-stone-100'}`}>
            <button type="button"onClick={() => setMode('hour')}
              className={`${isTablet ? 'text-4xl w-16' : 'text-3xl w-12'} font-bold rounded-xl py-1 text-center transition-colors ${mode === 'hour' ? 'bg-blue-600 text-white' : textPrimary}`}>
              {displayHour}
            </button>
            <span className={`${isTablet ? 'text-4xl' : 'text-3xl'} font-bold ${textSecondary} select-none`}>:</span>
            <button type="button"onClick={() => setMode('minute')}
              className={`${isTablet ? 'text-4xl w-16' : 'text-3xl w-12'} font-bold rounded-xl py-1 text-center transition-colors ${mode === 'minute' ? 'bg-blue-600 text-white' : textPrimary}`}>
              {selectedMinute.toString().padStart(2, '0')}
            </button>
            {!use24HourClock && (
              <button type="button"onClick={toggleAMPM}
                className={`${isTablet ? 'text-base px-3 py-2' : 'text-sm px-2.5 py-1.5'} font-semibold rounded-xl ml-1 transition-colors ${darkMode ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-white text-stone-600 hover:bg-stone-200 shadow-sm'}`}>
                {isAM ? 'AM' : 'PM'}
              </button>
            )}
          </div>
        </div>

        <div className="flex justify-center mb-5">{renderClock()}</div>

        <div className={`flex gap-2`}>
          <button type="button"onClick={onClose} className={`flex-1 ${isTablet ? 'py-3 text-base' : 'py-2.5 text-sm'} rounded-2xl font-medium ${darkMode ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'} transition-colors`}>Cancel</button>
          <button type="button"onClick={handleConfirm} className={`flex-1 ${isTablet ? 'py-3 text-base' : 'py-2.5 text-sm'} bg-blue-600 text-white rounded-2xl font-medium hover:bg-blue-700 transition-colors`}>OK</button>
        </div>
      </div>
    </div>
  );
};

export default ClockTimePicker;
