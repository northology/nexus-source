import { expect, test } from '@playwright/test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ReviewState } from '../../core/types.ts';
import { buildDir, guarded, serveRepo, serveSnapshot, urlFor } from './fixtures';

const VIEWPORTS = [
  { width: 960, height: 1080 },
  { width: 1280, height: 1440 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
] as const;
const VIEWS = [
  { name: 'gate', hash: '', ready: 'li.row' },
  { name: 'logs', hash: '#/logs/decisions', ready: '.erow' },
  { name: 'documents', hash: '#/documents/specs', ready: '.md-mermaid svg' },
] as const;

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of VIEWPORTS) {
    for (const view of VIEWS) {
      test(`${view.name} in ${theme} at ${viewport.width}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.addInitScript((t) => {
          try {
            localStorage.setItem('nexus.theme', t);
          } catch {
            // storage blocked: the default theme is fine for this run
          }
        }, theme);
        await page.goto(urlFor('visual', view.hash));
        await expect(page.locator(view.ready).first()).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await expect(page).toHaveScreenshot(`${view.name}-${theme}-${viewport.width}.png`, { mask: [page.locator('[data-volatile]')] });
      });
    }
  }
}

const GUIDE = [
  { name: 'overview', diagrams: 1 },
  { name: 'flow', diagrams: 5 },
  { name: 'commands', diagrams: 0 },
  { name: 'views', diagrams: 0 },
] as const;

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1280, 1920] as const) {
    for (const guide of GUIDE) {
      test(`guidance ${guide.name} in ${theme} at ${width}`, async ({ page }) => {
        await page.setViewportSize(VIEWPORTS.find((v) => v.width === width) ?? { width, height: 1080 });
        await page.addInitScript((t) => {
          try {
            localStorage.setItem('nexus.theme', t);
          } catch {
            // storage blocked: the default theme is fine for this run
          }
        }, theme);
        await page.goto(urlFor('visual', `#/guidance/${guide.name}`));
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.locator('.md-mermaid > svg')).toHaveCount(guide.diagrams);
        await page.evaluate(() => document.fonts.ready);
        await expect(page).toHaveScreenshot(`guidance-${guide.name}-${theme}-${width}.png`, { mask: [page.locator('[data-volatile]')] });
      });
    }
  }
}

for (const theme of ['light', 'dark'] as const) {
  test(`gate list with phases in ${theme} at 1280`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1440 });
    await page.addInitScript((t) => {
      try {
        localStorage.setItem('nexus.theme', t);
      } catch {
        // storage blocked: the default theme is fine for this run
      }
    }, theme);
    // gate-notes.spec answers these gates on the shared fixture and runs first in `pnpm e2e`; put them back open so
    // the Gate rail reads the same in any order. Only files other specs create: the seeded gates keep their answers.
    for (const gate of ['notes-check', 'notes-blank', 'notes-keys']) rmSync(join(buildDir('gates'), 'gates', `${gate}.answers.json`), { force: true });
    await page.goto(urlFor('gates', '#/gate?tab=guardrails&phase=all'));
    await expect(page.getByRole('list', { name: 'Gates in this tab' })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`gate-list-${theme}-1280.png`, { mask: [page.locator('[data-volatile]')] });
  });
}

// The Decommission tab on a finished build: the draft final report above the gate's two rows, none marked yet.
for (const theme of ['light', 'dark'] as const) {
  test(`gate-decommission in ${theme} at 1280`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1440 });
    await page.addInitScript((t) => {
      try {
        localStorage.setItem('nexus.theme', t);
      } catch {
        // storage blocked: the default theme is fine for this run
      }
    }, theme);
    // decommission.spec submits this gate and removes the answers after each test; removed here too, so the gate is
    // open in any order.
    rmSync(join(buildDir('finished'), 'gates', 'decommission-relay-rebuild.answers.json'), { force: true });
    await page.goto(urlFor('finished', '#/gate/decommission-relay-rebuild'));
    await expect(page.locator('.gate-doc .md h1')).toBeVisible();
    await expect(page.locator('li.row')).toHaveCount(2);
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`gate-decommission-${theme}-1280.png`, { mask: [page.locator('[data-volatile]')] });
  });
}

for (const theme of ['light', 'dark'] as const) {
  for (const mode of ['list', 'board'] as const) {
    test(`plan ${mode} in ${theme} at 1280`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 1440 });
      await page.addInitScript((t) => {
        try {
          localStorage.setItem('nexus.theme', t);
        } catch {
          // storage blocked: the default theme is fine for this run
        }
      }, theme);
      await page.goto(urlFor('plan', mode === 'board' ? '#/plan?mode=board' : '#/plan'));
      await expect(page.locator(mode === 'board' ? '.bcard' : '.prow').first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`plan-${mode}-${theme}-1280.png`, { mask: [page.locator('[data-volatile]')] });
    });
    if (mode === 'board') {
      test(`plan board with a card open in ${theme} at 1280`, async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 1440 });
        await page.addInitScript((t) => {
          try {
            localStorage.setItem('nexus.theme', t);
          } catch {
            // storage blocked: the default theme is fine for this run
          }
        }, theme);
        await page.goto(urlFor('plan', '#/plan?mode=board'));
        await page.getByRole('button', { name: /^Lag per source/ }).click();
        await expect(page.locator('.board-detail')).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await expect(page).toHaveScreenshot(`plan-board-open-${theme}-1280.png`, { mask: [page.locator('[data-volatile]')] });
      });
    }
  }
}

for (const theme of ['light', 'dark'] as const) {
  for (const view of [
    { name: 'concepts-proposed', hash: '#/concepts/proposed?round=legend-1' },
    { name: 'concepts-chosen', hash: '#/concepts/chosen?phase=replay&topic=status-look' },
  ] as const) {
    test(`${view.name} in ${theme} at 1280`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 1440 });
      await page.addInitScript((t) => {
        try {
          localStorage.setItem('nexus.theme', t);
        } catch {
          // storage blocked: the default theme is fine for this run
        }
      }, theme);
      await page.goto(urlFor('concepts', view.hash));
      await expect(page.locator('.view iframe').first()).toBeVisible();
      // Every concept page in view is its own frame: wait for each to load before the shot.
      for (const frame of page.frames()) await frame.waitForLoadState('load');
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`${view.name}-${theme}-1280.png`, { mask: [page.locator('[data-volatile]')] });
    });
  }
}

for (const theme of ['light', 'dark'] as const) {
  for (const mode of ['side', 'swipe'] as const) {
    test(`concepts compare ${mode} in ${theme} at 1280`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 1440 });
      await page.addInitScript((t) => {
        try {
          localStorage.setItem('nexus.theme', t);
        } catch {
          // storage blocked: the default theme is fine for this run
        }
      }, theme);
      await page.goto(urlFor('concepts', '#/concepts/proposed?round=legend-1'));
      const strip = page.getByRole('list', { name: 'Options' });
      for (const label of ['Lag bars', 'Lag dots']) {
        await strip.getByRole('button', { name: label, exact: true }).click();
        await page.getByRole('checkbox', { name: 'Combine' }).check();
      }
      await page.locator('.cview-bar').getByRole('button', { name: 'Compare', exact: true }).click();
      if (mode === 'swipe') {
        await page.getByRole('button', { name: 'Swipe' }).click();
        await expect(page.getByRole('slider', { name: 'Reveal' })).toHaveValue('50');
      }
      await expect(page.locator(mode === 'swipe' ? '.cswipe iframe' : '.cpair iframe')).toHaveCount(2);
      // Every concept page in view is its own frame: wait for each to load before the shot.
      for (const frame of page.frames()) await frame.waitForLoadState('load');
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`concepts-compare-${mode}-${theme}-1280.png`, { mask: [page.locator('[data-volatile]')] });
    });
  }
}

const REPO_VIEWS = [
  { name: 'repo-overview', hash: '#/repo/overview', ready: '.repo-item' },
  { name: 'repo-memory', hash: '#/repo/memory', ready: '.repo-reader .md' },
  { name: 'view-table', hash: '#/repo/views?view=traffic-load', ready: 'table.vtable' },
  { name: 'view-chart', hash: '#/repo/views?view=lag-trend', ready: '.chart-view svg path' },
  { name: 'view-gallery', hash: '#/repo/views?view=screens', ready: '.gallery img' },
  { name: 'view-markdown', hash: '#/repo/views?view=runbook', ready: '.md-mermaid > svg' },
] as const;

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1280, 1920] as const) {
    for (const view of REPO_VIEWS) {
      test(`${view.name} in ${theme} at ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 1280 ? 1440 : 1080 });
        await page.addInitScript((t) => {
          try {
            localStorage.setItem('nexus.theme', t);
          } catch {
            // storage blocked: the default theme is fine for this run
          }
        }, theme);
        await page.goto(urlFor('repo', view.hash));
        await page.locator(view.ready).first().waitFor();
        // Every image must be loaded and decoded before the shot (gallery image cards).
        await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete && img.naturalWidth > 0));
        await page.evaluate(() => Promise.all(Array.from(document.images).map((img) => img.decode().catch(() => undefined))));
        await page.evaluate(() => document.fonts.ready);
        // The repo's title and a memory file's location carry its temporary folder's name (and the user's), which change every run.
        await expect(page).toHaveScreenshot(`${view.name}-${theme}-${width}.png`, { mask: [page.locator('[data-volatile]'), page.locator('.build-name strong'), page.locator('.repo-reader .facts dt:first-of-type + dd'), page.locator('.repo-item[data-kind="memory"] small')] });
      });
    }
  }
}

// An open review part-way through: one row kept, one set to adjust with its note written, one unmarked, so the
// banner's count, the tally, a pressed and an unpressed mark, the note field and the "add note" link all show.
// Marks live in the page only, so nothing is written and the reviews fixture stays open.
for (const theme of ['light', 'dark'] as const) {
  for (const width of [1280, 1920] as const) {
    test(`repo-review in ${theme} at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 1280 ? 1440 : 1080 });
      await page.addInitScript((t) => {
        try {
          localStorage.setItem('nexus.theme', t);
        } catch {
          // storage blocked: the default theme is fine for this run
        }
      }, theme);
      await page.goto(urlFor('reviews', '#/repo/overview'));
      const list = page.locator('.repo-list');
      await list.getByRole('group', { name: 'Review: CLAUDE.md: the working agreement' }).getByRole('button', { name: 'Keep' }).click();
      await list.getByRole('group', { name: 'Review: Web rules: still needed?' }).getByRole('button', { name: 'Adjust' }).click();
      await list.getByRole('textbox', { name: 'Note on: Web rules: still needed?' }).fill('Fold it into the vault rule on charts.');
      // Focus leaves the note, so no caret blinks in the shot.
      await page.locator('#repo-title').evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.locator('.repo-reader .md').first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`repo-review-${theme}-${width}.png`, { mask: [page.locator('[data-volatile]'), page.locator('.build-name strong'), page.locator('.repo-reader .facts dt:first-of-type + dd'), page.locator('.repo-item[data-kind="memory"] small')] });
    });
  }
}

// The same review once sent: the status line, no submit bar, the recorded marks dimmed and a recorded note. The
// answer is added to the reviews read rather than sent, so nothing is written and its time is fixed.
for (const theme of ['light', 'dark'] as const) {
  test(`repo-review-sent in ${theme} at 1280`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1440 });
    await page.addInitScript((t) => {
      try {
        localStorage.setItem('nexus.theme', t);
      } catch {
        // storage blocked: the default theme is fine for this run
      }
    }, theme);
    await page.route(
      /\/api\/reviews$/,
      guarded(async (route) => {
        const res = await route.fetch();
        const body = (await res.json()) as { reviews: ReviewState[]; problems: string[] };
        for (const r of body.reviews) {
          r.answers = { gate: r.request.name, submitted: '2026-10-10T16:00:00Z', marks: { 'keep-agreement': 'accepted', 'web-rules': 'research', 'replay-caps': 'declined' }, notes: { 'web-rules': 'Fold it into the vault rule on charts.' } };
        }
        await route.fulfill({ response: res, json: body });
      }),
    );
    await page.goto(urlFor('reviews', '#/repo/overview'));
    await page.locator('.review-line .row-note').waitFor();
    await page.locator('.repo-reader .md').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`repo-review-sent-${theme}-1280.png`, { mask: [page.locator('[data-volatile]'), page.locator('.build-name strong'), page.locator('.repo-reader .facts dt:first-of-type + dd'), page.locator('.repo-item[data-kind="memory"] small')] });
  });
}

// Subfolder instruction files under their folders: two folders, one holding two files, and a review row inside a
// folder group with its marks. No fixture repo holds subfolder files, so they are added to the repo read.
for (const theme of ['light', 'dark'] as const) {
  test(`repo-folders in ${theme} at 1280`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1440 });
    await page.addInitScript((t) => {
      try {
        localStorage.setItem('nexus.theme', t);
      } catch {
        // storage blocked: the default theme is fine for this run
      }
    }, theme);
    await serveRepo(page, (r) => {
      const base = r.inventory.items.find((i) => i.kind === 'instructions');
      const web = r.inventory.items.find((i) => i.kind === 'rule-file' && i.location.endsWith('web.md'));
      if (!base || !web) throw new Error('the reviews fixture lists no instruction file or no web rule file');
      // The reviewed rule file, as if it sat in a subfolder: its row keeps its marks there.
      web.folder = 'packages/web';
      const when = (folder: string) => `loads when Claude Code reads, writes or edits a file in ${folder}/`;
      r.inventory.items.push(
        { ...base, id: 'a1b2c3d4e5f6', title: 'API package', location: 'packages/api/CLAUDE.md', scope: 'on-demand', folder: 'packages/api', conditional: when('packages/api') },
        { ...base, id: 'a2b2c3d4e5f6', title: 'API package, local', location: 'packages/api/CLAUDE.local.md', scope: 'on-demand', folder: 'packages/api', conditional: when('packages/api') },
        { ...base, id: 'b1b2c3d4e5f6', title: 'Worker', location: 'services/worker/AGENTS.md', scope: 'on-demand', folder: 'services/worker', conditional: when('services/worker') },
      );
    }, 'reviews');
    await page.goto(urlFor('reviews', '#/repo/instructions'));
    await expect(page.locator('.repo-folder h3')).toHaveText(['In packages/web/', 'In packages/api/', 'In services/worker/']);
    await page.locator('.repo-reader .md').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`repo-folders-${theme}-1280.png`, { mask: [page.locator('[data-volatile]'), page.locator('.build-name strong'), page.locator('.repo-reader .facts dt:first-of-type + dd')] });
  });
}

test('reduced motion turns transitions off', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(urlFor('visual'));
  const duration = await page.locator('li.row .mark .solid').first().evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(duration).toBe('0s');
});

for (const theme of ['light', 'dark'] as const) {
  test(`phases in ${theme} at 1280`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1440 });
    await page.addInitScript((t) => {
      try {
        localStorage.setItem('nexus.theme', t);
      } catch {
        // storage blocked: the default theme is fine for this run
      }
    }, theme);
    await serveSnapshot(page, (s) => {
      s.phases = [
        { name: 'replay', description: 'Replay calls from the archive, at the speed they arrived or faster.' },
        { name: 'replay-board', description: 'A board of the replayed calls, grouped by source, with the lag each one shows.' },
        { name: 'archive-search', description: 'Search the archive by caller and time.' },
      ];
    });
    await page.goto(urlFor('visual', '#/phases'));
    await expect(page.locator('.phases-table tbody tr').first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`phases-${theme}-1280.png`, { mask: [page.locator('[data-volatile]')] });
  });
}
