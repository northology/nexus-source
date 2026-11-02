import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { buildDir, serveSnapshot, urlFor } from './fixtures';

const note = (name: string, text: string) => {
  const file = join(buildDir('live'), 'notes', name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};

test('renders a spec with its table, task list and diagram', async ({ page }) => {
  await page.goto(urlFor('live', '#/documents/specs'));
  await expect(page.getByRole('tab', { name: /Specs/ })).toHaveAttribute('aria-selected', 'true');
  const reader = page.locator('.reader');
  await expect(reader.locator('h1')).toHaveText('Relay rebuild: design');
  await expect(reader.getByRole('cell', { name: 'Replay queue store' }).first()).toBeVisible();
  await expect(reader.locator('input[type="checkbox"]')).toHaveCount(2);
  await expect(reader.locator('.md-mermaid svg')).toBeVisible();
  await expect(reader.locator('.md-mermaid g.needs')).toHaveCount(1);
});

test('links wikilinks that resolve, leaves the rest as text, and lists contents', async ({ page }) => {
  note('links.md', '# Links\n\n## First\n\nSee [[relay-rebuild-spec|the spec]] and [[missing-page]].\n\n## Second\n\n```\n[[relay-rebuild-spec]] stays code\n```\n');
  await page.goto(urlFor('live', '#/documents/notes?doc=notes/links.md'));
  const reader = page.locator('.reader');
  await expect(reader.getByRole('link', { name: 'the spec' })).toHaveAttribute('href', '#/documents/specs?doc=documents/specs/relay-rebuild-spec.md');
  await expect(reader.getByText('missing-page')).toBeVisible();
  await expect(reader.getByRole('link', { name: 'missing-page' })).toHaveCount(0);
  await expect(reader.locator('pre')).toContainText('[[relay-rebuild-spec]] stays code');
  await expect(page.getByRole('navigation', { name: 'Contents' }).getByRole('link')).toHaveText(['First', 'Second']);
  await reader.getByRole('link', { name: 'the spec' }).click();
  await expect(page.locator('.reader h1')).toHaveText('Relay rebuild: design');
});

test('shows a broken diagram as an error and keeps the rest of the document', async ({ page }) => {
  note('bad-diagram.md', '# Bad diagram\n\n```mermaid\nflowchart LR\n  a --> (((\n```\n\nText after the diagram.\n');
  await page.goto(urlFor('live', '#/documents/notes?doc=notes/bad-diagram.md'));
  await expect(page.getByText('This diagram could not be drawn.')).toBeVisible();
  await expect(page.locator('.md-mermaid-error')).toContainText('a --> (((');
  await expect(page.getByText('Text after the diagram.')).toBeVisible();
});

test('survives a malformed escape in an in-document link', async ({ page }) => {
  note('bad-escape.md', '# Bad escape\n\n[bad](#%E0%A4%A)\n\n## Real\n\nText after the link.\n');
  await page.goto(urlFor('live', '#/documents/notes?doc=notes/bad-escape.md'));
  await expect(page.locator('.reader h1')).toHaveText('Bad escape');
  await expect(page.getByText('Text after the link.')).toBeVisible();
});

test('shows an empty sub-page plainly', async ({ page }) => {
  await page.goto(urlFor('live', '#/documents/audits'));
  await expect(page.getByText('Nothing in audits yet')).toBeVisible();
});

test('marks the document waiting on an open gate', async ({ page }) => {
  await page.goto(urlFor('visual', '#/documents/specs'));
  await expect(page.locator('.dlist')).toContainText(/needs your review/i);
  await expect(page.getByRole('tab', { name: /Specs/ }).locator('.c')).toHaveClass(/needs/);
});

test('says so when the requested document is not in the build', async ({ page }) => {
  await page.goto(urlFor('live', '#/documents/notes?doc=notes/does-not-exist.md'));
  await expect(page.getByText('This file is missing from the build')).toBeVisible();
  await expect(page.locator('.reader .path')).toContainText('notes/does-not-exist.md');
});

test('shows raw HTML as inert text and refuses links that leave the build', async ({ page }) => {
  note('hostile.md', '# Hostile\n\nBefore <b>raw</b> after <img src=x onerror="window.__xss=1">\n\n[out](../../../secret.md)\n');
  await page.goto(urlFor('live', '#/documents/notes?doc=notes/hostile.md'));
  const reader = page.locator('.reader');
  await expect(reader.locator('h1')).toHaveText('Hostile');
  await expect(reader.locator('b', { hasText: 'raw' })).toHaveCount(0);
  await expect(reader.locator('img[src="x"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  await expect(reader.locator('span.dead-link')).toHaveText('out');
  await expect(reader.getByRole('link', { name: 'out' })).toHaveCount(0);
});

test('jumps to a heading from an in-document link without leaving the document', async ({ page }) => {
  note('anchors.md', '# Anchors\n\n[jump](#target)\n\n## First\n\n' + 'Filler paragraph.\n\n'.repeat(60) + '## Target\n\nEnd.\n');
  await page.goto(urlFor('live', '#/documents/notes?doc=notes/anchors.md'));
  const before = page.url();
  await page.locator('.reader').getByRole('link', { name: 'jump' }).click();
  expect(page.url()).toBe(before);
  await expect(page.locator('.reader h1')).toHaveText('Anchors');
  await expect(page.locator('#target')).toBeInViewport();
});

test('keeps task-list text flowing inline', async ({ page }) => {
  note('tasks.md', '# Tasks\n\n- [ ] do **this** and `that` today\n- [x] done\n');
  await page.goto(urlFor('live', '#/documents/notes?doc=notes/tasks.md'));
  const item = page.locator('.reader li.task-list-item').first();
  await expect(item).toBeVisible();
  expect(await item.evaluate((el) => getComputedStyle(el).display)).not.toBe('flex');
});

test('counts only the documents waiting on a gate, and leads from them to the gate', async ({ page }) => {
  await page.goto(urlFor('visual', '#/documents/specs'));
  await expect(page.getByRole('tab', { name: /Specs/ }).locator('.c')).toHaveText('1');
  await expect(page.getByRole('link', { name: /needs your review/i })).toHaveAttribute('href', '#/gate/spec-review');
  await page.locator('.reader .path').getByRole('link', { name: /Review in gate/ }).click();
  await expect(page).toHaveURL(/#\/gate\/spec-review/);
  await expect(page.getByRole('heading', { name: 'Review the relay rebuild spec' })).toBeVisible();
});

test('shows a CSV and JSON as tables, other JSON as code, and images as a gallery', async ({ page }) => {
  note('results.csv', 'source,lag\nnorth,4.2\nsouth,6.1\n');
  note('rows.json', '[{"source":"north","lag":4.2}]');
  note('settings.json', '{"cap":10000}');
  note('shot-1.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#3c5a78"/></svg>');
  await page.goto(urlFor('live', '#/documents/notes?doc=notes/results.csv'));
  await expect(page.locator('table.vtable tbody tr')).toHaveCount(2);
  // The same path line as a Markdown document, with the file's time.
  await expect(page.locator('.doc-file > .path')).toContainText('notes/results.csv');
  await expect(page.locator('.doc-file > .path [data-volatile]')).toHaveText(/\d{1,2}:\d{2}/);
  await page.goto(urlFor('live', '#/documents/notes?doc=notes/rows.json'));
  await expect(page.locator('table.vtable tbody tr')).toHaveCount(1);
  await page.goto(urlFor('live', '#/documents/notes?doc=notes/settings.json'));
  await expect(page.locator('.doc-file pre')).toContainText('"cap"');
  await page.goto(urlFor('live', '#/documents/notes?doc=notes/shot-1.svg'));
  await expect(page.locator('.gallery figure')).toHaveCount(1);
  await expect(page.locator('.gallery figure.selected')).toHaveCount(1);
});

test('lists a folder’s images as one gallery, counted once, opened at an image a link names', async ({ page }) => {
  const svg = (fill: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="${fill}"/></svg>`;
  note('shots/a.svg', svg('#3c5a78'));
  note('shots/b.svg', svg('#78553c'));
  note('shots/c.png', '');
  await page.goto(urlFor('live', '#/documents/notes'));
  const entry = page.locator('.dli').filter({ hasText: 'notes/shots/' });
  await expect(entry).toHaveCount(1);
  await expect(entry.locator('b')).toHaveText('notes/shots · 3 images');
  await expect(page.locator('.dli').filter({ hasText: 'shots/a.svg' })).toHaveCount(0);
  // The tab counts the gallery once, as one entry in its list.
  await expect(page.getByRole('tab', { name: /Notes/ }).locator('.c')).toHaveText(String(await page.locator('.dli').count()));
  await entry.getByRole('link').click();
  await expect(page.locator('.doc-file .gallery figure')).toHaveCount(3);
  await expect(page.locator('.gallery figure.selected')).toHaveCount(0);
  await expect(entry.getByRole('link')).toHaveAttribute('aria-current', 'true');
  await page.goto(urlFor('live', '#/documents/notes?doc=notes/shots/b.svg'));
  await expect(page.locator('.gallery figure')).toHaveCount(3);
  await expect(page.locator('.gallery figure.selected')).toHaveCount(1);
  await expect(page.locator('.gallery figure.selected figcaption')).toHaveText('b.svg');
  await expect(page.locator('.gallery figure.selected button')).toHaveAttribute('aria-current', 'true');
  await expect(entry.getByRole('link')).toHaveAttribute('aria-current', 'true');
});

test("the Notes count leaves out a .canvas file", async ({ page }) => {
  await serveSnapshot(page, (s) => {
    const f = (path: string) => ({ path, size: 10, modified: '2026-10-08T00:00:00Z' });
    s.files.notes = [f('notes/board.canvas'), f('notes/a.md')];
  });
  await page.goto(urlFor('live', '#/documents/notes'));
  await expect(page.getByRole('tab', { name: /Notes/ }).locator('.c')).toHaveText('1');
  await expect(page.locator('.dlist')).toContainText('notes/a.md');
  await expect(page.locator('.dlist')).not.toContainText('board.canvas');
});

test('names a table over 5 MB instead of fetching it', async ({ page }) => {
  note('huge.csv', 'a\n1\n');
  const big = Math.round(7.2 * 1024 * 1024);
  await serveSnapshot(page, (s) => {
    for (const f of s.files.notes) if (f.path === 'notes/huge.csv') f.size = big;
  });
  const asked: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/files/notes/huge.csv')) asked.push(r.url());
  });
  await page.goto(urlFor('live', '#/documents/notes?doc=notes/huge.csv'));
  await expect(page.locator('.doc-file')).toContainText("notes/huge.csv is 7.2 MB; files over 5 MB aren't shown here.");
  await expect(page.locator('table.vtable')).toHaveCount(0);
  expect(asked).toEqual([]);
});

test("names why a build file can't be shown, and never leaves the page blank", async ({ page }) => {
  note('board.canvas', '{ "nodes": [], "edges": [] }');
  note('ragged.csv', 'a,b\n1\n');
  note('plain.txt', 'just text');
  // JSON Canvas isn't drawn by the cockpit (decision canvas-is-retention-format): a .canvas is not listed or shown.
  await page.goto(urlFor('live', '#/documents/notes?doc=notes/board.canvas'));
  await expect(page.locator('.doc-file')).toContainText("The cockpit doesn't show this kind of file");
  await expect(page.locator('.dlist')).not.toContainText('board.canvas');
  await page.goto(urlFor('live', '#/documents/notes?doc=notes/ragged.csv'));
  await expect(page.locator('.doc-file')).toContainText("This file can't be shown");
  await page.goto(urlFor('live', '#/documents/notes?doc=notes/plain.txt'));
  await expect(page.locator('.doc-file')).toContainText("The cockpit doesn't show this kind of file");
  await expect(page.locator('.dlist')).not.toContainText('plain.txt');
  await page.goto(urlFor('live', '#/documents/notes?doc=notes/gone.png'));
  await expect(page.getByText('This file is missing from the build')).toBeVisible();
});

test('reads a build table again when it changes', async ({ page }) => {
  note('changing.csv', 'source,lag\nnorth,4.2\n');
  await page.goto(urlFor('live', '#/documents/notes?doc=notes/changing.csv'));
  await expect(page.locator('table.vtable tbody tr')).toHaveCount(1);
  note('changing.csv', 'source,lag\nnorth,4.2\nsouth,6.1\neast,3.3\n');
  await expect(page.locator('table.vtable tbody tr')).toHaveCount(3, { timeout: 10_000 });
});
