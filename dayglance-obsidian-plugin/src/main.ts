// dayGLANCE Bridge — Phase 5 of the Obsidian build-out
// (docs/obsidian-buildout-spec.md in the dayGLANCE repo, §6 Phase 5 + §3.3).
//
// Deliberately tiny: a liveness heartbeat and a command-palette entry.
// No transport, no GLANCEvault client, no settings tab, no vault writes
// beyond the heartbeat file itself. The plugin is built to be EXTRACTED to
// its own public repo before directory submission — it imports nothing from
// dayGLANCE and knows nothing about it beyond the heartbeat contract.
//
// THE HEARTBEAT. `.dayglance/heartbeat` is written every 30 seconds while
// Obsidian has this vault open. dayGLANCE reads it for two things:
//   • suppressing launch-on-write — a fresh heartbeat means Obsidian is
//     already running, so waking it via obsidian:// would be redundant;
//   • arbitration state (spec §3.2/§3.3) — in Phase 5 `paired` is always
//     false and accountId null, but the payload SHAPE ships now so Phase 6
//     changes the values, never the file format.
//
// Payload: {"paired": bool, "accountId": string|null, "deviceId": string,
// "ts": ISO-8601}. `deviceId` is minted once per install and persisted in
// the plugin's data.json — per 3.3 the heartbeat is PER-DEVICE liveness,
// which only works because Obsidian Sync ignores hidden (dot-prefixed)
// files and folders entirely: `.dayglance/` never rides Sync, is invisible
// to the indexer, and appears in neither search nor the graph. (A vault
// synced by a third-party file syncer — iCloud Drive, Syncthing — WILL
// carry the file across devices; the dayGLANCE side documents why that
// false-positive is benign for what the heartbeat gates.)
//
// The adapter API is used throughout because the vault API deliberately
// cannot see dot-paths.

import { Notice, Plugin, normalizePath } from 'obsidian';
// The shared vault-format core — the SAME package dayGLANCE consumes, so the
// heartbeat's writer and its readers can never drift apart (the first proof
// the format-package boundary works in both directions). Bundled into
// main.js by esbuild; `file:`-linked while the plugin lives in the dayGLANCE
// repo, a published dependency after extraction.
import { heartbeatPayload } from '@glance-apps/obsidian-format';

const HEARTBEAT_DIR = '.dayglance';
const HEARTBEAT_PATH = `${HEARTBEAT_DIR}/heartbeat`;

// 30 seconds per spec §6 Phase 5. On mobile the interval simply stops
// ticking while the app is backgrounded (WebView timers are frozen) — which
// is the CORRECT signal: a backgrounded Obsidian isn't meaningfully
// running, its Sync isn't syncing, and dayGLANCE should treat it as absent.
// The staleness threshold on the reading side (minutes) absorbs ordinary
// foreground jitter.
const HEARTBEAT_INTERVAL_MS = 30_000;

interface BridgeData {
  deviceId?: string;
}

const mintDeviceId = (): string => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  // Old webview without randomUUID — collision odds are irrelevant for a
  // per-install liveness id.
  return `dgb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export default class DayGlanceBridgePlugin extends Plugin {
  private deviceId = '';

  async onload(): Promise<void> {
    const data: BridgeData = ((await this.loadData()) as BridgeData | null) ?? {};
    if (!data.deviceId) {
      data.deviceId = mintDeviceId();
      await this.saveData(data);
    }
    this.deviceId = data.deviceId;

    // Full id in the palette: dayglance-bridge:sync-now (Obsidian prefixes
    // the manifest id). In Phase 5 there is no transport to drive, so the
    // command's one honest effect is an immediate heartbeat refresh.
    this.addCommand({
      id: 'sync-now',
      name: 'Sync now',
      callback: () => {
        void this.writeHeartbeat().then(() => {
          new Notice('dayGLANCE bridge: heartbeat refreshed. Sync transport arrives in a later phase.');
        });
      },
    });

    // First beat immediately — registerInterval's first tick is a full
    // interval away, and dayGLANCE's staleness window shouldn't have to
    // absorb Obsidian's startup.
    void this.writeHeartbeat();
    this.registerInterval(
      window.setInterval(() => void this.writeHeartbeat(), HEARTBEAT_INTERVAL_MS),
    );
  }

  onunload(): void {
    // Best-effort: a graceful quit (or a plugin disable — equally "no
    // bridge here") removes the file so readers see the truth immediately
    // instead of waiting out the staleness window. Crashes skip this, which
    // is exactly what the staleness window exists for.
    void this.app.vault.adapter.remove(normalizePath(HEARTBEAT_PATH)).catch(() => {
      /* never surface — the file may simply not exist yet */
    });
  }

  private async writeHeartbeat(): Promise<void> {
    try {
      const adapter = this.app.vault.adapter;
      const dir = normalizePath(HEARTBEAT_DIR);
      if (!(await adapter.exists(dir))) {
        await adapter.mkdir(dir);
      }
      // Phase 5 values (paired false, accountId null) — Phase 6 pairing
      // changes the values, never the shape.
      const payload = heartbeatPayload({ deviceId: this.deviceId });
      await adapter.write(normalizePath(HEARTBEAT_PATH), JSON.stringify(payload));
    } catch (e) {
      // A liveness beacon must never nag: one console line, no Notice.
      console.error('dayGLANCE bridge: heartbeat write failed', e);
    }
  }
}
