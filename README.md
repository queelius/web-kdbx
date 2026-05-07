# web-kdbx

**Browser-side KDBX viewer, embeddable as a web component.** Opens a
KeePass `.kdbx` in any modern browser: master password unlock, group
navigation, search, copy-with-auto-clear, TOTP. Read-only. No backend,
no install, no plugin.

The anchor of the `*-kdbx` ecosystem. The goal is **KDBX as structured
content on the static web**: drop the viewer into a Hugo theme, embed
encrypted records in a static site, render shared vaults inline. v0.1
is Layer 0 (read-only). Future layers add storage backends (Layer 1),
multi-recipient sharing (Layer 2), and synced editing (Layer 3). The
L1+ direction is what makes this a different product from a personal
vault app.

## Related work

| Project | Shape | Use when |
|---------|-------|----------|
| [KeePassXC](https://keepassxc.org/) | Native desktop password manager | You want a full-featured personal vault app on Linux/macOS/Windows |
| [OmniKee](https://github.com/OmniKee/OmniKee) | Tauri desktop + PWA + Android, also built on `keepass-rs` | You want a cross-platform standalone vault app, including a hosted PWA |
| **web-kdbx** | Embeddable web component, ecosystem substrate | You want to render KDBX content inside a static site, or build on the `*-kdbx` ecosystem (`diff-kdbx`, `mcp-kdbx`, `hugo-kdbx`) |

If you're looking for a personal vault to launch and use, KeePassXC or
OmniKee will serve you better. web-kdbx exists for a different shape:
KDBX as a content type on the static web, plus tooling around it.

## Status

v0.1 in development.

## Architecture

A wasm-bindgen Rust crate (`src/`) plus a vanilla web-components JS shell
(`www/`). The Rust crate wraps `keepass-rs` and exposes a viewer-shaped API:

```rust
let v = Vault::open(bytes, password)?;
v.name();
v.version();
v.group_tree();              // GroupSummary tree
v.entries_in_group(uuid);    // Vec<EntrySummary>
v.entry(uuid);               // Option<EntryDetail>
v.reveal_field(uuid, name);  // Option<String> (plaintext)
v.totp(uuid);                // Option<TotpCode>
v.search(query);             // Vec<EntrySummary>
```

JS holds an opaque handle and never sees plaintext except through
explicit `reveal_field` calls. Default secret masking. Lock button frees
the WASM Vault and zeroes plaintext.

## Build

```bash
git clone https://github.com/queelius/web-kdbx.git
cd web-kdbx
./scripts/build.sh --release
cd www && python3 -m http.server 8000
```

Open http://localhost:8000/.

For a single self-contained HTML file:

```bash
./scripts/build-single-html.sh
open dist/web-kdbx.html
```

## Test

```bash
cargo test --lib                      # Layer 1
wasm-pack test --headless --firefox   # Layer 2
cd tests/e2e && npm test              # Layer 3
```

See `docs/testing.md` for details. Manual cross-browser verification:
`docs/manual-testing.md`.

## Security model

- The .kdbx is encrypted; the remote sees only ciphertext.
- Passwords masked by default; reveal-on-click per field.
- Copy-with-auto-clear (12s, KeePassXC convention).
- No persistence: no localStorage, no IndexedDB, no Service Worker.
- Lock = drop the WASM Vault. Plaintext zeroized.

See `docs/superpowers/specs/2026-04-29-web-kdbx-design.md` for the full
threat model and design.

## License

MIT.
