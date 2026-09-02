// dayGLANCE Bridge — Obsidian build-out Phases 5–6
// (docs/obsidian-buildout-spec.md in the dayGLANCE repo, §3.2–§3.4, §6).
//
// Still deliberately small: a liveness heartbeat, the pairing flow (a
// settings tab plus command-palette entries — settingsTab.ts / pairing.ts),
// and the intent transport (bridge.ts). The plugin is built to be EXTRACTED
// to its own public repo before directory submission — it imports nothing
// from dayGLANCE and knows nothing about it beyond the shared vault-format
// contracts.
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
import { TFile } from 'obsidian';
import { PairingModal, readPairingOfferText, type BridgePairing } from './pairing';
import { BridgeSettingTab, type BridgeSettingsHost } from './settingsTab';
import { BridgeTransport, publishPairingMeta, type BridgeState } from './bridge';
import { AgendaStore } from './agenda';
import { localDateStr } from '@glance-apps/agenda-core';
import { AgendaView, AGENDA_VIEW_TYPE, removeAgendaStyles } from './agendaView';

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
  bridge?: BridgeState;
  // The agenda's viewer, when chosen explicitly in settings (companion 4.2,
  // decision 9). Absent = the pairing's default. Rides data.json like the
  // pairing itself: the owner's assumption of record is one person per
  // vault, so vault scope is the right scope.
  viewer?: { userSyncId: string | null };
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
  private transport!: BridgeTransport;
  // The sidebar view's data (companion spec 4.2): a read mirror of the
  // account's task rows plus the completion-action emitter.
  private agenda!: AgendaStore;
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

    this.agenda = new AgendaStore({
      app: this.app,
      getPairing: () => this.data.pairing,
      getViewer: () => this.viewer(),
    });
    void this.agenda.init();

    this.transport = new BridgeTransport({
      app: this.app,
      getPairing: () => this.data.pairing,
      getBridgeState: () => this.data.bridge ?? { appliedIds: [], hwm: 0 },
      saveBridgeState: async (state) => {
        this.data.bridge = state;
        await this.saveData(this.data);
      },
      // A successful drain (tick or SSE nudge) is the agenda's refresh
      // signal too: dayGLANCE's pushes advance the same account seq.
      onSynced: () => { void this.agenda.refresh(); },
    });

    this.registerView(AGENDA_VIEW_TYPE, (leaf) => new AgendaView(leaf, this.agenda));
    this.addRibbonIcon('calendar-check', 'Open dayGLANCE agenda', () => { void this.openAgenda(); });
    this.addCommand({
      id: 'open-agenda',
      name: 'Open agenda',
      callback: () => { void this.openAgenda(); },
    });

    // Outbound observations: report file state, never inferred edits
    // (spec §3.6 as amended). Debounced per path inside the transport;
    // inert while unpaired. layoutReady gates out the initial index churn.
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(this.app.vault.on('modify', (f) => { if (f instanceof TFile) this.transport.scheduleObservation(f); }));
      this.registerEvent(this.app.vault.on('create', (f) => { if (f instanceof TFile) this.transport.scheduleObservation(f); }));
      this.registerEvent(this.app.vault.on('delete', (f) => { if (f instanceof TFile) this.transport.reportDeleted(f.path); }));
      this.registerEvent(this.app.vault.on('rename', (f, oldPath) => {
        if (f instanceof TFile) { this.transport.reportDeleted(oldPath); this.transport.scheduleObservation(f); }
      }));
    });

    // Full ids in the palette: dayglance-bridge:<id> (Obsidian prefixes the
    // manifest id). Sync now = drain pending intents + refresh the beat.
    this.addCommand({
      id: 'sync-now',
      name: 'Sync now',
      callback: () => {
        void Promise.all([this.transport.drain(), this.writeHeartbeat()]).then(() => {
          new Notice(this.data.pairing
            ? 'dayGLANCE bridge: synced.'
            : 'dayGLANCE bridge: heartbeat refreshed (not paired — nothing to sync).');
        });
      },
    });

    // ONE pairing host, shared by the settings tab (the Obsidian-idiomatic
    // front door) and the command-palette modal — same flow, two entries.
    const host: BridgeSettingsHost = {
      app: this.app,
      plugin: this,
      getPairing: () => this.data.pairing,
      storePairing: async (pairing) => {
        this.data.pairing = pairing;
        // A re-pair rotates the subkey: old rows are unreadable, and the
        // cursor state belongs to the superseded stream. Start clean.
        this.data.bridge = { appliedIds: [], hwm: 0 };
        await this.saveData(this.data);
        // Publish the plaintext pairing-meta row — how OTHER dayGLANCE
        // devices discover the salt and start emitting (bridge.ts).
        await publishPairingMeta(pairing).catch((e) => console.error('dayGLANCE bridge: meta publish failed', e));
        // Beat immediately so dayGLANCE's pairing panel confirms
        // without waiting out the interval.
        await this.writeHeartbeat();
      },
      unpair: () => this.unpair(),
      // Same action as the "Sync now" command below — one behavior, two doors.
      syncNow: async () => {
        await Promise.all([this.transport.drain(), this.writeHeartbeat()]);
      },
      agendaKeyState: () => this.agenda.getStatus().key,
      verifyPassphrase: (passphrase) => this.agenda.verifyPassphrase(passphrase),
      forgetPassphrase: () => this.agenda.forgetKey(),
      openAgenda: () => this.openAgenda(),
      listUsers: () => this.agenda.users(),
      getViewer: () => this.viewer(),
      viewerIsDefault: () => this.data.viewer === undefined,
      setViewer: async (userSyncId) => {
        this.data.viewer = { userSyncId };
        await this.saveData(this.data);
        this.agenda.notifyViewerChanged();
      },
    };
    this.addSettingTab(new BridgeSettingTab(host));

    this.addCommand({
      id: 'enter-pairing-code',
      name: 'Enter pairing code',
      callback: () => {
        new PairingModal(host).open();
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
        void this.unpair();
      },
    });

    // First beat immediately — registerInterval's first tick is a full
    // interval away, and dayGLANCE's staleness window shouldn't have to
    // absorb Obsidian's startup. The offer check and the intent drain ride
    // the same cadence: drain-on-open plus interval-while-foreground is the
    // mobile story too (frozen background timers simply pause both, exactly
    // like the heartbeat).
    void this.writeHeartbeat();
    void this.checkForPairingOffer();
    void this.transport.drain();
    this.registerInterval(
      window.setInterval(() => {
        void this.writeHeartbeat();
        void this.checkForPairingOffer();
        void this.transport.drain();
      }, HEARTBEAT_INTERVAL_MS),
    );
  }

  onunload(): void {
    // Live sync (Phase 7): close the SSE stream and cancel its timers —
    // a disabled plugin must not hold a socket open.
    this.transport.shutdown();
    this.agenda.dispose();
    removeAgendaStyles(document);
    // Best-effort: a graceful quit (or a plugin disable — equally "no
    // bridge here") removes the file so readers see the truth immediately
    // instead of waiting out the staleness window. Crashes skip this, which
    // is exactly what the staleness window exists for.
    void this.app.vault.adapter.remove(normalizePath(HEARTBEAT_PATH)).catch(() => {
      /* never surface — the file may simply not exist yet */
    });
  }

  // Forget the local credentials and start beating unpaired. Best-effort:
  // clearing the meta row tells dayGLANCE devices to stop emitting; if the
  // token is already revoked server-side that call just fails.
  private async unpair(): Promise<void> {
    const previous = this.data.pairing;
    if (!previous) return;
    delete this.data.pairing;
    delete this.data.bridge;
    delete this.data.viewer;
    // Live sync must not outlive its credentials (armed-by-proof invariant):
    // tear the stream down with the pairing, not a tick later.
    this.transport.shutdown();
    // The account key is scoped to the pairing's account: forget it too, so
    // a re-pair to a different account never decrypts with the wrong key.
    await this.agenda.forgetKey();
    await this.saveData(this.data);
    await publishPairingMeta(null, previous).catch(() => {});
    await this.writeHeartbeat();
    new Notice('dayGLANCE bridge: unpaired. Also revoke the device token on your GLANCEvault server — unpairing only forgets the local credentials.');
  }

  // Explicit choice wins; else the pairing device's user; else everyone.
  private viewer(): string | null {
    if (this.data.viewer) return this.data.viewer.userSyncId;
    return this.data.pairing?.userSyncId ?? null;
  }

  // Reveal (or create, in the right sidebar) the agenda view, landing on
  // today. One leaf: reuse an existing one rather than stacking copies.
  private async openAgenda(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(AGENDA_VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    if (!existing) await leaf.setViewState({ type: AGENDA_VIEW_TYPE, active: true });
    void this.app.workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (view instanceof AgendaView) view.showDate(localDateStr(new Date()));
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
        // Stamping diagnosability (2026-08-31 config-null incident): the beat
        // carries the transport's normalize-then-observe arming tri-state so
        // dayGLANCE's bridge status panel can SHOW a plugin stuck without its
        // config row ('no-config' = daily-note reporting held, fail closed)
        // instead of the state being invisible until fragments appear.
        // Meaningful only while paired; readers gate on freshness+paired.
        stamping: this.data.pairing ? this.transport.stampingState() : null,
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
      new Notice('dayGLANCE bridge: pairing offer found — enter the code in Settings → dayGLANCE Bridge.');
    } catch {
      /* a nudge must never surface errors */
    }
  }
}
