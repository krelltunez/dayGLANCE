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
  BRIDGE_VAULT_APP,
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
  /**
   * The multi-user identity of the dayGLANCE device that minted the offer —
   * the agenda's default viewer (companion 4.2, decision 9). Null/absent
   * when that account is single-user or the pairing predates the field.
   */
  userSyncId?: string | null;
}

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

export interface PairingAttempt {
  ok: boolean;
  message: string;
  /** ok only: this pairing superseded a previous one. */
  repaired?: boolean;
}

/**
 * The whole pairing flow for one entered code — read the offer, open it,
 * verify against GLANCEvault, store, tidy up. Shared by the modal and the
 * plugin settings tab so the two entry points can never diverge. Never
 * throws; the returned message is user-facing either way.
 */
export async function submitPairingCode(host: PairingHost, code: string): Promise<PairingAttempt> {
  try {
    const text = await readPairingOfferText(host.app);
    if (text === null) {
      return { ok: false, message: 'No pairing offer found in this vault. Start pairing in dayGLANCE first (Settings → Obsidian Integration → Bridge plugin).' };
    }
    const creds = await openPairingOffer(text, code);
    if (creds === null) {
      // Wrong code and unusable offer are indistinguishable by design.
      return { ok: false, message: 'That code did not open the offer. Check the code, or start pairing again in dayGLANCE.' };
    }
    if (!pairingOfferFresh(creds.createdAt)) {
      return { ok: false, message: 'This pairing offer has expired. Start pairing again in dayGLANCE.' };
    }
    const existing = host.getPairing();
    if (existing && existing.generation === creds.generation) {
      // Same generation = this very pairing, already stored (a synced
      // data.json got here first). Nothing to do but tidy up.
      await deletePairingOffer(host.app);
      return { ok: true, message: 'Already paired with this offer.' };
    }
    await verifyBridgeCredentials(creds);
    await host.storePairing({
      vaultUrl: creds.vaultUrl,
      accountId: creds.accountId,
      deviceToken: creds.deviceToken,
      subkeyB64: creds.subkeyB64,
      pairingSalt: creds.pairingSalt,
      generation: creds.generation,
      pairedAt: new Date().toISOString(),
      userSyncId: typeof creds.userSyncId === 'string' && creds.userSyncId ? creds.userSyncId : null,
    });
    await deletePairingOffer(host.app);
    return {
      ok: true,
      repaired: !!existing,
      message: existing
        ? 'Re-paired — the previous pairing is superseded.'
        : 'Paired with GLANCEvault.',
    };
  } catch (e) {
    // The offer opened but GLANCEvault rejected or was unreachable —
    // nothing was stored, and the offer stays for a retry.
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Could not verify with GLANCEvault: ${detail}` };
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
      const result = await submitPairingCode(this.host, code);
      if (result.ok) {
        new Notice(`dayGLANCE bridge: ${result.message}`);
        this.close();
      } else {
        status.setText(result.message);
      }
    } finally {
      this.busy = false;
      button.disabled = false;
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
