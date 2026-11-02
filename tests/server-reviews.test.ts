import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { governanceInventory } from '../core/governance/inventory.ts';
import type { InventoryEnv } from '../core/governance/types.ts';
import { openReview, reviewPath } from '../core/reviews.ts';
import { repoSignature } from '../server/events.ts';
import { startServer, type RunningServer } from '../server/server.ts';
import { ARTIFACTS, NOW } from './helpers.ts';
import { put, sandbox } from './governance-helpers.ts';

const open: RunningServer[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => s.close()));
});
async function serve(root: string, inventory: InventoryEnv): Promise<RunningServer> {
  const s = await startServer({ root, cockpitDir: join(ARTIFACTS, 'cockpit-placeholder'), port: 0, now: () => NOW, watch: false, inventory });
  open.push(s);
  return s;
}
function withReview(): { root: string; env: InventoryEnv } {
  const { root, env } = sandbox();
  put(root, { 'CLAUDE.md': '# Repo\n' });
  const id = governanceInventory(root, env).items.find((i) => i.location === 'CLAUDE.md')?.id ?? '';
  openReview(root, { name: 'tidy-up', type: 'review', title: 'Tidy', why: 'Mark it.', items: [{ name: 'repo-claude', text: 'CLAUDE.md', item: id, target: 'CLAUDE.md' }] }, NOW, env);
  return { root, env };
}
const post = (s: RunningServer, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${s.url}api/reviews/tidy-up/answers`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nexus-token': s.token, ...headers }, body: JSON.stringify(body) });

describe('/api/reviews', () => {
  it('lists none in a repo without reviews', async () => {
    const { root, env } = sandbox();
    const s = await serve(root, env);
    expect(await (await fetch(`${s.url}api/reviews`)).json()).toEqual({ reviews: [], problems: [] });
  });
  it('lists an open review, waiting', async () => {
    const { root, env } = withReview();
    const s = await serve(root, env);
    const body = (await (await fetch(`${s.url}api/reviews`)).json()) as { reviews: { request: { name: string }; answers: unknown; read: unknown }[] };
    expect(body.reviews).toMatchObject([{ request: { name: 'tidy-up' }, answers: null, read: null }]);
  });
  it('takes the cockpit\'s answers once, stamping targets', async () => {
    const { root, env } = withReview();
    const s = await serve(root, env);
    const res = await post(s, { marks: { 'repo-claude': 'declined' } });
    expect(res.status).toBe(201);
    expect(JSON.parse(readFileSync(reviewPath(root, 'tidy-up', true), 'utf8'))).toMatchObject({ gate: 'tidy-up', submitted: NOW, marks: { 'repo-claude': 'declined' }, targets: { 'repo-claude': ['CLAUDE.md'] } });
    expect((await post(s, { marks: { 'repo-claude': 'declined' } })).status).toBe(409);
  });
  it('refuses answers that don\'t come from the cockpit page', async () => {
    const { root, env } = withReview();
    const s = await serve(root, env);
    expect((await post(s, { marks: { 'repo-claude': 'accepted' } }, { 'x-nexus-token': 'stale' })).status).toBe(403);
    expect((await post(s, { marks: { 'repo-claude': 'accepted' } }, { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await post(s, { marks: { 'repo-claude': 'accepted' } }, { origin: 'http://evil.example' })).status).toBe(403);
    expect((await post(s, { marks: { 'repo-claude': 'accepted' }, note: 'x'.repeat(300 * 1024) })).status).toBe(413);
    expect(existsSync(reviewPath(root, 'tidy-up', true))).toBe(false);
  });
  it('lets no other write through: /api/repo stays read-only, and the review routes take only their one method', async () => {
    const { root, env } = withReview();
    const s = await serve(root, env);
    expect((await fetch(`${s.url}api/repo`, { method: 'POST' })).status).toBe(405);
    expect((await fetch(`${s.url}api/reviews/tidy-up/answers`, { method: 'PUT' })).status).toBe(405);
    expect((await fetch(`${s.url}api/reviews`, { method: 'POST' })).status).toBe(405);
    expect((await fetch(`${s.url}api/reviews/Bad%20Name/answers`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nexus-token': s.token }, body: '{}' })).status).toBe(400);
  });
});

describe('repo events', () => {
  it('change when a review opens or is answered', () => {
    const { root, env } = sandbox();
    put(root, { 'CLAUDE.md': '# Repo\n' });
    const before = repoSignature(root, env);
    const id = governanceInventory(root, env).items[0]?.id ?? '';
    openReview(root, { name: 'tidy-up', type: 'review', title: 'T', why: 'W', items: [{ name: 'repo-claude', text: 'x', item: id, target: 'CLAUDE.md' }] }, NOW, env);
    expect(repoSignature(root, env)).not.toBe(before);
  });
});
