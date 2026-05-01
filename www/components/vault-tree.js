import { el } from './util.js';

class VaultTree extends HTMLElement {
  set data(tree) {
    this._data = tree;
    this.render();
  }

  connectedCallback() {
    this.render();
  }

  render() {
    if (!this._data) {
      this.replaceChildren();
      return;
    }
    const root = el('ul', { style: 'list-style:none;padding:0' }, [
      this.buildGroupNode(this._data),
    ]);
    this.replaceChildren(root);
  }

  buildGroupNode(group) {
    const click = () => {
      this.dispatchEvent(
        new CustomEvent('select-group', {
          bubbles: true,
          detail: { uuid: group.uuid },
        })
      );
    };

    const header = el(
      'div',
      {
        dataset: { uuid: group.uuid },
        style: 'cursor:pointer;padding:0.2rem 0.4rem;border-radius:3px',
        onclick: click,
      },
      [
        el('span', {}, [group.name]),
        ' ',
        el('span', { style: 'color:var(--muted);font-size:0.85em' }, [
          `(${group.entry_count})`,
        ]),
      ]
    );

    const children =
      group.children && group.children.length > 0
        ? el(
            'ul',
            { style: 'list-style:none;padding-left:1rem' },
            group.children.map((c) => this.buildGroupNode(c))
          )
        : null;

    return el('li', {}, children ? [header, children] : [header]);
  }
}

customElements.define('vault-tree', VaultTree);
