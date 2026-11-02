import { expect, test, type Page } from '@playwright/test';
import { urlFor } from './fixtures';

const rail = (page: Page) => page.getByRole('navigation', { name: 'Sections' });

test('Guidance is last in the rail and opens on the overview', async ({ page }) => {
  await page.goto(urlFor('live', '#/gate'));
  const links = rail(page).getByRole('link');
  await expect(links.last()).toHaveText(/Guidance/);
  await links.last().click();
  await expect(page).toHaveURL(/#\/guidance$/);
  await expect(page.getByRole('tab', { name: /Overview/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { level: 2, name: 'What nexus is' })).toBeVisible();
  await page.getByRole('tab', { name: /How a build runs/ }).click();
  await expect(page).toHaveURL(/#\/guidance\/flow$/);
  await expect(page.getByRole('heading', { level: 2, name: 'The wall' })).toBeVisible();
});

test('the Views page gives a recipe for each view type, with no diagram', async ({ page }) => {
  await page.goto(urlFor('live', '#/guidance'));
  await page.getByRole('tab', { name: /Views/ }).click();
  await expect(page).toHaveURL(/#\/guidance\/views$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Views' })).toBeVisible();
  for (const h of ['Table', 'Markdown', 'Chart', 'Gallery']) await expect(page.getByRole('heading', { level: 3, name: h, exact: true })).toBeVisible();
  await expect(page.locator('.md')).toContainText('type: chart');
  await expect(page.locator('.md-mermaid')).toHaveCount(0);
});

test('opens with no build in the checkout, from the empty message', async ({ page }) => {
  await page.goto(urlFor('empty', '#/gate'));
  await expect(rail(page).getByRole('link')).toHaveText([/Build/, /Guidance/]);
  await page.getByRole('link', { name: 'Read the Guidance' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'What nexus is' })).toBeVisible();
  await expect(rail(page).getByRole('link', { name: /Guidance/ })).toHaveAttribute('aria-current', 'page');
});

test('opens when the server is unreachable', async ({ page }) => {
  await page.route('**/api/**', (r) => r.abort());
  await page.goto(urlFor('live', '#/guidance/flow'));
  await expect(page.getByRole('heading', { level: 2, name: 'The wall' })).toBeVisible();
  await expect(rail(page).getByRole('link')).toHaveText([/Build/, /Guidance/]);
});

for (const theme of ['light', 'dark'] as const) {
  test(`draws every map as a diagram, in the ${theme} theme`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('nexus.theme', t), theme);
    await page.goto(urlFor('live', '#/guidance/flow'));
    await expect(page.locator('.md-mermaid > svg')).toHaveCount(5);
    await expect(page.locator('.md-mermaid-error')).toHaveCount(0);
    await page.goto(urlFor('live', '#/guidance/overview'));
    await expect(page.locator('.md-mermaid > svg')).toHaveCount(1);
    await expect(page.locator('.md-mermaid-error')).toHaveCount(0);
  });
}

test('every diagram label fits its box, with no line cut off', async ({ page }) => {
  for (const sub of ['overview', 'flow']) {
    await page.goto(urlFor('live', `#/guidance/${sub}`));
    await expect(page.locator('.md-mermaid > svg').first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const clipped = await page.locator('.md-mermaid foreignObject').evaluateAll((objects) =>
      objects
        .map((o) => {
          const label = o.firstElementChild as HTMLElement | null;
          const box = o.getBoundingClientRect();
          return { text: o.textContent ?? '', over: label ? label.getBoundingClientRect().height - box.height : 0 };
        })
        .filter((l) => l.over > 1)
        .map((l) => l.text),
    );
    expect(clipped, sub).toEqual([]);
  }
});

test('a deep link to a heading below the diagrams lands on it once they are drawn', async ({ page }) => {
  await page.goto(urlFor('live', '#/guidance/flow?h=the-wall'));
  await expect(page.locator('.md-mermaid > svg')).toHaveCount(5);
  await expect(page.getByRole('heading', { level: 2, name: 'The wall' })).toBeInViewport();
});

test('once the reader scrolls, a resize leaves them where they are instead of going back to the linked heading', async ({ page }) => {
  await page.goto(urlFor('live', '#/guidance/flow?h=the-wall'));
  await expect(page.locator('.md-mermaid > svg')).toHaveCount(5);
  await expect(page.getByRole('heading', { level: 2, name: 'The wall' })).toBeInViewport();
  await page.mouse.move(700, 500);
  await page.mouse.wheel(0, -3000);
  await expect(page.getByRole('heading', { level: 2, name: 'The wall' })).not.toBeInViewport();
  const before = await page.locator('#main').evaluate((m) => m.scrollTop);
  // The page grows, as a late diagram or font would make it.
  await page.locator('.guide').evaluate((el) => {
    (el as HTMLElement).style.maxWidth = '560px';
  });
  // Two frames: the resize lays out, then the size observer runs.
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  await expect(page.getByRole('heading', { level: 2, name: 'The wall' })).not.toBeInViewport();
  expect(Math.abs((await page.locator('#main').evaluate((m) => m.scrollTop)) - before)).toBeLessThan(400);
});

test('the guide stays put when the build becomes ready under it', async ({ page }) => {
  await page.route('**/api/**', (r) => r.abort());
  await page.goto(urlFor('live', '#/guidance/flow'));
  await expect(page.locator('.md-mermaid > svg')).toHaveCount(5);
  await page.locator('.guide').evaluate((el) => {
    el.setAttribute('data-kept', 'yes');
  });
  await page.unroute('**/api/**');
  await expect(rail(page).getByRole('link')).toHaveCount(7, { timeout: 15_000 });
  await expect(page.locator('.guide[data-kept="yes"]')).toHaveCount(1);
});

test('the rail leads back to the build picker from the Guidance', async ({ page }) => {
  await page.goto(urlFor('two', '#/guidance'));
  await expect(page.getByRole('heading', { level: 2, name: 'What nexus is' })).toBeVisible();
  await rail(page).getByRole('link', { name: /Builds/ }).click();
  await expect(page.getByText('This checkout has 2 builds')).toBeVisible();
});

test('the generator markers stay out of the commands page', async ({ page }) => {
  await page.goto(urlFor('live', '#/guidance/commands'));
  await expect(page.getByRole('heading', { level: 3, name: 'guard', exact: true })).toBeAttached();
  await expect(page.locator('.md')).not.toContainText('generated:commands');
});

test('the command index links to each entry, and the address keeps it', async ({ page }) => {
  await page.goto(urlFor('live', '#/guidance/commands'));
  await page.getByRole('link', { name: 'phase status', exact: true }).click();
  await expect(page).toHaveURL(/#\/guidance\/commands\?h=phase-status$/);
  await expect(page.getByRole('heading', { level: 3, name: 'phase status' })).toBeInViewport();
});

test('a heading link keeps the chosen build in a checkout with several', async ({ page }) => {
  await page.goto(urlFor('two', '#/guidance/commands?build=relay-rebuild'));
  await page.getByRole('link', { name: 'gate apply', exact: true }).click();
  await expect(page).toHaveURL(/build=relay-rebuild/);
  await expect(page.getByRole('heading', { level: 3, name: 'gate apply' })).toBeInViewport();
  await expect(rail(page).getByRole('link')).toHaveCount(7);
});

test('an unknown heading or sub-page shows the overview or page from the top', async ({ page }) => {
  await page.goto(urlFor('live', '#/guidance/commands?h=nope'));
  await expect(page.getByRole('heading', { level: 1, name: 'Commands' })).toBeInViewport();
  await page.goto(urlFor('live', '#/guidance/nope'));
  await expect(page.getByRole('tab', { name: /Overview/ })).toHaveAttribute('aria-selected', 'true');
});

test('guidance code blocks wrap instead of scrolling, so no line is clipped at 1280', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1440 });
  for (const guide of ['views', 'commands']) {
    await page.goto(urlFor('visual', `#/guidance/${guide}`));
    await expect(page.locator('.guide pre').first()).toBeVisible();
    const clipped = await page.locator('.guide pre').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth || getComputedStyle(e).overflowX !== 'visible').length);
    expect(clipped, guide).toBe(0);
  }
});

for (const theme of ['light', 'dark'] as const) {
  test(`no edge runs through a subgraph title, in the ${theme} theme`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('nexus.theme', t), theme);
    for (const sub of ['overview', 'flow']) {
      await page.goto(urlFor('live', `#/guidance/${sub}`));
      await expect(page.locator('.md-mermaid > svg').first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const hits = await page.evaluate(() => {
        const out: string[] = [];
        let titles = 0;
        for (const svg of Array.from(document.querySelectorAll('.md-mermaid > svg'))) {
          // The title's box: the label text itself, in page pixels, shrunk by a pixel on every side.
          const boxes = Array.from(svg.querySelectorAll('.cluster-label')).map((label) => {
            const r = (label.querySelector('foreignObject > div, text') ?? label).getBoundingClientRect();
            return { text: (label.textContent ?? '').trim(), left: r.left + 1, right: r.right - 1, top: r.top + 1, bottom: r.bottom - 1 };
          });
          titles += boxes.length;
          for (const edge of Array.from(svg.querySelectorAll<SVGPathElement>('.edgePaths path, path.flowchart-link'))) {
            const m = edge.getScreenCTM();
            if (!m) continue;
            const length = edge.getTotalLength();
            for (let at = 0; at <= length; at += 1) {
              const p = edge.getPointAtLength(at);
              const x = m.a * p.x + m.c * p.y + m.e;
              const y = m.b * p.x + m.d * p.y + m.f;
              for (const b of boxes) if (x > b.left && x < b.right && y > b.top && y < b.bottom) out.push(`${b.text}: edge ${edge.id || edge.getAttribute('class')}`);
            }
          }
        }
        return { titles, hits: [...new Set(out)] };
      });
      // The diagrams hold subgraph titles; a page with none would pass this check for nothing.
      if (sub === 'flow') expect(hits.titles, sub).toBeGreaterThan(0);
      expect(hits.hits, sub).toEqual([]);
    }
  });
}
