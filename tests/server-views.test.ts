import { describe, it, expect, afterEach, vi } from 'vitest';
import { fstatSync, openSync, truncateSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const opened = vi.hoisted(() => ({ fds: [] as number[], closed: [] as number[] }));

// Record every fd opened by path, so a test can prove none is left open.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    openSync: ((p: string, ...a: unknown[]) => {
      const fd = (actual.openSync as (...x: unknown[]) => number)(p, ...a);
      opened.fds.push(fd);
      return fd;
    }) as typeof actual.openSync,
    closeSync: ((fd: number) => {
      opened.closed.push(fd);
      return actual.closeSync(fd);
    }) as typeof actual.closeSync,
  };
});

const { startServer } = await import('../server/server.ts');
type RunningServer = Awaited<ReturnType<typeof startServer>>;
const { repoSignature } = await import('../server/events.ts');
const { ARTIFACTS, NOW, tempDir } = await import('./helpers.ts');
const { isolatedEnv } = await import('./governance-helpers.ts');
const { vaultRepo } = await import('./vault-helpers.ts');

const open: RunningServer[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => s.close()));
});
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
function repo() {
  return vaultRepo({
    'docs/_meta/views/load.md': '---\nname: load\ntitle: Load\ntype: table\ndata: data/load.csv\n---\nCalls.\n',
    'docs/_meta/views/shots.md': '---\nname: shots\ntitle: Shots\ntype: gallery\ndata: data/shots\n---\n',
    'data/load.csv': 'a\n1\n',
    'data/shots/a.svg': SVG,
  });
}
async function serve(root: string): Promise<RunningServer> {
  // vaultRepo() makes its repo directly under the OS temp folder, so the walk above it stops there.
  const s = await startServer({ root, cockpitDir: join(ARTIFACTS, 'cockpit-placeholder'), port: 0, now: () => NOW, watch: false, inventory: { ...isolatedEnv(tempDir()), ceiling: tmpdir() } });
  open.push(s);
  return s;
}
function stillOpen(): number[] {
  return opened.fds.filter((fd) => {
    try {
      fstatSync(fd);
      return true;
    } catch {
      return false;
    }
  });
}
async function until(cond: () => boolean, what: string, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}
const isOpen = (fd: number): boolean => {
  try {
    fstatSync(fd);
    return true;
  } catch {
    return false;
  }
};
const drain = async (r: Response): Promise<number> => (await r.arrayBuffer()).byteLength;

describe('view routes', () => {
  it('lists views in /api/repo and serves one with its data', async () => {
    const s = await serve(repo());
    const body = (await (await fetch(`${s.url}api/repo`)).json()) as { views: { name: string }[] };
    expect(body.views.map((v) => v.name)).toEqual(['load', 'shots']);
    expect(await (await fetch(`${s.url}api/repo/views/load`)).json()).toMatchObject({ data: { kind: 'table', columns: ['a'] }, error: null });
    expect((await fetch(`${s.url}api/repo/views/nope`)).status).toBe(404);
  });
  it('serves a view image by position with exactly its bytes, sandboxed, and nothing by path', async () => {
    const s = await serve(repo());
    const res = await fetch(`${s.url}api/repo/views/shots/files/0`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml');
    expect(res.headers.get('content-security-policy')).toBe('sandbox');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-length')).toBe(String(Buffer.byteLength(SVG)));
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe(SVG);
    expect((await fetch(`${s.url}api/repo/views/shots/files/1`)).status).toBe(404);
    expect((await fetch(`${s.url}api/repo/views/shots/files/a.svg`)).status).toBe(404);
    expect((await fetch(`${s.url}api/repo/views/shots/files/..%2F..%2Fload.csv`)).status).toBe(404);
    expect((await fetch(`${s.url}api/repo/views/nope/files/0`)).status).toBe(404);
  });
  it('is GET and HEAD only', async () => {
    const s = await serve(repo());
    expect((await fetch(`${s.url}api/repo/views/load`, { method: 'POST' })).status).toBe(405);
    expect((await fetch(`${s.url}api/repo/views/shots/files/0`, { method: 'DELETE' })).status).toBe(405);
    const head = await fetch(`${s.url}api/repo/views/shots/files/0`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-security-policy')).toBe('sandbox');
    expect(head.headers.get('content-length')).toBe(String(Buffer.byteLength(SVG)));
  });
  it('answers 413 for an over-cap image', async () => {
    const root = repo();
    writeFileSync(join(root, 'data', 'shots', 'big.png'), Buffer.alloc(10 * 1024 * 1024 + 1));
    const s = await serve(root);
    const statuses = await Promise.all([0, 1].map(async (n) => (await fetch(`${s.url}api/repo/views/shots/files/${n}`)).status));
    expect(statuses.sort()).toEqual([200, 413]);
  });
  it('serves an empty image and closes every fd it opened exactly once, whether served, HEAD or refused', async () => {
    const root = repo();
    writeFileSync(join(root, 'data', 'shots', 'empty.png'), '');
    writeFileSync(join(root, 'data', 'shots', 'big.png'), Buffer.alloc(10 * 1024 * 1024 + 1));
    const s = await serve(root);
    const from = opened.fds.length;
    const closedFrom = opened.closed.length;
    const sizes: number[] = [];
    for (const n of [0, 2]) sizes.push(await drain(await fetch(`${s.url}api/repo/views/shots/files/${n}`)));
    expect(sizes.sort((a, b) => a - b)).toEqual([0, Buffer.byteLength(SVG)]);
    const refused = await fetch(`${s.url}api/repo/views/shots/files/1`);
    expect(refused.status).toBe(413);
    await drain(refused);
    await drain(await fetch(`${s.url}api/repo/views/shots/files/0`, { method: 'HEAD' }));
    const missing = await fetch(`${s.url}api/repo/views/shots/files/9`);
    expect(missing.status).toBe(404);
    await drain(missing);
    const mine = opened.fds.slice(from);
    expect(mine.length).toBeGreaterThan(0);
    // Four opens: the served image streams (the stream closes it); the empty one, the 413 and the HEAD close through
    // closeSync, once each. A double close would show here as an extra call.
    expect(mine.length).toBe(4);
    const viaSync = opened.closed.slice(closedFrom);
    expect(viaSync.length).toBe(3);
    await until(() => mine.every((fd) => !isOpen(fd)), 'every fd closed');
  });
  it('closes the fd when the client aborts mid-stream', async () => {
    const root = repo();
    writeFileSync(join(root, 'data', 'shots', 'large.png'), Buffer.alloc(6 * 1024 * 1024, 7));
    const s = await serve(root);
    const from = opened.fds.length;
    const ac = new AbortController();
    const res = await fetch(`${s.url}api/repo/views/shots/files/1`, { signal: ac.signal });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(first.value?.byteLength).toBeGreaterThan(0);
    const mine = opened.fds.slice(from);
    expect(mine.length).toBe(1);
    ac.abort();
    await reader.cancel().catch(() => undefined);
    await until(() => !isOpen(mine[0]!), 'the fd to close after the abort');
  });
});

describe('pipeFd', () => {
  it('destroys the response when the file shrank after it was measured', async () => {
    const { pipeFd } = await import('../server/fd-stream.ts');
    const dir = tempDir();
    const file = join(dir, 'shrink.bin');
    writeFileSync(file, Buffer.alloc(100_000, 1));
    const srv = createServer((_req, res) => {
      const fd = openSync(file, 'r');
      truncateSync(file, 10); // shrinks between the size check and the read
      pipeFd(res, fd, 100_000, { 'content-length': 100_000 });
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    try {
      const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/`;
      const attempt = fetch(url).then((r) => r.arrayBuffer());
      await expect(attempt).rejects.toBeTruthy();
    } finally {
      srv.closeAllConnections();
      await new Promise((r) => srv.close(r));
    }
  });
});

describe('repoSignature', () => {
  it("changes when a declared view's data changes", () => {
    const root = repo();
    const env = { ...isolatedEnv(tempDir()), ceiling: tmpdir() };
    const a = repoSignature(root, env);
    writeFileSync(join(root, 'data', 'load.csv'), 'a\n1\n2\n');
    expect(repoSignature(root, env)).not.toBe(a);
  });
  it('changes when a gallery image is rewritten in place under the same name', () => {
    const root = repo();
    const env = { ...isolatedEnv(tempDir()), ceiling: tmpdir() };
    const a = repoSignature(root, env);
    writeFileSync(join(root, 'data', 'shots', 'a.svg'), `${SVG}<!-- redrawn, and longer -->`);
    expect(repoSignature(root, env)).not.toBe(a);
  });
});
