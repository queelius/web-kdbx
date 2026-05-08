// add-entry-flow.spec.ts
//
// L1 Layer 3 e2e: Mode 1 add-entry + persistence.
//
// Flow per test:
//   1. Load the bundled-vault page (Mode 1) with a fresh localStorage.
//   2. Unlock with the fixture password.
//   3. Select the Root group (so the Add Entry button renders; it's hidden
//      until a target group is chosen).
//   4. Click Add Entry, fill Title and UserName, click Save.
//   5. Confirm the new entry appears in the list pane.
//   6. Reload the page, re-unlock, observe the entry still present.
//
// Setup notes:
//   - The bundled fixture starts with one entry titled "Test Entry" under
//     Root. The new entry is asserted by title text in the list pane,
//     which is robust against UUID variation across test runs.

import { test, expect, Page } from '@playwright/test';

const PW = 'test-password-do-not-use';
const BUNDLED_PAGE = '/www/bundled-test.html';
const NEW_TITLE = 'My Bank';
const NEW_USERNAME = 'bob@example.com';

async function clearVaultStorage(page: Page) {
  await page.goto(BUNDLED_PAGE);
  await page.evaluate(() => {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith('web-kdbx:')) localStorage.removeItem(key);
    }
  });
}

async function unlockAndSelectRoot(page: Page) {
  await page.locator('input[type="password"]').fill(PW);
  await page.locator('#unlock').click();
  await expect(page.locator('vault-tree')).toBeVisible();
  // Click the root group to set selectedGroupUuid; Add Entry button only
  // renders once a group is selected.
  await page.locator('vault-tree [data-uuid]').first().click();
}

test.describe('add-entry flow (Mode 1, persisted via localStorage)', () => {
  test('add entry, observe in list, reload, observe still present', async ({
    page,
  }) => {
    await clearVaultStorage(page);
    await page.goto(BUNDLED_PAGE);
    await unlockAndSelectRoot(page);

    // The Add Entry button appears at the top of the list pane.
    await page.locator('vault-list button.add-entry-btn').click();
    await expect(page.locator('vault-add-entry')).toBeVisible();

    // Fill Title (required) and UserName. Labels have for attributes
    // tied to vault-add-field-N inputs; reach the input via the
    // label-then-sibling selector to avoid hardcoded indices.
    await page
      .locator('vault-add-entry label:has-text("Title") + input')
      .fill(NEW_TITLE);
    await page
      .locator('vault-add-entry label:has-text("UserName") + input')
      .fill(NEW_USERNAME);

    // Save. First button in the add form's button bar is Save.
    await page.locator('vault-add-entry button:has-text("Save")').click();

    // The list pane returns to read mode and now shows the new entry
    // alongside the original Chase entry.
    await expect(page.locator('vault-add-entry')).toHaveCount(0);
    await expect(page.locator('vault-list')).toContainText(NEW_TITLE);

    // Reload, re-unlock, re-select Root. The persisted working copy
    // should include the freshly-added entry.
    await page.reload();
    await unlockAndSelectRoot(page);

    await expect(page.locator('vault-list')).toContainText(NEW_TITLE);
    await expect(page.locator('vault-list')).toContainText('Test Entry');
  });
});
