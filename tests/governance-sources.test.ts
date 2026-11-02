import { describe, it, expect } from 'vitest';
import { readdirSync as readdirReal, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { memoryItems } from '../core/governance/memory.ts';
import { mdFiles, pathsOf, ruleFileItems } from '../core/governance/rule-files.ts';
import { attempt, inventoryEnv, memoryKey } from '../core/governance/env.ts';
import type { InventoryProblem } from '../core/governance/types.ts';
import { withMarker } from '../core/vault/generated.ts';
import { put, sandbox } from './governance-helpers.ts';

// Symlinks need a privilege on some Windows setups; probe once and skip (saying so) only when creation throws EPERM.
const canLink = ((): boolean => {
  const { base } = sandbox();
  try {
    put(base, { 'probe/t.md': 'x' });
    symlinkSync(join(base, 'probe', 't.md'), join(base, 'probe', 'l.md'), 'file');
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === 'EPERM') return false;
    throw err;
  }
})();
const eacces = (): never => {
  throw Object.assign(new Error('denied'), { code: 'EACCES' });
};

const rel = (file: string, base: string) => file.slice(base.length + 1).replace(/\\/g, '/');

describe('pathsOf', () => {
  it('reads paths: as a list or a comma string', () => {
    expect(pathsOf({ paths: ['src/**', 'web/**'] })).toEqual(['src/**', 'web/**']);
    expect(pathsOf({ paths: 'src/**, web/**' })).toEqual(['src/**', 'web/**']);
    expect(pathsOf(null)).toEqual([]);
  });
});

describe('ruleFileItems', () => {
  it('lists repo, user and folder-above rule files with their scope, recursing into subfolders', () => {
    const { base, root, outer, env } = sandbox();
    put(root, { '.claude/rules/style.md': '# Style\n', '.claude/rules/web/ui.md': '---\npaths: ["web/**"]\n---\n# UI\n' });
    put(env.configDir, { 'rules/mine.md': '# Mine\n' });
    put(outer, { '.claude/rules/web.md': '# Web\n' });
    const found = ruleFileItems(root, env, []);
    expect(found.map((f) => [rel(f.file, base), f.scope, f.paths ?? null, f.launchedFrom ?? null])).toEqual([
      ['outer/repo/.claude/rules/style.md', 'always', null, null],
      ['outer/repo/.claude/rules/web/ui.md', 'path-scoped', ['web/**'], null],
      ['home/.claude/rules/mine.md', 'always', null, null],
      ['outer/.claude/rules/web.md', 'always', null, outer],
    ]);
    expect(found.every((f) => f.kind === 'rule-file')).toBe(true);
  });
  it('lists a marked file in .claude/rules/nexus/ as generated from its note, and an unmarked one as a rule file', () => {
    const { root, env } = sandbox();
    put(root, {
      '.claude/rules/nexus/keep.md': withMarker('---\npaths: ["src/**"]\n---\n# Keep\n', 'docs/governance/rules/keep.md'),
      '.claude/rules/nexus/stray.md': '# Stray\n',
    });
    const found = ruleFileItems(root, env, []);
    expect(found.map((f) => [f.kind, f.title, f.source ?? null, f.scope])).toEqual([
      ['generated', 'Keep', 'docs/governance/rules/keep.md', 'path-scoped'],
      ['rule-file', 'Stray', null, 'always'],
    ]);
  });
});

describe('ruleFileItems edge cases', () => {
  it.skipIf(process.platform !== 'win32')('treats a rules folder spelled Nexus/ as the nexus folder on Windows', () => {
    const { root, env } = sandbox();
    put(root, { '.claude/rules/Nexus/keep.md': withMarker('# Keep\n', 'docs/governance/rules/keep.md') });
    expect(ruleFileItems(root, env, []).map((f) => f.kind)).toEqual(['generated']);
  });
  it("records a problem for an unreadable subfolder and keeps its siblings", () => {
    const problems: InventoryProblem[] = [];
    const { root } = sandbox();
    put(root, { 'rules/a.md': '# A\n', 'rules/bad/x.md': '# X\n', 'rules/z.md': '# Z\n' });
    const rules = join(root, 'rules');
    const list = ((d: string, o: never) => (d.endsWith('bad') ? eacces() : readdirReal(d, o))) as unknown as typeof readdirReal;
    const files = mdFiles(rules, rules, problems, list);
    expect(files.map((f) => f.slice(rules.length + 1).replace(/\\/g, '/'))).toEqual(['a.md', 'z.md']);
    expect(problems).toEqual([{ location: join(rules, 'bad'), message: "can't be read: EACCES" }]);
  });
  it("records a top-folder read failure as a problem", () => {
    const problems: InventoryProblem[] = [];
    const { root } = sandbox();
    put(root, { 'rules/a.md': '# A\n' });
    const rules = join(root, 'rules');
    expect(mdFiles(rules, rules, problems, eacces as never)).toEqual([]);
    expect(problems).toEqual([{ location: rules, message: "can't be read: EACCES" }]);
  });
  it('follows a linked folder that stays inside the rules folder and refuses one that leads out', () => {
    const { base, root, env } = sandbox();
    put(root, { '.claude/rules/real/in.md': '# In\n' });
    put(base, { 'elsewhere/out.md': '# Out\n' });
    const rules = join(root, '.claude', 'rules');
    symlinkSync(join(rules, 'real'), join(rules, 'inside'), 'junction');
    symlinkSync(join(base, 'elsewhere'), join(rules, 'outside'), 'junction');
    const problems: InventoryProblem[] = [];
    const found = ruleFileItems(root, env, problems);
    expect(found.map((f) => f.file.slice(rules.length + 1).replace(/\\/g, '/')).sort()).toEqual(['inside/in.md', 'real/in.md']);
    expect(problems).toEqual([{ location: join(rules, 'outside'), message: 'a link leads out of its folder; not read' }]);
  });
});

describe('ruleFileItems link loops', () => {
  it('does not recurse into a link that loops back into its own folder, lists the real files once, and names the link', () => {
    const { root, env } = sandbox();
    put(root, { '.claude/rules/a.md': '# A\n' });
    const rules = join(root, '.claude', 'rules');
    symlinkSync(rules, join(rules, 'loop'), 'junction');
    const problems: InventoryProblem[] = [];
    const found = ruleFileItems(root, env, problems);
    expect(found.map((f) => f.file.slice(rules.length + 1).replace(/\\/g, '/'))).toEqual(['a.md']);
    expect(problems).toEqual([{ location: join(rules, 'loop'), message: 'a link loops back into its own folder; not followed' }]);
  });
});

describe('attempt', () => {
  it("returns the value, or records a can't-be-read problem and returns null", () => {
    const problems: InventoryProblem[] = [];
    expect(attempt('f', problems, () => 'ok')).toBe('ok');
    expect(attempt('f', problems, eacces)).toBeNull();
    expect(problems).toEqual([{ location: 'f', message: "can't be read: EACCES" }]);
  });
});

describe('memoryItems', () => {
  it('lists MEMORY.md as always loaded and topic files on demand, for the repo and each folder above', () => {
    const { root, outer, env } = sandbox();
    put(join(env.configDir, 'projects', memoryKey(root), 'memory'), { 'MEMORY.md': '- [A](a.md)\n', 'a.md': '---\nname: first-thing\n---\nBody\n' });
    put(join(env.configDir, 'projects', memoryKey(outer), 'memory'), { 'b.md': '# Workspace memory\n' });
    const found = memoryItems(root, env, []);
    expect(found.map((f) => [f.title, f.scope, f.launchedFrom ?? null])).toEqual([
      ['MEMORY.md', 'always', null],
      ['first-thing', 'on-demand', null],
      ['Workspace memory', 'on-demand', outer],
    ]);
  });
  it.skipIf(!canLink)('reports a memory file linked to a file outside its folder as a problem, not an item', () => {
    const { root, env, base } = sandbox();
    const dir = join(env.configDir, 'projects', memoryKey(root), 'memory');
    put(dir, { 'MEMORY.md': 'index\n' });
    put(base, { 'secret.md': '# Secret\n' });
    symlinkSync(join(base, 'secret.md'), join(dir, 'linked.md'), 'file');
    const problems: InventoryProblem[] = [];
    expect(memoryItems(root, env, problems).map((f) => f.title)).toEqual(['MEMORY.md']);
    expect(problems).toEqual([{ location: join(dir, 'linked.md'), message: 'a link leads out of its folder; not read' }]);
  });
  it('uses autoMemoryDirectory from the user settings, absolute or as ~/', () => {
    const { root, env, base } = sandbox();
    put(env.configDir, { 'settings.json': JSON.stringify({ autoMemoryDirectory: join(base, 'abs') }) });
    put(join(base, 'abs'), { 'MEMORY.md': 'i\n' });
    expect(memoryItems(root, env, []).map((f) => rel(f.file, base))).toEqual(['abs/MEMORY.md']);
    put(env.configDir, { 'settings.json': JSON.stringify({ autoMemoryDirectory: '~/tilde' }) });
    put(env.home, { 'tilde/MEMORY.md': 'i\n' });
    expect(memoryItems(root, env, []).map((f) => rel(f.file, base))).toEqual(['home/tilde/MEMORY.md']);
  });
  it('takes autoMemoryDirectory from managed, then local, then project, then user settings, skipping invalid values', () => {
    const { root, env, base } = sandbox();
    for (const n of ['managed', 'local', 'project', 'user']) put(join(base, n), { 'MEMORY.md': 'i\n' });
    const dir = (n: string) => ({ autoMemoryDirectory: join(base, n) });
    put(env.configDir, { 'settings.json': JSON.stringify(dir('user')) });
    const seen = () => memoryItems(root, env, []).map((f) => rel(f.file, base));
    expect(seen()).toEqual(['user/MEMORY.md']);
    put(root, { '.claude/settings.json': JSON.stringify(dir('project')) });
    expect(seen()).toEqual(['project/MEMORY.md']);
    put(root, { '.claude/settings.local.json': JSON.stringify({ autoMemoryDirectory: 'relative/ignored' }) });
    expect(seen()).toEqual(['project/MEMORY.md']);
    put(root, { '.claude/settings.local.json': JSON.stringify(dir('local')) });
    expect(seen()).toEqual(['local/MEMORY.md']);
    put(env.managedDir, { 'managed-settings.json': JSON.stringify(dir('managed')) });
    expect(seen()).toEqual(['managed/MEMORY.md']);
  });
  it('honours autoMemoryDirectory from the repo settings', () => {
    const { root, env, base } = sandbox();
    put(root, { '.claude/settings.json': JSON.stringify({ autoMemoryDirectory: join(base, 'mem') }) });
    put(join(base, 'mem'), { 'MEMORY.md': 'index\n' });
    expect(memoryItems(root, env, []).map((f) => rel(f.file, base))).toEqual(['mem/MEMORY.md']);
  });
  it("keys a worktree's memory by its main checkout, read from .git, gitdir and commondir", () => {
    const { root, outer, env, base } = sandbox();
    // The main checkout is <base>/outer/main; the repo is a worktree of it, with a relative gitdir as git writes on request.
    const main = join(outer, 'main');
    put(main, { '.git/worktrees/repo/commondir': '../..\n', '.git/HEAD': 'ref: refs/heads/main\n' });
    put(root, { '.git': 'gitdir: ../main/.git/worktrees/repo\n' });
    put(join(env.configDir, 'projects', memoryKey(main), 'memory'), { 'MEMORY.md': 'shared\n' });
    put(join(env.configDir, 'projects', memoryKey(root), 'memory'), { 'MEMORY.md': 'per-folder: not used\n' });
    expect(memoryItems(root, env, []).map((f) => rel(f.file, base))).toEqual([`home/.claude/projects/${memoryKey(main)}/memory/MEMORY.md`]);
  });
  it('keys a subfolder of a repo by the repo, and an absolute gitdir the same way', () => {
    const { root, outer, env, base } = sandbox();
    const main = join(outer, 'main');
    put(main, { '.git/worktrees/w/commondir': '../..\n' });
    put(root, { '.git': `gitdir: ${join(main, '.git', 'worktrees', 'w')}\n`, 'sub/x.md': '' });
    put(join(env.configDir, 'projects', memoryKey(main), 'memory'), { 'MEMORY.md': 'shared\n' });
    expect(memoryItems(join(root, 'sub'), env, []).map((f) => rel(f.file, base))).toEqual([`home/.claude/projects/${memoryKey(main)}/memory/MEMORY.md`]);
  });
  it('lets CLAUDE_CODE_PROJECT_DIR_NAME name the project folder, and autoMemoryDirectory still wins over it', () => {
    const { root, env, base } = sandbox();
    put(root, { '.git/HEAD': 'ref: refs/heads/main\n' });
    put(join(env.configDir, 'projects', 'chosen-name', 'memory'), { 'MEMORY.md': 'named\n' });
    put(join(env.configDir, 'projects', memoryKey(root), 'memory'), { 'MEMORY.md': 'derived\n' });
    const named = { ...env, projectDirName: 'chosen-name' };
    expect(memoryItems(root, named, []).map((f) => rel(f.file, base))).toEqual(['home/.claude/projects/chosen-name/memory/MEMORY.md']);
    expect(inventoryEnv({ CLAUDE_CODE_PROJECT_DIR_NAME: 'chosen-name' }, 'linux', '/h').projectDirName).toBe('chosen-name');
    expect(inventoryEnv({}, 'linux', '/h')).not.toHaveProperty('projectDirName');
    put(root, { '.claude/settings.json': JSON.stringify({ autoMemoryDirectory: join(base, 'moved') }) });
    put(join(base, 'moved'), { 'MEMORY.md': 'moved\n' });
    expect(memoryItems(root, named, []).map((f) => rel(f.file, base))).toEqual(['moved/MEMORY.md']);
  });
  it('is empty, with no problem, when there is no memory folder', () => {
    const { root, env } = sandbox();
    const problems: never[] = [];
    expect(memoryItems(root, env, problems)).toEqual([]);
    expect(problems).toEqual([]);
  });
});
