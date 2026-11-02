import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { ApiError, createClient } from '../../cockpit/src/api/client.ts';
import { startServer, type RunningServer } from '../../server/server.ts';
import { governanceInventory } from '../../core/governance/inventory.ts';
import { openReview } from '../../core/reviews.ts';
import { ARTIFACTS, NOW, exampleRepo } from '../helpers.ts';
import { put, sandbox } from '../governance-helpers.ts';

const B = 'relay-rebuild';
const running: RunningServer[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => s.close()));
});

const COCKPIT = join(ARTIFACTS, 'cockpit-placeholder');

async function setup() {
  const s = await startServer({ root: exampleRepo(), cockpitDir: COCKPIT, port: 0, watch: false });
  running.push(s);
  return { s, client: createClient({ base: s.url, token: s.token }) };
}

async function rejection(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error('expected the call to fail');
}

describe('cockpit API client', () => {
  it('reads a static rules file by index', async () => {
    const { client } = await setup();
    await expect(client.ruleText(0)).rejects.toMatchObject({ status: 404 });
  });
  it('reads the repo, an item, a view and a view file URL', async () => {
    const calls: string[] = [];
    const client = createClient({ token: 't', fetch: (async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch });
    await client.repo();
    await client.repoItem('abcdef012345');
    await client.view('traffic load');
    expect(calls).toEqual(['/api/repo', '/api/repo/items/abcdef012345', '/api/repo/views/traffic%20load']);
    expect(client.viewFileUrl('traffic load', 2)).toBe('/api/repo/views/traffic%20load/files/2');
  });
  it('rejects a missing repo item or view with the server status', async () => {
    const messages: Record<string, string> = { '/api/repo/items/x': 'No standing instruction with that id', '/api/repo/views/x': 'No view named "x"' };
    const client = createClient({ token: 't', fetch: (async (url: string) =>
      new Response(JSON.stringify({ error: messages[url] }), { status: 404, headers: { 'content-type': 'application/json' } })) as typeof fetch });
    await expect(client.repoItem('x')).rejects.toMatchObject({ status: 404, message: 'No standing instruction with that id' });
    await expect(client.view('x')).rejects.toMatchObject({ status: 404, message: 'No view named "x"' });
  });
  it('encodes a view name in a file URL', async () => {
    const { client } = await setup();
    expect(client.viewFileUrl('a/b#c', 0)).toContain('/api/repo/views/a%2Fb%23c/files/0');
  });
  it('lists builds and reads a snapshot', async () => {
    const { client } = await setup();
    expect(await client.builds()).toEqual([B]);
    const snapshot = await client.snapshot(B);
    expect(snapshot.gates.map((g) => g.name)).toEqual(['look', 'scope', 'spec-review']);
  });
  it('reads a document and builds its URL', async () => {
    const { s, client } = await setup();
    expect(await client.fileText(B, 'documents/specs/relay-rebuild-spec.md')).toMatch(/^# Relay rebuild: design/);
    expect(client.fileUrl(B, 'documents/specs/relay-rebuild-spec.md')).toBe(`${s.url}api/builds/${B}/files/documents/specs/relay-rebuild-spec.md`);
  });
  it('submits answers with the page token', async () => {
    const { client } = await setup();
    expect(await client.submit(B, 'look', { choice: 'quiet-board', note: 'Calmer' })).toMatchObject({ gate: 'look', choice: 'quiet-board', note: 'Calmer' });
  });
  it('turns a second answer into a 409', async () => {
    const { client } = await setup();
    await client.submit(B, 'look', { choice: 'quiet-board' });
    const e = await rejection(client.submit(B, 'look', { choice: 'dense-table' }));
    expect(e.status).toBe(409);
    expect(e.message).toBe('Gate "look" has already been answered');
  });
  it('will not submit without a token', async () => {
    const { s } = await setup();
    const e = await rejection(createClient({ base: s.url, token: null }).submit(B, 'look', { choice: 'quiet-board' }));
    expect(e.status).toBe(403);
  });
  it('reports a missing file as 404', async () => {
    const { client } = await setup();
    expect((await rejection(client.fileText(B, 'documents/specs/missing.md'))).status).toBe(404);
  });
  it('reports an unreachable server as status 0', async () => {
    const e = await rejection(createClient({ base: 'http://127.0.0.1:9', token: 'x' }).builds());
    expect(e.status).toBe(0);
    expect(e.message).toBe('Cannot reach the nexus server');
  });
});

describe('the token after a server restart', () => {
  it('submits with the new token when the server restarted on the same port', async () => {
    const root = exampleRepo();
    const first = await startServer({ root, cockpitDir: COCKPIT, port: 0, watch: false });
    const client = createClient({ base: first.url, token: first.token });
    await first.close();
    const second = await startServer({ root, cockpitDir: COCKPIT, port: first.port, tries: 1, watch: false });
    running.push(second);
    expect(second.token).not.toBe(first.token);
    expect(await client.submit(B, 'look', { choice: 'quiet-board', note: 'Kept through the restart' })).toMatchObject({ choice: 'quiet-board', note: 'Kept through the restart' });
  });
  it('re-reads the token from the cockpit page on demand', async () => {
    const root = exampleRepo();
    const first = await startServer({ root, cockpitDir: COCKPIT, port: 0, watch: false });
    const seen: string[] = [];
    const client = createClient({
      base: first.url,
      token: first.token,
      fetch: async (input, init) => {
        seen.push(`${init?.method ?? 'GET'} ${String(input)}`);
        return fetch(input, init);
      },
    });
    await first.close();
    const second = await startServer({ root, cockpitDir: COCKPIT, port: first.port, tries: 1, watch: false });
    running.push(second);
    await client.refreshToken();
    expect(seen).toEqual([`GET ${second.url}`]);
    seen.length = 0;
    // Already current, so the answer goes through on the first POST, with no refused attempt.
    expect(await client.submit(B, 'look', { choice: 'quiet-board' })).toMatchObject({ choice: 'quiet-board' });
    expect(seen).toEqual([`POST ${second.url}api/builds/${B}/gates/look/answers`]);
  });
  it('retries once, and only for a refused token', async () => {
    const calls: string[] = [];
    const refused = (error: string) => new Response(JSON.stringify({ error }), { status: 403, headers: { 'content-type': 'application/json' } });
    const fake = (error: string): typeof fetch => async (input, init) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
      return init?.method === 'POST' ? refused(error) : new Response('<head><meta name="nexus-token" content="0123456789abcdef0123456789abcdef">\n</head>', { status: 200 });
    };
    const e = await rejection(createClient({ base: 'http://127.0.0.1:1', token: 'stale', fetch: fake('Answers must come from the cockpit page') }).submit(B, 'look', { choice: 'quiet-board' }));
    expect(e.status).toBe(403);
    expect(calls).toEqual(['POST http://127.0.0.1:1/api/builds/relay-rebuild/gates/look/answers', 'GET http://127.0.0.1:1/', 'POST http://127.0.0.1:1/api/builds/relay-rebuild/gates/look/answers']);
    calls.length = 0;
    await rejection(createClient({ base: 'http://127.0.0.1:1', token: 'stale', fetch: fake('Answers must come from the cockpit itself') }).submit(B, 'look', { choice: 'quiet-board' }));
    expect(calls).toHaveLength(1);
  });
});

describe('concept pages on the asset origin', () => {
  /** A fake server whose /api/builds names each asset base in turn (null for none). */
  const fakeBuilds = (...assets: (string | null)[]): typeof fetch => {
    let i = 0;
    return async () => {
      const a = assets[Math.min(i++, assets.length - 1)];
      return new Response(JSON.stringify({ root: '/r', builds: ['b'], ...(a === null ? {} : { assets: a }) }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
  };
  it('points concept paths at the asset origin /api/builds names, and follows it when it changes', async () => {
    const client = createClient({ base: '', token: 'x', fetch: fakeBuilds('http://127.0.0.1:5001/', 'http://127.0.0.1:5002') });
    await client.builds();
    expect(client.fileUrl('b', 'concepts/t/x.html')).toBe('http://127.0.0.1:5001/b/concepts/t/x.html');
    expect(client.fileUrl('b', 'documents/a.md')).toBe('/api/builds/b/files/documents/a.md');
    await client.builds();
    expect(client.fileUrl('b', 'concepts/t/x.html')).toBe('http://127.0.0.1:5002/b/concepts/t/x.html');
  });
  it('keeps the old route for concept paths when no asset origin is named', async () => {
    const client = createClient({ base: '', token: 'x', fetch: fakeBuilds(null) });
    expect(client.fileUrl('b', 'concepts/t/x.html')).toBe('/api/builds/b/files/concepts/t/x.html');
    await client.builds();
    expect(client.fileUrl('b', 'concepts/t/x.html')).toBe('/api/builds/b/files/concepts/t/x.html');
  });
  it('drops an asset origin the server stops naming', async () => {
    const client = createClient({ base: '', token: 'x', fetch: fakeBuilds('http://127.0.0.1:5001/', null) });
    await client.builds();
    await client.builds();
    expect(client.fileUrl('b', 'concepts/t/x.html')).toBe('/api/builds/b/files/concepts/t/x.html');
  });
  it('loads a concept page from the real asset listener', async () => {
    const { s, client } = await setup();
    await client.builds();
    const url = client.fileUrl(B, 'concepts/quiet-board.html');
    expect(url).toBe(`${s.assets}${B}/concepts/quiet-board.html`);
    expect((await fetch(url)).status).toBe(200);
  });
});

describe('reviews', () => {
  it('reads reviews and posts their answers with the page token', async () => {
    const { root, env } = sandbox();
    put(root, { 'CLAUDE.md': '# Repo\n' });
    const id = governanceInventory(root, env).items[0]?.id ?? '';
    openReview(root, { name: 'tidy-up', type: 'review', title: 'T', why: 'W', items: [{ name: 'repo-claude', text: 'x', item: id, target: 'CLAUDE.md' }] }, NOW, env);
    const s = await startServer({ root, cockpitDir: join(ARTIFACTS, 'cockpit-placeholder'), port: 0, now: () => NOW, watch: false, inventory: env });
    try {
      const client = createClient({ base: s.url, token: s.token });
      const first = await client.getReviews();
      expect(first.reviews.map((r) => r.request.name)).toEqual(['tidy-up']);
      expect(first.problems).toEqual([]);
      await client.postReviewAnswers('tidy-up', { marks: { 'repo-claude': 'accepted' } });
      expect((await client.getReviews()).reviews[0]?.answers?.marks).toEqual({ 'repo-claude': 'accepted' });
    } finally {
      await s.close();
    }
  });
  it('carries the reviews that could not be read, beside the ones that could', async () => {
    const { root, env } = sandbox();
    put(root, { 'CLAUDE.md': '# Repo\n' });
    const id = governanceInventory(root, env).items[0]?.id ?? '';
    openReview(root, { name: 'tidy-up', type: 'review', title: 'T', why: 'W', items: [{ name: 'repo-claude', text: 'x', item: id, target: 'CLAUDE.md' }] }, NOW, env);
    put(root, { '.nexus/reviews/bad.json': '{ not json' });
    const s = await startServer({ root, cockpitDir: join(ARTIFACTS, 'cockpit-placeholder'), port: 0, now: () => NOW, watch: false, inventory: env });
    try {
      const got = await createClient({ base: s.url, token: s.token }).getReviews();
      expect(got.reviews.map((r) => r.request.name)).toEqual(['tidy-up']);
      expect(got.problems).toHaveLength(1);
      expect(got.problems[0]).toMatch(/^bad\.json: /);
    } finally {
      await s.close();
    }
  });
  it('reads a body with no lists as none of either', async () => {
    const client = createClient({ base: '', token: 'x', fetch: () => Promise.resolve(new Response('{}', { status: 200 })) });
    expect(await client.getReviews()).toEqual({ reviews: [], problems: [] });
  });
});
