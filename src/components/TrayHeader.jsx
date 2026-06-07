import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Mic } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';

export default function TrayHeader({ darkMode, onSearchClick, onVoiceClick }) {
  const { setUnscheduledTasks, borderClass } = useDayPlannerCtx();
  const { aiConfig, voiceCanRecord } = useFeaturesCtx();
  const [text, setText] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!window.electronAPI?.onFocusQuickAdd) return;
    return window.electronAPI.onFocusQuickAdd(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  const commit = () => {
    const title = text.trim();
    if (!title) return;
    const newTask = {
      id: crypto.randomUUID(),
      title,
      duration: 30,
      color: 'bg-blue-500',
      completed: false,
      isAllDay: false,
      notes: '',
      subtasks: [],
      priority: 0,
    };
    setUnscheduledTasks(prev => [...prev, newTask]);
    setText('');
    // Send the task directly in the payload so the main window doesn't race
    // against the tray's async localStorage write.
    window.electronAPI?.backgroundAction({ action: 'add-inbox-task', task: newTask });
  };

  const showVoice = aiConfig?.enabled && aiConfig?.features?.voiceTaskInput && voiceCanRecord;

  return (
    <div className={`flex-shrink-0 px-3 pt-3 pb-2 border-b ${borderClass}`}>
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
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
