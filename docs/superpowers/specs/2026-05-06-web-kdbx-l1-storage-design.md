# web-kdbx L1 Storage Design

**Status:** Spec, not yet implemented. v0.1 (Layer 0) is read-only.
This document captures the L1 design decisions reached during the
mcp-kdbx brainstorm on 2026-05-06; L1 work is gated on L0 stability
and on actual demand for write capability.

**Supersedes:** the earlier "Tier 1 + Tier 2 cascade" sketch in the
2026-04-29 design doc, which was rejected for cross-browser UX
inconsistency.

## Mental model

A web-kdbx instance is **a vault hosted at a URL**, not a generic tool
you point at any file. The URL identifies the vault. The static site
bundles a canonical `.kdbx` file alongside the WASM viewer. localStorage
holds the per-origin working copy of that vault.

This is structurally a wiki shape: the URL has content, visitors can have
local annotations on top of canonical content, you can export the
canonical-or-modified content as a file. The vault *is* the page's
content. The viewer is the renderer.

This shape is what makes web-kdbx materially different from KeePassXC
(desktop file editor) and OmniKee (cross-platform vault app). Without
the URL-identifies-vault model, web-kdbx would just be a tool that
happens to run in a browser, which OmniKee already is.

## Two operational modes

| Mode | Bundled vault? | localStorage holds | Revert to canonical? |
|---|---|---|---|
| **Hosted-vault** | Yes (shipped with site) | Working copy of bundled vault | Yes (clear localStorage = revert to bundled) |
| **Bring-your-own** | No | Working copy of user-uploaded vault | No (clear = empty viewer; user re-uploads) |

Both modes share the L1 implementation. They differ only in whether a
canonical-bundled-bytes fallback exists. Mode 1 is the canonical use
case the *-kdbx vision is built around. Mode 2 is supported because
the infrastructure for Mode 1 makes Mode 2 free.

## Storage architecture

```
localStorage layout:
  Key:   "web-kdbx:vault:" + vault-id
  Value: encrypted KDBX bytes (whole file, latest working copy)

  vault-id:
    Mode 1 (hosted):  origin + bundled-vault-name
    Mode 2 (BYO):     "byo:" + user-provided-name (or hash of bytes)

  No IndexedDB, no OPFS, no Service Worker, no cookies, no parallel state.
  One key per vault, value is whole encrypted KDBX.
```

### Why whole bytes, not patches

Three reasons documented for posterity:

**1. Encryption boundary stays identical to the file format.** A KDBX
file is encrypted as a whole document with the master password as KDF
input. localStorage holding whole encrypted KDBX bytes has identical
threat model to "the user has a copy of the .kdbx file." No new
encrypted-patch format to design or audit. Anyone who intercepts the
localStorage entry has intercepted a KDBX file, which is the same
attack surface as intercepting the file at upload time.

**2. Download becomes trivial.** With whole-blob storage, "Download
Vault" is `Blob.from(localStorage[key])`. The bytes *are* the file.
With patches, download requires loading canonical, applying patches,
re-encrypting, then triggering download (more code, more bugs, more
crypto-touching surface).

**3. diff-kdbx as runtime visualizer, not storage format.** The
legitimate appeal of patches is "show user what they've changed."
That feature is achievable at runtime: decrypt canonical, decrypt
localStorage, run diff-kdbx semantic-diff, render the result.
diff-kdbx integrates as a visualizer over snapshot storage, not as
the storage format itself. Cleaner integration, less coupling.

### Why localStorage and not OPFS or IndexedDB

| Option | Why not |
|---|---|
| IndexedDB | Asynchronous API adds complexity; binary value support exists but ergonomics are worse than localStorage; we don't need indexes |
| OPFS | Comparable storage capacity, but harder for users to inspect/clear; localStorage's transparency ("clear site data" is well-understood by users) matters for the trust story |
| Service Worker caches | Wrong API shape (designed for HTTP responses); offline isn't the goal; opens a class of bugs we don't need |

localStorage works. The 5-10MB per-origin quota is sufficient for
realistic KDBX vaults (most are well under 1MB even with attachments).
If a user needs a bigger vault, they're outside the design center;
KeePassXC can handle them.

## Lifecycle behaviors

### Load

```
1. Read localStorage[vault-id] → if present, that's the working copy
2. Else, if Mode 1, load bundled bytes from page assets
3. Else, prompt user for file upload (Mode 2)

In all cases: encrypted bytes loaded into memory, master password
required to decrypt into a usable Vault structure.
```

### Save

```
Auto-save on every modification. Re-encrypt vault, write to localStorage[vault-id].

No save button. No "you have unsaved changes" state. Modification = saved.
This matches web-app expectations (Google Docs, Notion, etc.).
```

### Export

```
"Download Vault" button: Blob.from(localStorage[vault-id]) → download.
Filename: original bundled name (Mode 1) or user-provided BYO name (Mode 2).

Export is the path back to a regular .kdbx file: backup, migration to
another tool, commit-back to the site repo (for Mode 1 publishers).
```

### Revert (Mode 1 only)

```
"Discard Local Changes" button: clear localStorage[vault-id], reload from bundled.

Confirmation prompt: "This will discard all changes since [bundled date]."

Mode 2 has no revert; "discard" would mean "remove the vault entirely,"
which is just the close action.
```

### Lock

```
Drop in-memory WASM Vault, zero plaintext.
localStorage stays (still encrypted bytes).
Next unlock: re-decrypt localStorage[vault-id] with master password.
```

### Idle timeout

```
Lock after N minutes of no modifications or reads.
Default: 15 minutes (matches mcp-kdbx idle-lock TTL).
Configurable via attribute on the <web-kdbx> custom element.
localStorage retained (no data loss on idle-lock; just locks the live state).
```

### Diff visualization (optional, Mode 1 only)

```
"View Changes" button: decrypt both bundled and localStorage,
run diff-kdbx semantic-diff, render the result.

Output: list of {added, modified, removed} entries with field-level
detail. Enables "show me what I've changed since the page-bundled date."

Optional in v0.1; cleanly separable from the storage layer.
```

## Audit invariants

These are CI-checkable properties that define the trust posture:

**Storage purity:**
- localStorage entries created by web-kdbx MUST be raw encrypted KDBX bytes
- No plaintext entry data, no parallel "settings cache," no decoded fields
- CI check: lint forbids any `localStorage.setItem` call where the value
  is anything other than the canonical encrypted-bytes write helper

**Storage scope:**
- No IndexedDB, no OPFS, no Service Worker, no cookies, no caches.open
- CI check: codebase grep returns zero hits for these APIs (test code excluded)

**Encryption boundary:**
- The master password MUST never be stored anywhere except WASM volatile memory
- localStorage entries can only contain bytes that are already encrypted by KDBX
- CI check: explicit allow-list of localStorage write sites; reviewer must
  confirm each new write site enforces "encrypted-only" invariant

**No-network invariant:**
- L1 web-kdbx MUST NOT make network requests after the initial page load
- The page can ship the vault and the WASM viewer; runtime never reaches out
- CI check: e2e test verifies no fetch/XHR calls during a typical session
- L2 (multi-recipient) lifts this; L1 is fully offline-capable post-load

## Trust model implications

The storage choices above produce a trust model that's distinct from
every mainstream password manager:

| Tool | Where state lives |
|---|---|
| KeePassXC | Local file + local app settings |
| OmniKee Tauri | Local app data + Tauri state |
| OmniKee PWA | Browser storage on omnikee.github.io (per their PWA model) |
| Bitwarden | Cloud sync to Bitwarden servers |
| 1Password | Cloud sync to 1Password servers |
| **web-kdbx L1** | **Encrypted bytes in browser localStorage on the hosting site, encrypted with master password using KDBX format. Nothing else, anywhere.** |

The web-kdbx trust statement: *"This tool keeps no state outside your
browser's localStorage on this site, and what it does keep is the same
encrypted format as the file itself. Master password lives in volatile
WASM memory only."*

## L2 boundary

L1 stops at single-device editing of a URL-hosted vault. The following
are explicitly **NOT in L1**:

- Multi-recipient encrypted shares (different threat model: multiple
  parties with potentially different keys; L2)
- Concurrent editing across devices (different problem: merge of
  concurrent changes; L2 or L3)
- Remote backends (Dropbox, S3, custom servers; if needed at all,
  belongs to a separate ecosystem member, not in web-kdbx itself)
- Native filesystem write-back (File System Access API was rejected
  in favor of cross-browser consistency via download-and-replace)

## Open implementation decisions

These can be deferred to L1 implementation time:

- **Multi-vault support per origin.** Could one site host multiple
  vaults at different paths? Probably yes; vault-id includes path
  fragment. Simple to support.
- **Custom element attribute surface.** What's configurable per
  embed: idle-timeout, theme, allowed operations, etc.
- **Diff-visualizer feature flag.** Bundle diff-kdbx visualizer code
  by default, or only on demand?
- **localStorage quota handling.** Graceful degradation when quota
  exceeded. Prompt user to download and clear old vaults.

## References

- 2026-04-29-web-kdbx-design.md (parent spec, L0 design)
- mcp-kdbx brainstorm (in progress as of 2026-05-06; this doc captures
  the parallel L1 discussion)
- diff-kdbx repo (the runtime visualizer dependency)
- OmniKee comparison (informed the URL-identifies-vault distinction)
