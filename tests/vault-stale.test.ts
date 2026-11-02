import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkVault } from '../core/vault/check.ts';
import { note, vaultRepo } from './vault-helpers.ts';

const IDENTITY = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

function git(root: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: root, stdio: 'ignore', env: { ...process.env, ...IDENTITY } });
}
function commitAt(root: string, seconds: number, message: string): void {
  const date = `${seconds} +0000`;
  execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message], { cwd: root, stdio: 'ignore', env: { ...process.env, ...IDENTITY, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
}

describe('checkVault with stale', () => {
  it(`warns when a thing note's source changed after the note`, () => {
    const root = vaultRepo({}, 'clean');
    mkdirSync(join(root, 'app', 'dashboard', 'metrics'), { recursive: true });
    writeFileSync(join(root, 'app', 'dashboard', 'metrics', 'index.ts'), 'export const a = 1;\n');
    git(root, 'init', '-q');
    git(root, 'add', '.');
    commitAt(root, 1_700_000_000, 'first');
    writeFileSync(join(root, 'app', 'dashboard', 'metrics', 'index.ts'), 'export const a = 2;\n');
    git(root, 'add', 'app');
    commitAt(root, 1_700_000_100, 'code changes');
    const r = checkVault(root, { stale: true });
    expect(r.findings.map(({ rule, level, file }) => ({ rule, level, file }))).toEqual([
      { rule: 'stale-source', level: 'warn', file: 'docs/data/methods/metrics-index.md' },
    ]);
    expect(r.notices).toEqual([]);
  });
  it('skips a source outside the repository instead of failing', () => {
    const folder = `outside-${process.pid}-${Date.now()}`;
    const root = vaultRepo({ 'docs/data/methods/outside.md': note({ class: 'method', component: 'shared', source: `../${folder}/x.ts` }) }, 'clean');
    const outside = join(root, '..', folder);
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'x.ts'), 'export {};\n');
    git(root, 'init', '-q');
    git(root, 'add', '.');
    commitAt(root, 1_700_000_000, 'first');
    expect(() => checkVault(root, { stale: true })).not.toThrow();
    expect(checkVault(root, { stale: true }).findings).toEqual([]);
  });
  it('says when there is no git repository', () => {
    const r = checkVault(vaultRepo({}, 'clean'), { stale: true });
    expect(r.findings).toEqual([]);
    expect(r.notices).toEqual(['--stale needs a git repository; no stale checks ran']);
  });
  it('runs no git at all without stale', () => {
    expect(checkVault(vaultRepo({}, 'clean')).notices).toEqual([]);
  });
});
