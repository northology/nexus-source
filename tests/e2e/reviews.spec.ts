import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { RepoSnapshot, ReviewState } from '../../core/types.ts';
import { guarded, rootOf, urlFor } from './fixtures';

// These tests answer the fixture's one review, so they run in order and put it back open after each.
test.describe.configure({ mode: 'serial' });
const answersFile = () => join(rootOf('reviews'), '.nexus', 'reviews', 'repo-tidy.answers.json');
test.afterEach(() => rmSync(answersFile(), { force: true }));
// Nothing in this file reaches the network.
test.beforeEach(async ({ page }) => {
  await page.route((url) => url.hostname !== '127.0.0.1' && url.hostname !== 'localhost', (route) => route.abort());
});

const banner = (page: Page) => page.getByRole('region', { name: 'Tidy the standing instructions' });
const marks = (scope: Locator | Page, text: string) => scope.getByRole('group', { name: `Review: ${text}` });
const ROWS = ['CLAUDE.md: the working agreement', 'Web rules: still needed?', 'Memory: cap replays at 10,000'];

test('an open review shows its banner, and marks only on the items it names', async ({ page }) => {
  await page.goto(urlFor('reviews', '#/repo/overview'));
  await expect(banner(page)).toBeVisible();
  await expect(banner(page)).toContainText('Three items overlap the vault.');
  await expect(banner(page).locator('.review-status .needs')).toHaveText('3 of 3 to mark');
  const list = page.locator('.repo-list');
  await expect(list.getByRole('group', { name: /^Review: / })).toHaveCount(3);
  for (const text of ROWS) {
    for (const label of ['Keep', 'Adjust', 'Remove']) await expect(marks(list, text).getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false');
  }
  // An item the review doesn't name has no marks.
  await expect(list.locator('li', { hasText: 'The hook starts Node on every write' }).getByRole('group')).toHaveCount(0);
  // Views is a page of its own: no banner there.
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /Views/ }).click();
  await expect(banner(page)).toHaveCount(0);
});

test('a mark made on a card shows in the reader, and the draft survives moving between sections', async ({ page }) => {
  await page.goto(urlFor('reviews', '#/repo/instructions'));
  const list = page.locator('.repo-list');
  await marks(list, ROWS[0]!).getByRole('button', { name: 'Keep' }).click();
  await list.locator('a.repo-item', { hasText: 'Relay' }).click();
  const reader = page.locator('.repo-reader');
  await expect(marks(reader, ROWS[0]!).getByRole('button', { name: 'Keep' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /Memory/ }).click();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /Instructions/ }).click();
  await expect(marks(page.locator('.repo-list'), ROWS[0]!).getByRole('button', { name: 'Keep' })).toHaveAttribute('aria-pressed', 'true');
  await expect(banner(page).locator('.review-status .needs')).toHaveText('2 of 3 to mark');
});

test('a chosen mark stays readable under the pointer, and the marks work from the keyboard', async ({ page }) => {
  await page.goto(urlFor('reviews', '#/repo/overview'));
  const list = page.locator('.repo-list');
  const adjust = marks(list, ROWS[1]!).getByRole('button', { name: 'Adjust' });
  // The click leaves the pointer over the button: its hover colour must not match its pressed background.
  await adjust.click();
  await expect(adjust).toHaveAttribute('aria-pressed', 'true');
  const [ground, ink] = await page.evaluate(() => {
    const probe = document.createElement('i');
    document.body.append(probe);
    const read = (token: string) => {
      probe.style.color = `var(${token})`;
      return getComputedStyle(probe).color;
    };
    const out = [read('--ground'), read('--ink')];
    probe.remove();
    return out;
  });
  expect(await adjust.evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el).backgroundColor])).toEqual([ground, ink]);
  // Tab from Keep reaches Adjust, and Space presses it; the note that opens is next in order.
  const keep = marks(list, ROWS[2]!).getByRole('button', { name: 'Keep' });
  await keep.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await expect(marks(list, ROWS[2]!).getByRole('button', { name: 'Adjust' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(list.getByRole('textbox', { name: `Note on: ${ROWS[2]!}` })).toBeFocused();
});

test('the banner keeps its text off its border, with Submit showing and once sent', async ({ page }) => {
  await page.goto(urlFor('reviews', '#/repo/overview'));
  const edges = () =>
    banner(page).evaluate((el) => {
      const box = el.getBoundingClientRect();
      const inner = [...el.querySelectorAll('h2, p, .tally, .btn')].map((n) => n.getBoundingClientRect());
      return { left: Math.min(...inner.map((r) => r.left)) - box.left, right: box.right - Math.max(...inner.map((r) => r.right)), bottom: box.bottom - Math.max(...inner.map((r) => r.bottom)) };
    });
  const open = await edges();
  expect(open.left).toBeGreaterThanOrEqual(12);
  expect(open.right).toBeGreaterThanOrEqual(12);
  expect(open.bottom).toBeGreaterThanOrEqual(12);
  const list = page.locator('.repo-list');
  for (const text of ROWS) await marks(list, text).getByRole('button', { name: 'Keep' }).click();
  await banner(page).getByRole('button', { name: 'Submit review' }).click();
  await expect(banner(page).locator('.review-status')).toContainText('The agent makes the changes');
  expect((await edges()).bottom).toBeGreaterThanOrEqual(12);
});

test('Submit waits for every row, then sends the marks and notes once', async ({ page }) => {
  await page.goto(urlFor('reviews', '#/repo/overview'));
  const list = page.locator('.repo-list');
  const submit = banner(page).getByRole('button', { name: 'Submit review' });
  await marks(list, ROWS[0]!).getByRole('button', { name: 'Keep' }).click();
  await marks(list, ROWS[1]!).getByRole('button', { name: 'Adjust' }).click();
  await expect(submit).toBeDisabled();
  // Adjust or Remove opens the row's note, as a gate's research or decline does.
  await list.getByRole('textbox', { name: `Note on: ${ROWS[1]!}` }).fill('Fold it into the vault rule on charts.');
  await marks(list, ROWS[2]!).getByRole('button', { name: 'Remove' }).click();
  await expect(banner(page).locator('.review-status')).toHaveText('Every row marked; ready to submit');
  await submit.click();
  await expect(banner(page).locator('.review-status')).toContainText('The agent makes the changes on your next message.');
  await expect(banner(page).getByRole('button', { name: 'Submit review' })).toHaveCount(0);
  await expect(marks(list, ROWS[2]!).getByRole('button', { name: 'Remove' })).toBeDisabled();
  // Once the answer is read back, the recorded note shows in place of the field, in the gate's small note style.
  const savedNote = list.locator('.review-line .row-note');
  await expect(savedNote).toHaveText('Note: Fold it into the vault rule on charts.');
  expect(await savedNote.evaluate((el) => getComputedStyle(el).fontSize)).toBe(await banner(page).locator('.review-status').evaluate((el) => getComputedStyle(el).fontSize));
  await expect(list.getByRole('textbox', { name: /^Note on: / })).toHaveCount(0);
  const sent = JSON.parse(readFileSync(answersFile(), 'utf8')) as Record<string, unknown>;
  expect(sent).toMatchObject({
    gate: 'repo-tidy',
    marks: { 'keep-agreement': 'accepted', 'web-rules': 'research', 'replay-caps': 'declined' },
    notes: { 'web-rules': 'Fold it into the vault rule on charts.' },
  });
});

test('a row whose item left the list is shown as no longer listed, and can still be marked', async ({ page }) => {
  // The memory is pruned after the review opened: the repo read no longer lists it.
  await page.route(
    /\/api\/repo$/,
    guarded(async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as RepoSnapshot;
      body.inventory.items = body.inventory.items.filter((i) => !(i.kind === 'memory' && i.title === 'replay-caps'));
      await route.fulfill({ response: res, json: body });
    }),
  );
  await page.goto(urlFor('reviews', '#/repo/overview'));
  const gone = banner(page).locator('.review-gone');
  await expect(gone.getByRole('heading', { name: 'No longer listed' })).toBeVisible();
  await expect(gone).toContainText(ROWS[2]!);
  // Its explanation is small print like the banner's own, not body text.
  const size = (l: Locator) => l.evaluate((el) => getComputedStyle(el).fontSize);
  expect(await size(gone.locator('p'))).toBe(await size(banner(page).locator('.review-status')));
  await marks(gone, ROWS[2]!).getByRole('button', { name: 'Keep' }).click();
  await expect(marks(gone, ROWS[2]!).getByRole('button', { name: 'Keep' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.repo-list').getByRole('group', { name: /^Review: / })).toHaveCount(2);
});

const REVIEWS = /\/api\/reviews$/;
const ANSWERS = /\/api\/reviews\/repo-tidy\/answers$/;
const keepAll = async (list: Locator) => {
  for (const text of ROWS) await marks(list, text).getByRole('button', { name: 'Keep' }).click();
};
/** Serves the reviews read with a change, once `when` says so: an answer another tab sent, say. */
async function serveReviews(page: Page, when: () => boolean | Promise<boolean>, edit: (review: ReviewState) => void): Promise<void> {
  await page.route(
    REVIEWS,
    guarded(async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as { reviews: ReviewState[]; problems: string[] };
      if (await when()) body.reviews.forEach(edit);
      await route.fulfill({ response: res, json: body });
    }),
  );
}
const ELSEWHERE = { gate: 'repo-tidy', submitted: '2026-10-10T16:00:00Z', marks: { 'keep-agreement': 'declined', 'web-rules': 'declined', 'replay-caps': 'declined' } } as const;

test('once sent, every mark locks at once, even if the next read of the reviews never lands', async ({ page }) => {
  await page.goto(urlFor('reviews', '#/repo/overview'));
  const list = page.locator('.repo-list');
  await keepAll(list);
  // From here on the reviews can't be read: the page never learns the answer from the server.
  await page.route(REVIEWS, (route) => route.abort());
  await banner(page).getByRole('button', { name: 'Submit review' }).click();
  await expect(banner(page).locator('.review-status')).toContainText('Sent.');
  for (const text of ROWS) {
    for (const label of ['Keep', 'Adjust', 'Remove']) await expect(marks(list, text).getByRole('button', { name: label })).toBeDisabled();
    await expect(marks(list, text).getByRole('button', { name: 'Keep' })).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(list.getByRole('button', { name: /^Add note on: / })).toHaveCount(0);
});

test('reviews that could not be read are named above the list', async ({ page }) => {
  await page.route(REVIEWS, (route) => route.fulfill({ json: { reviews: [], problems: ['bad.json: .nexus/reviews/bad.json is not valid JSON'] } }));
  await page.goto(urlFor('reviews', '#/repo/overview'));
  const notice = page.getByRole('region', { name: 'Reviews that could not be read' });
  await expect(notice.getByRole('heading')).toHaveText("One review couldn't be read");
  await expect(notice).toContainText('bad.json: .nexus/reviews/bad.json is not valid JSON');
  await expect(banner(page)).toHaveCount(0);
  // The list is still there.
  await expect(page.locator('.repo-list .repo-item')).toHaveCount(8);
  // Like the banner, it shows on every section but Views.
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /Memory/ }).click();
  await expect(notice).toBeVisible();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /Views/ }).click();
  await expect(notice).toHaveCount(0);
});

test('a failed read of the reviews says so, and the next good read clears it', async ({ page }) => {
  let failing = true;
  await page.route(REVIEWS, (route) => (failing ? route.fulfill({ status: 500, json: { error: 'The reviews folder cannot be read' } }) : route.fallback()));
  await page.goto(urlFor('reviews', '#/repo/overview'));
  const notice = page.getByRole('region', { name: 'Reviews that could not be read' });
  await expect(notice.getByRole('heading')).toHaveText("The reviews couldn't be read");
  await expect(notice).toContainText('The reviews folder cannot be read');
  await expect(page.locator('.repo-list .repo-item')).toHaveCount(8);
  // The next change the server reports reads them again: a file appears in the reviews folder (not a review).
  failing = false;
  const touched = join(rootOf('reviews'), '.nexus', 'reviews', 'retry.txt');
  writeFileSync(touched, 'retry\n');
  try {
    await expect(banner(page)).toBeVisible({ timeout: 15_000 });
    await expect(notice).toHaveCount(0);
  } finally {
    rmSync(touched, { force: true });
  }
});

test('a review answered in another tab says so, keeps your marks on screen, then shows the recorded answer', async ({ page }) => {
  let answered = false;
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  // After the refused send, the next read of the reviews waits until the test lets it through.
  await serveReviews(page, async () => (answered ? (await held, true) : false), (r) => {
    r.answers = { ...ELSEWHERE };
  });
  await page.route(ANSWERS, (route) => {
    answered = true;
    return route.fulfill({ status: 409, json: { error: 'Review "repo-tidy" has already been answered' } });
  });
  await page.goto(urlFor('reviews', '#/repo/overview'));
  const list = page.locator('.repo-list');
  await keepAll(list);
  await banner(page).getByRole('button', { name: 'Submit review' }).click();
  await expect(banner(page).getByRole('alert')).toHaveText('This review was already answered, perhaps in another tab. The recorded answer is shown.');
  for (const text of ROWS) await expect(marks(list, text).getByRole('button', { name: 'Keep' })).toHaveAttribute('aria-pressed', 'true');
  release();
  for (const text of ROWS) {
    await expect(marks(list, text).getByRole('button', { name: 'Remove' })).toHaveAttribute('aria-pressed', 'true');
    await expect(marks(list, text).getByRole('button', { name: 'Keep' })).toHaveAttribute('aria-pressed', 'false');
    await expect(marks(list, text).getByRole('button', { name: 'Remove' })).toBeDisabled();
  }
  await expect(banner(page).getByRole('alert')).toBeVisible();
  await expect(banner(page).getByRole('button', { name: 'Submit review' })).toHaveCount(0);
});

test('a review answered and already applied elsewhere leaves a notice where its banner was', async ({ page }) => {
  let answered = false;
  await serveReviews(page, () => answered, (r) => {
    r.answers = { ...ELSEWHERE };
    r.read = '2026-10-10T16:05:00Z';
  });
  await page.route(ANSWERS, (route) => {
    answered = true;
    return route.fulfill({ status: 409, json: { error: 'Review "repo-tidy" has already been answered' } });
  });
  await page.goto(urlFor('reviews', '#/repo/overview'));
  const list = page.locator('.repo-list');
  await keepAll(list);
  await banner(page).getByRole('button', { name: 'Submit review' }).click();
  // The review is done with, so its banner and marks go; what happened to this tab's marks still shows.
  const notice = page.getByRole('region', { name: 'Review already answered' });
  await expect(notice.getByRole('heading')).toHaveText('“Tidy the standing instructions” was already answered');
  await expect(notice.getByRole('alert')).toHaveText("It was answered somewhere else, perhaps in another tab. Your marks here weren't sent.");
  await expect(banner(page)).toHaveCount(0);
  await expect(list.getByRole('group', { name: /^Review: / })).toHaveCount(0);
});

test('the notice for a review answered elsewhere goes when a new review opens', async ({ page }) => {
  let stage: 'open' | 'applied' | 'next' = 'open';
  await page.route(
    REVIEWS,
    guarded(async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as { reviews: ReviewState[]; problems: string[] };
      const first = body.reviews[0];
      if (first && stage !== 'open') {
        first.answers = { ...ELSEWHERE };
        first.read = '2026-10-10T16:05:00Z';
      }
      if (first && stage === 'next') {
        const row = first.request.items?.[0];
        body.reviews.push({
          request: { name: 'second-tidy', type: 'review', title: 'A second tidy', why: 'One more item.', opened: '2026-10-10T17:00:00Z', items: row ? [row] : [] },
          answers: null,
          opened: '2026-10-10T17:00:00Z',
          read: null,
        });
      }
      await route.fulfill({ response: res, json: body });
    }),
  );
  await page.route(ANSWERS, (route) => {
    stage = 'applied';
    return route.fulfill({ status: 409, json: { error: 'Review "repo-tidy" has already been answered' } });
  });
  await page.goto(urlFor('reviews', '#/repo/overview'));
  const list = page.locator('.repo-list');
  await keepAll(list);
  await banner(page).getByRole('button', { name: 'Submit review' }).click();
  const notice = page.getByRole('region', { name: 'Review already answered' });
  await expect(notice).toBeVisible();
  // A new review opens: the reviews are read again when a file appears in the reviews folder.
  stage = 'next';
  const touched = join(rootOf('reviews'), '.nexus', 'reviews', 'retry.txt');
  writeFileSync(touched, 'retry\n');
  try {
    const next = page.getByRole('region', { name: 'A second tidy' });
    await expect(next).toBeVisible({ timeout: 15_000 });
    await expect(notice).toHaveCount(0);
    // The new review starts unmarked: nothing carried over from the refused one.
    await expect(next.locator('.review-status .needs')).toHaveText('1 of 1 to mark');
    await expect(marks(list, ROWS[0]!).getByRole('button', { name: 'Keep' })).toHaveAttribute('aria-pressed', 'false');
  } finally {
    rmSync(touched, { force: true });
  }
});

test('while the answers are on their way, every mark and note is locked, so what shows is what was sent', async ({ page }) => {
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(ANSWERS, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(urlFor('reviews', '#/repo/overview'));
  const list = page.locator('.repo-list');
  await marks(list, ROWS[0]!).getByRole('button', { name: 'Keep' }).click();
  await marks(list, ROWS[1]!).getByRole('button', { name: 'Adjust' }).click();
  await list.getByRole('textbox', { name: `Note on: ${ROWS[1]!}` }).fill('Fold it into the vault rule on charts.');
  await marks(list, ROWS[2]!).getByRole('button', { name: 'Keep' }).click();
  const submit = banner(page).getByRole('button', { name: 'Submit review' });
  await submit.click();
  try {
    // Pending: nothing can change, and the banner doesn't claim it was sent yet.
    for (const text of ROWS) {
      for (const label of ['Keep', 'Adjust', 'Remove']) await expect(marks(list, text).getByRole('button', { name: label })).toBeDisabled();
    }
    await expect(list.getByRole('textbox', { name: /^Note on: / })).toHaveCount(0);
    await expect(list.getByRole('button', { name: /^Add note on: / })).toHaveCount(0);
    await expect(list.locator('.review-line .row-note')).toHaveText('Note: Fold it into the vault rule on charts.');
    await expect(submit).toBeDisabled();
    await expect(banner(page).getByRole('textbox', { name: 'Note to the agent (optional)' })).toBeDisabled();
    await expect(banner(page).locator('.review-status')).toHaveText('Sending…');
  } finally {
    release();
  }
  await expect(banner(page).locator('.review-status')).toContainText('The agent makes the changes on your next message.');
  await expect(marks(list, ROWS[1]!).getByRole('button', { name: 'Adjust' })).toHaveAttribute('aria-pressed', 'true');
  await expect(marks(list, ROWS[1]!).getByRole('button', { name: 'Adjust' })).toBeDisabled();
  expect(JSON.parse(readFileSync(answersFile(), 'utf8'))).toMatchObject({
    marks: { 'keep-agreement': 'accepted', 'web-rules': 'research', 'replay-caps': 'accepted' },
    notes: { 'web-rules': 'Fold it into the vault rule on charts.' },
  });
});

test('a send that never reaches the server says so, keeps the marks and notes, and can be sent again', async ({ page }) => {
  await page.goto(urlFor('reviews', '#/repo/overview'));
  const list = page.locator('.repo-list');
  await marks(list, ROWS[0]!).getByRole('button', { name: 'Keep' }).click();
  await marks(list, ROWS[1]!).getByRole('button', { name: 'Adjust' }).click();
  await list.getByRole('textbox', { name: `Note on: ${ROWS[1]!}` }).fill('Fold it into the vault rule on charts.');
  await marks(list, ROWS[2]!).getByRole('button', { name: 'Keep' }).click();
  await banner(page).getByRole('textbox', { name: 'Note to the agent (optional)' }).fill('Start with the web rules.');
  await page.route(ANSWERS, (route) => route.abort());
  const submit = banner(page).getByRole('button', { name: 'Submit review' });
  await submit.click();
  await expect(banner(page).getByRole('alert')).toHaveText('Cannot reach the nexus server');
  await expect(marks(list, ROWS[1]!).getByRole('button', { name: 'Adjust' })).toHaveAttribute('aria-pressed', 'true');
  await expect(marks(list, ROWS[1]!).getByRole('button', { name: 'Adjust' })).toBeEnabled();
  await expect(list.getByRole('textbox', { name: `Note on: ${ROWS[1]!}` })).toHaveValue('Fold it into the vault rule on charts.');
  await expect(banner(page).getByRole('textbox', { name: 'Note to the agent (optional)' })).toHaveValue('Start with the web rules.');
  await expect(submit).toBeEnabled();
  // The server is back: the same marks and notes go through, and the alert clears.
  await page.unroute(ANSWERS);
  await submit.click();
  await expect(banner(page).locator('.review-status')).toContainText('The agent makes the changes on your next message.');
  await expect(banner(page).getByRole('alert')).toHaveCount(0);
  expect(JSON.parse(readFileSync(answersFile(), 'utf8'))).toMatchObject({
    marks: { 'keep-agreement': 'accepted', 'web-rules': 'research', 'replay-caps': 'accepted' },
    notes: { 'web-rules': 'Fold it into the vault rule on charts.' },
    note: 'Start with the web rules.',
  });
});
