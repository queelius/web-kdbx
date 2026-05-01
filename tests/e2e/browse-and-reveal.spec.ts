import { test, expect } from '@playwright/test';
import path from 'path';

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures');
const PW = 'test-password-do-not-use';

async function unlock(page, fixture: string) {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(
    path.join(FIXTURE_DIR, fixture)
  );
  await page.locator('input[type="password"]').fill(PW);
  await page.locator('#unlock').click();
  await expect(page.locator('vault-tree')).toBeVisible();
}

test('clicking a group shows entries', async ({ page }) => {
  await unlock(page, 'add_entry/after.kdbx');
  await page.locator('vault-tree [data-uuid]').first().click();
  await expect(page.locator('vault-list li')).toHaveCount(1);
  await expect(page.locator('vault-list')).toContainText('Chase');
});

test('clicking an entry shows detail with masked Password', async ({ page }) => {
  await unlock(page, 'add_entry/after.kdbx');
  await page.locator('vault-tree [data-uuid]').first().click();
  await page.locator('vault-list [data-uuid]').first().click();
  await expect(page.locator('vault-detail')).toContainText('Title');
  await expect(page.locator('vault-detail')).toContainText('UserName');
  await expect(page.locator('vault-detail')).toContainText('Password');
  await expect(page.locator('vault-detail')).toContainText('[hidden,');
});

test('reveal-button shows plaintext for the chosen field only', async ({ page }) => {
  await unlock(page, 'add_entry/after.kdbx');
  await page.locator('vault-tree [data-uuid]').first().click();
  await page.locator('vault-list [data-uuid]').first().click();
  await page.locator('button[data-reveal="Password"]').click();
  await expect(page.locator('vault-detail')).toContainText('hunter2');
});

test('console.log is not a side channel for plaintext', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (msg) => logs.push(msg.text()));
  await unlock(page, 'add_entry/after.kdbx');
  await page.locator('vault-tree [data-uuid]').first().click();
  await page.locator('vault-list [data-uuid]').first().click();
  await page.locator('button[data-reveal="Password"]').click();
  expect(logs.some((l) => l.includes('hunter2'))).toBe(false);
});

test('search across visible fields finds matching entries', async ({ page }) => {
  await unlock(page, 'add_entry/after.kdbx');
  await page.locator('vault-search input').fill('Chase');
  await page.waitForTimeout(200);
  await expect(page.locator('vault-list')).toContainText('Chase');
});
