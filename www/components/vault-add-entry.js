import { el } from './util.js';

// Standard fields prefilled on a new entry, in display order. Mirrors the
// ordering produced by build_entry_detail in src/vault.rs and the editor's
// STANDARD_ORDER in vault-entry-edit.js.
const STANDARD_FIELDS = [
  { name: 'Title', protected: false },
  { name: 'UserName', protected: false },
  { name: 'Password', protected: true },
  { name: 'URL', protected: false },
  { name: 'Notes', protected: false },
];

// Codepoints 0x00 to 0x1F and 0x7F are control characters. KDBX field names
// must not contain them (they would corrupt XML serialization downstream).
// Field names aren't user-typed in v0.1, but the spec calls for defensive
// validation; we keep parity with vault-entry-edit.js.
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;

class VaultAddEntry extends HTMLElement {
  constructor() {
    super();
    this._groupUuid = null;
    this._rows = STANDARD_FIELDS.map((f) => ({
      name: f.name,
      value: '',
      protected: f.protected,
      revealed: false,
    }));
    this._error = null;
    this._saving = false;
  }

  connectedCallback() {
    this.render();
  }

  /**
   * Set the UUID of the group the new entry will be added to. Required;
   * the form will refuse to save without it.
   * @param {string} uuid
   */
  setGroupUuid(uuid) {
    this._groupUuid = uuid;
    this.render();
  }

  render() {
    const header = el('header', {}, [
      el('h2', { style: 'margin:0' }, ['Add Entry']),
    ]);

    const fieldNodes = this._rows.map((row, idx) => this._buildRowNode(row, idx));
    const fieldsBlock = el(
      'div',
      { style: 'margin-top:1rem;display:flex;flex-direction:column;gap:0.5rem' },
      fieldNodes
    );

    const errorNode = el(
      'div',
      {
        class: 'add-error',
        style: this._error
          ? 'color:var(--error,#c00);margin-top:0.75rem'
          : 'display:none',
      },
      [this._error || '']
    );

    const buttonBar = el(
      'div',
      { style: 'margin-top:1rem;display:flex;gap:0.5rem' },
      [
        el(
          'button',
          {
            type: 'button',
            disabled: this._saving ? '' : null,
            onclick: () => this._onSave(),
          },
          [this._saving ? 'Saving...' : 'Save']
        ),
        el(
          'button',
          {
            type: 'button',
            disabled: this._saving ? '' : null,
            onclick: () => this._onCancel(),
          },
          ['Cancel']
        ),
      ]
    );

    this.replaceChildren(header, fieldsBlock, errorNode, buttonBar);
  }

  _buildRowNode(row, idx) {
    const inputId = `vault-add-field-${idx}`;
    const wrapper = el('div', {
      class: 'add-row',
      style: 'display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap',
    });

    const labelText = row.name === 'Title' ? `${row.name} *` : row.name;
    wrapper.appendChild(
      el('label', { for: inputId, style: 'min-width:8em' }, [labelText])
    );

    const inputProps = {
      id: inputId,
      type: row.protected && !row.revealed ? 'password' : 'text',
      value: row.value,
      style: 'flex:1;min-width:12em',
      oninput: (ev) => {
        row.value = ev.target.value;
      },
    };
    const input = el('input', inputProps);
    wrapper.appendChild(input);

    if (row.protected) {
      wrapper.appendChild(
        el(
          'button',
          {
            type: 'button',
            class: 'reveal-toggle',
            dataset: { row: String(idx) },
            onclick: () => this._toggleReveal(idx),
          },
          [row.revealed ? 'Hide' : 'Show']
        )
      );
    }

    const protCheckboxId = `${inputId}-protected`;
    const protCheckbox = el('input', {
      id: protCheckboxId,
      type: 'checkbox',
      checked: row.protected ? '' : null,
      onchange: (ev) => {
        row.protected = ev.target.checked;
        // Re-render only this row so the input type and Show/Hide toggle
        // update without rebuilding the whole form (which would lose focus).
        this._rerenderRow(idx);
      },
    });
    wrapper.appendChild(protCheckbox);
    wrapper.appendChild(el('label', { for: protCheckboxId }, ['protected']));

    return wrapper;
  }

  _rerenderRow(idx) {
    const rowNodes = this.querySelectorAll('.add-row');
    const target = rowNodes[idx];
    if (!target) {
      this.render();
      return;
    }
    const newNode = this._buildRowNode(this._rows[idx], idx);
    target.replaceWith(newNode);
  }

  _toggleReveal(idx) {
    const row = this._rows[idx];
    if (!row || !row.protected) return;
    row.revealed = !row.revealed;
    this._rerenderRow(idx);
  }

  _findTitleRow() {
    return this._rows.find((r) => r.name === 'Title');
  }

  async _onSave() {
    if (this._saving) return;
    this._error = null;

    if (!this._groupUuid) {
      this._error = 'No target group. Select a group and try again.';
      this.render();
      return;
    }

    // Validate every field name. Names come from STANDARD_FIELDS today, but
    // future custom-field support would let users introduce new ones; the
    // spec calls for explicit refusal on control characters.
    for (const row of this._rows) {
      if (CONTROL_CHAR_RE.test(row.name)) {
        this._error = `Field name contains control characters: ${JSON.stringify(row.name)}`;
        this.render();
        return;
      }
    }

    const titleRow = this._findTitleRow();
    const title = titleRow ? titleRow.value.trim() : '';
    if (!title) {
      this._error = 'Title is required.';
      this.render();
      return;
    }

    const app = this.closest('vault-app');
    const vault = app && app.vault ? app.vault : null;
    if (!vault) {
      this._error = 'Vault is locked. Reopen and try again.';
      this.render();
      return;
    }

    // Build EntryInput. Title is sent as the entry's title via the Rust
    // path (which sets fields::TITLE explicitly); we exclude it from the
    // fields array so it's not double-set. Empty-value rows are excluded
    // so we don't materialize empty fields the user has to clean up later.
    const fields = this._rows
      .filter((r) => r.name !== 'Title' && r.value !== '')
      .map((r) => ({
        name: r.name,
        value: r.value,
        protected: r.protected,
      }));

    const input = {
      group_uuid: this._groupUuid,
      title,
      fields,
    };

    // Snapshot pre-existing UUIDs in the target group so we can identify
    // the freshly-added entry by set difference after the call returns.
    // Title-based lookup would misidentify the new entry when the group
    // already holds another entry with the same title.
    let existingUuids;
    try {
      const before = vault.entries_in_group(this._groupUuid) || [];
      existingUuids = new Set(before.map((e) => e.uuid));
    } catch (_) {
      existingUuids = new Set();
    }

    this._saving = true;
    this.render();

    let newBytes;
    try {
      newBytes = vault.add_entry(input);
    } catch (err) {
      this._saving = false;
      this._error = `Save failed: ${err && err.message ? err.message : String(err)}`;
      this.render();
      return;
    }

    if (newBytes && app && typeof app._persistAndNotify === 'function') {
      try {
        app._persistAndNotify(newBytes);
      } catch (err) {
        this._saving = false;
        this._error = `Persist failed: ${err && err.message ? err.message : String(err)}`;
        this.render();
        return;
      }
    }

    // Locate the new entry's UUID by set-difference against the pre-add
    // snapshot. The Rust `add_entry` doesn't return the UUID directly (it
    // returns the re-encrypted bytes), but the entry is now visible on the
    // in-memory Vault. Set-difference is title-collision-safe; a fresh
    // entry whose title matches an existing one still has a unique UUID.
    let entryUuid = null;
    try {
      const after = vault.entries_in_group(this._groupUuid) || [];
      const fresh = after.find((e) => !existingUuids.has(e.uuid));
      if (fresh) entryUuid = fresh.uuid;
    } catch (_) {
      // Non-fatal: the save succeeded, we just couldn't echo back the UUID.
    }

    this._saving = false;
    this.dispatchEvent(
      new CustomEvent('vault-add-saved', {
        bubbles: true,
        composed: true,
        detail: { entryUuid },
      })
    );
  }

  _onCancel() {
    if (this._saving) return;
    this.dispatchEvent(
      new CustomEvent('vault-add-cancelled', {
        bubbles: true,
        composed: true,
      })
    );
  }
}

customElements.define('vault-add-entry', VaultAddEntry);
