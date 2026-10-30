import React from 'react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import SuggestionAutocomplete from './SuggestionAutocomplete.jsx';

// The inline rename field a task card draws in place of its title while it is
// being renamed (#2263): a double-click on the title, or the task menu's
// Rename on a card that claims `inlineRename`. One component for the timeline
// cards, the all-day cards and the desktop Inbox row, which each had a copy.
//
// Enter saves and Escape cancels (handleEditKeyDown); a blur saves unless the
// tag suggestions are open, so picking one does not end the rename. The input
// is the one `editingInputRef` names, which the suggestion pick uses to put the
// cursor after what it inserted: none of the copies attached it, so the pick
// never placed the cursor.
const TaskTitleRenameField = ({ isInbox = false, weight = 'font-semibold' }) => {
  const {
    editingTaskText, editingInputRef,
    handleEditInputChange, handleEditKeyDown, saveTaskTitle, applySuggestionForEdit,
    showSuggestions, suggestions, selectedSuggestionIndex, suggestionContext,
    cardBg, borderClass, textPrimary, hoverBg,
  } = useDayPlannerCtx();
  return (
    <div className="relative tag-autocomplete-container" data-task-rename>
      <input
        ref={editingInputRef}
        type="text"
        value={editingTaskText}
        onChange={(e) => handleEditInputChange(e, isInbox)}
        onKeyDown={(e) => handleEditKeyDown(e, isInbox)}
        onBlur={() => {
          setTimeout(() => {
            if (!showSuggestions) saveTaskTitle(isInbox);
          }, 100);
        }}
        autoFocus
        className={`w-full bg-white/20 text-white ${weight} text-sm px-1 py-0.5 rounded border border-white/30 outline-none focus:bg-white/30`}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      />
      {showSuggestions && suggestionContext === 'editing' && (
        <SuggestionAutocomplete
          suggestions={suggestions}
          selectedIndex={selectedSuggestionIndex}
          onSelect={(suggestion) => applySuggestionForEdit(suggestion, editingInputRef?.current, isInbox)}
          cardBg={cardBg}
          borderClass={borderClass}
          textPrimary={textPrimary}
          hoverBg={hoverBg}
        />
      )}
    </div>
  );
};

export default TaskTitleRenameField;
