import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { buildDir, serveSnapshot, urlFor } from './fixtures';

// The concepts fixture: status-look settled over three rounds (none, combine, pick) in phase replay and refined there
// and in dashboard, the current phase; legend-1 (replay) and the example's look (no phase) open; and
// concepts/scratch.html in no round. Tests of a topic's rounds in Chosen name phase replay. Tests that answer the open
// rounds put them back first and last.
const OPEN = ['legend-1', 'look'];
const reopen = () => {
  for (const g of OPEN) rmSync(join(buildDir('concepts'), 'gates', `${g}.answers.json`), { force: true });
};
test.describe.configure({ mode: 'serial' });
test.beforeEach(reopen);
test.afterAll(reopen);

const answers = (gate: string) => JSON.parse(readFileSync(join(buildDir('concepts'), 'gates', `${gate}.answers.json`), 'utf8')) as Record<string, unknown>;
const tab = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp(`^${name}`) });
const rounds = (page: Page) => page.getByRole('navigation', { name: 'Rounds waiting for you' });
const topics = (page: Page) => page.getByRole('navigation', { name: 'Topics' });
const lineage = (page: Page) => page.locator('ol.lineage > li');
const railConcepts = (page: Page) => page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /^Concepts/ }).locator('.cnt');
// Titles: the example's look round, and the status-look topic's rounds.
const LOOK_TITLE = 'Pick a direction for the status page';
const STATUS_TITLE = 'Pick a look for the lag view';

/** Elements (and their ::before and ::after) under the selector that paint in the signal red, text or stroke. */
async function signalUses(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).evaluate((root) => {
    const probe = document.createElement('span');
    document.body.append(probe);
    const resolve = (v: string) => {
      probe.style.color = `var(${v})`;
      return getComputedStyle(probe).color;
    };
    const reds = [resolve('--signal'), resolve('--signal-text')];
    probe.remove();
    const props = ['color', 'background-color', 'background-image', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color', 'box-shadow', 'fill', 'stroke', 'text-decoration-color'];
    const found: string[] = [];
    for (const el of [root, ...root.querySelectorAll('*')]) {
      for (const pseudo of [null, '::before', '::after']) {
        const cs = getComputedStyle(el, pseudo);
        for (const p of props) {
          const v = cs.getPropertyValue(p);
          if (reds.some((r) => v.includes(r))) found.push(`${el.tagName.toLowerCase()}.${el.className}${pseudo ?? ''} ${p}`);
        }
      }
    }
    return found;
  });
}

/** Whether the element's bottom edge is above the window's, with the main field scrolled to its top. */
const aboveFold = (el: Locator) =>
  el.evaluate((e) => e.getBoundingClientRect().bottom + (e.closest('main')?.scrollTop ?? 0) <= innerHeight);

/** The opacity an element is painted at: its own times every ancestor's. */
const shownOpacity = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => {
    let o = 1;
    for (let e: Element | null = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
    return o;
  });

/** Clicks the middle of an option's thumbnail, where its page shows: what a person aims at. */
async function clickThumb(page: Page, box: Locator): Promise<void> {
  await box.scrollIntoViewIfNeeded();
  const b = await box.boundingBox();
  if (!b) throw new Error('thumbnail not shown');
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

async function answer(page: Page, gate: string, body: Record<string, unknown>): Promise<void> {
  const token = (await page.locator('meta[name="nexus-token"]').getAttribute('content')) ?? '';
  const res = await page.request.post(urlFor('concepts', `api/builds/relay-rebuild/gates/${gate}/answers`), {
    headers: { 'content-type': 'application/json', 'x-nexus-token': token },
    data: body,
  });
  expect(res.status()).toBe(201);
}

test.describe('Proposed', () => {
  test('lists the open rounds oldest first, shows the selected one, and answers it', async ({ page }) => {
    await page.goto(urlFor('concepts', '#/concepts?phase=replay'));
    await expect(tab(page, 'Proposed')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'Proposed').locator('.c')).toHaveText('2');
    await expect(tab(page, 'Proposed').locator('.c')).toHaveClass(/needs/);
    await expect(tab(page, 'Chosen').locator('.c')).toHaveText('1');
    const entries = rounds(page).getByRole('button');
    await expect(entries).toHaveCount(2);
    await expect(entries.nth(0)).toContainText(LOOK_TITLE);
    await expect(entries.nth(1)).toContainText('Pick the lag legend');
    for (const e of await entries.all()) {
      await expect(e).toContainText('round 1');
      await expect(e.locator('.needs')).toHaveText('waiting for you');
    }
    // The oldest round shows first.
    await expect(entries.nth(0)).toHaveAttribute('aria-current', 'true');
    await expect(page.getByRole('heading', { level: 2, name: LOOK_TITLE })).toBeVisible();
    await expect(page.locator('iframe.cframe')).toHaveAttribute('title', 'Quiet board');

    await entries.nth(1).click();
    await expect(page).toHaveURL(/round=legend-1/);
    await expect(page.getByRole('heading', { level: 2, name: 'Pick the lag legend' })).toBeVisible();
    await expect(page.locator('iframe.cframe')).toHaveAttribute('title', 'Lag bars');
    await expect(page.locator('.cpanel .src')).toHaveText('impeccable');
    await expect(page.locator('.view a[target="_blank"]')).toHaveCount(0);
    await expect(page.locator('.view iframe:not([sandbox="allow-scripts allow-same-origin"])')).toHaveCount(0);

    await page.getByRole('button', { name: 'Pick this' }).click();
    await expect(tab(page, 'Chosen').locator('.c')).toHaveText('2');
    expect(answers('legend-1')).toMatchObject({ choice: 'lag-bars' });
    await expect(tab(page, 'Proposed').locator('.c')).toHaveText('1');
  });

  test('keeps a round it answered shown, read-only, with its outcome', async ({ page }) => {
    await page.goto(urlFor('concepts', '#/concepts/proposed'));
    await expect(page.getByRole('heading', { level: 2, name: LOOK_TITLE })).toBeVisible();
    const before = await page.evaluate(() => history.length);
    await page.getByRole('button', { name: 'Pick this' }).click();
    await expect(tab(page, 'Proposed').locator('.c')).toHaveText('1');
    expect(answers('look')).toMatchObject({ choice: 'quiet-board' });
    // The address names the answered round, in place of the old entry.
    await expect(page).toHaveURL(/#\/concepts\/proposed\?round=look$/);
    expect(await page.evaluate(() => history.length)).toBe(before);
    await expect(page.getByRole('heading', { level: 2, name: LOOK_TITLE })).toBeVisible();
    await expect(page.locator('.cround .coutcome')).toHaveText('Picked Quiet board');
    await expect(page.getByRole('button', { name: 'Pick this' })).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'See it in Chosen' })).toHaveAttribute('href', '#/concepts/chosen?topic=look');
    // The round still waiting stays one click away.
    await expect(rounds(page).getByRole('button')).toHaveCount(1);
    await expect(rounds(page).getByRole('button')).toContainText('Pick the lag legend');
  });

  test('says so when a round was answered elsewhere, and shows that answer', async ({ page }) => {
    // No live updates in this tab, so it still offers the buttons after the other answer is in.
    await page.route('**/api/events', (route) => route.abort());
    await page.goto(urlFor('concepts', '#/concepts/proposed?round=legend-1'));
    await expect(page.getByRole('button', { name: 'Pick this' })).toBeEnabled();
    await answer(page, 'legend-1', { choice: 'lag-dots', note: 'From the other tab' });
    await page.getByRole('button', { name: 'Pick this' }).click();
    await expect(page.getByRole('alert')).toContainText('This gate was already answered, perhaps in another tab. The recorded answer is shown below.');
    await expect(page.getByRole('heading', { level: 2, name: 'Pick the lag legend' })).toBeVisible();
    await expect(page.locator('.cround .coutcome')).toHaveText('Picked Lag dots');
    await expect(page.getByRole('list', { name: 'Options' }).getByRole('button', { name: 'Lag dots', exact: true })).toHaveAttribute('data-kept', 'true');
    await expect(page.getByRole('button', { name: 'Pick this' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'See it in Chosen' })).toHaveAttribute('href', '#/concepts/chosen?topic=legend');
    expect(answers('legend-1')).toMatchObject({ choice: 'lag-dots', note: 'From the other tab' });
  });

  test('combines options, then keeps the round shown read-only', async ({ page }) => {
    await page.goto(urlFor('concepts', '#/concepts/proposed?round=look'));
    const strip = page.getByRole('list', { name: 'Options' });
    for (const label of ['Quiet board', 'Dense table']) {
      await strip.getByRole('button', { name: label, exact: true }).click();
      await page.getByRole('checkbox', { name: 'Combine' }).check();
    }
    await page.getByRole('button', { name: 'Combine 2' }).click();
    await expect(page.locator('.cround .coutcome')).toHaveText('Combined 2 of 2');
    expect(answers('look')).toMatchObject({ choices: ['quiet-board', 'dense-table'] });
    await expect(tab(page, 'Proposed').locator('.c')).toHaveText('1');
    await expect(page.getByRole('heading', { level: 2, name: LOOK_TITLE })).toBeVisible();
    await expect(page.locator('.cround .coutcome')).toHaveText('Combined 2 of 2');
    await expect(page.getByRole('button', { name: /^Combine/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'See it in Chosen' })).toBeVisible();
  });

  test('sends none of these with a note, then keeps the round shown read-only', async ({ page }) => {
    await page.goto(urlFor('concepts', '#/concepts/proposed?round=legend-1'));
    await expect(page.getByRole('button', { name: 'None of these' })).toBeDisabled();
    await page.getByLabel('Note to the agent (needed for none of these)').fill('Neither reads at a glance');
    await page.getByRole('button', { name: 'None of these' }).click();
    await expect(tab(page, 'Proposed').locator('.c')).toHaveText('1');
    expect(answers('legend-1')).toMatchObject({ none: true, note: 'Neither reads at a glance' });
    await expect(page.getByRole('heading', { level: 2, name: 'Pick the lag legend' })).toBeVisible();
    await expect(page.locator('.cround .coutcome')).toHaveText('None of these');
    await expect(page.getByRole('button', { name: 'None of these' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'See it in Chosen' })).toHaveAttribute('href', '#/concepts/chosen?topic=legend');
  });

  test('shows a long option label in full in the strip', async ({ page }) => {
    const long = 'Quiet board with a per-source lag column and a pinned summary row';
    await serveSnapshot(page, (s) => {
      const first = s.gates.find((g) => g.name === 'look')?.request.options?.[0];
      if (first) first.label = long;
    });
    await page.goto(urlFor('concepts', '#/concepts/proposed?round=look'));
    const label = page.getByRole('list', { name: 'Options' }).locator('.clabel').first();
    await expect(label).toHaveText(long);
    expect(await label.evaluate((el) => getComputedStyle(el).textOverflow)).not.toBe('ellipsis');
    // Nothing clipped: the label's box holds all of its text.
    expect(await label.evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)).toBe(true);
  });

  for (const [width, height] of [
    [1920, 1080],
    [2560, 1440],
  ] as const) {
    test(`fits the open round in a ${width}x${height} window, the frame at 16:10`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(urlFor('concepts', '#/concepts/proposed?round=legend-1'));
      const frame = page.locator('.cround iframe.cframe');
      await expect(frame).toHaveAttribute('title', 'Lag bars');
      await expect.poll(() => aboveFold(frame)).toBe(true);
      await expect(page.getByRole('button', { name: 'Pick this' })).toBeInViewport({ ratio: 1 });
      const box = await frame.boundingBox();
      expect(box).not.toBeNull();
      if (box) expect(Math.abs(box.width / box.height - 1.6)).toBeLessThanOrEqual(0.02);
    });
  }

  test('fits the round again once its outcome shows above the frame', async ({ page }) => {
    await page.setViewportSize({ width: 2560, height: 1440 });
    await page.goto(urlFor('concepts', '#/concepts/proposed?round=legend-1'));
    const frame = page.locator('.cround iframe.cframe');
    await expect(frame).toHaveAttribute('title', 'Lag bars');
    await expect.poll(() => aboveFold(frame)).toBe(true);
    await page.getByRole('button', { name: 'Pick this' }).click();
    await expect(page.locator('.cround .coutcome')).toHaveText('Picked Lag bars');
    await expect(page.getByRole('link', { name: 'See it in Chosen' })).toBeVisible();
    await expect.poll(() => aboveFold(frame)).toBe(true);
  });

  test('keeps the frame at least 360 tall in a 1280x800 window', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(urlFor('concepts', '#/concepts/proposed?round=legend-1'));
    const frame = page.locator('.cround iframe.cframe');
    await expect(frame).toHaveAttribute('title', 'Lag bars');
    await expect.poll(async () => (await frame.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(360);
  });

  test('compares two options without red, and fits the pair in a 1920x1080 window', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(urlFor('concepts', '#/concepts/proposed?round=legend-1'));
    const strip = page.getByRole('list', { name: 'Options' });
    for (const label of ['Lag bars', 'Lag dots']) {
      await strip.getByRole('button', { name: label, exact: true }).click();
      await page.getByRole('checkbox', { name: 'Combine' }).check();
    }
    await page.locator('.cview-bar').getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(page.locator('.cpair iframe')).toHaveCount(2);
    expect(await signalUses(page, '.cround')).toEqual([]);
    for (const pick of await page.locator('.cpair').getByRole('button', { name: 'Pick', exact: true }).all()) await expect(pick).toBeInViewport({ ratio: 1 });
    await page.getByRole('button', { name: 'Swipe' }).click();
    await expect(page.locator('.cswipe iframe')).toHaveCount(2);
    expect(await signalUses(page, '.cround')).toEqual([]);
    await expect(page.getByRole('slider', { name: 'Reveal' })).toBeInViewport({ ratio: 1 });
  });

  test('puts no frame inside a button, and selects an option from its thumbnail', async ({ page }) => {
    await page.goto(urlFor('concepts', '#/concepts/proposed?round=legend-1'));
    const strip = page.getByRole('list', { name: 'Options' });
    await expect(strip.locator('iframe')).toHaveCount(2);
    await expect(page.locator('button iframe')).toHaveCount(0);
    for (const label of ['Lag bars', 'Lag dots']) await expect(strip.getByRole('button', { name: label, exact: true })).toBeVisible();
    await clickThumb(page, strip.locator('li').filter({ hasText: 'Lag dots' }).locator('.cthumb-box'));
    await expect(strip.getByRole('button', { name: 'Lag dots', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.cround iframe.cframe')).toHaveAttribute('title', 'Lag dots');
  });

  test('shows a page no round uses in a sandboxed frame', async ({ page }) => {
    await page.goto(urlFor('concepts', '#/concepts'));
    const unused = page.getByRole('region', { name: 'Not in a round' });
    await expect(unused.getByRole('button')).toHaveCount(2);
    const scratch = unused.getByRole('button', { name: /^Scratch/ });
    await expect(scratch).toContainText('concepts/scratch.html');
    await expect(unused.locator('iframe')).toHaveCount(0);
    await scratch.click();
    await expect(page).toHaveURL(/page=concepts\/scratch\.html/);
    const frame = unused.locator('iframe.cframe');
    await expect(frame).toHaveAttribute('title', 'Scratch');
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin');
    await expect(frame).toHaveAttribute('src', /concepts\/scratch\.html$/);
  });

  test('loads the font, module and data beside a page', async ({ page }) => {
    await page.goto(urlFor('concepts', '#/concepts'));
    await page.getByRole('region', { name: 'Not in a round' }).getByRole('button', { name: /concepts\/assets-check\/page\.html/ }).click();
    await expect(page.locator('.cunused iframe.cframe')).toHaveAttribute('src', /assets-check\/page\.html$/);
    // Without the hash: the cockpit's own address names the page too, in its hash.
    const found = () => page.frames().find((f) => (f.url().split('#')[0] ?? '').endsWith('/assets-check/page.html'));
    await expect.poll(() => found() !== undefined).toBe(true);
    const frame = found();
    if (!frame) throw new Error('the assets-check frame is gone');
    await expect
      .poll(() => frame.evaluate(() => (window as unknown as { check?: Record<string, unknown> }).check))
      .toEqual({ font: true, module: 'module loaded', data: { data: 'fetched' } });
  });

  test('says when nothing waits, and Chosen says when nothing was chosen', async ({ page }) => {
    await serveSnapshot(page, (s) => {
      s.gates = s.gates.filter((g) => g.request.type !== 'concept-pick');
    });
    await page.goto(urlFor('concepts', '#/concepts/proposed'));
    await expect(page.getByText('Nothing to choose right now')).toBeVisible();
    await expect(tab(page, 'Proposed').locator('.c')).toHaveText('0');
    await expect(tab(page, 'Proposed').locator('.c')).not.toHaveClass(/needs/);
    await tab(page, 'Chosen').click();
    await expect(page).toHaveURL(/#\/concepts\/chosen/);
    await expect(page.getByText('Nothing chosen yet')).toBeVisible();
  });
});

test.describe('Chosen', () => {
  test('See it in Chosen keeps the selected phase, and lands on the round’s topic', async ({ page }) => {
    await page.goto(urlFor('concepts', '#/concepts/proposed?phase=replay&round=status-look-3'));
    const link = page.getByRole('link', { name: 'See it in Chosen' });
    await expect(link).toHaveAttribute('href', /phase=replay/);
    await link.click();
    await expect(page.locator('h2.ctopic')).toHaveText(STATUS_TITLE);
    await expect(lineage(page)).toHaveCount(3);
  });
  test('counts a topic’s rounds in the selected phase only', async ({ page }) => {
    // status-look was refined in dashboard, but all three of its rounds were in replay.
    await page.goto(urlFor('concepts', '#/concepts/chosen?phase=dashboard&topic=status-look'));
    await expect(topics(page).getByRole('button', { name: new RegExp(STATUS_TITLE) })).toContainText('0 rounds');
    await page.goto(urlFor('concepts', '#/concepts/chosen?phase=all&topic=status-look'));
    await expect(topics(page).getByRole('button', { name: new RegExp(STATUS_TITLE) })).toContainText('3 rounds');
  });
  test('shows the pick and the lineage of its rounds', async ({ page }) => {
    await page.goto(urlFor('concepts', '#/concepts/chosen?phase=replay'));
    await expect(tab(page, 'Chosen')).toHaveAttribute('aria-selected', 'true');
    await expect(topics(page).getByRole('button')).toHaveCount(1);
    await expect(topics(page).getByRole('button')).toContainText(STATUS_TITLE);
    await expect(topics(page).getByRole('button')).toContainText('3 rounds');

    const pick = page.locator('.cpick');
    await expect(pick.locator('.cpick-label')).toHaveText('Board top');
    await expect(pick.locator('.src')).toHaveText('self');
    await expect(pick.getByRole('link', { name: 'Open its gate' })).toHaveAttribute('href', '#/gate/status-look-3');
    await expect(pick.locator('time[data-volatile]')).toHaveCount(1);

    await expect(lineage(page)).toHaveCount(3);
    await expect(lineage(page).locator('.lout')).toHaveText(['Round 1 · None of these', 'Round 2 · Combined 2 of 3', 'Round 3 · Picked Board top']);
    await expect(lineage(page).locator('.ltitle')).toHaveText([STATUS_TITLE, STATUS_TITLE, STATUS_TITLE]);
    await expect(lineage(page).locator('q')).toHaveText(['Too cold for an ops screen', 'The calm board with the split detail']);
    const second = lineage(page).nth(1).getByRole('button');
    await expect(second).toHaveCount(3);
    const kept = await Promise.all((await second.all()).map((b) => b.getAttribute('data-kept')));
    expect(kept).toEqual(['true', 'false', 'true']);
    await expect(page.locator('.view a[target="_blank"]')).toHaveCount(0);
    await expect(page.locator('.view iframe:not([sandbox="allow-scripts allow-same-origin"])')).toHaveCount(0);

    await lineage(page).nth(1).getByRole('button', { name: 'Stacked list' }).click();
    const full = page.locator('.cfull');
    await expect(full).toBeVisible();
    await expect(full.locator('iframe.cframe')).toHaveAttribute('title', 'Stacked list');
    await expect(full.locator('iframe.cframe')).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin');
    await expect(full.getByRole('button', { name: 'Back' })).toBeFocused();
    await expect(full.locator('.chint')).toHaveText('Back to return');
    await page.keyboard.press('Escape');
    await expect(full).toHaveCount(0);
    await lineage(page).nth(0).getByRole('button', { name: 'Ledger' }).click();
    await page.locator('.cfull').getByRole('button', { name: 'Back' }).click();
    await expect(page.locator('.cfull')).toHaveCount(0);
  });

  test('puts no frame inside a button, and opens a page from its thumbnail', async ({ page }) => {
    await page.goto(urlFor('concepts', '#/concepts/chosen?phase=replay'));
    await expect(lineage(page)).toHaveCount(3);
    await expect(page.locator('.chosen iframe')).not.toHaveCount(0);
    await expect(page.locator('button iframe')).toHaveCount(0);
    const options = lineage(page).nth(1).locator('.lthumbs > li');
    await expect(options).toHaveCount(3);
    for (const li of await options.all()) {
      const label = (await li.locator('.clabel').textContent()) ?? '';
      // The name is the label, then whether the round kept or dropped it.
      await expect(li.getByRole('button', { name: new RegExp(`^${label}\\s*, (kept|dropped)$`) })).toBeVisible();
    }
    await clickThumb(page, options.filter({ hasText: 'Stacked list' }).locator('.cthumb-box'));
    await expect(page.locator('.cfull iframe.cframe')).toHaveAttribute('title', 'Stacked list');
    await page.keyboard.press('Escape');
    await expect(page.locator('.cfull')).toHaveCount(0);
    await clickThumb(page, page.locator('.cpick .cthumb-box'));
    await expect(page.locator('.cfull iframe.cframe')).toHaveAttribute('title', 'Board top');
  });

  test('tells assistive tech which options each round kept and dropped', async ({ page }) => {
    await page.goto(urlFor('concepts', '#/concepts/chosen?phase=replay'));
    const second = page.locator('.lineage > li').nth(1).locator('.lthumbs');
    await expect(second.getByRole('button', { name: /, kept$/ })).toHaveCount(2);
    await expect(second.getByRole('button', { name: /, dropped$/ })).toHaveCount(1);
    // The visible label stays as it was.
    await expect(second.locator('button .clabel').first()).not.toContainText('kept');
  });
  test('keeps a dropped option’s label as readable as a kept one’s, in the dark', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('nexus.theme', 'dark'));
    await page.goto(urlFor('concepts', '#/concepts/chosen?phase=replay'));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const second = '.lineage > li:nth-child(2) .lthumbs > li';
    const kept = `${second}:has(button[data-kept="true"]) .clabel`;
    const dropped = `${second}:has(button[data-kept="false"]) .clabel`;
    await expect(page.locator(dropped)).toHaveCount(1);
    expect(await shownOpacity(page, dropped)).toBe(1);
    const colour = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).color);
    expect(await colour(dropped)).toBe(await colour(kept));
  });

  test('shows the example look, once answered, as a one-round topic with no source tag', async ({ page }) => {
    await page.goto(urlFor('concepts', '#/concepts/proposed'));
    await answer(page, 'look', { choice: 'dense-table' });
    await page.goto(urlFor('concepts', '#/concepts/chosen?topic=look'));
    await expect(topics(page).getByRole('button')).toHaveCount(2);
    const entry = topics(page).getByRole('button', { name: new RegExp(LOOK_TITLE) });
    await expect(entry).toHaveAttribute('aria-current', 'true');
    await expect(entry.locator('.cnum')).toHaveText('1 round');
    await expect(page.locator('.ctopic')).toHaveText(LOOK_TITLE);
    const pick = page.locator('.cpick');
    await expect(pick.locator('.cpick-label')).toHaveText('Dense table');
    await expect(pick.locator('.src')).toHaveCount(0);
    await expect(pick.getByRole('link', { name: 'Open its gate' })).toHaveAttribute('href', '#/gate/look');
    await expect(lineage(page)).toHaveCount(1);
    await expect(lineage(page).locator('.lout')).toHaveText('Round 1 · Picked Dense table');
    await expect(lineage(page).locator('.ltitle')).toHaveText(LOOK_TITLE);
  });

  test('selects a topic from the address', async ({ page }) => {
    await serveSnapshot(page, (s) => {
      const legend = s.gates.find((g) => g.name === 'legend-1');
      if (legend) legend.answers = { gate: 'legend-1', submitted: '2026-10-02T19:10:00Z', choice: 'lag-dots' };
    });
    await page.goto(urlFor('concepts', '#/concepts/chosen?phase=replay'));
    // Most recently answered first.
    await expect(topics(page).getByRole('button')).toHaveCount(2);
    await expect(topics(page).getByRole('button').nth(0)).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('.cpick-label')).toHaveText('Lag dots');
    await page.goto(urlFor('concepts', '#/concepts/chosen?phase=replay&topic=status-look'));
    await expect(topics(page).getByRole('button', { name: new RegExp(STATUS_TITLE) })).toHaveAttribute('aria-current', 'true');
    await expect(topics(page).getByRole('button', { name: /Pick the lag legend/ })).not.toHaveAttribute('aria-current', 'true');
    await expect(page.locator('.cpick-label')).toHaveText('Board top');
    await expect(topics(page).getByRole('button', { name: /Pick the lag legend/ })).toContainText('1 round');
  });

  test('says when a topic waits for the next round', async ({ page }) => {
    await serveSnapshot(page, (s) => {
      s.gates = s.gates.filter((g) => g.name !== 'status-look-3');
    });
    await page.goto(urlFor('concepts', '#/concepts/chosen?phase=replay'));
    await expect(page.getByText("Waiting for the agent's next round")).toBeVisible();
    await expect(page.locator('.cpick-label')).toHaveCount(0);
    await expect(lineage(page)).toHaveCount(2);
  });

  test('links a topic with an open round to it in Proposed', async ({ page }) => {
    await serveSnapshot(page, (s) => {
      const third = s.gates.find((g) => g.name === 'status-look-3');
      if (third) third.answers = null;
    });
    await page.goto(urlFor('concepts', '#/concepts/chosen?phase=replay'));
    const link = page.getByRole('link', { name: 'Round 3 is waiting for you' });
    await expect(link).toHaveAttribute('href', '#/concepts/proposed?round=status-look-3');
    await expect(lineage(page).nth(2)).toHaveAttribute('data-outcome', 'open');
    expect(await signalUses(page, '.view-body')).toEqual([]);
    await link.click();
    await expect(page.getByRole('heading', { level: 2, name: STATUS_TITLE })).toBeVisible();
    await expect(rounds(page).getByRole('button', { name: /round 3/ })).toHaveAttribute('aria-current', 'true');
  });

  test('lists the topic’s refinements in its rounds’ phase, the later phase’s behind Show all phases', async ({ page }) => {
    await page.goto(urlFor('concepts', '#/concepts/chosen?phase=replay'));
    const refinements = page.locator('.crefine');
    await expect(refinements.getByRole('heading', { name: 'Refinements' })).toBeVisible();
    await expect(refinements.locator('li')).toHaveCount(1);
    await expect(refinements.locator('li p')).toHaveText('Warmed the legend colours after trying a live variant');
    await expect(refinements.locator('li .cmeta')).toContainText('live 14:02');
    await expect(refinements.locator('li .cmeta')).toContainText('changes');
    await expect(refinements.locator('li time[data-volatile]')).toHaveCount(1);
    await page.getByRole('link', { name: 'Show all phases' }).click();
    await expect(page).toHaveURL(/phase=all/);
    await expect(refinements.locator('li p')).toHaveText(['Warmed the legend colours after trying a live variant', 'Tightened the row spacing on the dashboard']);
    await expect(page.getByRole('link', { name: 'Show all phases' })).toHaveCount(0);
  });

  test('lists a topic refined in a later phase under that phase: its pick and refinement, none of its rounds', async ({ page }) => {
    await page.goto(urlFor('concepts', '#/concepts/chosen'));
    await expect(page.locator('.phase-select select')).toHaveValue('dashboard');
    await expect(tab(page, 'Chosen').locator('.c')).toHaveText('1');
    await expect(topics(page).getByRole('button')).toHaveCount(1);
    await expect(topics(page).getByRole('button')).toContainText(STATUS_TITLE);
    await expect(page.locator('.cpick .cpick-label')).toHaveText('Board top');
    await expect(lineage(page)).toHaveCount(0);
    const refinements = page.locator('.crefine li');
    await expect(refinements.locator('p')).toHaveText(['Tightened the row spacing on the dashboard']);
    await page.getByRole('link', { name: 'Show all phases' }).click();
    await expect(page).toHaveURL(/phase=all/);
    await expect(lineage(page)).toHaveCount(3);
    await expect(refinements).toHaveCount(2);
  });

  test('a topic without refinements has no Refinements heading', async ({ page }) => {
    await serveSnapshot(page, (s) => {
      s.logs.changes = s.logs.changes.filter((e) => e.topic !== 'status-look');
    });
    await page.goto(urlFor('concepts', '#/concepts/chosen?phase=replay'));
    await expect(page.locator('.cpick')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Refinements' })).toHaveCount(0);
  });

  test('shows only the selected phase’s rounds, and open rounds under every phase', async ({ page }) => {
    await serveSnapshot(page, (s) => {
      s.build?.phases?.unshift({ name: 'design', branch: 'build/relay-rebuild-design', started: '2026-10-02T10:00:00Z', finished: '2026-10-02T11:00:00Z' });
      const first = s.gates.find((g) => g.name === 'status-look-1');
      if (first) first.request.phase = 'design';
    });
    await page.goto(urlFor('concepts', '#/concepts/chosen?phase=replay'));
    await expect(page.locator('.phase-select select')).toHaveValue('replay');
    await expect(lineage(page)).toHaveCount(2);
    await expect(lineage(page).locator('.lout')).toHaveText(['Round 2 · Combined 2 of 3', 'Round 3 · Picked Board top']);
    await page.getByRole('link', { name: 'Show all phases' }).click();
    await expect(page).toHaveURL(/phase=all/);
    await expect(lineage(page)).toHaveCount(3);
    await expect(page.getByRole('link', { name: 'Show all phases' })).toHaveCount(0);

    for (const phase of ['replay', 'design']) {
      await page.goto(urlFor('concepts', `#/concepts/proposed?phase=${phase}`));
      await expect(rounds(page).getByRole('button', { name: /Pick the lag legend/ })).toBeVisible();
    }
  });

  test('lists a topic in Chosen only under a phase it has rounds or refinements in', async ({ page }) => {
    // Every status-look round in an earlier phase, the last one open, and its only refinement in dashboard: it waits
    // in Proposed whatever the phase, but Chosen under replay has none of its rounds or refinements to show.
    await serveSnapshot(page, (s) => {
      s.build?.phases?.unshift({ name: 'design', branch: 'build/relay-rebuild-design', started: '2026-10-02T10:00:00Z', finished: '2026-10-02T11:00:00Z' });
      for (const g of s.gates) if (g.name.startsWith('status-look-')) g.request.phase = 'design';
      const third = s.gates.find((g) => g.name === 'status-look-3');
      if (third) third.answers = null;
      s.logs.changes = s.logs.changes.filter((e) => e.phase !== 'replay');
    });
    await page.goto(urlFor('concepts', '#/concepts/chosen?phase=replay'));
    await expect(tab(page, 'Chosen').locator('.c')).toHaveText('0');
    await expect(page.getByText('Nothing chosen yet')).toBeVisible();
    await page.goto(urlFor('concepts', '#/concepts/chosen?phase=design'));
    await expect(tab(page, 'Chosen').locator('.c')).toHaveText('1');
    await expect(lineage(page)).toHaveCount(3);
    await page.goto(urlFor('concepts', '#/concepts/chosen?phase=dashboard'));
    await expect(tab(page, 'Chosen').locator('.c')).toHaveText('1');
    await expect(lineage(page)).toHaveCount(0);
    await expect(page.locator('.crefine li')).toHaveCount(1);
    await page.goto(urlFor('concepts', '#/concepts/proposed'));
    await expect(rounds(page).getByRole('button', { name: /round 3/ })).toBeVisible();
  });
});

test('the rail counts topics and marks open rounds until both are answered', async ({ page }) => {
  await page.goto(urlFor('concepts', '#/concepts'));
  await expect(railConcepts(page)).toHaveText('3');
  await expect(railConcepts(page)).toHaveClass(/needs/);
  await answer(page, 'legend-1', { choice: 'lag-dots' });
  await answer(page, 'look', { choice: 'quiet-board' });
  await expect(railConcepts(page)).not.toHaveClass(/needs/);
  await expect(railConcepts(page)).toHaveText('3');
});

/** Every iframe under the selector: its src is on another origin than the cockpit, and it keeps that origin. */
async function expectOwnOrigin(page: Page, selector: string): Promise<void> {
  const frames = page.locator(`${selector} iframe`);
  await expect(frames).not.toHaveCount(0);
  const here = new URL(page.url()).origin;
  for (const f of await frames.all()) {
    await expect(f).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin');
    const src = (await f.getAttribute('src')) ?? '';
    expect(new URL(src, page.url()).origin).not.toBe(here);
  }
}

test('serves every concept frame from an origin of its own', async ({ page }) => {
  await page.goto(urlFor('concepts', '#/concepts/proposed?round=legend-1&page=concepts/scratch.html'));
  await expect(page.locator('.cunused iframe.cframe')).toHaveCount(1);
  await expectOwnOrigin(page, '.view');
  await page.goto(urlFor('concepts', '#/concepts/chosen?phase=replay'));
  await expect(lineage(page)).toHaveCount(3);
  await lineage(page).nth(1).getByRole('button', { name: 'Stacked list' }).click();
  await expect(page.locator('.cfull iframe.cframe')).toHaveCount(1);
  await expectOwnOrigin(page, '.view');
  await page.goto(urlFor('concepts', '#/gate/status-look-3'));
  await expect(page.locator('.cround')).toBeVisible();
  await expectOwnOrigin(page, '.cround');
});

test.describe('the Gate view', () => {
  test('links a later round to its topic, and opens an answered round on its kept option', async ({ page }) => {
    await page.goto(urlFor('concepts', '#/gate/status-look-3'));
    const crumb = page.locator('.crumb');
    await expect(crumb).toHaveText(`Earlier rounds: ${STATUS_TITLE}`);
    await expect(crumb.getByRole('link')).toHaveAttribute('href', '#/concepts/chosen?topic=status-look');
    await expect(page.locator('.cround .ccount')).toHaveText('2 of 2');
    await expect(page.getByRole('list', { name: 'Options' }).getByRole('button', { name: 'Board top', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await crumb.getByRole('link').click();
    await expect(tab(page, 'Chosen')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.cpick-label')).toHaveText('Board top');
  });

  test('compares two options of an answered round, with no Pick', async ({ page }) => {
    await page.goto(urlFor('concepts', '#/gate/status-look-1'));
    const strip = page.getByRole('list', { name: 'Options' });
    await expect(page.getByRole('checkbox', { name: 'Combine' })).toHaveCount(0);
    for (const label of ['Signal wall', 'Ledger']) {
      await strip.getByRole('button', { name: label, exact: true }).click();
      await page.getByRole('checkbox', { name: 'Compare' }).check();
    }
    await page.locator('.cview-bar').getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(page.locator('.cpair iframe')).toHaveCount(2);
    await expect(page.locator('.cpair figcaption')).toContainText(['Signal wall', 'Ledger']);
    await expect(page.locator('.cpair figure').nth(0).getByRole('checkbox', { name: 'Compare Signal wall' })).toBeChecked();
    await expect(page.locator('.cpair figure').nth(1).getByRole('checkbox', { name: 'Compare Ledger' })).toBeChecked();
    await expect(page.locator('.cround').getByRole('button', { name: /^Pick/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Swipe' }).click();
    await expect(page.locator('.cswipe iframe')).toHaveCount(2);
    await expect(page.locator('.cround').getByRole('button', { name: /^Pick/ })).toHaveCount(0);
  });

  test('unticking a compared option keeps focus in the round, on that option', async ({ page }) => {
    await page.goto(urlFor('concepts', '#/gate/status-look-1'));
    const strip = page.getByRole('list', { name: 'Options' });
    for (const label of ['Signal wall', 'Ledger']) {
      await strip.getByRole('button', { name: label, exact: true }).click();
      await page.getByRole('checkbox', { name: 'Compare' }).check();
    }
    await page.locator('.cview-bar').getByRole('button', { name: 'Compare', exact: true }).click();
    const box = page.locator('.cpair figure').nth(1).getByRole('checkbox', { name: 'Compare Ledger' });
    await box.focus();
    await page.keyboard.press('Space');
    await expect(page.locator('.cpair')).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
    await expect(strip.getByRole('button', { name: 'Ledger', exact: true })).toBeFocused();
  });

  test('fits the frame again when the problems notice appears above it', async ({ page }) => {
    const issues = join(buildDir('concepts'), 'logs', 'issues.json');
    const good = readFileSync(issues, 'utf8');
    await page.setViewportSize({ width: 2560, height: 1440 });
    await page.goto(urlFor('concepts', '#/concepts/proposed?round=legend-1'));
    const frame = page.locator('.cround iframe.cframe');
    await expect.poll(() => aboveFold(frame)).toBe(true);
    try {
      writeFileSync(issues, '{ not json');
      await expect(page.getByRole('region', { name: 'Files that need fixing' })).toBeVisible();
      await expect.poll(() => aboveFold(frame)).toBe(true);
    } finally {
      writeFileSync(issues, good);
    }
  });

  test('shows no earlier-rounds line for a one-round topic, or on a first round', async ({ page }) => {
    await page.goto(urlFor('concepts', '#/gate/legend-1'));
    await expect(page.locator('.cround')).toBeVisible();
    await expect(page.locator('.crumb')).toHaveCount(0);
    await page.goto(urlFor('concepts', '#/gate/status-look-1'));
    await expect(page.locator('.cround .coutcome')).toHaveText('None of these');
    await expect(page.locator('.crumb')).toHaveCount(0);
    await page.goto(urlFor('concepts', '#/gate/status-look-2'));
    await expect(page.locator('.crumb')).toHaveText(`Earlier rounds: ${STATUS_TITLE}`);
  });
});
