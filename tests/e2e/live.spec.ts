import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { buildDir, urlFor } from './fixtures';

test.describe.configure({ mode: 'serial' });

test('a note written while the cockpit is open appears without reloading', async ({ page }) => {
  await page.goto(urlFor('watch', '#/documents/notes'));
  await expect(page.locator('.dlist a')).toHaveCount(1);
  writeFileSync(join(buildDir('watch'), 'notes', 'fresh-note.md'), '# Fresh note\n\nWritten while the cockpit was open.\n');
  await expect(page.locator('.dlist a')).toHaveCount(2, { timeout: 10_000 });
});

test('a gate the agent opens turns the rail red without reloading', async ({ page }) => {
  await page.goto(urlFor('watch', '#/logs'));
  const gate = page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /^Gate/ }).locator('.cnt');
  await expect(gate).toHaveText('3');
  const request = { name: 'late-review', type: 'approve', title: 'Late review', why: 'Approve or send back.', opened: '2026-10-02T21:00:00Z' };
  writeFileSync(join(buildDir('watch'), 'gates', 'late-review.json'), JSON.stringify(request));
  await expect(gate).toHaveText('4', { timeout: 10_000 });
});

test('the document on an approve gate reloads when the agent edits it', async ({ page }) => {
  await page.goto(urlFor('watch', '#/gate/spec-review'));
  await expect(page.locator('.reader h1')).toHaveText('Relay rebuild: design');
  writeFileSync(join(buildDir('watch'), 'documents', 'specs', 'relay-rebuild-spec.md'), '# Relay rebuild: revised design\n\nRewritten while the gate was open.\n');
  await expect(page.locator('.reader h1')).toHaveText('Relay rebuild: revised design', { timeout: 10_000 });
});

test('a failed refresh keeps the last state and what was typed, and says so plainly', async ({ page }) => {
  await page.goto(urlFor('watch', '#/gate/spec-review'));
  await expect(page.locator('.reader h1')).toBeVisible();
  const note = page.getByLabel('Note to the agent (optional)');
  await note.fill('Still here.');
  await page.route(/\/api\/builds\/relay-rebuild$/, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Disk read failed' }) }));
  writeFileSync(join(buildDir('watch'), 'notes', 'another-note.md'), '# Another note\n');
  await expect(page.locator('p.offline')).toContainText('Could not refresh the build: the server answered “Disk read failed”', { timeout: 10_000 });
  await expect(page.getByText('Lost the connection')).toHaveCount(0);
  await expect(note).toHaveValue('Still here.');
});
