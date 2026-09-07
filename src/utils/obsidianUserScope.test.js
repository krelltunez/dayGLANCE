import { describe, it, expect } from 'vitest';
import { vaultViewerFor, visibleToViewer, assignVaultViewer, knownTaskIds } from './obsidianUserScope.js';

describe('vaultViewerFor', () => {
  it('direct access: the device user when multi-user is on; plugin path: the pairing meta user; else null', () => {
    expect(vaultViewerFor({ authoritative: false, multiUserEnabled: true, meUserSyncId: 'u-me' })).toBe('u-me');
    expect(vaultViewerFor({ authoritative: false, multiUserEnabled: false, meUserSyncId: 'u-me' })).toBe(null);
    expect(vaultViewerFor({ authoritative: true, meta: { userSyncId: 'u-vault' }, multiUserEnabled: true, meUserSyncId: 'u-me' })).toBe('u-vault');
    // Plugin predating the field, or Everyone: no viewer, even though this device has one.
    expect(vaultViewerFor({ authoritative: true, meta: { generation: 'g' }, multiUserEnabled: true, meUserSyncId: 'u-me' })).toBe(null);
    expect(vaultViewerFor({ authoritative: true, meta: null, multiUserEnabled: true, meUserSyncId: 'u-me' })).toBe(null);
  });
});

describe('visibleToViewer', () => {
  it('no viewer sees all; otherwise unassigned or assigned-to-viewer', () => {
    expect(visibleToViewer({ assignedUserSyncIds: ['u-wife'] }, null)).toBe(true);
    expect(visibleToViewer({}, 'u-me')).toBe(true);
    expect(visibleToViewer({ assignedUserSyncIds: [] }, 'u-me')).toBe(true);
    expect(visibleToViewer({ assignedUserSyncIds: ['u-me', 'u-wife'] }, 'u-me')).toBe(true);
    expect(visibleToViewer({ assignedUserSyncIds: ['u-wife'] }, 'u-me')).toBe(false);
  });
});

describe('assignVaultViewer', () => {
  it('assigns first-seen unassigned tasks to the viewer; leaves known and already-assigned ones; same reference when nothing changes', () => {
    const scanned = [
      { id: 'new', title: 'New' },
      { id: 'known', title: 'Known' },
      { id: 'binned', title: 'Binned' },
      { id: 'hers', title: 'Hers', assignedUserSyncIds: ['u-wife'] },
    ];
    const known = knownTaskIds([{ id: 'known' }], [], [{ id: 'binned' }]);
    const out = assignVaultViewer(scanned, { viewer: 'u-me', knownIds: known });
    expect(out.find((t) => t.id === 'new').assignedUserSyncIds).toEqual(['u-me']);
    expect(out.find((t) => t.id === 'known')).toBe(scanned[1]);
    expect(out.find((t) => t.id === 'binned')).toBe(scanned[2]);
    expect(out.find((t) => t.id === 'hers')).toBe(scanned[3]);
    expect(assignVaultViewer(scanned, { viewer: null, knownIds: known })).toBe(scanned);
    expect(assignVaultViewer([scanned[1]], { viewer: 'u-me', knownIds: known })).toEqual([scanned[1]]);
  });
});
