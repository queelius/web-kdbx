// bundled-flow.spec.ts
//
// Layer 3 e2e tests for Mode 1 (bundled vault): a page that has
// `<vault-app vault-url="...">` should auto-fetch the vault bytes and
// present a password-only prompt. This spec verifies the full flow:
//   1. Page auto-loads the fixture (no file picker shown).
//   2. Typing the password and clicking Unlock reveals the three-pane view.
//   3. A wrong password shows an error and keeps the pane hidden.
//
// The test page is `www/bundled-test.html`; it references
// `www/fixtures-bundled-test.kdbx` (add_entry/after.kdbx, one entry).
// Both are served by the existing python webServer on port 8000.

import { test, expect } from '@playwright/test';

const PW = 'test-password-do-not-use';
const BUNDLED_PAGE = '/www/bundled-test.html';

test.describe('bundled vault flow', () => {
  test('auto-loads bytes and shows password-only prompt (no file picker)', async ({ page }) => {
    await page.goto(BUNDLED_PAGE);

    // The file-picker dropzone must NOT be present — bytes are pre-loaded.
    await expect(page.locator('#dropzone')).not.toBeVisible();
    await expect(page.locator('input[type="file"]')).not.toBeVisible();

    // The password input and Unlock button ARE present.
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('#unlock')).toBeVisible();
  });

  test('correct password unlocks and reveals three-pane view', async ({ page }) => {
    await page.goto(BUNDLED_PAGE);

    // Wait for the opener to appear (loading indicator goes away).
    await expect(page.locator('input[type="password"]')).toBeVisible();

    await page.locator('input[type="password"]').fill(PW);
    await page.locator('#unlock').click();

    await expect(page.locator('vault-tree')).toBeVisible();
    await expect(page.locator('vault-list')).toBeVisible();
    await expect(page.locator('vault-detail')).toBeVisible();
  });

  test('wrong password shows error and keeps three-pane view hidden', async ({ page }) => {
    await page.goto(BUNDLED_PAGE);

    await expect(page.locator('input[type="password"]')).toBeVisible();
    await page.locator('input[type="password"]').fill('definitely-wrong');
    await page.locator('#unlock').click();

    await expect(page.locator('#error')).toContainText(/Wrong password or corrupt file/i);
    await expect(page.locator('vault-tree')).not.toBeVisible();
  });

  test('heading reads "Unlock vault" not "Open a vault" in bundled mode', async ({ page }) => {
    await page.goto(BUNDLED_PAGE);

    // The opener title changes based on mode.
    await expect(page.locator('h2')).toContainText('Unlock vault');
  });
});
