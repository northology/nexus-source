import { describe, it, expect } from 'vitest';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { applyUpgrade, planUpgrade, upgradeRefusal } from '../core/vault/upgrade.ts';
import { readRegistry } from '../core/vault/registry.ts';
import { main, type CliIO } from '../scripts/cli.ts';
import { EXAMPLES, NOW, tempDir, treeHash } from './helpers.ts';
import { STANDARD, vaultRepo } from './vault-helpers.ts';

const CONTRACT_1 = '---\ncontract: 1\n---\n# Contract\n\nThe version of the vault standard this vault follows.\n';

/** A vault as an older nexus left it: contract 1 and no report class. Extra files are written after the report class is removed. */
function olderVault(files: Record<string, string> = {}): string {
  const root = vaultRepo({ 'docs/_meta/contract.md': CONTRACT_1 }, 'clean');
  rmSync(join(root, 'docs', '_meta', 'classes', 'report.md'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

function io(cwd: string) {
  const out: string[] = [];
  const err: string[] = [];
  const value: CliIO = { cwd, out: (l) => out.push(l), err: (l) => err.push(l), now: () => NOW, readStdin: async () => '', env: {} };
  return { value, out, err };
}

const CONTRACT_2 = CONTRACT_1.replace('contract: 1', 'contract: 2');

describe('planUpgrade', () => {
  it('brings a contract-2 vault to 3 by adding the build-record class', () => {
    const root = vaultRepo({ 'docs/_meta/contract.md': CONTRACT_2 }, 'clean');
    rmSync(join(root, 'docs', '_meta', 'classes', 'build-record.md'));
    const plan = planUpgrade(root, STANDARD);
    expect(plan.adds.map((a) => a.path)).toEqual(['docs/_meta/classes/build-record.md']);
    expect(plan.contract).toEqual({ from: 2, to: 3 });
  });
  it('lists the missing standard class and the contract, and writes nothing', () => {
    const root = olderVault();
    const before = treeHash(root);
    const plan = planUpgrade(root, STANDARD);
    expect(plan.problems).toEqual([]);
    expect(plan.adds.map((a) => a.path)).toEqual(['docs/_meta/classes/report.md']);
    expect(plan.adds[0]?.data).toBe(readFileSync(join(STANDARD, 'classes', 'report.md'), 'utf8'));
    expect(plan.contract).toEqual({ from: 1, to: 3 });
    expect(treeHash(root)).toBe(before);
  });
  it('has nothing to do for a vault at the supported contract', () => {
    expect(planUpgrade(vaultRepo({}, 'clean'), STANDARD)).toEqual({ adds: [], contract: null, problems: [] });
  });
  it('leaves a class the vault already has, edited or not, out of the plan', () => {
    const root = olderVault({ 'docs/_meta/classes/report.md': readFileSync(join(STANDARD, 'classes', 'report.md'), 'utf8').replace('An archived report', 'Our reports') });
    expect(planUpgrade(root, STANDARD).adds).toEqual([]);
  });
  it('adds a missing contract.md from the standard', () => {
    const root = vaultRepo({}, 'clean');
    rmSync(join(root, 'docs', '_meta', 'contract.md'));
    const plan = planUpgrade(root, STANDARD);
    expect(plan.adds.map((a) => a.path)).toEqual(['docs/_meta/contract.md']);
    expect(plan.contract).toEqual({ from: null, to: 3 });
  });
  it('refuses a vault newer than this nexus, a contract.md it cannot read, and a folder with no vault', () => {
    expect(planUpgrade(vaultRepo({ 'docs/_meta/contract.md': '---\ncontract: 4\n---\n' }, 'clean'), STANDARD)).toEqual({ adds: [], contract: null, problems: ['this vault follows contract 4; this nexus supports 3. Update nexus.'] });
    expect(planUpgrade(vaultRepo({ 'docs/_meta/contract.md': '---\ncontract: one\n---\n' }, 'clean'), STANDARD).problems).toEqual(["docs/_meta/contract.md can't be read; fix it before upgrading"]);
    expect(planUpgrade(tempDir(), STANDARD).problems).toEqual(['docs/_meta/classes/ not found: run nexus init first']);
  });
});

describe('applyUpgrade', () => {
  it('adds the class and raises the number, keeping the rest of contract.md', () => {
    const root = olderVault();
    const decision = readFileSync(join(root, 'docs', '_meta', 'classes', 'decision.md'), 'utf8');
    applyUpgrade(root, planUpgrade(root, STANDARD));
    expect(readFileSync(join(root, 'docs', '_meta', 'classes', 'report.md'), 'utf8')).toBe(readFileSync(join(STANDARD, 'classes', 'report.md'), 'utf8'));
    expect(readFileSync(join(root, 'docs', '_meta', 'contract.md'), 'utf8')).toBe(CONTRACT_1.replace('contract: 1', 'contract: 3'));
    expect(readFileSync(join(root, 'docs', '_meta', 'classes', 'decision.md'), 'utf8')).toBe(decision);
    const { registry, findings } = readRegistry(join(root, 'docs'));
    expect(findings).toEqual([]);
    expect(registry.contract).toBe(3);
    expect(registry.classes.has('report')).toBe(true);
    expect(planUpgrade(root, STANDARD)).toEqual({ adds: [], contract: null, problems: [] });
  });
  it('never overwrites a file that appeared after the plan was made', () => {
    const root = olderVault();
    const plan = planUpgrade(root, STANDARD);
    writeFileSync(join(root, 'docs', '_meta', 'classes', 'report.md'), 'mine\n');
    expect(() => applyUpgrade(root, plan)).toThrow('docs/_meta/classes/report.md appeared since the plan was made; nothing was changed');
    expect(readFileSync(join(root, 'docs', '_meta', 'classes', 'report.md'), 'utf8')).toBe('mine\n');
    expect(readFileSync(join(root, 'docs', '_meta', 'contract.md'), 'utf8')).toBe(CONTRACT_1);
  });
  it('writes nothing when any one add has appeared, not just the first', () => {
    const root = olderVault();
    rmSync(join(root, 'docs', '_meta', 'classes', 'decision.md'));
    const plan = planUpgrade(root, STANDARD);
    expect(plan.adds.map((a) => a.path)).toEqual(['docs/_meta/classes/decision.md', 'docs/_meta/classes/report.md']);
    writeFileSync(join(root, 'docs', '_meta', 'classes', 'report.md'), 'mine\n');
    const before = treeHash(root);
    expect(() => applyUpgrade(root, plan)).toThrow(/report\.md appeared since the plan was made/);
    expect(treeHash(root)).toBe(before);
  });
  it('removes the adds already written when a later write fails', () => {
    const root = olderVault();
    rmSync(join(root, 'docs', '_meta', 'classes', 'decision.md'));
    const plan = planUpgrade(root, STANDARD);
    const before = treeHash(root);
    // The same path twice passes the up-front check; the exclusive create stops the second.
    plan.adds.push({ path: plan.adds[0]!.path, data: 'again\n' });
    expect(() => applyUpgrade(root, plan)).toThrow(/decision\.md appeared since the plan was made/);
    expect(treeHash(root)).toBe(before);
  });
  it('keeps a trailing comment on the contract line and leaves a body line alike alone', () => {
    const text = '---\ncontract: 1 # set by nexus\n---\n# Contract\n\ncontract: 1\n';
    const root = olderVault({ 'docs/_meta/contract.md': text });
    applyUpgrade(root, planUpgrade(root, STANDARD));
    expect(readFileSync(join(root, 'docs', '_meta', 'contract.md'), 'utf8')).toBe('---\ncontract: 3 # set by nexus\n---\n# Contract\n\ncontract: 1\n');
  });
  it('keeps a leading byte-order mark and accepts a 1.0 number', () => {
    for (const [text, want] of [
      ['﻿---\ncontract: 1\n---\n# Contract\n', '﻿---\ncontract: 3\n---\n# Contract\n'],
      ['---\ncontract: 1.0\n---\n# Contract\n', '---\ncontract: 3\n---\n# Contract\n'],
    ] as const) {
      const root = olderVault({ 'docs/_meta/contract.md': text });
      const plan = planUpgrade(root, STANDARD);
      expect(plan.problems).toEqual([]);
      applyUpgrade(root, plan);
      expect(readFileSync(join(root, 'docs', '_meta', 'contract.md'), 'utf8')).toBe(want);
    }
  });
  it('plans a problem, and writes nothing, when the contract line cannot be rewritten', () => {
    for (const fm of ['"contract": 1']) {
      const root = olderVault({ 'docs/_meta/contract.md': `---\n${fm}\n---\n# Contract\n\ncontract: 1\n` });
      const before = treeHash(root);
      const plan = planUpgrade(root, STANDARD);
      expect(plan.problems).toEqual(['docs/_meta/contract.md has no contract: line to raise; fix it before upgrading']);
      expect(() => applyUpgrade(root, plan)).toThrow(/no contract: line to raise/);
      expect(treeHash(root)).toBe(before);
    }
  });
  it('treats a class under a different file name as present', () => {
    const root = olderVault({ 'docs/_meta/classes/reports.md': readFileSync(join(STANDARD, 'classes', 'report.md'), 'utf8') });
    expect(planUpgrade(root, STANDARD).adds).toEqual([]);
  });
  it('refuses a plan with problems', () => {
    const root = tempDir();
    expect(() => applyUpgrade(root, planUpgrade(root, STANDARD))).toThrow(/not found/);
  });
});

describe('upgradeRefusal', () => {
  it('names an active build, and is null with none', () => {
    const root = olderVault();
    expect(upgradeRefusal(root)).toBeNull();
    cpSync(join(EXAMPLES, '.build'), join(root, '.build'), { recursive: true });
    expect(upgradeRefusal(root)).toMatch(/build "relay-rebuild" is active/);
  });
});

describe('nexus docs upgrade', () => {
  it('--check lists what it would add and writes nothing', async () => {
    const root = olderVault();
    const before = treeHash(root);
    const t = io(root);
    expect(await main(['docs', 'upgrade', '--check'], t.value)).toBe(0);
    expect(t.out).toEqual(['  add      docs/_meta/classes/report.md', '  contract 1 → 3', 'nexus docs upgrade --check: 1 to add; nothing written']);
    expect(treeHash(root)).toBe(before);
  });
  it('upgrades, then says there is nothing left to do', async () => {
    const root = olderVault();
    const t = io(root);
    expect(await main(['docs', 'upgrade'], t.value)).toBe(0);
    expect(t.out.at(-1)).toBe('nexus docs upgrade: 1 added; the vault follows contract 3');
    expect(existsSync(join(root, 'docs', '_meta', 'classes', 'report.md'))).toBe(true);
    const again = io(root);
    expect(await main(['docs', 'upgrade', root], again.value)).toBe(0);
    expect(again.out).toEqual(['nexus docs upgrade: the vault already follows contract 3']);
  });
  it('refuses during an active build, and a newer vault, writing nothing', async () => {
    const root = olderVault();
    cpSync(join(EXAMPLES, '.build'), join(root, '.build'), { recursive: true });
    const before = treeHash(join(root, 'docs'));
    const t = io(root);
    expect(await main(['docs', 'upgrade'], t.value)).toBe(1);
    expect(t.err.join('\n')).toMatch(/build "relay-rebuild" is active/);
    expect(treeHash(join(root, 'docs'))).toBe(before);
    const newer = io(vaultRepo({ 'docs/_meta/contract.md': '---\ncontract: 4\n---\n' }, 'clean'));
    expect(await main(['docs', 'upgrade'], newer.value)).toBe(1);
    expect(newer.err).toEqual(['nexus docs upgrade: this vault follows contract 4; this nexus supports 3. Update nexus.']);
  });
  it('says "none" for a vault with no contract.md, and prints only after the write', async () => {
    const root = vaultRepo({}, 'clean');
    rmSync(join(root, 'docs', '_meta', 'contract.md'));
    const t = io(root);
    expect(await main(['docs', 'upgrade'], t.value)).toBe(0);
    expect(t.out).toEqual(['  add      docs/_meta/contract.md', '  contract none → 3', 'nexus docs upgrade: 1 added; the vault follows contract 3']);
  });
  it('--check also names the active-build refusal, and still writes nothing', async () => {
    const root = olderVault();
    cpSync(join(EXAMPLES, '.build'), join(root, '.build'), { recursive: true });
    const before = treeHash(root);
    const t = io(root);
    expect(await main(['docs', 'upgrade', '--check'], t.value)).toBe(0);
    expect(t.out[0]).toBe('  add      docs/_meta/classes/report.md');
    expect(t.out.join('\n')).toMatch(/blocked  build "relay-rebuild" is active/);
    expect(t.out.at(-1)).toBe('nexus docs upgrade --check: 1 to add; nothing written');
    expect(treeHash(root)).toBe(before);
  });
  it('writes nothing and prints no add lines when the contract line cannot be rewritten', async () => {
    const root = olderVault({ 'docs/_meta/contract.md': '---\n"contract": 1\n---\n' });
    const before = treeHash(root);
    const t = io(root);
    expect(await main(['docs', 'upgrade'], t.value)).toBe(1);
    expect(t.out).toEqual([]);
    expect(t.err).toEqual(['nexus docs upgrade: docs/_meta/contract.md has no contract: line to raise; fix it before upgrading']);
    expect(treeHash(root)).toBe(before);
  });
  it('names upgrade among the docs sub-commands', async () => {
    const t = io(tempDir());
    expect(await main(['docs', 'lint'], t.value)).toBe(1);
    expect(t.err.join('\n')).toMatch(/docs upgrade \[root\] \[--check\]/);
  });
});
