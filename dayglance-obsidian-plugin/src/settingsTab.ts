// The plugin settings tab — the Obsidian-idiomatic front door for pairing.
// The command-palette entries remain (and the offer nudge points at both),
// but Settings → Community plugins → dayGLANCE Bridge is where users
// expect setup to live, and this tab is that: pairing status, code entry
// when an offer is waiting, a Sync now button, unpair (two-step), and the
// build stamp. All flow logic is shared with the modal (submitPairingCode
// in pairing.ts) and with the command-palette entries (the host callbacks),
// so the entry points cannot diverge.

import { Notice, PluginSettingTab, Setting, type App, type Plugin } from 'obsidian';
import {
  submitPairingCode,
  readPairingOfferText,
  type PairingHost,
  type BridgePairing,
} from './pairing';
import type { AgendaKeyState } from './agenda';

// Stamped by esbuild at bundle time (see esbuild.config.mjs `define`).
// Guarded so a build without the define (tests, tooling) still runs.
declare const __BUILD_TIME__: string | undefined;
const buildTime = (): string => {
  try {
    if (typeof __BUILD_TIME__ === 'string') {
      const t = Date.parse(__BUILD_TIME__);
      if (Number.isFinite(t)) return new Date(t).toLocaleString();
    }
  } catch { /* fall through */ }
  return 'unknown';
};

export interface BridgeSettingsHost extends PairingHost {
  app: App;
  plugin: Plugin;
  unpair(): Promise<void>;
  /** Same action as the command-palette "Sync now": drain intents + refresh the heartbeat. */
  syncNow(): Promise<void>;
  /**
   * The sidebar's account-key half (agenda.ts). The passphrase is used once
   * to derive the root key into device-local storage; it is never stored.
   */
  agendaKeyState(): AgendaKeyState;
  verifyPassphrase(passphrase: string): Promise<{ ok: boolean; message: string }>;
  forgetPassphrase(): Promise<void>;
  openAgenda(): Promise<void>;
}

const pairedSince = (pairing: BridgePairing): string => {
  const t = Date.parse(pairing.pairedAt);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString() : 'unknown date';
};

export class BridgeSettingTab extends PluginSettingTab {
  private host: BridgeSettingsHost;
  private busy = false;
  private syncing = false;

  constructor(host: BridgeSettingsHost) {
    super(host.app, host.plugin);
    this.host = host;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const pairing = this.host.getPairing();
    if (pairing) {
      this.displayPaired(pairing);
      this.displayAccount();
    } else {
      this.displayUnpaired();
    }
    this.displayBuildInfo();
  }

  private displayPaired(pairing: BridgePairing): void {
    new Setting(this.containerEl)
      .setName('Paired with GLANCEvault')
      .setDesc(`Since ${pairedSince(pairing)} · ${pairing.vaultUrl}. dayGLANCE syncs with this vault through the plugin; to pair again with fresh keys, unpair and start pairing in dayGLANCE.`);

    new Setting(this.containerEl)
      .setName('Sync now')
      .setDesc('Drain pending dayGLANCE changes into this vault and refresh the heartbeat. The same action as the command-palette entry; syncing also runs on its own every 30 seconds while Obsidian is open.')
      .addButton((btn) => btn
        .setButtonText('Sync now')
        .setCta()
        .onClick(async () => {
          if (this.syncing) return;
          this.syncing = true;
          btn.setButtonText('Syncing…').setDisabled(true);
          try {
            await this.host.syncNow();
            new Notice('dayGLANCE bridge: synced.');
          } finally {
            this.syncing = false;
            btn.setButtonText('Sync now').setDisabled(false);
          }
        }));

    // Two-step unpair: a single stray click on a settings page must not tear
    // down the pairing. The first click arms the button; the second (within
    // the timeout) unpairs; anything else disarms.
    let armed = false;
    let disarmTimer: number | null = null;
    new Setting(this.containerEl)
      .setName('Unpair dayGLANCE')
      .setDesc('Forget this vault’s pairing credentials and stop the bridge. dayGLANCE reverts to direct vault access on its next sync. Also revoke the device token on your GLANCEvault server — unpairing only forgets the local half.')
      .addButton((btn) => btn
        .setButtonText('Unpair')
        .setWarning()
        .onClick(async () => {
          if (!armed) {
            armed = true;
            btn.setButtonText('Click again to unpair');
            disarmTimer = window.setTimeout(() => {
              armed = false;
              btn.setButtonText('Unpair');
            }, 5000);
            return;
          }
          if (disarmTimer !== null) window.clearTimeout(disarmTimer);
          await this.host.unpair();
          this.display();
        }));
  }

  // The sidebar view reads the account's task rows directly from
  // GLANCEvault, which needs the account root key on this device. The
  // passphrase field is transient: it derives the key (PBKDF2, the same
  // derivation dayGLANCE runs) into the plugin's own IndexedDB store and is
  // discarded. Nothing here is written to data.json, which Obsidian Sync
  // would carry to every copy of the vault.
  private displayAccount(): void {
    this.containerEl.createEl('h3', { text: 'dayGLANCE account' });
    const state = this.host.agendaKeyState();
    if (state === 'ready') {
      new Setting(this.containerEl)
        .setName('Sync passphrase verified on this device')
        .setDesc('The dayGLANCE agenda view can read your tasks. The key is stored only on this device; the passphrase itself was not kept.')
        .addButton((btn) => btn
          .setButtonText('Open agenda')
          .setCta()
          .onClick(() => void this.host.openAgenda()))
        .addButton((btn) => btn
          .setButtonText('Forget')
          .setWarning()
          .onClick(async () => {
            await this.host.forgetPassphrase();
            this.display();
          }));
      return;
    }
    let passphrase = '';
    let resultEl: HTMLElement | null = null;
    const submit = async () => {
      if (this.busy) return;
      this.busy = true;
      resultEl?.setText('Checking…');
      try {
        const result = await this.host.verifyPassphrase(passphrase);
        if (result.ok) {
          new Notice(`dayGLANCE bridge: ${result.message}`);
          this.display();
        } else {
          resultEl?.setText(result.message);
        }
      } finally {
        this.busy = false;
      }
    };
    new Setting(this.containerEl)
      .setName('Sync passphrase')
      .setDesc('Your dayGLANCE database-sync passphrase. Needed once per device so the agenda view can decrypt your tasks. It is used to derive a key and then discarded.')
      .addText((text) => {
        text.setPlaceholder('passphrase').onChange((v) => { passphrase = v; });
        text.inputEl.type = 'password';
        text.inputEl.autocomplete = 'off';
        text.inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') void submit(); });
      })
      .addButton((btn) => btn
        .setButtonText('Verify')
        .setCta()
        .onClick(() => void submit()));
    resultEl = this.containerEl.createEl('p', { text: '', cls: 'setting-item-description' });
  }

  private displayUnpaired(): void {
    const status = new Setting(this.containerEl)
      .setName('Not paired')
      .setDesc('Checking for a pairing offer…');
    // The offer check is async; Setting construction is not. Fill in.
    void readPairingOfferText(this.host.app).then((text) => {
      status.setDesc(text !== null
        ? 'A pairing offer is waiting in this vault — enter the code dayGLANCE is showing.'
        : 'To pair: in dayGLANCE, open Settings → Obsidian Integration → Bridge plugin, click Start pairing, then enter the code here.');
    });

    let code = '';
    let resultEl: HTMLElement | null = null;
    new Setting(this.containerEl)
      .setName('Pairing code')
      .setDesc('The one-time code dayGLANCE displays (xxxx-xxxx-xxxxx).')
      .addText((text) => {
        text.setPlaceholder('xxxx-xxxx-xxxxx').onChange((v) => { code = v; });
        text.inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') void this.pair(code, resultEl); });
      })
      .addButton((btn) => btn
        .setButtonText('Pair')
        .setCta()
        .onClick(() => void this.pair(code, resultEl)));
    resultEl = this.containerEl.createEl('p', { text: '' });
  }

  // Shown in BOTH views: "which main.js is this vault actually loading?" is
  // a debugging question that comes up exactly when things are broken, so it
  // must not depend on pairing state.
  private displayBuildInfo(): void {
    const version = (this.host.plugin as Plugin & { manifest?: { version?: string } }).manifest?.version ?? '?';
    this.containerEl.createEl('p', {
      text: `dayGLANCE Bridge v${version} · built ${buildTime()}`,
      cls: 'setting-item-description',
    });
  }

  private async pair(code: string, resultEl: HTMLElement | null): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    resultEl?.setText('Checking…');
    try {
      const result = await submitPairingCode(this.host, code);
      if (result.ok) {
        new Notice(`dayGLANCE bridge: ${result.message}`);
        this.display(); // re-render into the paired view
      } else {
        resultEl?.setText(result.message);
      }
    } finally {
      this.busy = false;
    }
  }
}
