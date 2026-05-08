import { el } from './util.js';

// Standard fields appear in this order ahead of any custom fields.
// Mirrors the ordering produced by build_entry_detail in src/vault.rs.
const STANDARD_ORDER = ['Title', 'UserName', 'Password', 'URL', 'Notes'];

// Codepoints 0x00 to 0x1F and 0x7F are control characters. KDBX field names
// must not contain them (they would corrupt XML serialization downstream).
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;

class VaultEntryEdit extends HTMLElement {
  constructor() {
    super();
    this._vault = null;
    this._app = null;
    this._entry = null;
    this._rows = [];
    this._error = null;
    this._saving = false;
  }

  connectedCallback() {
    this.render();
  }

  /**
   * Set the WASM Vault used to perform writes. Called by the parent before
   * the editor renders so update_field is reachable on Save.
   * @param {object} vault - the wasm-bindgen Vault instance
   */
  setVault(vault) {
    this._vault = vault;
  }

  /**
   * Set the parent <vault-app> reference so the editor can route persisted
   * bytes through the auto-save chokepoint (_persistAndNotify).
   * @param {HTMLElement} app
   */
  setApp(app) {
    this._app = app;
  }

  /**
   * Provide the current entry detail (the same shape <vault-detail> renders
   * in read mode). Triggers a render that materializes one input per field.
   * @param {object} detail - entry detail object with summary, fields, etc.
   */
  setEntry(detail) {
    this._entry = detail;
    this._rows = detail ? this._buildRows(detail) : [];
    this._error = null;
    this.render();
  }

  // Build initial in-memory row state from the entry detail. Each row holds
  // the field name (read-only here; KDBX field renames are out of scope for
  // this task), the working value, the working protection flag, a dirty bit
  // set on any user mutation, and a revealed bit driving the show/hide
  // toggle on protected inputs.
  _buildRows(detail) {
    const rows = detail.fields.map((f) => {
      const isMasked = f.kind === 'masked';
      // Masked fields hide their plaintext from the read view; the editor
      // starts with an empty string and only touches the field if the user
      // actually types something. Plain fields start at the current value.
      return {
        name: f.name,
        value: isMasked ? '' : f.value,
        protected: isMasked,
        dirty: false,
        revealed: false,
        hint: isMasked ? f.hint : null,
      };
    });
    rows.sort((a, b) => {
      const ai = STANDARD_ORDER.indexOf(a.name);
      const bi = STANDARD_ORDER.indexOf(b.name);
      const ax = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
      const bx = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
      if (ax !== bx) return ax - bx;
      return a.name.localeCompare(b.name);
    });
    return rows;
  }

  render() {
    if (!this._entry) {
      this.replaceChildren(
        el('p', { style: 'color:var(--muted)' }, ['No entry selected.'])
      );
      return;
    }

    const header = el('header', {}, [
      el('h2', { style: 'margin:0' }, [`Edit: ${this._entry.summary.title}`]),
      el('div', { style: 'color:var(--muted);font-size:0.9em' }, [
        this._entry.group_path,
      ]),
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
        class: 'edit-error',
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
    const inputId = `vault-edit-field-${idx}`;
    const wrapper = el('div', {
      class: 'edit-row',
      style:
        'display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap',
    });

    wrapper.appendChild(
      el(
        'label',
        { for: inputId, style: 'min-width:8em' },
        [row.name]
      )
    );

    const inputProps = {
      id: inputId,
      type: row.protected && !row.revealed ? 'password' : 'text',
      value: row.value,
      placeholder: row.protected && row.value === '' && row.hint
        ? `(unchanged, ${row.hint})`
        : '',
      style: 'flex:1;min-width:12em',
      oninput: (ev) => {
        row.value = ev.target.value;
        row.dirty = true;
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
        row.dirty = true;
        // Re-render only this row so the input type and Show/Hide toggle
        // update without rebuilding the whole form (which would lose focus).
        this._rerenderRow(idx);
      },
    });
    wrapper.appendChild(protCheckbox);
    wrapper.appendChild(
      el('label', { for: protCheckboxId }, ['protected'])
    );

    return wrapper;
  }

  _rerenderRow(idx) {
    const rowNodes = this.querySelectorAll('.edit-row');
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

  async _onSave() {
    if (this._saving) return;
    this._error = null;

    // Validate every field name. Field names come from existing entry data
    // here, so an offending name would be a pre-existing data issue, but the
    // spec calls for explicit refusal rather than silent passthrough.
    for (const row of this._rows) {
      if (CONTROL_CHAR_RE.test(row.name)) {
        this._error = `Field name contains control characters: ${JSON.stringify(row.name)}`;
        this.render();
        return;
      }
    }

    if (!this._vault) {
      this._error = 'Vault is locked. Reopen and try again.';
      this.render();
      return;
    }

    const dirtyRows = this._rows.filter((r) => r.dirty);
    if (dirtyRows.length === 0) {
      // Nothing to persist; treat Save as Cancel for the no-op case so the
      // user returns to the read view without a noisy error.
      this._onCancel();
      return;
    }

    this._saving = true;
    this.render();

    let lastBytes = null;
    try {
      for (const row of dirtyRows) {
        lastBytes = this._vault.update_field(
          this._entry.summary.uuid,
          row.name,
          row.value,
          row.protected
        );
      }
    } catch (err) {
      this._saving = false;
      this._error = `Save failed: ${err && err.message ? err.message : String(err)}`;
      this.render();
      return;
    }

    if (lastBytes && this._app && typeof this._app._persistAndNotify === 'function') {
      try {
        this._app._persistAndNotify(lastBytes);
      } catch (err) {
        this._saving = false;
        this._error = `Persist failed: ${err && err.message ? err.message : String(err)}`;
        this.render();
        return;
      }
    }

    this._saving = false;
    this.dispatchEvent(
      new CustomEvent('vault-edit-saved', {
        bubbles: true,
        composed: true,
        detail: { entry_uuid: this._entry.summary.uuid },
      })
    );
  }

  _onCancel() {
    if (this._saving) return;
    this.dispatchEvent(
      new CustomEvent('vault-edit-cancelled', {
        bubbles: true,
        composed: true,
        detail: { entry_uuid: this._entry ? this._entry.summary.uuid : null },
      })
    );
  }
}

customElements.define('vault-entry-edit', VaultEntryEdit);
