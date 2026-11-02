import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { RepoSnapshot } from '../../core/types.ts';
import { buildDir, guarded, rootOf, serveRepo, urlFor } from './fixtures';

// Nothing in this file reaches the network: a request to any host but the local server is aborted.
test.beforeEach(async ({ page }) => {
  await page.route((url) => url.hostname !== '127.0.0.1' && url.hostname !== 'localhost', (route) => route.abort());
});

test('a checkout with no build lands on Repo › Overview, and the switch reaches the Build side', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    // The favicon request isn't the page's own error; the cockpit serves its page for unknown paths anyway.
    if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text());
  });
  await page.goto(urlFor('empty'));
  await expect(page).toHaveURL(/#\/repo\/overview$/);
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /Overview/ })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Build' }).click();
  await expect(page.getByText('No build in this checkout yet')).toBeVisible();
  await page.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Repo' }).click();
  await expect(page).toHaveURL(/#\/repo\/overview$/);
  expect(errors).toEqual([]);
});

test('with a build, it opens on the build, and Repo keeps its own last route', async ({ page }) => {
  await page.goto(urlFor('repo'));
  await expect(page.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Build' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Repo' }).click();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /Memory/ }).click();
  await expect(page).toHaveURL(/#\/repo\/memory/);
  await page.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Build' }).click();
  await expect(page).toHaveURL(/#\/gate/);
  await page.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Repo' }).click();
  await expect(page).toHaveURL(/#\/repo\/memory/);
});

test('a page holds one event stream, whichever side it shows', async ({ page }) => {
  const streams: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === '/api/events') streams.push(r.url());
  });
  const repoRead = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/repo');
  await page.goto(urlFor('repo'));
  await expect(page.getByRole('banner')).toContainText('build/relay-rebuild');
  await repoRead;
  await page.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Repo' }).click();
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /Overview/ })).toContainText('4 out');
  expect(streams).toHaveLength(1);
});

test('a repo change refetches the repo, not the build', async ({ page }) => {
  // Settled once the repo has been read twice: on mount, and when the event stream opens.
  let reads = 0;
  page.on('response', (r) => {
    if (new URL(r.url()).pathname === '/api/repo') reads += 1;
  });
  await page.goto(urlFor('repo', '#/repo/overview'));
  await expect.poll(() => reads).toBe(2);
  const builds: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api/builds')) builds.push(r.url());
  });
  // A body edit: the note's size changes (so the repo signature does) and every count stays the same.
  const note = join(rootOf('repo'), 'docs', 'governance', 'issues', 'slow-hook.md');
  const before = readFileSync(note, 'utf8');
  const reread = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/repo', { timeout: 10_000 });
  try {
    writeFileSync(note, `${before}\nIt also reads the config twice.\n`);
    await reread;
  } finally {
    writeFileSync(note, before);
  }
  expect(builds).toEqual([]);
});

test('switching to Repo and back keeps the chosen build, with no picker on the way', async ({ page }) => {
  await page.goto(urlFor('two'));
  await page.getByRole('button', { name: 'relay-rebuild' }).click();
  await expect(page.getByRole('banner')).toContainText('build/relay-rebuild');
  await page.evaluate(() => {
    const w = window as unknown as { sawPicker: boolean };
    w.sawPicker = false;
    new MutationObserver(() => {
      if (document.querySelector('.picker-list')) w.sawPicker = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
  const mode = page.getByRole('group', { name: 'Mode' });
  await mode.getByRole('button', { name: 'Repo' }).click();
  await expect(page).toHaveURL(/#\/repo\/overview\?build=relay-rebuild$/);
  await mode.getByRole('button', { name: 'Build' }).click();
  await expect(page).toHaveURL(/#\/gate\?build=relay-rebuild$/);
  await expect(page.getByRole('banner')).toContainText('build/relay-rebuild');
  expect(await page.evaluate(() => (window as unknown as { sawPicker: boolean }).sawPicker)).toBe(false);
});

test('a repo that could not be read tries again on the next change the server reports', async ({ page }) => {
  let refused = 0;
  await page.route(/\/api\/repo$/, (r) => {
    refused += 1;
    return r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Disk read failed' }) });
  });
  await page.goto(urlFor('watch', '#/repo/overview'));
  const failed = page.getByText('The repo could not be read');
  await expect(failed).toBeVisible();
  // Both reads refused (on mount, and when the event stream opens), so only a later change can clear it.
  await expect.poll(() => refused).toBe(2);
  await expect(page.locator('main')).toContainText('The server answered “Disk read failed”. This page tries again whenever the server reports a change or reconnects.');
  await page.unroute(/\/api\/repo$/);
  // A build-side change (no repo event follows it): a file the build's views don't show.
  // Removed afterwards, so the shared watch fixture holds no extra file for a later spec.
  const poke = join(buildDir('watch'), 'e2e-poke.txt');
  try {
    writeFileSync(poke, 'poke\n');
    await expect(failed).toHaveCount(0, { timeout: 10_000 });
  } finally {
    rmSync(poke, { force: true });
  }
});

test('the rail counts what is outside the record', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/overview'));
  const overview = page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /Overview/ });
  await expect(overview).toContainText('4 out');
});

test('the overview shows three counts and every item grouped by load scope', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/overview'));
  const cards = page.locator('.repo-cards');
  await expect(cards.getByText('Outside the record')).toBeVisible();
  await expect(cards.locator('.num')).toHaveText(['4', '3', '1']);
  await expect(page.locator('.repo-list').getByRole('heading', { level: 2 })).toHaveText(['Always loaded', 'Path-scoped', 'On demand', 'This build']);
  await expect(page.locator('.repo-item', { hasText: 'Stage explicit paths only' })).toHaveAttribute('data-record', 'recorded');
  await expect(page.locator('.repo-item', { hasText: 'Relay' }).first()).toHaveAttribute('data-record', 'outside');
});

test('search and record toggles filter the list, and live in the URL', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/overview'));
  await page.getByRole('searchbox', { name: 'Search the standing instructions' }).fill('replay');
  await expect(page).toHaveURL(/q=replay/);
  await expect(page.locator('.repo-item')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Search the standing instructions' }).fill('');
  await page.getByRole('button', { name: /^recorded/ }).click();
  await expect(page).toHaveURL(/show=generated,outside,build$/);
  await expect(page.locator('.repo-item[data-record="recorded"]')).toHaveCount(0);
  // Each record hides on its own: turning generated off too leaves recorded off and outside on.
  await page.getByRole('button', { name: /^generated/ }).click();
  await expect(page).toHaveURL(/show=outside,build$/);
  await expect(page.getByRole('button', { name: /^generated/ })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.repo-item[data-record="recorded"]')).toHaveCount(0);
  await expect(page.locator('.repo-item[data-record="outside"]')).toHaveCount(4);
});

test('a kind section shows only its kind, still grouped by scope', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/memory'));
  await expect(page.locator('.repo-item')).toHaveCount(2);
  await expect(page.locator('.repo-list').getByRole('heading', { level: 2 })).toHaveText(['Always loaded', 'On demand']);
});

test('each empty section says what is missing and how to add it', async ({ page }) => {
  await page.goto(urlFor('empty', '#/repo/decisions'));
  await expect(page.getByText('No vault yet.')).toBeVisible();
  await expect(page.getByText('nexus init', { exact: true })).toBeVisible();
  await page.goto(urlFor('empty', '#/repo/memory'));
  await expect(page.getByText('No memory for sessions in this repo.')).toBeVisible();
  await page.goto(urlFor('empty', '#/repo/guardrails'));
  await expect(page.getByText('No accepted guardrails in an active build.')).toBeVisible();
});

test('the This build group links across to Logs › Guardrails', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/overview'));
  await page.getByRole('link', { name: 'Open in Logs › Guardrails' }).click();
  await expect(page).toHaveURL(/#\/logs\/guardrails/);
});

test('with no vault, the overview says how to add one rather than erroring', async ({ page }) => {
  await page.goto(urlFor('empty', '#/repo/overview'));
  await expect(page.getByText('No vault yet.')).toBeVisible();
  await expect(page.locator('main')).toContainText('docs/governance/');
  await expect(page.locator('.repo-cards')).toBeVisible();
});

test('with no vault but other instructions, the overview lists them under a one-line hint', async ({ page }) => {
  // The repo fixture as a repo that has not run nexus init: its CLAUDE.md, rule file, memory and guardrail, no vault.
  await page.route(
    /\/api\/repo$/,
    guarded(async (route) => {
      const res = await route.fetch();
      const repo = (await res.json()) as RepoSnapshot;
      repo.inventory.vault = false;
      repo.inventory.items = repo.inventory.items.filter((i) => !['decision', 'rule', 'issue', 'generated'].includes(i.kind));
      await route.fulfill({ response: res, json: repo });
    }),
  );
  await page.goto(urlFor('repo', '#/repo/overview'));
  await expect(page.locator('.repo-item')).toHaveCount(5);
  await expect(page.locator('.repo-hint')).toHaveText('No vault yet. Run nexus init or /nexus:init to set the repo up; decisions, rules and issues then live in docs/governance/.');
  await expect(page.locator('.empty')).toHaveCount(0);
  // With a vault there is no hint.
  await page.unroute(/\/api\/repo$/);
  await page.reload();
  await expect(page.locator('.repo-item')).toHaveCount(8);
  await expect(page.locator('.repo-hint')).toHaveCount(0);
});

test('a section with nothing in it is only its empty state, with no toggles or search', async ({ page }) => {
  await page.goto(urlFor('empty', '#/repo/memory'));
  await expect(page.getByText('No memory for sessions in this repo.')).toBeVisible();
  await expect(page.getByRole('searchbox')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Show records' })).toHaveCount(0);
});

test('a search with no hits says so, with a live count, and no empty state', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/overview'));
  const count = page.locator('.viewbar .matches');
  await expect(count).toHaveText('8 of 8');
  await expect(count).toHaveAttribute('aria-live', 'polite');
  // The group is named by its visible "Show" label (plus hidden words), not by a second, separate aria-label.
  const group = page.getByRole('group', { name: 'Show records' });
  await expect(group).not.toHaveAttribute('aria-label');
  const label = group.locator('.lbl');
  await expect(label).toHaveAttribute('id', (await group.getAttribute('aria-labelledby')) ?? 'missing');
  // Sighted readers see "Show"; the rest of the name is visually hidden.
  await expect(label).toHaveText('Show records');
  await expect(label.locator('.visually-hidden')).toHaveText('records');
  await page.getByRole('searchbox', { name: 'Search the standing instructions' }).fill('zzz-no-such-thing');
  await expect(page.getByText('Nothing matches. Clear the search or turn a record type back on.')).toBeVisible();
  await expect(count).toHaveText('0 of 8');
  await expect(page.getByText('No vault yet.')).toHaveCount(0);
  await expect(page.locator('.empty')).toHaveCount(0);
});

test('the card numbers are ink, and only a non-zero Outside count is signal red', async ({ page }) => {
  // gate.css's page-wide .num is grey; the cards set their own colour.
  const colours = async () =>
    page.locator('.repo-cards .num').evaluateAll((els) => {
      const resolve = (token: string) => {
        const probe = document.createElement('span');
        probe.style.color = `var(${token})`;
        document.body.append(probe);
        const colour = getComputedStyle(probe).color;
        probe.remove();
        return colour;
      };
      const ink = resolve('--ink');
      const signal = resolve('--signal');
      return els.map((e) => {
        const c = getComputedStyle(e).color;
        return c === ink ? 'ink' : c === signal ? 'signal' : c;
      });
    });
  await page.goto(urlFor('repo', '#/repo/overview'));
  await expect(page.locator('.repo-cards .num')).toHaveText(['4', '3', '1']);
  expect(await colours()).toEqual(['signal', 'ink', 'ink']);
  await expect(page.locator('.repo-cards .num').first()).toHaveClass(/\bout\b/);
  await page.goto(urlFor('empty', '#/repo/overview'));
  await expect(page.locator('.repo-cards .num')).toHaveText(['0', '0', '0']);
  expect(await colours()).toEqual(['ink', 'ink', 'ink']);
});

test('the record toggles are a labelled group, and the across link keeps the open build', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/overview?build=relay-rebuild'));
  await expect(page.getByRole('group', { name: 'Show records' }).getByRole('button')).toHaveCount(4);
  await page.getByRole('link', { name: 'Open in Logs › Guardrails' }).click();
  await expect(page).toHaveURL(/#\/logs\/guardrails\?build=relay-rebuild$/);
});

test('every record dot is the same small mark, whatever its record', async ({ page }) => {
  // The dot is styled from its item's record, so no page-wide class (the top bar's .build) reaches it.
  await page.goto(urlFor('repo', '#/repo/overview'));
  const dots = page.locator('.repo-item .dot');
  await expect(dots).toHaveCount(8);
  const sizes = await dots.evaluateAll((els) => els.map((e) => `${e.getBoundingClientRect().width}x${e.getBoundingClientRect().height}`));
  expect(new Set(sizes).size).toBe(1);
});

test('the reader shows where an item lives, when it loads, whether it is recorded, then its text', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/instructions'));
  await page.locator('.repo-item', { hasText: 'Web rules' }).click();
  const reader = page.locator('.repo-reader');
  await expect(reader.locator(':scope > h2')).toHaveText('Web rules');
  await expect(reader.locator('.facts')).toContainText('.claude/rules/web.md');
  await expect(reader.locator('.facts')).toContainText('Path-scoped: web/**');
  await expect(reader.locator('.facts')).toContainText('Outside the record');
  await expect(reader.locator('.md')).toContainText('Charts draw in SVG.');
  // A rule file's frontmatter is properties, not text: it never renders as a rule and a heading.
  await expect(reader.locator('.fm')).toContainText('paths');
  await expect(reader.locator('.md')).not.toContainText('paths');
  await expect(reader.locator('.md hr')).toHaveCount(0);
  // The facts are small print: the gate's page-wide .facts dd (title size) doesn't reach them.
  const sizes = await reader.locator('.facts > *').evaluateAll((els) => els.map((e) => getComputedStyle(e).fontSize));
  expect(new Set(sizes).size).toBe(1);
});

test('a vault note shows its frontmatter as facts', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/rules'));
  const reader = page.locator('.repo-reader');
  await expect(reader.locator('.fm')).toContainText('tier');
  await expect(reader.locator('.fm')).toContainText('always');
  // The note's own first heading repeats the reader's title, so the body leaves it out.
  await expect(reader.locator(':scope > h2')).toHaveText('Stage explicit paths only');
  await expect(reader.locator('.md h1')).toHaveCount(0);
  await expect(reader.locator('.md')).toContainText('Never');
});

test('a generated rule file links to the note it came from, keeping the build but not the search', async ({ page }) => {
  // The fixture has no generated file, so the list gains one made from its rule note.
  let ruleId = '';
  await page.route(
    /\/api\/repo$/,
    guarded(async (route) => {
      const res = await route.fetch();
      const repo = (await res.json()) as RepoSnapshot;
      const rule = repo.inventory.items.find((i) => i.kind === 'rule');
      if (!rule) throw new Error('the repo fixture has no rule note');
      ruleId = rule.id;
      repo.inventory.items.push({ id: 'abcdef012345', kind: 'generated', title: 'Generated staging rule', location: '.claude/rules/explicit-staging.md', scope: 'always', record: 'generated', source: rule.location, size: 90, changed: rule.changed });
      await route.fulfill({ response: res, json: repo });
    }),
  );
  await page.goto(urlFor('repo', '#/repo/rules?build=relay-rebuild&item=abcdef012345&q=generated'));
  const facts = page.locator('.repo-reader .facts');
  await expect(facts).toContainText('Generated from a recorded note');
  await expect(facts.getByRole('link', { name: 'docs/governance/rules/explicit-staging.md' })).toHaveAttribute('href', `#/repo/rules?build=relay-rebuild&item=${ruleId}`);
});

test('a note whose frontmatter cannot be read says why, and shows all of its text', async ({ page }) => {
  await serveItemText(page, '---\ntier: always\n# Half a note\n\nStill here.\n');
  await page.goto(urlFor('repo', '#/repo/rules'));
  const reader = page.locator('.repo-reader');
  await expect(reader.locator('.md')).toContainText('Still here.');
  await expect(reader.locator('.md')).toContainText('tier: always');
  await expect(reader.locator('.fm')).toHaveCount(0);
  await expect(reader.locator('.fm-error')).toHaveText("Its properties can't be read: the frontmatter has no closing ---");
});

/** A one-pixel PNG, served for outside images so a test never reaches the network. */
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/** Serves every repo item with this text in place of its own. */
async function serveItemText(page: Page, text: string) {
  await page.route(
    /\/api\/repo\/items\/[0-9a-f]+$/,
    guarded(async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as { item: unknown; text: string };
      await route.fulfill({ response: res, json: { ...body, text } });
    }),
  );
}

test('an instruction file shows as Claude Code loads it, frontmatter and all', async ({ page }) => {
  await serveItemText(page, '---\nowner: web\n---\n# Relay\n\nWork in small steps.\n');
  await page.goto(urlFor('repo', '#/repo/instructions'));
  const reader = page.locator('.repo-reader');
  await expect(reader.locator('h2').first()).toHaveText('Relay');
  await expect(reader.locator('.md')).toContainText('owner: web');
  await expect(reader.locator('.md')).toContainText('Work in small steps.');
  await expect(reader.locator('.fm')).toHaveCount(0);
});

test('an empty frontmatter block shows no properties', async ({ page }) => {
  await serveItemText(page, '---\n---\n# Bare rule\n');
  await page.goto(urlFor('repo', '#/repo/rules'));
  const reader = page.locator('.repo-reader');
  await expect(reader.locator('.md h1')).toHaveText('Bare rule');
  await expect(reader.locator('.fm')).toHaveCount(0);
  await expect(reader.locator('.fm-error')).toHaveCount(0);
});

/** Records, on every change to the reader, its title, its text and whether it says it is loading. */
async function watchReader(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { frames_: { title: string; body: string; loading: boolean }[] };
    w.frames_ = [];
    const record = () => {
      const r = document.querySelector('.repo-reader');
      if (!r) return;
      w.frames_.push({ title: r.querySelector(':scope > h2')?.textContent ?? '', body: r.querySelector('.md')?.textContent ?? '', loading: (r.textContent ?? '').includes('Loading…') });
    };
    new MutationObserver(record).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  return () => page.evaluate(() => (window as unknown as { frames_: { title: string; body: string; loading: boolean }[] }).frames_);
}

test('saving the open file updates its text in place, with no loading flash', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/instructions'));
  await page.locator('.repo-item', { hasText: 'Web rules' }).click();
  const md = page.locator('.repo-reader .md');
  await expect(md).toContainText('Charts draw in SVG.');
  const frames = await watchReader(page);
  const file = join(rootOf('repo'), '.claude', 'rules', 'web.md');
  const before = readFileSync(file, 'utf8');
  try {
    writeFileSync(file, `${before}\nTables stay plain.\n`);
    await expect(md).toContainText('Tables stay plain.', { timeout: 10_000 });
  } finally {
    writeFileSync(file, before);
  }
  await expect(md).not.toContainText('Tables stay plain.', { timeout: 10_000 });
  expect((await frames()).filter((f) => f.loading)).toEqual([]);
});

test('opening another item never shows its title over the last one’s text', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/instructions'));
  await page.locator('.repo-item', { hasText: 'Web rules' }).click();
  await expect(page.locator('.repo-reader .md')).toContainText('Charts draw in SVG.');
  const frames = await watchReader(page);
  await page.locator('.repo-item', { hasText: 'Relay' }).click();
  await expect(page.locator('.repo-reader .md')).toContainText('Work in small steps.');
  const seen = await frames();
  expect(seen.some((f) => f.title === 'Relay')).toBe(true);
  expect(seen.filter((f) => f.title === 'Relay' && f.body.includes('Charts draw in SVG.'))).toEqual([]);
});

test('an open file deleted from disk leaves the list, and the reader says it is no longer here', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/instructions'));
  await page.locator('.repo-item', { hasText: 'Relay' }).click();
  await expect(page.locator('.repo-reader .md')).toContainText('Work in small steps.');
  const url = page.url();
  const file = join(rootOf('repo'), 'CLAUDE.md');
  const before = readFileSync(file, 'utf8');
  try {
    rmSync(file);
    await expect(page.locator('.repo-item', { hasText: 'Relay' })).toHaveCount(0, { timeout: 10_000 });
    // No other item stands in for it under its URL; the list stays.
    await expect(page.locator('.repo-reader')).toContainText('That standing instruction is no longer here.');
    await expect(page.locator('.repo-reader h2')).toHaveCount(0);
    await expect(page.locator('.repo-item', { hasText: 'Web rules' })).toBeVisible();
    expect(page.url()).toBe(url);
  } finally {
    // Put it back as it was: later specs and the visual baselines read this fixture.
    writeFileSync(file, before);
  }
  await expect(page.locator('.repo-item', { hasText: 'Relay' })).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator('.repo-reader .md')).toContainText('Work in small steps.');
});

test('an item opened from a list that is out of date says it cannot be read', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/instructions'));
  await page.locator('.repo-item', { hasText: 'Relay' }).click();
  await expect(page.locator('.repo-reader .md')).toContainText('Work in small steps.');
  const file = join(rootOf('repo'), 'CLAUDE.md');
  const before = readFileSync(file, 'utf8');
  // Hold the list's next reads, so the list stays out of date while the reader reads the vanished file.
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/api\/repo$/, async (route) => {
    await held;
    await route.continue();
  });
  try {
    rmSync(file);
    // Reopen it from the list as it still stands: the server answers 404.
    await page.locator('.repo-item', { hasText: 'Web rules' }).click();
    await page.locator('.repo-item', { hasText: 'Relay' }).click();
    const reader = page.locator('.repo-reader');
    await expect(reader.locator('.empty')).toContainText("This item can't be read");
    await expect(reader.locator('.empty')).toContainText('It was moved or deleted after the list was read.');
    await expect(reader.locator('.facts')).toContainText('CLAUDE.md');
    release();
    await page.unroute(/\/api\/repo$/);
    await expect(page.locator('.repo-item', { hasText: 'Relay' })).toHaveCount(0, { timeout: 10_000 });
  } finally {
    release();
    writeFileSync(file, before);
  }
  await expect(page.locator('.repo-item', { hasText: 'Relay' })).toHaveCount(1, { timeout: 10_000 });
});

test('repo Markdown draws its diagrams, loads no outside image of its own, runs no HTML and links nowhere inside the build', async ({ page }) => {
  const text = [
    '# Untrusted',
    '',
    '<img src="https://example.com/raw.png" onerror="window.pwned = true"><script>window.pwned = true</script>',
    '',
    '![remote chart](https://example.com/chart.png) ![local chart](img/chart.png) ![no scheme](//example.com/x.png)',
    '',
    '[a sibling](other.md) [a file](data/rows.csv) [the api](/api/repo) [[Some note]] [run](javascript:alert(1)) [data url](data:text/html;base64,PHNjcmlwdD53aW5kb3cucHduZWQ9dHJ1ZTwvc2NyaXB0Pg==) [vb](vbscript:msgbox(1)) [the web](https://example.com/page) [down](#untrusted)',
    '',
    '[chat](irc://irc.example.com/room) [secure chat](ircs://irc.example.com/room) [jabber](xmpp:someone@example.com) [write](mailto:someone@example.com)',
    '',
    '```mermaid',
    'flowchart LR',
    '  A["<img src=https://example.com/label.png onerror=window.pwned=true><script>window.pwned=true</script>start"] --> B[end]',
    '  click A call pwn()',
    '  C@{ img: "https://example.com/shape.png", label: "pic", pos: "t", w: 60, h: 60 }',
    '```',
  ].join('\n');
  await serveItemText(page, text);
  // Every request to the outside host is recorded. The diagram's image shape (which Mermaid may fetch; accepted, since
  // a repo's files come from collaborators) gets a one-pixel PNG; anything else fails, so a surviving onerror would run.
  const outside: string[] = [];
  await page.route(/^https?:\/\/example\.com\//, async (route) => {
    const url = route.request().url();
    outside.push(url);
    if (new URL(url).pathname === '/shape.png') await route.fulfill({ contentType: 'image/png', body: PIXEL });
    else await route.abort();
  });
  await page.goto(urlFor('repo', '#/repo/instructions'));
  const md = page.locator('.repo-reader .md');
  await expect(md.locator('h1')).toHaveText('Untrusted');
  // The diagram draws, as in build documents; its HTML label runs nothing (checked below).
  await expect(md.locator('.md-mermaid svg')).toBeVisible();
  await expect(md.locator('.md-mermaid-error')).toHaveCount(0);
  await expect(md.locator('img:not(.md-mermaid img)')).toHaveCount(0);
  await expect(md.locator('script')).toHaveCount(0);
  await expect(md.locator('[onerror], [onload], [onclick]')).toHaveCount(0);
  const remote = md.getByRole('link', { name: 'remote chart' });
  await expect(remote).toHaveAttribute('href', 'https://example.com/chart.png');
  await expect(remote).toHaveAttribute('target', '_blank');
  await expect(md.locator('.dead-link')).toHaveText(['local chart', 'no scheme', 'a sibling', 'a file', 'the api']);
  await expect(md.getByText('Some note')).toBeVisible();
  await expect(md.getByRole('link', { name: 'Some note' })).toHaveCount(0);
  await expect(md.locator('p', { hasText: 'a sibling' })).toContainText('run');
  await expect(md.locator('p', { hasText: 'a sibling' })).toContainText('data url');
  await expect(md.locator('p', { hasText: 'a sibling' })).toContainText('vb');
  await expect(md.locator('a[href^="javascript:" i], a[href^="data:" i], a[href^="vbscript:" i], a[href^="/"]')).toHaveCount(0);
  await expect(md.getByRole('link', { name: 'the web' })).toHaveAttribute('target', '_blank');
  await expect(md.getByRole('link', { name: 'down' })).toHaveAttribute('href', '#untrusted');
  // Only http(s) and mailto stay links: irc, ircs and xmpp (which react-markdown's default allows) are text.
  await expect(md.locator('a[href^="irc" i], a[href^="xmpp" i]')).toHaveCount(0);
  await expect(md.locator('p', { hasText: 'secure chat' })).toHaveText('chat secure chat jabber write');
  await expect(md.getByRole('link', { name: 'write' })).toHaveAttribute('href', 'mailto:someone@example.com');
  expect(await page.evaluate(() => (window as unknown as { pwned?: boolean }).pwned)).toBeUndefined();
  // The Markdown's own images and links are never fetched (the diagram's may be).
  const fetched = outside.map((u) => new URL(u).pathname);
  for (const own of ['/raw.png', '/chart.png', '/x.png', '/page']) expect(fetched).not.toContain(own);
});

test('a list row carries its conditional note, so nothing under Always loaded hides that it may not load', async ({ page }) => {
  const note = "Claude Code doesn't load it here: this repo or a folder above has a CLAUDE.md";
  await page.route(
    /\/api\/repo$/,
    guarded(async (route) => {
      const snapshot = (await (await route.fetch()).json()) as RepoSnapshot;
      const target = snapshot.inventory.items.find((i) => i.kind === 'instructions');
      if (target) target.conditional = note;
      await route.fulfill({ json: snapshot });
    }),
  );
  await page.goto(urlFor('repo', '#/repo/instructions'));
  const noted = page.locator('.repo-item', { has: page.locator('.cond') });
  await expect(noted).toHaveCount(1);
  await expect(noted.locator('.cond')).toHaveText(note);
  // Items without a note stay as they were.
  await expect(page.locator('.repo-item .cond')).toHaveCount(1);
});

test('every Repo rail section keeps the cockpit in Repo mode, Guidance included', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/overview'));
  const rail = page.getByRole('navigation', { name: 'Sections' });
  const repoButton = page.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Repo' });
  for (const label of ['Overview', 'Decisions', 'Rules', 'Issues', 'Instructions', 'Memory', 'Guardrails', 'Views', 'Guidance']) {
    await rail.getByRole('link', { name: new RegExp(`^${label}`) }).click();
    await expect(repoButton, label).toHaveAttribute('aria-pressed', 'true');
    await expect(rail.getByRole('link', { name: /^Memory/ }), label).toBeVisible();
  }
  await expect(page).toHaveURL(/#\/guidance/);
  await expect(page.locator('.reader.guide')).toBeVisible();
  await expect(rail.getByRole('link', { name: /^Guidance/ })).toHaveAttribute('aria-current', 'page');
  // A guide page of its own stays in Repo mode too, and Build still reaches the build.
  await page.getByRole('tab', { name: 'Commands' }).click();
  await expect(repoButton).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Build' }).click();
  await expect(page).toHaveURL(/#\/gate/);
});

test('standing instructions that could not be read are named on the Overview, with the rest still showing', async ({ page }) => {
  await page.route(
    /\/api\/repo$/,
    guarded(async (route) => {
      const snapshot = (await (await route.fetch()).json()) as RepoSnapshot;
      snapshot.inventory.problems = [
        { location: '.claude/rules/broken.md', message: "can't be read: EACCES" },
        { location: 'docs', message: 'a link leads to a network, device or other-drive path; not followed' },
      ];
      await route.fulfill({ json: snapshot });
    }),
  );
  await page.goto(urlFor('repo', '#/repo/overview'));
  const box = page.getByRole('region', { name: 'Standing instructions that could not be read' });
  await expect(box.getByRole('listitem')).toHaveText([".claude/rules/broken.md: can't be read: EACCES", 'docs: a link leads to a network, device or other-drive path; not followed']);
  await expect(page.locator('.repo-item').first()).toBeVisible();
  // A problem names no kind, so a kind section doesn't repeat it.
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /^Memory/ }).click();
  await expect(page.getByRole('region', { name: 'Standing instructions that could not be read' })).toHaveCount(0);
});

test('the Overview names what the inventory does not cover, and where one session’s truth is', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/overview'));
  // The setting line above it is a .repo-foot too.
  const foot = page.locator('.repo-foot:not(.repo-setting)');
  await expect(foot).toContainText('Not listed here');
  await expect(foot).toContainText('/context');
  await expect(foot).toContainText('/memory');
  await expect(foot).toContainText('claudeMdExcludes');
});

test('subfolder instruction files are grouped under their folder, each saying when it loads', async ({ page }) => {
  await serveRepo(page, (r) => {
    const base = r.inventory.items.find((i) => i.kind === 'instructions');
    if (!base) throw new Error('the repo fixture lists no instruction file');
    r.inventory.items.push(
      { ...base, id: 'a1b2c3d4e5f6', title: 'API package', location: 'packages/api/CLAUDE.md', scope: 'on-demand', folder: 'packages/api', conditional: 'loads when Claude Code reads, writes or edits a file in packages/api/' },
      { ...base, id: 'b1b2c3d4e5f6', title: 'Web package', location: 'packages/web/AGENTS.md', scope: 'on-demand', folder: 'packages/web', conditional: 'loads when Claude Code reads, writes or edits a file in packages/web/' },
    );
  });
  await page.goto(urlFor('repo', '#/repo/instructions'));
  const api = page.locator('.repo-folder', { has: page.getByRole('heading', { name: 'In packages/api/' }) });
  await expect(api.locator('.repo-item')).toHaveCount(1);
  await expect(api.locator('.repo-item')).toContainText('API package');
  await expect(api.locator('small.cond')).toHaveText('loads when Claude Code reads, writes or edits a file in packages/api/');
  const headings = await page.locator('.repo-folder h3').allInnerTexts();
  expect(headings).toEqual(['In packages/api/', 'In packages/web/']);
  // The repo's own CLAUDE.md stays above the folders, ungrouped.
  await expect(page.locator('.repo-scope > ul .repo-item', { hasText: 'Relay' })).toHaveCount(1);
  await expect(page.locator('.repo-folder .repo-item', { hasText: 'Relay' })).toHaveCount(0);
  // Only the path is mono: "In" is a word, so the heading itself is in the text face.
  await expect(api.locator('h3 .mono')).toHaveText('packages/api/');
  const faces = await api.locator('h3').evaluate((h) => [getComputedStyle(h).fontFamily, getComputedStyle(h.querySelector('.mono') as Element).fontFamily]);
  expect(faces[0]).not.toBe(faces[1]);
});

test('a folder with one very long name wraps inside the list column', async ({ page }) => {
  const long = `packages/${'averylongfoldername'.repeat(8)}`;
  await serveRepo(page, (r) => {
    const base = r.inventory.items.find((i) => i.kind === 'instructions');
    if (!base) throw new Error('the repo fixture lists no instruction file');
    r.inventory.items.push({ ...base, id: 'c1b2c3d4e5f6', title: 'Long folder', location: `${long}/CLAUDE.md`, scope: 'on-demand', folder: long });
  });
  await page.setViewportSize({ width: 1280, height: 1440 });
  await page.goto(urlFor('repo', '#/repo/instructions'));
  const heading = page.locator('.repo-folder h3');
  await expect(heading).toHaveText(`In ${long}/`);
  const list = page.locator('.repo-list');
  expect(await list.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  // The text itself, not just its box: the range around the heading's contents ends inside the column.
  const inside = await heading.evaluate((h) => {
    const range = document.createRange();
    range.selectNodeContents(h);
    return range.getBoundingClientRect().right <= (h.closest('.repo-list') as Element).getBoundingClientRect().right + 0.5;
  });
  expect(inside).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('a review row on a subfolder file keeps its marks inside the folder group', async ({ page }) => {
  // The reviewed rule file, served as if it sat in a subfolder: the row finds it by id wherever it is listed.
  await serveRepo(page, (r) => {
    const web = r.inventory.items.find((i) => i.kind === 'rule-file' && i.location.endsWith('web.md'));
    if (!web) throw new Error('the reviews fixture lists no web rule file');
    web.folder = 'packages/web';
  }, 'reviews');
  await page.goto(urlFor('reviews', '#/repo/overview'));
  await expect(page.getByRole('region', { name: 'Tidy the standing instructions' })).toBeVisible();
  const folder = page.locator('.repo-list .repo-folder', { has: page.getByRole('heading', { name: 'In packages/web/' }) });
  await expect(folder.locator('li.reviewed')).toHaveCount(1);
  const marks = folder.getByRole('group', { name: 'Review: Web rules: still needed?' });
  await marks.getByRole('button', { name: 'Adjust' }).click();
  await expect(marks.getByRole('button', { name: 'Adjust' })).toHaveAttribute('aria-pressed', 'true');
  // A row at the root still has its marks, outside any folder.
  await expect(page.locator('.repo-list .repo-scope > ul').getByRole('group', { name: 'Review: CLAUDE.md: the working agreement' })).toBeVisible();
});

test('the overview says which project-instructions setting it read, and where', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/overview'));
  await expect(page.locator('.repo-setting')).toHaveText("Project instructions: Claude Code's default (claude-md-or-agents-md); it isn't set in the managed or user settings. A --settings file given at launch can't be seen here.");
  await serveRepo(page, (r) => {
    r.inventory.setting = { value: 'claude-md-and-agents-md', from: '~/.claude/settings.json' };
  });
  await page.reload();
  await expect(page.locator('.repo-setting')).toHaveText("Project instructions: claude-md-and-agents-md, from ~/.claude/settings.json. A --settings file given at launch can't be seen here.");
  // The footnote no longer says subfolder files are left out: they're listed under their folder.
  const foot = page.locator('.repo-foot').last();
  await expect(foot).not.toContainText('Not listed here: CLAUDE.md');
  await expect(foot).toContainText('listed under their folder');
  // The setting line shows on the overview only.
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /^Memory/ }).click();
  await expect(page.locator('.repo-setting')).toHaveCount(0);
});
