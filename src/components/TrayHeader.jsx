import { useState } from 'react';
import { Search, Mic } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';

export default function TrayHeader({ darkMode, onSearchClick, onVoiceClick }) {
  const { setUnscheduledTasks, borderClass } = useDayPlannerCtx();
  const { aiConfig, voiceCanRecord } = useFeaturesCtx();
  const [text, setText] = useState('');

  const commit = () => {
    const title = text.trim();
    if (!title) return;
    setUnscheduledTasks(prev => [...prev, {
      id: crypto.randomUUID(),
      title,
      duration: 30,
      color: 'bg-blue-500',
      completed: false,
      isAllDay: false,
      notes: '',
      subtasks: [],
      priority: 0,
    }]);
    setText('');
    // Notify the main window to re-read inbox from localStorage so it sees
    // the new task without needing a restart.
    window.electronAPI?.backgroundAction({ action: 'refresh-inbox' });
  };

  const showVoice = aiConfig?.enabled && aiConfig?.features?.voiceTaskInput && voiceCanRecord;

  return (
    <div className={`flex-shrink-0 px-3 pt-3 pb-2 border-b ${borderClass}`}>
      <div className="flex items-center gap-1.5">
        <input
          className={`flex-1 text-sm px-3 py-2 rounded-lg outline-none ${
            darkMode
              ? 'bg-white/10 text-white placeholder-gray-500'
              : 'bg-black/5 text-stone-900 placeholder-stone-400'
          }`}
          placeholder="Add to inbox…"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setText(''); }}
        />
        <button
          onClick={onSearchClick}
          className={`flex-shrink-0 p-2 rounded-lg transition-opacity hover:opacity-70 ${
            darkMode ? 'bg-white/10 text-gray-400' : 'bg-black/5 text-stone-500'
          }`}
          title="Search tasks"
        >
          <Search size={16} />
        </button>
        {showVoice && (
          <button
            onClick={onVoiceClick}
            className={`flex-shrink-0 p-2 rounded-lg transition-opacity hover:opacity-70 ${
              darkMode ? 'bg-white/10 text-purple-400' : 'bg-black/5 text-purple-600'
            }`}
            title="Voice input"
          >
            <Mic size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
