// download-flow.spec.ts
//
// L1 Layer 3 e2e: Mode 1 download after edit.
//
// Flow:
//   1. Load the bundled-vault page (Mode 1) with a fresh localStorage.
//   2. Unlock and edit the URL on the only entry.
//   3. Click Download Vault. Capture the resulting download via
//      page.waitForEvent('download').
//   4. Verify suggested filename ends in .kdbx and bytes are within a
//      sane size band (greater than 100, less than 10MB).
//
// We intentionally don't re-parse the download as KDBX in this spec.
// That belongs in the Layer 2 wasm-bindgen tests where the parser is in
// the test harness's hands. Verifying filename + size is the contract
// the button itself owns: it produced a Blob from currentBytes() with
// the right type and the right name.

import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

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
  await page.locator('vault-tree [data-uuid]').first().click();
  await page.locator('vault-list [data-uuid]').first().click();
  await expect(page.locator('vault-detail')).toContainText('Test Entry');
}

test.describe('download flow (Mode 1, post-edit export)', () => {
  test('edit a field, click Download, verify filename and size', async ({
    page,
  }) => {
    await clearVaultStorage(page);
    await page.goto(BUNDLED_PAGE);
    await unlockAndOpenEntry(page);

    // Edit the URL so the download captures more than the canonical bytes.
    await page.locator('vault-detail button.edit-entry-btn').click();
    await page
      .locator('vault-entry-edit label:has-text("URL") + input')
      .fill(NEW_URL);
    await page.locator('vault-entry-edit button:has-text("Save")').click();
    await expect(page.locator('vault-entry-edit')).toHaveCount(0);

    // Set up the download listener BEFORE clicking. Playwright registers
    // the listener and resolves the promise on the next download event.
    const downloadPromise = page.waitForEvent('download');
    await page.locator('vault-download-button button').click();
    const download = await downloadPromise;

    // Filename: the bundled vault-url is fixtures-bundled-test.kdbx, so
    // suggestedFilename() sanitizes to fixtures-bundled-test.kdbx. We only
    // pin the extension; the prefix is implementation-coupled.
    expect(download.suggestedFilename()).toMatch(/\.kdbx$/);

    // Size sanity: the bundled fixture is around 1.1KB. A download under
    // 100 bytes likely means a header-only or empty file; over 10MB means
    // something other than the working copy got serialized.
    const path = await download.path();
    expect(path).toBeTruthy();
    const stat = fs.statSync(path);
    expect(stat.size).toBeGreaterThan(100);
    expect(stat.size).toBeLessThan(10_000_000);
  });
});
