import { el } from './util.js';

class VaultList extends HTMLElement {
  set entries(es) {
    this._entries = es || [];
    this.render();
  }

  connectedCallback() {
    this.render();
  }

  render() {
    if (!this._entries || this._entries.length === 0) {
      this.replaceChildren(
        el('p', { style: 'color:var(--muted)' }, ['No entries.'])
      );
      return;
    }
    const items = this._entries.map((entry) => this.buildEntryRow(entry));
    this.replaceChildren(
      el('ul', { style: 'list-style:none;padding:0;margin:0' }, items)
    );
  }

  buildEntryRow(entry) {
    const click = () => {
      this.dispatchEvent(
        new CustomEvent('select-entry', {
          bubbles: true,
          detail: { uuid: entry.uuid },
        })
      );
    };
    const children = [el('div', {}, [el('strong', {}, [entry.title])])];
    if (entry.username) {
      children.push(
        el(
          'div',
          { style: 'color:var(--muted);font-size:0.9em' },
          [entry.username]
        )
      );
    }
    if (entry.has_totp) {
      children.push(el('div', { style: 'font-size:0.85em' }, ['TOTP']));
    }
    return el(
      'li',
      {
        dataset: { uuid: entry.uuid },
        style:
          'padding:0.5rem;border-bottom:1px solid var(--border);cursor:pointer',
        onclick: click,
      },
      children
    );
  }
}

customElements.define('vault-list', VaultList);
