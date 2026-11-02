import { expect, test } from '@playwright/test';
import { urlFor } from './fixtures';

const sections = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Sections' });

test('shows the build, its stage and the five sections', async ({ page }) => {
  await page.goto(urlFor('visual'));
  await expect(page.getByRole('banner')).toContainText('relay-rebuild');
  await expect(page.getByRole('banner')).toContainText('build/relay-rebuild');
  await expect(page.locator('.stage[aria-current="step"]')).toContainText('Plan');
  for (const name of ['Gate', 'Plan', 'Logs', 'Concepts', 'Documents']) {
    await expect(sections(page).getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  const gate = sections(page).getByRole('link', { name: /^Gate/ }).locator('.cnt');
  await expect(gate).toHaveText('3');
  await expect(gate).toHaveClass(/needs/);
  // The example's look round is open: Concepts counts its one topic, in red.
  const concepts = sections(page).getByRole('link', { name: /^Concepts/ }).locator('.cnt');
  await expect(concepts).toHaveText('1');
  await expect(concepts).toHaveClass(/needs/);
});

test('moves between sections through the URL and keeps the place on reload', async ({ page }) => {
  await page.goto(urlFor('visual'));
  await sections(page).getByRole('link', { name: /^Logs/ }).click();
  await expect(page).toHaveURL(/#\/logs$/);
  await expect(sections(page).getByRole('link', { name: /^Logs/ })).toHaveAttribute('aria-current', 'page');
  await page.reload();
  await expect(sections(page).getByRole('link', { name: /^Logs/ })).toHaveAttribute('aria-current', 'page');
});

test('remembers the theme', async ({ page }) => {
  await page.goto(urlFor('visual'));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('still works when browser storage is blocked', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
  });
  await page.goto(urlFor('visual'));
  await expect(page.getByRole('banner')).toContainText('relay-rebuild');
  await page.getByRole('button', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('lets the viewer pick the display zone and remembers it', async ({ page }) => {
  await page.goto(urlFor('visual'));
  await expect(page.getByLabel('Times in')).toHaveValue('America/Regina');
  await page.getByLabel('Times in').selectOption('UTC');
  await page.reload();
  await expect(page.getByLabel('Times in')).toHaveValue('UTC');
});

test('explains an empty checkout on the Build side', async ({ page }) => {
  await page.goto(urlFor('empty', '#/gate'));
  await expect(page.getByText('No build in this checkout yet')).toBeVisible();
});

test('asks which build to open when a checkout has two, then switches from the rail', async ({ page }) => {
  await page.goto(urlFor('two'));
  await expect(page.getByText('This checkout has 2 builds')).toBeVisible();
  await page.getByRole('button', { name: 'relay-rebuild' }).click();
  await expect(page).toHaveURL(/build=relay-rebuild/);
  await expect(page.getByRole('banner')).toContainText('build/relay-rebuild');
  await page.getByRole('combobox', { name: /^Build/ }).selectOption('second-build');
  await expect(page.getByRole('banner')).toContainText('build/second-build');
});

test('lists broken files and still shows everything else', async ({ page }) => {
  await page.goto(urlFor('broken'));
  const problems = page.getByRole('region', { name: 'Files that need fixing' });
  await expect(problems).toContainText('logs/issues.json');
  await expect(page.getByRole('banner')).toContainText('relay-rebuild');
  await expect(sections(page).getByRole('link', { name: /^Documents/ })).toBeVisible();
  await expect(sections(page).getByRole('link', { name: /^Gate/ }).locator('.cnt')).toHaveText('3');
});

test('applies a remembered dark theme before the app script runs', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('nexus.theme', 'dark');
    } catch {
      /* storage blocked */
    }
  });
  await page.route('**/assets/*.js', (r) => r.abort());
  await page.goto(urlFor('visual'));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('shows a server error plainly, not as offline, and does not retry it on a timer', async ({ page }) => {
  await page.clock.install();
  let calls = 0;
  await page.route(/\/api\/builds\/relay-rebuild$/, (r) => {
    calls += 1;
    return r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Disk read failed' }) });
  });
  await page.goto(urlFor('visual'));
  await expect(page.getByText('The build could not be loaded')).toBeVisible();
  await expect(page.getByText('Disk read failed')).toBeVisible();
  await expect(page.getByText("Can't reach the nexus server")).toHaveCount(0);
  const seen = calls;
  await page.clock.runFor(10_000);
  expect(calls).toBe(seen);
});

for (const width of [1280, 1440, 1536]) {
  test(`at ${width} the top bar shows the build subtitle in full, with its text as a title`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(urlFor('visual'));
    const sub = page.locator('.build-name .mono');
    await expect(sub).toContainText('phase replay · 1 of 1');
    await page.evaluate(() => document.fonts.ready);
    expect(await sub.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false);
    await expect(sub).toHaveAttribute('title', /phase replay · 1 of 1/);
  });
}
