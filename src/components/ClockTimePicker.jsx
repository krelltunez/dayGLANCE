import React, { useState, useEffect, useRef } from 'react';
import { Clock, Keyboard, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { minuteAtPoint, parseTimeInput } from '../utils/timeInput.js';

// Any minute, not only the face's 5-minute marks (#2249): drag the minute
// hand (or press anywhere on the ring), step with the arrow keys, or type the
// time (the keyboard button, like Android's own picker).

const ClockTimePicker = ({ value, onChange, onClose, darkMode, isTablet, use24HourClock }) => {
  const { t, i18n } = useTranslation();
  const [selectedHour, setSelectedHour] = useState(parseInt(value.split(':')[0]));
  const [selectedMinute, setSelectedMinute] = useState(parseInt(value.split(':')[1]));
  const [isAM, setIsAM] = useState(parseInt(value.split(':')[0]) < 12);
  const [mode, setMode] = useState('hour');
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const [typedInvalid, setTypedInvalid] = useState(false);
  const faceRef = useRef(null);
  const draggingRef = useRef(false);

  // Up and Down step the hour or the minute being set by one.
  const step = (delta) => {
    if (mode === 'minute') setSelectedMinute((m) => (m + delta + 60) % 60);
    else {
      setSelectedHour((h) => {
        const next = (h + delta + 24) % 24;
        setIsAM(next < 12);
        return next;
      });
    }
  };
  const stepRef = useRef(step);
  stepRef.current = step;
  const typingRef = useRef(typing);
  typingRef.current = typing;

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (typingRef.current) return;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        stepRef.current(e.key === 'ArrowUp' ? 1 : -1);
      }
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
    if (typing) {
      const time = readTyped();
      if (!time) { setTypedInvalid(true); return; }
      onChange(time);
      onClose();
      return;
    }
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
  const dayPeriod = new Intl.DateTimeFormat(i18n.resolvedLanguage || i18n.language, {
    hour: 'numeric',
    hour12: true,
    timeZone: 'UTC',
  }).formatToParts(new Date(Date.UTC(2024, 0, 1, isAM ? 9 : 15)))
    .find(({ type }) => type === 'dayPeriod')?.value || (isAM ? 'AM' : 'PM');
  // The language's own AM and PM, for a typed time ("下午4:53").
  const periodOf = (hour) => new Intl.DateTimeFormat(i18n.resolvedLanguage || i18n.language, { hour: 'numeric', hour12: true, timeZone: 'UTC' })
    .formatToParts(new Date(Date.UTC(2024, 0, 1, hour))).find(({ type }) => type === 'dayPeriod')?.value;
  const readTyped = () => parseTimeInput(typed, {
    use24HourClock, defaultPm: !isAM, dayPeriods: { am: periodOf(9), pm: periodOf(15) },
  });
  const minuteText = selectedMinute.toString().padStart(2, '0');
  const shownTime = use24HourClock ? `${displayHour}:${minuteText}` : `${displayHour}:${minuteText} ${dayPeriod}`;
  const toggleTyping = () => {
    if (typing) {
      // Back to the clock, carrying a valid typed time onto it.
      const time = readTyped();
      if (time) {
        const [h, m] = time.split(':').map(Number);
        setSelectedHour(h); setSelectedMinute(m); setIsAM(h < 12);
      }
      setTyping(false);
    } else {
      setTyped(shownTime);
      setTypedInvalid(false);
      setTyping(true);
    }
  };

  // The minute face: a press or a drag anywhere on it sets the minute it points at.
  const minuteFromPointer = (e) => {
    const rect = faceRef.current?.getBoundingClientRect();
    if (!rect) return;
    setSelectedMinute(minuteAtPoint(e.clientX - (rect.left + rect.width / 2), e.clientY - (rect.top + rect.height / 2)));
  };
  const faceHandlers = {
    onPointerDown: (e) => { draggingRef.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); minuteFromPointer(e); },
    onPointerMove: (e) => { if (draggingRef.current) minuteFromPointer(e); },
    onPointerUp: (e) => { draggingRef.current = false; e.currentTarget.releasePointerCapture?.(e.pointerId); },
    onPointerCancel: () => { draggingRef.current = false; },
  };

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
      const offMark = selectedMinute % 5 !== 0;
      return (
        <div ref={faceRef} data-minute-face className="relative rounded-full cursor-pointer select-none" style={{ width: clockSize, height: clockSize, touchAction: 'none', ...faceStyle }} {...faceHandlers}>
          <svg width={clockSize} height={clockSize} className="absolute inset-0 pointer-events-none">
            <line x1={cx} y1={cx} x2={hx} y2={hy} stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" opacity="0.65" />
            <circle cx={hx} cy={hy} r={offMark ? 7 : 5} fill="#3b82f6" opacity={offMark ? 1 : 0.35} />
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
          <h3 className={`${isTablet ? 'text-base' : 'text-sm'} font-semibold tracking-wide uppercase ${textSecondary}`}>{t('shortcuts.setTime')}</h3>
          <div className="flex items-center gap-1">
            <button type="button" data-time-type-toggle onClick={toggleTyping}
              aria-label={typing ? t('task.useClock') : t('task.typeTime')} title={typing ? t('task.useClock') : t('task.typeTime')}
              className={`${isTablet ? 'p-2' : 'p-1'} rounded-full ${hoverBg} transition-colors`}>
              {typing ? <Clock size={isTablet ? 20 : 17} className={textSecondary} /> : <Keyboard size={isTablet ? 20 : 17} className={textSecondary} />}
            </button>
            <button type="button"onClick={onClose} className={`${isTablet ? 'p-2' : 'p-1'} rounded-full ${hoverBg} transition-colors`}>
              <X size={isTablet ? 20 : 17} className={textSecondary} />
            </button>
          </div>
        </div>

        {typing ? (
          <div className="mb-5 flex flex-col items-center gap-2" style={{ width: clockSize }}>
            <input
              type="text"
              autoFocus
              data-time-typed
              value={typed}
              onChange={(e) => { setTyped(e.target.value); setTypedInvalid(false); }}
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleConfirm(); } }}
              aria-label={t('task.typeTime')}
              aria-invalid={typedInvalid || undefined}
              placeholder={shownTime}
              className={`w-full text-center ${isTablet ? 'text-3xl' : 'text-2xl'} font-bold rounded-2xl px-3 py-3 outline-none ${darkMode ? 'bg-gray-900/60 text-gray-100' : 'bg-stone-100 text-stone-900'} ${typedInvalid ? 'ring-2 ring-red-500' : 'focus:ring-2 focus:ring-blue-500'}`}
            />
          </div>
        ) : (<>

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
                {dayPeriod}
              </button>
            )}
          </div>
        </div>

        <div className="flex justify-center mb-5">{renderClock()}</div>
        </>)}

        <div className={`flex gap-2`}>
          <button type="button"onClick={onClose} className={`flex-1 ${isTablet ? 'py-3 text-base' : 'py-2.5 text-sm'} rounded-2xl font-medium ${darkMode ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'} transition-colors`}>{t('common.cancel')}</button>
          <button type="button"onClick={handleConfirm} className={`flex-1 ${isTablet ? 'py-3 text-base' : 'py-2.5 text-sm'} bg-blue-600 text-white rounded-2xl font-medium hover:bg-blue-700 transition-colors`}>{t('common.ok')}</button>
        </div>
      </div>
    </div>
  );
};

export default ClockTimePicker;
