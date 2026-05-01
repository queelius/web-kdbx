import { el } from './util.js';

class VaultSearch extends HTMLElement {
  connectedCallback() {
    let timer = null;
    const input = el('input', {
      type: 'search',
      placeholder: 'Search entries...',
      autocomplete: 'off',
      oninput: () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          this.dispatchEvent(
            new CustomEvent('search-query', {
              bubbles: true,
              detail: { query: input.value },
            })
          );
        }, 150);
      },
    });
    this.replaceChildren(input);
  }
}

customElements.define('vault-search', VaultSearch);
