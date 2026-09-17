import { useSyncExternalStore } from 'react';
export const JOBO_ENABLED_KEY = 'day-planner-jobo-enabled';
const EVENT = 'dayglance-jobo-preference';
export function readJoboEnabled() {
  try {
    return window.localStorage.getItem(JOBO_ENABLED_KEY) === 'true';
  } catch {
    return false;
  }
}
export function setJoboEnabled(enabled) {
  window.localStorage.setItem(JOBO_ENABLED_KEY, String(!!enabled));
  window.dispatchEvent(new Event(EVENT));
}
function subscribe(fn) {
  const storage = event => {
    if (event.key === JOBO_ENABLED_KEY || event.key === null) fn();
  };
  window.addEventListener(EVENT, fn);
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener('storage', storage);
  };
}
export function useJoboEnabled() {
  return useSyncExternalStore(subscribe, readJoboEnabled, () => false);
}
export function canUseJobo(enabled, ctx, features) {
  return !!enabled && !!ctx?.dataLoaded && !ctx?.isTrayMode && !features?.multiUserEnabled;
}
