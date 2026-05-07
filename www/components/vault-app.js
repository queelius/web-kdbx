import { el, showToast } from './util.js';
import { loadVaultBytes, saveWorkingCopy, vaultIdFromAttrs } from '../storage.js';

class VaultApp extends HTMLElement {
  constructor() {
    super();
    this.vault = null;
    this.selectedGroupUuid = null;
    this.selectedEntryUuid = null;
    this._totpInterval = null;
    // Mode + working-copy metadata; populated by _initLoad().
    this._vaultId = null;
    this._isWorkingCopy = false;
    this._isHostedMode = false;
  }

  connectedCallback() {
    this.addEventListener('vault-opened', (e) => this.handleVaultOpened(e));
    this.addEventListener('select-group', (e) => this.handleSelectGroup(e));
    this.addEventListener('select-entry', (e) => this.handleSelectEntry(e));
    this.addEventListener('search-query', (e) => this.handleSearch(e));
    this.addEventListener('reveal-field', (e) => this.handleRevealField(e));
    this.addEventListener('copy-field', (e) => this.handleCopyField(e));
    this.addEventListener('copy-totp', (e) => this.handleCopyTotp(e));
    this.addEventListener('totp-refresh-request', (e) => this.handleTotpRefresh(e));
    this.addEventListener('lock', () => this.handleLock());
    this._initLoad();
  }

  /**
   * Resolve initial vault bytes via the storage adapter and route to the
   * appropriate UI. Called from connectedCallback. Three branches:
   *
   *   1. loadVaultBytes returns { bytes, source, vaultId }
   *      -> render the unlocker pre-populated with bytes (Mode 1).
   *   2. loadVaultBytes returns null
   *      -> render the file-picker opener (Mode 2 BYO).
   *   3. loadVaultBytes throws (fetch failure for Mode 1)
   *      -> render an error card with a retry control.
   */
  async _initLoad() {
    const vaultUrl = this.getAttribute('vault-url');
    const vaultIdAttr = this.getAttribute('vault-id');
    this._isHostedMode = !!vaultUrl;

    let initial;
    try {
      initial = await loadVaultBytes({ vaultUrl, vaultId: vaultIdAttr });
    } catch (err) {
      this._renderFetchError(vaultUrl, err);
      return;
    }

    if (initial) {
      this._vaultId = initial.vaultId;
      this._isWorkingCopy = initial.source === 'localStorage';
      this.renderLocked(initial);
    } else {
      // Mode 2 BYO. vaultId is unknown until the user picks a file; storage.js
      // helpers handle that derivation later (Task 6).
      this._vaultId = vaultIdFromAttrs({ vaultUrl, vaultId: vaultIdAttr });
      this.renderLocked(null);
    }
  }

  /**
   * @param {{ bytes: Uint8Array, source: 'localStorage'|'bundled', vaultId: string }|null} initial
   */
  renderLocked(initial) {
    const opener = el('vault-opener');
    if (initial) {
      // Configure preload state before connecting so connectedCallback
      // renders the unlock card directly (no flicker through the picker).
      const sourceLabel = this._isWorkingCopy
        ? `${this.getAttribute('vault-url') || initial.vaultId} (working copy)`
        : this.getAttribute('vault-url') || initial.vaultId;
      const subtitle = this._isWorkingCopy
        ? 'Local edits restored from this browser.'
        : 'Loaded from bundled vault.';
      opener.setPreloadedBytes(initial.bytes, {
        label: sourceLabel,
        subtitle,
      });
    }
    this.replaceChildren(opener);
  }

  _renderFetchError(vaultUrl, err) {
    const message = `Could not load vault from ${vaultUrl}: ${err.message || err}.`;
    const retryBtn = el(
      'button',
      {
        style: 'margin-top:1rem',
        onclick: () => this._initLoad(),
      },
      ['Retry']
    );
    const fallbackBtn = el(
      'button',
      {
        style: 'margin-top:1rem;margin-left:0.5rem',
        onclick: () => {
          this._isHostedMode = false;
          this._vaultId = null;
          this.renderLocked(null);
        },
      },
      ['Open a different vault']
    );
    const card = el(
      'div',
      {
        style:
          'max-width:400px;margin:4rem auto;padding:1.5rem;background:var(--panel);border:1px solid var(--border);border-radius:8px',
      },
      [
        el('h2', { style: 'margin-top:0' }, ['Vault unavailable']),
        el('p', { class: 'error' }, [message]),
        el('div', {}, [retryBtn, fallbackBtn]),
      ]
    );
    this.replaceChildren(card);
  }

  /**
   * Auto-save chokepoint for L1 write operations.
   *
   * Future write tools (`Vault::update_field`, `Vault::add_entry`, etc.) return
   * fresh encrypted KDBX bytes from the WASM Vault. Pass those bytes to this
   * method to persist them to localStorage as the new working copy.
   *
   * Behavior by mode:
   *   - Mode 1 hosted (`_vaultId` present): bytes are persisted via
   *     `saveWorkingCopy(vaultId, bytes)`, the only sanctioned storage
   *     write path. Subsequent reloads see the working copy.
   *   - Mode 2 BYO (`_vaultId` absent): no-op save. Writes are in-memory only;
   *     the user must use the Download button to export.
   *
   * Fires a `vault:dirty` custom event (bubbles, composed) after a successful
   * save so UI components (mode banner, download button, etc.) can react.
   * The event detail describes the mode and whether bytes were persisted:
   *   - hosted: `{ mode: 'hosted', persisted: true, vaultId }`
   *   - BYO:    `{ mode: 'byo', persisted: false }`
   *
   * `saveWorkingCopy` surfaces `QuotaExceededError` as a friendly Error;
   * callers should catch and present a user-visible message. `storage.js`
   * does not retry.
   *
   * @param {Uint8Array} newBytes - encrypted KDBX bytes from a write call
   */
  _persistAndNotify(newBytes) {
    if (!this._vaultId) {
      // BYO mode: no auto-save. Download is the only export path. Still
      // dispatch vault:dirty so a future banner can prompt for download.
      this.dispatchEvent(
        new CustomEvent('vault:dirty', {
          bubbles: true,
          composed: true,
          detail: { mode: 'byo', persisted: false },
        })
      );
      return;
    }
    saveWorkingCopy(this._vaultId, newBytes);
    this.dispatchEvent(
      new CustomEvent('vault:dirty', {
        bubbles: true,
        composed: true,
        detail: { mode: 'hosted', persisted: true, vaultId: this._vaultId },
      })
    );
  }

  renderUnlocked() {
    const tree = el('vault-tree', { class: 'pane' });
    const list = el('vault-list', { class: 'pane' });
    const detail = el('vault-detail', { class: 'pane' });

    const headerStyle =
      'display:flex;align-items:center;gap:1rem;padding:0.5rem;border-bottom:1px solid var(--border)';

    this.replaceChildren(
      el('header', { style: headerStyle }, [
        el('strong', {}, [this.vault.name() || 'Vault']),
        el('span', { style: 'color:var(--muted)' }, [this.vault.version()]),
        el('vault-search', { style: 'flex:1' }),
        el('vault-lock-button'),
      ]),
      el('div', { class: 'three-pane' }, [tree, list, detail])
    );

    tree.data = this.vault.group_tree();
  }

  handleVaultOpened(e) {
    this.vault = e.detail.vault;
    this.renderUnlocked();
  }

  handleSelectGroup(e) {
    this.selectedGroupUuid = e.detail.uuid;
    this.selectedEntryUuid = null;
    this.querySelector('vault-list').entries =
      this.vault.entries_in_group(e.detail.uuid);
    this.querySelector('vault-detail').entry = null;
  }

  handleSelectEntry(e) {
    this.selectedEntryUuid = e.detail.uuid;
    const data = this.vault.entry(e.detail.uuid);
    this.querySelector('vault-detail').entry = data || null;
  }

  handleSearch(e) {
    const q = e.detail.query;
    const list = this.querySelector('vault-list');
    if (!q || q.length === 0) {
      list.entries = this.selectedGroupUuid
        ? this.vault.entries_in_group(this.selectedGroupUuid)
        : [];
    } else {
      list.entries = this.vault.search(q);
    }
  }

  handleRevealField(e) {
    const { entry_uuid, field_name } = e.detail;
    const plaintext = this.vault.reveal_field(entry_uuid, field_name);
    const detail = this.querySelector('vault-detail');
    if (detail) detail.setRevealedField(field_name, plaintext);
  }

  async handleCopyField(e) {
    const { entry_uuid, field_name } = e.detail;
    const plaintext = this.vault.reveal_field(entry_uuid, field_name);
    if (plaintext == null) {
      showToast('Field unavailable.');
      return;
    }
    await this.copyToClipboardWithAutoClear(plaintext);
  }

  async handleCopyTotp(e) {
    const { entry_uuid } = e.detail;
    const totp = this.vault.totp(entry_uuid);
    if (!totp) {
      showToast('No TOTP for this entry.');
      return;
    }
    await this.copyToClipboardWithAutoClear(totp.code);
  }

  handleTotpRefresh(e) {
    const totp = this.vault.totp(e.detail.uuid);
    const detail = this.querySelector('vault-detail');
    if (detail && totp) {
      detail.setTotpDisplay(totp.code, totp.seconds_remaining);
    }
  }

  async copyToClipboardWithAutoClear(text) {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied. Auto-clearing in 12s.');
      setTimeout(async () => {
        try {
          await navigator.clipboard.writeText('');
        } catch (_) {
          // Some browsers reject silent overwrites.
        }
      }, 12000);
    } catch (err) {
      showToast('Could not access clipboard. Value was revealed in detail panel.');
    }
  }

  handleLock() {
    if (this.vault) {
      this.vault.free();
      this.vault = null;
    }
    navigator.clipboard.writeText('').catch(() => {});
    this.selectedGroupUuid = null;
    this.selectedEntryUuid = null;
    // Re-resolve initial bytes via the storage adapter so a Mode 1 lock
    // returns to the unlocker (with current localStorage working copy if
    // present), and a Mode 2 lock returns to the file picker.
    this._initLoad();
  }
}

customElements.define('vault-app', VaultApp);
