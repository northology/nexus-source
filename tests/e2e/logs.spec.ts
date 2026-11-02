import { expect, test } from '@playwright/test';
import { urlFor } from './fixtures';

test('the decision log shows accepted entries and hides declined ones until asked', async ({ page }) => {
  await page.goto(urlFor('visual', '#/logs'));
  await expect(page.getByRole('tab', { name: /Decision log/ })).toHaveAttribute('aria-selected', 'true');
  const rows = page.locator('.erow');
  await expect(rows).toHaveCount(2);
  await expect(page.getByText('1 hidden (declined)')).toBeVisible();
  await page.getByRole('button', { name: /^declined/ }).click();
  await expect(rows).toHaveCount(3);
  await expect(page).toHaveURL(/show=accepted,declined/);
  await page.reload();
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(2)).toHaveClass(/struck/);
});

test('shows times in the display zone', async ({ page }) => {
  await page.goto(urlFor('visual', '#/logs/decisions'));
  await expect(page.locator('.erow').first().locator('time')).toHaveText('Oct 2 11:55');
});

test('searches within a log and keeps the search in the URL', async ({ page }) => {
  await page.goto(urlFor('visual', '#/logs/decisions'));
  await page.getByRole('searchbox', { name: 'Search the decision log' }).fill('retry');
  await expect(page.locator('.erow')).toHaveCount(1);
  await expect(page.locator('.matches')).toHaveText('1 of 3');
  await expect(page).toHaveURL(/q=retry/);
});

test('opens the documented deep link', async ({ page }) => {
  await page.goto(urlFor('visual', '#/logs/issues?show=open,addressed&q=replay'));
  await expect(page.getByRole('tab', { name: /Issues/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.erow')).toHaveCount(1);
  await expect(page.locator('.erow')).toContainText('Replaying a range skips the last message');
});

test('copies the current view', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(urlFor('visual', '#/logs/questions'));
  await page.getByRole('button', { name: 'Copy this view' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
});

test('one unreadable log does not hide the others', async ({ page }) => {
  await page.goto(urlFor('broken', '#/logs/issues'));
  await expect(page.getByText('logs/issues.json could not be read')).toBeVisible();
  await page.getByRole('tab', { name: /Decision log/ }).click();
  await expect(page.locator('.erow')).toHaveCount(2);
});
