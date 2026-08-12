import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Mic } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { useMcpStatus, McpBoltButton, McpStatusPanel } from './McpStatusControls.jsx';

export default function TrayHeader({ darkMode, onSearchClick, onVoiceClick }) {
  const { setUnscheduledTasks, borderClass } = useDayPlannerCtx();
  const { aiConfig, voiceCanRecord } = useFeaturesCtx();
  const [text, setText] = useState('');
  const inputRef = useRef(null);
  const mcp = useMcpStatus();
  const [mcpOpen, setMcpOpen] = useState(false);

  useEffect(() => {
    if (!window.electronAPI?.onFocusQuickAdd) return;
    return window.electronAPI.onFocusQuickAdd(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  // The popup always opens collapsed (§6.5 restructure): expanded state never
  // persists across hide/show, which a reload alone would not guarantee — the
  // popup only reloads when data changed while it was open.
  useEffect(() => {
    if (!window.electronAPI?.onTrayVisibility) return;
    return window.electronAPI.onTrayVisibility((visible) => {
      if (!visible) setMcpOpen(false);
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
    <div className={`flex-shrink-0 border-b ${borderClass}`}>
      <div className="px-3 pt-3 pb-2 flex items-center gap-1.5">
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
        {/* §6.5 ambient signal: visible only while the MCP listener is bound */}
        <McpBoltButton mcp={mcp} darkMode={darkMode} open={mcpOpen} onToggle={() => setMcpOpen((v) => !v)} variant="tray" />
      </div>
      {/* Inline expansion below the row — pushes popup content down, no popover */}
      <McpStatusPanel mcp={mcp} darkMode={darkMode} open={mcpOpen} borderClass={borderClass} />
    </div>
  );
}
