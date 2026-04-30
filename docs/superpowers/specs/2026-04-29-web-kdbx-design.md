# web-kdbx: Browser-side KDBX viewer

**Project:** web-kdbx (anchor of the *-kdbx ecosystem)
**Date:** 2026-04-29
**Author:** Alexander Towell
**Status:** Design (pending implementation plan)

## Goal

A browser-side KDBX viewer. v0.1 is read-only (Layer 0 of the four-layer
ecosystem architecture): open a `.kdbx` file in any modern browser, type the
master password, browse and search entries, reveal protected fields on
demand, copy values to clipboard with auto-clear, and lock the vault. No
backend, no install, no plugin. A single static HTML page plus a WASM blob,
deployable on any static host or runnable directly via `file://`.

The strongest distinctive feature: *portable read-only KeePassXC*. You are on
a borrowed laptop, a school-locked Chromebook, a friend's computer, a
public-terminal kiosk. You need to look up a recovery code, an account
number, a TOTP code. With desktop KeePassXC you are stuck (cannot install).
With web-kdbx you load a URL, drop in your `.kdbx`, type the password, see
your entries.

## Position in the *-kdbx ecosystem

`web-kdbx` is the **anchor** of the ecosystem. It is the heaviest committed
member, the one most users will eventually encounter, and the one that
forces the WASM build path for `keepass-rs` to be exercised in earnest.

Relationship to the other members:

| Member | Status | How web-kdbx relates |
|---|---|---|
| `diff-kdbx` | Shipped (v0.1 at github.com/queelius/diff-kdbx) | Sibling, not substrate. web-kdbx may pull `diff-kdbx` into specific later features (entry history view, "compare two snapshots"), but the read-only viewer's primary architecture sits on `keepass-rs` directly. |
| `mcp-kdbx` | Bridge, planned | Independent of web-kdbx. Both consume `keepass-rs`. |
| `hugo-kdbx` | Tool, planned | Will package `web-kdbx`'s artifact as a Hugo theme component. v0.1 of web-kdbx is the artifact `hugo-kdbx` will eventually wrap. |
| `arkiv-kdbx`, `longecho-kdbx` | Bridges, pinned | Out of scope; they target archival workflows, not in-browser viewing. |

The shared substrate for the whole ecosystem is `keepass-rs`. web-kdbx
contributes back to that ecosystem by being the first real-world wasm32
consumer at scale, surfacing API gaps and bugs that downstream WASM users
would otherwise hit silently.

## Motivation

Five problems that converge to make this v0.1 worth building.

### 1. Desktop-app accessibility gap

KeePassXC is excellent if you can install it. But school-locked Chromebooks
cannot install desktop apps. Friends' computers cannot install your password
manager on demand. Guest phones, public terminals, hotel kiosks, and
temporary devices all have a "first install software" barrier. Web access
is the lowest-friction surface; KeePassXC has no web interface, and the
official KeePass project does not either. This is a real gap.

### 2. Trust crisis with cloud password managers

LastPass had a vault breach in 2022, then another in 2023. 1Password is
closed-source and trusts its own infrastructure. Bitwarden is reasonable but
is a service that can be acquired or pressured. Self-hosted Bitwarden
requires running a Rails app and a database. The "self-host" option in
modern cloud products has become a fig leaf. A static-only browser viewer
removes the SaaS dependency entirely.

### 3. The longecho-shaped artifact gap

A self-contained `.html` with embedded WASM is bytes any browser can load
in 30 years. Static hosting will outlive nearly any current web service.
We do not yet have a tool that exploits this property for password vaults.
v0.1 ships exactly that artifact.

### 4. KeePassXC sync friction

Even when you have KeePassXC installed, getting a vault from one machine to
another is awkward (Dropbox folder, Syncthing, manual copy). A browser-side
viewer pointed at a URL, fetched on demand, removes the sync step for
read-only access. Pair with a private git repo (which `diff-kdbx` already
makes diffable), and you have a lightweight read-side that any machine can
use without first acquiring the file locally.

### 5. Anchor for the ecosystem WASM path

`keepass-rs` works on `wasm32-unknown-unknown` (czlol added that support in
2025) but no real WASM consumer has stress-tested it at scale. Bugs and API
gaps that only manifest in WASM have not surfaced. Building `web-kdbx`
exercises this path in real consumer code, producing concrete upstream
contributions that benefit `mcp-kdbx`, `hugo-kdbx`, and any other future
wasm32 consumer.

## Use cases (priority-ordered)

1. **Portable read-only access (primary).** User on a non-personal device
   needs to retrieve a credential or TOTP code. Loads web-kdbx in a browser,
   drops in their `.kdbx`, types the password, gets the value, locks. No
   software installed.

2. **Quick check on personal devices (secondary).** On a personal machine,
   user prefers a browser tab to launching KeePassXC. Pin
   `metafunctor.com/vault` (or wherever they host) as a tab. Faster than
   alt-tabbing to the desktop app for one lookup.

3. **Sharing read access with a household member (tertiary).** Spouse needs
   to look up a shared account. They open the URL on their own device, type
   the shared master password, get the value. No KeePassXC install required
   for the recipient. (This is single-master-password sharing; multi-user
   per-recipient unwrapping is a v0.3 Layer 2 feature.)

4. **Static-host deployment as a personal vault portal.** User pushes
   `web-kdbx` plus their `vault.kdbx` to a private static host (private
   GitHub Pages, S3 bucket with auth, self-hosted nginx). Any browser
   pointed at the URL becomes a viewer.

## Non-goals

The following are explicitly out of scope for v0.1:

- **Editing or saving.** Read-only. Modifications go through KeePassXC (or
  Layer 1 `web-kdbx` v0.2 once shipped).
- **Storage backends.** No GitHub OAuth integration, no S3 PUT, no WebDAV.
  v0.1 reads bytes from a file picker, drag-drop, or a configured URL fetch.
- **Multi-recipient encryption.** No envelope encryption, no per-user key
  wrapping. Single master password unlocks the whole vault. (Layer 2 work.)
- **Persistence between page loads.** No localStorage, no IndexedDB, no
  Service Worker. Each page load starts cold. The user re-supplies the file
  and password.
- **Auto-lock on idle.** Manual Lock button only. (v0.2.)
- **Attachment download.** Show metadata (name, size); do not download the
  binary blob. (v0.2.)
- **Entry history view.** Detail panel shows `history_count`; does not
  render the history. (v0.2; will use `diff-kdbx::compute` over consecutive
  history snapshots when added.)
- **Key file or hardware token support.** Master password only. (v0.2 for
  key file; v0.3 for YubiKey via WebAuthn.)
- **Custom themes or theming infrastructure.** One default style.
- **Plugin protocol or extensions.** No KeePass plugin compatibility.
- **WebExtension / browser extension form.** Static page only. A browser
  extension is a separate project (could become `extension-kdbx` if there
  is demand).

## Architecture

```
~/github/kdbx/web-kdbx/
|-- Cargo.toml                       # cdylib + wasm-bindgen target
|-- src/
|   |-- lib.rs                       # wasm-bindgen exports
|   |-- vault.rs                     # Vault: wraps keepass::Database
|   |-- totp.rs                      # TOTP generator (totp-lite)
|-- www/
|   |-- index.html                   # entry point
|   |-- app.js                       # bootstrap, wasm-pack glue
|   |-- styles.css
|   |-- components/
|       |-- vault-app.js             # root <vault-app>
|       |-- vault-tree.js            # group tree (left pane)
|       |-- vault-list.js            # entry list (middle pane)
|       |-- vault-detail.js          # entry detail (right pane)
|       |-- vault-search.js          # search input
|-- scripts/
|   |-- build.sh                     # wasm-pack build --target web
|   |-- build-single-html.sh         # derives Approach-A single-HTML artifact
|-- tests/
|   |-- fixtures/                    # KDBX test fixtures + MANIFEST.md
|   |-- wasm_bindgen.rs              # wasm-bindgen-test for the Rust API
|   |-- e2e/                         # Playwright specs
|-- docs/
|   |-- superpowers/{specs,plans}/   # this design + the implementation plan
|   |-- testing.md                   # test architecture
|   |-- manual-testing.md            # cross-browser smoke procedure
|-- pkg/                             # wasm-pack output (gitignored)
|-- README.md
```

### Trust boundary

```
+---------------------------------------------+
| Browser (trust environment)                 |
|   +-------------------------------------+   |
|   | DOM / web components (vanilla JS)   |   |
|   |   - holds opaque Vault handle       |   |
|   |   - never sees plaintext password   |   |
|   +-----------------+-------------------+   |
|                     | wasm-bindgen calls    |
|   +-----------------v-------------------+   |
|   | WASM (Rust + keepass-rs)            |   |
|   |   - holds keepass::Database         |   |
|   |   - holds decrypted field values    |   |
|   |   - returns plaintext only via      |   |
|   |     reveal_field() per request      |   |
|   +-------------------------------------+   |
+---------------------------------------------+
                      | encrypted blob in
                      | (file picker, drag-drop, fetch)
+---------------------+-----------------------+
| User-supplied .kdbx file (opaque)           |
+---------------------------------------------+
```

Above the line is trusted (runs in user's browser, sees plaintext). Below
the line is untrusted (network, storage, the file at rest). The
architecture's primary job is to keep the trust boundary in exactly that
place.

### Key architectural choices

1. **Stateful Vault held in WASM.** The `Vault` struct owns the parsed
   `keepass::Database`. JS holds an opaque handle (a wasm-bindgen pointer)
   and calls methods on it. Plaintext lives only inside WASM.

2. **Reveal is per-field, on demand.** `Vault.field(uuid, name)` returns a
   masked indicator by default. `Vault.reveal_field(uuid, name)` returns
   plaintext for that one field, that one call. The UI calls reveal_field
   on click and pipes the result directly to clipboard with an auto-clear
   timer or shows the value in the DOM until the next interaction.

3. **Lock = drop the Vault.** Click "Lock," JS frees the WASM pointer, the
   `Vault` is dropped, all decrypted plaintext is zeroized and gone.
   Re-opening means re-typing the password.

4. **No persistence.** No Service Worker. No IndexedDB. No localStorage.
   Each page load starts cold. The user supplies the `.kdbx` via file
   picker, drag-drop, or a configured URL fetch.

5. **No build pipeline beyond wasm-pack.** No webpack, no rollup, no Vite.
   The browser loads `index.html`, which uses ES modules to import `app.js`
   and the wasm-bindgen-generated glue. wasm-pack with `--target web`
   produces the right shape.

6. **No backend.** Hosting is any static webserver, or `file://` directly
   for the single-HTML artifact.

## Components

### Rust crate (`src/lib.rs`)

The wasm-bindgen surface is intentionally thin and viewer-shaped. Plaintext
stays in WASM; JS receives summaries with masking already applied:

```rust
#[wasm_bindgen]
pub struct Vault { db: keepass::Database }

#[wasm_bindgen]
impl Vault {
    #[wasm_bindgen(constructor)]
    pub fn open(bytes: &[u8], password: &str) -> Result<Vault, JsError>;

    pub fn name(&self) -> Option<String>;
    pub fn version(&self) -> String;        // "KDBX4.1" etc.

    pub fn group_tree(&self) -> JsValue;            // GroupSummary tree, no entries
    pub fn entries_in_group(&self, uuid: &str) -> JsValue;  // Vec<EntrySummary>
    pub fn entry(&self, uuid: &str) -> Option<JsValue>;     // EntryDetail
    pub fn reveal_field(&self, uuid: &str, field: &str) -> Option<String>;
    pub fn totp(&self, uuid: &str) -> Option<TotpCode>;
    pub fn search(&self, query: &str) -> JsValue;           // Vec<EntrySummary>
}
```

Internal types serialized to JS via serde:

```rust
#[derive(Serialize)]
pub struct GroupSummary {
    pub uuid: String,
    pub name: String,
    pub icon: Option<u32>,
    pub entry_count: usize,
    pub children: Vec<GroupSummary>,
}

#[derive(Serialize)]
pub struct EntrySummary {
    pub uuid: String,
    pub title: String,
    pub username: Option<String>,
    pub url: Option<String>,
    pub tags: Vec<String>,
    pub has_totp: bool,
    pub modified: Option<String>,  // RFC 3339
}

#[derive(Serialize)]
pub struct EntryDetail {
    pub summary: EntrySummary,
    pub group_path: String,        // "/Banking/Personal" for breadcrumb
    pub fields: Vec<FieldDisplay>,
    pub attachments: Vec<AttachmentSummary>,
    pub history_count: usize,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FieldDisplay {
    Plain { name: String, value: String },
    Masked { name: String, hint: String },  // hint: "12 chars" or "protected"; never plaintext or hash
}

#[derive(Serialize)]
pub struct AttachmentSummary {
    pub name: String,
    pub size_bytes: usize,
    // No content; download is v0.2.
}

#[wasm_bindgen]
pub struct TotpCode {
    pub code: String,              // "123456"
    pub seconds_remaining: u32,
}
```

### JS web components (`www/components/`)

```
<vault-app>                          # root: holds Vault handle, dispatches state
  +- <vault-opener>                  # initial state: file picker + drag-drop + password input
  +- <vault-search>                  # post-open: search box bound to Vault.search()
  +- <vault-tree>                    # post-open: group tree (left pane)
  +- <vault-list>                    # post-open: entry list (middle pane)
  +- <vault-detail>                  # post-open: entry detail (right pane)
  +- <vault-lock-button>             # always: drops Vault, returns to opener
```

Communication is custom events bubbling up to `<vault-app>`:

- `vault-opener` -> `vault-opened` (carries the Vault handle)
- `vault-tree` -> `select-group {uuid}`
- `vault-list` -> `select-entry {uuid}`
- `vault-detail` -> `reveal-field {entry_uuid, field_name}`, `copy-field`, `copy-totp`
- Any -> `lock` (from the lock button or from a fatal error)

`<vault-app>` listens, calls WASM, updates child components by setting
properties (`tree.data = ...`, `list.entries = ...`). No framework
reactivity; explicit re-render via lifecycle methods on the components
themselves. Each component is under 100 lines.

### v0.1 feature scope (locked in)

In scope:

- Open a `.kdbx` (file picker + drag-drop, plus optional URL fetch via
  query string for static-host deployments).
- Browse group tree, view entries in a group, view entry detail.
- Mask protected fields by default; reveal-on-click per field.
- Copy field to clipboard with auto-clear (12 seconds, KeePassXC convention).
- TOTP display with countdown ring.
- Substring search across Title, UserName, URL, Notes, Tags.
- Manual Lock button (drops Vault, zeroes plaintext).

Out of scope: see "Non-goals" above.

## Data flow

### Open

```
User picks file + types password + clicks Unlock
     |
     v
<vault-opener>: FileReader -> Uint8Array
     |
     v JS calls
new Vault(bytes, password)             [wasm-bindgen]
     |
     v
WASM: keepass::Database::open()        [decrypts]
     |
     v returns
Result<Vault, JsError>
     |
     +-- Err: <vault-opener> shows "Wrong password or corrupt file"
     |
     +-- Ok(handle): dispatches `vault-opened`
                v
            <vault-app>: stores handle, hides opener, calls
                vault.group_tree() -> sets <vault-tree>.data
                shows three-pane view (tree | list | detail)
```

### Browse + search

```
User clicks group in <vault-tree>
     |
     v event `select-group {uuid}`
<vault-app>: vault.entries_in_group(uuid) -> <vault-list>.entries

User clicks entry in <vault-list>
     |
     v event `select-entry {uuid}`
<vault-app>: vault.entry(uuid) -> <vault-detail>.entry

User types in <vault-search>
     |
     v event `search-query {q}` (debounced ~150ms)
<vault-app>: vault.search(q) -> <vault-list>.entries  (overrides group filter)
```

Empty search query reverts to the currently-selected group's entries.

### Reveal + copy

```
User clicks reveal-button next to a masked field
     |
     v event `reveal-field {entry_uuid, field_name}`
<vault-app>: vault.reveal_field(uuid, name) -> plaintext String
     |
     v sets property on <vault-detail>
<vault-detail>: replaces <hash:...> with plaintext in DOM

User clicks copy-button
     |
     v event `copy-field {entry_uuid, field_name}`
<vault-app>: vault.reveal_field(uuid, name) -> plaintext
             navigator.clipboard.writeText(plaintext)
             setTimeout(() => clipboard.writeText(""), 12_000)
             dispatches `copy-completed` (UI shows "Copied" toast + countdown)
```

Each `reveal_field` is a fresh call into WASM. JS holds plaintext only as
long as it needs to (during display + during the brief `writeText` window).
Auto-clear is best-effort because some browsers prevent silent clipboard
overwrites; the toast is the user-visible warning.

### TOTP

```
<vault-detail> rendering an entry with has_totp=true:
     |
     | on attach: setInterval(refresh, 1000)
     |
     v refresh():
vault.totp(uuid) -> { code: "123456", seconds_remaining: 23 }
     |
     v
<vault-detail> updates the code text and countdown ring

User clicks copy-totp:
     v event `copy-totp {entry_uuid}`
<vault-app>: vault.totp(uuid).code -> clipboard (same auto-clear)
```

`vault.totp()` is cheap (HMAC-SHA1 over the secret + current time slice).
Calling it every second for the visible entry is fine even at hundreds of
entries; only the visible one is computed.

### Lock

```
User clicks <vault-lock-button>
     |
     v event `lock`
<vault-app>:
   - vault.free()                      [wasm-bindgen pointer free]
   - clipboard.writeText("")          [best-effort wipe]
   - clear handle, clear all <vault-*> data attributes
   - switch view back to <vault-opener>
     |
     v
WASM Vault dropped; Rust drops keepass::Database; plaintext zeroized
```

### URL fetch (optional path)

If `index.html?vault=path/to/vault.kdbx` is loaded, `<vault-opener>` fetches
the URL, drops bytes into the file slot, and waits for the user to type the
password. Same flow from there. Useful for static-host deployments where
the user always opens "their vault" from one location.

### Cross-cutting properties

- **Plaintext never leaves WASM unsolicited.** The only paths that produce
  plaintext are `reveal_field` and `totp.code`, both of which require
  explicit user action.
- **No logging of plaintext.** Components do not `console.log` field
  values. Errors are logged with field names but never values.
- **No persistence.** No `localStorage`, no `sessionStorage`, no IndexedDB.
  Page refresh wipes everything.
- **Search runs in WASM.** It iterates over Database entries and matches
  in Rust; never serializes plaintext fields out unnecessarily. Returned
  `EntrySummary` items contain only metadata which is not protected.

## Error handling

### Categories

| Category | Examples | Where caught | User-facing |
|---|---|---|---|
| Open errors | Wrong password, corrupt file, truncated, invalid magic, unsupported version | Rust `Vault::open()` returning `Result<Vault, JsError>` | `<vault-opener>` shows inline error below Unlock button |
| Browse errors | UUID not found, field name missing | Rust accessor returns `None` or empty | Component shows blank state; logs to console |
| Reveal errors | Field not present, entry not found | Rust returns `Option<String>` | UI button stays at "Reveal" state; toast: "Field unavailable" |
| Clipboard errors | `navigator.clipboard.writeText` rejects | JS try/catch | Toast: "Could not access clipboard. Value was revealed; copy manually." |
| TOTP errors | Entry has no TOTP, bad secret | Rust returns `None` | UI hides the TOTP panel for that entry |
| WASM init errors | Browser does not support WASM, fetch failed | Top-level `app.js` try/catch | Page-level: "This browser does not support WebAssembly." |
| File-input errors | Drag-drop of non-file, reader rejects | JS `<vault-opener>` | Inline: "Please drop a `.kdbx` file." |

### Security shape of error messages

**Conflate "wrong password" with "corrupt file" in user-facing text.** Both
surface as: `"Wrong password or corrupt file."` Distinguishing them leaks
information: an attacker who feeds an arbitrary file to the unlock flow
learns whether it is a valid KDBX before they know the password. KeePassXC
and 1Password both do the same conflation; we follow.

The browser console can log more detail for debugging, but the UI does not
distinguish.

### Error message conventions

- Single sentence, no jargon. "Wrong password or corrupt file." not
  "Argon2 KDF failed: invalid HMAC."
- Inline near the relevant control. No global error popup.
- Past tense for actions ("Could not access clipboard"), present tense for
  states ("This file is not a KDBX database").
- Never include plaintext values, password hints, or file content details
  in error text. The error itself can be a side channel.

### What we log to the browser console

Acceptable: error type, file size, KDBX version, UUID of involved
entry/group.

Never: master password, field plaintext, TOTP codes, decrypted entry
content of any kind.

### Defensive shape in Rust

```rust
#[wasm_bindgen]
impl Vault {
    #[wasm_bindgen(constructor)]
    pub fn open(bytes: &[u8], password: &str) -> Result<Vault, JsError> {
        let key = keepass::DatabaseKey::new().with_password(password);
        let mut reader = std::io::Cursor::new(bytes);
        let db = keepass::Database::open(&mut reader, key)
            .map_err(|_| JsError::new("Wrong password or corrupt file."))?;
        // The map_err deliberately conflates AuthenticationFailed with
        // InvalidKdbxFile in the user-facing message.
        Ok(Vault { db })
    }
}
```

### Lock-on-error policy

If any operation post-open returns a fatal error (e.g., the WASM Vault
state is corrupted somehow), `<vault-app>` calls the same Lock flow: drop
the Vault, clear clipboard, return to `<vault-opener>`. Better to fail
closed than to leave the app in an inconsistent state holding plaintext.

## Testing

### Four test layers

```
+----------------------------------------------------------+
|  Layer 4: Manual smoke (documented procedure)            |
|    cross-browser, real KeePassXC vaults, mobile checks   |
+----------------------------------------------------------+
|  Layer 3: Playwright end-to-end                          |   ~5 specs
|    real headless browser + wasm-pack build               |
|    full user flows: open, browse, reveal, copy, lock     |
+----------------------------------------------------------+
|  Layer 2: wasm-bindgen-test                              |   ~5 tests
|    in-browser smoke tests for the wasm-bindgen surface   |
|    runs via wasm-pack test --headless --firefox          |
+----------------------------------------------------------+
|  Layer 1: Rust unit tests (native target)                |   ~15 tests
|    src/<module>.rs::test, in-process, no browser         |
|    Vault logic, search, group-tree shaping, masking      |
+----------------------------------------------------------+
```

Layer 1 is fastest, runs on every `cargo test`. Layer 2 runs in CI and
catches wasm-bindgen serialization issues. Layer 3 covers full user flows
in a real browser. Layer 4 is the human-in-the-loop verification we cannot
automate cheaply.

### Targets per layer

**Layer 1 (Rust unit):**

- `Vault::group_tree` produces correct nested structure for known fixtures.
- `Vault::entries_in_group` returns the expected entries.
- `Vault::search` matches across visible fields and excludes hidden ones.
- `FieldDisplay` masking respects the protected attribute and never
  includes plaintext.
- `TotpCode::seconds_remaining` math is correct around the 30-second boundary.

**Layer 2 (wasm-bindgen-test):**

- `new Vault(bytes, "wrong-password")` throws `JsError` with conflated message.
- `vault.group_tree()` returns a JsValue iterable as a normal object.
- `vault.search("nonexistent")` returns an empty array, not null.
- `vault.totp(uuid)` returns null for entries without TOTP, an object for
  entries with TOTP.
- `vault.free()` is callable and subsequent calls fail predictably.

**Layer 3 (Playwright e2e):**

- Open flow: drop a fixture file, type the test password, three-pane view appears.
- Wrong password: error message appears, no view change.
- Browse: click group -> entries; click entry -> detail.
- Reveal: click reveal -> plaintext appears in DOM; verify it does NOT
  appear in `console.log` output.
- Copy: click copy, mock `navigator.clipboard.writeText`; verify
  auto-clear timer fires after 12s.
- Lock: click lock -> return to opener; subsequent freed-Vault uses fail.

**Layer 4 (manual smoke):**

- Real Chrome, Firefox, Safari (current versions).
- Real mobile Chrome (Android) and Safari (iOS).
- Real KeePassXC-generated vaults at KDBX 3.1, 4.0, 4.1.
- Single-HTML artifact via `file://`.
- URL-fetch entry path on a real static-host deployment.
- Vault with hundreds of entries (perf sanity).

### Fixtures

`tests/fixtures/` mirrors the diff-kdbx convention (committed `.kdbx` files
with `MANIFEST.md`). For v0.1, copy the three diff-kdbx fixtures (`empty/`,
`add_entry/`, `password_change/`) and adapt as needed. Master password:
`test-password-do-not-use`.

Future fixtures specific to web-kdbx:

- `nested_groups/`: deeper group tree to exercise tree-rendering.
- `totp_entry/`: an entry with a TOTP secret configured.
- `large_vault/`: ~500 entries to spot-check perf and search.

### CI

GitHub Actions workflow with three required jobs and a non-blocking guard:

| Job | Runs | Cost | Required |
|---|---|---|---|
| `rust-tests` | `cargo test` | ~10 sec | Yes |
| `wasm-tests` | `wasm-pack test --headless --firefox` | ~30 sec | Yes |
| `e2e-tests` | Playwright suite | ~60 sec | Yes |

Bundle-size guard (warn, not fail):

| Check | Pass condition |
|---|---|
| `web_kdbx_bg.wasm` size | < 500 KB after wasm-opt |
| `app.js` size | < 50 KB |

### What we do not test

- Per-component unit tests in JS (separate Layer 3 with JSDOM). Web
  components are awkward in JSDOM, the components are tiny, and Playwright
  covers the realistic flows.
- Visual regression / screenshot tests. v0.1 has minimal styling.
- Performance benchmarks. Manual perf sanity in Layer 4 is enough.
- Cross-implementation interop tests with `keepass-rs` write paths. That
  belongs in `keepass-rs`'s own test suite.
- Network / sync tests. Layer 0 has no network; Layer 1 (v0.2) will need them.

## Build artifacts

### Approach B (primary)

Standard wasm-pack output:

- `pkg/web_kdbx.js`: generated wasm-bindgen JS bindings.
- `pkg/web_kdbx_bg.wasm`: the WASM blob.
- `www/`: static HTML/JS shell that imports from `../pkg/`.

Build: `wasm-pack build --target web --release` then serve `www/` (or open
`www/index.html` directly via `file://`).

WASM caches independently in the browser. Returning users on a static host
do not re-download the WASM blob.

### Approach A (derived secondary)

A single self-contained `index.html` produced by
`scripts/build-single-html.sh`:

1. Run wasm-pack as in Approach B.
2. Base64-encode `pkg/web_kdbx_bg.wasm`.
3. Inline the base64 blob plus the generated JS plus `app.js` plus the
   component scripts plus `styles.css` into a single `<script>` tag inside
   `dist/web-kdbx.html`.
4. The runtime initialization fetches the WASM via a `data:` URL.

Result: a single `.html` file that works via `file://` with no other
dependencies. The longecho-shaped artifact.

Trade-off: bigger file (300 to 500 KB), no per-asset caching. Use it when
you want a portable artifact (USB stick, email attachment), not when you
are deploying to a static host.

### Approach C (deferred to hugo-kdbx)

Packaging as a Hugo theme component is `hugo-kdbx`'s responsibility. Out of
scope for v0.1 of `web-kdbx`.

## Browser compatibility

Targets:

- Chrome / Chromium 120+ (covers Chrome, Edge, Brave, Vivaldi)
- Firefox 120+
- Safari 17+ (macOS, iOS)
- Mobile Chrome (Android) and Safari (iOS) at the same versions

These are conservative cutoffs ensuring WASM, ES modules, custom elements,
`navigator.clipboard.writeText`, and the FileReader API are all stable.
Older browsers fail at the page-level "This browser does not support
WebAssembly" message rather than silently breaking.

Does not target: Internet Explorer (any version), legacy Edge (pre-Chromium),
browsers without WebAssembly support.

## Decisions made during the brainstorm

- **Q1: Layer.** v0.1 is **Layer 0 (read-only)**. Reasoning: validates the
  WASM + keepass-rs + browser stack before adding storage-backend
  complexity. "Portable read-only KeePassXC" is a real value-add on its
  own. Sets up Layer 1 cleanly without throwaway work.

- **Q2: Library reuse from diff-kdbx.** **Opportunistic.** Built directly
  on `keepass-rs`. Pulls in `diff-kdbx` only for specific features that
  genuinely need diff (e.g., entry history view, planned for v0.2).

- **Q3: WASM build path.** **New crate at `~/github/kdbx/web-kdbx/`.** Not
  inside `diff-kdbx`. The wasm-bindgen surface is viewer-shaped, not
  diff-shaped.

- **Q4: Storage backend.** Moot for v0.1 (read-only). Decide in v0.2 when
  Layer 1 is on the table.

- **Q5: Identity model.** Moot for v0.1 (single master password). Decide
  in v0.3 when Layer 2 is on the table.

- **Q6: UI framework.** **Vanilla web components.** No framework. Standard
  custom elements + ES modules + custom events. Bundle stays tiny;
  longecho-shape preserved; hugo-kdbx embedding is native (`<vault-app>`
  works in any HTML).

- **Build artifact strategy.** Approach B (wasm-pack output, three files)
  is primary. Approach A (single inlined HTML) is a derived secondary
  artifact via `scripts/build-single-html.sh`. Approach C (Hugo theme) is
  deferred to `hugo-kdbx`.

- **Project name and repo.** Project: `web-kdbx`. Cargo crate: `web-kdbx`.
  Repository: `github.com/queelius/web-kdbx` (will be created public, MIT,
  when v0.1 ships).

- **License.** MIT, matching `diff-kdbx`.

## Open questions for the implementation plan

The following are tactical and belong in the plan, not the design:

- Exact wasm-bindgen feature flags and codegen options.
- Specific `totp-lite` API usage (or equivalent crate; verify availability).
- Path-encoding rules for group/entry names containing path-special chars
  in `group_path` strings (mirror diff-kdbx's backslash-escape convention).
- Bundle-size optimization passes (`wasm-opt -Oz`, etc.).
- Exact clipboard-clear strategy on browsers that prevent silent clipboard
  overwrite (Safari, some Firefox configurations).
- Mobile UX considerations for the three-pane layout (collapsed-by-default
  panes? swipe navigation?).
- Whether to ship a default style or leave the app unstyled with hooks for
  CSS customization.
- Whether to default to dark or light mode (or `prefers-color-scheme`).
- How aggressively to debounce search (150ms is the placeholder; tune
  based on real fixtures).

## Out of scope (deferred to later versions)

- Layer 1 features: editing, saving, storage backends.
- Layer 2 features: multi-recipient encryption, envelope sharing, recipient
  management.
- Layer 3 features: differential sync, CRDT, conflict resolution.
- Layer 4 features: identity recovery, key rotation infrastructure.
- Auto-lock on idle (v0.2).
- Attachment download (v0.2).
- Entry history view via diff-kdbx integration (v0.2).
- Key file support (v0.2).
- WebAuthn / passkey-as-master-key (v0.3).
- YubiKey via WebAuthn (v0.3).
- Browser extension form factor (separate project; not part of *-kdbx).
- Service-worker offline mode (probably never; longecho-shape says no).
- Plugin protocol or KeePass extension compatibility (no).
