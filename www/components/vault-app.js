import { el, showToast } from './util.js';

class VaultApp extends HTMLElement {
  constructor() {
    super();
    this.vault = null;
    this.selectedGroupUuid = null;
    this.selectedEntryUuid = null;
    this._totpInterval = null;
  }

  connectedCallback() {
    this.renderLocked();
    this.addEventListener('vault-opened', (e) => this.handleVaultOpened(e));
    this.addEventListener('select-group', (e) => this.handleSelectGroup(e));
    this.addEventListener('select-entry', (e) => this.handleSelectEntry(e));
    this.addEventListener('search-query', (e) => this.handleSearch(e));
    this.addEventListener('reveal-field', (e) => this.handleRevealField(e));
    this.addEventListener('copy-field', (e) => this.handleCopyField(e));
    this.addEventListener('copy-totp', (e) => this.handleCopyTotp(e));
    this.addEventListener('totp-refresh-request', (e) => this.handleTotpRefresh(e));
    this.addEventListener('lock', () => this.handleLock());
  }

  renderLocked() {
    this.replaceChildren(el('vault-opener'));
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
    this.renderLocked();
  }
}

customElements.define('vault-app', VaultApp);
