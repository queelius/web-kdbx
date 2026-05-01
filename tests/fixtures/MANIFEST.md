# Test Fixtures Manifest

Master password for all synthetic fixtures: `test-password-do-not-use`.

## Active fixtures

### empty/
- Origin: copied from diff-kdbx (originally synthetic via gen-fixtures).
- Master password: test-password-do-not-use
- Contents: an empty KDBX 4 database with no entries.
- Regen: re-copy from `~/github/kdbx/diff-kdbx/tests/fixtures/empty/`.

### add_entry/
- Origin: copied from diff-kdbx.
- Master password: test-password-do-not-use
- Contents: `before` is empty; `after` contains one entry under Root with Title=Chase, UserName=alice@example.com, Password=hunter2, URL=https://chase.com.
- Regen: re-copy from `~/github/kdbx/diff-kdbx/tests/fixtures/add_entry/`.

### password_change/
- Origin: copied from diff-kdbx.
- Master password: test-password-do-not-use
- Contents: both files have one entry under Root; Password differs between before and after.
- Regen: re-copy from `~/github/kdbx/diff-kdbx/tests/fixtures/password_change/`.

## Future fixtures (not yet generated)

- nested_groups/: deeper group tree to exercise tree-rendering.
- totp_entry/: an entry with `otp` field set to an otpauth:// URL.
- large_vault/: approximately 500 entries to spot-check perf and search.

When adding a fixture, document origin, master password, contents, and regen procedure here.
