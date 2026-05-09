# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`web-kdbx`: a browser-side, read-only KeePass KDBX viewer, packaged as a wasm-bindgen Rust crate plus a vanilla web-components shell. **The anchor of the `*-kdbx` ecosystem**: the heaviest committed member, the one that forces the WASM build path for `keepass-rs` to be exercised in earnest, and the substrate that downstream members (`hugo-kdbx`, `mcp-kdbx`) will eventually wrap.

User-facing summary and the four-layer roadmap: `README.md`. Full motivation, threat model, and design: `docs/superpowers/specs/2026-04-29-web-kdbx-design.md`. The L1 (write/persistence) direction reached during the 2026-05-06 mcp-kdbx brainstorm: `docs/superpowers/specs/2026-05-06-web-kdbx-l1-storage-design.md` (spec only, not implemented).

## Status

v0.1 (Layer 0, read-only) implementation complete. Library + WASM glue + JS shell + four-layer test stack + CI all in place. Remaining v0.1 release task is manual cross-browser smoke (`docs/manual-testing.md`).

L1 (localStorage-backed working copy + download export) is in flight. Phase 1 of `docs/superpowers/plans/2026-05-06-web-kdbx-l1.md` shipped the Rust write API: `Vault::update_field`, `Vault::add_entry`, `Vault::save_to_bytes`, with the `DatabaseKey` retained on the Vault for re-encryption. Phases 2 (JS storage adapter), 3 (UI), 4 (tests), 5 (audit gates and docs) are still pending.

## Architecture: the non-obvious shape

1. **One Rust crate, dual `crate-type = ["cdylib", "rlib"]`**. The same crate compiles to a WASM cdylib for the browser *and* to a regular rlib for native `cargo test --lib`. That is why Layer 1 tests can run on `types::FieldDisplay`, `totp`, `search` without ever touching WASM.

2. **JS holds an opaque `Vault` handle and never sees plaintext by default.** Protected fields cross the WASM boundary as `FieldDisplay::Masked { name, hint }` (hint = `"<N> chars"` over Unicode scalar count). Plaintext is returned only through explicit `vault.reveal_field(uuid, name)` and `vault.totp(uuid)` calls. `vault.free()` (called by the lock button in `vault-app.js`) drops the WASM handle and the keepass DB it owns.

3. **Two distribution artifacts, one source.**
   - Multi-file (`pkg/web_kdbx_bg.wasm` + `pkg/web_kdbx.js`) via `wasm-pack build --target web`, served from `www/`.
   - Single self-contained HTML (`dist/web-kdbx.html`) via `cargo run --bin web-kdbx-bundle --features bundle`, which base64-inlines the WASM into one file openable through `file://`. This is the kiosk / borrowed-laptop / Chromebook use case the project's positioning is built around. The binary also supports `--vault-url` (runtime fetch) and `--inline-vault` (data: URL blob) for Mode 1 hosted-vault embeds.

4. **Four-layer test stack** (`docs/testing.md`). Layer 1: `cargo test --lib` (native, ~5 sec). Layer 2: `tests/wasm_smoke.rs` via `wasm-pack test --headless --firefox` against committed `.kdbx` fixtures in `tests/fixtures/`. Layer 3: `tests/e2e/*.spec.ts` via Playwright + Firefox (real-browser flows for open, browse, reveal, lock). Layer 4: human cross-browser smoke. CI runs 1 through 3 plus a bundle-size warning gate.

5. **Substrate is `keepass = "0.12.5"` (with `serialization` and `save_kdbx4` features)**. The 0.12.5 bump (from 0.12.1) was needed to pick up `EntryRef::attachments_named()` from upstream PR #321 (closes the old issue #314). `save_kdbx4` enables `Database::save` for the L1 write path. File new upstream gaps as issues at https://github.com/sseemayer/keepass-rs. Local fork for upstream contributions: `~/github/bugfixes/track1-issues/keepass-rs/`.

6. **The Rust API surface lives in `src/vault.rs`**. `src/types.rs` defines the serde shapes that cross the WASM boundary. `src/search.rs`, `src/totp.rs`, `src/attachments.rs` are helpers, all natively-testable. The JS shell entry is `www/app.js` (loads WASM, registers components); `www/components/vault-app.js` is the top-level custom element that owns the `Vault` handle and routes events; the rest of `www/components/` are leaf elements that emit events and render via `util.js::el()`.

## Commands

```bash
# Build WASM
./scripts/build.sh              # release (default; opt-level=z, lto, codegen-units=1 from Cargo.toml)
./scripts/build.sh --dev        # debug profile (faster build, larger bundle)

# Develop
cd www && python3 -m http.server 8000     # then http://localhost:8000/

# Single-file artifact (rebuilds WASM if stale)
# Feature-gated via `bundle`; supports --vault-url and --inline-vault for Mode 1 embeds.
cargo run --bin web-kdbx-bundle --features bundle                                      # → dist/web-kdbx.html (BYO file picker)
cargo run --bin web-kdbx-bundle --features bundle -- --vault-url https://host/my.kdbx # Mode 1: URL
cargo run --bin web-kdbx-bundle --features bundle -- --inline-vault path/to/my.kdbx   # Mode 1: inlined blob

# CI gates (run these before pushing)
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo build --target wasm32-unknown-unknown --release  # pure-cargo "does it compile to wasm32" check

# Layer 1: native unit tests
cargo test --lib
cargo test --lib field_display_masked_for_protected   # single test (substring match)

# Layer 2: wasm-bindgen smoke against fixtures
wasm-pack test --headless --firefox
wasm-pack test --headless --firefox -- --test wasm_smoke   # one integration target

# Layer 3: Playwright e2e (rebuild WASM first; the dev server in www/ is what Playwright drives)
./scripts/build.sh --release
cd tests/e2e && npm ci                                # one-time
cd tests/e2e && npx playwright install firefox        # one-time
cd tests/e2e && npm test
cd tests/e2e && npx playwright test open-flow         # one spec by substring
```

`wasm-pack` and Firefox are required for Layers 2 and 3. The repo expects Rust 1.85 (edition 2024); see `rust-version` in `Cargo.toml`.

## Invariants to preserve

- **L0 read-only, L1 write API gated.** L0 ships no write path; the public Vault surface for L0 is read-only. L1's Rust write API (`update_field`, `add_entry`, `save_to_bytes`) is in code as of Phase 1 of the L1 plan, but the JS-side localStorage adapter is not yet wired. Until Phase 2 lands, calling the write API from JS will mutate the in-memory Vault but no persistence path exists, so the changes vanish on reload. Do not advertise write capability in the UI until Phase 2 (`docs/superpowers/plans/2026-05-06-web-kdbx-l1.md`) is complete.
- **No persistence in L0; whole-blob localStorage in L1.** L0 has no `localStorage`, `IndexedDB`, `OPFS`, Service Worker, or cookies. L1 will introduce ONE localStorage key per vault, holding whole encrypted KDBX bytes (per the L1 storage spec). The audit gate at `scripts/ci-audit-storage.sh` (Phase 5 of the L1 plan) will enforce that no other persistence channels appear.
- **XSS hygiene by construction.** Every JS component builds DOM via `document.createElement` + `textContent`, mediated by `el(tag, props, children)` in `www/components/util.js`. Never `innerHTML`, never tagged-template HTML. Every user-controlled value (entry titles, field values, group names) becomes a text node.
- **Open-error conflation.** `Vault::open` returns the single message `"Wrong password or corrupt file."` for both wrong-password and corrupt-file cases. Differentiating them would leak whether a blob is valid KDBX before the password is known. Preserve the conflation.
- **Bundle-size budget.** <500 KB for `web_kdbx_bg.wasm`, <50 KB for `app.js` + components. CI emits a warning (does not fail) above the WASM budget; new heavy dependencies require checking the budget.
- **Lock = drop the handle.** The lock path is `vault.free()` plus best-effort clipboard clear. Do not leave plaintext in JS-side state across a lock.

## Workflow

For new features (the same flow used for the v0.1 ship and ready for L1):

1. Brainstorm against the relevant existing spec, or `/brainstorm` from scratch (superpowers:brainstorming).
2. Spec lands in `docs/superpowers/specs/YYYY-MM-DD-<name>.md`.
3. Implementation plan lands in `docs/superpowers/plans/YYYY-MM-DD-<name>.md` (use checkbox `- [ ]` syntax for tracking; see the v0.1 plan for the convention).
4. Execute via subagent-driven development (one subagent per task; two-stage review).
5. Finish via the superpowers:finishing-a-development-branch skill.

The v0.1 spec/plan pair (`2026-04-29-web-kdbx-design.md` / `2026-04-29-web-kdbx.md`) is the canonical example. The L1 spec/plan pair (`2026-05-06-web-kdbx-l1-storage-design.md` / `2026-05-06-web-kdbx-l1.md`) is in flight: Phase 1 (Rust write API) shipped; Phases 2 through 5 pending.

## Cross-references

- `~/github/kdbx/CLAUDE.md`: ecosystem-level conventions for all `*-kdbx` repos and the rationale for the four-layer architecture.
- `~/github/kdbx/diff-kdbx/`: the sibling crate web-kdbx will pull in (via WASM) for entry-history visualization and snapshot diffing in later layers.
- `~/github/repos/cryptoid/`, `~/github/repos/pagevault/`, `~/github/repos/sigmark/`: sibling browser-side crypto projects in the same "static-first secrets stack" worldview, but **not** part of `*-kdbx`. They handle opaque-content encryption and integrity; KDBX members handle structured-record encryption.
- `~/github/bugfixes/track1-issues/keepass-rs/`: local fork used for upstream contributions to the substrate library.
