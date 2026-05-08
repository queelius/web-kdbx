import { el } from './util.js';

class VaultList extends HTMLElement {
  constructor() {
    super();
    this._entries = [];
    this._adding = false;
  }

  set entries(es) {
    this._entries = es || [];
    // Any incoming entries replacement (group selection, search) implicitly
    // exits add mode. The form's own save/cancel paths set _adding = false
    // before re-rendering, so this only fires for external resets.
    this._adding = false;
    this.render();
  }

  connectedCallback() {
    this.addEventListener('vault-add-saved', (e) => this._onAddSaved(e));
    this.addEventListener('vault-add-cancelled', (e) => this._onAddCancelled(e));
    this.render();
  }

  render() {
    if (this._adding) {
      this._renderAdder();
      return;
    }

    const blocks = [this._buildAddButton()];
    if (!this._entries || this._entries.length === 0) {
      blocks.push(el('p', { style: 'color:var(--muted)' }, ['No entries.']));
    } else {
      const items = this._entries.map((entry) => this.buildEntryRow(entry));
      blocks.push(
        el('ul', { style: 'list-style:none;padding:0;margin:0' }, items)
      );
    }
    this.replaceChildren(...blocks);
  }

  // The Add Entry button sits at the top of the list pane. It's hidden
  // (returns null, dropped by replaceChildren) when no group is selected
  // since add_entry needs a target group UUID. The group UUID is read from
  // the parent <vault-app> via closest(), the same pattern <vault-entry-edit>
  // uses to reach the WASM Vault.
  _buildAddButton() {
    const groupUuid = this._currentGroupUuid();
    if (!groupUuid) return null;
    return el(
      'div',
      {
        style:
          'padding:0.5rem;border-bottom:1px solid var(--border);display:flex;justify-content:flex-end',
      },
      [
        el(
          'button',
          {
            type: 'button',
            class: 'add-entry-btn',
            onclick: () => this._enterAddMode(),
          },
          ['Add Entry']
        ),
      ]
    );
  }

  _currentGroupUuid() {
    const app = this.closest('vault-app');
    return app && app.selectedGroupUuid ? app.selectedGroupUuid : null;
  }

  _enterAddMode() {
    if (!this._currentGroupUuid()) return;
    this._adding = true;
    this.render();
  }

  _renderAdder() {
    const adder = el('vault-add-entry');
    this.replaceChildren(adder);
    // setGroupUuid triggers an internal render on the form; we call it after
    // the element is connected so its connectedCallback fires first.
    adder.setGroupUuid(this._currentGroupUuid());
  }

  _refreshEntriesFromVault() {
    const app = this.closest('vault-app');
    if (!app || !app.vault) return;
    const groupUuid = this._currentGroupUuid();
    if (!groupUuid) return;
    try {
      this._entries = app.vault.entries_in_group(groupUuid) || [];
    } catch (_) {
      // Leave _entries unchanged on any read failure; the user still sees
      // the prior list rather than a confusing empty state.
    }
  }

  _onAddSaved(_e) {
    this._adding = false;
    this._refreshEntriesFromVault();
    this.render();
  }

  _onAddCancelled(_e) {
    this._adding = false;
    this.render();
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
