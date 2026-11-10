import React, { useState } from 'react';
import { Timer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { formatDuration } from '../utils/formatDuration.js';
import {
  DEFAULT_TASK_DURATION_OPTIONS, readDefaultTaskDuration, writeDefaultTaskDuration,
} from '../utils/defaultTaskDuration.js';

/**
 * Settings › General › New tasks: how long a task is when nobody gives it a
 * length (utils/defaultTaskDuration.js), on this device. Every path that makes
 * a task reads it when it does, so there is no app state to keep in step.
 */
export default function DefaultDurationSetting() {
  const { t } = useTranslation();
  const { darkMode, borderClass, textPrimary, textSecondary } = useDayPlannerCtx();
  const [minutes, setMinutes] = useState(() => readDefaultTaskDuration());

  return (
    <div className="space-y-3" data-default-duration-setting>
      <label htmlFor="default-task-duration" className={`font-medium ${textPrimary} flex items-center gap-2`}>
        <Timer size={16} className={textSecondary} />
        {t('settings.defaultDuration')}
      </label>
      <div>
        <select
          id="default-task-duration"
          value={minutes}
          onChange={(e) => setMinutes(writeDefaultTaskDuration(Number(e.target.value)))}
          className={`px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
        >
          {DEFAULT_TASK_DURATION_OPTIONS.map((m) => (
            <option key={m} value={m}>{formatDuration(m, t)}</option>
          ))}
        </select>
        <p className={`text-xs ${textSecondary} mt-1`}>{t('settings.defaultDurationHint')}</p>
      </div>
    </div>
  );
}
