import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { buildDir, serveSnapshot, urlFor } from './fixtures';

const answers = (gate: string) => JSON.parse(readFileSync(join(buildDir('live'), 'gates', `${gate}.answers.json`), 'utf8')) as Record<string, unknown>;
const gateCount = (page: Page) => page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /^Gate/ }).locator('.cnt');

// These tests answer gates on the shared "live" fixture, so they run in order.
test.describe.configure({ mode: 'serial' });

test('opens on the newest gate that needs you', async ({ page }) => {
  await page.goto(urlFor('live'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Confirm the pause work');
  await expect(page.locator('.figure')).toHaveText('3');
  await expect(page.locator('.figure')).not.toHaveClass(/calm/);
  await expect(page.getByRole('button', { name: 'Submit marks' })).toBeDisabled();
});

test('marks rows from the keyboard and shows a quote', async ({ page }) => {
  await page.goto(urlFor('live', '#/gate/pause-scope'));
  const rows = page.locator('li.row');
  await rows.nth(0).focus();
  await page.keyboard.press('a');
  await rows.nth(1).focus();
  await page.keyboard.press('r');
  await rows.nth(2).focus();
  await page.keyboard.press('d');
  await expect(rows.nth(0)).toHaveAttribute('data-state', 'accepted');
  await expect(rows.nth(1)).toHaveAttribute('data-state', 'research');
  await expect(rows.nth(2)).toHaveAttribute('data-state', 'declined');
  await expect(page.locator('.figure')).toHaveText('0');
  await expect(page.locator('.figure')).toHaveClass(/calm/);
  await page.getByRole('group', { name: 'Mark: Dry-run mode for replays' }).getByRole('button', { name: 'Accept' }).focus();
  await page.keyboard.press('Space');
  await expect(rows.nth(1)).toHaveAttribute('data-state', 'accepted');
  await page.getByRole('button', { name: 'Per-source pause switch', exact: true }).click();
  await expect(page.getByText('Being able to pause one noisy source')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit marks' })).toBeEnabled();
});

test('submits marks with a note, once', async ({ page }) => {
  await page.goto(urlFor('live', '#/gate/pause-scope'));
  const marks = [
    ['Per-source pause switch', 'Accept'],
    ['Dry-run mode for replays', 'Needs research'],
    ['Lag thresholds set per source', 'Decline'],
  ] as const;
  for (const [row, label] of marks) await page.getByRole('group', { name: `Mark: ${row}` }).getByRole('button', { name: label }).click();
  await page.getByLabel('Note to the agent (optional)').fill('Lag thresholds can wait.');
  await page.getByRole('button', { name: 'Submit marks' }).click();
  await expect(page.getByRole('status')).toContainText('The agent applies it on your next message');
  expect(answers('pause-scope')).toMatchObject({ marks: { 'pause-switch': 'accepted', 'dry-run': 'research', 'lag-thresholds': 'declined' }, note: 'Lag thresholds can wait.' });
  await expect(gateCount(page)).toHaveText('2');
  await expect(page.getByRole('group', { name: 'Mark: Dry-run mode for replays' }).getByRole('button', { name: 'Accept' })).toBeDisabled();
});

test.describe('a concept round', () => {
  // Each test starts with the look round open again.
  test.beforeEach(() => {
    rmSync(join(buildDir('live'), 'gates', 'look.answers.json'), { force: true });
  });

  const round = (page: Page) => page.locator('.cround');
  const frame = (page: Page) => page.locator('iframe.cframe');
  const counter = (page: Page) => page.locator('.cround .ccount');
  const thumb = (page: Page, label: string) => page.getByRole('list', { name: 'Options' }).getByRole('button', { name: label, exact: true });

  test('shows a strip, a counter and the selected page in a sandboxed frame', async ({ page }) => {
    await page.goto(urlFor('live', '#/gate/look'));
    await expect(page.getByRole('list', { name: 'Options' }).getByRole('button')).toHaveCount(2);
    await expect(thumb(page, 'Quiet board')).toHaveAttribute('aria-pressed', 'true');
    await expect(thumb(page, 'Dense table')).toHaveAttribute('aria-pressed', 'false');
    await expect(counter(page)).toHaveText('1 of 2');
    await expect(frame(page)).toHaveAttribute('title', 'Quiet board');
    await expect(frame(page)).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin');
    await expect(frame(page)).toHaveAttribute('src', /concepts\/quiet-board\.html$/);
    await expect(page.locator('.cround iframe')).toHaveCount(3);
    await expect(page.locator('.cround iframe:not([sandbox="allow-scripts allow-same-origin"])')).toHaveCount(0);
    await expect(page.locator('.gate a[target="_blank"]')).toHaveCount(0);
  });

  test('steps through the strip with the arrow keys, stopping at the ends', async ({ page }) => {
    await page.goto(urlFor('live', '#/gate/look'));
    await thumb(page, 'Quiet board').focus();
    await page.keyboard.press('ArrowRight');
    await expect(frame(page)).toHaveAttribute('title', 'Dense table');
    await expect(counter(page)).toHaveText('2 of 2');
    await expect(thumb(page, 'Dense table')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(counter(page)).toHaveText('2 of 2');
    await page.keyboard.press('ArrowLeft');
    await expect(frame(page)).toHaveAttribute('title', 'Quiet board');
    await expect(counter(page)).toHaveText('1 of 2');
  });

  test('expands the frame to full view and returns on Escape or Back', async ({ page }) => {
    await page.goto(urlFor('live', '#/gate/look'));
    await expect(round(page)).toHaveAttribute('data-full', 'false');
    await page.getByRole('button', { name: 'Full view' }).click();
    await expect(round(page)).toHaveAttribute('data-full', 'true');
    await expect(page.getByRole('button', { name: 'Back' })).toBeFocused();
    await expect(page.locator('.cview-bar')).toContainText('Back to return');
    await page.keyboard.press('Escape');
    await expect(round(page)).toHaveAttribute('data-full', 'false');
    await page.getByRole('button', { name: 'Full view' }).click();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(round(page)).toHaveAttribute('data-full', 'false');
  });

  test('keeps the frame at full width where the window has no room to fit it', async ({ page }) => {
    // In the gates fixture the look gate's head sits above the round: at 1920x1080 a frame capped to fit would fall
    // under 360 tall, so none is capped.
    await page.goto(urlFor('gates', '#/gate/look'));
    await expect(frame(page)).toHaveAttribute('title', 'Quiet board');
    const gap = () =>
      page.locator('.cround .cview').evaluate((view) => {
        const cs = getComputedStyle(view);
        const content = view.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        return Math.abs((view.querySelector('.cframe')?.getBoundingClientRect().width ?? 0) - content);
      });
    await expect.poll(gap).toBeLessThanOrEqual(1);
  });

  test('shows where a page is missing', async ({ page }) => {
    await serveSnapshot(page, (s) => {
      s.files.concepts = s.files.concepts.filter((f) => f.path !== 'concepts/dense-table.html');
    });
    await page.goto(urlFor('live', '#/gate/look'));
    await thumb(page, 'Dense table').click();
    await expect(page.locator('.cframe-missing')).toHaveText('Page missing: concepts/dense-table.html');
    await expect(frame(page)).toHaveCount(0);
  });

  test('scrolls a strip of nine and counts them', async ({ page }) => {
    await serveSnapshot(page, (s) => {
      const look = s.gates.find((g) => g.name === 'look');
      if (look) look.request.options = Array.from({ length: 9 }, (_, i) => ({ name: `opt-${i + 1}`, label: `Option ${i + 1}`, page: `concepts/opt-${i + 1}.html` }));
    });
    await page.goto(urlFor('live', '#/gate/look'));
    await expect(counter(page)).toHaveText('1 of 9');
    const strip = page.locator('.cstrip');
    expect(await strip.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
    await thumb(page, 'Option 1').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(counter(page)).toHaveText('1 of 9');
    await thumb(page, 'Option 9').click();
    await expect(counter(page)).toHaveText('9 of 9');
    await page.keyboard.press('ArrowRight');
    await expect(counter(page)).toHaveText('9 of 9');
  });

  test('keeps None of these until the note has text', async ({ page }) => {
    await page.goto(urlFor('live', '#/gate/look'));
    const none = page.getByRole('button', { name: 'None of these' });
    const note = page.getByLabel('Note to the agent (needed for none of these)');
    const hint = page.getByText('Write a note to send none of these');
    await expect(none).toBeDisabled();
    await expect(hint).toBeVisible();
    await note.fill('   ');
    await expect(none).toBeDisabled();
    await expect(hint).toBeVisible();
    await note.fill('too cold');
    await expect(hint).toHaveCount(0);
    await none.click();
    await expect(page.getByRole('status')).toContainText('You chose none of these');
    expect(answers('look')).toMatchObject({ none: true, note: 'too cold' });
  });

  test('combines the checked options, in option order', async ({ page }) => {
    await page.goto(urlFor('live', '#/gate/look'));
    const combine = page.getByRole('checkbox', { name: 'Combine' });
    await expect(page.getByRole('button', { name: 'Combine 0' })).toBeDisabled();
    await thumb(page, 'Dense table').click();
    await combine.check();
    await expect(page.getByRole('button', { name: 'Combine 1' })).toBeDisabled();
    await thumb(page, 'Quiet board').click();
    await expect(combine).not.toBeChecked();
    await combine.check();
    await page.getByRole('button', { name: 'Combine 2' }).click();
    await expect(page.getByRole('status')).toContainText('You combined Quiet board + Dense table');
    expect(answers('look')).toMatchObject({ choices: ['quiet-board', 'dense-table'] });
    // Answered: the round says how it ended and outlines the kept options.
    await expect(page.locator('.cround .coutcome')).toHaveText('Combined 2 of 2');
    await expect(thumb(page, 'Quiet board')).toHaveAttribute('data-kept', 'true');
    await expect(page.getByRole('checkbox', { name: 'Combine' })).toHaveCount(0);
  });

  test('picks the selected option', async ({ page }) => {
    await page.goto(urlFor('live', '#/gate/look'));
    await thumb(page, 'Dense table').click();
    // Hold back the snapshot reload so the gate still looks open for a moment after the answer is sent.
    let delay = false;
    await page.route(/\/api\/builds\/relay-rebuild$/, async (route) => {
      if (delay) await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    delay = true;
    await page.getByRole('button', { name: 'Pick this' }).click();
    // The reload is still pending: the round must already be locked, with no false "already answered".
    await expect(page.getByRole('status')).toContainText('Sent', { timeout: 1000 });
    await expect(page.locator('.gate')).toHaveAttribute('data-state', 'open');
    await expect(page.getByRole('button', { name: 'Pick this' })).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(answers('look')).toMatchObject({ choice: 'dense-table' });
    await expect(page.locator('.cround .coutcome')).toHaveText('Picked Dense table');
    await expect(thumb(page, 'Dense table')).toHaveAttribute('data-kept', 'true');
    await expect(thumb(page, 'Quiet board')).toHaveAttribute('data-kept', 'false');
  });

  /** Ticks each option's Combine box, selecting it first. */
  const tick = async (page: Page, labels: string[]) => {
    for (const label of labels) {
      await thumb(page, label).click();
      await page.getByRole('checkbox', { name: 'Combine' }).check();
    }
  };
  const compareButton = (page: Page) => page.locator('.cview-bar').getByRole('button', { name: 'Compare', exact: true });

  test('compares two ticked options side by side, each with its own Pick', async ({ page }) => {
    await page.goto(urlFor('live', '#/gate/look'));
    await expect(compareButton(page)).toHaveCount(0);
    await tick(page, ['Quiet board']);
    await expect(compareButton(page)).toHaveCount(0);
    await tick(page, ['Dense table']);
    await compareButton(page).click();
    await expect(page.locator('.cpair iframe')).toHaveCount(2);
    // The pressed Compare button is gone: focus lands on the pressed mode.
    await expect(page.getByRole('button', { name: 'Side by side' })).toBeFocused();
    const figures = page.locator('.cpair figure');
    await expect(figures).toHaveCount(2);
    await expect(figures.nth(0).locator('figcaption')).toContainText('Quiet board');
    await expect(figures.nth(1).locator('figcaption')).toContainText('Dense table');
    await expect(figures.nth(0).locator('iframe')).toHaveAttribute('title', 'Quiet board');
    await expect(figures.nth(1).locator('iframe')).toHaveAttribute('title', 'Dense table');
    for (const f of await figures.all()) await expect(f.getByRole('button', { name: 'Pick', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Side by side' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Swipe' })).toHaveAttribute('aria-pressed', 'false');
    // The answer panel keeps Combine 2, None of these and the note, without the one-option heading or Pick this.
    await expect(page.getByRole('button', { name: 'Combine 2' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'None of these' })).toBeVisible();
    await expect(page.getByLabel('Note to the agent (needed for none of these)')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pick this' })).toHaveCount(0);
    await expect(page.locator('.cpanel h3')).toHaveCount(0);
    // Below the frames, not beside them.
    const pair = await page.locator('.cpair').boundingBox();
    const panel = await page.locator('.cpanel').boundingBox();
    expect(pair && panel && panel.y >= pair.y + pair.height).toBe(true);
    // Each figure carries its own tick box, named for its option; there is none outside the two figures.
    await expect(figures.nth(0).getByRole('checkbox', { name: 'Combine Quiet board' })).toBeChecked();
    await expect(figures.nth(1).getByRole('checkbox', { name: 'Combine Dense table' })).toBeChecked();
    await expect(figures.nth(0).locator('label')).toHaveText('Combine Quiet board');
    await expect(figures.nth(0).locator('label .visually-hidden')).toHaveText('Quiet board');
    await expect(page.locator('.cround input[type="checkbox"]')).toHaveCount(2);
    await expect(page.locator('.cround figure input[type="checkbox"]')).toHaveCount(2);
    // The left-hand box unticks Quiet board, and only it.
    // A click, not uncheck(): the box leaves with its figure, so there is no box left to read back.
    await figures.nth(0).getByRole('checkbox', { name: 'Combine Quiet board' }).click();
    await expect(page.locator('.cpair')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Combine 1' })).toBeDisabled();
    await thumb(page, 'Quiet board').click();
    await expect(page.getByRole('checkbox', { name: 'Combine' })).not.toBeChecked();
    await thumb(page, 'Dense table').click();
    await expect(page.getByRole('checkbox', { name: 'Combine' })).toBeChecked();
  });

  test('picks from the right-hand figure', async ({ page }) => {
    await page.goto(urlFor('live', '#/gate/look'));
    await tick(page, ['Quiet board', 'Dense table']);
    await compareButton(page).click();
    await page.locator('.cpair figure').nth(1).getByRole('button', { name: 'Pick', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('You picked Dense table');
    expect(answers('look')).toMatchObject({ choice: 'dense-table' });
  });

  test('swipes one page over the other with a Reveal slider', async ({ page }) => {
    await page.goto(urlFor('live', '#/gate/look'));
    await tick(page, ['Quiet board', 'Dense table']);
    await compareButton(page).click();
    await page.getByRole('button', { name: 'Swipe' }).click();
    await expect(page.getByRole('button', { name: 'Swipe' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.cpair')).toHaveCount(0);
    const swipe = page.locator('.cswipe');
    await expect(swipe).toHaveCount(1);
    await expect(swipe.locator('iframe')).toHaveCount(2);
    // The first option on top, the second under it, the same size.
    await expect(swipe.locator('.cswipe-top iframe')).toHaveAttribute('title', 'Quiet board');
    await expect(swipe.locator(':scope > iframe')).toHaveAttribute('title', 'Dense table');
    const sizes = await swipe.locator('iframe').evaluateAll((fs) => fs.map((f) => `${f.getBoundingClientRect().width}x${f.getBoundingClientRect().height}`));
    expect(sizes[0]).toBe(sizes[1]);
    await expect(swipe).toContainText('Quiet board');
    await expect(swipe).toContainText('Dense table');
    // No tick box while swiping: the boxes belong to the side-by-side figures.
    await expect(page.locator('.cround input[type="checkbox"]')).toHaveCount(0);
    const clip = () => page.locator('.cswipe-top').evaluate((e) => getComputedStyle(e).clipPath);
    const before = await clip();
    const reveal = page.getByRole('slider', { name: 'Reveal' });
    await expect(reveal).toHaveValue('50');
    await expect(reveal).toHaveAttribute('aria-valuetext', '50% Quiet board');
    await reveal.focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
    await expect(reveal).toHaveValue('55');
    await expect(reveal).toHaveAttribute('aria-valuetext', '55% Quiet board');
    expect(await clip()).not.toBe(before);
  });

  test('returns to one at a time: the button, Escape, or unticking', async ({ page }) => {
    await page.goto(urlFor('live', '#/gate/look'));
    await tick(page, ['Quiet board', 'Dense table']);
    const single = page.locator('.cview > iframe.cframe');
    await compareButton(page).click();
    await expect(single).toHaveCount(0);
    await page.getByRole('button', { name: 'One at a time' }).click();
    await expect(page.locator('.cpair')).toHaveCount(0);
    await expect(single).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Pick this' })).toBeVisible();
    // One at a time is gone too: focus goes back to Compare.
    await expect(compareButton(page)).toBeFocused();

    await compareButton(page).click();
    await expect(page.locator('.cpair')).toHaveCount(1);
    await page.locator('.cview-bar').getByRole('button', { name: 'Swipe' }).focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('.cpair, .cswipe')).toHaveCount(0);
    await expect(single).toHaveCount(1);

    // Escape leaves full view first, then compare.
    await compareButton(page).click();
    await page.getByRole('button', { name: 'Full view' }).click();
    await expect(round(page)).toHaveAttribute('data-full', 'true');
    await page.keyboard.press('Escape');
    await expect(round(page)).toHaveAttribute('data-full', 'false');
    await expect(page.locator('.cpair')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('.cpair')).toHaveCount(0);

    // Unticking either option ends compare: here the right-hand one.
    await compareButton(page).click();
    await expect(page.locator('.cpair')).toHaveCount(1);
    // A click, not uncheck(): the box leaves with its figure.
    await page.locator('.cpair figure').nth(1).getByRole('checkbox', { name: 'Combine Dense table' }).click();
    await expect(page.locator('.cpair')).toHaveCount(0);
    await expect(single).toHaveCount(1);
    await expect(compareButton(page)).toHaveCount(0);
  });

  test('fills the main area with the pair in full view', async ({ page }) => {
    await page.goto(urlFor('live', '#/gate/look'));
    await tick(page, ['Quiet board', 'Dense table']);
    await compareButton(page).click();
    await page.getByRole('button', { name: 'Full view' }).click();
    await expect(round(page)).toHaveAttribute('data-full', 'true');
    const box = (sel: string) => page.locator(sel).evaluate((e) => e.getBoundingClientRect().toJSON() as DOMRect);
    const r = await box('.cround');
    const pair = await box('.cpair');
    const view = await box('.cround .cview');
    expect(Math.abs(pair.width - view.width)).toBeLessThanOrEqual(1);
    // The pair runs to the round's bottom padding.
    expect(r.bottom - pair.bottom).toBeLessThanOrEqual(30);
    expect(pair.height).toBeGreaterThan(r.height * 0.75);
    await expect(page.locator('.cpair iframe')).toHaveCount(2);
  });

  test('compares where a page is missing, and still picks it', async ({ page }) => {
    await serveSnapshot(page, (s) => {
      s.files.concepts = s.files.concepts.filter((f) => f.path !== 'concepts/dense-table.html');
    });
    await page.goto(urlFor('live', '#/gate/look'));
    await tick(page, ['Quiet board', 'Dense table']);
    await compareButton(page).click();
    const second = page.locator('.cpair figure').nth(1);
    await expect(second).toContainText('Page missing: concepts/dense-table.html');
    await expect(second.locator('iframe')).toHaveCount(0);
    await page.getByRole('button', { name: 'Swipe' }).click();
    await expect(page.locator('.cswipe')).toContainText('Page missing: concepts/dense-table.html');
    await expect(page.locator('.cswipe iframe')).toHaveCount(1);
    await page.getByRole('button', { name: 'Side by side' }).click();
    await page.locator('.cpair figure').nth(1).getByRole('button', { name: 'Pick', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('You picked Dense table');
    expect(answers('look')).toMatchObject({ choice: 'dense-table' });
  });

  test('stacks the pair in a narrow window', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto(urlFor('live', '#/gate/look'));
    await tick(page, ['Quiet board', 'Dense table']);
    await compareButton(page).click();
    const figures = page.locator('.cpair figure');
    await expect(figures).toHaveCount(2);
    const first = await figures.nth(0).boundingBox();
    const second = await figures.nth(1).boundingBox();
    expect(first && second && second.y >= first.y + first.height).toBe(true);
  });

  test('says so when the round was answered elsewhere, and shows that answer', async ({ page }) => {
    // No live updates in this tab, so it still offers the buttons after the other answer is in.
    await page.route('**/api/events', (route) => route.abort());
    await page.goto(urlFor('live', '#/gate/look'));
    await expect(page.getByRole('button', { name: 'Pick this' })).toBeEnabled();
    const token = (await page.locator('meta[name="nexus-token"]').getAttribute('content')) ?? '';
    const other = await page.request.post(urlFor('live', 'api/builds/relay-rebuild/gates/look/answers'), {
      headers: { 'content-type': 'application/json', 'x-nexus-token': token },
      data: { choice: 'quiet-board', note: 'From the other tab' },
    });
    expect(other.status()).toBe(201);
    await page.getByRole('button', { name: 'Pick this' }).click();
    await expect(page.getByRole('alert')).toContainText('This gate was already answered, perhaps in another tab.');
    await expect(page.getByRole('status')).toContainText('You picked Quiet board');
    await expect(page.getByRole('status')).toContainText('From the other tab');
    expect(answers('look')).toMatchObject({ choice: 'quiet-board' });
  });
});

test('says so when another tab answered first, and shows that answer', async ({ page }) => {
  // No live updates in this tab, so it still offers the buttons after the other tab has answered.
  await page.route('**/api/events', (route) => route.abort());
  await page.goto(urlFor('live', '#/gate/spec-review'));
  await expect(page.locator('.reader h1')).toHaveText('Relay rebuild: design');
  const token = (await page.locator('meta[name="nexus-token"]').getAttribute('content')) ?? '';
  const other = await page.request.post(urlFor('live', 'api/builds/relay-rebuild/gates/spec-review/answers'), {
    headers: { 'content-type': 'application/json', 'x-nexus-token': token },
    data: { decision: 'send-back', note: 'From the other tab' },
  });
  expect(other.status()).toBe(201);
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('alert')).toContainText('already answered');
  await expect(page.getByRole('status')).toContainText('send back');
  await expect(page.getByRole('status')).toContainText('From the other tab');
});

test('shows an applied gate read-only', async ({ page }) => {
  await page.goto(urlFor('live', '#/gate/scope'));
  await expect(page.getByRole('status')).toContainText('Applied');
  await expect(page.locator('li.row').first()).toHaveAttribute('data-state', 'accepted');
  await expect(page.getByRole('button', { name: 'Accept' }).first()).toBeDisabled();
});

test('shows the build status once nothing needs you', async ({ page }) => {
  // Nothing needs you only once the three open gates are answered. The tests above may or may not have answered them,
  // so this one answers each itself (201) or finds it answered already (409), and passes run alone.
  await page.goto(urlFor('live', '#/logs'));
  const token = (await page.locator('meta[name="nexus-token"]').getAttribute('content')) ?? '';
  const open: [string, Record<string, unknown>][] = [
    ['pause-scope', { marks: { 'pause-switch': 'accepted', 'dry-run': 'research', 'lag-thresholds': 'declined' } }],
    ['spec-review', { decision: 'send-back', note: 'Not yet' }],
    ['look', { choice: 'quiet-board' }],
  ];
  for (const [gate, data] of open) {
    const res = await page.request.post(urlFor('live', `api/builds/relay-rebuild/gates/${gate}/answers`), {
      headers: { 'content-type': 'application/json', 'x-nexus-token': token },
      data,
    });
    expect([201, 409], gate).toContain(res.status());
  }
  await page.goto(urlFor('live'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nothing needs you right now');
  await expect(page.getByText('3 answers are waiting for the agent to apply')).toBeVisible();
  await expect(page.locator('.figure')).toHaveClass(/calm/);
});

test('keeps the decision available when the attached document is missing', async ({ page }) => {
  await page.goto(urlFor('broken', '#/gate/spec-review'));
  await expect(page.getByText('This file is missing from the build')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Send back' })).toBeEnabled();
});

test('explains a gate link that no longer exists', async ({ page }) => {
  await page.goto(urlFor('visual', '#/gate/old-gate'));
  await expect(page.getByText('No gate named "old-gate"')).toBeVisible();
});

test('leaves browser shortcuts alone on a row', async ({ page }) => {
  await page.goto(urlFor('visual', '#/gate/pause-scope'));
  const row = page.locator('li.row').first();
  await row.focus();
  await page.keyboard.press('Control+d');
  await expect(row).toHaveAttribute('data-state', 'unmarked');
});

test('locks the marks and row notes while the answers are being sent', async ({ page }) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/gates/*/answers', async (r) => {
    await held;
    await r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Disk full' }) });
  });
  await page.goto(urlFor('visual', '#/gate/pause-scope'));
  await expect(page.locator('li.row').first()).toBeVisible();
  for (const row of await page.locator('li.row').all()) await row.getByRole('button', { name: 'Accept' }).click();
  await page.getByRole('button', { name: 'Submit marks' }).click();
  // Reading stays open (a quoted row still expands); marking and notes don't.
  await expect(page.locator('li.row .acts button:enabled')).toHaveCount(0);
  await expect(page.locator('li.row .note-link, li.row textarea')).toHaveCount(0);
  await expect(page.locator('.note-field textarea')).toBeDisabled();
  release();
  await expect(page.getByRole('alert')).toContainText('Disk full');
  await expect(page.locator('li.row').first().getByRole('button', { name: 'Accept' })).toBeEnabled();
});

test('shows the server message and re-enables the button when sending fails', async ({ page }) => {
  await page.route('**/gates/*/answers', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Disk full' }) }));
  await page.goto(urlFor('visual', '#/gate/pause-scope'));
  await expect(page.locator('li.row').first()).toBeVisible();
  for (const row of await page.locator('li.row').all()) await row.getByRole('button', { name: 'Accept' }).click();
  await page.getByRole('button', { name: 'Submit marks' }).click();
  await expect(page.getByRole('alert')).toContainText('Disk full');
  await expect(page.getByRole('button', { name: 'Submit marks' })).toBeEnabled();
});
