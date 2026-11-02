import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { buildDir, rootOf, serveSnapshot, urlFor } from './fixtures';

test.describe.configure({ mode: 'serial' });

test('the guardrails tab lists proposals with who raised them, above the static rules', async ({ page }) => {
  await page.goto(urlFor('planning', '#/logs/guardrails'));
  await expect(page.getByRole('tab', { name: /Guardrails/ })).toHaveAttribute('aria-selected', 'true');
  const rows = page.locator('.erow');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'Replay never writes' })).toContainText('you');
  await expect(rows.filter({ hasText: 'No new external' })).toContainText('the agent');
  await expect(rows.first().locator('.es')).toHaveText('proposed');
  const rules = page.getByRole('region', { name: 'Static rules' });
  await expect(rules.getByRole('heading', { name: 'Working rules' })).toBeVisible();
  await expect(rules).toContainText('RULES.md');
});

test('the guardrails tab filters by state and searches the text', async ({ page }) => {
  await page.goto(urlFor('planning', '#/logs/guardrails'));
  await expect(page.locator('.erow')).toHaveCount(2);
  await page.getByRole('button', { name: /^proposed/ }).click();
  await expect(page).toHaveURL(/show=/);
  await expect(page.locator('.erow')).toHaveCount(0);
  await page.getByRole('button', { name: /^proposed/ }).click();
  await expect(page.locator('.erow')).toHaveCount(2);
  await page.getByLabel('Search the guardrails').fill('external');
  await expect(page.locator('.erow')).toHaveCount(1);
  await expect(page.locator('.erow')).toContainText('No new external');
  await page.getByLabel('Search the guardrails').fill('nothing like this');
  await expect(page.getByText('Nothing here matches.')).toBeVisible();
});

test('guardrails hidden by the filter are counted, and show all reveals them', async ({ page }) => {
  await page.goto(urlFor('planning', '#/logs/guardrails'));
  await page.getByRole('button', { name: /^proposed/ }).click();
  await expect(page.locator('.erow')).toHaveCount(0);
  await expect(page.locator('.hiddennote').filter({ hasText: 'hidden' })).toContainText('2 hidden (proposed)');
  await page.getByRole('button', { name: 'show all' }).click();
  await expect(page.locator('.erow')).toHaveCount(2);
  await expect(page.locator('.hiddennote').filter({ hasText: 'hidden' })).toHaveCount(0);
});

test('a static rule that cannot be shown says so, after it loads', async ({ page }) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/rules/0', async (route) => {
    await held;
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'The rule file could not be read' }) });
  });
  await page.goto(urlFor('planning', '#/logs/guardrails'));
  await expect(page.getByText('Loading…')).toBeVisible();
  release();
  await expect(page.getByText('RULES.md could not be shown')).toBeVisible();
  await expect(page.getByText('Loading…')).toHaveCount(0);
});

test('a static rule file that appears after the page loads shows without a reload', async ({ page }) => {
  const file = join(rootOf('planning'), 'RULES.md');
  const original = readFileSync(file, 'utf8');
  rmSync(file);
  try {
    await page.goto(urlFor('planning', '#/logs/guardrails'));
    await expect(page.getByText('RULES.md could not be shown')).toBeVisible();
    // Written anew, as a file created later is: the watcher sees a file it hasn't seen, whatever its timing.
    writeFileSync(file, `${original}- Added after the page loaded.
`);
    const rules = page.getByRole('region', { name: 'Static rules' });
    await expect(rules.getByRole('heading', { name: 'Working rules' })).toBeVisible();
    await expect(rules).toContainText('Added after the page loaded.');
    await expect(page.getByText('RULES.md could not be shown')).toHaveCount(0);
  } finally {
    writeFileSync(file, original);
  }
});

test('an unreadable guardrails log shows the problem', async ({ page }) => {
  const file = join(buildDir('broken'), 'logs', 'guardrails.json');
  const before = readFileSync(file, 'utf8');
  try {
    writeFileSync(file, '{ not json');
    await page.goto(urlFor('broken', '#/logs/guardrails'));
    await expect(page.getByText('logs/guardrails.json could not be read')).toBeVisible();
    await expect(page.locator('.erow')).toHaveCount(0);
  } finally {
    writeFileSync(file, before);
  }
});

test('an approved permit gate says what the approval allows', async ({ page }) => {
  await serveSnapshot(page, (s) => {
    const gate = s.gates.find((g) => g.name === 'claude-rule');
    if (gate) gate.answers = { gate: 'claude-rule', submitted: '2026-10-02T20:40:00Z', decision: 'approve', permit: { target: 'CLAUDE.md', change: 'Add "Replay never writes to the sources" under Working agreements' } };
  });
  await page.goto(urlFor('planning', '#/gate/claude-rule'));
  const permit = page.locator('.permit');
  await expect(permit).toContainText('Approved: the agent may change this file for 30 minutes, until the gate is applied');
  await expect(permit.locator('code')).toHaveText('CLAUDE.md');
});

test('marking the guardrail gate decides each guardrail', async ({ page }) => {
  await page.goto(urlFor('planning', '#/gate/build-guardrails'));
  const row = (text: string) => page.locator('li.row').filter({ hasText: text });
  await row('No new external').getByRole('button', { name: 'Accept' }).click();
  await row('Replay never writes').getByRole('button', { name: 'Decline' }).click();
  await page.getByRole('button', { name: 'Submit marks' }).click();
  await expect(page.locator('.outcome')).toBeVisible();
  await page.goto(urlFor('planning', '#/logs/guardrails'));
  await expect(page.locator('.erow')).toHaveCount(1);
  await expect(page.locator('.erow .es')).toHaveText('accepted');
  await page.getByRole('button', { name: /^declined/ }).click();
  await expect(page.locator('.erow')).toHaveCount(2);
  await expect(page).toHaveURL(/show=/);
});

test('a row that conflicts says so', async ({ page }) => {
  await page.goto(urlFor('planning', '#/gate/scope-check'));
  await expect(page.locator('li.row .conflicts')).toHaveText('conflicts with replay-read-only');
});

test('an approve gate with a permit shows the file and the change', async ({ page }) => {
  await page.goto(urlFor('planning', '#/gate/claude-rule'));
  const permit = page.locator('.permit');
  await expect(permit).toContainText('Approving lets the agent change a protected file');
  await expect(permit.locator('code')).toHaveText('CLAUDE.md');
  await expect(permit).toContainText('Add "Replay never writes to the sources" under Working agreements');
});

test('with no static rules configured, says where they go', async ({ page }) => {
  await page.goto(urlFor('visual', '#/logs/guardrails'));
  await expect(page.getByText('No static rules configured')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Static rules' })).toContainText('.nexus/config.json');
});

test('a conflict note is red while its gate is open and quiet once answered', async ({ page }) => {
  await page.goto(urlFor('planning', '#/gate/scope-check'));
  const note = page.locator('li.row .conflicts');
  const colourOf = (token: string) =>
    page.evaluate((t) => {
      const probe = document.createElement('span');
      probe.style.color = `var(${t})`;
      document.body.append(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    }, token);
  const noteColour = () => note.evaluate((el) => getComputedStyle(el).color);
  expect(await noteColour()).toBe(await colourOf('--signal-text'));
  await page.locator('li.row').filter({ hasText: 'Replay a source' }).getByRole('button', { name: 'Accept' }).click();
  await page.getByRole('button', { name: 'Submit marks' }).click();
  await expect(page.locator('.outcome')).toBeVisible();
  await expect(page.locator('.gate')).toHaveAttribute('data-state', 'answered');
  expect(await noteColour()).toBe(await colourOf('--g2'));
});

test('an answered permit gate says what the answer allows', async ({ page }) => {
  await page.goto(urlFor('planning', '#/gate/claude-rule'));
  await page.getByRole('button', { name: 'Send back' }).click();
  await expect(page.locator('.outcome')).toBeVisible();
  const permit = page.locator('.permit');
  await expect(permit).toContainText('Sent back: no change allowed');
  await expect(permit.locator('code')).toHaveText('CLAUDE.md');
  await expect(permit).toContainText('Add "Replay never writes to the sources" under Working agreements');
  // Once answered, the block shows the permit the server stamped, not a request edited afterwards.
  const file = join(buildDir('planning'), 'gates', 'claude-rule.json');
  const request = JSON.parse(readFileSync(file, 'utf8')) as { permit: { target: string; change: string } };
  writeFileSync(file, JSON.stringify({ ...request, permit: { target: '.claude/settings.json', change: 'Something else' } }));
  await page.reload();
  await expect(page.locator('.outcome')).toBeVisible();
  await expect(permit.locator('code')).toHaveText('CLAUDE.md');
  await expect(permit).toContainText('Add "Replay never writes to the sources" under Working agreements');
});

test('guardrail rows show who raised each one, from the guardrail log', async ({ page }) => {
  await page.goto(urlFor('planning', '#/gate/build-guardrails'));
  await expect(page.locator('li.row .src')).toHaveText(['the agent · guardrails draft', 'you · chat 11:12']);
  await page.getByRole('button', { name: 'Replay never writes to the source systems', exact: true }).click();
  await expect(page.getByText('Replay must never touch the sources.')).toBeVisible();
});

test('a static rule file renders as a repo file: an outside image is a link, and nothing is fetched', async ({ page }) => {
  const outside: string[] = [];
  await page.route(/^https?:\/\/example\.com\//, (route) => {
    outside.push(route.request().url());
    return route.abort();
  });
  await page.route('**/api/rules/0', (route) =>
    route.fulfill({ status: 200, contentType: 'text/plain', body: '# Working rules\n\n![remote chart](https://example.com/chart.png)\n\n[a sibling](other.md)\n' }),
  );
  await page.goto(urlFor('planning', '#/logs/guardrails'));
  const rules = page.getByRole('region', { name: 'Static rules' });
  await expect(rules.getByRole('heading', { name: 'Working rules' })).toBeVisible();
  await expect(rules.getByRole('link', { name: 'remote chart' })).toHaveAttribute('href', 'https://example.com/chart.png');
  await expect(rules.locator('img')).toHaveCount(0);
  await expect(rules.locator('.dead-link')).toHaveText(['a sibling']);
  expect(outside).toEqual([]);
});

test('links across to every standing instruction in Repo mode', async ({ page }) => {
  await page.goto(urlFor('planning', '#/logs/guardrails'));
  await page.getByRole('link', { name: 'See every standing instruction' }).click();
  await expect(page).toHaveURL(/#\/repo\/overview/);
});

test('the link across to Repo mode keeps the open build', async ({ page }) => {
  await page.goto(urlFor('planning', '#/logs/guardrails?build=relay-rebuild'));
  await page.getByRole('link', { name: 'See every standing instruction' }).click();
  await expect(page).toHaveURL(/#\/repo\/overview\?build=relay-rebuild$/);
});
