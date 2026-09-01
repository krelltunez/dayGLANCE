import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useTranslation } from 'react-i18next';

const PHASE_KEYS = { work: 'focus.work', shortBreak: 'focus.shortBreak', longBreak: 'focus.longBreak' };
const PHASE_COLORS = {
  work: 'bg-blue-500/20 text-blue-400',
  shortBreak: 'bg-green-500/20 text-green-400',
  longBreak: 'bg-emerald-500/20 text-emerald-400',
};

function fmt(seconds) {
  const m = Math.floor(Math.max(0, seconds) / 60);
  const s = Math.max(0, seconds) % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function TrayFocus({ darkMode, focusState }) {
  const { textPrimary, textSecondary } = useDayPlannerCtx();
  const { t } = useTranslation();
  const { phase, secondsRemaining, cycleCount } = focusState;

  const stop = () => window.electronAPI?.backgroundAction({ action: 'focus-stop' });
  const skip = () => window.electronAPI?.backgroundAction({ action: 'focus-skip' });

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 pb-6 gap-4">
      <div className={`px-3 py-1 rounded-full text-xs font-semibold ${PHASE_COLORS[phase] ?? 'bg-blue-500/20 text-blue-400'}`}>
        {t(PHASE_KEYS[phase], { defaultValue: phase })}
      </div>

      <div className={`text-5xl font-bold tabular-nums tracking-tight ${textPrimary}`}>
        {fmt(secondsRemaining)}
      </div>

      {cycleCount > 0 && (
        <div className={`text-xs ${textSecondary}`}>
          {t('focus.cyclesCompleted', { count: cycleCount })}
        </div>
      )}

      <div className="flex gap-2 w-full mt-2">
        <button
          onClick={stop}
          className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-70 ${
            darkMode ? 'bg-white/10 text-gray-300' : 'bg-black/5 text-stone-600'
          }`}
        >
          {t('focus.stop')}
        </button>
        <button
          onClick={skip}
          className="flex-1 py-2.5 rounded-lg text-sm font-semibold bg-blue-500 text-white transition-opacity hover:opacity-90"
        >
          {t('common.skip')}
        </button>
      </div>
    </div>
  );
}
