// edit-flow.spec.ts
//
// L1 Layer 3 e2e: Mode 1 edit + persistence.
//
// Flow per test:
//   1. Load the bundled-vault page (Mode 1) with a fresh localStorage.
//   2. Unlock with the fixture password.
//   3. Open the only entry and click Edit.
//   4. Change the URL field (plain, non-protected, safe to read back without
//      a Reveal click).
//   5. Click Save and confirm the new value appears in the read view.
//   6. Reload the page. The bundled URL is the same, so storage.js should
//      restore the working copy from localStorage rather than re-fetching
//      the canonical bytes.
//   7. Re-unlock and confirm the edit survived the reload.
//
// Setup notes:
//   - Each test starts with an isolated browser context (Playwright default),
//     so the localStorage clear in beforeEach is belt-and-suspenders for the
//     case where the same context is reused across reload boundaries within
//     a single test.
//   - The bundled fixture is www/fixtures-bundled-test.kdbx, a single-entry
//     KDBX 4 file. The entry's title is "Test Entry"; the spec asserts that
//     title to confirm the right entry loaded, then mutates URL.

import { test, expect, Page } from '@playwright/test';

const PW = 'test-password-do-not-use';
const BUNDLED_PAGE = '/www/bundled-test.html';
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
  // Bundled vault has a single Root group with one entry. Click the group
  // to populate the list pane, then click the entry to load detail.
  await page.locator('vault-tree [data-uuid]').first().click();
  await page.locator('vault-list [data-uuid]').first().click();
  await expect(page.locator('vault-detail')).toContainText('Test Entry');
}

test.describe('edit flow (Mode 1, persisted via localStorage)', () => {
  test('edit URL, save, observe in read view, reload, observe persisted', async ({
    page,
  }) => {
    await clearVaultStorage(page);
    await page.goto(BUNDLED_PAGE);
    await unlockAndOpenEntry(page);

    // Enter edit mode via the Edit button in the detail header.
    await page.locator('vault-detail button.edit-entry-btn').click();
    await expect(page.locator('vault-entry-edit')).toBeVisible();

    // The URL row carries label "URL" and an <input> sibling. The label has
    // a stable for attribute (vault-edit-field-N); we target the input via
    // the label association rather than guessing the index.
    const urlInput = page.locator(
      'vault-entry-edit label:has-text("URL") + input'
    );
    await urlInput.fill(NEW_URL);

    // Save. The first button in the edit form's button bar is Save.
    await page.locator('vault-entry-edit button:has-text("Save")').click();

    // Read view returns and shows the new URL value (plain field, no Reveal).
    await expect(page.locator('vault-entry-edit')).toHaveCount(0);
    await expect(page.locator('vault-detail')).toContainText(NEW_URL);

    // Reload the page. With a working copy in localStorage, storage.js
    // should serve the edited bytes; the unlock card still appears, but
    // unlocking will reveal the persisted edit.
    await page.reload();
    await unlockAndOpenEntry(page);

    await expect(page.locator('vault-detail')).toContainText(NEW_URL);
  });
});
