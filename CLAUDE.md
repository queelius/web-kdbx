# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Pre-design. The repo currently contains only this CLAUDE.md, a README skeleton, and `docs/superpowers/kickoff.md` (which captures the conceptual groundwork from prior brainstorming and lists the questions the first design session needs to settle).

**Before writing code or scaffolding a Cargo/npm project here, run a brainstorming session against `docs/superpowers/kickoff.md`.** That doc surfaces the open questions; the brainstorm settles them and produces a `docs/superpowers/specs/` document, which then drives an implementation plan in `docs/superpowers/plans/`. This is the same flow used for the sibling project `diff-kdbx` (see `~/github/beta/diff-kdbx/`).

## Position in the ecosystem

`web-kdbx` is the **anchor** of the `*-kdbx` ecosystem (the heaviest member; reuses the diff engine from `diff-kdbx` via WASM). Other members:

- `diff-kdbx`: shipped (https://github.com/queelius/diff-kdbx)
- `mcp-kdbx`: bridge, planned
- `hugo-kdbx`: tool, depends on web-kdbx
- `arkiv-kdbx`, `longecho-kdbx`: bridges, pinned

## Key cross-repo references

- `~/github/beta/diff-kdbx/`: the library this project will consume via WASM. Read its CLAUDE.md, spec, and plan first.
- `~/github/repos/cryptoid/`, `~/github/repos/pagevault/`, `~/github/repos/sigmark/`: sibling browser-side crypto projects. Not part of `*-kdbx`, but operate in the same "static-first secrets stack" worldview.
