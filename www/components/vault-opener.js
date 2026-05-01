import { el } from './util.js';

class VaultOpener extends HTMLElement {
  connectedCallback() {
    this.bytes = null;
    this.render();
    this.maybeFetchFromQuery();
  }

  render() {
    const filename = el('span', { id: 'filename' }, ['No file selected']);
    const fileInput = el('input', {
      id: 'file',
      type: 'file',
      accept: '.kdbx',
      style: 'display:none',
      onchange: (e) => {
        const file = e.target.files[0];
        if (file) this.loadFile(file);
      },
    });
    const dropzone = el(
      'div',
      {
        id: 'dropzone',
        style:
          'border:2px dashed var(--border);padding:2rem;text-align:center;cursor:pointer;border-radius:4px',
        ondragover: (e) => {
          e.preventDefault();
          dropzone.style.borderColor = 'var(--accent)';
        },
        ondragleave: () => {
          dropzone.style.borderColor = 'var(--border)';
        },
        ondrop: (e) => {
          e.preventDefault();
          dropzone.style.borderColor = 'var(--border)';
          const file = e.dataTransfer.files[0];
          if (file && file.name.endsWith('.kdbx')) {
            this.loadFile(file);
          } else {
            this.showError('Please drop a .kdbx file.');
          }
        },
        onclick: () => fileInput.click(),
      },
      [filename]
    );

    const password = el('input', {
      id: 'password',
      type: 'password',
      placeholder: 'Master password',
      style: 'margin-top:1rem',
      onkeydown: (e) => {
        if (e.key === 'Enter') this.tryUnlock();
      },
    });

    const unlockBtn = el(
      'button',
      {
        id: 'unlock',
        style: 'margin-top:1rem;width:100%',
        onclick: () => this.tryUnlock(),
      },
      ['Unlock']
    );

    const errorBox = el('div', {
      id: 'error',
      class: 'error',
      style: 'margin-top:0.5rem',
    });

    const card = el(
      'div',
      {
        style:
          'max-width:400px;margin:4rem auto;padding:1.5rem;background:var(--panel);border:1px solid var(--border);border-radius:8px',
      },
      [
        el('h2', { style: 'margin-top:0' }, ['Open a vault']),
        el('p', { style: 'color:var(--muted)' }, [
          'Drop a .kdbx file here, or click to choose.',
        ]),
        dropzone,
        fileInput,
        password,
        unlockBtn,
        errorBox,
      ]
    );

    this.replaceChildren(card);
  }

  async maybeFetchFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const vaultUrl = params.get('vault');
    if (!vaultUrl) return;
    try {
      const resp = await fetch(vaultUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      this.bytes = new Uint8Array(await resp.arrayBuffer());
      this.querySelector('#filename').textContent = vaultUrl;
    } catch (err) {
      this.showError(`Could not fetch ${vaultUrl}.`);
    }
  }

  async loadFile(file) {
    this.bytes = new Uint8Array(await file.arrayBuffer());
    this.querySelector('#filename').textContent = file.name;
  }

  showError(msg) {
    this.querySelector('#error').textContent = msg;
  }

  tryUnlock() {
    this.showError('');
    if (!this.bytes) {
      this.showError('Choose a file first.');
      return;
    }
    const password = this.querySelector('#password').value;
    try {
      const vault = new globalThis.webKdbx.Vault(this.bytes, password);
      this.dispatchEvent(
        new CustomEvent('vault-opened', {
          bubbles: true,
          detail: { vault },
        })
      );
    } catch (err) {
      this.showError(String(err.message || err));
      this.querySelector('#password').value = '';
    }
  }
}

customElements.define('vault-opener', VaultOpener);
