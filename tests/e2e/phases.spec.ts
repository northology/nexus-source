import { expect, test } from '@playwright/test';
import { serveSnapshot, urlFor } from './fixtures';

test('the top bar shows the current phase', async ({ page }) => {
  await page.goto(urlFor('planning'));
  await expect(page.locator('.build-name .mono')).toContainText('phase dashboard · 2 of 2');
});

test('logs show the current phase until asked for all of them', async ({ page }) => {
  await page.goto(urlFor('planning', '#/logs/decisions'));
  await expect(page.locator('.erow').filter({ hasText: 'lag per source' })).toHaveCount(1);
  await expect(page.locator('.erow').filter({ hasText: 'Cap replays' })).toHaveCount(0);
  await page.getByLabel('Phase').selectOption('all');
  await expect(page).toHaveURL(/phase=all/);
  await expect(page.locator('.erow').filter({ hasText: 'Cap replays' })).toHaveCount(1);
  await page.getByRole('tab', { name: /Issues/ }).click();
  await expect(page).toHaveURL(/phase=all/);
});

test('documents follow the phase filter', async ({ page }) => {
  await page.goto(urlFor('planning', '#/documents/specs'));
  await expect(page.locator('.dlist')).toContainText('dashboard-spec.md');
  await page.getByLabel('Phase').selectOption('replay');
  await expect(page.locator('.dlist')).not.toContainText('dashboard-spec.md');
  await expect(page.locator('.dlist')).toContainText('relay-rebuild-spec.md');
});

test('a single-phase build shows no phase filter', async ({ page }) => {
  await page.goto(urlFor('visual', '#/logs/decisions'));
  await expect(page.getByLabel('Phase')).toHaveCount(0);
});

test('a document waiting on you shows under every phase', async ({ page }) => {
  await page.goto(urlFor('planning', '#/documents/specs'));
  const row = page.locator('.dli').filter({ hasText: 'replay-notes.md' });
  await expect(row).toHaveCount(1);
  await expect(row.getByText('Needs your review ›')).toBeVisible();
  await expect(page.getByRole('tab', { name: /Specs/ }).locator('.c.needs')).toHaveCount(1);
});

test("selecting All phases lists every phase's documents", async ({ page }) => {
  await page.goto(urlFor('planning', '#/documents/specs'));
  await page.getByLabel('Phase').selectOption('replay');
  await expect(page.locator('.dlist')).not.toContainText('dashboard-spec.md');
  await page.getByLabel('Phase').selectOption('all');
  await expect(page).toHaveURL(/phase=all/);
  await expect(page.locator('.dlist')).toContainText('dashboard-spec.md');
  await expect(page.locator('.dlist')).toContainText('relay-rebuild-spec.md');
});

test('a log empty only under the phase filter says so and offers all phases', async ({ page }) => {
  await serveSnapshot(page, (s) => {
    for (const e of s.logs.issues) e.phase = 'replay';
  });
  await page.goto(urlFor('planning', '#/logs/issues'));
  await expect(page.getByText('Nothing for dashboard.')).toBeVisible();
  await expect(page.getByText('Nothing in the issues yet')).toHaveCount(0);
  await page.getByRole('link', { name: 'Show all phases' }).click();
  await expect(page).toHaveURL(/phase=all/);
  await expect(page.locator('.erow')).toHaveCount(1);
});

test('a log with nothing in any phase keeps its plain empty state', async ({ page }) => {
  await serveSnapshot(page, (s) => {
    s.logs.issues = [];
  });
  await page.goto(urlFor('planning', '#/logs/issues'));
  await expect(page.getByText('Nothing in the issues yet')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Show all phases' })).toHaveCount(0);
});

test('documents empty only under the phase filter say so and offer all phases', async ({ page }) => {
  await serveSnapshot(page, (s) => {
    s.files.documents.push({ path: 'documents/audits/replay/replay-audit.md', size: 10, modified: '2026-10-02T18:00:00Z' });
  });
  await page.goto(urlFor('planning', '#/documents/audits'));
  await expect(page.getByText('Nothing for dashboard.')).toBeVisible();
  await expect(page.getByText('Nothing in audits yet')).toHaveCount(0);
  await page.getByRole('link', { name: 'Show all phases' }).click();
  await expect(page).toHaveURL(/phase=all/);
  await expect(page.locator('.dlist')).toContainText('replay-audit.md');
});

test('documents with nothing in any phase keep their plain empty state', async ({ page }) => {
  await page.goto(urlFor('planning', '#/documents/audits'));
  await expect(page.getByText('Nothing in audits yet')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Show all phases' })).toHaveCount(0);
});

const PLANNED = [
  { name: 'replay', description: 'Replay events from the archive.' },
  { name: 'dashboard', description: 'A dashboard of replay lag per source.' },
  { name: 'archive-search', description: 'Search the archive by sender and time.' },
];

test('the Phases tab says how phases get there when the build has none', async ({ page }) => {
  await page.goto(urlFor('planning', '#/phases'));
  await expect(page.getByRole('heading', { name: 'Phases', level: 1 })).toBeVisible();
  await expect(page.locator('.empty')).toContainText('No phases planned yet');
  await expect(page.locator('.empty')).toContainText('.build/relay-rebuild/phases.json');
});

test('the Phases tab lists the planned phases, numbered by their place', async ({ page }) => {
  await serveSnapshot(page, (s) => {
    s.phases = PLANNED;
  });
  await page.goto(urlFor('planning', '#/phases'));
  const rows = page.locator('.phases-table tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveText(/^1\s*replay\s*Replay events from the archive\.$/);
  await expect(rows.nth(2)).toHaveText(/^3\s*archive-search\s*Search the archive by sender and time\.$/);
  await expect(page.getByRole('columnheader')).toHaveText(['Phase', 'Name', 'Description']);
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /Phases/ })).toContainText('3');
});

test('the Phases tab keeps the list and names a phase listed twice', async ({ page }) => {
  await serveSnapshot(page, (s) => {
    s.phases = [
      { name: 'replay', description: 'Replay the queue' },
      { name: 'replay', description: 'Replay it again' },
    ];
    s.problems.push({ file: 'phases.json', message: 'duplicate name "replay"' });
  });
  await page.goto(urlFor('planning', '#/phases'));
  await expect(page.locator('.phases-table tbody tr')).toHaveCount(2);
  await expect(page.getByText('phases.json could not be read')).toHaveCount(0);
  await expect(page.getByRole('note')).toContainText('duplicate name "replay"');
});

test('the Phases tab names a phases.json it could not read', async ({ page }) => {
  await serveSnapshot(page, (s) => {
    s.phases = null;
    s.problems.push({ file: 'phases.json', message: 'phases[0]: must have required property description' });
  });
  await page.goto(urlFor('planning', '#/phases'));
  await expect(page.locator('.empty')).toContainText('phases.json could not be read');
  await expect(page.locator('.empty')).toContainText('must have required property description');
});
