import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { RepoSnapshot } from '../../core/types.ts';
import type { ViewDef } from '../../core/vault/types.ts';
import type { TableData, ViewAnswer } from '../../core/views/types.ts';
import { guarded, rootOf, urlFor } from './fixtures';

test('the Views section lists every declared view and opens the first', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/views'));
  await expect(page.getByRole('tablist', { name: 'Views' }).getByRole('tab')).toHaveText([/Lag trend/, /Runbook/, /Screens/, /Traffic load/]);
  await expect(page.locator('.view-desc')).toContainText('Replay lag per day');
});

test('a table view sorts as declared, sorts on a header click, and searches', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/views?view=traffic-load'));
  const table = page.locator('table.vtable');
  await expect(table.locator('tbody tr').first()).toContainText('North');
  await table.getByRole('button', { name: /^requests/ }).click();
  await expect(table.locator('tbody tr').first()).toContainText('East');
  await page.getByRole('searchbox', { name: 'Search this table' }).fill('south');
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(table.locator('td.num').first()).toHaveCSS('text-align', 'right');
});

test('a markdown view renders its file, diagram included', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/views?view=runbook'));
  await expect(page.locator('.view-body .md h1')).toHaveText('Replay runbook');
  await expect(page.locator('.view-body .md-mermaid svg')).toBeVisible();
});

test('the Views section says how to add one when a vault has none', async ({ page }) => {
  // The repo fixture with its views taken away: a vault, but nothing declared.
  await page.route(
    /\/api\/repo$/,
    guarded(async (route) => {
      const res = await route.fetch();
      const repo = (await res.json()) as RepoSnapshot;
      repo.views = [];
      await route.fulfill({ response: res, json: repo });
    }),
  );
  await page.goto(urlFor('repo', '#/repo/views'));
  await expect(page.getByText('No views yet')).toBeVisible();
  await expect(page.getByText('Declare one in docs/_meta/views/')).toBeVisible();
  await expect(page.getByText('nexus init')).toHaveCount(0);
  await page.getByRole('link', { name: 'How to declare a view' }).click();
  await expect(page).toHaveURL(/#\/guidance\/views$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Views' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Views/ })).toHaveAttribute('aria-selected', 'true');
});

test('with no vault, the Views section says to run nexus init first, since views live in the vault', async ({ page }) => {
  await page.goto(urlFor('empty', '#/repo/views'));
  await expect(page.getByText('No vault yet.')).toBeVisible();
  await expect(page.locator('.empty')).toContainText('Run nexus init or /nexus:init to set the repo up; views are then declared in docs/_meta/views/.');
  await expect(page.getByText('No views yet')).toHaveCount(0);
  await page.getByRole('link', { name: 'How to declare a view' }).click();
  await expect(page).toHaveURL(/#\/guidance\/views$/);
});

/** Records, on every change to the view body, whether it says it is loading. */
async function watchLoading(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { loading_: boolean[] };
    w.loading_ = [];
    const record = () => w.loading_.push((document.querySelector('.view-body')?.textContent ?? '').includes('Loading…'));
    new MutationObserver(record).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  return () => page.evaluate(() => (window as unknown as { loading_: boolean[] }).loading_);
}

/** Rewrites a file in the repo fixture while `during` runs, then puts it back and waits for `restored`. */
async function withFile(rel: string[], edit: (before: string) => string, during: () => Promise<void>, restored: () => Promise<void>) {
  const file = join(rootOf('repo'), ...rel);
  const before = readFileSync(file, 'utf8');
  try {
    writeFileSync(file, edit(before));
    await during();
  } finally {
    writeFileSync(file, before);
  }
  await restored();
}

test('a change to the open view’s data updates it in place, with no loading flash', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/views?view=traffic-load'));
  const rows = page.locator('table.vtable tbody tr');
  await expect(rows).toHaveCount(3);
  const loading = await watchLoading(page);
  await withFile(
    ['data', 'traffic-load.csv'],
    (before) => `${before}West,50,1\n`,
    () => expect(rows).toHaveCount(4, { timeout: 10_000 }),
    () => expect(rows).toHaveCount(3, { timeout: 10_000 }),
  );
  const frames = await loading();
  expect(frames.length).toBeGreaterThan(0);
  expect(frames.filter(Boolean)).toEqual([]);
});

test('a reread that adds a column keeps the sort on its column', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/views?view=traffic-load'));
  const table = page.locator('table.vtable');
  await expect(table.locator('tbody tr').first()).toContainText('North');
  await withFile(
    ['data', 'traffic-load.csv'],
    () => 'id,region,requests,errors\n1,North,412,3\n2,South,388,9\n3,East,97,0\n',
    async () => {
      await expect(table.locator('thead')).toContainText('id', { timeout: 10_000 });
      // Still requests, descending: by position the sort would now be on region, putting South first.
      await expect(table.locator('th[aria-sort="descending"]')).toHaveText(/requests/);
      await expect(table.locator('tbody tr').first()).toContainText('North');
    },
    () => expect(table.locator('thead')).not.toContainText('id', { timeout: 10_000 }),
  );
});

test('a changed sort in the view’s note applies on the next read', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/views?view=traffic-load'));
  const table = page.locator('table.vtable');
  await expect(table.locator('tbody tr').first()).toContainText('North');
  await withFile(
    ['docs', '_meta', 'views', 'traffic-load.md'],
    (before) => before.replace('"column":"requests","dir":"desc"', '"column":"region","dir":"asc"'),
    async () => {
      await expect(table.locator('th[aria-sort="ascending"]')).toHaveText(/region/, { timeout: 10_000 });
      await expect(table.locator('tbody tr').first()).toContainText('East');
    },
    () => expect(table.locator('th[aria-sort="descending"]')).toHaveText(/requests/, { timeout: 10_000 }),
  );
});

test('a chosen sort whose column a reread drops is named, and the declared sort takes over', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/views?view=traffic-load'));
  const table = page.locator('table.vtable');
  await table.getByRole('button', { name: /^errors/ }).click();
  await expect(table.locator('tbody tr').first()).toContainText('East');
  await withFile(
    ['data', 'traffic-load.csv'],
    () => 'region,requests\nNorth,412\nSouth,388\nEast,97\n',
    async () => {
      await expect(page.locator('.view-note')).toHaveText('Not sorted by errors: it’s no longer in the data.', { timeout: 10_000 });
      await expect(table.locator('th[aria-sort="descending"]')).toHaveText(/requests/);
      await expect(table.locator('tbody tr').first()).toContainText('North');
    },
    () => expect(table.locator('thead')).toContainText('errors', { timeout: 10_000 }),
  );
});

for (const value of ['', '%20%20']) {
  test(`an empty view in the URL ("${value}") opens the first view`, async ({ page }) => {
    await page.goto(urlFor('repo', `#/repo/views?view=${value}`));
    await expect(page.getByRole('tab', { selected: true })).toHaveText(/Lag trend/);
    await expect(page.getByText('That view is no longer here.')).toHaveCount(0);
  });
}

const TRAFFIC_LOAD: ViewDef = { name: 'traffic-load', title: 'Traffic load', type: 'table', data: 'data/traffic-load.csv', description: 'Requests per region.', file: 'docs/_meta/views/traffic-load.md' };
const LAG_TREND: ViewDef = { name: 'lag-trend', title: 'Lag trend', type: 'table', data: 'data/lag.csv', description: 'Replay lag per day, in seconds.', file: 'docs/_meta/views/lag-trend.md' };

function regions(): TableData {
  return { kind: 'table', columns: ['region', 'requests', 'errors'], numeric: ['requests', 'errors'], rows: [['North', 412, 3], ['South', 388, 9], ['East', 97, 0]], total: 3 };
}

/** Serves an answer for a view in place of the server's. */
async function serveView(page: Page, name: string, answer: ViewAnswer) {
  await page.route(new RegExp(`/api/repo/views/${name}$`), (route) => route.fulfill({ json: answer }));
}

test('moving to another table starts it with its own sort and an empty search', async ({ page }) => {
  await serveView(page, 'lag-trend', { view: LAG_TREND, data: { kind: 'table', columns: ['day', 'north'], numeric: ['day', 'north'], rows: [[1, 4.2], [2, 3.9], [3, 5.1]], total: 3 }, error: null });
  await page.goto(urlFor('repo', '#/repo/views?view=traffic-load'));
  const table = page.locator('table.vtable');
  await page.getByRole('searchbox', { name: 'Search this table' }).fill('south');
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('tab', { name: /Lag trend/ }).click();
  await expect(table.locator('thead')).toContainText('north');
  await expect(page.getByRole('searchbox', { name: 'Search this table' })).toHaveValue('');
  await expect(table.locator('tbody tr')).toHaveCount(3);
  await expect(table.locator('th[aria-sort="ascending"], th[aria-sort="descending"]')).toHaveCount(0);
});

test('a 10,000-row table renders its first 1,000 rows, and sorts and searches them all', async ({ page }) => {
  const rows = Array.from({ length: 10_000 }, (_, i) => [i + 1, `Region ${i + 1}`, (i * 7919) % 10_007]);
  await serveView(page, 'traffic-load', { view: TRAFFIC_LOAD, data: { kind: 'table', columns: ['id', 'region', 'requests'], numeric: ['id', 'requests'], rows, total: 12_000 }, error: null });
  await page.goto(urlFor('repo', '#/repo/views?view=traffic-load'));
  const table = page.locator('table.vtable');
  const body = page.locator('.view-body');
  await expect(table.locator('tbody tr')).toHaveCount(1_000);
  await expect(body).toContainText('Showing the first 1,000 of 10,000 rows. Search or sort to reach the rest.');
  await expect(body).toContainText('First 10,000 of 12,000 rows.');
  await expect(page.locator('.matches')).toHaveText('10,000 of 12,000');
  await table.getByRole('button', { name: /^id/ }).click();
  await table.getByRole('button', { name: /^id/ }).click();
  // A cell shows its number in full, ungrouped; the cockpit's own counts are grouped.
  await expect(table.locator('tbody tr').first().locator('td').first()).toHaveText('10000');
  await page.getByRole('searchbox', { name: 'Search this table' }).fill('Region 9999');
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(table.locator('tbody tr').first().locator('td').first()).toHaveText('9999');
  await expect(body).not.toContainText('Showing the first');
});

test('a view the URL names that is no longer declared says so, rather than opening another', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/views?view=retired-board'));
  await expect(page.getByText('That view is no longer here.')).toBeVisible();
  await expect(page.locator('.view-body')).toContainText('retired-board');
  await expect(page.getByRole('tab', { selected: true })).toHaveCount(0);
  await expect(page.locator('table.vtable, .view-desc')).toHaveCount(0);
});

test('a declared sort the data lacks, or the view hides, is named', async ({ page }) => {
  await serveView(page, 'traffic-load', { view: { ...TRAFFIC_LOAD, table: { sort: { column: 'load', dir: 'desc' } } }, data: regions(), error: null });
  await serveView(page, 'lag-trend', { view: { ...LAG_TREND, table: { columns: ['region', 'errors'], sort: { column: 'requests', dir: 'asc' } } }, data: regions(), error: null });
  await page.goto(urlFor('repo', '#/repo/views?view=traffic-load'));
  const table = page.locator('table.vtable');
  await expect(page.locator('.view-note')).toHaveText('Not sorted by load: the data has no such column.');
  await expect(table.locator('tbody tr').first()).toContainText('North');
  await page.getByRole('tab', { name: /Lag trend/ }).click();
  // Sorted by the hidden requests column, ascending: East (97) first.
  await expect(page.locator('.view-note')).toHaveText('Sorted by requests, which this view doesn’t show.');
  await expect(table.locator('thead')).not.toContainText('requests');
  await expect(table.locator('tbody tr').first()).toContainText('East');
});

test('a view whose data has a problem names it', async ({ page }) => {
  await serveView(page, 'traffic-load', { view: TRAFFIC_LOAD, data: null, error: 'data/traffic-load.csv: row 3 has 4 cells, the header has 3' });
  await page.goto(urlFor('repo', '#/repo/views?view=traffic-load'));
  await expect(page.getByText("This view can't be shown")).toBeVisible();
  await expect(page.locator('.view-body')).toContainText('row 3 has 4 cells');
});

test('a view the server fails to answer names the failure', async ({ page }) => {
  await page.route(/\/api\/repo\/views\/traffic-load$/, (route) => route.fulfill({ status: 500, json: { error: 'The view could not be read' } }));
  await page.goto(urlFor('repo', '#/repo/views?view=traffic-load'));
  await expect(page.getByText("This view can't be shown")).toBeVisible();
  await expect(page.locator('.view-body')).toContainText('The view could not be read');
});

test('views with problems are listed under the views', async ({ page }) => {
  await page.route(
    /\/api\/repo$/,
    guarded(async (route) => {
      const res = await route.fetch();
      const repo = (await res.json()) as RepoSnapshot;
      await route.fulfill({ response: res, json: { ...repo, problems: ['docs/_meta/views/broken.md: names no data file'] } });
    }),
  );
  await page.goto(urlFor('repo', '#/repo/views'));
  const problems = page.locator('.view-body .problems');
  await expect(problems.getByRole('heading', { name: 'Views with problems' })).toBeVisible();
  await expect(problems).toContainText('docs/_meta/views/broken.md: names no data file');
});

test("a declared canvas view is listed as a problem that says why, and the other views still render", async ({ page }) => {
  const why = "docs/_meta/views/board.md: canvas isn't a view type: JSON Canvas boards live in the vault, where Obsidian shows them";
  await page.route(
    /\/api\/repo$/,
    guarded(async (route) => {
      const res = await route.fetch();
      const repo = (await res.json()) as RepoSnapshot;
      await route.fulfill({ response: res, json: { ...repo, problems: [why] } });
    }),
  );
  await page.goto(urlFor('repo', '#/repo/views'));
  await expect(page.getByRole('tablist', { name: 'Views' }).getByRole('tab')).toHaveText([/Lag trend/, /Runbook/, /Screens/, /Traffic load/]);
  await expect(page.locator('.view-body .problems')).toContainText(why);
  await expect(page.locator('.view-body table.vtable, .view-body .chart-view').first()).toBeVisible();
});

test('a late answer for a view left behind never replaces the open one', async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let asked = false;
  await page.route(/\/api\/repo\/views\/traffic-load$/, async (route) => {
    asked = true;
    await held;
    await route.fulfill({ json: { view: TRAFFIC_LOAD, data: regions(), error: null } satisfies ViewAnswer });
  });
  await page.goto(urlFor('repo', '#/repo/views?view=traffic-load'));
  await expect.poll(() => asked).toBe(true);
  await page.getByRole('tab', { name: /Runbook/ }).click();
  await expect(page.locator('.view-body .md h1')).toHaveText('Replay runbook');
  const finished = page.waitForEvent('requestfinished', (r) => r.url().endsWith('/api/repo/views/traffic-load'));
  release();
  await finished;
  // Two frames after the late answer lands, the open view is still the runbook.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await expect(page.locator('.view-body .md h1')).toHaveText('Replay runbook');
  await expect(page.locator('table.vtable')).toHaveCount(0);
});

test('a chart view draws a line per series with a legend, and reads values by keyboard', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/views?view=lag-trend'));
  const chart = page.locator('.chart-view');
  await expect(chart.locator('svg path[fill="none"]')).toHaveCount(2);
  await expect(chart.locator('.legend li')).toHaveText(['north', 'south']);
  await chart.locator('.chart-frame').focus();
  await page.keyboard.press('ArrowRight');
  await expect(chart.locator('.chart-readout')).toHaveText('day 1: north 4.2, south 6.1');
});

const LAG_CHART: ViewDef = { ...LAG_TREND, type: 'chart', chart: { kind: 'bar', x: 'region', y: 'requests' } };

test('a bar chart draws a bar per value, a lone series needs no legend, and End reads the last', async ({ page }) => {
  await serveView(page, 'lag-trend', { view: LAG_CHART, data: regions(), error: null });
  await page.goto(urlFor('repo', '#/repo/views?view=lag-trend'));
  const chart = page.locator('.chart-view');
  await expect(chart.locator('svg rect')).toHaveCount(3);
  await expect(chart.locator('.legend')).toHaveCount(0);
  await expect(chart.getByRole('group', { name: 'Bar chart of requests by region' })).toBeVisible();
  await chart.locator('.chart-frame').focus();
  await page.keyboard.press('End');
  await expect(chart.locator('.chart-readout')).toHaveText('region East: requests 97');
});

/** Serves a chart of numeric columns for the lag-trend tab. */
async function serveChart(page: Page, chart: NonNullable<ViewDef['chart']>, columns: string[], rows: (number | null)[][], total = rows.length) {
  await serveView(page, 'lag-trend', { view: { ...LAG_TREND, type: 'chart', chart }, data: { kind: 'table', columns, numeric: columns, rows, total }, error: null });
}

/** How many of the canvas's pixels are painted, and whether the one at (x, y), in CSS pixels, is. */
function canvasPaint(chart: Locator, x = 0, y = 0) {
  return chart.locator('canvas.chart-canvas').evaluate(
    (el: HTMLCanvasElement, [cx = 0, cy = 0]) => {
      const ctx = el.getContext('2d');
      const px = ctx?.getImageData(0, 0, el.width, el.height).data ?? [];
      let n = 0;
      for (let i = 3; i < px.length; i += 4) if ((px[i] ?? 0) > 0) n++;
      const ratio = el.width / el.clientWidth;
      const at = ctx?.getImageData(Math.round(cx * ratio), Math.round(cy * ratio), 1, 1).data[3] ?? 0;
      return { painted: n, at: at > 0 };
    },
    [x, y],
  );
}

test('a chart with more than 1,000 marks draws on a canvas', async ({ page }) => {
  await serveChart(page, { kind: 'scatter', x: 'x', y: ['a', 'b'] }, ['x', 'a', 'b'], Array.from({ length: 600 }, (_, i) => [i, i % 50, (i * 7) % 90]));
  await page.goto(urlFor('repo', '#/repo/views?view=lag-trend'));
  const chart = page.locator('.chart-view');
  await expect(chart.locator('canvas.chart-canvas')).toHaveCount(1);
  await expect(chart.locator('.chart-frame svg circle')).toHaveCount(0);
  // The marks are on the canvas: some of its pixels are painted.
  await expect.poll(async () => (await canvasPaint(chart)).painted).toBeGreaterThan(100);
  await expect(chart.locator('.legend li')).toHaveText(['a', 'b']);
});

test('over 1,000 bars draw as bars on a canvas', async ({ page }) => {
  await serveChart(page, { kind: 'bar', x: 'x', y: 'v' }, ['x', 'v'], Array.from({ length: 1_001 }, (_, i) => [i, 10]));
  await page.goto(urlFor('repo', '#/repo/views?view=lag-trend'));
  const chart = page.locator('.chart-view');
  await expect(chart.locator('canvas.chart-canvas')).toHaveCount(1);
  await expect(chart.locator('svg rect')).toHaveCount(0);
  // Every bar runs from 10 down to zero, so the middle of the plot is painted (a dot per value would leave it bare).
  const box = await chart.locator('svg').first().boundingBox();
  await expect.poll(async () => (await canvasPaint(chart, (box?.width ?? 0) / 2, 210)).at).toBe(true);
});

test('an area over 1,000 marks is filled on the canvas', async ({ page }) => {
  await serveChart(page, { kind: 'area', x: 'x', y: 'v' }, ['x', 'v'], Array.from({ length: 1_100 }, (_, i) => [i, 10]));
  await page.goto(urlFor('repo', '#/repo/views?view=lag-trend'));
  const chart = page.locator('.chart-view');
  await expect(chart.locator('canvas.chart-canvas')).toHaveCount(1);
  await expect(chart.locator('svg path')).toHaveCount(0);
  // The line runs along the top at 10; halfway down is only painted if the area under it is filled.
  const box = await chart.locator('svg').first().boundingBox();
  await expect.poll(async () => (await canvasPaint(chart, (box?.width ?? 0) / 2, 210)).at).toBe(true);
});

test('a chart names the rows it leaves out: past the row cap, and with no x', async ({ page }) => {
  await serveChart(page, { kind: 'line', x: 'day', y: 'north' }, ['day', 'north'], [[1, 4.2], [null, 3.9], [null, 4.4], [3, 5.1]], 25_000);
  await page.goto(urlFor('repo', '#/repo/views?view=lag-trend'));
  await expect(page.locator('.chart-view .view-note')).toHaveText('Charts the first 4 of 25,000 rows. 2 rows have no day and aren’t drawn.');
});

test('a chart whose data has no rows says so', async ({ page }) => {
  await serveChart(page, { kind: 'line', x: 'day', y: 'north' }, ['day', 'north'], []);
  await page.goto(urlFor('repo', '#/repo/views?view=lag-trend'));
  await expect(page.locator('.view-body .view-note')).toHaveText('The data has no rows to chart.');
  await expect(page.locator('.chart-view')).toHaveCount(0);
});

test('series past the palette get a second channel: a bar chart names the rest, a scatter changes marker', async ({ page }) => {
  const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const rows = [1, 2, 3].map((x) => [x, ...names.map((_, i) => x + i)]);
  await serveChart(page, { kind: 'bar', x: 'x', y: names }, ['x', ...names], rows);
  await page.goto(urlFor('repo', '#/repo/views?view=lag-trend'));
  const chart = page.locator('.chart-view');
  await expect(chart.locator('.legend li')).toHaveText(names.slice(0, 6));
  await expect(chart.locator('.chart-frame svg rect')).toHaveCount(18);
  await expect(chart.locator('.view-note')).toHaveText('A bar chart shows 6 series at most: g and h aren’t drawn.');
  await page.unrouteAll();
  await serveChart(page, { kind: 'scatter', x: 'x', y: names }, ['x', ...names], rows);
  await page.reload();
  await expect(chart.locator('.legend li')).toHaveText(names);
  await expect(chart.locator('.chart-frame svg circle')).toHaveCount(18);
  await expect(chart.locator('.chart-frame svg path.marker')).toHaveCount(6);
  await expect(chart.locator('.legend li').nth(6).locator('path.marker')).toHaveCount(1);
});

test('a bar chart checks the series it doesn’t draw: a missing 7th column still says why it can’t be drawn', async ({ page }) => {
  const names = ['a', 'b', 'c', 'd', 'e', 'f'];
  await serveChart(page, { kind: 'bar', x: 'x', y: [...names, 'gg'] }, ['x', ...names, 'g'], [[1, 1, 2, 3, 4, 5, 6, 7]]);
  await page.goto(urlFor('repo', '#/repo/views?view=lag-trend'));
  await expect(page.locator('.view-body .view-note')).toHaveText('This chart can’t be drawn: the data has no column "gg".');
  await expect(page.locator('.chart-view')).toHaveCount(0);
});

test('a scatter over 1,000 marks draws its markers past the palette on the canvas too', async ({ page }) => {
  const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  await serveChart(page, { kind: 'scatter', x: 'x', y: names }, ['x', ...names], Array.from({ length: 150 }, (_, x) => [x, ...names.map((_, i) => x + i * 20)]));
  await page.goto(urlFor('repo', '#/repo/views?view=lag-trend'));
  const chart = page.locator('.chart-view');
  await expect(chart.locator('canvas.chart-canvas')).toHaveCount(1);
  await expect(chart.locator('.chart-frame svg circle, .chart-frame svg path.marker')).toHaveCount(0);
  await expect.poll(async () => (await canvasPaint(chart)).painted).toBeGreaterThan(100);
  await expect(chart.locator('.legend li').nth(6).locator('path.marker')).toHaveCount(1);
});

test('switching the theme redraws the series in the dark palette', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/views?view=lag-trend'));
  const line = page.locator('.chart-view svg path[fill="none"]').first();
  await page.getByRole('button', { name: 'Light' }).click();
  await expect(line).toHaveAttribute('stroke', '#4696C3');
  await page.getByRole('button', { name: 'Dark' }).click();
  await expect(line).toHaveAttribute('stroke', '#56B4E9');
});

test('Page Down and Page Up move the readout by a tenth of the rows', async ({ page }) => {
  await serveChart(page, { kind: 'line', x: 'x', y: 'v' }, ['x', 'v'], Array.from({ length: 50 }, (_, i) => [i, i * 2]));
  await page.goto(urlFor('repo', '#/repo/views?view=lag-trend'));
  const chart = page.locator('.chart-view');
  await chart.locator('.chart-frame').focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('PageDown');
  await expect(chart.locator('.chart-readout')).toHaveText('x 5: v 10');
  await page.keyboard.press('PageDown');
  await page.keyboard.press('PageUp');
  await expect(chart.locator('.chart-readout')).toHaveText('x 5: v 10');
});

test('a chart naming a column the data lacks says why it can’t be drawn', async ({ page }) => {
  await serveView(page, 'lag-trend', { view: { ...LAG_CHART, chart: { kind: 'line', x: 'week', y: 'requests' } }, data: regions(), error: null });
  await page.goto(urlFor('repo', '#/repo/views?view=lag-trend'));
  await expect(page.locator('.view-body .view-note')).toHaveText('This chart can’t be drawn: the data has no column "week".');
});

test('a gallery shows each image with its name, opens one large, and steps with the keyboard', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/views?view=screens'));
  const grid = page.locator('.gallery');
  await expect(grid.locator('figure')).toHaveCount(2);
  await expect(grid.locator('figcaption')).toHaveText(['1-before.svg', '2-after.svg']);
  await grid.getByRole('button', { name: /1-before\.svg/ }).click();
  const large = page.getByRole('dialog', { name: '1-before.svg' });
  // The query is the image's stamp (its size and time), so a regenerated image is fetched again.
  await expect(large.locator('img')).toHaveAttribute('src', /\/api\/repo\/views\/screens\/files\/0(\?|$)/);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('dialog', { name: '2-after.svg' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Focus goes back to the image the large view showed last.
  await expect(grid.getByRole('button', { name: /2-after\.svg/ })).toBeFocused();
});

const SCREENS: ViewDef = { name: 'screens', title: 'Screens', type: 'gallery', data: 'data/screens', description: 'The lag screen, at each step.', file: 'docs/_meta/views/screens.md' };

test('a gallery names the images it refuses for leaving the repo', async ({ page }) => {
  const images = [{ index: 0, name: '1-before.svg', caption: '', stamp: '1' }];
  await serveView(page, 'screens', { view: SCREENS, data: { kind: 'gallery', images, refused: ['../outside.png', 'link-out.svg'] }, error: null });
  await page.goto(urlFor('repo', '#/repo/views?view=screens'));
  await expect(page.locator('.gallery figure')).toHaveCount(1);
  await expect(page.locator('.view-body .view-note')).toHaveText('Not shown, because they lead outside the repo: ../outside.png, link-out.svg');
});

test('a gallery whose every image is refused names them, rather than saying it has none', async ({ page }) => {
  await serveView(page, 'screens', { view: SCREENS, data: { kind: 'gallery', images: [], refused: ['../outside.png'] }, error: null });
  await page.goto(urlFor('repo', '#/repo/views?view=screens'));
  await expect(page.locator('.view-body .view-note')).toHaveText('Not shown, because they lead outside the repo: ../outside.png');
  await expect(page.getByText('No images here yet.')).toHaveCount(0);
});

test('a gallery image that fails to load shows its name and says so', async ({ page }) => {
  await page.route(/\/api\/repo\/views\/screens\/files\/1(\?|$)/, (route) => route.fulfill({ status: 404, body: 'gone' }));
  await page.goto(urlFor('repo', '#/repo/views?view=screens'));
  const failed = page.locator('.gallery figure').nth(1);
  await expect(failed.locator('.gallery-failed')).toHaveText('2-after.svg couldn’t be shown');
  await expect(failed.locator('img')).toHaveCount(0);
  await expect(page.locator('.gallery figure').first().locator('img')).toHaveCount(1);
});

test('a regenerated gallery image shows its new bytes, with no loading flash', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/views?view=screens'));
  const first = page.locator('.gallery figure').first().locator('img');
  const width = () => first.evaluate((el: HTMLImageElement) => el.naturalWidth);
  await expect.poll(width).toBe(320);
  const loading = await watchLoading(page);
  await withFile(
    ['data', 'screens', '1-before.svg'],
    (before) => before.replaceAll('320', '640'),
    () => expect.poll(width, { timeout: 10_000 }).toBe(640),
    () => expect.poll(width, { timeout: 10_000 }).toBe(320),
  );
  expect((await loading()).filter(Boolean)).toEqual([]);
});

/** Two frames: whatever an answer that has landed changes is on screen. */
const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
/** The next reread of a view (the screens view unless named), finished. */
const reread = (page: Page, view = 'screens') => page.waitForEvent('requestfinished', { predicate: (r) => r.url().endsWith(`/api/repo/views/${view}`), timeout: 10_000 });
/** Rewrites traffic-load.csv, which the gallery doesn't read, and runs `during` once the open view has been read again. */
async function touchRepo(page: Page, during: () => Promise<void>, restored: () => Promise<void>, view = 'screens') {
  let next = reread(page, view);
  await withFile(
    ['data', 'traffic-load.csv'],
    (before) => `${before}West,50,1\n`,
    async () => {
      await next;
      await frames(page);
      await during();
      next = reread(page, view);
    },
    async () => {
      await next;
      await frames(page);
      await restored();
    },
  );
}

test('a repo change that leaves the gallery alone fetches none of its images again', async ({ page }) => {
  const fetched: string[] = [];
  page.on('request', (r) => {
    if (/\/api\/repo\/views\/screens\/files\//.test(r.url())) fetched.push(r.url());
  });
  await page.goto(urlFor('repo', '#/repo/views?view=screens'));
  const loaded = () => page.locator('.gallery img').evaluateAll((els) => els.length === 2 && els.every((e) => (e as HTMLImageElement).naturalWidth > 0));
  await expect.poll(loaded).toBe(true);
  expect(fetched).toHaveLength(2);
  await touchRepo(
    page,
    async () => expect(fetched).toHaveLength(2),
    async () => expect(fetched).toHaveLength(2),
  );
});

test('the large view keeps Tab inside it, takes the arrow keys it steps with, and shows its focus', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/views?view=screens'));
  const opener = page.locator('.gallery').getByRole('button', { name: /1-before\.svg/ });
  await opener.focus();
  await page.keyboard.press('Enter');
  const large = page.getByRole('dialog');
  await expect(large).toBeFocused();
  await expect(large).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Tab');
  await expect(large).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(large).toBeFocused();
  await page.evaluate(() => {
    const w = window as unknown as { prevented_: boolean[] };
    w.prevented_ = [];
    window.addEventListener('keydown', (e) => setTimeout(() => w.prevented_.push(e.defaultPrevented)));
  });
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('dialog', { name: '2-after.svg' })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('dialog', { name: '1-before.svg' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { prevented_: boolean[] }).prevented_)).toEqual([true, true]);
});

test('closing the large view without stepping puts focus back on the image that opened it', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/views?view=screens'));
  const opener = page.locator('.gallery').getByRole('button', { name: /1-before\.svg/ });
  await opener.click();
  await expect(page.getByRole('dialog', { name: '1-before.svg' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('a thumbnail opens with Enter and with Space', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/views?view=screens'));
  const opener = page.locator('.gallery').getByRole('button', { name: /2-after\.svg/ });
  await opener.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '2-after.svg' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.getByRole('dialog', { name: '2-after.svg' })).toBeVisible();
});

test('the large view of an image that fails to load shows its name and says so', async ({ page }) => {
  await page.route(/\/api\/repo\/views\/screens\/files\/1(\?|$)/, (route) => route.fulfill({ status: 404, body: 'gone' }));
  await page.goto(urlFor('repo', '#/repo/views?view=screens'));
  await page.locator('.gallery').getByRole('button', { name: /2-after\.svg/ }).click();
  const large = page.getByRole('dialog', { name: '2-after.svg' });
  await expect(large.locator('.gallery-failed')).toHaveText('2-after.svg couldn’t be shown');
  await expect(large.locator('img')).toHaveCount(0);
});

test('an empty gallery says it has no images yet', async ({ page }) => {
  await serveView(page, 'screens', { view: SCREENS, data: { kind: 'gallery', images: [] }, error: null });
  await page.goto(urlFor('repo', '#/repo/views?view=screens'));
  await expect(page.locator('.view-body .view-note')).toHaveText('No images here yet.');
  await expect(page.locator('.gallery')).toHaveCount(0);
});

test('a reread that drops the open image closes the large view for good', async ({ page }) => {
  const two = [{ index: 0, name: '1-before.svg', caption: '', stamp: '1' }, { index: 1, name: '2-after.svg', caption: '', stamp: '2' }];
  let images = two;
  await page.route(/\/api\/repo\/views\/screens$/, (route) => route.fulfill({ json: { view: SCREENS, data: { kind: 'gallery', images }, error: null } satisfies ViewAnswer }));
  await page.goto(urlFor('repo', '#/repo/views?view=screens'));
  await page.locator('.gallery').getByRole('button', { name: /2-after\.svg/ }).click();
  await expect(page.getByRole('dialog', { name: '2-after.svg' })).toBeVisible();
  images = two.slice(0, 1);
  await touchRepo(
    page,
    async () => {
      await expect(page.locator('.gallery figure')).toHaveCount(1);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      // The image comes back on the next read; the large view stays closed.
      images = two;
    },
    async () => {
      await expect(page.locator('.gallery figure')).toHaveCount(2);
      await expect(page.getByRole('dialog')).toHaveCount(0);
    },
  );
});

test('the large view leaves modified keys alone, so Alt+Left still goes back', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/views?view=screens'));
  await page.locator('.gallery').getByRole('button', { name: /2-after\.svg/ }).click();
  await expect(page.getByRole('dialog', { name: '2-after.svg' })).toBeVisible();
  const notPrevented = await page.evaluate(() =>
    ['altKey', 'ctrlKey', 'metaKey'].map((mod) => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', [mod]: true, bubbles: true, cancelable: true }))),
  );
  expect(notPrevented).toEqual([true, true, true]);
  await expect(page.getByRole('dialog', { name: '2-after.svg' })).toBeVisible();
});

test('a gallery image that failed isn’t asked for again by a reread that leaves its address alone', async ({ page }) => {
  const asked: string[] = [];
  await page.route(/\/api\/repo\/views\/screens\/files\/1(\?|$)/, (route) => {
    asked.push(route.request().url());
    return route.fulfill({ status: 404, body: 'gone' });
  });
  await page.goto(urlFor('repo', '#/repo/views?view=screens'));
  await expect(page.locator('.gallery figure').nth(1).locator('.gallery-failed')).toBeVisible();
  expect(asked).toHaveLength(1);
  await touchRepo(
    page,
    async () => {
      await expect(page.locator('.gallery figure').nth(1).locator('.gallery-failed')).toBeVisible();
      expect(asked).toHaveLength(1);
    },
    async () => expect(asked).toHaveLength(1),
  );
});

test('a numeric cell reads at the same size and ink as a text cell', async ({ page }) => {
  await page.goto(urlFor('repo', '#/repo/views?view=traffic-load'));
  const table = page.locator('table.vtable');
  const num = table.locator('tbody td.num').first();
  const text = table.locator('tbody td:not(.num)').first();
  await expect(num).toBeVisible();
  const style = (l: Locator) => l.evaluate((el) => [getComputedStyle(el).fontSize, getComputedStyle(el).color]);
  expect(await style(num)).toEqual(await style(text));
});
