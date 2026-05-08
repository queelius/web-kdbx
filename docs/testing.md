# Testing web-kdbx

Four test layers, each running on `cargo test` / `wasm-pack test` / `npm test`.
External dependencies: `cargo`, `wasm-pack`, Node.js, Firefox.

## Layers

| Layer | Suite | Tool | Cost |
|---|---|---|---|
| 1 | `cargo test --lib` | rustc native | ~5 sec |
| 2 | `tests/wasm_smoke.rs` + `tests/wasm_l1.rs` | wasm-pack + Firefox | ~30 sec |
| 3 | `tests/e2e/*.spec.ts` | Playwright + Firefox | ~60 sec |
| 4 | Manual smoke (cross-browser, real vaults) | Human | per session |

## Layer 1: Rust unit tests

17 tests total across `src/`. Run: `cargo test --lib`.

- `src/types.rs::tests` (4): FieldDisplay masking and helpers.
- `src/totp.rs::tests` (7): URI parsing, code computation against RFC 6238
  vectors.
- `src/vault.rs::tests` (6): one placeholder for the open path (real
  validation lives in Layer 2 wasm tests) plus 5 L1 write-API tests:
  `save_to_bytes_roundtrip`, `update_field_persists`, `add_entry_persists`,
  `protected_field_roundtrips`, `protection_toggle`. Error-path tests
  (invalid UUID, missing entry, missing group) are deferred to Layer 2
  because constructing a `JsError` panics on non-wasm targets.

## Layer 2: wasm-bindgen-test

9 tests across two files. Run: `wasm-pack test --headless --firefox`.

- `tests/wasm_smoke.rs` (5): smoke tests for the open / browse / search
  surface (`open_with_correct_password_succeeds`, wrong-password and
  corrupt-file failure paths, empty-database group tree, empty-query
  search).
- `tests/wasm_l1.rs` (4): write-API and storage round-trip in a real
  browser context (`update_field_changes_in_memory_entry`,
  `add_entry_inserts_into_group`, `save_to_bytes_returns_reasonable_length`,
  `local_storage_round_trip_preserves_bytes`).

## Layer 3: Playwright e2e

8 specs in `tests/e2e/`. Run: from project root, `./scripts/build.sh
--release`, then `cd tests/e2e && npm test`.

L0 (read-only) specs:

- `open-flow.spec.ts`: file pick, drag-drop, password prompt, unlock.
- `browse-and-reveal.spec.ts`: group navigation, entry detail, reveal,
  copy-with-auto-clear, TOTP.
- `lock.spec.ts`: lock returns to opener, working state cleared.

L1 (storage) specs:

- `bundled-flow.spec.ts`: Mode 1 page boots, fetches the bundled `.kdbx`,
  unlocks, mode banner reflects state.
- `edit-flow.spec.ts`: Mode 1 edit a non-protected field, save,
  reload, re-unlock, edit survives via localStorage working copy.
- `add-entry-flow.spec.ts`: Mode 1 add a new entry under Root, save,
  reload, re-unlock, entry persists.
- `download-flow.spec.ts`: Mode 1 edit then Download Vault, verify
  download filename ends in `.kdbx` and bytes are within a sane size
  band.
- `revert-flow.spec.ts`: Mode 1 edit, reload, click Discard Local
  Changes, accept the confirm dialog, re-unlock, canonical bundled
  state restored.

## Layer 4: Manual smoke

See `docs/manual-testing.md`. The L1 section covers Mode 1 (hosted),
Mode 2 (BYO), and edge cases (quota exhaustion, storage isolation
across origins).

## Bundle size budget

| Asset | Budget | Reason |
|---|---|---|
| `web_kdbx_bg.wasm` | < 500 KB | Browser load time, longecho-shape |
| `app.js` + components | < 50 KB | Same |

CI warns (does not fail) if exceeded.

## Storage discipline

CI also runs an audit-storage gate that greps the source tree for
forbidden persistence APIs (`indexedDB`, OPFS, Service Worker
registration, `document.cookie`) and confines `localStorage` writes to
`www/storage.js`. The gate is what keeps the L1 storage shape honest:
one helper module, one storage primitive, no drift.
