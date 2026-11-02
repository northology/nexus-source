import { describe, it, expect, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { main, type CliIO } from '../scripts/cli.ts';
import { NOW, treeHash } from './helpers.ts';
import { vaultRepo } from './vault-helpers.ts';

const fail = vi.hoisted(() => ({ suffix: '' }));

// A file appearing between the existence check and the exclusive create: the write throws EEXIST for the chosen path.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeFileSync: ((p: string, ...a: unknown[]) => {
      if (fail.suffix && String(p).split('\\').join('/').endsWith(fail.suffix)) throw Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST', path: String(p) });
      return (actual.writeFileSync as (...x: unknown[]) => void)(p, ...a);
    }) as typeof actual.writeFileSync,
  };
});

describe('nexus docs upgrade when a write fails part-way', () => {
  it('exits 1 with the message, prints no add or contract lines, and leaves the tree as it was', async () => {
    const root = vaultRepo({ 'docs/_meta/contract.md': '---\ncontract: 1\n---\n' }, 'clean');
    rmSync(join(root, 'docs', '_meta', 'classes', 'decision.md'));
    rmSync(join(root, 'docs', '_meta', 'classes', 'report.md'));
    const before = treeHash(root);
    fail.suffix = 'classes/report.md';
    const out: string[] = [];
    const err: string[] = [];
    const io: CliIO = { cwd: root, out: (l) => out.push(l), err: (l) => err.push(l), now: () => NOW, readStdin: async () => '', env: {} };
    try {
      expect(await main(['docs', 'upgrade'], io)).toBe(1);
    } finally {
      fail.suffix = '';
    }
    expect(err).toEqual(['nexus: docs/_meta/classes/report.md appeared since the plan was made; nothing was changed']);
    expect(out).toEqual([]);
    expect(treeHash(root)).toBe(before);
  });
});
