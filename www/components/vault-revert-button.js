// www/components/vault-revert-button.js
//
// Discard Local Changes: clear the localStorage working copy and reload the
// page so the bundled canonical vault is re-fetched.
//
// Mode 1 only. Mode 2 (BYO) has no canonical state to revert to, so the
// parent <vault-app> does not render this button outside Mode 1.
//
// Behavior on click:
//   1. window.confirm() with a context-rich prompt naming the vault URL.
//   2. On confirm: route through storage.js::clearWorkingCopy(vaultId), then
//      location.reload(). The reload re-runs <vault-app>._initLoad, which
//      finds no working copy and falls back to the bundled bytes.
//   3. On cancel: no-op.
//
// The button is rendered disabled when no working copy exists (nothing to
// discard). The disabled state is computed at component-mount via
// hasWorkingCopy(vaultId). The header re-renders on lock/unlock and on the
// initial mount, so the disabled state stays accurate without an explicit
// vault:dirty subscription for v0.1. A future iteration could subscribe to
// vault:dirty to live-toggle the disabled state.
//
// Storage purity: clearWorkingCopy is the only path used here; no direct
// localStorage.removeItem call. The audit gate (scripts/ci-audit-storage.sh,
// Task 15) enforces that invariant across the www/ tree.

import { el, showToast } from './util.js';
import { clearWorkingCopy, hasWorkingCopy } from '../storage.js';

class VaultRevertButton extends HTMLElement {
  constructor() {
    super();
    this._vaultUrl = null;
    this._vaultId = null;
  }

  /**
   * Set the bundled-vault URL displayed in the confirmation prompt.
   * Called by the parent <vault-app> before this element is appended.
   * @param {string} url
   */
  setVaultUrl(url) {
    this._vaultUrl = url;
  }

  /**
   * Set the vault-id used to address the localStorage working copy.
   * Called by the parent <vault-app> before this element is appended.
   * @param {string} id
   */
  setVaultId(id) {
    this._vaultId = id;
  }

  connectedCallback() {
    const hasWorking = this._vaultId ? hasWorkingCopy(this._vaultId) : false;
    const props = {
      class: 'revert-btn',
      onclick: () => this._onRevert(),
      title: hasWorking
        ? 'Discard local edits and reload the bundled vault'
        : 'No local changes to discard',
    };
    if (!hasWorking) {
      props.disabled = 'disabled';
    }
    this.replaceChildren(el('button', props, ['Discard Local Changes']));
  }

  _onRevert() {
    if (!this._vaultId) {
      showToast('Revert unavailable: no vault context.');
      return;
    }
    const url = this._vaultUrl || 'the bundled vault';
    const message =
      'This will discard all changes since the bundled version.\n' +
      `The vault file at ${url} will be reloaded.\n` +
      'Continue?';
    if (!window.confirm(message)) {
      return;
    }
    try {
      clearWorkingCopy(this._vaultId);
    } catch (err) {
      showToast(`Could not clear working copy: ${err.message || err}`);
      return;
    }
    location.reload();
  }
}

customElements.define('vault-revert-button', VaultRevertButton);
