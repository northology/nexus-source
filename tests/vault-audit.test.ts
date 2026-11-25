import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { auditVault, formatAudit } from '../core/vault/audit.ts';
import { main, type CliIO } from '../scripts/cli.ts';
import { NOW, tempDir } from './helpers.ts';
import { note, vaultRepo } from './vault-helpers.ts';

const IDENTITY = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, ...IDENTITY } }).trim();
}
function put(root: string, rel: string, text: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}
function commitAll(root: string, message: string): string {
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
}

/** The clean fixture vault with its code, committed as the vault's first commit. */
function repo(files: Record<string, string> = {}): { root: string; first: string } {
  const root = vaultRepo(files, 'clean');
  put(root, 'app/dashboard/metrics/index.ts', 'export const a = 1;\n');
  put(root, 'services/api/retrieval/main.ts', 'export const b = 1;\n');
  git(root, 'init', '-q', '-b', 'main');
  return { root, first: commitAll(root, 'init') };
}

function io(cwd: string) {
  const out: string[] = [];
  const err: string[] = [];
  const value: CliIO = { cwd, out: (l) => out.push(l), err: (l) => err.push(l), now: () => NOW, readStdin: async () => '', env: {} };
  return { value, out, err };
}

const noteFor = (r: ReturnType<typeof auditVault>, file: string) => r.notes.find((n) => n.note === file);

describe('auditVault: thing notes against their sources', () => {
  it('counts the source commits since the note was last committed, and names that commit', () => {
    const { root, first } = repo();
    put(root, 'services/api/retrieval/main.ts', 'export const b = 2;\n');
    commitAll(root, 'retrieval 1');
    put(root, 'services/api/retrieval/more.ts', 'export {};\n');
    commitAll(root, 'retrieval 2');
    const n = noteFor(auditVault(root), 'docs/dev/systems/api/retrieval.md');
    expect(n).toMatchObject({ class: 'system', component: 'api', source: 'services/api/retrieval', state: 'present', noteCommit: first, sourceCommits: 2, uncommitted: false });
    expect(noteFor(auditVault(root), 'docs/data/methods/metrics-index.md')).toMatchObject({ sourceCommits: 0, uncommitted: false });
  });

  it('flags uncommitted changes under a source', () => {
    const { root } = repo();
    put(root, 'app/dashboard/metrics/index.ts', 'export const a = 3;\n');
    expect(noteFor(auditVault(root), 'docs/data/methods/metrics-index.md')).toMatchObject({ state: 'present', uncommitted: true });
  });

  it('tells a source that is gone from one that was never a path in the repo', () => {
    const { root } = repo();
    rmSync(join(root, 'services', 'api', 'retrieval'), { recursive: true });
    commitAll(root, 'drop retrieval');
    const r = auditVault(root);
    expect(noteFor(r, 'docs/dev/systems/api/retrieval.md')).toMatchObject({ state: 'gone' });
    expect(noteFor(r, 'docs/data/datasets/event-log.md')).toMatchObject({ source: 'v_gold_events', state: 'not-a-path', sourceCommits: 0 });
  });

  it('takes a single file as a source', () => {
    const { root } = repo({ 'docs/dev/systems/api/tool.md': note({ class: 'system', component: 'api', source: './scripts/tool.ts' }) });
    put(root, 'scripts/tool.ts', 'export {};\n');
    commitAll(root, 'tool');
    const r = auditVault(root);
    expect(noteFor(r, 'docs/dev/systems/api/tool.md')).toMatchObject({ source: 'scripts/tool.ts', state: 'present' });
    expect(r.uncovered.entries.map((e) => e.path)).not.toContain('scripts/tool.ts');
  });
});

describe('auditVault: coverage', () => {
  it('rolls a folder no note covers up to one entry, and lists single files beside covered ones', () => {
    const { root } = repo();
    put(root, 'scripts/a.ts', 'export {};\n');
    put(root, 'scripts/sub/b.ts', 'export {};\n');
    put(root, 'app/dashboard/other.ts', 'export {};\n');
    put(root, '.build/x/build.json', '{}\n');
    const r = auditVault(root);
    expect(r.uncovered.entries).toEqual([
      { path: 'app/dashboard/other.ts', folder: false, files: 1, sample: [] },
      { path: 'scripts', folder: true, files: 2, sample: ['scripts/a.ts', 'scripts/sub/b.ts'] },
    ]);
    expect(r.uncovered.files).toBe(3);
  });

  it('counts nothing as uncovered when every file sits under a source', () => {
    expect(auditVault(repo().root).uncovered).toEqual({ files: 0, entries: [] });
  });
});

describe('auditVault: issues, rules and links', () => {
  it('lists open issues from the log and issue notes, with the paths their text names', () => {
    const log = {
      entries: [
        { build: 'b', name: 'retrieval-slow', text: 'services/api/retrieval/main.ts is slow; gone/file.ts too.', status: 'open', source: 's', time: '2026-01-01T00:00:00Z', phase: 'p' },
        { build: 'b', name: 'old', text: 'fixed long ago', status: 'closed', source: 's', time: '2026-01-01T00:00:00Z', phase: 'p' },
      ],
    };
    const { root } = repo({ 'docs/governance/issues.json': `${JSON.stringify(log, null, 2)}\n` });
    put(root, 'services/api/retrieval/main.ts', 'export const b = 9;\n');
    commitAll(root, 'later work');
    const r = auditVault(root);
    expect(r.issues.map((i) => i.name)).toEqual(['metrics-axis', 'retrieval-slow']);
    expect(r.issues.find((i) => i.name === 'retrieval-slow')).toMatchObject({
      from: 'log', since: '2026-01-01T00:00:00Z', commitsSince: 2,
      paths: [{ path: 'services/api/retrieval/main.ts', exists: true }, { path: 'gone/file.ts', exists: false }],
    });
    expect(r.issues.find((i) => i.name === 'metrics-axis')).toMatchObject({ from: 'note', file: 'docs/governance/issues/metrics-axis.md' });
  });

  it('lists active rules with their tier, and how many files a scoped rule\'s paths match', () => {
    const { root } = repo();
    let rules = auditVault(root).rules;
    expect(rules.find((x) => x.name === 'merge-loads')).toEqual({ name: 'merge-loads', file: 'docs/governance/rules/merge-loads.md', title: 'Every load is an idempotent MERGE', tier: 'scoped', paths: ['data/pipelines/**'], matches: 0 });
    expect(rules.find((x) => x.name === 'explicit-staging')).toMatchObject({ tier: 'always', paths: [], matches: null });
    put(root, 'data/pipelines/load.sql', 'select 1;\n');
    rules = auditVault(root).rules;
    expect(rules.find((x) => x.name === 'merge-loads')?.matches).toBe(1);
  });

  it('reports the links that resolve to nothing', () => {
    const { root } = repo({ 'docs/design/broken.md': note({ class: 'design-note', component: 'shared' }, '# Broken\n\nSee [[nowhere/at-all]].\n') });
    expect(auditVault(root).links).toEqual([{ file: 'docs/design/broken.md', line: 7, message: "[[nowhere/at-all]] doesn't resolve to a file in docs/" }]);
  });
});

describe('auditVault: where it runs', () => {
  it('works on a vault with no commits yet', () => {
    const root = vaultRepo({}, 'clean');
    git(root, 'init', '-q', '-b', 'main');
    const r = auditVault(root);
    expect(r.head).toBeNull();
    expect(noteFor(r, 'docs/dev/systems/api/retrieval.md')).toMatchObject({ noteCommit: null, sourceCommits: 0 });
  });

  it('refuses outside a git repository and without a vault', () => {
    expect(() => auditVault(vaultRepo({}, 'clean'))).toThrow(/needs a git repository/);
    const bare = tempDir('nexus-vault-');
    git(bare, 'init', '-q');
    expect(() => auditVault(bare)).toThrow(/not a nexus vault/);
  });
});

describe('nexus docs audit', () => {
  it('prints the report as text, and as JSON with --json', async () => {
    const { root } = repo();
    put(root, 'scripts/a.ts', 'export {};\n');
    const text = io(root);
    expect(await main(['docs', 'audit'], text.value)).toBe(0);
    expect(text.out[0]).toMatch(/^nexus docs audit: \d+ thing notes?, 1 uncovered file, \d+ open issues?, \d+ active rules?$/);
    expect(text.out.join('\n')).toContain('  uncovered  scripts/a.ts');
    const json = io(root);
    expect(await main(['docs', 'audit', '--json'], json.value)).toBe(0);
    expect(JSON.parse(json.out.join('\n'))).toMatchObject({ uncovered: { files: 1 } });
    expect(formatAudit(auditVault(root))[0]).toBe(text.out[0]);
  });
});
