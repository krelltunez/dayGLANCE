import { useState } from 'react';

// Open or closed, remembered on this device under a storage key, the way the
// SCHED rail keeps its sections. Shared by the Inbox filter's sections and
// groups (#2232) and the task editor's project picker (#2279), each under its
// own key prefix. Storage may be unavailable: the default then holds and a
// toggle lasts as long as the component.

/** The remembered state under `storageKey`, or `defaultOpen` when none is. */
export function readRememberedOpen(storageKey, defaultOpen) {
  try {
    const saved = localStorage.getItem(storageKey);
    return saved === null ? defaultOpen : saved === 'true';
  } catch { return defaultOpen; }
}

/** Remembers `open` under `storageKey`, where storage allows. */
export function rememberOpen(storageKey, open) {
  try { localStorage.setItem(storageKey, String(open)); } catch { /* not remembered */ }
}

/** One remembered fold: `[open, toggle]`. */
export default function useRememberedOpen(storageKey, defaultOpen) {
  const [open, setOpen] = useState(() => readRememberedOpen(storageKey, defaultOpen));
  const toggle = () => setOpen((was) => {
    rememberOpen(storageKey, !was);
    return !was;
  });
  return [open, toggle];
}
