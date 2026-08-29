// Pairing — the plugin (offer-opening) half of the Phase 6 vault dead-drop.
//
// dayGLANCE seals the bridge credentials into `.dayglance/pairing` under a
// one-time code it displays; here the user types that code, the offer is
// opened, the carried device token is VERIFIED against GLANCEvault (one
// authenticated list call — a wrong URL or revoked token fails before
// anything is stored), the credentials land in the plugin's data.json, and
// the offer file is deleted. Wire format and crypto live in
// @glance-apps/obsidian-format (bridgePairing.js); this module is flow only.
//
// The stored pairing is PER-VAULT, not per-device: data.json rides
// Obsidian's own settings sync to every copy of this vault, so one pairing
// pairs them all, and `generation` (the pairing salt, minted fresh per
// offer) is how a copy recognizes that a newer pairing supersedes the one
// it carries. Revocation is therefore vault-wide: revoke the token
// server-side and re-pair.

import { App, Modal, Notice, normalizePath, requestUrl } from 'obsidian';
import {
  openPairingOffer,
  pairingOfferFresh,
  PAIRING_PATH,
  type BridgePairingCredentials,
} from '@glance-apps/obsidian-format';
import { createVaultClient } from '@glance-apps/sync/src/vaultClient.js';

export interface BridgePairing {
  vaultUrl: string;
  accountId: string;
  deviceToken: string;
  subkeyB64: string;
  pairingSalt: string;
  generation: string;
  pairedAt: string;
}

// The GLANCEvault namespace for everything the bridge stores. App-scoped
// endpoints keep this fully separate from dayGLANCE's own 'dayglance' rows.
export const BRIDGE_VAULT_APP = 'dayglance-bridge';

// fetch shim over Obsidian's requestUrl — the sanctioned way to make
// cross-origin requests from a plugin (plain fetch is CORS-bound in the
// app's webview; requestUrl is not, on desktop and mobile alike).
const obsidianFetch = async (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
) => {
  const resp = await requestUrl({
    url,
    method: init.method ?? 'GET',
    headers: init.headers ?? {},
    body: init.body,
    throw: false,
  });
  return {
    ok: resp.status >= 200 && resp.status < 300,
    status: resp.status,
    json: async () => resp.json,
  };
};

/**
 * One authenticated round-trip proving the credentials work: URL reachable,
 * token accepted. Throws with the transport's message when they don't.
 */
export async function verifyBridgeCredentials(creds: BridgePairingCredentials): Promise<void> {
  const client = createVaultClient({
    vaultUrl: creds.vaultUrl,
    vaultToken: creds.deviceToken,
    fetchImpl: obsidianFetch,
  });
  await client.list(BRIDGE_VAULT_APP, { accountId: creds.accountId, since: 0 });
}

export interface PairingHost {
  app: App;
  getPairing(): BridgePairing | undefined;
  storePairing(pairing: BridgePairing): Promise<void>;
}

export async function readPairingOfferText(app: App): Promise<string | null> {
  const path = normalizePath(PAIRING_PATH);
  try {
    if (!(await app.vault.adapter.exists(path))) return null;
    return await app.vault.adapter.read(path);
  } catch {
    return null;
  }
}

export async function deletePairingOffer(app: App): Promise<void> {
  try {
    await app.vault.adapter.remove(normalizePath(PAIRING_PATH));
  } catch {
    /* already gone */
  }
}

export class PairingModal extends Modal {
  private host: PairingHost;
  private busy = false;

  constructor(host: PairingHost) {
    super(host.app);
    this.host = host;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: 'Pair with dayGLANCE' });
    contentEl.createEl('p', {
      text: 'Enter the pairing code shown in dayGLANCE settings (Obsidian Integration → Bridge plugin).',
    });
    const input = contentEl.createEl('input', { type: 'text', attr: { placeholder: 'xxxx-xxxx-xxxxx', spellcheck: 'false' } });
    input.style.width = '100%';
    const status = contentEl.createEl('p', { text: '' });
    const button = contentEl.createEl('button', { text: 'Pair' });
    button.style.marginTop = '0.5em';

    const submit = () => void this.submit(input.value, status, button);
    button.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    input.focus();
  }

  private async submit(code: string, status: HTMLParagraphElement, button: HTMLButtonElement): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    button.disabled = true;
    status.setText('Checking…');
    try {
      const text = await readPairingOfferText(this.host.app);
      if (text === null) {
        status.setText('No pairing offer found in this vault. Start pairing in dayGLANCE first.');
        return;
      }
      const creds = await openPairingOffer(text, code);
      if (creds === null) {
        // Wrong code and unusable offer are indistinguishable by design.
        status.setText('That code did not open the offer. Check the code, or start pairing again in dayGLANCE.');
        return;
      }
      if (!pairingOfferFresh(creds.createdAt)) {
        status.setText('This pairing offer has expired. Start pairing again in dayGLANCE.');
        return;
      }
      const existing = this.host.getPairing();
      if (existing && existing.generation === creds.generation) {
        // Same generation = this very pairing, already stored (a synced
        // data.json got here first). Nothing to do but tidy up.
        await deletePairingOffer(this.host.app);
        status.setText('Already paired with this offer.');
        return;
      }
      status.setText('Verifying with GLANCEvault…');
      await verifyBridgeCredentials(creds);
      await this.host.storePairing({
        vaultUrl: creds.vaultUrl,
        accountId: creds.accountId,
        deviceToken: creds.deviceToken,
        subkeyB64: creds.subkeyB64,
        pairingSalt: creds.pairingSalt,
        generation: creds.generation,
        pairedAt: new Date().toISOString(),
      });
      await deletePairingOffer(this.host.app);
      new Notice(existing
        ? 'dayGLANCE bridge: re-paired — the previous pairing is superseded.'
        : 'dayGLANCE bridge: paired with GLANCEvault.');
      this.close();
    } catch (e) {
      // The offer opened but GLANCEvault rejected or was unreachable —
      // nothing was stored, and the offer stays for a retry.
      const detail = e instanceof Error ? e.message : String(e);
      status.setText(`Could not verify with GLANCEvault: ${detail}`);
    } finally {
      this.busy = false;
      button.disabled = false;
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
