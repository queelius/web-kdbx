# Testing web-kdbx

Four test layers, each running on `cargo test` / `wasm-pack test` / `npm test`.
External dependencies: `cargo`, `wasm-pack`, Node.js, Firefox.

## Layers

| Layer | Suite | Tool | Cost |
|---|---|---|---|
| 1 | `cargo test --lib` | rustc native | ~5 sec |
| 2 | `tests/wasm_smoke.rs` | wasm-pack + Firefox | ~30 sec |
| 3 | `tests/e2e/*.spec.ts` | Playwright + Firefox | ~60 sec |
| 4 | Manual smoke (cross-browser, real vaults) | Human | per session |

## Layer 1: Rust unit tests

Targets: types (FieldDisplay masking), totp (URI parsing, code computation
against RFC 6238 vectors). Run: `cargo test --lib`.

## Layer 2: wasm-bindgen-test

Targets: smoke tests for the wasm-bindgen surface. Run:
`wasm-pack test --headless --firefox`.

## Layer 3: Playwright e2e

Targets: real user flows in a real browser. Open, browse, reveal/copy, lock.
Run: from project root, `./scripts/build.sh --release`, then
`cd tests/e2e && npm test`.

## Layer 4: Manual smoke

See `docs/manual-testing.md`.

## Bundle size budget

| Asset | Budget | Reason |
|---|---|---|
| `web_kdbx_bg.wasm` | < 500 KB | Browser load time, longecho-shape |
| `app.js` + components | < 50 KB | Same |

CI warns (does not fail) if exceeded.
