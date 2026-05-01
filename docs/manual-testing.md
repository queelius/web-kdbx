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
