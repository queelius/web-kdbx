// www/storage.js
//
// localStorage adapter for L1 working-copy lifecycle.
//
// This module is the sole owner of localStorage write access for vault
// working copies. All `localStorage.setItem` and `localStorage.removeItem`
// calls in this codebase live here; readers (`localStorage.getItem`) are
// allowed elsewhere, but writes must route through these exports. The CI
// audit script (Task 15 of the L1 plan) enforces this invariant.
//
// Storage layout (per the L1 storage design spec):
//   Key:   "web-kdbx:vault:" + vault-id
//   Value: base64-encoded encrypted KDBX bytes (whole file)
//
//   vault-id:
//     Mode 1 (hosted): origin + bundled-vault-path
//     Mode 2 (BYO):    "byo:" + caller-supplied identifier (e.g., file hash)
//
// localStorage values are strings, so binary KDBX bytes are base64-encoded
// on the way in and decoded on the way out. The encrypted bytes never
// leave this string-encoding boundary; the master password lives only in
// the WASM Vault's volatile memory.

const KEY_PREFIX = 'web-kdbx:vault:';

/**
 * Derive a stable vault-id from the page's `<vault-app>` attributes.
 *
 * Returns null if neither vaultUrl nor vaultId is provided (Mode 2: BYO,
 * the caller is responsible for assigning a vault-id later, e.g. from a
 * hash of uploaded bytes).
 *
 * @param {{ vaultUrl?: string|null, vaultId?: string|null }} attrs
 * @returns {string|null}
 */
export function vaultIdFromAttrs({ vaultUrl, vaultId }) {
  if (vaultId) return vaultId;
  if (vaultUrl) {
    const path = vaultUrl.startsWith('/') ? vaultUrl : '/' + vaultUrl;
    return `${location.origin}${path}`;
  }
  return null;
}

/**
 * Load the working-copy bytes for vault-id from localStorage.
 *
 * @param {string} vaultId
 * @returns {Uint8Array|null} bytes, or null if no working copy exists
 */
export function loadWorkingCopy(vaultId) {
  const raw = localStorage.getItem(KEY_PREFIX + vaultId);
  if (!raw) return null;
  return base64ToBytes(raw);
}

/**
 * Persist working-copy bytes for vault-id to localStorage.
 *
 * Throws a friendly Error on QuotaExceededError; rethrows other errors.
 *
 * @param {string} vaultId
 * @param {Uint8Array} bytes
 */
export function saveWorkingCopy(vaultId, bytes) {
  try {
    localStorage.setItem(KEY_PREFIX + vaultId, bytesToBase64(bytes));
  } catch (e) {
    if (isQuotaExceeded(e)) {
      throw new Error(
        'Browser storage quota exceeded. Download your vault and clear old vaults to free space.'
      );
    }
    throw e;
  }
}

/**
 * Remove the working copy for vault-id (revert path).
 *
 * @param {string} vaultId
 */
export function clearWorkingCopy(vaultId) {
  localStorage.removeItem(KEY_PREFIX + vaultId);
}

/**
 * Check whether a working copy exists for vault-id.
 *
 * @param {string} vaultId
 * @returns {boolean}
 */
export function hasWorkingCopy(vaultId) {
  return localStorage.getItem(KEY_PREFIX + vaultId) !== null;
}

/**
 * Resolve which bytes to load when opening a vault. Priority:
 *   1. Working copy from localStorage if present (Mode 1 + 2)
 *   2. Bundled vault from vaultUrl if provided (Mode 1)
 *   3. null (Mode 2 BYO: caller will receive bytes from file picker)
 *
 * @param {{ vaultUrl?: string|null, vaultId?: string|null }} attrs
 * @returns {Promise<{ bytes: Uint8Array, source: 'localStorage'|'bundled', vaultId: string }|null>}
 */
export async function loadVaultBytes({ vaultUrl, vaultId }) {
  const id = vaultIdFromAttrs({ vaultUrl, vaultId });
  if (id) {
    const working = loadWorkingCopy(id);
    if (working) return { bytes: working, source: 'localStorage', vaultId: id };
  }
  if (vaultUrl) {
    const resp = await fetch(vaultUrl);
    if (!resp.ok) {
      throw new Error(`Failed to fetch ${vaultUrl}: HTTP ${resp.status}`);
    }
    const bytes = new Uint8Array(await resp.arrayBuffer());
    return { bytes, source: 'bundled', vaultId: id };
  }
  return null;
}

// --- Private helpers ------------------------------------------------------

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// QuotaExceededError detection. Modern browsers expose
// `e.name === 'QuotaExceededError'`; legacy code paths use `e.code === 22`
// (or `e.code === 1014` on older Firefox builds, where the name is
// `NS_ERROR_DOM_QUOTA_REACHED`). Cover all three to keep the friendly
// message reachable across the cross-browser surface this project targets.
function isQuotaExceeded(e) {
  if (!e) return false;
  if (e.name === 'QuotaExceededError') return true;
  if (e.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
  if (e.code === 22) return true;
  if (e.code === 1014) return true;
  return false;
}
