import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { startServer, type RunningServer } from '../server/server.ts';
import { ARTIFACTS, NOW } from './helpers.ts';
import { put, sandbox } from './governance-helpers.ts';
import type { InventoryEnv } from '../core/governance/types.ts';

const open: RunningServer[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => s.close()));
});
async function serve(root: string, inventory: InventoryEnv): Promise<RunningServer> {
  const s = await startServer({ root, cockpitDir: join(ARTIFACTS, 'cockpit-placeholder'), port: 0, now: () => NOW, watch: false, inventory });
  open.push(s);
  return s;
}

describe('/api/repo', () => {
  it('serves the inventory with no build and no vault', async () => {
    const { root, env } = sandbox();
    put(root, { 'CLAUDE.md': '# Repo\n' });
    const s = await serve(root, env);
    const body = (await (await fetch(`${s.url}api/repo`)).json()) as { inventory: { vault: boolean; items: { location: string; id: string }[] }; views: unknown[] };
    expect(body.inventory.vault).toBe(false);
    expect(body.inventory.items.map((i) => i.location)).toEqual(['CLAUDE.md']);
    expect(body.views).toEqual([]);
  });
  it('serves an item by id and 404s anything else', async () => {
    const { root, env } = sandbox();
    put(root, { 'CLAUDE.md': '# Repo\n' });
    const s = await serve(root, env);
    const { inventory } = (await (await fetch(`${s.url}api/repo`)).json()) as { inventory: { items: { id: string }[] } };
    const res = await fetch(`${s.url}api/repo/items/${inventory.items[0]?.id ?? ''}`);
    expect(await res.json()).toMatchObject({ text: '# Repo\n', item: { location: 'CLAUDE.md' } });
    const unknown = await fetch(`${s.url}api/repo/items/000000000000`);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'No standing instruction with that id' });
    const bad = await fetch(`${s.url}api/repo/items/..%2F..%2FCLAUDE.md`);
    expect(bad.status).toBe(404);
    expect(await bad.json()).toEqual({ error: "That isn't a standing-instruction id" });
    expect((await fetch(`${s.url}api/repo/x`)).status).toBe(404);
  });
  it('lists subfolder instruction files, and serves one by id', async () => {
    const { root, env } = sandbox();
    put(root, { 'CLAUDE.md': '# Repo\n', 'pkg/CLAUDE.md': '# Pkg\n' });
    const s = await serve(root, env);
    const { inventory } = (await (await fetch(`${s.url}api/repo`)).json()) as { inventory: { items: { location: string; id: string; folder?: string }[] } };
    const pkg = inventory.items.find((i) => i.location === 'pkg/CLAUDE.md');
    expect(pkg?.folder).toBe('pkg');
    expect(await (await fetch(`${s.url}api/repo/items/${pkg?.id ?? ''}`)).json()).toMatchObject({ text: '# Pkg\n' });
  });
  it('accepts nothing but GET and HEAD', async () => {
    const { root, env } = sandbox();
    const s = await serve(root, env);
    for (const method of ['POST', 'PUT', 'DELETE']) expect((await fetch(`${s.url}api/repo`, { method })).status).toBe(405);
    expect((await fetch(`${s.url}api/repo/items/000000000000`, { method: 'POST' })).status).toBe(405);
    const get = await fetch(`${s.url}api/repo`);
    const head = await fetch(`${s.url}api/repo`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-type')).toBe(get.headers.get('content-type'));
    expect(await head.text()).toBe('');
  });
});
