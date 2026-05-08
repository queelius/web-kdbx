# Manual smoke tests

Run before release.

## Browser matrix

For each release candidate, verify on:

- Chrome (current stable, Linux or macOS)
- Firefox (current stable)
- Safari (current stable, macOS)
- Mobile Chrome (Android)
- Mobile Safari (iOS)

## Test scenarios

For each browser:

1. Open `index.html` from a static webserver. Opener appears.
2. Drop a real KeePassXC-generated `.kdbx` (KDBX 4.1). Type the password,
   click Unlock. Verify three-pane view.
3. Click around groups, verify entries appear.
4. Click an entry, verify detail panel shows masked Password.
5. Click Reveal on Password. Verify plaintext appears in DOM.
6. Click Copy. Verify "Copied" toast. Wait 12 seconds; paste into a
   text editor and verify clipboard is empty.
7. If the entry has TOTP: verify the code displays and counts down.
8. Type into the search box. Verify entries filter.
9. Click Lock. Verify return to opener.
10. Reload the page. Verify everything resets.

## KDBX version coverage

Run scenario 2 against KDBX 4.1, 4.0, and 3.1 (legacy compat).

## Single-HTML artifact

Run `./scripts/build-single-html.sh`. Open `dist/web-kdbx.html` directly
via `file://`. Run scenarios 1-10.

## URL fetch

Host `dist/web-kdbx.html` on a real static webserver alongside a `.kdbx`.
Open `dist/web-kdbx.html?vault=path/to/your.kdbx`. Verify the file is
fetched automatically and the password prompt appears.

## Performance sanity

Open a real vault with hundreds of entries. Verify search responds within
200ms of typing, group tree renders in under 1 second, TOTP refresh
doesn't visibly stutter.

## L1 Manual Smoke

### Mode 1 (hosted vault)

For each browser (Firefox, Chromium, Safari, mobile Safari, mobile Chrome):

- [ ] Open the bundled-test page (or a Mode 1 deployment)
- [ ] Unlock with the master password
- [ ] Verify the mode banner shows "Editing vault from {filename}. Changes save to this browser."
- [ ] Click an entry; click Edit
- [ ] Modify a non-protected field (URL is convenient); click Save
- [ ] Verify the read view shows the new value
- [ ] Verify the mode banner now shows "...click Download to export, Discard Local Changes to revert."
- [ ] Reload the page; unlock again
- [ ] Verify the edit persisted (localStorage working copy)
- [ ] Click Download Vault
- [ ] Verify a `.kdbx` file downloads with sensible filename
- [ ] Optionally: open the downloaded file in KeePassXC; verify the edit is present
- [ ] Click Discard Local Changes; confirm the dialog
- [ ] Page reloads; unlock; verify the canonical (pre-edit) state is restored

### Mode 2 (BYO)

For each browser:

- [ ] Open the default page
- [ ] Verify "BYO vault" banner is NOT shown until a file is loaded
- [ ] File-pick or drag-drop a .kdbx file
- [ ] Unlock with the master password
- [ ] Verify the mode banner shows "BYO vault. Changes are in memory only. Click Download to save."
- [ ] Verify the Discard Local Changes button is NOT visible (Mode 1 only)
- [ ] Edit an entry; verify changes are reflected in read view
- [ ] Click Download Vault; verify download triggers
- [ ] Reload the page
- [ ] Verify the file picker reappears (no working copy persisted in BYO mode)

### Edge cases

- [ ] Quota exhaustion: pre-fill localStorage to near quota (developer tools), attempt to save an edit; verify the friendly error message appears
- [ ] Storage isolation: open the same vault on `http://localhost:8000` and a different origin (e.g., `http://127.0.0.1:8000`); verify the two have independent working copies
