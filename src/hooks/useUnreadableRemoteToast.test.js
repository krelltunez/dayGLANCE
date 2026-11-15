import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// Render-free: an effect runs when its deps differ from the last call's, as
// React would run it between renders.
let lastDeps;
vi.mock('react', () => ({
  useEffect: (fn, deps) => {
    const changed = !lastDeps || deps.some((dep, i) => dep !== lastDeps[i]);
    lastDeps = deps;
    if (changed) fn();
  },
}));

const { default: useUnreadableRemoteToast } = await import('./useUnreadableRemoteToast.js');
const en = JSON.parse(readFileSync(new URL('../../public/locales/en/translation.json', import.meta.url), 'utf8'));
const t = (key) => key.split('.').reduce((value, part) => value?.[part], en);

describe('useUnreadableRemoteToast (#2409)', () => {
  let setUndoToast;
  beforeEach(() => { lastDeps = undefined; setUndoToast = vi.fn(); });
  const useRendered = (unreadable) => useUnreadableRemoteToast({ unreadable, setUndoToast, t: (key) => t(key) });

  it('says nothing while sync is fine', () => {
    useRendered(false);
    expect(setUndoToast).not.toHaveBeenCalled();
  });

  it('says it in red when the server file turns out unreadable', () => {
    useRendered(false);
    useRendered(true);
    expect(setUndoToast).toHaveBeenCalledTimes(1);
    expect(setUndoToast).toHaveBeenCalledWith({ message: en.sync.errors.remoteUnreadableToast, kind: 'error' });
    expect(en.sync.errors.remoteUnreadableToast).toMatch(/sync settings/);
  });

  it('says it once per outage, not once per failed cycle or render', () => {
    useRendered(true);
    useRendered(true);
    useRendered(true);
    expect(setUndoToast).toHaveBeenCalledTimes(1);
  });

  it('says it again for a new outage after a sync succeeded', () => {
    useRendered(true);
    useRendered(false);
    useRendered(true);
    expect(setUndoToast).toHaveBeenCalledTimes(2);
  });
});

// App.jsx has no harness, so the wiring is held by its source: the flag goes up
// with the coded error, comes down with a successful sync, and reaches both the
// toast and the settings notice.
describe('where the unreadable state is wired', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const app = read('../App.jsx');

  it('App raises it on the coded error and lowers it when a sync succeeds', () => {
    expect(app).toMatch(/if \(msg && code === REMOTE_UNREADABLE_CODE\) setCloudSyncRemoteUnreadable\(true\);/);
    expect(app).toMatch(/onLastSyncedChange:\s+\(iso\) => \{\s+setCloudSyncLastSynced\(iso\);\s+setCloudSyncRemoteUnreadable\(false\);/);
    expect(app).toContain('useUnreadableRemoteToast({ unreadable: cloudSyncRemoteUnreadable, setUndoToast, t });');
  });

  it('App offers the replace action through the engine, never a bare upload', () => {
    expect(app).toContain('cloudSyncReplaceRemote: () => cloudSyncEngineRef.current.replaceUnreadableRemote(),');
  });

  it('the settings page hands both to the form, which shows the notice', () => {
    const topic = read('../components/settings/topics/useSyncTopic.jsx');
    expect(topic).toContain('cloudSyncRemoteUnreadable={cloudSyncRemoteUnreadable}');
    expect(topic).toContain('cloudSyncReplaceRemote={cloudSyncReplaceRemote}');
    const form = read('../components/CloudSyncSettingsForm.jsx');
    expect(form).toMatch(/\{cloudSyncRemoteUnreadable && cloudSyncReplaceRemote && \(\s+<SyncUnreadableRemoteNotice onReplace=\{cloudSyncReplaceRemote\}/);
  });
});
