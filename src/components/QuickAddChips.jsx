import React from 'react';
import { Calendar, Clock, Hash, Repeat, Timer, X } from 'lucide-react';

// Chip row for natural-language quick-add parses ("dentist tomorrow 3pm every
// 2 weeks" → Tomorrow / 3:00 PM / Every 2 weeks). Rendered under the title
// input in the new-task modals. Tapping a chip undoes that parse: the phrase
// stays as plain title text and the auto-applied field reverts
// (useNewTaskInput.dismissNlChip).

const ICONS = {
  date: Calendar,
  time: Clock,
  timerange: Clock,
  recurrence: Repeat,
  duration: Timer,
  tag: Hash,
};

const QuickAddChips = ({ chips, onDismiss, darkMode }) => {
  if (!chips || chips.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Detected task details">
      {chips.map((chip) => {
        const Icon = ICONS[chip.type] || Calendar;
        const label = chip.inboxDate ? `Deadline: ${chip.display}` : chip.display;
        return (
          <button
            key={`${chip.sig}-${chip.start}`}
            type="button"
            onClick={() => onDismiss(chip)}
            // Keep focus in the title input while dismissing
            onMouseDown={(e) => e.preventDefault()}
            title={`Remove: ${label}`}
            className={`inline-flex items-center gap-1 rounded-full pl-2 pr-1.5 py-0.5 text-xs font-medium transition-colors ${
              darkMode
                ? 'bg-blue-500/15 text-blue-300 hover:bg-blue-500/25'
                : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
            }`}
          >
            <Icon size={11} className="flex-shrink-0 opacity-70" />
            <span>{label}</span>
            <X size={11} className="flex-shrink-0 opacity-50" />
          </button>
        );
      })}
    </div>
  );
};

export default QuickAddChips;
