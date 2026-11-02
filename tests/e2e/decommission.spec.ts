import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { buildDir, urlFor } from './fixtures';

test.describe.configure({ mode: 'serial' });
const answersFile = () => join(buildDir('finished'), 'gates', 'decommission-relay-rebuild.answers.json');
test.afterEach(() => rmSync(answersFile(), { force: true }));

const tab = (page: Page, name: string) => page.getByRole('tablist', { name: 'Gates' }).getByRole('tab', { name: new RegExp(`^${name} `) });
const GATE = '#/gate/decommission-relay-rebuild';

test("a finished build's decommission gate shows under its own tab, with the final report above the rows", async ({ page }) => {
  await page.goto(urlFor('finished', GATE));
  // The gate's own heading; the report below it brings a heading of its own, as an approve gate's document does.
  await expect(page.locator('#gate-title')).toHaveText('Decommission relay-rebuild');
  await expect(tab(page, 'Decommission')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, 'Decommission').locator('.c')).toHaveText('1');
  await expect(tab(page, 'Decommission').locator('.c')).toHaveClass(/needs/);
  const doc = page.locator('.gate-doc');
  await expect(doc.locator('.md h1')).toHaveText('relay-rebuild final report');
  await expect(doc).toContainText('replays capped and paused per source');
  // The document sits above the rows.
  const docBox = await doc.boundingBox();
  const rowsBox = await page.locator('ol.rows').boundingBox();
  expect(docBox && rowsBox && docBox.y < rowsBox.y).toBe(true);
  await expect(page.locator('li.row')).toHaveCount(2);
});

test('the count of rows to mark stays above the report, so a long report never hides that there is something to mark', async ({ page }) => {
  await page.goto(urlFor('finished', GATE));
  const doc = page.locator('.gate-doc');
  await expect(doc.locator('.md h1')).toBeVisible();
  const figure = page.locator('.gate .head .figure');
  await expect(figure).toHaveText('2');
  await expect(page.locator('.gate .head .figcap')).toContainText('2 rows awaiting your mark');
  const figureBox = await figure.boundingBox();
  const docBox = await doc.boundingBox();
  expect(figureBox && docBox && figureBox.y + figureBox.height <= docBox.y).toBe(true);
});

test('the draft report is read through the build file route, sandboxed, and renders as a document does', async ({ page }) => {
  const seen: { url: string; csp: string | null }[] = [];
  page.on('response', (res) => {
    if (res.url().includes('/files/documents/reports/')) seen.push({ url: res.url(), csp: res.headers()['content-security-policy'] ?? null });
  });
  await page.goto(urlFor('finished', GATE));
  const doc = page.locator('.gate-doc');
  await expect(doc.locator('.md h1')).toBeVisible();
  expect(seen).toHaveLength(1);
  expect(decodeURIComponent(new URL(seen[0]?.url ?? '').pathname)).toBe('/api/builds/relay-rebuild/files/documents/reports/relay-rebuild final report.md');
  expect(seen[0]?.csp).toContain('sandbox');
  // The same reader as an approve gate's document: its path line, and inline code as code, not as markup.
  await expect(doc.locator('.reader > .path')).toContainText('documents/reports/relay-rebuild final report.md');
  await expect(doc.locator('.md code')).toHaveText('governance/rules/replay-cap.md');
});

test('the Decommission tab shows only in a build that has a decommission gate', async ({ page }) => {
  await page.goto(urlFor('gates'));
  await expect(tab(page, 'Finish')).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Gates' }).getByRole('tab', { name: /^Decommission/ })).toHaveCount(0);
});

test('marking every row submits the decommission gate once', async ({ page }) => {
  await page.goto(urlFor('finished', GATE));
  const rows = page.locator('li.row');
  await rows.nth(0).getByRole('button', { name: 'Accept' }).click();
  await rows.nth(1).getByRole('button', { name: 'Decline' }).click();
  // A declined guardrail just stays with the build, so its note doesn't open unasked.
  await expect(rows.nth(1).getByRole('textbox')).toHaveCount(0);
  await expect(rows.nth(1).getByRole('button', { name: /^Add note on/ })).toBeVisible();
  await page.getByRole('button', { name: 'Submit marks' }).click();
  await expect(page.locator('.outcome')).toContainText('The agent applies it on your next message.');
  expect(JSON.parse(readFileSync(answersFile(), 'utf8'))).toMatchObject({
    gate: 'decommission-relay-rebuild',
    marks: { 'replay-cap': 'accepted', 'pause-is-per-source': 'declined' },
  });
  // Once sent, the report still shows above the recorded marks, and there is nothing left to submit.
  await expect(page.locator('.gate-doc .md h1')).toHaveText('relay-rebuild final report');
  await expect(page.getByRole('button', { name: 'Submit marks' })).toHaveCount(0);
});
