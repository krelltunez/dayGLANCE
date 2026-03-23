import React from 'react';
import { Calendar, Clock, AlertCircle, Hash } from 'lucide-react';

const SuggestionAutocomplete = ({ suggestions, selectedIndex, onSelect, cardBg, borderClass, textPrimary, hoverBg }) => {
  if (suggestions.length === 0) return null;

  const getIcon = (type) => {
    switch (type) {
      case 'date': return <Calendar size={14} className="flex-shrink-0" />;
      case 'deadline': return <Calendar size={14} className="flex-shrink-0" />;
      case 'time': return <Clock size={14} className="flex-shrink-0" />;
      case 'duration': return <Clock size={14} className="flex-shrink-0" />;
      case 'priority': return <AlertCircle size={14} className="flex-shrink-0" />;
      default: return <Hash size={14} className="flex-shrink-0" />;
    }
  };

  return (
    <div className={`absolute top-full left-0 mt-1 ${cardBg} rounded-lg p-1 z-50 shadow-xl border ${borderClass} min-w-[160px] max-h-40 overflow-y-auto`}>
      {suggestions.map((suggestion, index) => (
        <button
          key={`${suggestion.type}-${suggestion.value}-${index}`}
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSelect(suggestion);
          }}
          onMouseDown={(e) => e.preventDefault()} // Prevent blur before click
          className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 ${
            index === selectedIndex
              ? 'bg-blue-500 text-white'
              : `${textPrimary} ${hoverBg}`
          }`}
        >
          {getIcon(suggestion.type)}
          <span className="truncate">{suggestion.display}</span>
        </button>
      ))}
    </div>
  );
};

export default SuggestionAutocomplete;
