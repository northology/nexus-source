import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdirSync, readFileSync, readlinkSync, realpathSync, symlinkSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { ViewDef } from '../core/vault/types.ts';

const hooks = vi.hoisted(() => ({
  calls: [] as string[],
  failOpen: null as string | null,
  failLstat: null as string | null,
  override: null as ViewDef | null,
  open: new Set<number>(),
  lstats: 0,
}));

// Wrap node:fs so the test can see every path the reader touches, and inject a failure.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const seen = (p: unknown): void => { hooks.calls.push(String(p)); };
  const realpathSync = Object.assign(
    (p: string, ...a: unknown[]) => { seen(p); return (actual.realpathSync as (...x: unknown[]) => string)(p, ...a); },
    { native: (p: string, ...a: unknown[]) => { seen(p); return (actual.realpathSync.native as (...x: unknown[]) => string)(p, ...a); } },
  );
  return {
    ...actual,
    realpathSync,
    lstatSync: ((p: string, ...a: unknown[]) => {
      seen(p);
      hooks.lstats++;
      if (hooks.failLstat !== null && String(p).endsWith(hooks.failLstat)) throw Object.assign(new Error('injected'), { code: 'EACCES' });
      return (actual.lstatSync as (...x: unknown[]) => unknown)(p, ...a); }) as typeof actual.lstatSync,
    existsSync: (p: string) => { seen(p); return actual.existsSync(p); },
    statSync: ((p: string, ...a: unknown[]) => { seen(p); return (actual.statSync as (...x: unknown[]) => unknown)(p, ...a); }) as typeof actual.statSync,
    readdirSync: ((p: string, ...a: unknown[]) => { seen(p); return (actual.readdirSync as (...x: unknown[]) => unknown)(p, ...a); }) as typeof actual.readdirSync,
    readFileSync: ((p: string, ...a: unknown[]) => { seen(p); return (actual.readFileSync as (...x: unknown[]) => unknown)(p, ...a); }) as typeof actual.readFileSync,
    openSync: ((p: string, ...a: unknown[]) => {
      seen(p);
      if (hooks.failOpen !== null && String(p).endsWith(hooks.failOpen)) throw Object.assign(new Error('injected'), { code: 'EPERM' });
      const fd = (actual.openSync as (...x: unknown[]) => number)(p, ...a);
      hooks.open.add(fd);
      return fd;
    }) as typeof actual.openSync,
    closeSync: ((fd: number) => { hooks.open.delete(fd); return actual.closeSync(fd); }) as typeof actual.closeSync,
  };
});

// Let a test hand readView a view the registry checker would never admit.
vi.mock('../core/vault/registry.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/vault/registry.ts')>();
  return {
    ...actual,
    readRegistry: (docs: string) => {
      const r = actual.readRegistry(docs);
      if (hooks.override) r.registry.views.set(hooks.override.name, hooks.override);
      return r;
    },
  };
});

const { readView, readViewFile, readBounded, viewSignature } = await import('../core/views/read.ts');
const { linkTextAllowed } = await import('../core/fs-guard.ts');
const { tempDir } = await import('./helpers.ts');
const { vaultRepo } = await import('./vault-helpers.ts');

const view = (name: string, type: string, data: string) => ({
  [`docs/_meta/views/${name}.md`]: `---\nname: ${name}\ntitle: ${name}\ntype: ${type}\ndata: ${data}\n---\nAbout ${name}.\n`,
});
const def = (name: string, type: ViewDef['type'], data: string): ViewDef => ({ name, title: name, type, data, description: '', file: `docs/_meta/views/${name}.md` });
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
/** A gallery view named board, whose JSON list names these files (resolved beside the list, at the repo root). */
const list = (...files: string[]) => ({ ...view('board', 'gallery', 'b.json'), 'b.json': JSON.stringify(files.map((file) => ({ file }))) });

beforeEach(() => {
  hooks.calls.length = 0;
  hooks.failOpen = null;
  hooks.failLstat = null;
  hooks.override = null;
  hooks.open.clear();
  hooks.lstats = 0;
});

describe('absolute and UNC paths from repo content', () => {
  const outside = tempDir('nexus-outside-');
  writeFileSync(join(outside, 'x.png'), PNG);
  const absolute = join(outside, 'x.png');
  const unc = '//localhost/C$/Windows/win.ini';
  const uncImage = '//localhost/C$/Windows/x.png';
  const touched = (needle: string): string[] => hooks.calls.filter((c) => c.toLowerCase().replace(/\\/g, '/').includes(needle.toLowerCase().replace(/\\/g, '/')));

  it('are refused on their text before any fs call, for a gallery entry', () => {
    const root = vaultRepo({ ...view('g', 'gallery', 'l.json'), 'l.json': JSON.stringify([{ file: uncImage }, { file: absolute }]) });
    hooks.calls.length = 0;
    expect(readView(root, 'g').data).toMatchObject({ kind: 'gallery', images: [], refused: [uncImage, absolute] });
    expect(touched('localhost')).toEqual([]);
    expect(touched(outside)).toEqual([]);
  });
  it('are refused on their text before any fs call, for a view\'s data', () => {
    const root = vaultRepo({});
    for (const data of [unc, absolute]) {
      hooks.override = def('abs', 'table', data);
      hooks.calls.length = 0;
      expect(readView(root, 'abs').error).toMatch(/leads outside the repo; not read$/);
      expect(() => readViewFile(root, 'abs', 0)).toThrow();
      expect(touched('localhost')).toEqual([]);
      expect(touched(outside)).toEqual([]);
    }
  });
});

describe('.git and docs on the canonical path', () => {
  it.runIf(process.platform === 'win32')('refuses a data path using an alternate data stream spelling of .git', () => {
    const root = vaultRepo({ '.git/config': '[core]\n' });
    hooks.override = def('sneaky', 'markdown', '.git::$INDEX_ALLOCATION/config');
    const a = readView(root, 'sneaky');
    expect(a.data).toBeNull();
    expect(a.error).toMatch(/\.git/);
  });
  it.runIf(process.platform === 'win32')('refuses a data path using the 8.3 short name of .git', () => {
    const root = vaultRepo({ '.git/config': '[core]\n' });
    let short = false;
    try { short = realpathSync.native(join(root, 'GIT~1')).toLowerCase().endsWith('.git'); } catch { short = false; }
    if (!short) return; // 8.3 names are off for this drive: nothing to alias
    hooks.override = def('sneaky', 'markdown', 'GIT~1/config');
    const a = readView(root, 'sneaky');
    expect(a.data).toBeNull();
    expect(a.error).toMatch(/\.git/);
  });
  it('refuses a data path into .git or docs, spelled in any case', () => {
    const root = vaultRepo({ '.git/config': '[core]\n', 'docs/x.md': '# x\n' });
    for (const data of ['docs/x.md', '.git/config', 'a/../.git/config', ...(process.platform === 'win32' ? ['.GIT/config', 'Docs/x.md'] : [])]) {
      hooks.override = def('sneaky', 'markdown', data);
      const a = readView(root, 'sneaky');
      expect(a.data).toBeNull();
      expect(a.error).toMatch(/not read$/);
    }
  });
  it('refuses a gallery entry pointing into .git and names it', () => {
    const root = vaultRepo({ ...list('.git/x.png', 'sub/../.GIT/x.png'), '.git/x.png': '' });
    expect(readView(root, 'board').data).toMatchObject({ kind: 'gallery', images: [], refused: ['.git/x.png', 'sub/../.GIT/x.png'] });
  });
});

describe('what is not a regular file', () => {
  it.skipIf(process.platform === 'win32')('a gallery whose data is a FIFO answers an error without opening it', async () => {
    const { execFileSync } = await import('node:child_process');
    const root = vaultRepo(view('g', 'gallery', 'pipe'));
    execFileSync('mkfifo', [join(root, 'pipe')]);
    expect(readView(root, 'g').error).toBe("pipe isn't a regular file; not read");
  });
});

describe('readBounded', () => {
  it('reads at most cap + 1 bytes from an open file, whatever its size', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'f'), 'x'.repeat(100));
    const fd = openSync(join(dir, 'f'), 'r');
    try {
      expect(readBounded(fd, 10).length).toBe(11);
    } finally { closeSync(fd); }
    const again = openSync(join(dir, 'f'), 'r');
    try {
      expect(readBounded(again, 1000).length).toBe(100);
    } finally { closeSync(again); }
  });
});

describe('viewSignature containment', () => {
  it('does not list the files of a data folder that is a link out of the repo', () => {
    const outside = tempDir('nexus-outside-');
    writeFileSync(join(outside, 'private-name.png'), PNG);
    const root = vaultRepo(view('g', 'gallery', 'shots'));
    symlinkSync(outside, join(root, 'shots'), 'junction');
    expect(viewSignature(root)).not.toContain('private-name');
    expect(viewSignature(root)).toMatch(/\|-$/);
  });
});

describe('filesystem errors on repo files', () => {
  it('answer an error naming the path, never a throw', () => {
    const root = vaultRepo({ ...view('load', 'table', 'data/load.csv'), 'data/load.csv': 'a\n1\n' });
    mkdirSync(join(root, 'data'), { recursive: true });
    hooks.failOpen = 'load.csv';
    expect(readView(root, 'load')).toMatchObject({ data: null, error: "data/load.csv can't be read: EPERM" });
  });
});

describe('readViewFile hands back an open file, never a path', () => {
  it('returns an fd that reads the bytes, and leaves nothing open once closed', () => {
    const root = vaultRepo({ ...view('g', 'gallery', 'shots') });
    mkdirSync(join(root, 'shots'), { recursive: true });
    writeFileSync(join(root, 'shots', 'a.png'), PNG);
    const f = readViewFile(root, 'g', 0);
    expect(f.size).toBe(PNG.length);
    expect(f.type).toBe('image/png');
    expect(hooks.open.has(f.fd)).toBe(true);
    expect(readFileSync(f.fd)).toEqual(PNG);
    closeSync(f.fd);
    expect(hooks.open.size).toBe(0);
  });
  it('closes the fd on every refusal', () => {
    const root = vaultRepo({ ...view('g', 'gallery', 'shots'), 'shots/big.png': 'x'.repeat(10 * 1024 * 1024 + 1) });
    expect(() => readViewFile(root, 'g', 0)).toThrow(expect.objectContaining({ status: 413 }));
    expect(() => readViewFile(root, 'g', 5)).toThrow(expect.objectContaining({ status: 404 }));
    expect(hooks.open.size).toBe(0);
  });
});

describe('serving one image of a large view', () => {
  const many = 200;
  it('makes about the same few fs calls for any position in a 200-image gallery folder', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < many; i++) files[`shots/s${String(i).padStart(3, '0')}.png`] = 'x';
    const root = vaultRepo({ ...view('g', 'gallery', 'shots'), ...files });
    expect((readView(root, 'g').data as { images: unknown[] }).images).toHaveLength(many);
    const counts = [0, 100, 199, 5].map((n) => {
      hooks.calls.length = 0;
      const f = readViewFile(root, 'g', n);
      closeSync(f.fd);
      expect(hooks.calls.some((c) => c.endsWith(`s${String(n).padStart(3, '0')}.png`))).toBe(true);
      return hooks.calls.length;
    });
    for (const c of counts) expect(c).toBeLessThan(80);
  });
  it('re-reads the list when the folder changes, so a new image is served at its new position', () => {
    const root = vaultRepo({ ...view('g', 'gallery', 'shots'), 'shots/b.png': 'bb' });
    const first = readViewFile(root, 'g', 0);
    closeSync(first.fd);
    expect(first.size).toBe(2);
    writeFileSync(join(root, 'shots', 'a.png'), 'a');
    const f = readViewFile(root, 'g', 0);
    closeSync(f.fd);
    expect(f.size).toBe(1);
  });
});

describe('a committed link whose target is a UNC path', () => {
  it('is refused on its text, and nothing follows it', () => {
    const root = vaultRepo(list('evil/x.png', 'evil2/x.png'));
    try {
      symlinkSync(String.raw`\\localhost\C$\Windows`,join(root, 'evil'), 'dir');
      symlinkSync('//localhost/C$/Windows', join(root, 'evil2'), 'dir');
    } catch (e) {
      if ((e as { code?: string }).code === 'EPERM' || (e as { code?: string }).code === 'EACCES') return; // links need a privilege here
      throw e;
    }
    hooks.calls.length = 0;
    const a = readView(root, 'board');
    expect(a.data).toMatchObject({ kind: 'gallery', images: [], refused: ['evil/x.png', 'evil2/x.png'] });
    expect(hooks.calls.filter((c) => c.toLowerCase().includes('localhost'))).toEqual([]);
  });
});

describe('.git at any depth', () => {
  it('refuses a nested .git for data and for gallery entries', () => {
    const root = vaultRepo({ ...list('sub/.git/x.png'), 'sub/.git/x.png': '', 'sub/.git/config': '[core]\n' });
    expect(readView(root, 'board').data).toMatchObject({ images: [], refused: ['sub/.git/x.png'] });
    hooks.override = def('nested', 'markdown', 'sub/.git/config');
    expect(readView(root, 'nested')).toMatchObject({ data: null, error: expect.stringMatching(/not read$/) });
  });
});

describe('link text allow-list', () => {
  it('accepts local spellings and refuses network and device paths', () => {
    const ok = ['..\\y', 'b/c', 'C:\\Windows', 'c:\\Windows', '\\\\?\\C:\\Windows', '\\\\?\\c:/Windows', '/usr/lib', '\\rooted'];
    const bad = ['\\\\host\\share', '//host/share', '\\\\?\\UNC\\h\\s', '\\\\?\\GLOBALROOT\\Device\\Mup\\h\\s', '\\\\.\\GLOBALROOT\\Device\\Mup\\h\\s', '\\\\.\\UNC\\h\\s', '\\??\\UNC\\h\\s', '\\??\\C:\\x', '\\\\?\\Volume{1}\\x'];
    for (const t of ok) expect(linkTextAllowed(t, 'C'), t).toBe(true);
    for (const t of bad) expect(linkTextAllowed(t, 'C'), t).toBe(false);
  });
  it("refuses a drive other than the repo's, in any spelling", () => {
    for (const t of ['Z:\\x', 'z:/x', 'Z:x', '\\\\?\\Z:\\x', '//?/z:/x']) expect(linkTextAllowed(t, 'C'), t).toBe(false);
    expect(linkTextAllowed('Z:\\x', 'z')).toBe(true);
    expect(linkTextAllowed('C:\\x', null)).toBe(false);
  });
});

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
const nohost = (): string[] => hooks.calls.filter((c) => c.toLowerCase().includes('nohost'));

describe('link chains are walked from where each link really sits', () => {
  it.runIf(process.platform === 'win32')('refuses a UNC link reached through a relative link inside a linked folder', () => {
    const root = vaultRepo(list('a/lnk/x.png'));
    mkdirSync(join(root, 'b', 'c'), { recursive: true });
    if (!link('b\\c', join(root, 'a'))) return;
    link('..\\y', join(root, 'b', 'c', 'lnk'));
    link('\\\\p11-nohost.invalid\\share', join(root, 'b', 'y'));
    hooks.calls.length = 0;
    expect(readView(root, 'board').data).toMatchObject({ images: [], refused: ['a/lnk/x.png'] });
    expect(nohost()).toEqual([]);
  });
  it.runIf(process.platform === 'win32')('refuses device and network spellings without following them', () => {
    const forms = ['\\\\?\\GLOBALROOT\\Device\\Mup\\p11-nohost.invalid\\s', '\\\\.\\GLOBALROOT\\Device\\Mup\\p11-nohost.invalid\\s', '\\??\\UNC\\p11-nohost.invalid\\s', '\\\\?\\UNC\\p11-nohost.invalid\\s', '//p11-nohost.invalid/s'];
    const root = vaultRepo(list(...forms.map((_, i) => `l${i}/x.png`)));
    for (const [i, f] of forms.entries()) if (!link(f, join(root, `l${i}`))) return;
    hooks.calls.length = 0;
    const refused = (readView(root, 'board').data as unknown as { refused?: string[] }).refused ?? [];
    // Windows rewrites some spellings (e.g. the NT \??\ prefix) when it creates the link; those that kept their text are refused.
    const kept = forms.map((_f, i) => !linkTextAllowed(readlinkSync(join(root, `l${i}`)), root.slice(0, 1)));
    expect(kept.filter(Boolean).length).toBeGreaterThanOrEqual(3);
    expect(forms.map((_f, i) => !kept[i] || refused.includes(`l${i}/x.png`))).toEqual(forms.map(() => true));
    expect(nohost()).toEqual([]);
  });
  it('visits each link once, so a target full of links cannot fan out', () => {
    // l5 points back at the repo root and each l(i) at l(i+1) six times over. Without the visited set the walk re-walks
    // each link every time it meets one (about 1,250 lstat calls here on Windows, where the OS link limit cuts it short;
    // a walk that didn't resolve each link's folder made tens of thousands); with it, each link is walked once (about 120).
    const levels = 5;
    const width = 6;
    const root = vaultRepo(list('l0/x.png'));
    if (!link(root, join(root, `l${levels}`))) return;
    for (let i = levels - 1; i >= 0; i--) link(Array<string>(width).fill(`l${i + 1}`).join('/'), join(root, `l${i}`));
    hooks.lstats = 0;
    readView(root, 'board');
    expect(hooks.lstats).toBeLessThan(400);
  });
});

describe('a link naming another drive', () => {
  // Another drive is always outside the repo (and may be a mapped network drive): no fs call may reach it.
  const onDrive = (d: string): string[] => hooks.calls.filter((c) => c.replace(/^[\\/]{2}\?[\\/]/, '').toUpperCase().startsWith(`${d}:`));
  it.runIf(process.platform === 'win32')('is refused on its text, directly and through a chain, and nothing touches that drive', () => {
    const root = vaultRepo(list('z1/x.png', 'z2/x.png', 'a/lnk/x.png'));
    const d = root.slice(0, 1).toUpperCase() === 'Z' ? 'Y' : 'Z';
    mkdirSync(join(root, 'b', 'c'), { recursive: true });
    if (!link(`${d}:\\x`, join(root, 'z1'))) return;
    link(`\\\\?\\${d}:\\x`, join(root, 'z2'));
    link('b\\c', join(root, 'a'));
    link('..\\y', join(root, 'b', 'c', 'lnk'));
    link(`${d}:\\x`, join(root, 'b', 'y'));
    hooks.calls.length = 0;
    const data = readView(root, 'board').data;
    expect(onDrive(d)).toEqual([]);
    expect(data).toMatchObject({ images: [], refused: ['z1/x.png', 'z2/x.png', 'a/lnk/x.png'] });
  });
});

describe('a link walk cut short by a filesystem error', () => {
  it('refuses the path, naming it, instead of following links it could not check', () => {
    // a -> b/c/d, and b/c is a link the walk of a's target can't lstat (injected EACCES).
    const root = vaultRepo({ ...list('a/x.png'), 'real/d/x.png': '' });
    mkdirSync(join(root, 'b'), { recursive: true });
    if (!link('b/c/d', join(root, 'a'))) return;
    link('../real', join(root, 'b', 'c'));
    hooks.failLstat = `${sep}b${sep}c`;
    hooks.calls.length = 0;
    const data = readView(root, 'board').data;
    const past = join(root, 'a', 'x.png').toLowerCase(); // only reachable by following a's target past b/c
    expect(hooks.calls.filter((c) => c.toLowerCase() === past)).toEqual([]);
    expect(data).toMatchObject({ images: [], refused: ['a/x.png'] });
    hooks.override = def('nested', 'markdown', 'a/x.png');
    expect(readView(root, 'nested')).toMatchObject({ data: null, error: expect.stringMatching(/^view "nested": a\/x\.png .*not read$/) });
  });
});
