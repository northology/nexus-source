import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { buildDir, urlFor, type Fixture } from './fixtures';

// Spec section 7: fluid from a 960px split-screen window up to 2560x1440, never with sideways scrolling.
const VIEWPORTS = [
  { width: 960, height: 1080 },
  { width: 1100, height: 900 },
  { width: 1280, height: 1440 },
  { width: 1600, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
] as const;

interface Place {
  name: string;
  fixture: Fixture;
  hash: string;
  ready: string;
  /** Pages that render the full frame have the rail with its "Times in" select. */
  frame: boolean;
  setup?: (page: Page) => Promise<void>;
}

const framed = (name: string, hash: string, ready: string): Place => ({ name, fixture: 'visual', hash, ready, frame: true });

const PLACES: Place[] = [
  framed('gate', '', 'li.row'),
  framed('gate pause-scope', '#/gate/pause-scope', 'li.row'),
  framed('gate spec-review', '#/gate/spec-review', '.reader .md h1'),
  framed('gate look', '#/gate/look', '.cround'),
  framed('gate scope', '#/gate/scope', 'li.row'),
  framed('logs decisions', '#/logs/decisions', '.erow'),
  framed('logs issues', '#/logs/issues', '.erow'),
  framed('logs changes', '#/logs/changes', '.erow'),
  framed('logs questions', '#/logs/questions', '.erow'),
  framed('documents plans', '#/documents/plans', '.empty'),
  framed('documents specs', '#/documents/specs', '.md-mermaid svg'),
  framed('documents audits', '#/documents/audits', '.empty'),
  framed('documents reports', '#/documents/reports', '.empty'),
  framed('documents notes', '#/documents/notes', '.reader .md p'),
  framed('concepts', '#/concepts', '.cround'),
  { name: 'concepts chosen', fixture: 'concepts', hash: '#/concepts/chosen?phase=replay', ready: '.lineage', frame: true },
  framed('plan', '#/plan', '.head'),
  { name: 'plan list', fixture: 'plan', hash: '#/plan', ready: '.prow', frame: true },
  { name: 'plan board', fixture: 'plan', hash: '#/plan?mode=board', ready: '.bcard', frame: true },
  { name: 'empty checkout', fixture: 'empty', hash: '#/gate', ready: '.empty strong', frame: false },
  { name: 'build picker', fixture: 'two', hash: '', ready: '.picker-list', frame: false },
  {
    name: 'offline',
    fixture: 'visual',
    hash: '',
    ready: '.empty strong',
    frame: false,
    setup: async (page) => {
      await page.route(/\/api\/builds/, (r) => r.abort());
    },
  },
];

/** Elements that must not scroll sideways; diagrams and, outside Guidance, code blocks scroll inside themselves by design (Guidance code wraps). */
const FRAME = ['main', '.rail', '.top'];

async function inViewport(page: Page, selector: string): Promise<string | null> {
  const box = await page.locator(selector).first().boundingBox();
  const vp = page.viewportSize();
  if (!box || !vp) return `${selector} has no box`;
  const inside = box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width + 0.5 && box.y + box.height <= vp.height + 0.5;
  return inside ? null : `${selector} at ${JSON.stringify(box)} is outside ${vp.width}x${vp.height}`;
}

for (const viewport of VIEWPORTS) {
  test(`no sideways scroll and the controls stay in view at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    for (const place of PLACES) {
      await page.unrouteAll();
      if (place.setup) await place.setup(page);
      await page.goto(urlFor(place.fixture, place.hash));
      await expect(page.locator(place.ready).first(), place.name).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
      expect.soft(widths.scroll, `${place.name}: page scroll width`).toBeLessThanOrEqual(widths.inner);
      for (const sel of FRAME) {
        const el = await page.locator(sel).first().evaluate((e) => ({ scroll: e.scrollWidth, client: e.clientWidth }));
        expect.soft(el.scroll, `${place.name}: ${sel} scrolls sideways`).toBeLessThanOrEqual(el.client);
      }
      expect.soft(await inViewport(page, '.theme'), `${place.name}: theme switch`).toBeNull();
      if (place.frame) {
        expect.soft(await inViewport(page, '.rail .zone select'), `${place.name}: "Times in" select`).toBeNull();
        // The top bar's pieces sit side by side: build name, then stages, then the theme switch, never on top of each other.
        const [name, stages, theme] = await Promise.all(['.build-name', '.stages', '.theme'].map((s) => page.locator(s).boundingBox()));
        expect.soft(name && stages && name.x + name.width <= stages.x, `${place.name}: build name clear of the stages`).toBe(true);
        expect.soft(stages && theme && stages.x + stages.width <= theme.x, `${place.name}: stages clear of the theme switch`).toBe(true);
        // A short name like the fixture's fits whole at every width; only long names truncate.
        const cut = await page.locator('.build-name strong').evaluate((e) => e.scrollWidth > e.clientWidth);
        expect.soft(cut, `${place.name}: build name cut short`).toBe(false);
      }
    }
  });
}

test('type holds 12/14/22/60 up to 1920 and grows to 14/16/26/72 at 2560', async ({ page }) => {
  const sizes = async () =>
    page.evaluate(() => {
      const px = (sel: string) => getComputedStyle(document.querySelector(sel) ?? document.body).fontSize;
      return { body: px('body'), label: px('.rail .cnt'), title: px('.head h1'), figure: px('.figure') };
    });
  for (const [width, height, want] of [
    [1280, 1440, { body: '14px', label: '12px', title: '22px', figure: '60px' }],
    [1920, 1080, { body: '14px', label: '12px', title: '22px', figure: '60px' }],
    [2560, 1440, { body: '16px', label: '14px', title: '26px', figure: '72px' }],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(urlFor('visual'));
    await expect(page.locator('li.row').first()).toBeVisible();
    expect(await sizes(), `type at ${width}`).toEqual(want);
  }
});

test('diagram text follows the body size', async ({ page }) => {
  for (const [width, height, want] of [
    [1920, 1080, '14px'],
    [2560, 1440, '16px'],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(urlFor('visual', '#/documents/specs'));
    const svg = page.locator('.md-mermaid svg');
    // The second goto is a same-document navigation: the old diagram stays until the redraw at the new size lands.
    await expect(svg).toHaveCSS('font-size', want);
  }
});

test('the frame scales its fixed dimensions with the type', async ({ page }) => {
  const frame = async () =>
    page.evaluate(() => ({
      rail: Math.round(document.querySelector('.rail')?.getBoundingClientRect().width ?? 0),
      top: Math.round(document.querySelector('.top')?.getBoundingClientRect().height ?? 0),
    }));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(urlFor('visual'));
  await expect(page.locator('li.row').first()).toBeVisible();
  expect(await frame()).toEqual({ rail: 232, top: 64 });
  await page.setViewportSize({ width: 2560, height: 1440 });
  const wide = await frame();
  expect(wide.rail).toBeGreaterThan(232 * 1.1);
  expect(wide.top).toBeGreaterThan(64 * 1.1);
  // Wide windows use the width: the gate table grows well past its 1920 measure.
  const table = await page.locator('ol.rows').evaluate((el) => el.getBoundingClientRect().width);
  expect(table).toBeGreaterThan(1600);
});

test('narrow windows slim the rail, drop stage labels to numbers and fold the source under the text', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto(urlFor('visual'));
  const row = page.locator('li.row').first();
  await expect(row).toBeVisible();
  expect(Math.round((await page.locator('.rail').boundingBox())?.width ?? 0)).toBeLessThan(200);
  // Stage labels leave the screen but stay readable to assistive tech.
  await expect(page.getByRole('list', { name: 'Stage' }).getByText('Planning')).toHaveCSS('position', 'absolute');
  await expect(page.getByRole('list', { name: 'Stage' })).toContainText('Planning');
  const stmt = await row.locator('.stmt').boundingBox();
  const src = await row.locator('.src').boundingBox();
  expect(stmt && src && src.y >= stmt.y + stmt.height - 4 && Math.abs(src.x - stmt.x) < 2, 'source sits under the statement').toBe(true);
  await page.goto(urlFor('visual', '#/logs/decisions'));
  const erow = page.locator('.erow').first();
  await expect(erow).toBeVisible();
  const et = await erow.locator('.et').boundingBox();
  const ew = await erow.locator('.ew').boundingBox();
  expect(et && ew && ew.y >= et.y + et.height - 4 && Math.abs(ew.x - et.x) < 2, 'From sits under the decision').toBe(true);
});

test('documents: contents beside the text when wide, list and contents above the text when narrow', async ({ page }) => {
  writeFileSync(join(buildDir('live'), 'notes', 'wide-contents.md'), '# Contents check\n\n## First part\n\nSome text.\n\n## Second part\n\nMore text.\n\n### A detail\n\nEnd.\n');
  const hash = '#/documents/notes?doc=notes/wide-contents.md';
  const boxes = async () => {
    const toc = page.getByRole('navigation', { name: 'Contents' });
    await expect(toc).toBeVisible();
    const get = async (sel: string) => (await page.locator(sel).first().boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
    return { toc: await get('.reader .toc'), md: await get('.reader .md'), list: await get('.dlist'), reader: await get('.reader') };
  };
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(urlFor('live', hash));
  let b = await boxes();
  expect(b.toc.x, 'contents to the right of the text').toBeGreaterThanOrEqual(b.md.x + b.md.width);
  expect(await page.locator('.reader .toc').evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
  expect(b.list.x + b.list.width, 'document list on the left').toBeLessThanOrEqual(b.reader.x);
  await page.setViewportSize({ width: 1100, height: 900 });
  b = await boxes();
  expect(b.toc.y + b.toc.height, 'contents above the text').toBeLessThanOrEqual(b.md.y + 1);
  expect(b.list.y + b.list.height, 'document list above the reader').toBeLessThanOrEqual(b.reader.y + 1);
});
