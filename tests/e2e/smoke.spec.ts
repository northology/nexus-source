import { expect, test } from '@playwright/test';
import { urlFor } from './fixtures';

test('the cockpit loads with its bundled fonts and makes no outside requests', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://127.0.0.1:')) outside.push(r.url());
  });
  await page.goto(urlFor('visual'));
  await expect(page).toHaveTitle('nexus');
  await expect(page.locator('.brand')).toHaveText('nexus');
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')));
  expect(loaded).toContain('Schibsted Grotesk');
  expect(outside).toEqual([]);
});

test('the page carries the server token', async ({ page }) => {
  await page.goto(urlFor('visual'));
  await expect(page.locator('meta[name="nexus-token"]')).toHaveAttribute('content', /^[0-9a-f]{32}$/);
});
