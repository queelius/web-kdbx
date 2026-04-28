# web-kdbx kickoff

**Date:** 2026-04-27
**Status:** Pre-design. Use this doc as the starting point for the first brainstorming session.

## Inheritance from prior work

This project was conceived during the brainstorming session that produced `diff-kdbx`. The following framing was settled and should be preserved unless explicitly revisited:

### Class membership: a "kdbx-web-like application"

A web app belongs to this class iff it has all five:

1. **Server-blind storage.** Server is given encrypted bytes. It cannot decrypt. Pulling the database file off the server gives the attacker only what the server already had.
2. **Browser-side crypto.** All KDF, encryption, decryption, signing, and verification happens in the user's browser. No server-side plaintext.
3. **Cryptographic authorization.** Access control is enforced by who has the key, not what the server permits.
4. **Structured record container.** The encrypted payload has internal structure (groups, entries, fields, history). Distinct from opaque-content cousins like `pagevault`.
5. **KDBX or KDBX-shaped format.** Either real KDBX (interoperable with KeePassXC et al.) or a deliberate evolution.

### Four-layer architecture

| Layer | Capability | Complexity |
|---|---|---|
| 0 | Read-only personal vault (browse a `.kdbx` from any browser) | Smallest |
| 1 | Read-write personal vault (storage backend with auth, e.g., GitHub commits) | Medium |
| 2 | Shared vault (multi-recipient via age-style envelope encryption) | Large |
| 3 | Differential sync / merge across devices | Research-flavored |
| 4 | Identity, recovery, key rotation infrastructure | Long-term |

### Variant taxonomy (six concrete instances)

These are different members of the class, all sharing the five necessary properties:

- `vault-static` (Layer 0): read-only personal companion to KeePassXC
- `vault-git` (Layer 1): read-write personal vault backed by a GitHub repo
- `vault-share` (Layer 2): multi-recipient via envelope encryption
- `hugo-vault` (Layer 0+, embedder): Hugo theme component embedding the reader
- `vault-totp` (Layer 0, specialized): TOTP-only viewer
- `vault-audit` (Layer 0, specialized): password-hygiene scanner

Per the diff-kdbx brainstorm decision, `vault-totp` and `vault-audit` are **modes** of `vault-static` (different launch URLs into the same code), not separate top-level projects.

### Philosophical alignment (the 30-year test)

Every `*-kdbx` member must pass:

- KDBX is multi-implementation FOSS with NIST/IETF crypto. At least one implementation survives 30 years.
- HTML5 + JS + WASM is the most durable computing platform humans have built. Browsers will render today's static pages indefinitely.
- A self-contained `.html` with embedded `.kdbx` blob and `.wasm` decoder is bytes any future browser can load.

`web-kdbx` targets these substrates exclusively. No SaaS dependencies. No vendor lock-in. No backends that can disappear.

## Open questions for the first brainstorming session

Resolve these in order; later questions depend on earlier ones.

### Q1: Which member of the class do we build first?

The brainstorm previously sequenced: `vault-static` (Layer 0) → `vault-git` (Layer 1) → `vault-share` (Layer 2). The argument for starting at Layer 0:

- Smallest scope; ships in days not weeks.
- Validates the WASM + `keepass-rs` + browser path before adding storage backends.
- "Portable read-only KeePassXC" is a real value-add on its own (works on borrowed laptops, kiosks, locked-down devices).

The counter-argument: Layer 0 alone may be too thin to motivate continued investment. Layer 1 (`vault-git`) is the smallest piece that's a real "manager".

**Decide:** which Layer is v0.1 of `web-kdbx`?

### Q2: Library reuse strategy from diff-kdbx

`diff-kdbx` was built I/O-free and WASM-compatible specifically so `web-kdbx` could reuse its diff engine. But `web-kdbx`'s primary task is *display*, not diff. Reuse looks like:

- "What changed since you last opened this vault?" view (uses `diff-kdbx::compute`)
- "Show this entry's history" timeline (uses `diff-kdbx::compute` over consecutive history snapshots)

**Decide:** is reuse opportunistic (use `diff-kdbx` only when the diff is genuinely the right primitive) or first-class (build the UI around the diff engine)?

### Q3: WASM build path

Two options:

- **A.** Compile the existing `diff-kdbx` library directly to wasm32. Export an `extern "C"` or wasm-bindgen surface. Use it from JS.
- **B.** Build a separate `web-kdbx-core` Rust crate (also wasm-targeted) that depends on `diff-kdbx` as a library, and exposes a richer browser-shaped API.

**Decide:** A (minimal) or B (richer)?

### Q4: Storage backend (only if v0.1 is Layer 1+)

For a read-write personal vault: where does the modified `.kdbx` go?

- GitHub via OAuth + commit API: free, audited, version history, but requires user to authorize a GitHub OAuth app.
- S3 / R2 via pre-signed URLs: cheap but requires a backend or per-user IAM gymnastics.
- WebDAV / Nextcloud: self-hosted, mature, has auth.
- IPFS / blob storage: experimental.

**Decide:** which backend(s) does v0.1 support? Single primary or pluggable adapter?

### Q5: Identity model (only if Layer 2+)

For multi-recipient: how do users prove identity to unlock the data key?

- Master password per recipient + age-style key wrapping
- WebAuthn / passkeys
- OPAQUE / PAKE protocols
- Hybrid

**Decide:** for v0.1's scope, what's the simplest model that works?

### Q6: UI framework

Vanilla JS, Yew (Rust + WASM), Svelte, Solid, Lit, web components, Preact.

This is a downstream decision; don't lock it in until the rest of the architecture is settled. The right answer probably depends on: (a) how much of the logic lives in WASM vs JS, (b) bundle size budget, (c) whether the project will eventually want to be embedded inside Hugo content (`hugo-kdbx`) where minimal JS overhead matters.

**Decide later, after Q1-Q5.**

## Workflow for the first session

1. Run `/brainstorm` (or invoke `superpowers:brainstorming` skill) with this kickoff doc as input.
2. Resolve Q1 first; that determines scope of all subsequent questions.
3. Produce a spec document in `docs/superpowers/specs/YYYY-MM-DD-web-kdbx-design.md`.
4. Run `/write-plan` (or invoke `superpowers:writing-plans` skill) to produce the implementation plan.
5. Execute via `superpowers:subagent-driven-development` (same flow used for `diff-kdbx`).

## Things deliberately not pre-decided here

- Specific name for v0.1 (`vault-static`, `web-kdbx`, `kdbx-reader`, etc.). Naming is brainstorm-time.
- Whether v0.1 ships as a library + reference UI, or just a UI, or just a library.
- Whether the project lives at `github.com/queelius/web-kdbx` or under a different name.
- License (probably MIT to match `diff-kdbx`, but confirm).
- Whether to coordinate with `keepass-rs` upstream on a wasm-friendly subset of the API.
