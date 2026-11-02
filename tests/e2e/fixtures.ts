import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, Route } from '@playwright/test';
import type { RepoSnapshot, Snapshot } from '../../core/types.ts';

export const PORTS = { live: 4490, empty: 4491, broken: 4492, visual: 4493, watch: 4494, two: 4495, planning: 4497, gates: 4498, plan: 4499, concepts: 4489, repo: 4488, reviews: 4487, finished: 4486 } as const;
export type Fixture = keyof typeof PORTS;

export function urlFor(fixture: Fixture, suffix = ''): string {
  return `http://127.0.0.1:${PORTS[fixture]}/${suffix}`;
}

const ROOTS = fileURLToPath(new URL('../../.e2e/roots.json', import.meta.url));

export function rootOf(fixture: Fixture): string {
  const roots = JSON.parse(readFileSync(ROOTS, 'utf8')) as Partial<Record<Fixture, string>>;
  const root = roots[fixture];
  if (!root) throw new Error(`No e2e root for "${fixture}"; is serve-example.mjs running?`);
  return root;
}

export function buildDir(fixture: Fixture): string {
  return join(rootOf(fixture), '.build', 'relay-rebuild');
}

/** The restart test starts, stops and restarts its own server here, so it can prove a tab survives a restart. */
export const RESTART_PORT = 4496;

/** What Playwright says when a route handler's fetch, read or fulfil is cut off by its test ending or timing out. */
const TEARDOWN = ['Response has been disposed', 'Test ended', 'Test timeout of', 'Target page, context or browser has been closed'];

/**
 * Wraps a route handler that fetches the real response. A change on the server (an earlier test's file put back) can
 * start a read just as the test ends; that read is let go. Any other error is the handler's own and still fails the
 * test.
 */
export function guarded(handler: (route: Route) => Promise<void>): (route: Route) => Promise<void> {
  return async (route) => {
    try {
      await handler(route);
    } catch (e) {
      if (!(e instanceof Error && TEARDOWN.some((t) => e.message.includes(t)))) throw e;
    }
  };
}

/** Serves one JSON read with a change. */
async function serveEdited<T>(page: Page, url: RegExp, edit: (body: T) => void): Promise<void> {
  await page.route(
    url,
    guarded(async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as T;
      edit(body);
      await route.fulfill({ response: res, json: body });
    }),
  );
}

/** Serves the build's snapshot with a change, for states a fixture doesn't hold. */
export async function serveSnapshot(page: Page, edit: (s: Snapshot) => void): Promise<void> {
  await serveEdited(page, /\/api\/builds\/relay-rebuild$/, edit);
}

/** Serves a fixture's repo read with a change, for states it doesn't hold (subfolder items, a setting). */
export async function serveRepo(page: Page, edit: (r: RepoSnapshot) => void, fixture: Fixture = 'repo'): Promise<void> {
  await serveEdited(page, new RegExp(`:${PORTS[fixture]}/api/repo$`), edit);
}
