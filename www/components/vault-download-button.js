// www/components/vault-download-button.js
//
// Download Vault: export the current encrypted KDBX bytes as a .kdbx file.
//
// This is the universal export path for both Mode 1 (hosted) and Mode 2 (BYO).
// It works regardless of mode whenever the parent <vault-app> can produce
// current bytes via `currentBytes()`. The button asks <vault-app> on each
// click; it never caches bytes in component state.
//
// Behavior chain on click:
//   1. Walk up the DOM to the parent <vault-app>.
//   2. Call `app.currentBytes()` to obtain a `Uint8Array`. This may throw
//      with a user-facing message (e.g., "Vault is locked") if no bytes
//      can be produced.
//   3. Build a Blob with `type: 'application/x-keepass2'`.
//   4. Construct an object URL, click a hidden anchor with the suggested
//      filename, then revoke the URL to release the bytes.
//
// XSS hygiene: filename comes from `app.suggestedFilename()`, which sanitizes
// untrusted Mode 2 user-supplied names. The button never inserts the filename
// into innerHTML.

import { el, showToast } from './util.js';

class VaultDownloadButton extends HTMLElement {
  connectedCallback() {
    this.replaceChildren(
      el(
        'button',
        {
          class: 'download-btn',
          onclick: () => this._onDownload(),
          title: 'Download the current vault as a .kdbx file',
        },
        ['Download Vault']
      )
    );
  }

  _findApp() {
    // Walk up to find the parent <vault-app>. The button is rendered inside
    // <vault-app>'s header, so closest() resolves it directly.
    return this.closest('vault-app');
  }

  _onDownload() {
    const app = this._findApp();
    if (!app) {
      showToast('Download unavailable: no vault context.');
      return;
    }

    let bytes;
    try {
      bytes = app.currentBytes();
    } catch (err) {
      showToast(String(err.message || err));
      return;
    }

    if (!bytes || bytes.length === 0) {
      showToast('No vault bytes available to download.');
      return;
    }

    const filename = app.suggestedFilename();
    const blob = new Blob([bytes], { type: 'application/x-keepass2' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    try {
      a.click();
    } finally {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }
}

customElements.define('vault-download-button', VaultDownloadButton);
