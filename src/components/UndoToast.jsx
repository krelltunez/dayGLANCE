import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';

// The app's one toast (state and timing in hooks/useUndo.js). It says what
// was done, undone or redone, offers the way back (Undo after an action or a
// redo, Redo after an undo) and, after a completion, a follow-up task.
//
// `kind: 'warning'` is for something that went wrong or needs the user: it is
// amber, carries an icon and is announced at once; everything else is
// announced politely. `kind: 'error'` is the same in red, for something that
// has stopped and stays stopped until the user acts (a sync file on the server
// that cannot be read, #2409).
//
// Layering: above the dialogs (z-[60] up to the JOBO panels at z-[100]), so an
// action taken inside one, or a Cmd+Z pressed over one, reports where it can
// be seen and its button can be reached. Below HyperGlance's full-screen mode
// (z-[200]) and the subscription wall. Also above the Refocus timeline pill,
// which sits in the same place.
export default function UndoToast({ toast, setToast, darkMode, isMobile, onUndo, onRedo, onFollowUp }) {
  const { t } = useTranslation();
  const error = toast.kind === 'error';
  const warning = toast.kind === 'warning' || error;
  // A toast with a button, or a warning someone may need to hold to read,
  // takes the pointer; a passive note lets clicks through.
  const interactive = toast.actionable || toast.redoable || toast.followUp || warning;
  const tone = error
    ? (darkMode ? 'bg-red-900 text-red-100' : 'bg-red-700 text-white')
    : warning
    ? (darkMode ? 'bg-amber-900 text-amber-100' : 'bg-amber-700 text-white')
    : (darkMode ? 'bg-gray-700 text-gray-200' : 'bg-gray-800 text-white');
  const hold = (held) => setToast(prev => (prev ? { ...prev, held } : prev));

  return (
    <div
      className={`fixed left-1/2 -translate-x-1/2 z-[150] ${interactive ? 'pointer-events-auto' : 'pointer-events-none'}`}
      style={{ bottom: isMobile ? 'calc(5rem + env(safe-area-inset-bottom, 0px))' : '1.5rem' }}
    >
      <div
        data-undo-toast
        data-toast-kind={error ? 'error' : warning ? 'warning' : undefined}
        role={warning ? 'alert' : 'status'}
        aria-live={warning ? 'assertive' : 'polite'}
        // Pointer or focus on the toast holds it (hooks/useUndo.js).
        onMouseEnter={() => hold(true)}
        onMouseLeave={() => hold(false)}
        onFocus={() => hold(true)}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) hold(false); }}
        className={`flex items-center gap-3 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium w-max max-w-[calc(100vw-2rem)] ${tone}`}
      >
        {warning && <AlertTriangle size={16} className="shrink-0" aria-hidden="true" />}
        <span className="min-w-0">{toast.message}</span>
        {toast.actionable && (
          <button
            data-undo-action
            onClick={() => onUndo()}
            className={`font-semibold ml-1 whitespace-nowrap ${warning ? 'underline' : 'text-blue-400 hover:text-blue-300'}`}
          >
            {t('shortcuts.undoAction')}
          </button>
        )}
        {toast.redoable && (
          <button
            data-redo-action
            onClick={() => onRedo()}
            className="font-semibold text-blue-400 hover:text-blue-300 ml-1 whitespace-nowrap"
          >
            {t('shortcuts.redoAction')}
          </button>
        )}
        {toast.followUp && (
          <button
            data-follow-up-action
            onClick={() => { const task = toast.followUp; setToast(null); onFollowUp(task); }}
            className="font-semibold text-blue-400 hover:text-blue-300 whitespace-nowrap"
          >
            {t('followUp.action')}
          </button>
        )}
      </div>
    </div>
  );
}
