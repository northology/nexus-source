import { readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { rootOf, serveSnapshot, urlFor } from './fixtures';

const row = (page: Page, title: string) => page.getByRole('button', { name: new RegExp(`^${title}`) });

test("lists the plan's tasks in order with their state, by title only", async ({ page }) => {
  await page.goto(urlFor('plan', '#/plan'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Replay Queue Implementation Plan');
  await expect(page.locator('.pt-title')).toHaveText(['Retry policy', 'Replay queue', 'Lag per source', 'Replay screen', 'Browser checks']);
  await expect(page.locator('.plan-summary')).toContainText('2 of 5 done · in progress: Lag per source (fix round 2) · 2 pending · ledger read');
  await expect(row(page, 'Retry policy')).toContainText('1a2b3c4..5d6e7f8');
  await expect(row(page, 'Replay queue')).toContainText('1 fix round');
  await expect(row(page, 'Lag per source')).toContainText('fix round 2 · 1 open');
  await expect(row(page, 'Replay screen')).toContainText('pending');
  await expect(row(page, 'Replay screen')).toContainText('5 steps planned');
  await expect(page.locator('main')).not.toContainText(/Task \d/);
  await expect(page.locator('.rail')).toContainText('2/5');
  await expect(page.getByRole('link', { name: 'plan-replay' })).toBeVisible();
});

test('opens a task in place, with its fix rounds, rulings and minors', async ({ page }) => {
  await page.goto(urlFor('plan', '#/plan'));
  await row(page, 'Replay queue').click();
  await expect(page).toHaveURL(/task=t-[0-9a-f]{8}/);
  const detail = page.locator('.pdetail');
  await expect(detail).toContainText('round 1');
  await expect(detail).toContainText('keep seven days of replays');
  await expect(detail).toContainText('the queue table could sort by source');
  await row(page, 'Replay queue').click();
  await expect(page.locator('.pdetail')).toHaveCount(0);
  await expect(page.locator('.pfinal')).toContainText('Not yet: runs after the last task.');
});

test("a done task's detail reads Done with its commits and note; only a pending task has nothing recorded", async ({ page }) => {
  await page.goto(urlFor('plan', '#/plan'));
  await row(page, 'Retry policy').click();
  const detail = page.locator('.pdetail');
  await expect(detail.locator('.pd-done')).toHaveText('Done · 1a2b3c4..5d6e7f8 · review clean');
  await expect(detail).not.toContainText('Nothing recorded for this task yet.');
  await row(page, 'Replay screen').click();
  await expect(page.locator('.pdetail')).toContainText('Nothing recorded for this task yet.');
  await expect(page.locator('.pd-done')).toHaveCount(0);
});

test('follows the ledger as execution moves', async ({ page }) => {
  const file = join(rootOf('plan'), '.superpowers', 'sdd', 'replay-plan', 'progress.md');
  const before = readFileSync(file, 'utf8');
  const { atime, mtime } = statSync(file);
  await page.goto(urlFor('plan', '#/plan'));
  await expect(page.locator('.plan-summary')).toContainText('2 of 5 done');
  try {
    writeFileSync(file, `${before}Task 3: complete (commits 3d4e5f6..4e5f6a7, review clean)\n`);
    await expect(page.locator('.plan-summary')).toContainText('3 of 5 done · in progress: Replay screen', { timeout: 10_000 });
  } finally {
    writeFileSync(file, before);
    // Put the fixture's fixed time back too: the summary shows it, and the plan screenshots mask it at its width.
    utimesSync(file, atime, mtime);
  }
  await expect(page.locator('.plan-summary')).toContainText('2 of 5 done', { timeout: 10_000 });
});

test('a plan with no readable tasks links to its document', async ({ page }) => {
  await serveSnapshot(page, (s) => {
    const plan = s.plan?.plans?.[0];
    if (plan) plan.tasks = [];
  });
  await page.goto(urlFor('plan', '#/plan'));
  await expect(page.getByText('This plan has no tasks nexus can read')).toBeVisible();
  await expect(page.getByRole('link', { name: 'replay-plan.md' }).first()).toBeVisible();
});

test('progress that was never kept reads as unknown', async ({ page }) => {
  await serveSnapshot(page, (s) => {
    for (const p of Object.values(s.planProgress)) {
      p.source = 'none';
      p.read = null;
      p.ledger = null;
      for (const t of Object.values(p.tasks)) t.state = 'unknown';
    }
  });
  await page.goto(urlFor('plan', '#/plan'));
  await expect(page.getByText("This run's ledger wasn't imported, so its progress wasn't kept.")).toBeVisible();
  await expect(page.locator('.prow .pg-unknown')).toHaveCount(5);
});

test('a plan that was never started reads as not started', async ({ page }) => {
  await serveSnapshot(page, (s) => {
    for (const p of Object.values(s.planProgress)) {
      p.source = 'none';
      p.read = null;
      p.ledger = null;
      for (const t of Object.values(p.tasks)) t.state = 'pending';
    }
  });
  await page.goto(urlFor('plan', '#/plan'));
  await expect(page.locator('.plan-summary')).toContainText('0 of 5 done · 5 pending · not started');
});

test('a replaced plan shows the newest, and links to the earlier one', async ({ page }) => {
  await serveSnapshot(page, (s) => {
    const plan = s.plan?.plans?.[0];
    if (s.plan && plan) s.plan.plans = [{ ...plan, id: 'p-00000000', gate: 'plan-replay-old', title: 'Earlier replay plan' }, plan];
  });
  await page.goto(urlFor('plan', '#/plan'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Replay Queue Implementation Plan');
  await expect(page.getByText('Replaced an earlier plan')).toBeVisible();
  await page.getByRole('link', { name: 'plan-replay-old' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Earlier replay plan');
  await expect(page.getByText('A newer plan replaced this one.')).toBeVisible();
  await page.getByRole('link', { name: 'Show the current plan' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Replay Queue Implementation Plan');
});

test('every earlier plan is reachable, one step back at a time', async ({ page }) => {
  await serveSnapshot(page, (s) => {
    const plan = s.plan?.plans?.[0];
    if (s.plan && plan) {
      s.plan.plans = [
        { ...plan, id: 'p-00000000', gate: 'plan-replay-a', title: 'First replay plan' },
        { ...plan, id: 'p-00000001', gate: 'plan-replay-b', title: 'Second replay plan' },
        plan,
      ];
    }
  });
  await page.goto(urlFor('plan', '#/plan'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Replay Queue Implementation Plan');
  await page.getByRole('link', { name: 'plan-replay-b' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Second replay plan');
  await expect(page.getByText('A newer plan replaced this one.')).toBeVisible();
  await page.getByRole('link', { name: 'plan-replay-a' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('First replay plan');
  await expect(page.getByText('Replaced an earlier plan')).toHaveCount(0);
});

test(`the phase selector shows each phase's plan, without "All phases"`, async ({ page }) => {
  await serveSnapshot(page, (s) => {
    if (!s.build) return;
    s.build.phase = 'dashboard';
    s.build.phases = [...(s.build.phases ?? []), { name: 'dashboard', branch: 'build/dashboard', started: '2026-10-02T20:00:00Z', finished: null }];
  });
  await page.goto(urlFor('plan', '#/plan'));
  await expect(page.getByText('No approved plan for dashboard yet')).toBeVisible();
  const select = page.getByLabel('Phase');
  await expect(select.locator('option')).toHaveText(['replay', 'dashboard (current)']);
  await select.selectOption('replay');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Replay Queue Implementation Plan');
});

test('a broken plan.json shows the problem', async ({ page }) => {
  await serveSnapshot(page, (s) => {
    s.problems.push({ file: 'plan.json', message: 'plan.json is not valid JSON' });
  });
  await page.goto(urlFor('plan', '#/plan'));
  await expect(page.getByText('plan.json could not be read')).toBeVisible();
});

test('the board groups tasks by state, and the toggle lives in the URL', async ({ page }) => {
  await page.goto(urlFor('plan', '#/plan'));
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await expect(page).toHaveURL(/mode=board/);
  await expect(page.getByRole('region', { name: 'Pending: 2' })).toContainText('Replay screen');
  await expect(page.getByRole('region', { name: 'In progress: 0' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Fix rounds: 1' })).toContainText('Lag per source');
  await expect(page.getByRole('region', { name: 'Done: 2' })).toContainText('Replay queue');
  await page.getByRole('button', { name: /^Lag per source/ }).click();
  await expect(page.locator('.board-detail')).toContainText('0 addressed, 1 open');
  await page.reload();
  await expect(page.locator('.bcard')).toHaveCount(5);
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page).not.toHaveURL(/mode=/);
  await expect(page.locator('.prow')).toHaveCount(5);
});

test('a done task on the board shows its note on its own line, without repeating Done', async ({ page }) => {
  await page.goto(urlFor('plan', '#/plan?mode=board'));
  await page.getByRole('button', { name: /^Retry policy/ }).click();
  const detail = page.locator('.board-detail');
  await expect(detail).toContainText('1a2b3c4..5d6e7f8');
  await expect(detail.locator('.pd-done')).toHaveText('review clean');
  await expect(detail).not.toContainText('Nothing recorded for this task yet.');
});

test('the board marks the open card, and only that one', async ({ page }) => {
  await page.goto(urlFor('plan', '#/plan?mode=board'));
  const pending = page.getByRole('button', { name: /^Replay screen/ });
  await pending.click();
  await expect(pending).toHaveAttribute('aria-expanded', 'true');
  await expect(pending).toHaveCSS('border-style', 'solid');
  expect(await pending.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none');
  await expect(page.getByRole('button', { name: /^Lag per source/ })).toHaveCSS('box-shadow', 'none');
  await expect(page.getByRole('button', { name: /^Retry policy/ })).toHaveCSS('box-shadow', 'none');
});

test('an empty board column says None', async ({ page }) => {
  await page.goto(urlFor('plan', '#/plan?mode=board'));
  await expect(page.getByRole('region', { name: 'In progress: 0' })).toContainText('None');
  await expect(page.getByRole('region', { name: 'Pending: 2' })).not.toContainText('None');
});

test('clicking a board card brings its detail into view and focuses the heading', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 560 });
  await page.goto(urlFor('plan', '#/plan?mode=board'));
  await page.getByRole('button', { name: /^Lag per source/ }).click();
  const heading = page.locator('.board-detail h2');
  await expect(heading).toHaveText('Lag per source');
  // At this height the detail starts below the fold, so it is only wholly visible if it was scrolled to.
  await expect(page.locator('.board-detail')).toBeInViewport({ ratio: 0.95 });
  await expect(heading).toBeFocused();
});

test('a deep link to a board card shows its detail but does not take focus', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 560 });
  await page.goto(urlFor('plan', '#/plan?mode=board'));
  await page.getByRole('button', { name: /^Lag per source/ }).click();
  const url = page.url();
  await page.goto('about:blank');
  await page.goto(url);
  const heading = page.locator('.board-detail h2');
  await expect(heading).toHaveText('Lag per source');
  await expect(page.locator('.board-detail')).toBeInViewport({ ratio: 0.95 });
  await expect(heading).not.toBeFocused();
});

test('switching List to Board with a task open keeps focus on the Board button', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 560 });
  await page.goto(urlFor('plan', '#/plan'));
  await page.getByRole('button', { name: /Lag per source/ }).first().click();
  const board = page.getByRole('group', { name: 'Show tasks as' }).getByRole('button', { name: 'Board' });
  await board.click();
  await expect(page.locator('.board-detail h2')).toHaveText('Lag per source');
  await expect(board).toBeFocused();
});

test('a long note stays inside the detail', async ({ page }) => {
  await serveSnapshot(page, (s) => {
    for (const p of Object.values(s.planProgress)) {
      for (const t of Object.values(p.tasks)) if (t.state === 'done') t.note = `pnpm exec playwright test tests/e2e/${'planSection'.repeat(30)}.spec.ts`;
    }
  });
  await page.goto(urlFor('plan', '#/plan?mode=board'));
  await page.getByRole('button', { name: /^Retry policy/ }).click();
  const detail = page.locator('.board-detail');
  await expect(detail.locator('.pd-done')).toContainText('planSection');
  const fits = await detail.evaluate((el) => el.scrollWidth <= el.clientWidth);
  expect(fits).toBe(true);
});

test('following a plan link keeps the board mode', async ({ page }) => {
  await serveSnapshot(page, (s) => {
    const plan = s.plan?.plans?.[0];
    if (s.plan && plan) s.plan.plans = [{ ...plan, id: 'p-00000000', gate: 'plan-replay-old', title: 'Earlier replay plan' }, plan];
  });
  await page.goto(urlFor('plan', '#/plan?mode=board'));
  await page.getByRole('link', { name: 'plan-replay-old' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Earlier replay plan');
  await expect(page).toHaveURL(/mode=board/);
  await page.getByRole('link', { name: 'Show the current plan' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Replay Queue Implementation Plan');
  await expect(page).toHaveURL(/mode=board/);
});

test('reopening a closed board card focuses its heading again, and so does a different card', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 560 });
  await page.goto(urlFor('plan', '#/plan?mode=board'));
  const lag = page.getByRole('button', { name: /^Lag per source/ });
  const heading = page.locator('.board-detail h2');
  await lag.click();
  await expect(heading).toBeFocused();
  await lag.click();
  await expect(page.locator('.board-detail')).toHaveCount(0);
  await lag.click();
  await expect(heading).toHaveText('Lag per source');
  await expect(heading).toBeFocused();
  await page.getByRole('button', { name: /^Retry policy/ }).click();
  await expect(heading).toHaveText('Retry policy');
  await expect(heading).toBeFocused();
});

test("the plan board isn't boxed: it grows with its cards, and its text can be selected", async ({ page }) => {
  await page.goto(urlFor('plan', '#/plan?mode=board'));
  const board = page.locator('.board');
  await expect(board.locator('.bcard')).toHaveCount(5);
  // Many cards in one column: the board grows past a fixed height instead of clipping.
  await board.locator('.bcol').first().locator('ul > li').first().evaluate((li) => {
    for (let i = 0; i < 40; i += 1) li.parentElement?.appendChild(li.cloneNode(true));
  });
  expect((await board.boundingBox())?.height ?? 0).toBeGreaterThan(600);
  const style = await board.evaluate((el) => {
    const s = getComputedStyle(el);
    return { overflow: s.overflow, userSelect: s.userSelect, cursor: s.cursor, border: s.borderTopWidth };
  });
  expect(style).toEqual({ overflow: 'visible', userSelect: 'auto', cursor: 'auto', border: '0px' });
});
