import { useEffect } from 'react';

// Says, once, that sync has stopped on a server file it cannot read (#2409).
//
// `unreadable` goes true with the first such error and false when a sync next
// succeeds (hooks/useCloudSync.js, App.jsx), so this fires once per outage, not
// once per cycle: the engine retries every minute and would otherwise put the
// toast back each time. The settings page keeps the full text and the button.
export default function useUnreadableRemoteToast({ unreadable, setUndoToast, t }) {
  useEffect(() => {
    if (!unreadable) return;
    setUndoToast({ message: t('sync.errors.remoteUnreadableToast'), kind: 'error' });
    // Keyed on the outage alone: `t` and the setter change identity with
    // renders and languages, and neither is a reason to say it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadable]);
}
