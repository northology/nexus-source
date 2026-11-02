import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { checkVault } from '../core/vault/check.ts';
import { tempDir } from './helpers.ts';
import { note, vaultRepo } from './vault-helpers.ts';

const golden = (r: ReturnType<typeof checkVault>) => r.findings.map(({ rule, level, file, line }) => ({ rule, level, file, line }));

describe('checkVault', () => {
  it('passes the clean vault: no findings', () => {
    const r = checkVault(vaultRepo({}, 'clean'));
    expect(r.findings).toEqual([]);
    expect(r).toMatchObject({ vault: true, notes: 14 });
  });
  it('is a silent pass where there is no vault', () => {
    expect(checkVault(tempDir())).toEqual({ vault: false, notes: 0, findings: [], notices: ['not a nexus vault: docs/_meta/classes/ not found'] });
  });
  it('skips dot-folders, README.md, the superpowers landing zone and non-markdown files', () => {
    const root = vaultRepo({
      'docs/.trash/x.md': '# trashed',
      'docs/superpowers/plans/raw.md': '# raw',
      'docs/design/assets/mock.png': 'png',
    }, 'clean');
    expect(checkVault(root).findings).toEqual([]);
  });
  it('blocks unknown top-level folders, root notes and notes in assets/', () => {
    const r = checkVault(vaultRepo({
      'docs/planning/x.md': note({ class: 'guide' }),
      'docs/index.md': '# index',
      'docs/design/assets/notes.md': '# not here',
    }, 'clean'));
    expect(golden(r)).toEqual([
      { rule: 'assets-note', level: 'block', file: 'docs/design/assets/notes.md', line: undefined },
      { rule: 'top-level', level: 'block', file: 'docs/index.md', line: undefined },
      { rule: 'top-level', level: 'block', file: 'docs/planning/', line: undefined },
    ]);
  });
  it('blocks two notes describing the same source', () => {
    const r = checkVault(vaultRepo({ 'docs/data/datasets/calls-copy.md': note({ class: 'dataset', component: 'shared', source: 'v_gold_events' }) }, 'clean'));
    expect(golden(r)).toEqual([
      { rule: 'source-duplicate', level: 'block', file: 'docs/data/datasets/calls-copy.md', line: 4 },
      { rule: 'source-duplicate', level: 'block', file: 'docs/data/datasets/event-log.md', line: 4 },
    ]);
  });
  it('warns when a superseded decision has nothing superseding it', () => {
    const r = checkVault(vaultRepo({ 'docs/governance/archive/decisions/old.md': note({ class: 'decision', component: 'shared', status: 'superseded' }) }, 'clean'));
    expect(golden(r)).toEqual([{ rule: 'supersede-orphan', level: 'warn', file: 'docs/governance/archive/decisions/old.md', line: 4 }]);
  });
  it('reports registry problems and still checks the notes', () => {
    const r = checkVault(vaultRepo({ 'docs/_meta/classes/broken.md': '---\nname: [x\n---\n' }, 'clean'));
    expect(golden(r)).toEqual([{ rule: 'registry-invalid', level: 'block', file: 'docs/_meta/classes/broken.md', line: 1 }]);
    expect(r.notes).toBe(14);
  });
  it('stops at a newer contract and warns about an older one', () => {
    const newer = checkVault(vaultRepo({ 'docs/_meta/contract.md': '---\ncontract: 4\n---\n' }, 'clean'));
    expect(golden(newer)).toEqual([{ rule: 'contract-newer', level: 'block', file: 'docs/_meta/contract.md', line: undefined }]);
    expect(newer.notes).toBe(0);
    const older = checkVault(vaultRepo({}, 'clean'), { supported: 4 });
    expect(golden(older)).toEqual([{ rule: 'contract-older', level: 'warn', file: 'docs/_meta/contract.md', line: undefined }]);
    expect(older.notes).toBe(14);
  });
  it('accepts a report filed with its build, in a phase folder', () => {
    const r = checkVault(vaultRepo({
      'docs/superpowers/archive/proof-board/phase-1/2026-10-10-review.md': note({ class: 'report', component: 'shared', build: 'proof-board' }),
      'docs/superpowers/archive/proof-board/proof-board final report.md': note({ class: 'report', component: 'shared', build: 'proof-board' }),
    }, 'clean'));
    expect(golden(r)).toEqual([]);
    expect(r.notes).toBe(16);
  });
  it('with file, still reports registry problems, because they govern every note', () => {
    const root = vaultRepo({
      'docs/_meta/classes/local.md': '---\nname: [x\n---\n',
      'docs/dev/context/a.md': note({ class: 'local', component: 'shared' }),
    }, 'clean');
    expect(golden(checkVault(root, { file: 'docs/dev/context/a.md' }))).toEqual([
      { rule: 'registry-invalid', level: 'block', file: 'docs/_meta/classes/local.md', line: 1 },
      { rule: 'class-unknown', level: 'block', file: 'docs/dev/context/a.md', line: 2 },
    ]);
  });
  it('never throws on a folder named like a note in _meta/classes/, or a file where superpowers/archive/ should be', () => {
    const odd = vaultRepo({ 'docs/_meta/classes/odd.md/readme.txt': 'x' }, 'clean');
    expect(checkVault(odd).findings).toEqual([]);
    expect(() => checkVault(vaultRepo({ 'docs/superpowers/archive': 'not a folder' }))).not.toThrow();
  });
  it('counts a superseded decision with a dotted name as superseded', () => {
    const r = checkVault(vaultRepo({
      'docs/governance/archive/decisions/v1.2.md': note({ class: 'decision', component: 'shared', status: 'superseded' }),
      'docs/governance/decisions/v2.md': note({ class: 'decision', component: 'shared', status: 'accepted', supersedes: '"[[governance/archive/decisions/v1.2]]"' }),
    }, 'clean'));
    expect(r.findings).toEqual([]);
  });
  it('with file, reports only that note but judges it against the whole vault', () => {
    const root = vaultRepo({ 'docs/data/datasets/calls-copy.md': note({ class: 'dataset', component: 'shared', source: 'v_gold_events' }) }, 'clean');
    const r = checkVault(root, { file: join(root, 'docs', 'data', 'datasets', 'calls-copy.md') });
    expect(golden(r)).toEqual([{ rule: 'source-duplicate', level: 'block', file: 'docs/data/datasets/calls-copy.md', line: 4 }]);
    expect(checkVault(root, { file: 'docs/data/datasets/calls-copy.md' }).findings).toHaveLength(1);
  });
});
