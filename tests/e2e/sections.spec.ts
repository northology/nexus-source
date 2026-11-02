import { expect, test } from '@playwright/test';
import { urlFor } from './fixtures';

test('shows the open concept round in Proposed, in sandboxed frames and with no new tab', async ({ page }) => {
  await page.goto(urlFor('visual', '#/concepts'));
  await expect(page.getByRole('tab', { name: /^Proposed/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { level: 2, name: 'Pick a direction for the status page' })).toBeVisible();
  await expect(page.locator('.cround iframe.cframe')).toHaveAttribute('title', 'Quiet board');
  // One round: no list of rounds above it. The example's options have no source, so no tag.
  await expect(page.getByRole('navigation', { name: 'Rounds waiting for you' })).toHaveCount(0);
  await expect(page.locator('.cpanel .src')).toHaveCount(0);
  await expect(page.locator('.view iframe:not([sandbox="allow-scripts allow-same-origin"])')).toHaveCount(0);
  await expect(page.locator('.view a[target="_blank"]')).toHaveCount(0);
});

test('the plan section says when a phase has no approved plan, and points to plans in documents', async ({ page }) => {
  await page.goto(urlFor('visual', '#/plan'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Plan');
  await expect(page.getByText('No approved plan for replay yet')).toBeVisible();
  await page.getByRole('link', { name: 'Documents › Plans' }).click();
  await expect(page.getByRole('tab', { name: /Plans/ })).toHaveAttribute('aria-selected', 'true');
});
