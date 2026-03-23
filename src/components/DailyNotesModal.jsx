import React, { useState, useEffect, useRef } from 'react';
import { NotebookPen, X, Loader } from 'lucide-react';
import { renderFormattedText } from '../utils/textFormatting.jsx';

// Daily Notes Modal — popover for adding/editing notes on a specific date
const DailyNotesModal = ({ dateStr, note, onSave, onClose, darkMode, isMobile, template, loadFresh }) => {
  const defaultText = note?.text || '';
  const [localText, setLocalText] = useState(defaultText);
  const [isEditing, setIsEditing] = useState(!note?.text);
  const [loading, setLoading] = useState(!!loadFresh);

  // With windowSoftInputMode="adjustNothing" the layout viewport is never resized.
  // Track the software keyboard height via visualViewport so the bottom sheet
  // content can be pushed above the keyboard.
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  useEffect(() => {
    if (!isMobile || !window.visualViewport) return;
    const update = () => {
      setKeyboardOffset(Math.max(0, window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop));
    };
    window.visualViewport.addEventListener('resize', update);
    window.visualViewport.addEventListener('scroll', update);
    update(); // capture current state on mount
    return () => {
      window.visualViewport.removeEventListener('resize', update);
      window.visualViewport.removeEventListener('scroll', update);
    };
  }, [isMobile]);
  // Tracks whether loadFresh resolved; save-on-unmount is skipped until it does
  // so a close during loading never overwrites vault content with stale/empty state.
  const freshLoadedRef = useRef(!loadFresh);
  // Set to true when handleSaveAndClose (or keyboard shortcuts) explicitly save,
  // so the unmount effect doesn't trigger a redundant second setDailyNotes re-render.
  const savedOnCloseRef = useRef(false);

  // If an async loadFresh callback is provided (Obsidian), read fresh content on mount
  useEffect(() => {
    if (!loadFresh) return;
    let cancelled = false;
    (async () => {
      try {
        const fresh = await loadFresh(dateStr);
        if (cancelled) return;
        if (fresh && fresh.text) {
          setLocalText(fresh.text);
          setIsEditing(false);
        } else {
          // No existing note — apply template if available
          if (template) {
            setLocalText(template);
          }
          setIsEditing(true);
        }
      } catch (err) {
        console.error('Failed to load fresh note from vault:', err);
      } finally {
        if (!cancelled) {
          setLoading(false);
          freshLoadedRef.current = true;
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // For non-Obsidian: apply template on mount when note is empty
  useEffect(() => {
    if (loadFresh) return; // Obsidian path handles this above
    if (!defaultText && template) {
      setLocalText(template);
    }
  }, []);
  const localTextRef = useRef(localText);
  const onSaveRef = useRef(onSave);
  const dateStrRef = useRef(dateStr);
  const backdropRef = useRef(null);

  useEffect(() => { localTextRef.current = localText; }, [localText]);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);
  useEffect(() => { dateStrRef.current = dateStr; }, [dateStr]);

  // Focus backdrop when in preview mode (for Escape key) — on mount and after Shift+Enter
  useEffect(() => {
    if (!isEditing && backdropRef.current) backdropRef.current.focus();
  }, [isEditing]);

  // Save on unmount — skip if loadFresh never resolved to avoid overwriting vault
  // content with the stale initial empty state, and skip if already saved on close
  // to avoid a redundant setDailyNotes re-render after the modal has dismissed.
  useEffect(() => {
    return () => {
      if (freshLoadedRef.current && !savedOnCloseRef.current) {
        onSaveRef.current(dateStrRef.current, localTextRef.current);
      }
    };
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      onSave(dateStr, localText);
      if (localText.trim()) {
        setIsEditing(false);
      } else {
        onClose();
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (!loading) {
        savedOnCloseRef.current = true;
        onSave(dateStr, localText);
      }
      onClose();
    }
  };

  const handleBlur = () => {
    // Skip if we're already in the close flow — handleSaveAndClose handles the save.
    if (loading || savedOnCloseRef.current) return;
    onSave(dateStr, localText);
  };

  // Skip save if loadFresh hasn't resolved yet to prevent wiping vault content.
  const handleSaveAndClose = () => {
    // Mark as closing BEFORE blurring so handleBlur (which fires synchronously
    // from the blur event) knows to skip its own save call.
    savedOnCloseRef.current = true;
    // Explicitly blur the focused element to start the Android soft-keyboard
    // dismiss animation as early as possible, before React unmounts the modal.
    if (typeof document !== 'undefined' && document.activeElement) {
      document.activeElement.blur();
    }
    if (!loading) {
      onSave(dateStr, localText);
    }
    onClose();
  };

  const cardBg = darkMode ? 'bg-gray-800' : 'bg-white';
  const borderClass = darkMode ? 'border-gray-700' : 'border-stone-300';
  const textPrimary = darkMode ? 'text-gray-100' : 'text-stone-900';
  const textSecondary = darkMode ? 'text-gray-400' : 'text-stone-600';
  const hoverBg = darkMode ? 'hover:bg-gray-700' : 'hover:bg-stone-100';

  // Format date for display
  const displayDate = (() => {
    const d = new Date(dateStr + 'T12:00:00');
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`;
  })();

  if (isMobile) {
    // Bottom sheet style for mobile
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col justify-end"
        style={keyboardOffset > 0 ? { paddingBottom: `${keyboardOffset}px` } : undefined}
        onClick={handleSaveAndClose}
      >
        <div className="bg-black/30 absolute inset-0" />
        <div
          className={`relative ${cardBg} rounded-t-2xl shadow-xl max-h-[70vh] overflow-y-auto`}
          style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={`flex items-center justify-between p-4 border-b ${borderClass}`}>
            <div className="flex items-center gap-2">
              <NotebookPen size={18} className={textSecondary} />
              <span className={`font-medium ${textPrimary}`}>Daily Note — {displayDate}</span>
            </div>
            <button onClick={handleSaveAndClose} className={`p-1 rounded-lg ${hoverBg} transition-colors`} aria-label="Close daily notes">
              <X size={18} className={textSecondary} />
            </button>
          </div>
          <div className="p-4">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader size={22} className={`animate-spin ${textSecondary}`} />
              </div>
            ) : isEditing ? (
              <textarea
                value={localText}
                onChange={(e) => setLocalText(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleBlur}
                placeholder="Add daily notes... (**bold**, *italic*, __underline__, URLs) — Shift+Enter for preview"
                className={`w-full ${darkMode ? 'bg-gray-700 text-gray-100 border-gray-600 placeholder:text-gray-500' : 'bg-stone-50 text-stone-900 border-stone-300 placeholder:text-stone-400'} text-sm px-3 py-2.5 rounded-lg border outline-none focus:ring-2 focus:ring-blue-500 resize-y`}
                rows={8}
                autoFocus
              />
            ) : (
              <div
                onClick={() => setIsEditing(true)}
                className={`text-sm whitespace-pre-wrap cursor-text min-h-[12rem] p-3 rounded-lg ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-50 hover:bg-stone-100'} ${textPrimary}`}
              >
                {renderFormattedText(localText)}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Desktop/tablet: centered modal
  return (
    <div ref={backdropRef} className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] outline-none" onClick={handleSaveAndClose} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); handleSaveAndClose(); } }} tabIndex={-1}>
      <div
        className={`${cardBg} rounded-lg shadow-xl p-6 border ${borderClass} w-full max-w-lg mx-4`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <NotebookPen size={20} className={textSecondary} />
            <h3 className={`text-lg font-semibold ${textPrimary}`}>Daily Note — {displayDate}</h3>
          </div>
          <button onClick={handleSaveAndClose} className={`p-1 rounded ${hoverBg}`}>
            <X size={20} className={textSecondary} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader size={24} className={`animate-spin ${textSecondary}`} />
          </div>
        ) : isEditing ? (
          <textarea
            value={localText}
            onChange={(e) => setLocalText(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            placeholder="Add daily notes... (**bold**, *italic*, __underline__, URLs) — Shift+Enter for preview"
            className={`w-full ${darkMode ? 'bg-gray-700 text-gray-100 border-gray-600 placeholder:text-gray-500' : 'bg-stone-50 text-stone-900 border-stone-300 placeholder:text-stone-400'} text-sm px-3 py-2.5 rounded-lg border outline-none focus:ring-2 focus:ring-blue-500 resize-y`}
            rows={10}
            autoFocus
          />
        ) : (
          <div
            onClick={() => setIsEditing(true)}
            className={`text-sm whitespace-pre-wrap cursor-text min-h-[15rem] p-3 rounded-lg ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-50 hover:bg-stone-100'} ${textPrimary}`}
          >
            {renderFormattedText(localText)}
          </div>
        )}
      </div>
    </div>
  );
};

export default DailyNotesModal;
