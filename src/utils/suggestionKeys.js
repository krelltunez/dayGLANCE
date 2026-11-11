// The keys that accept the highlighted title suggestion (a #tag, an @date, a
// ~time, a %duration...), in the task form, the inline rename and a new Do's
// title (#2379).
//
// Tab and Space accept it, as they always have. Enter does too: the list
// highlights its first suggestion as soon as it opens, which reads as "Enter
// takes this", and Enter used to save past it instead. Except when what is
// typed already IS the highlighted suggestion (all of `#home`): accepting
// would change nothing, so Enter saves, as one press. Ctrl/Cmd+Enter always
// saves (utils/submitShortcut.js).
//
// No key accepts while an input method is composing: Chinese, Japanese and
// Korean input confirm a character with Enter and pick one with Space, and
// that keystroke is the input method's, not a choice of suggestion.

import { suggestionAlreadyTyped } from './suggestionParser.js';

/** Whether an input method is composing: the key belongs to it. */
export const isComposingKey = (event) => {
  const native = event?.nativeEvent || event;
  return !!(native?.isComposing || native?.keyCode === 229);
};

/**
 * Whether `event` accepts `suggestion`, the highlighted one, for a title
 * reading `text` with the cursor at `cursor`.
 */
export function acceptsSuggestion(event, { text, cursor, suggestion }) {
  if (!event || !suggestion || isComposingKey(event)) return false;
  if (event.key === 'Tab' || event.key === ' ') return true;
  if (event.key !== 'Enter') return false;
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  return !suggestionAlreadyTyped(text, cursor, suggestion);
}
