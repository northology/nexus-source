import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const hooks = vi.hoisted(() => ({ calls: [] as { fn: string; path: string }[] }));

// Wrap node:fs so each test sees every call and the path it was given, tagged with the function's name.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const wrap = <F extends (...a: never[]) => unknown>(fn: string, f: F): F =>
    ((p: unknown, ...a: unknown[]) => {
      hooks.calls.push({ fn, path: String(p) });
      return (f as unknown as (...x: unknown[]) => unknown)(p, ...a);
    }) as unknown as F;
  const realpathSync = Object.assign(wrap('realpathSync', actual.realpathSync), { native: wrap('realpathSync.native', actual.realpathSync.native) });
  return {
    ...actual,
    realpathSync,
    watch: wrap('watch', actual.watch),
    lstatSync: wrap('lstatSync', actual.lstatSync),
    readlinkSync: wrap('readlinkSync', actual.readlinkSync),
    existsSync: wrap('existsSync', actual.existsSync),
    statSync: wrap('statSync', actual.statSync),
    readdirSync: wrap('readdirSync', actual.readdirSync),
    readFileSync: wrap('readFileSync', actual.readFileSync),
    openSync: wrap('openSync', actual.openSync),
  };
});

const { watchBuilds, signature } = await import('../server/events.ts');
const { sandbox } = await import('./governance-helpers.ts');

const HOST = 'p3-nohost.invalid';
const UNC = `\\\\${HOST}\\share`;

/** Make a link; false when links need a privilege here. */
function link(text: string, at: string): boolean {
  try {
    symlinkSync(text, at, 'dir');
    return true;
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'EPERM' || code === 'EACCES') return false;
    throw e;
  }
}

const norm = (p: string): string => p.toLowerCase().replace(/\\/g, '/');
const toHost = (): string[] => hooks.calls.filter((c) => norm(c.path).includes(HOST)).map((c) => `${c.fn} ${c.path}`);
/** Calls on the link (or anything below it) that could follow it: only lstat and readlink may look at a link. */
const followed = (at: string): string[] =>
  hooks.calls.filter((c) => (norm(c.path) === norm(at) || norm(c.path).startsWith(`${norm(at)}/`)) && c.fn !== 'lstatSync' && c.fn !== 'readlinkSync').map((c) => `${c.fn} ${c.path}`);

beforeEach(() => {
  hooks.calls.length = 0;
});

describe('watchBuilds with a link', () => {
  for (const forcePolling of [false, true]) {
    it(`never touches a .build that is a network link (${forcePolling ? 'polling' : 'watching'})`, async () => {
      const { root } = sandbox();
      if (!link(UNC, join(root, '.build'))) return;
      hooks.calls.length = 0;
      const stop = watchBuilds(root, () => {}, { forcePolling, pollMs: 20, identityMs: 20, debounceMs: 5 });
      await new Promise((r) => setTimeout(r, 120));
      stop();
      expect(toHost()).toEqual([]);
      expect(followed(join(root, '.build'))).toEqual([]);
      expect(hooks.calls.filter((c) => c.fn === 'watch')).toEqual([]);
    });
  }
  it('does not follow a linked entry inside .build when it polls', async () => {
    const { root } = sandbox();
    mkdirSync(join(root, '.build', 'real-build'), { recursive: true });
    writeFileSync(join(root, '.build', 'real-build', 'a.txt'), 'a');
    if (!link(UNC, join(root, '.build', 'evil-build'))) return;
    hooks.calls.length = 0;
    const stop = watchBuilds(root, () => {}, { forcePolling: true, pollMs: 20, identityMs: 20, debounceMs: 5 });
    await new Promise((r) => setTimeout(r, 120));
    stop();
    expect(toHost()).toEqual([]);
    expect(followed(join(root, '.build', 'evil-build'))).toEqual([]);
    // A real build is still watched.
    expect(hooks.calls.some((c) => c.fn === 'statSync' && norm(c.path).endsWith('real-build/a.txt'))).toBe(true);
  });
  it('still follows a linked entry whose links stay on this drive', async () => {
    const { root } = sandbox();
    mkdirSync(join(root, 'elsewhere'), { recursive: true });
    writeFileSync(join(root, 'elsewhere', 'b.txt'), 'b');
    mkdirSync(join(root, '.build'), { recursive: true });
    if (!link(join(root, 'elsewhere'), join(root, '.build', 'near'))) return;
    hooks.calls.length = 0;
    const stop = watchBuilds(root, () => {}, { forcePolling: true, pollMs: 20, identityMs: 20, debounceMs: 5 });
    await new Promise((r) => setTimeout(r, 80));
    stop();
    expect(hooks.calls.some((c) => c.fn === 'statSync' && norm(c.path).endsWith('near/b.txt'))).toBe(true);
  });
  it('walks a normal build folder to its files, so a bug in the walk would show', () => {
    const { root } = sandbox();
    mkdirSync(join(root, '.build', 'b', 'logs'), { recursive: true });
    writeFileSync(join(root, '.build', 'b', 'logs', 'x.json'), '{}');
    writeFileSync(join(root, '.build', 'b', 'skip.tmp'), 'x');
    const sig = signature(root, join(root, '.build'));
    expect(sig).toContain('x.json');
    expect(sig).not.toContain('skip.tmp');
    expect(sig.startsWith('error:')).toBe(false);
  });
  it('does not loop on a link back into its own folder', () => {
    const { root } = sandbox();
    mkdirSync(join(root, '.build', 'b'), { recursive: true });
    writeFileSync(join(root, '.build', 'b', 'x.json'), '{}');
    let made = false;
    for (const type of ['dir', 'junction'] as const) {
      try {
        symlinkSync(join(root, '.build'), join(root, '.build', 'b', 'loop'), type);
        made = true;
        break;
      } catch {
        // Try the next kind of link.
      }
    }
    if (!made) return;
    const sig = signature(root, join(root, '.build'));
    expect(sig.startsWith('error:')).toBe(false);
    expect(sig.split('|')).toHaveLength(1);
  });
});
