import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { inventoryEnv, memoryKey } from '../core/governance/env.ts';
import { watchRepo } from '../server/events.ts';
import { startServer, type RunningServer } from '../server/server.ts';
import { ARTIFACTS } from './helpers.ts';
import { put, sandbox } from './governance-helpers.ts';

const waitFor = async (check: () => boolean, ms = 3000): Promise<void> => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe('watchRepo', () => {
  it('fires when a memory folder appears after it started, and never creates one', async () => {
    const { root, env } = sandbox();
    let fired = 0;
    const stop = watchRepo(root, env, () => fired++, { pollMs: 50, debounceMs: 10 });
    try {
      put(join(env.configDir, 'projects', memoryKey(root), 'memory'), { 'MEMORY.md': 'index\n' });
      await waitFor(() => fired > 0);
    } finally {
      stop();
    }
  });

  it('does not fire when nothing changed, and creates no folder', async () => {
    const { base, root, env } = sandbox();
    const before = readdirSync(base, { recursive: true }).sort().join('|');
    let fired = 0;
    const stop = watchRepo(root, env, () => fired++, { pollMs: 30, debounceMs: 5 });
    await new Promise((r) => setTimeout(r, 200));
    stop();
    expect(fired).toBe(0);
    expect(readdirSync(base, { recursive: true }).sort().join('|')).toBe(before);
  });

  it('stays quiet after stop()', async () => {
    const { root, env } = sandbox();
    let fired = 0;
    const stop = watchRepo(root, env, () => fired++, { pollMs: 30, debounceMs: 5 });
    stop();
    put(root, { 'CLAUDE.md': '# late\n' });
    await new Promise((r) => setTimeout(r, 200));
    expect(fired).toBe(0);
  });

  it('reacts to a change under docs/ without waiting for the poll', async () => {
    const { root, env } = sandbox();
    put(root, { 'docs/note.md': 'a\n' });
    let fired = 0;
    const stop = watchRepo(root, env, () => fired++, { pollMs: 60_000, debounceMs: 5 });
    try {
      put(root, { 'CLAUDE.md': '# new\n' });
      put(root, { 'docs/note.md': 'b\n' });
      await waitFor(() => fired > 0);
    } finally {
      stop();
    }
  });
});

describe('watchRepo robustness', () => {
  it('coalesces a burst of fs events into few signature computations and one onChange', async () => {
    const { root, env } = sandbox();
    put(root, { 'docs/a.md': '0\n' });
    let computed = 0;
    let fired = 0;
    let n = 0;
    const signature = (): string => {
      computed++;
      return String(n);
    };
    const stop = watchRepo(root, env, () => fired++, { pollMs: 60_000, debounceMs: 5, signature });
    try {
      const before = computed;
      n = 1;
      for (let i = 0; i < 40; i++) put(root, { [`docs/f${i}.md`]: `${i}\n` });
      await waitFor(() => fired > 0);
      await new Promise((r) => setTimeout(r, 300));
      expect(fired).toBe(1);
      expect(computed - before).toBeLessThanOrEqual(5);
    } finally {
      stop();
    }
  });

  it('survives a signature that throws at start and on a poll, then recovers', async () => {
    const { root, env } = sandbox();
    let broken = true;
    let value = 'a';
    const signature = (): string => {
      if (broken) throw new Error('boom');
      return value;
    };
    let fired = 0;
    const stop = watchRepo(root, env, () => fired++, { pollMs: 30, debounceMs: 5, signature });
    try {
      await new Promise((r) => setTimeout(r, 150));
      expect(fired).toBe(0);
      broken = false;
      await new Promise((r) => setTimeout(r, 150));
      expect(fired).toBe(0);
      value = 'b';
      await waitFor(() => fired > 0);
    } finally {
      stop();
    }
  });
});

describe('the server announces repo changes', () => {
  const open: RunningServer[] = [];
  afterEach(async () => {
    await Promise.all(open.splice(0).map((s) => s.close()));
  });

  it('sends event: change with {"repo":true} when the inventory changes', async () => {
    const { root, env } = sandbox();
    const s = await startServer({ root, cockpitDir: join(ARTIFACTS, 'cockpit-placeholder'), port: 0, inventory: env });
    open.push(s);
    const ac = new AbortController();
    const res = await fetch(`http://127.0.0.1:${s.port}/api/events`, { signal: ac.signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    put(root, { 'CLAUDE.md': '# hello\n' });
    const end = Date.now() + 6000;
    let pending = reader.read();
    while (!buf.includes('{"repo":true}') && Date.now() < end) {
      const r = await Promise.race([pending, new Promise<null>((x) => setTimeout(() => x(null), 500))]);
      if (r === null) continue;
      if (r.done) break;
      buf += decoder.decode(r.value);
      pending = reader.read();
    }
    pending.catch(() => {});
    await reader.cancel().catch(() => {});
    ac.abort();
    expect(buf).toContain('event: change\ndata: {"repo":true}');
  });
});

describe('tests never read the real environment', () => {
  it('the default inventoryEnv() points into the temp folder for the whole run', () => {
    const env = inventoryEnv();
    const under = (p: string): boolean => resolve(p).toLowerCase().startsWith(resolve(tmpdir()).toLowerCase());
    expect(under(env.configDir)).toBe(true);
    expect(under(env.managedDir)).toBe(true);
    expect(env.ceiling).toBe(resolve(tmpdir()));
  });

  it('a child process started by a test sees the same variables', () => {
    const out = execFileSync(process.execPath, ['-e', 'console.log(JSON.stringify([process.env.CLAUDE_CONFIG_DIR, process.env.NEXUS_INVENTORY_MANAGED, process.env.NEXUS_INVENTORY_CEILING]))'], { encoding: 'utf8' });
    expect(JSON.parse(out)).toEqual([process.env['CLAUDE_CONFIG_DIR'], process.env['NEXUS_INVENTORY_MANAGED'], process.env['NEXUS_INVENTORY_CEILING']]);
  });
});
