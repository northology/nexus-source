import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { touchedNotes } from '../core/vault/touched.ts';
import { main, type CliIO } from '../scripts/cli.ts';
import { NOW } from './helpers.ts';
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
function repo(): { root: string; first: string } {
  const root = vaultRepo({}, 'clean');
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

describe('touchedNotes', () => {
  it('maps changed paths to the thing notes whose source covers them, and lists the rest', () => {
    const { root, first } = repo();
    put(root, 'app/dashboard/metrics/index.ts', 'export const a = 2;\n');
    commitAll(root, 'metrics');
    put(root, 'services/api/retrieval/extra.ts', 'export {};\n');
    put(root, 'scripts/new-tool.ts', 'export {};\n');
    const r = touchedNotes(root, { since: first });
    expect(r.base).toBe(first);
    expect(r.from).toBe('since');
    expect(r.notes).toEqual([
      { note: 'docs/data/methods/metrics-index.md', component: 'dashboard', source: 'app/dashboard/metrics', paths: [{ status: 'M', path: 'app/dashboard/metrics/index.ts' }] },
      { note: 'docs/dev/systems/api/retrieval.md', component: 'api', source: 'services/api/retrieval', paths: [{ status: 'A', path: 'services/api/retrieval/extra.ts' }] },
    ]);
    expect(r.uncovered).toEqual([{ status: 'A', path: 'scripts/new-tool.ts' }]);
  });

  it('leaves out the vault itself and the build folder', () => {
    const { root, first } = repo();
    put(root, 'docs/design/new-note.md', note({ class: 'design-note', component: 'shared' }));
    put(root, '.build/x/build.json', '{}\n');
    expect(touchedNotes(root, { since: first }).uncovered).toEqual([]);
  });

  it('reports a deleted source as D, so its note can be retired', () => {
    const { root, first } = repo();
    rmSync(join(root, 'services', 'api', 'retrieval'), { recursive: true });
    expect(touchedNotes(root, { since: first }).notes).toEqual([
      { note: 'docs/dev/systems/api/retrieval.md', component: 'api', source: 'services/api/retrieval', paths: [{ status: 'D', path: 'services/api/retrieval/main.ts' }] },
    ]);
  });

  it('does not count a path that only shares a prefix with a source', () => {
    const { root, first } = repo();
    put(root, 'app/dashboard/metrics-old/x.ts', 'export {};\n');
    const r = touchedNotes(root, { since: first });
    expect(r.notes).toEqual([]);
    expect(r.uncovered).toEqual([{ status: 'A', path: 'app/dashboard/metrics-old/x.ts' }]);
  });

  it('starts from the last commit to the change stream by default', () => {
    const { root } = repo();
    put(root, 'app/dashboard/metrics/index.ts', 'export const a = 2;\n');
    commitAll(root, 'before the sweep');
    put(root, 'docs/governance/change/2026-11-dashboard.md', note({ class: 'change', component: 'dashboard' }, '# 2026-11 dashboard\n\n- 2026-11-25 · applied · metrics (abc1234)\n'));
    const swept = commitAll(root, 'sweep');
    put(root, 'services/api/retrieval/main.ts', 'export const b = 2;\n');
    const r = touchedNotes(root);
    expect(r.base).toBe(swept);
    expect(r.from).toBe('change-stream');
    expect(r.notes.map((n) => n.note)).toEqual(['docs/dev/systems/api/retrieval.md']);
  });

  it('falls back to the commit that set the vault up when the change stream has no commits', () => {
    const root = vaultRepo({});
    git(root, 'init', '-q', '-b', 'main');
    const first = commitAll(root, 'init');
    put(root, 'src/a.ts', 'export {};\n');
    const r = touchedNotes(root);
    expect(r.base).toBe(first);
    expect(r.from).toBe('vault-setup');
    expect(r.uncovered).toEqual([{ status: 'A', path: 'src/a.ts' }]);
  });

  it('refuses a ref that names no commit, and a folder that is no vault', () => {
    const { root } = repo();
    expect(() => touchedNotes(root, { since: 'no-such-ref' })).toThrow(/no-such-ref/);
    const bare = vaultRepo({});
    rmSync(join(bare, 'docs', '_meta'), { recursive: true });
    expect(() => touchedNotes(bare)).toThrow(/not a nexus vault/);
  });
});

describe('nexus docs touched', () => {
  it('prints each note with its changed paths, then the uncovered paths', async () => {
    const { root, first } = repo();
    put(root, 'app/dashboard/metrics/index.ts', 'export const a = 2;\n');
    put(root, 'scripts/new-tool.ts', 'export {};\n');
    const t = io(root);
    expect(await main(['docs', 'touched', '--since', first], t.value)).toBe(0);
    expect(t.out).toEqual([
      `nexus docs touched: since ${first.slice(0, 7)} (--since), 2 changed paths`,
      '  note       docs/data/methods/metrics-index.md (dashboard, app/dashboard/metrics)',
      '    M app/dashboard/metrics/index.ts',
      '  uncovered  A scripts/new-tool.ts',
    ]);
  });

  it('prints the report as JSON', async () => {
    const { root, first } = repo();
    put(root, 'scripts/new-tool.ts', 'export {};\n');
    const t = io(root);
    expect(await main(['docs', 'touched', '--since', first, '--json'], t.value)).toBe(0);
    expect(JSON.parse(t.out.join('\n'))).toEqual({ base: first, from: 'since', notes: [], uncovered: [{ status: 'A', path: 'scripts/new-tool.ts' }] });
  });
});
