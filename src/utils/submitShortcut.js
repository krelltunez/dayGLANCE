// Ctrl+Enter (Cmd+Enter on a Mac) saves a form from any field (#2276).
//
// Plain Enter only submits from a single-line input: a textarea takes the
// newline, a focused picker button takes the click, and the notes panel's
// fields (Shift+Enter, the add-subtask input) handle Enter themselves and stop
// it. The forms that advertise "Enter: save" therefore listen for this in the
// CAPTURE phase, before any field's own handler can consume it.

const MAC = /Mac|iPhone|iPad/;

export const isMacPlatform = (nav = globalThis.navigator) => MAC.test(nav?.platform || '');

/** The modifier's label for a hint: '⌘' on a Mac, 'Ctrl' elsewhere. */
export const submitModifierLabel = (nav = globalThis.navigator) => (isMacPlatform(nav) ? '⌘' : 'Ctrl');

/**
 * Ctrl+Enter or Cmd+Enter, and nothing else held. Not while an input method is
 * composing (Chinese, Japanese, Korean input confirm with Enter), and not a
 * key held down and repeating.
 */
export const isSubmitShortcut = (event) => {
  if (!event || event.key !== 'Enter') return false;
  if (!(event.ctrlKey || event.metaKey)) return false;
  if (event.altKey || event.shiftKey || event.repeat) return false;
  const native = event.nativeEvent || event;
  if (native.isComposing || native.keyCode === 229) return false;
  return true;
};

/**
 * Submit `form` as its own Save button would. The focused field is blurred
 * first, so a field that commits on blur (the notes, a subtask being renamed)
 * lands in the form's state, as it does when Save is clicked; the submit waits
 * a tick so it reads that state. Returns whether a submit was scheduled.
 */
export const submitFromAnyField = (form, {
  doc = globalThis.document,
  defer = (fn) => setTimeout(fn, 0),
} = {}) => {
  if (!form || typeof form.requestSubmit !== 'function') return false;
  const active = doc?.activeElement;
  if (active && active !== form && form.contains?.(active)) active.blur?.();
  defer(() => { if (form.isConnected !== false) form.requestSubmit(); });
  return true;
};

/**
 * A capture-phase keydown handler for a form: on the shortcut, take the key
 * from whatever field has it and submit, unless `disabled()` says the form
 * cannot save right now. `getForm` returns the <form> (by default the
 * listener's own element).
 */
export const submitShortcutHandler = ({ getForm, disabled = () => false, ...opts } = {}) => (event) => {
  if (!isSubmitShortcut(event)) return;
  // Taken from the field either way: a focused button would otherwise click.
  event.preventDefault();
  event.stopPropagation();
  if (disabled()) return;
  const form = getForm ? getForm(event) : event.currentTarget;
  submitFromAnyField(form, opts);
};
