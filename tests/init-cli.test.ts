import { describe, it, expect } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main, type CliIO } from '../scripts/cli.ts';
import { NOW, tempDir, treeHash } from './helpers.ts';
import { testStandard } from './init-helpers.ts';
import { note, vaultRepo } from './vault-helpers.ts';

function io(cwd: string, env: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const value: CliIO = { cwd, out: (l) => out.push(l), err: (l) => err.push(l), now: () => NOW, readStdin: async () => '', env };
  return { value, out, err };
}
const envFor = (s: { standard: string; mirror: string }) => ({ NEXUS_STANDARD_DIR: s.standard, NEXUS_OBSIDIAN_MIRROR: s.mirror });

describe('nexus init', () => {
  it('sets a fresh repo up with answers and ends with a clean check', async () => {
    const s = testStandard();
    const root = tempDir('nexus-cli-init-');
    writeFileSync(join(root, 'answers.json'), JSON.stringify({ answers: 1, components: ['api'], tags: [], seeding: [] }));
    const t = io(root, envFor(s));
    expect(await main(['init', '--answers', 'answers.json'], t.value)).toBe(0);
    expect(t.out).toContain('  create   docs/_meta/ (27 files)');
    expect(t.out).toContain('  generate 0 written');
    expect(t.out.at(-1)).toBe('0 notes checked: 0 blocking, 0 warnings');
    expect(existsSync(join(root, 'docs/.obsidian/plugins/alpha/main.js'))).toBe(true);
  });
  it('--check prints the plan and writes nothing', async () => {
    const s = testStandard();
    const root = tempDir('nexus-cli-init-');
    const before = treeHash(root);
    const t = io(root, envFor(s));
    expect(await main(['init', '--check'], t.value)).toBe(0);
    expect(t.out).toContain('  download 4 pinned plugin and theme files');
    expect(treeHash(root)).toBe(before);
  });
  it('stops with every problem and a hint when the network is out', async () => {
    const s = testStandard();
    const root = tempDir('nexus-cli-init-');
    const t = io(root, { NEXUS_STANDARD_DIR: s.standard, NEXUS_OBSIDIAN_MIRROR: tempDir() });
    expect(await main(['init'], t.value)).toBe(1);
    expect(t.err[0]).toBe('nexus init: stopped; nothing was written:');
    expect(t.err.at(-1)).toBe('No network? Run `nexus init --no-plugins` now and `nexus obsidian install` once online.');
  });
  it('--no-plugins skips the downloads, and obsidian install finishes the job', async () => {
    const s = testStandard();
    const root = tempDir('nexus-cli-init-');
    expect(await main(['init', root, '--no-plugins'], io(tempDir(), envFor(s)).value)).toBe(0);
    const t = io(root, envFor(s));
    expect(await main(['obsidian', 'install', root], t.value)).toBe(0);
    expect(t.out.at(-1)).toBe('0 pinned files in place, 4 downloaded');
  });
  it('says when NEXUS_STANDARD_DIR or NEXUS_OBSIDIAN_MIRROR changes what it uses', async () => {
    const s = testStandard();
    const t = io(tempDir('nexus-cli-init-'), envFor(s));
    expect(await main(['init', '--check'], t.value)).toBe(0);
    expect(t.out.slice(0, 2)).toEqual([`nexus: using NEXUS_STANDARD_DIR=${s.standard}`, `nexus: using NEXUS_OBSIDIAN_MIRROR=${s.mirror}`]);
    const plain = io(tempDir('nexus-cli-init-'));
    expect(await main(['init', '--check', '--no-plugins'], plain.value)).toBe(0);
    expect(plain.out.filter((l) => l.startsWith('nexus: using'))).toEqual([]);
  });
  it('refuses --answers and --no-plugins on other commands', async () => {
    const t = io(tempDir());
    expect(await main(['builds', '--no-plugins'], t.value)).toBe(1);
    expect(t.err[0]).toMatch(/--no-plugins is only used by `nexus init`/);
  });
});

describe('nexus docs generate', () => {
  const VAULT = { 'docs/governance/rules/a.md': note({ class: 'rule', component: 'shared', status: 'active', tier: 'always' }, '# A\n') };
  it('writes, then --check is clean', async () => {
    const root = vaultRepo(VAULT);
    const t = io(root);
    expect(await main(['docs', 'generate'], t.value)).toBe(0);
    expect(t.out[0]).toBe('nexus docs generate: 2 written, 0 removed');
    const c = io(root);
    expect(await main(['docs', 'generate', '--check'], c.value)).toBe(0);
    expect(c.out.at(-1)).toBe('2 generated files expected: 0 to fix');
  });
  it('--check exits 1 and lists drift', async () => {
    const root = vaultRepo(VAULT);
    const t = io(root);
    expect(await main(['docs', 'generate', '--check'], t.value)).toBe(1);
    expect(t.out).toContain('  missing  .claude/rules/nexus/a.md');
  });
  it('stops on an unmarked hub', async () => {
    const root = vaultRepo({ ...VAULT, 'docs/dev/context/governance.md': note({ class: 'hub', component: 'shared' }) });
    const t = io(root);
    expect(await main(['docs', 'generate'], t.value)).toBe(1);
    expect(t.err[0]).toMatch(/docs\/dev\/context\/governance\.md has no generated marker/);
  });
});
