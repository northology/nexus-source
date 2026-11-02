import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdirSync, rmSync, symlinkSync } from 'node:fs';
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
    lstatSync: wrap('lstatSync', actual.lstatSync),
    readlinkSync: wrap('readlinkSync', actual.readlinkSync),
    existsSync: wrap('existsSync', actual.existsSync),
    statSync: wrap('statSync', actual.statSync),
    readdirSync: wrap('readdirSync', actual.readdirSync),
    readFileSync: wrap('readFileSync', actual.readFileSync),
    openSync: wrap('openSync', actual.openSync),
  };
});

const { readRegistry } = await import('../core/vault/registry.ts');
const { governanceInventory } = await import('../core/governance/inventory.ts');
const { readView, listViews, viewSignature } = await import('../core/views/read.ts');
const { vaultRepo } = await import('./vault-helpers.ts');
const { repoSignature, ledgerSignature } = await import('../server/events.ts');
const { listBuilds } = await import('../core/paths.ts');
const { findLedgers } = await import('../core/progress.ts');
const { put, sandbox } = await import('./governance-helpers.ts');

const HOST = 'p3-nohost.invalid';
const UNC = `\\\\${HOST}\\share`;

/** Make a link; false when links need a privilege here. */
function link(text: string, at: string, type: 'dir' | 'file' = 'dir'): boolean {
  try {
    symlinkSync(text, at, type);
    return true;
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'EPERM' || code === 'EACCES') return false;
    throw e;
  }
}

const norm = (p: string): string => p.toLowerCase().replace(/\\/g, '/');
/** Calls that reached the host by name. */
const toHost = (): string[] => hooks.calls.filter((c) => norm(c.path).includes(HOST)).map((c) => `${c.fn} ${c.path}`);
/** Calls on the link (or anything below it) that could follow it: only lstat and readlink may look at a link. */
const followed = (at: string): string[] =>
  hooks.calls.filter((c) => (norm(c.path) === norm(at) || norm(c.path).startsWith(`${norm(at)}/`)) && c.fn !== 'lstatSync' && c.fn !== 'readlinkSync').map((c) => `${c.fn} ${c.path}`);

beforeEach(() => {
  hooks.calls.length = 0;
});

describe('the view checker', () => {
  it('refuses a view data path through a network link before following it, as a finding', () => {
    const root = vaultRepo({ 'docs/_meta/views/v.md': '---\nname: v\ntitle: V\ntype: table\ndata: lnk/x.csv\n---\nAbout v.\n' });
    if (!link(UNC, join(root, 'lnk'))) return;
    hooks.calls.length = 0;
    const { registry, findings } = readRegistry(join(root, 'docs'));
    expect(registry.views.has('v')).toBe(true);
    expect(findings.find((f) => f.file === 'docs/_meta/views/v.md')).toMatchObject({ rule: 'view-data-missing', message: expect.stringMatching(/lnk\/x\.csv .*network/) });
    expect(toHost()).toEqual([]);
    expect(followed(join(root, 'lnk'))).toEqual([]);
  });
  it('refuses a views folder and a registry note that are network links, as findings, without following them', () => {
    const root = vaultRepo({});
    if (!link(UNC, join(root, 'docs', '_meta', 'views'))) return;
    rmSync(join(root, 'docs', '_meta', 'tags.md'));
    link(`${UNC}\\tags.md`, join(root, 'docs', '_meta', 'tags.md'), 'file');
    hooks.calls.length = 0;
    const { findings } = readRegistry(join(root, 'docs'));
    expect(findings.filter((f) => /network/.test(f.message)).map((f) => [f.rule, f.file])).toEqual([
      ['registry-invalid', 'docs/_meta/tags.md'],
      ['view-invalid', 'docs/_meta/views'],
    ]);
    expect(toHost()).toEqual([]);
    expect(followed(join(root, 'docs', '_meta', 'views'))).toEqual([]);
    expect(followed(join(root, 'docs', '_meta', 'tags.md'))).toEqual([]);
  });
  it('refuses a docs/ folder that is a network link, for the view reader, without following it', () => {
    const root = sandbox().root;
    if (!link(UNC, join(root, 'docs'))) return;
    hooks.calls.length = 0;
    expect(listViews(root)).toEqual({ views: [], problems: [expect.stringMatching(/^docs: .*network/)] });
    expect(() => readView(root, 'x')).toThrow(expect.objectContaining({ status: 404 }));
    expect(toHost()).toEqual([]);
    expect(followed(join(root, 'docs'))).toEqual([]);
  });
});

describe('the governance inventory', () => {
  it('refuses a CLAUDE.md that is a network link, as a problem, without following it', () => {
    const { root, env } = sandbox();
    if (!link(`${UNC}\\CLAUDE.md`, join(root, 'CLAUDE.md'), 'file')) return;
    hooks.calls.length = 0;
    const inv = governanceInventory(root, env);
    expect(inv.items).toEqual([]);
    expect(inv.problems).toEqual([{ location: 'CLAUDE.md', message: expect.stringMatching(/network/) }]);
    expect(toHost()).toEqual([]);
    expect(followed(join(root, 'CLAUDE.md'))).toEqual([]);
  });
  it('refuses a rules folder that is a network link, and a network link inside a rules folder', () => {
    const { root, env } = sandbox();
    mkdirSync(join(root, '.claude'), { recursive: true });
    put(env.configDir, { 'rules/ok.md': '# Ok\n' });
    if (!link(UNC, join(root, '.claude', 'rules'))) return;
    link(UNC, join(env.configDir, 'rules', 'evil'));
    hooks.calls.length = 0;
    const inv = governanceInventory(root, env);
    expect(inv.items.map((i) => i.title)).toEqual(['Ok']);
    expect(inv.problems.map((p) => p.location).sort()).toEqual(['.claude/rules', '~/.claude/rules/evil']);
    expect(inv.problems.every((p) => /network/.test(p.message))).toBe(true);
    expect(toHost()).toEqual([]);
    expect(followed(join(root, '.claude', 'rules'))).toEqual([]);
    expect(followed(join(env.configDir, 'rules', 'evil'))).toEqual([]);
  });
  it('refuses a .claude folder that is a network link, for every file under it', () => {
    const { root, env } = sandbox();
    if (!link(UNC, join(root, '.claude'))) return;
    hooks.calls.length = 0;
    governanceInventory(root, env);
    expect(toHost()).toEqual([]);
    expect(followed(join(root, '.claude'))).toEqual([]);
  });
  it.runIf(process.platform === 'win32')('never touches a network gitdir named by a worktree .git file', () => {
    const { root, env } = sandbox();
    put(root, { '.git': `gitdir: //${HOST}/share/repo/.git/worktrees/w\n` });
    hooks.calls.length = 0;
    governanceInventory(root, env);
    expect(toHost()).toEqual([]);
  });
  it.runIf(process.platform === 'win32')('refuses an @import and an autoMemoryDirectory naming a network path, on their text', () => {
    const { root, env } = sandbox();
    put(root, { 'CLAUDE.md': `# Repo\n@//${HOST}/share/x.md\n`, '.claude/settings.json': JSON.stringify({ autoMemoryDirectory: `//${HOST}/share/mem` }) });
    hooks.calls.length = 0;
    const inv = governanceInventory(root, env);
    expect(inv.items.map((i) => i.location)).toEqual(['CLAUDE.md']);
    expect(inv.problems.map((p) => p.location).sort()).toEqual([`//${HOST}/share/mem`, `//${HOST}/share/x.md`].sort());
    expect(toHost()).toEqual([]);
  });
});

describe('the live poll', () => {
  it('never follows a build, a build log folder or a gates folder that is a network link', () => {
    const { root, env } = sandbox();
    mkdirSync(join(root, '.build', 'real-build'), { recursive: true });
    if (!link(UNC, join(root, '.build', 'evil-build'))) return;
    link(UNC, join(root, '.build', 'real-build', 'logs'));
    link(UNC, join(root, '.build', 'real-build', 'gates'));
    hooks.calls.length = 0;
    const sig = repoSignature(root, env);
    expect(sig).not.toContain('evil-build');
    expect(toHost()).toEqual([]);
    for (const at of [join(root, '.build', 'evil-build'), join(root, '.build', 'real-build', 'logs'), join(root, '.build', 'real-build', 'gates')]) expect(followed(at), at).toEqual([]);
  });
  it('lists no build from a .build folder that is itself a network link', () => {
    const { root } = sandbox();
    if (!link(UNC, join(root, '.build'))) return;
    hooks.calls.length = 0;
    expect(listBuilds(root)).toEqual([]);
    expect(toHost()).toEqual([]);
    expect(followed(join(root, '.build'))).toEqual([]);
  });
  it('never follows a run ledger folder that is a network link', () => {
    const { root } = sandbox();
    mkdirSync(join(root, '.superpowers', 'sdd'), { recursive: true });
    if (!link(UNC, join(root, '.superpowers', 'sdd', 'evil-run'))) return;
    hooks.calls.length = 0;
    expect(ledgerSignature(root)).not.toContain('evil-run');
    expect(toHost()).toEqual([]);
    expect(followed(join(root, '.superpowers', 'sdd', 'evil-run'))).toEqual([]);
  });
  it('never reads a run ledger folder that is a network link, as the live watcher never does', () => {
    const { root } = sandbox();
    mkdirSync(join(root, '.superpowers', 'sdd'), { recursive: true });
    if (!link(UNC, join(root, '.superpowers', 'sdd', 'evil-run'))) return;
    hooks.calls.length = 0;
    expect(findLedgers(root)).toEqual([]);
    expect(toHost()).toEqual([]);
    expect(followed(join(root, '.superpowers', 'sdd', 'evil-run'))).toEqual([]);
  });
  it('never follows a gallery image link out of the repo when it signs the views', () => {
    const root = vaultRepo({ 'docs/_meta/views/g.md': '---\nname: g\ntitle: G\ntype: gallery\ndata: shots\n---\nAbout g.\n', 'shots/a.png': 'a' });
    if (!link(`${UNC}\\x.png`, join(root, 'shots', 'x.png'), 'file')) return;
    hooks.calls.length = 0;
    viewSignature(root);
    expect(toHost()).toEqual([]);
    expect(followed(join(root, 'shots', 'x.png'))).toEqual([]);
  });
});
