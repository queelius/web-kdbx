import { test, expect } from '@playwright/test';
import path from 'path';

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures');
const PW = 'test-password-do-not-use';

test('lock returns to opener', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(
    path.join(FIXTURE_DIR, 'add_entry/after.kdbx')
  );
  await page.locator('input[type="password"]').fill(PW);
  await page.locator('#unlock').click();
  await expect(page.locator('vault-tree')).toBeVisible();

  await page.locator('vault-lock-button button').click();

  await expect(page.locator('vault-opener')).toBeVisible();
  await expect(page.locator('vault-tree')).not.toBeVisible();
});
