# web-kdbx

**Browser-side KDBX viewer.** Open a KeePass `.kdbx` file in any modern
browser, type the master password, browse and search entries, copy
credentials with auto-clear, generate TOTP codes. Read-only. No backend,
no install, no plugin.

The strongest distinctive feature: *portable read-only KeePassXC*. You are
on a borrowed laptop, a Chromebook, a public terminal, a friend's
machine. With desktop KeePassXC you cannot install. With web-kdbx you
load a URL, drop in your `.kdbx`, type the password.

The anchor of the *-kdbx ecosystem. v0.1 is Layer 0 (read-only). Future
layers add storage backends (Layer 1), multi-recipient sharing
(Layer 2), and synced editing (Layer 3).

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
