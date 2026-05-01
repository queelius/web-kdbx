import { el } from './util.js';

class VaultDetail extends HTMLElement {
  set entry(d) {
    this._entry = d;
    this._revealed = {};
    if (this._totpInterval) clearInterval(this._totpInterval);
    this._totpInterval = null;
    this.render();
    if (d && d.summary && d.summary.has_totp) this.startTotpRefresh();
  }

  connectedCallback() {
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
    const e = this._entry;

    const header = el('header', {}, [
      el('h2', { style: 'margin:0' }, [e.summary.title]),
      el('div', { style: 'color:var(--muted);font-size:0.9em' }, [
        e.group_path,
      ]),
    ]);

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
}

customElements.define('vault-detail', VaultDetail);
