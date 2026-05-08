import { el, showToast } from './util.js';
import {
  hasWorkingCopy,
  loadVaultBytes,
  loadWorkingCopy,
  saveWorkingCopy,
  vaultIdFromAttrs,
} from '../storage.js';

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
    // Mode banner element; created in renderUnlocked, refreshed by
    // _updateBanner on lock/unlock and vault:dirty.
    this._bannerEl = null;
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
    // The mode banner reflects working-copy state, which can flip on the
    // first edit (Mode 1: canonical -> working copy). _persistAndNotify
    // fires vault:dirty after every successful save, so we re-render the
    // banner each time. The cost of refreshing one <div> is negligible.
    this.addEventListener('vault:dirty', () => this._updateBanner());
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

  /**
   * Return the current encrypted KDBX bytes, ready to download.
   *
   * Rule (per Task 9 of the L1 plan):
   *   - If the vault is unlocked, ALWAYS re-encrypt via `Vault::save_to_bytes`.
   *     This captures any unsaved in-memory edits (e.g., mid-edit form state)
   *     that may not yet have flowed through `_persistAndNotify`. What the
   *     user sees on screen is what they download.
   *   - If the vault is locked AND a working copy exists in localStorage
   *     (Mode 1), fall back to that. The bundled canonical bytes are not
   *     retained in JS after unlock (the opener nulls `bytes` to keep the
   *     WASM Vault as the sole holder), so locked Mode 2 has no source.
   *
   * Throws an Error with a user-facing message when bytes cannot be produced
   * (e.g., locked Mode 2 with no working copy).
   *
   * @returns {Uint8Array}
   */
  currentBytes() {
    if (this.vault) {
      return this.vault.save_to_bytes();
    }
    if (this._vaultId) {
      const working = loadWorkingCopy(this._vaultId);
      if (working) return working;
    }
    throw new Error('Vault is locked. Unlock to download.');
  }

  /**
   * Suggested filename for the downloaded vault.
   *
   * Mode 1 (hosted): the last path segment of `vault-url`, e.g. `vault.kdbx`.
   * Mode 2 (BYO):    a default of `vault.kdbx`. We do not retain the
   *                  user-uploaded filename across unlock today; if that
   *                  becomes desirable, the opener can pass it via the
   *                  `vault-opened` event detail.
   *
   * The result is sanitized for filesystem-safe characters and constrained
   * to a `.kdbx` extension, so an untrusted Mode 1 path or future Mode 2
   * upload name cannot inject path separators or shell metacharacters into
   * the download attribute.
   *
   * @returns {string}
   */
  suggestedFilename() {
    const vaultUrl = this.getAttribute('vault-url');
    let candidate = 'vault.kdbx';
    if (vaultUrl) {
      const trimmed = vaultUrl.split(/[?#]/)[0];
      const segments = trimmed.split('/').filter((s) => s.length > 0);
      const last = segments.length > 0 ? segments[segments.length - 1] : '';
      if (last) candidate = last;
    }
    return sanitizeFilename(candidate);
  }

  renderUnlocked() {
    const tree = el('vault-tree', { class: 'pane' });
    const list = el('vault-list', { class: 'pane' });
    const detail = el('vault-detail', { class: 'pane' });

    const headerStyle =
      'display:flex;align-items:center;gap:1rem;padding:0.5rem;border-bottom:1px solid var(--border)';

    const headerChildren = [
      el('strong', {}, [this.vault.name() || 'Vault']),
      el('span', { style: 'color:var(--muted)' }, [this.vault.version()]),
      el('vault-search', { style: 'flex:1' }),
      el('vault-download-button'),
    ];

    // Mode 1 only: bundled vault has a canonical state we can revert to.
    // Mode 2 (BYO) is in-memory only with no fallback, so the button is
    // suppressed there. `vault-url` attribute is the Mode 1 marker; vault-id
    // routes the clearWorkingCopy call through storage.js.
    const vaultUrl = this.getAttribute('vault-url');
    if (vaultUrl) {
      const revertBtn = el('vault-revert-button');
      revertBtn.setVaultUrl(vaultUrl);
      revertBtn.setVaultId(this._vaultId);
      headerChildren.push(revertBtn);
    }

    headerChildren.push(el('vault-lock-button'));

    // Mode banner sits between the header toolbar and the three-pane
    // contents. It informs the user which deployment mode is active
    // (hosted canonical, hosted working copy, or BYO) and what the
    // save/download semantics are. Rendered only while unlocked; the
    // locked UI omits it. _updateBanner fills the textContent based on
    // current state and is re-invoked on vault:dirty.
    const bannerStyle =
      'padding:0.4rem 0.75rem;background:var(--panel);border-bottom:1px solid var(--border);color:var(--muted);font-size:0.85rem';
    this._bannerEl = el('div', { class: 'mode-banner', style: bannerStyle });

    this.replaceChildren(
      el('header', { style: headerStyle }, headerChildren),
      this._bannerEl,
      el('div', { class: 'three-pane' }, [tree, list, detail])
    );

    this._updateBanner();
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
    // The unlocked-state banner is owned by renderUnlocked; clear the
    // reference here so the locked render path does not retain a stale
    // node from the prior unlock.
    this._bannerEl = null;
    // Re-resolve initial bytes via the storage adapter so a Mode 1 lock
    // returns to the unlocker (with current localStorage working copy if
    // present), and a Mode 2 lock returns to the file picker.
    this._initLoad();
  }

  /**
   * Refresh the mode banner text to reflect current state.
   *
   * Three states:
   *   - Mode 2 (BYO): no vault-url attribute. In-memory only; download is
   *     the sole export.
   *   - Mode 1 hosted, canonical: vault-url present, no working copy in
   *     localStorage yet. Edits will create the working copy.
   *   - Mode 1 hosted, working copy: vault-url present and a working copy
   *     exists in localStorage. Download exports it; Discard Local Changes
   *     reverts to canonical.
   *
   * `hasWorkingCopy` is the source of truth for the working-copy distinction.
   * Called after the banner element is created (renderUnlocked) and after
   * each vault:dirty event.
   */
  _updateBanner() {
    if (!this._bannerEl) return;
    const vaultUrl = this.getAttribute('vault-url');
    if (!vaultUrl) {
      this._bannerEl.textContent =
        'BYO vault. Changes are in memory only. Click Download to save.';
      return;
    }
    const filename = lastPathSegment(vaultUrl);
    const hasWC = this._vaultId ? hasWorkingCopy(this._vaultId) : false;
    if (hasWC) {
      this._bannerEl.textContent = `Editing vault from ${filename}. Changes save to this browser; click Download to export, Discard Local Changes to revert.`;
    } else {
      this._bannerEl.textContent = `Editing vault from ${filename}. Changes save to this browser.`;
    }
  }
}

/**
 * Extract the trailing path segment of a URL or path-like string for
 * display in the mode banner. Strips query and hash, then returns the
 * last non-empty segment. Falls back to the original string if no
 * segment can be derived (e.g., a bare `vault.kdbx` returns itself).
 *
 * Used by `<vault-app>._updateBanner()` so a `vault-url` like
 * `/vaults/personal.kdbx` displays as `personal.kdbx` for tidiness.
 *
 * @param {string} url
 * @returns {string}
 */
function lastPathSegment(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.split(/[?#]/)[0];
  const segments = trimmed.split('/').filter((s) => s.length > 0);
  return segments.length > 0 ? segments[segments.length - 1] : trimmed;
}

/**
 * Reduce a candidate filename to filesystem-safe ASCII and force a `.kdbx`
 * extension. Used by `<vault-app>.suggestedFilename()` to keep an untrusted
 * `vault-url` value or future Mode 2 upload name from injecting path
 * separators or shell metacharacters into the anchor's `download` attribute.
 *
 * Rules:
 *   - Drop any path components; keep only the last segment.
 *   - Replace anything outside [A-Za-z0-9._-] with `_`.
 *   - Cap length at 64 chars (excluding extension).
 *   - Force `.kdbx` extension.
 *   - Fall back to `vault.kdbx` if the result is empty after sanitization.
 *
 * @param {string} name
 * @returns {string}
 */
function sanitizeFilename(name) {
  if (!name || typeof name !== 'string') return 'vault.kdbx';
  const lastSegment = name.split(/[\\/]/).pop() || '';
  const stripped = lastSegment.replace(/\.kdbx$/i, '');
  const safe = stripped.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
  if (!safe) return 'vault.kdbx';
  return `${safe}.kdbx`;
}

customElements.define('vault-app', VaultApp);
