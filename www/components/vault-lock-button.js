import { el } from './util.js';

class VaultLockButton extends HTMLElement {
  connectedCallback() {
    this.replaceChildren(
      el(
        'button',
        {
          onclick: () => {
            this.dispatchEvent(new CustomEvent('lock', { bubbles: true }));
          },
        },
        ['Lock']
      )
    );
  }
}

customElements.define('vault-lock-button', VaultLockButton);
