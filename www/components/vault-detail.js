import { el } from './util.js';

class VaultDetail extends HTMLElement {
  set entry(d) {
    this._entry = d;
    this._revealed = {};
    this._editing = false;
    if (this._totpInterval) clearInterval(this._totpInterval);
    this._totpInterval = null;
    this.render();
    if (d && d.summary && d.summary.has_totp) this.startTotpRefresh();
  }

  connectedCallback() {
    this.addEventListener('vault-edit-saved', (e) => this._onEditSaved(e));
    this.addEventListener('vault-edit-cancelled', (e) => this._onEditCancelled(e));
    this.render();
  }

  disconnectedCallback() {
    if (this._totpInterval) clearInterval(this._totpInterval);
  }

  setRevealedField(name, plaintext) {
    if (plaintext == null) return;
    this._revealed[name] = plaintext;
    this.render();
  }

  setTotpDisplay(code, remaining) {
    const codeEl = this.querySelector('.totp-code');
    const remEl = this.querySelector('.totp-remaining');
    if (codeEl) codeEl.textContent = code || '------';
    if (remEl) remEl.textContent = remaining != null ? `(${remaining}s)` : '';
  }

  render() {
    if (!this._entry) {
      this.replaceChildren(
        el('p', { style: 'color:var(--muted)' }, ['Select an entry.'])
      );
      return;
    }
    if (this._editing) {
      this._renderEditor();
      return;
    }
    const e = this._entry;

    const editButton = el(
      'button',
      {
        type: 'button',
        class: 'edit-entry-btn',
        style: 'margin-left:auto',
        onclick: () => this._enterEditMode(),
      },
      ['Edit']
    );

    const header = el(
      'header',
      { style: 'display:flex;align-items:flex-start;gap:0.5rem' },
      [
        el('div', {}, [
          el('h2', { style: 'margin:0' }, [e.summary.title]),
          el('div', { style: 'color:var(--muted);font-size:0.9em' }, [
            e.group_path,
          ]),
        ]),
        editButton,
      ]
    );

    const fieldNodes = e.fields.map((f) => this.buildFieldNode(f, e.summary.uuid));
    const fieldsBlock = el(
      'div',
      { style: 'margin-top:1rem' },
      fieldNodes
    );

    const blocks = [header, fieldsBlock];

    if (e.summary.has_totp) {
      blocks.push(this.buildTotpPanel(e.summary.uuid));
    }

    if (e.attachments.length > 0) {
      const attItems = e.attachments.map((a) =>
        el('li', {}, [`${a.name} (${a.size_bytes} bytes)`])
      );
      blocks.push(
        el('div', { style: 'margin-top:1rem' }, [
          el('strong', {}, ['Attachments']),
          el('ul', {}, attItems),
        ])
      );
    }

    if (e.history_count > 0) {
      blocks.push(
        el(
          'div',
          { style: 'margin-top:1rem;color:var(--muted)' },
          [`History: ${e.history_count} prior versions`]
        )
      );
    }

    this.replaceChildren(...blocks);
  }

  buildFieldNode(field, entry_uuid) {
    const wrapper = el('div', { style: 'margin-bottom:0.5rem' });

    if (field.kind === 'plain') {
      wrapper.appendChild(el('strong', {}, [`${field.name}: `]));
      wrapper.appendChild(el('span', {}, [field.value]));
      wrapper.appendChild(this.buildCopyButton(entry_uuid, field.name));
      return wrapper;
    }

    wrapper.appendChild(el('strong', {}, [`${field.name}: `]));
    const isRevealed = this._revealed[field.name] != null;
    if (isRevealed) {
      wrapper.appendChild(el('span', {}, [this._revealed[field.name]]));
    } else {
      wrapper.appendChild(
        el('span', { style: 'color:var(--muted)' }, [
          `[hidden, ${field.hint}]`,
        ])
      );
      wrapper.appendChild(this.buildRevealButton(entry_uuid, field.name));
    }
    wrapper.appendChild(this.buildCopyButton(entry_uuid, field.name));
    return wrapper;
  }

  buildRevealButton(entry_uuid, field_name) {
    return el(
      'button',
      {
        dataset: { reveal: field_name },
        onclick: () => {
          this.dispatchEvent(
            new CustomEvent('reveal-field', {
              bubbles: true,
              detail: { entry_uuid, field_name },
            })
          );
        },
      },
      ['Reveal']
    );
  }

  buildCopyButton(entry_uuid, field_name) {
    return el(
      'button',
      {
        dataset: { copy: field_name },
        onclick: () => {
          this.dispatchEvent(
            new CustomEvent('copy-field', {
              bubbles: true,
              detail: { entry_uuid, field_name },
            })
          );
        },
      },
      ['Copy']
    );
  }

  buildTotpPanel(entry_uuid) {
    return el(
      'div',
      {
        style:
          'margin-top:1rem;padding:0.5rem;border:1px solid var(--border);border-radius:4px',
      },
      [
        el('strong', {}, ['TOTP: ']),
        el(
          'span',
          {
            class: 'totp-code',
            style: 'font-family:monospace;font-size:1.5em',
          },
          ['------']
        ),
        ' ',
        el('span', { class: 'totp-remaining', style: 'color:var(--muted)' }),
        ' ',
        el(
          'button',
          {
            dataset: { copyTotp: entry_uuid },
            onclick: () => {
              this.dispatchEvent(
                new CustomEvent('copy-totp', {
                  bubbles: true,
                  detail: { entry_uuid },
                })
              );
            },
          },
          ['Copy']
        ),
      ]
    );
  }

  startTotpRefresh() {
    const refresh = () => {
      this.dispatchEvent(
        new CustomEvent('totp-refresh-request', {
          bubbles: true,
          detail: { uuid: this._entry.summary.uuid },
        })
      );
    };
    refresh();
    this._totpInterval = setInterval(refresh, 1000);
  }

  // Switch the panel from read view to the editable form. The TOTP refresh
  // interval is paused for the duration of editing; it resumes on
  // save-or-cancel via the entry setter (or by re-entering read mode below).
  _enterEditMode() {
    if (!this._entry) return;
    if (this._totpInterval) {
      clearInterval(this._totpInterval);
      this._totpInterval = null;
    }
    this._editing = true;
    this.render();
  }

  _renderEditor() {
    const app = this.closest('vault-app');
    const vault = app && app.vault ? app.vault : null;
    const editor = el('vault-entry-edit');
    editor.setVault(vault);
    editor.setApp(app);
    editor.setEntry(this._entry);
    this.replaceChildren(editor);
  }

  _onEditSaved(_e) {
    this._editing = false;
    // Re-pull the entry from the vault so the read view reflects the just
    // saved state (including any field that flipped its protected flag).
    const app = this.closest('vault-app');
    if (app && app.vault && this._entry) {
      const fresh = app.vault.entry(this._entry.summary.uuid);
      if (fresh) this._entry = fresh;
    }
    this._revealed = {};
    this.render();
    if (this._entry && this._entry.summary && this._entry.summary.has_totp) {
      this.startTotpRefresh();
    }
  }

  _onEditCancelled(_e) {
    this._editing = false;
    this._revealed = {};
    this.render();
    if (this._entry && this._entry.summary && this._entry.summary.has_totp) {
      this.startTotpRefresh();
    }
  }
}

customElements.define('vault-detail', VaultDetail);
