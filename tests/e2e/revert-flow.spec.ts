// revert-flow.spec.ts
//
// L1 Layer 3 e2e: Mode 1 Discard Local Changes.
//
// Flow:
//   1. Load the bundled-vault page (Mode 1) with a fresh localStorage.
//   2. Unlock and edit the URL on the only entry. Save. Confirm the new
//      value appears in the read view (and a working copy now exists).
//   3. Click Discard Local Changes. The button calls window.confirm; we
//      pre-register a dialog handler that accepts. After acceptance,
//      vault-revert-button calls location.reload() which re-runs
//      <vault-app>._initLoad. With the working copy cleared, storage.js
//      falls back to the bundled canonical bytes.
//   4. Re-unlock and confirm the canonical (pre-edit) URL is restored.
//
// Notes:
//   - The dialog handler must be attached BEFORE the click, otherwise
//     the dialog may auto-dismiss before our listener attaches.
//   - The bundled fixture's canonical URL is https://example.com.
//   - The Discard Local Changes button computes its disabled state at
//     mount time. <vault-app> in v0.1 does not re-render the header on
//     vault:dirty (see the component comment in vault-revert-button.js),
//     so a fresh edit in the same session leaves the button disabled.
//     This spec mirrors the realistic user path: edit, reload, re-unlock
//     (the revert button now mounts with hasWorkingCopy=true), then
//     click Discard. The reload also exercises the persistence layer
//     before we discard.

import { test, expect, Page } from '@playwright/test';

const PW = 'test-password-do-not-use';
const BUNDLED_PAGE = '/www/bundled-test.html';
const CANONICAL_URL = 'https://example.com';
const NEW_URL = 'https://changed.example.com';

async function clearVaultStorage(page: Page) {
  await page.goto(BUNDLED_PAGE);
  await page.evaluate(() => {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith('web-kdbx:')) localStorage.removeItem(key);
    }
  });
}

async function unlockAndOpenEntry(page: Page) {
  await page.locator('input[type="password"]').fill(PW);
  await page.locator('#unlock').click();
  await expect(page.locator('vault-tree')).toBeVisible();
  await page.locator('vault-tree [data-uuid]').first().click();
  await page.locator('vault-list [data-uuid]').first().click();
  await expect(page.locator('vault-detail')).toContainText('Test Entry');
}

test.describe('revert flow (Mode 1, Discard Local Changes restores canonical)', () => {
  test('edit, discard, observe canonical state restored after reload', async ({
    page,
  }) => {
    await clearVaultStorage(page);
    await page.goto(BUNDLED_PAGE);
    await unlockAndOpenEntry(page);

    // Confirm starting state shows the canonical URL.
    await expect(page.locator('vault-detail')).toContainText(CANONICAL_URL);

    // Edit URL and save so a working copy is created in localStorage.
    await page.locator('vault-detail button.edit-entry-btn').click();
    await page
      .locator('vault-entry-edit label:has-text("URL") + input')
      .fill(NEW_URL);
    await page.locator('vault-entry-edit button:has-text("Save")').click();
    await expect(page.locator('vault-entry-edit')).toHaveCount(0);
    await expect(page.locator('vault-detail')).toContainText(NEW_URL);

    // Reload first so the revert button mounts with hasWorkingCopy=true.
    // After re-unlock, confirm the edit survived (sanity check on the
    // persistence side) before we discard it.
    await page.reload();
    await unlockAndOpenEntry(page);
    await expect(page.locator('vault-detail')).toContainText(NEW_URL);

    // Pre-register the confirm-dialog handler before clicking Discard.
    // location.reload() fires inside _onRevert after the confirm returns
    // true, so we don't need a separate post-click navigation wait other
    // than the unlock-card visibility check below.
    page.once('dialog', (dialog) => {
      void dialog.accept();
    });
    await page.locator('vault-revert-button button').click();

    // After reload, the unlocker reappears (working copy was cleared, so
    // storage.js falls back to bundled bytes). Re-unlock and verify the
    // canonical URL is back.
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await unlockAndOpenEntry(page);
    await expect(page.locator('vault-detail')).toContainText(CANONICAL_URL);
    await expect(page.locator('vault-detail')).not.toContainText(NEW_URL);
  });
});
