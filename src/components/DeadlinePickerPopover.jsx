import React, { useState, useRef, useLayoutEffect, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Calendar, X } from 'lucide-react';
import { dateToString } from '../utils/taskUtils.js';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

const DeadlinePickerPopover = ({ taskId, currentDeadline, onClose }) => {
  const { setDeadline, clearDeadline, cardBg, borderClass, hoverBg, textSecondary, textPrimary, darkMode } = useDayPlannerCtx();

  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarPos, setCalendarPos] = useState({ x: 0, y: 0 });
  const [openAbove, setOpenAbove] = useState(false);
  const popoverRef = useRef(null);
  const [viewDate, setViewDate] = useState(() => {
    if (currentDeadline) {
      const parts = currentDeadline.split('-');
      return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
    }
    return new Date();
  });

  useLayoutEffect(() => {
    if (popoverRef.current && !showCalendar) {
      const rect = popoverRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      setOpenAbove(rect.bottom > viewportHeight - 80);
    }
  }, [showCalendar]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (showCalendar) {
          setShowCalendar(false);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showCalendar, onClose]);

  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const todayStr = dateToString(today);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = dateToString(tomorrow);

  const nextWeek = new Date(today);
  nextWeek.setDate(nextWeek.getDate() + 7);
  const nextWeekStr = dateToString(nextWeek);

  const handleQuickOption = (dateStr) => {
    setDeadline(taskId, dateStr);
  };

  const getDaysInMonth = () => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days = [];
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i));
    }
    return days;
  };

  const changeMonth = (delta) => {
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + delta, 1));
  };

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  if (showCalendar) {
    const days = getDaysInMonth();
    const calWidth = 260;
    const calHeight = 340;
    const pad = 8;
    const clampedLeft = Math.max(pad, Math.min(calendarPos.x - calWidth / 2, window.innerWidth - calWidth - pad));
    const clampedTop = Math.max(pad, Math.min(calendarPos.y - 150, window.innerHeight - calHeight - pad));
    return (
      <div
          className="deadline-picker-container fixed z-[9999]"
          style={{ left: clampedLeft, top: clampedTop }}
        >
        <div
          className={`${cardBg} rounded-lg shadow-xl border ${borderClass} p-3 w-[260px]`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={() => changeMonth(-1)}
              className={`p-1 rounded ${hoverBg}`}
            >
              <ChevronLeft size={16} className={textSecondary} />
            </button>
            <span className={`text-sm font-semibold ${textPrimary}`}>
              {monthNames[viewDate.getMonth()]} {viewDate.getFullYear()}
            </span>
            <button
              onClick={() => changeMonth(1)}
              className={`p-1 rounded ${hoverBg}`}
            >
              <ChevronRight size={16} className={textSecondary} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
              <div key={i} className={`text-center text-xs font-semibold p-1 ${textSecondary}`}>
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {days.map((day, index) => {
              if (!day) {
                return <div key={`empty-${index}`} className="p-1"></div>;
              }
              const dayStr = dateToString(day);
              const isSelected = dayStr === currentDeadline;
              const isToday = dayStr === todayStr;

              return (
                <button
                  key={index}
                  onClick={() => {
                    setDeadline(taskId, dayStr);
                    onClose();
                  }}
                  className={`p-1 text-center text-sm rounded transition-colors ${
                    isSelected
                      ? 'bg-blue-600 text-white font-bold'
                      : isToday
                        ? darkMode ? 'bg-blue-900 text-blue-200 font-semibold' : 'bg-blue-100 text-blue-900 font-semibold'
                        : darkMode
                          ? 'hover:bg-gray-700 text-gray-300'
                          : 'hover:bg-stone-100 text-stone-700'
                  }`}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          <div className={`border-t ${borderClass} mt-2 pt-2 flex gap-2`}>
            <button
              onClick={() => setShowCalendar(false)}
              className={`flex-1 px-2 py-1 text-sm rounded ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} ${textPrimary} ${hoverBg}`}
            >
              Back
            </button>
            {currentDeadline && (
              <button
                onClick={() => {
                  clearDeadline(taskId);
                  onClose();
                }}
                className="flex-1 px-2 py-1 text-sm rounded bg-red-600 text-white hover:bg-red-700"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={popoverRef} className={`deadline-picker-container absolute ${openAbove ? 'bottom-full mb-1' : 'top-full mt-1'} right-0 z-30`}>
      <div
        className={`${cardBg} rounded-lg shadow-xl border ${borderClass} p-2 min-w-[160px]`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-1">
          <button
            onClick={() => handleQuickOption(todayStr)}
            className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}
          >
            <Calendar size={14} />
            Today
          </button>
          <button
            onClick={() => handleQuickOption(tomorrowStr)}
            className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}
          >
            <Calendar size={14} />
            Tomorrow
          </button>
          <button
            onClick={() => handleQuickOption(nextWeekStr)}
            className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}
          >
            <Calendar size={14} />
            Next week
          </button>
          <div className={`border-t ${borderClass} my-1`}></div>
          <button
            onClick={(e) => {
              setCalendarPos({ x: e.clientX, y: e.clientY });
              setShowCalendar(true);
            }}
            className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}
          >
            <Calendar size={14} />
            Pick date...
          </button>
          {currentDeadline && (
            <>
              <div className={`border-t ${borderClass} my-1`}></div>
              <button
                onClick={() => clearDeadline(taskId)}
                className={`w-full text-left px-3 py-2 rounded text-sm text-red-500 ${hoverBg} flex items-center gap-2`}
              >
                <X size={14} />
                Clear deadline
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default DeadlinePickerPopover;
