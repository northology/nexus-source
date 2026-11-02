import { expect, test, type Page } from '@playwright/test';
import { urlFor } from './fixtures';

const tab = (page: Page, name: string) => page.getByRole('tablist', { name: 'Gates' }).getByRole('tab', { name: new RegExp(`^${name} `) });
const list = (page: Page) => page.getByRole('list', { name: 'Gates in this tab' });

test('files each gate under its step, counted for the current phase', async ({ page }) => {
  await page.goto(urlFor('gates'));
  const counts: Record<string, string> = { Guardrails: '1', Scope: '1', Spec: '0', Plan: '1', Finish: '0', Permits: '0' };
  for (const [name, n] of Object.entries(counts)) await expect(tab(page, name).locator('.c')).toHaveText(n);
  await expect(tab(page, 'Scope').locator('.c')).toHaveClass(/needs/);
  await expect(tab(page, 'Spec').locator('.c')).not.toHaveClass(/needs/);
  // Under every phase the count holds whatever other specs answered: three gates with no phase and three copy gates.
  await page.goto(urlFor('gates', '#/gate?phase=all'));
  await expect(tab(page, 'Other').locator('.c')).toHaveText('6');
});

test('a tab counts its open gate from another phase, never a red zero', async ({ page }) => {
  await page.goto(urlFor('gates'));
  const plan = tab(page, 'Plan').locator('.c');
  await expect(plan).toHaveText('1');
  await expect(plan).toHaveClass(/needs/);
});

test('opens on the open gate whatever the phase filter', async ({ page }) => {
  await page.goto(urlFor('gates', '#/gate?phase=replay'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Confirm the dashboard scope');
  await expect(tab(page, 'Scope')).toHaveAttribute('aria-selected', 'true');
  await expect(list(page).getByRole('button')).toHaveCount(2);
  // The open gate is from the dashboard phase, so under the replay filter its row names its phase.
  await expect(list(page).locator('.gl-phase')).toHaveText(['dashboard', 'replay']);
});

test('a tab with one gate shows it without a list', async ({ page }) => {
  await page.goto(urlFor('gates'));
  await tab(page, 'Guardrails').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Confirm the dashboard guardrails');
  await expect(list(page)).toHaveCount(0);
});

test('lists a tab with several gates above the one shown', async ({ page }) => {
  await page.goto(urlFor('gates', '#/gate?phase=all'));
  await tab(page, 'Other').click();
  await expect(list(page).getByRole('button')).toHaveCount(6);
  await list(page).getByRole('button', { name: /Review the relay rebuild spec/ }).click();
  await expect(page.locator('#gate-title')).toHaveText('Review the relay rebuild spec');
  await expect(list(page).getByRole('button', { name: /Review the relay rebuild spec/ })).toHaveAttribute('aria-current', 'true');
});

test('All phases shows every phase, with the phase on each row', async ({ page }) => {
  await page.goto(urlFor('gates'));
  await page.getByLabel('Phase').selectOption('all');
  await expect(page).toHaveURL(/phase=all/);
  await expect(tab(page, 'Guardrails').locator('.c')).toHaveText('2');
  await tab(page, 'Guardrails').click();
  await expect(list(page).getByRole('button')).toHaveCount(2);
  await expect(list(page).locator('.gl-phase')).toHaveText(['dashboard', 'replay']);
});

test('a gate with no phase shows a dash in the phase column', async ({ page }) => {
  await page.goto(urlFor('gates', '#/gate?tab=other&phase=all'));
  const noPhase = list(page).getByRole('button', { name: /Review the relay rebuild spec/ });
  await expect(noPhase.getByLabel('no phase')).toHaveText('—');
  await expect(list(page).getByLabel('no phase')).toHaveCount(3);
});

test('an empty tab says so and offers every phase', async ({ page }) => {
  await page.goto(urlFor('gates'));
  await tab(page, 'Finish').click();
  await expect(page).toHaveURL(/tab=finish/);
  await expect(page.getByText('No finish gate in dashboard')).toBeVisible();
  await page.getByRole('link', { name: 'Show all phases' }).click();
  await expect(page.getByText('No finish gates yet')).toBeVisible();
});

test('a named tab shows its open gate from any phase, listed with its gates under the filter', async ({ page }) => {
  await page.goto(urlFor('gates', '#/gate?tab=guardrails&phase=replay'));
  await expect(page.locator('#gate-title')).toHaveText('Confirm the dashboard guardrails');
  await expect(page.getByText(/No guardrails gate/)).toHaveCount(0);
  await expect(list(page).getByRole('button')).toHaveCount(2);
  await list(page).getByRole('button', { name: /Confirm the replay guardrails/ }).click();
  await expect(page.locator('#gate-title')).toHaveText('Confirm the replay guardrails');
  await page.getByLabel('Phase').selectOption('all');
  await expect(list(page).getByRole('button')).toHaveCount(2);
  await expect(page.getByText(/No guardrails gate/)).toHaveCount(0);
});

test('a named tab whose gates are all answered opens on the first of them', async ({ page }) => {
  await page.goto(urlFor('gates', '#/gate?tab=spec&phase=replay'));
  await expect(page.locator('#gate-title')).toHaveText('Approve the replay spec');
  await expect(page.getByText(/No spec gate/)).toHaveCount(0);
});
