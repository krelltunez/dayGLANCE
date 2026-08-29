// dayGLANCE Bridge — Obsidian build-out Phases 5–6
// (docs/obsidian-buildout-spec.md in the dayGLANCE repo, §3.2–§3.4, §6).
//
// Still deliberately small: a liveness heartbeat, the pairing flow, and two
// command-palette entries. No intent transport yet (that is the next phase);
// after pairing the plugin can talk to GLANCEvault but moves no data. The
// plugin is built to be EXTRACTED to its own public repo before directory
// submission — it imports nothing from dayGLANCE and knows nothing about it
// beyond the shared vault-format contracts.
//
// THE HEARTBEAT. `.dayglance/heartbeat` is written every 30 seconds while
// Obsidian has this vault open. dayGLANCE reads it for two things:
//   • suppressing launch-on-write — a fresh heartbeat means Obsidian is
//     already running, so waking it via obsidian:// would be redundant;
//   • arbitration state (spec §3.2/§3.3) — `paired` and `accountId` now
//     reflect the stored pairing; a fresh AND paired heartbeat is what will
//     make dayGLANCE stop writing to the vault directly.
//
// Payload: {"paired": bool, "accountId": string|null, "deviceId": string,
// "ts": ISO-8601}. The `deviceId` WIRE KEY predates the per-vault pairing
// ruling and is kept (the shape is final); its semantics are "per
// vault-copy install id" — minted once per install into data.json, which
// rides Obsidian's settings sync to every copy of this vault, so copies
// share it exactly as they share the pairing. It identifies which vault
// copy is beating, not a paired device. Dot-paths never ride Obsidian
// Sync, are invisible to the indexer, and appear in neither search nor the
// graph — the adapter API is used throughout because the vault API
// deliberately cannot see them. (A vault synced by a third-party file
// syncer — iCloud Drive, Syncthing — WILL carry the file across devices;
// the dayGLANCE side documents why that false-positive is benign for what
// the heartbeat gates.)
//
// PAIRING (spec §3.2/§3.4) lives in pairing.ts: dayGLANCE drops a sealed
// offer at `.dayglance/pairing`, the user types the displayed code here,
// the credentials are verified against GLANCEvault and stored in data.json.

import { Notice, Plugin, normalizePath } from 'obsidian';
// The shared vault-format core — the SAME package dayGLANCE consumes, so the
// heartbeat's writer and its readers can never drift apart (the first proof
// the format-package boundary works in both directions). Bundled into
// main.js by esbuild; `file:`-linked while the plugin lives in the dayGLANCE
// repo, a published dependency after extraction.
import { heartbeatPayload } from '@glance-apps/obsidian-format';
import { PairingModal, readPairingOfferText, type BridgePairing } from './pairing';

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
  pairing?: BridgePairing;
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
  private data: BridgeData = {};
  // One nudge per offer appearance: reset when the file disappears, so a
  // fresh offer (re-pair) nudges again but a sitting one doesn't nag.
  private offerNoticed = false;

  async onload(): Promise<void> {
    this.data = ((await this.loadData()) as BridgeData | null) ?? {};
    if (!this.data.deviceId) {
      this.data.deviceId = mintDeviceId();
      await this.saveData(this.data);
    }
    this.deviceId = this.data.deviceId;

    // Full ids in the palette: dayglance-bridge:<id> (Obsidian prefixes the
    // manifest id). With no transport yet, sync-now's one honest effect is
    // an immediate heartbeat refresh.
    this.addCommand({
      id: 'sync-now',
      name: 'Sync now',
      callback: () => {
        void this.writeHeartbeat().then(() => {
          new Notice('dayGLANCE bridge: heartbeat refreshed. Sync transport arrives in a later phase.');
        });
      },
    });

    this.addCommand({
      id: 'enter-pairing-code',
      name: 'Enter pairing code',
      callback: () => {
        new PairingModal({
          app: this.app,
          getPairing: () => this.data.pairing,
          storePairing: async (pairing) => {
            this.data.pairing = pairing;
            await this.saveData(this.data);
            // Beat immediately so dayGLANCE's pairing panel confirms
            // without waiting out the interval.
            await this.writeHeartbeat();
          },
        }).open();
      },
    });

    this.addCommand({
      id: 'unpair',
      name: 'Unpair from GLANCEvault',
      callback: () => {
        if (!this.data.pairing) {
          new Notice('dayGLANCE bridge: not paired.');
          return;
        }
        delete this.data.pairing;
        void this.saveData(this.data).then(() => this.writeHeartbeat()).then(() => {
          new Notice('dayGLANCE bridge: unpaired. Also revoke the device token on your GLANCEvault server — unpairing only forgets the local credentials.');
        });
      },
    });

    // First beat immediately — registerInterval's first tick is a full
    // interval away, and dayGLANCE's staleness window shouldn't have to
    // absorb Obsidian's startup. The offer check rides the same cadence.
    void this.writeHeartbeat();
    void this.checkForPairingOffer();
    this.registerInterval(
      window.setInterval(() => {
        void this.writeHeartbeat();
        void this.checkForPairingOffer();
      }, HEARTBEAT_INTERVAL_MS),
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
      const payload = heartbeatPayload({
        deviceId: this.deviceId,
        paired: !!this.data.pairing,
        accountId: this.data.pairing?.accountId ?? null,
      });
      await adapter.write(normalizePath(HEARTBEAT_PATH), JSON.stringify(payload));
    } catch (e) {
      // A liveness beacon must never nag: one console line, no Notice.
      console.error('dayGLANCE bridge: heartbeat write failed', e);
    }
  }

  // A sealed offer sitting in the vault means someone hit "Start pairing"
  // in dayGLANCE — nudge toward the command, once. The contents can't be
  // read without the code, but the envelope shape can: the cancelled form
  // ('{}') and junk fail the v-check and don't nudge.
  private async checkForPairingOffer(): Promise<void> {
    try {
      const text = await readPairingOfferText(this.app);
      let sealed = false;
      try { sealed = text !== null && (JSON.parse(text) as { v?: number } | null)?.v === 1; }
      catch { /* not an offer envelope */ }
      if (!sealed) {
        this.offerNoticed = false;
        return;
      }
      if (this.offerNoticed) return;
      this.offerNoticed = true;
      new Notice('dayGLANCE bridge: pairing offer found — run "dayGLANCE Bridge: Enter pairing code".');
    } catch {
      /* a nudge must never surface errors */
    }
  }
}
