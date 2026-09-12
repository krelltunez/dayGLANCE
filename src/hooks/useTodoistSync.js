import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, normalizeSettings, mergeResponse, matches, active, linked,
  reconcileLists, pruneCache, prepareOutbox, acknowledge, writebackReason } from '../todoist/core.js';
import { requestSync, connectAccount, CONFIG_KEY, TOKEN_KEY, ACCOUNT_KEY, readJSON, writeJSON,
  readAccountState, writeAccountState, clearIdleCache } from '../todoist/client.js';
import { applyPlannedList } from '../utils/todoistReconciliation.js';
import { isResetInProgress } from '../utils/resetAppData.js';

const sessionValue = key => {
  try { return sessionStorage.getItem(key) || ''; } catch { return ''; }
};

// Credentials are session-only. dg-todoist-* is deliberately outside the
// day-planner-* device-settings/backup namespace. Tasks themselves may sync.
export default function useTodoistSync({ tasks, setTasks, unscheduledTasks, setUnscheduledTasks,
  recycleBin = [], dataLoaded, isTrayMode, multiUserEnabled }) {
  const [settings, setSettings] = useState(() => {
    try { return normalizeSettings(readJSON(localStorage, CONFIG_KEY, DEFAULT_SETTINGS)); }
    catch { return normalizeSettings(); }
  });
  const [token, setToken] = useState(() => sessionValue(TOKEN_KEY));
  const [account, setAccount] = useState(() => sessionValue(ACCOUNT_KEY));
  const [catalog, setCatalog] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [lastSynced, setLastSynced] = useState(null);
  const [pending, setPending] = useState(0);
  const [report, setReport] = useState(null);
  const latest = useRef();
  latest.current = { tasks, setTasks, unscheduledTasks, setUnscheduledTasks, recycleBin,
    dataLoaded, isTrayMode, multiUserEnabled, settings, token, account };
  const running = useRef(false);
  const disconnecting = useRef(false);
  const generation = useRef(0);
  const controller = useRef(null);
  const retryAt = useRef(0);
  const cancel = useCallback(() => {
    generation.current += 1;
    controller.current?.abort();
  }, []);
  const updateSettings = useCallback(patch => {
    cancel();
    const next = normalizeSettings({ ...latest.current.settings, ...patch });
    try { writeJSON(localStorage, CONFIG_KEY, next); latest.current.settings = next; setSettings(next); setError(''); }
    catch (err) { setError(err.message); }
  }, [cancel]);
  const disconnect = useCallback(async () => {
    if (disconnecting.current) return;
    disconnecting.current = true;
    const id = latest.current.account;
    cancel();
    updateSettings({ enabled: false, completionWriteback: false });
    try {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(ACCOUNT_KEY);
    } catch { /* storage may be disabled */ }
    latest.current.token = '';
    latest.current.account = '';
    retryAt.current = 0;
    setToken('');
    setAccount('');
    setCatalog(null);
    setLastSynced(null);
    setReport(null);
    setStatus('syncing');

    try {
      const clear = async () => (id ? clearIdleCache(localStorage, id) : 0);
      // Wait for any in-flight writer, including another tab, before deciding
      // whether the account has receipts that must survive disconnect.
      const remaining = await (navigator.locks?.request
        ? navigator.locks.request('dayglance-todoist-sync', clear)
        : clear());
      setPending(remaining);
      setStatus('idle');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    } finally {
      disconnecting.current = false;
    }
  }, [cancel, updateSettings]);

  const perform = useCallback(async (mode = 'sync', candidateToken = '') => {
    const initial = latest.current;
    if (running.current || disconnecting.current || initial.isTrayMode || isResetInProgress()) return;
    if (initial.multiUserEnabled) { setError('multiUser'); return; }
    if (mode === 'sync' && !initial.dataLoaded) { setError('notReady'); return false; }
    if (Date.now() < retryAt.current) { setError('rateLimited'); return; }
    const secret = mode === 'connect' ? candidateToken.trim() : initial.token;
    if (!secret) { setError('tokenRequired'); return; }
    const epoch = generation.current;
    const check = () => {
      if (generation.current !== epoch || isResetInProgress() || latest.current.multiUserEnabled) throw new Error('cancelled');
    };
    running.current = true;
    controller.current = new AbortController();
    setStatus('syncing'); setError('');
    const execute = async () => {
      let id = initial.account;
      let stored = id ? await readAccountState(id) : {};
      let cache;
      if (mode === 'connect') {
        const connected = await connectAccount(secret,
          accountId => readAccountState(accountId), { signal: controller.current.signal });
        cache = connected.cache; stored = connected.stored;
      } else {
        cache = mergeResponse(stored.cache, await requestSync(secret, stored.cache?.cursor || '*', [],
          { signal: controller.current.signal }));
      }
      check();
      id = String(cache.user.id);
      if (mode !== 'connect' && id !== initial.account) throw new Error('accountChanged');
      if (mode === 'connect') {
        // Connecting is always read-only, even after reconnecting to the same account.
        const next = normalizeSettings(initial.account && initial.account !== id
          ? DEFAULT_SETTINGS : { ...initial.settings, enabled: false, completionWriteback: false });
        writeJSON(localStorage, CONFIG_KEY, next);
        sessionStorage.setItem(TOKEN_KEY, secret);
        sessionStorage.setItem(ACCOUNT_KEY, id);
        setToken(secret); setAccount(id); setSettings(next);
        Object.assign(latest.current, { token: secret, account: id, settings: next });
      }
      if (stored.queue != null && !Array.isArray(stored.queue)) throw new Error('storageCorrupt');
      let queue = stored.queue || [];
      let currentReport = stored.report || null;
      // Async because the cache half now lands in IndexedDB. The receipts half is
      // still written synchronously inside writeAccountState, so a durable UUID is
      // on disk before its request goes out even if this promise never settles.
      const persist = async (lastSync = stored.lastSync) => {
        check();
        const current = latest.current;
        const retainIds = new Set(
          [...current.tasks, ...current.unscheduledTasks, ...current.recycleBin]
            .filter(task => linked(task, id))
            .map(task => String(task.todoist.id)),
        );
        for (const operation of queue) {
          if (operation.accountId === id) retainIds.add(String(operation.args.id));
        }
        cache = pruneCache(cache, retainIds);
        await writeAccountState(id, { cache, queue, lastSync, report: currentReport });
        setCatalog(cache); setPending(queue.length);
      };
      await persist();
      if (mode === 'sync') {
        const current = latest.current;
        const all = [...current.tasks, ...current.unscheduledTasks];
        if (current.settings.completionWriteback) {
          // No unsafe ad-hoc localStorage lock: when Web Locks is unavailable,
          // read-only sync remains usable but automatic writes are disabled.
          if (!navigator.locks?.request) throw new Error('writeLockUnavailable');
          const prepared = prepareOutbox(queue, all, cache, current.settings, () => crypto.randomUUID());
          queue = prepared.queue;
          await persist(); // Durable UUIDs BEFORE the request: retry never generates a new close.
          if (prepared.send.length) {
            check();
            const written = await requestSync(secret, cache.cursor, prepared.send, { signal: controller.current.signal });
            check();
            const ack = acknowledge(queue, prepared.send, written);
            queue = ack.queue;
            // Acknowledged ordinary leaf closes are authoritative even if the
            // response's read portion is malformed. Never lose their receipt.
            for (const op of prepared.send) {
              if (ack.succeeded.has(op.uuid)) cache.items[op.args.id] = { ...cache.items[op.args.id], checked: true };
            }
            await persist();
            cache = mergeResponse(cache, written);
            await persist();
            if (ack.failed.length) throw new Error('commandFailed');
          }
        }
        check();
        const now = new Date().toISOString();
        const currentState = latest.current;
        const tombstones = readJSON(localStorage, 'day-planner-deleted-task-ids', {});
        const plan = reconcileLists({ tasks: currentState.tasks, unscheduledTasks: currentState.unscheduledTasks,
          recycleBin: currentState.recycleBin, cache, settings: currentState.settings,
          blockedIds: new Set(Object.keys(tombstones)), now });
        check();
        // Functional setters preserve edits made while the request was in flight.
        const valid = () => generation.current === epoch && !isResetInProgress();
        currentState.setTasks(prev => valid() ? applyPlannedList(prev, currentState.tasks, plan.tasks) : prev);
        currentState.setUnscheduledTasks(prev => valid() ? applyPlannedList(prev, currentState.unscheduledTasks, plan.unscheduledTasks) : prev);
        currentReport = plan.report;
        setReport(currentReport);
        await persist(now);
        setLastSynced(now);
      } else { setLastSynced(stored.lastSync || null); setReport(currentReport); }
      setCatalog(cache); setPending(queue.length); setStatus('success');
    };
    let succeeded = false;
    try {
      if (navigator.locks?.request) {
        await navigator.locks.request('dayglance-todoist-sync', { ifAvailable: true }, async lock => {
          if (!lock) throw new Error('busyOtherTab');
          await execute();
        });
      } else await execute();
      succeeded = true;
    } catch (err) {
      if (generation.current === epoch) {
        setError(err.message);
        setStatus('error');
        if (err.retryAfter) retryAt.current = Date.now() + err.retryAfter * 1000;
      }
    } finally {
      running.current = false;
      controller.current = null;
      if (generation.current !== epoch && !disconnecting.current) setStatus('idle');
    }
    return succeeded;
  }, []);
  const syncNow = useCallback(() => perform('sync'), [perform]);
  const preview = useCallback(() => perform('preview'), [perform]);
  const connect = useCallback(value => perform('connect', value), [perform]);
  const resolveConflict = useCallback((id, useRemote) => {
    const now = new Date().toISOString();
    const resolve = task => task.id !== id ? task : {
      ...task, ...(useRemote ? task.todoist?.conflicts : {}),
      todoist: { ...task.todoist, conflicts: {} }, lastModified: now,
    };
    latest.current.setTasks(prev => prev.map(resolve));
    latest.current.setUnscheduledTasks(prev => prev.map(resolve));
  }, []);
  useEffect(() => {
    const changed = event => {
      if (event.key !== CONFIG_KEY) return;
      cancel();
      try { setSettings(normalizeSettings(readJSON(localStorage, CONFIG_KEY, DEFAULT_SETTINGS))); }
      catch { setError('storageCorrupt'); }
    };
    window.addEventListener('storage', changed);
    return () => { window.removeEventListener('storage', changed); cancel(); };
  }, [cancel]);
  useEffect(() => {
    if (!settings.enabled || !token || !dataLoaded || isTrayMode || multiUserEnabled || !settings.intervalMinutes) return;
    const tick = () => { if (document.visibilityState === 'visible' && navigator.onLine !== false) syncNow(); };
    const startup = setTimeout(tick, 1500);
    const timer = setInterval(tick, settings.intervalMinutes * 60000);
    window.addEventListener('online', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearTimeout(startup); clearInterval(timer);
      window.removeEventListener('online', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [settings.enabled, settings.intervalMinutes, token, dataLoaded, isTrayMode, multiUserEnabled, syncNow]);

  const selected = catalog ? Object.values(catalog.items).filter(item => active(item) && matches(item, settings, catalog.projects, new Date(), catalog.user.timezone)) : [];
  const local = [...tasks, ...unscheduledTasks].filter(task => linked(task, account));
  const conflicts = local.filter(task => Object.keys(task.todoist.conflicts || {}).length);
  const blockedWrites = catalog ? local.filter(task => ['recurring', 'parent', 'assignedElsewhere'].includes(writebackReason(task, catalog, settings))) : [];
  return { settings, updateSettings, connected: !!token && !!account, account, catalog, selected,
    status, error, lastSynced, report, pending, conflicts, blockedWrites, multiUserEnabled,
    connect, disconnect, preview, syncNow, resolveConflict };
}
