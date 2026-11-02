import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { exitCode, formatReport } from '../core/vault/format.ts';
import { driveSpelling, findVaultRoot, vaultRootOf } from '../core/vault/paths.ts';
import { runDocsCheck, type DocsIO } from '../scripts/docs-check.ts';
import { tempDir } from './helpers.ts';
import { note, vaultRepo } from './vault-helpers.ts';

function io(cwd: string, stdin = '') {
  const out: string[] = [];
  const err: string[] = [];
  const value: DocsIO = { cwd, out: (l) => out.push(l), err: (l) => err.push(l), readStdin: async () => stdin };
  return { value, out, err };
}

describe('formatReport and exitCode', () => {
  it('groups findings by file and ends with a count', () => {
    const lines = formatReport({ vault: true, notes: 3, notices: [], findings: [
      { rule: 'class-unknown', level: 'block', file: 'docs/a.md', line: 2, message: 'm1' },
      { rule: 'link-short', level: 'warn', file: 'docs/a.md', message: 'm2' },
      { rule: 'contract-older', level: 'warn', file: 'docs/_meta/contract.md', message: 'm3' },
    ] });
    expect(lines).toEqual([
      'docs/a.md',
      '  block  class-unknown  line 2: m1',
      '  warn   link-short: m2',
      'docs/_meta/contract.md',
      '  warn   contract-older: m3',
      '3 notes checked: 1 blocking, 2 warnings',
    ]);
  });
  it('exits 1 only when something blocks', () => {
    const base = { vault: true, notes: 1, notices: [] };
    expect(exitCode({ ...base, findings: [{ rule: 'link-short', level: 'warn', file: 'f', message: 'm' }] })).toBe(0);
    expect(exitCode({ ...base, findings: [{ rule: 'js-query', level: 'block', file: 'f', message: 'm' }] })).toBe(1);
  });
  it('prints only the notice outside a vault', () => {
    expect(formatReport({ vault: false, notes: 0, findings: [], notices: ['not a nexus vault: docs/_meta/classes/ not found'] })).toEqual(['not a nexus vault: docs/_meta/classes/ not found']);
  });
});

describe('vault paths', () => {
  it('finds the vault root above a folder, and the root a note belongs to', () => {
    const root = vaultRepo({}, 'clean');
    expect(findVaultRoot(join(root, 'docs', 'dev', 'systems'))).toBe(root);
    expect(findVaultRoot(tempDir())).toBeNull();
    expect(vaultRootOf(join(root, 'docs', 'dev', 'systems', 'api', 'retrieval.md'))).toBe(root);
    expect(vaultRootOf(join(root, 'README.md'))).toBeNull();
  });
  it('reads msys, Cygwin and WSL drive spellings on Windows only', () => {
    expect(driveSpelling('/e/repo/docs/x.md', true)).toBe('e:/repo/docs/x.md');
    expect(driveSpelling('/cygdrive/e/repo/x.md', true)).toBe('e:/repo/x.md');
    expect(driveSpelling('/mnt/e/repo/x.md', true)).toBe('e:/repo/x.md');
    expect(driveSpelling('/e/repo/x.md', false)).toBe('/e/repo/x.md');
  });
});

describe('runDocsCheck', () => {
  it('checks the vault it finds from the current folder', async () => {
    const root = vaultRepo({}, 'clean');
    const t = io(join(root, 'docs', 'dev'));
    expect(await runDocsCheck([], t.value)).toBe(0);
    expect(t.out.at(-1)).toBe('14 notes checked: 0 blocking, 0 warnings');
  });
  it('takes a root, --file and --json', async () => {
    const root = vaultRepo({ 'docs/dev/context/bad.md': note({ class: 'hub' }) }, 'clean');
    const t = io(tempDir());
    expect(await runDocsCheck([root, '--json', '--file', join(root, 'docs', 'dev', 'context', 'bad.md')], t.value)).toBe(1);
    const report = JSON.parse(t.out[0] ?? '{}') as { findings: { rule: string }[] };
    expect(report.findings.map((f) => f.rule)).toEqual(['component-missing']);
  });
  it('refuses a --file that is not a note in the vault, so a typo never passes', async () => {
    const root = vaultRepo({}, 'clean');
    const t = io(root);
    expect(await runDocsCheck(['--file', 'docs/dev/context/nope.md'], t.value)).toBe(2);
    expect(t.err.join('\n')).toMatch(/--file docs\/dev\/context\/nope\.md isn't a note in /);
  });
  it('reads --file against the given root when it is not found from the current folder', async () => {
    const root = vaultRepo({ 'docs/dev/context/bad.md': note({ class: 'hub' }) }, 'clean');
    expect(await runDocsCheck([root, '--file', 'docs/dev/context/bad.md'], io(tempDir()).value)).toBe(1);
  });
  it('passes outside a vault and refuses unknown flags', async () => {
    const t = io(tempDir());
    expect(await runDocsCheck([], t.value)).toBe(0);
    expect(await runDocsCheck(['--nope'], t.value)).toBe(2);
    expect(t.err.join('\n')).toMatch(/Usage: node docs-check\.mjs/);
  });
});
