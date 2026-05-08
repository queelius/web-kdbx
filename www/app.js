// Bootstrap: load WASM, register components.

import init, * as wasm from '../pkg/web_kdbx.js';

async function main() {
  try {
    await init();
  } catch (err) {
    const p = document.createElement('p');
    p.style.cssText = 'padding:1em;color:#900';
    p.textContent =
      'This browser does not support WebAssembly, or the WASM blob failed to load.';
    document.body.replaceChildren(p);
    console.error('WASM init failed', err);
    return;
  }

  globalThis.webKdbx = wasm;

  await Promise.all([
    import('./components/vault-app.js'),
    import('./components/vault-opener.js'),
    import('./components/vault-tree.js'),
    import('./components/vault-list.js'),
    import('./components/vault-detail.js'),
    import('./components/vault-entry-edit.js'),
    import('./components/vault-search.js'),
    import('./components/vault-lock-button.js'),
    import('./components/vault-download-button.js'),
    import('./components/vault-revert-button.js'),
  ]);
}

main();
