import { test, expect } from '@playwright/test';
import path from 'path';

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures');
const PW = 'test-password-do-not-use';

test.describe('open flow', () => {
  test('correct password reveals three-pane view', async ({ page }) => {
    await page.goto('/');
    await page.locator('input[type="file"]').setInputFiles(
      path.join(FIXTURE_DIR, 'add_entry/after.kdbx')
    );
    await page.locator('input[type="password"]').fill(PW);
    await page.locator('#unlock').click();

    await expect(page.locator('vault-tree')).toBeVisible();
    await expect(page.locator('vault-list')).toBeVisible();
  });

  test('wrong password shows conflated error', async ({ page }) => {
    await page.goto('/');
    await page.locator('input[type="file"]').setInputFiles(
      path.join(FIXTURE_DIR, 'add_entry/after.kdbx')
    );
    await page.locator('input[type="password"]').fill('definitely-wrong');
    await page.locator('#unlock').click();

    await expect(page.locator('#error')).toContainText(
      /Wrong password or corrupt file/i
    );
    await expect(page.locator('vault-tree')).not.toBeVisible();
  });

  test('non-kdbx file shows file-type error on drop', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const dropzone = document.querySelector('#dropzone');
      const dataTransfer = new DataTransfer();
      const file = new File(['not kdbx'], 'notes.txt', { type: 'text/plain' });
      dataTransfer.items.add(file);
      const event = new DragEvent('drop', { dataTransfer, bubbles: true });
      dropzone!.dispatchEvent(event);
    });
    await expect(page.locator('#error')).toContainText(
      /Please drop a .kdbx file/i
    );
  });
});
