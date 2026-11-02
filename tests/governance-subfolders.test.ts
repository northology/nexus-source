import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fullInventory, governanceInventory } from '../core/governance/inventory.ts';
import { notLoaded } from '../core/governance/settings.ts';
import { SUBFOLDER_LIMIT, SUBFOLDER_NOTES, subfolderItems, walkSubfolders } from '../core/governance/subfolders.ts';
import type { Found, InventoryProblem } from '../core/governance/types.ts';
import { openReview, submitReviewAnswers } from '../core/reviews.ts';
import { main, type CliIO } from '../scripts/cli.ts';
import { subfolderCache, subfolderSignature, watchSubfolders, type SubfolderCache } from '../server/events.ts';
import { gitRepo } from './git-helpers.ts';
import { isolatedEnv, put, sandbox } from './governance-helpers.ts';
import { NOW, tempDir } from './helpers.ts';

const rel = (root: string, f: Found) => f.file.slice(root.length + 1).replace(/\\/g, '/');
const dirType = process.platform === 'win32' ? 'junction' : 'dir';
const gitSandbox = () => {
  const g = gitRepo();
  return { ...g, inv: { ...isolatedEnv(tempDir('nexus-sub-env-')), ceiling: dirname(g.root) } };
};

describe('subfolderItems', () => {
  it('lists each kind of instruction file below the root, with its folder and note, and none at the root', () => {
    const { root, env } = sandbox();
    put(root, {
      'CLAUDE.md': '# Root\n',
      'pkg/api/CLAUDE.md': '# Api\n',
      'pkg/api/CLAUDE.local.md': '# Api local\n',
      'pkg/api/.claude/CLAUDE.md': '# Api dot\n',
      'pkg/api/.claude/rules/style.md': '# Style\n',
      'pkg/api/.claude/rules/sql.md': '---\npaths: ["**/*.sql"]\n---\n# Sql\n',
      'pkg/web/AGENTS.md': '# Codex web\n',
    });
    const problems: InventoryProblem[] = [];
    const found = subfolderItems(root, env, problems);
    expect(problems).toEqual([]);
    expect(found.map((f) => [rel(root, f), f.kind, f.scope, f.conditional, f.paths])).toEqual([
      ['pkg/api/CLAUDE.md', 'instructions', 'on-demand', SUBFOLDER_NOTES.claude('pkg/api'), undefined],
      ['pkg/api/CLAUDE.local.md', 'instructions', 'on-demand', SUBFOLDER_NOTES.claude('pkg/api'), undefined],
      ['pkg/api/.claude/CLAUDE.md', 'instructions', 'on-demand', SUBFOLDER_NOTES.dotClaude, undefined],
      ['pkg/api/.claude/rules/sql.md', 'rule-file', 'path-scoped', SUBFOLDER_NOTES.scoped, ['**/*.sql']],
      ['pkg/api/.claude/rules/style.md', 'rule-file', 'on-demand', SUBFOLDER_NOTES.rules('pkg/api'), undefined],
      ['pkg/web/AGENTS.md', 'instructions', 'on-demand', SUBFOLDER_NOTES.claude('pkg/web'), undefined],
    ]);
    expect(found.every((f) => f.folder !== undefined)).toBe(true);
    expect(SUBFOLDER_NOTES.claude('pkg/api')).toBe('loads when Claude Code reads, writes or edits a file in pkg/api/');
  });
  it('notes an AGENTS.md by the project-instructions setting', () => {
    const { root, env } = sandbox();
    put(root, { 'a/CLAUDE.md': '# A\n', 'a/AGENTS.md': '# Codex a\n', 'b/AGENTS.md': '# Codex b\n' });
    const notes = (setting?: Parameters<typeof subfolderItems>[3]) =>
      subfolderItems(root, env, [], setting).filter((f) => f.file.endsWith('AGENTS.md')).map((f) => f.conditional);
    expect(notes()).toEqual([SUBFOLDER_NOTES.agentsShadowed('a'), SUBFOLDER_NOTES.claude('b')]);
    expect(notes({ setting: 'claude-md-and-agents-md' })).toEqual([SUBFOLDER_NOTES.agentsBoth('a'), SUBFOLDER_NOTES.agentsBoth('b')]);
    expect(notes({ setting: 'claude-md' })).toEqual([notLoaded('claude-md'), notLoaded('claude-md')]);
    expect(notes({ setting: 'managed-only' })).toEqual([notLoaded('managed-only'), notLoaded('managed-only')]);
  });
  it('skips .git, node_modules, .build, nested .claude folders and the vault archives', () => {
    const { root, env } = sandbox();
    put(root, {
      '.git/x/CLAUDE.md': '# no\n',
      'node_modules/lib/CLAUDE.md': '# no\n',
      '.build/b/CLAUDE.md': '# no\n',
      'pkg/.claude/skills/CLAUDE.md': '# no\n',
      'docs/governance/archive/rules/CLAUDE.md': '# no\n',
      'docs/superpowers/archive/b/CLAUDE.md': '# no\n',
      'docs/dev/CLAUDE.md': '# yes\n',
    });
    expect(subfolderItems(root, env, []).map((f) => rel(root, f))).toEqual(['docs/dev/CLAUDE.md']);
  });
  it('skips what git ignores, but always checks CLAUDE.local.md in a walked folder', () => {
    const g = gitRepo();
    const env = { ...isolatedEnv(tempDir('nexus-sub-env-')), ceiling: dirname(g.root) };
    put(g.root, {
      '.gitignore': 'ignored/\npkg/CLAUDE.md\npkg/CLAUDE.local.md\n',
      'ignored/CLAUDE.md': '# no\n',
      'ignored/CLAUDE.local.md': '# no: the folder is never walked\n',
      'pkg/CLAUDE.md': '# ignored file\n',
      'pkg/CLAUDE.local.md': '# local\n',
      'pkg/AGENTS.md': '# codex\n',
    });
    const found = subfolderItems(g.root, env, [], { gitEnv: g.env });
    expect(found.map((f) => [rel(g.root, f), f.conditional])).toEqual([
      ['pkg/CLAUDE.local.md', SUBFOLDER_NOTES.claude('pkg')],
      // pkg/CLAUDE.md is on disk, so Claude Code still won't read the AGENTS.md beside it.
      ['pkg/AGENTS.md', SUBFOLDER_NOTES.agentsShadowed('pkg')],
    ]);
  });
  it('skips nothing for being ignored outside git', () => {
    const { root, env } = sandbox();
    put(root, { '.gitignore': 'pkg/\n', 'pkg/CLAUDE.md': '# here\n' });
    const problems: InventoryProblem[] = [];
    expect(subfolderItems(root, env, problems).map((f) => rel(root, f))).toEqual(['pkg/CLAUDE.md']);
    expect(problems).toEqual([]);
  });
  it('matches ignored names with spaces, brackets and non-ASCII letters exactly, whatever core.quotePath says', () => {
    const { root, env, inv } = gitSandbox();
    put(root, {
      '.gitignore': 'skip*/\nkeep */nested é/CLAUDE.md\n',
      'skip [a] é/CLAUDE.md': '# no\n',
      'keep [a] é/CLAUDE.md': '# yes\n',
      'keep [a] é/nested é/CLAUDE.md': '# no\n',
      'keep [a] é/nested é/AGENTS.md': '# yes\n',
    });
    const names = (quote: string) =>
      subfolderItems(root, inv, [], { gitEnv: { ...env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.quotePath', GIT_CONFIG_VALUE_0: quote } }).map((f) => rel(root, f));
    const expected = ['keep [a] é/CLAUDE.md', 'keep [a] é/nested é/AGENTS.md'];
    expect(names('true')).toEqual(expected);
    expect(names('false')).toEqual(expected);
  });
  it.skipIf(process.platform === 'win32')('treats an ignored folder whose name holds a newline as data', () => {
    const { root, env, inv } = gitSandbox();
    put(root, { '.gitignore': 'skip*/\n', 'skip\nb/CLAUDE.md': '# no\n', 'b/CLAUDE.md': '# yes\n' });
    expect(subfolderItems(root, inv, [], { gitEnv: env }).map((f) => rel(root, f))).toEqual(['b/CLAUDE.md']);
  });
  it("names the problem and still lists files when git can't be run", () => {
    const { root, env, inv } = gitSandbox();
    put(root, { '.gitignore': 'ignored/\n', 'pkg/CLAUDE.md': '# Pkg\n' });
    const nowhere = tempDir('nexus-no-git-');
    const problems: InventoryProblem[] = [];
    const found = subfolderItems(root, inv, problems, { gitEnv: { ...env, PATH: nowhere, Path: nowhere } });
    expect(found.map((f) => rel(root, f))).toEqual(['pkg/CLAUDE.md']);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.location).toBe(root);
    expect(problems[0]?.message).toMatch(/^git couldn't say whether this is a repository \(.*ENOENT.*\), so nothing below the repo is skipped for being ignored$/);
  });
  it('names any other reason git refuses the repo, and keeps a plain folder quiet', () => {
    const { root, env, inv } = gitSandbox();
    put(root, { '.gitignore': 'ignored/\n', 'ignored/CLAUDE.md': '# no\n', 'pkg/CLAUDE.md': '# Pkg\n' });
    const bad = join(tempDir('nexus-bad-gitconfig-'), 'config');
    writeFileSync(bad, '[broken\n');
    const problems: InventoryProblem[] = [];
    const found = subfolderItems(root, inv, problems, { gitEnv: { ...env, GIT_CONFIG_GLOBAL: bad } });
    expect(found.map((f) => rel(root, f))).toEqual(['ignored/CLAUDE.md', 'pkg/CLAUDE.md']);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.location).toBe(root);
    expect(problems[0]?.message).toMatch(/^git couldn't say whether this is a repository \(fatal: bad config line 1 in file .*\), so nothing below the repo is skipped for being ignored$/);
    // A folder that isn't a repository is the ordinary case, whatever language git answers in.
    const plain = sandbox();
    put(plain.root, { 'pkg/CLAUDE.md': '# Pkg\n' });
    const quiet: InventoryProblem[] = [];
    subfolderItems(plain.root, plain.env, quiet, { gitEnv: { ...env, LANGUAGE: 'de', LANG: 'de_DE.UTF-8' } });
    expect(quiet).toEqual([]);
  });
  it('skips an ignored folder whose name starts with a space, though it sorts first in git\'s list', () => {
    const { root, env, inv } = gitSandbox();
    put(root, { '.gitignore': '*lead/\n', ' lead/CLAUDE.md': '# no\n', 'pkg/CLAUDE.md': '# Pkg\n' });
    const problems: InventoryProblem[] = [];
    expect(subfolderItems(root, inv, problems, { gitEnv: env }).map((f) => rel(root, f))).toEqual(['pkg/CLAUDE.md']);
    expect(problems).toEqual([]);
  });
  it("skips files inside a folder git ignores as a whole: a folder's .claude, and a subfolder of its rules", () => {
    const { root, env, inv } = gitSandbox();
    put(root, {
      '.gitignore': '.claude/\n',
      'pkg/keep.txt': 'x\n',
      'pkg/.claude/CLAUDE.md': '# no\n',
      'pkg/.claude/rules/r.md': '# no\n',
      'pkg/CLAUDE.local.md': '# local\n',
    });
    expect(subfolderItems(root, inv, [], { gitEnv: env }).map((f) => rel(root, f))).toEqual(['pkg/CLAUDE.local.md']);
    const b = gitSandbox();
    put(b.root, {
      '.gitignore': 'private/\n',
      'pkg/.claude/rules/open.md': '# yes\n',
      'pkg/.claude/rules/private/deep/secret.md': '# no\n',
    });
    expect(subfolderItems(b.root, b.inv, [], { gitEnv: b.env }).map((f) => rel(b.root, f))).toEqual(['pkg/.claude/rules/open.md']);
  });
  it("judges a linked folder's skip by where it leads: a link to node_modules or a vault archive isn't walked", () => {
    const { root, env } = sandbox();
    put(root, {
      'node_modules/lib/CLAUDE.md': '# no\n',
      'node_modules/CLAUDE.md': '# no\n',
      'docs/governance/archive/CLAUDE.md': '# no\n',
      'pkg/CLAUDE.md': '# yes\n',
    });
    symlinkSync(join(root, 'node_modules'), join(root, 'deps'), dirType);
    symlinkSync(join(root, 'docs', 'governance', 'archive'), join(root, 'old'), dirType);
    const problems: InventoryProblem[] = [];
    expect(subfolderItems(root, env, problems).map((f) => rel(root, f))).toEqual(['pkg/CLAUDE.md']);
    expect(problems).toEqual([]);
  });
  it('skips a link into a skipped folder, into a vault archive or to an ignored folder, as it would the folder itself', () => {
    const { root, env, inv } = gitSandbox();
    put(root, {
      '.gitignore': 'ignored-dir/\n',
      'node_modules/lib/CLAUDE.md': '# no\n',
      'docs/governance/archive/2025/CLAUDE.md': '# no\n',
      'ignored-dir/CLAUDE.md': '# no\n',
      'pkg/CLAUDE.md': '# yes\n',
    });
    symlinkSync(join(root, 'node_modules', 'lib'), join(root, 'lnk-lib'), dirType);
    symlinkSync(join(root, 'docs', 'governance', 'archive', '2025'), join(root, 'lnk-old'), dirType);
    symlinkSync(join(root, 'ignored-dir'), join(root, 'lnk-ignored'), dirType);
    const problems: InventoryProblem[] = [];
    expect(subfolderItems(root, inv, problems, { gitEnv: env }).map((f) => rel(root, f))).toEqual(['pkg/CLAUDE.md']);
    expect(problems).toEqual([]);
  });
  it('still walks a link to an ordinary folder inside the repo, once', () => {
    const { root, env } = sandbox();
    put(root, { 'zz/real/CLAUDE.md': '# inside\n' });
    symlinkSync(join(root, 'zz', 'real'), join(root, 'alias'), dirType);
    const problems: InventoryProblem[] = [];
    expect(subfolderItems(root, env, problems).map((f) => rel(root, f))).toEqual(['alias/CLAUDE.md']);
    expect(problems).toEqual([]);
  });
  it("lists a folder's rules through the injected lister, so a rules folder that can't be listed is named", () => {
    const { root, env } = sandbox();
    put(root, { 'pkg/CLAUDE.md': '# Pkg\n', 'pkg/.claude/rules/r.md': '# R\n' });
    const rules = join(root, 'pkg', '.claude', 'rules');
    const list = ((dir: string, o: { withFileTypes: true }) => {
      if (dir === rules) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return readdirSync(dir, o);
    }) as unknown as typeof readdirSync;
    const problems: InventoryProblem[] = [];
    expect(subfolderItems(root, env, problems, { list }).map((f) => rel(root, f))).toEqual(['pkg/CLAUDE.md']);
    expect(problems).toEqual([{ location: rules, message: "can't be read: EACCES" }]);
  });
  it('names a folder that disappears mid-walk and keeps walking the rest', () => {
    const { root, env } = sandbox();
    put(root, { 'a/CLAUDE.md': '# A\n', 'b/CLAUDE.md': '# B\n', 'c/CLAUDE.md': '# C\n' });
    const gone = join(root, 'b');
    // The folder is really removed between the root's listing and its own.
    const list = ((dir: string, o: { withFileTypes: true }) => {
      if (dir === gone) rmSync(gone, { recursive: true, force: true });
      return readdirSync(dir, o);
    }) as unknown as typeof readdirSync;
    const problems: InventoryProblem[] = [];
    expect(subfolderItems(root, env, problems, { list }).map((f) => rel(root, f))).toEqual(['a/CLAUDE.md', 'c/CLAUDE.md']);
    expect(problems).toEqual([{ location: gone, message: "can't be read: ENOENT" }]);
  });
  it('stops at the folder limit and says so', () => {
    const { root, env } = sandbox();
    put(root, { 'a/CLAUDE.md': '#\n', 'b/CLAUDE.md': '#\n', 'c/CLAUDE.md': '#\n', 'd/CLAUDE.md': '#\n', 'e/CLAUDE.md': '#\n' });
    const problems: InventoryProblem[] = [];
    expect(subfolderItems(root, env, problems, { limit: 3 }).map((f) => rel(root, f))).toEqual(['a/CLAUDE.md', 'b/CLAUDE.md', 'c/CLAUDE.md']);
    expect(problems).toEqual([{ location: root, message: "the walk below the repo stopped at 3 folders; instruction files deeper than that aren't listed" }]);
    expect(SUBFOLDER_LIMIT).toBe(20000);
  });
  it('says nothing when the folders number exactly the limit', () => {
    const { root, env } = sandbox();
    put(root, { 'a/CLAUDE.md': '#\n', 'b/CLAUDE.md': '#\n' });
    const problems: InventoryProblem[] = [];
    expect(subfolderItems(root, env, problems, { limit: 2 })).toHaveLength(2);
    expect(problems).toEqual([]);
  });
  it('refuses a linked folder that leads out of the repo, and walks one inside it once', () => {
    const { base, root, env } = sandbox();
    put(base, { 'elsewhere/CLAUDE.md': '# outside\n' });
    put(root, { 'real/CLAUDE.md': '# inside\n' });
    symlinkSync(join(base, 'elsewhere'), join(root, 'out'), dirType);
    symlinkSync(join(root, 'real'), join(root, 'twin'), dirType);
    mkdirSync(join(root, 'loop'));
    symlinkSync(root, join(root, 'loop', 'back'), dirType);
    const problems: InventoryProblem[] = [];
    const found = subfolderItems(root, env, problems);
    expect(found.map((f) => rel(root, f))).toEqual(['real/CLAUDE.md']);
    expect(problems).toEqual([{ location: join(root, 'out'), message: 'a link leads out of the repo; not walked' }]);
  });
  it("reads nothing through a folder's .claude that is a link out of the repo, and lets no such file shadow an AGENTS.md", () => {
    const { base, root, env } = sandbox();
    put(base, { 'elsewhere/CLAUDE.md': '# outside\n', 'elsewhere/rules/r.md': '# outside rule\n' });
    put(root, { 'pkg/AGENTS.md': '# Codex\n' });
    symlinkSync(join(base, 'elsewhere'), join(root, 'pkg', '.claude'), dirType);
    const problems: InventoryProblem[] = [];
    const found = subfolderItems(root, env, problems);
    expect(found.map((f) => [rel(root, f), f.conditional])).toEqual([['pkg/AGENTS.md', SUBFOLDER_NOTES.claude('pkg')]]);
    expect(problems).toEqual([
      { location: join(root, 'pkg', '.claude', 'CLAUDE.md'), message: 'a link leads out of its folder; not read' },
      { location: join(root, 'pkg', '.claude', 'rules'), message: 'a link leads out of the repo; not walked' },
    ]);
  });
  it('skips a dangling link without a problem', () => {
    const { root, env } = sandbox();
    put(root, { 'pkg/CLAUDE.md': '# Pkg\n' });
    symlinkSync(join(root, 'nowhere'), join(root, 'dangling'), dirType);
    const problems: InventoryProblem[] = [];
    expect(subfolderItems(root, env, problems).map((f) => rel(root, f))).toEqual(['pkg/CLAUDE.md']);
    expect(problems).toEqual([]);
  });
});

describe('walkSubfolders', () => {
  it('names a root that is missing as a problem and never throws', () => {
    const { root, env } = sandbox();
    const missing = join(root, 'missing');
    const w = walkSubfolders(missing, env);
    expect(w.found).toEqual([]);
    expect(w.problems.map((p) => p.location)).toEqual([missing]);
  });
});

describe('the inventory with subfolders', () => {
  it('lists them only when the walk is passed in, with the folder as a display path', () => {
    const { root, env } = sandbox();
    put(root, { 'CLAUDE.md': '# Root\n', 'pkg/CLAUDE.md': '# Pkg\n' });
    expect(governanceInventory(root, env).items.map((i) => i.location)).toEqual(['CLAUDE.md']);
    const full = fullInventory(root, env);
    expect(full.items.map((i) => [i.location, i.folder ?? null])).toEqual([['CLAUDE.md', null], ['pkg/CLAUDE.md', 'pkg']]);
    const w = walkSubfolders(root, env);
    expect(governanceInventory(root, env, { subfolders: w.found, subfolderProblems: w.problems }).items).toEqual(full.items);
  });
  it("keeps a root item's id, and shows the walk's problems as display paths", () => {
    const { base, root, env } = sandbox();
    put(root, { 'CLAUDE.md': '# Root\n' });
    put(base, { 'elsewhere/CLAUDE.md': '# outside\n' });
    symlinkSync(join(base, 'elsewhere'), join(root, 'out'), dirType);
    const before = governanceInventory(root, env).items;
    const full = fullInventory(root, env);
    expect(full.items).toEqual(before);
    // sha256('instructions' + NUL + 'CLAUDE.md'), first 12 hex: the id phase-3 gave this item.
    expect(full.items[0]?.id).toBe('d427d52913be');
    expect(full.problems).toEqual([{ location: 'out', message: 'a link leads out of the repo; not walked' }]);
  });
  it('lists a subfolder file the root CLAUDE.md imports once, as always loaded', () => {
    const { root, env } = sandbox();
    put(root, { 'CLAUDE.md': '# Root\n@pkg/CLAUDE.md\n', 'pkg/CLAUDE.md': '# Pkg\n' });
    expect(fullInventory(root, env).items.map((i) => [i.location, i.scope, i.folder ?? null])).toEqual([
      ['CLAUDE.md', 'always', null],
      ['pkg/CLAUDE.md', 'always', null],
    ]);
  });
  it('reads the project-instructions setting for the notes', () => {
    const { root, env } = sandbox();
    put(root, { 'pkg/AGENTS.md': '# Codex\n' });
    expect(fullInventory(root, env).items.map((i) => [i.location, i.conditional])).toEqual([['pkg/AGENTS.md', SUBFOLDER_NOTES.claude('pkg')]]);
    put(env.configDir, { 'settings.json': JSON.stringify({ pluginConfigs: { 'agents-md@builtin': { options: { instructionFiles: 'claude-md' } } } }) });
    expect(fullInventory(root, env).items.map((i) => [i.location, i.conditional])).toEqual([['pkg/AGENTS.md', notLoaded('claude-md')]]);
  });
});

describe('what uses the full inventory', () => {
  it('governance list --json includes subfolder files', async () => {
    const { base, root, env } = sandbox();
    put(root, { 'CLAUDE.md': '# Repo\n', 'pkg/CLAUDE.md': '# Pkg\n' });
    const out: string[] = [];
    const io: CliIO = {
      cwd: root, out: (l) => out.push(l), err: () => {}, now: () => NOW, readStdin: async () => '',
      env: { CLAUDE_CONFIG_DIR: env.configDir, NEXUS_INVENTORY_CEILING: base, NEXUS_INVENTORY_MANAGED: env.managedDir },
    };
    expect(await main(['governance', 'list', '--json'], io)).toBe(0);
    expect(JSON.parse(out.join('\n'))).toMatchObject({ items: [{ location: 'CLAUDE.md' }, { location: 'pkg/CLAUDE.md', folder: 'pkg', scope: 'on-demand' }] });
  });
  it('a review can name a subfolder file, and its answers stamp that file as the target', () => {
    const { root, env } = sandbox();
    put(root, { 'pkg/CLAUDE.md': '# Pkg\n' });
    const id = fullInventory(root, env).items.find((i) => i.location === 'pkg/CLAUDE.md')?.id ?? '';
    openReview(root, { name: 'tidy', type: 'review', title: 'Tidy', why: 'Mark it.', items: [{ name: 'pkg-claude', text: 'The pkg CLAUDE.md', item: id, target: 'pkg/CLAUDE.md' }] }, NOW, env);
    expect(submitReviewAnswers(root, 'tidy', { marks: { 'pkg-claude': 'accepted' } }, NOW, env).targets).toEqual({ 'pkg-claude': ['pkg/CLAUDE.md'] });
  });
});

describe('subfolderCache', () => {
  it('walks when first asked and when the last walk is older than staleMs, and reports a change', () => {
    const { root, env } = sandbox();
    let t = 0;
    let walks = 0;
    const cache = subfolderCache(root, env, { staleMs: 5000, now: () => t, walk: (r, e) => (walks++, walkSubfolders(r, e)) });
    expect(cache.get().found).toEqual([]);
    t = 4000;
    cache.get();
    expect(walks).toBe(1);
    put(root, { 'pkg/CLAUDE.md': '# Pkg\n' });
    t = 6000;
    expect(cache.get().found.map((f) => f.file)).toEqual([join(root, 'pkg', 'CLAUDE.md')]);
    expect(walks).toBe(2);
    put(root, { 'pkg/AGENTS.md': '# Codex\n' });
    expect(cache.walk()).toBe(true);
    expect(cache.walk()).toBe(false);
  });
  it('keeps the last files and names the failure when a walk throws', () => {
    const { root, env } = sandbox();
    put(root, { 'pkg/CLAUDE.md': '# Pkg\n' });
    let fail = false;
    const cache = subfolderCache(root, env, {
      staleMs: 0,
      walk: (r, e) => {
        if (fail) throw new Error('boom');
        return walkSubfolders(r, e);
      },
    });
    expect(cache.get().found).toHaveLength(1);
    fail = true;
    expect(cache.walk()).toBe(true);
    const after = cache.get();
    expect(after.found).toHaveLength(1);
    expect(after.problems).toEqual([{ location: root, message: 'the walk below the repo failed: boom' }]);
  });
});

describe('a change found by a request', () => {
  it('reaches onChange when get() walks and the result differs, and not otherwise', () => {
    const { root, env } = sandbox();
    let t = 0;
    let changes = 0;
    const cache = subfolderCache(root, env, { staleMs: 5000, now: () => t, onChange: () => changes++ });
    cache.get(); // the first walk is the baseline
    expect(changes).toBe(0);
    put(root, { 'pkg/CLAUDE.md': '# Pkg\n' });
    t = 4000;
    cache.get(); // not stale: no walk
    expect(changes).toBe(0);
    t = 6000;
    expect(cache.get().found).toHaveLength(1);
    expect(changes).toBe(1);
    t = 12000;
    cache.get(); // walked again, nothing new
    expect(changes).toBe(1);
    // The timer's walk reports through its return value alone; watchSubfolders calls onChange for it.
    put(root, { 'pkg/AGENTS.md': '# Codex\n' });
    expect(cache.walk()).toBe(true);
    expect(changes).toBe(1);
  });
});

describe('watchSubfolders', () => {
  it('calls onChange when a walk reports a change, not otherwise, and never after it is stopped', () => {
    vi.useFakeTimers();
    try {
      const results = [true, false, true, true];
      let walks = 0;
      let changes = 0;
      const cache: SubfolderCache = { get: () => ({ found: [], problems: [] }), walk: () => results[walks++] ?? false };
      const stop = watchSubfolders(cache, () => changes++, 50);
      vi.advanceTimersByTime(49);
      expect([walks, changes]).toEqual([0, 0]);
      vi.advanceTimersByTime(1);
      expect([walks, changes]).toEqual([1, 1]);
      vi.advanceTimersByTime(50);
      expect([walks, changes]).toEqual([2, 1]);
      vi.advanceTimersByTime(50);
      expect([walks, changes]).toEqual([3, 2]);
      stop();
      vi.advanceTimersByTime(500);
      expect([walks, changes]).toEqual([3, 2]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('subfolderSignature', () => {
  it("changes with a file's note and with a problem", () => {
    const { root, env } = sandbox();
    put(root, { 'pkg/AGENTS.md': '# Codex\n' });
    const a = walkSubfolders(root, env);
    const b = walkSubfolders(root, env, { setting: 'claude-md' });
    expect(subfolderSignature(a.found, a.problems)).toBe(subfolderSignature(a.found, []));
    expect(subfolderSignature(a.found, a.problems)).not.toBe(subfolderSignature(b.found, b.problems));
    expect(subfolderSignature(a.found, [{ location: root, message: 'x' }])).not.toBe(subfolderSignature(a.found, []));
  });
});
