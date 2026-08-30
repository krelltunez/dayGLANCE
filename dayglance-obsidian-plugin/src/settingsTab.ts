// The plugin settings tab — the Obsidian-idiomatic front door for pairing.
// The command-palette entries remain (and the offer nudge points at both),
// but Settings → Community plugins → dayGLANCE Bridge is where users
// expect setup to live, and this tab is that: pairing status, code entry
// when an offer is waiting, and unpair. All flow logic is shared with the
// modal (submitPairingCode in pairing.ts) so the two entry points cannot
// diverge.

import { Notice, PluginSettingTab, Setting, type App, type Plugin } from 'obsidian';
import {
  submitPairingCode,
  readPairingOfferText,
  type PairingHost,
  type BridgePairing,
} from './pairing';

export interface BridgeSettingsHost extends PairingHost {
  app: App;
  plugin: Plugin;
  unpair(): Promise<void>;
}

const pairedSince = (pairing: BridgePairing): string => {
  const t = Date.parse(pairing.pairedAt);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString() : 'unknown date';
};

export class BridgeSettingTab extends PluginSettingTab {
  private host: BridgeSettingsHost;
  private busy = false;

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
    } else {
      this.displayUnpaired();
    }
  }

  private displayPaired(pairing: BridgePairing): void {
    new Setting(this.containerEl)
      .setName('Paired with GLANCEvault')
      .setDesc(`Since ${pairedSince(pairing)} · ${pairing.vaultUrl}. dayGLANCE syncs with this vault through the plugin; to pair again with fresh keys, unpair and start pairing in dayGLANCE.`)
      .addButton((btn) => btn
        .setButtonText('Unpair')
        .setWarning()
        .onClick(async () => {
          await this.host.unpair();
          this.display();
        }));
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
