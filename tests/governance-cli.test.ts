import { describe, it, expect } from 'vitest';
import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { main, type CliIO } from '../scripts/cli.ts';
import { formatInventory, formatSize } from '../core/governance/format.ts';
import { governanceInventory } from '../core/governance/inventory.ts';
import { withMarker } from '../core/vault/generated.ts';
import type { Inventory, InventoryItem } from '../core/governance/types.ts';
import { NOW } from './helpers.ts';
import { put, sandbox } from './governance-helpers.ts';

function io(cwd: string, env: Record<string, string>) {
  const out: string[] = [];
  const err: string[] = [];
  const value: CliIO = { cwd, out: (l) => out.push(l), err: (l) => err.push(l), now: () => NOW, readStdin: async () => '', env };
  return { value, out, err };
}

describe('formatInventory', () => {
  it('groups by scope with a count line', () => {
    const { root, outer, env } = sandbox();
    put(root, { 'CLAUDE.md': '# Repo\n' });
    put(outer, { '.claude/rules/web.md': '# Web\n' });
    const lines = formatInventory(governanceInventory(root, env));
    expect(lines).toEqual([
      'Always loaded',
      '  outside   Repo · CLAUDE.md · 7 B',
      `  outside   Web · ${join(outer, '.claude', 'rules', 'web.md').replace(/\\/g, '/')} · 6 B · only when launched from ${outer.replace(/\\/g, '/')}`,
      '2 standing instructions: 0 recorded, 0 generated, 2 outside the record, 0 this build',
    ]);
  });
  it('--outside lists only what is outside the record', () => {
    const { root, env } = sandbox();
    put(root, { 'CLAUDE.md': '# Repo\n' });
    expect(formatInventory(governanceInventory(root, env), { outside: true })[0]).toBe('Always loaded');
  });
  it('sizes in B, kB and MB', () => {
    expect([formatSize(7), formatSize(2900), formatSize(5_300_000)]).toEqual(['7 B', '2.9 kB', '5.3 MB']);
  });
  it('picks the unit from the rounded value', () => {
    expect([formatSize(999), formatSize(999_949), formatSize(999_950), formatSize(1_000_000)]).toEqual(['999 B', '999.9 kB', '1.0 MB', '1.0 MB']);
  });
  it('--outside leaves out a generated item and says it is filtered', () => {
    const { root, env } = sandbox();
    put(root, {
      'CLAUDE.md': '# Repo\n',
      '.claude/rules/nexus/keep.md': withMarker('# Keep\n', 'docs/governance/rules/keep.md'),
    });
    const inv = governanceInventory(root, env);
    const all = formatInventory(inv);
    expect(all.some((l) => l.startsWith('  generated'))).toBe(true);
    const only = formatInventory(inv, { outside: true });
    expect(only.some((l) => l.startsWith('  generated'))).toBe(false);
    expect(only.filter((l) => l.startsWith('  ')).every((l) => l.startsWith('  outside'))).toBe(true);
    expect(only.at(-1)).toBe('2 standing instructions: 0 recorded, 1 generated, 1 outside the record, 0 this build (showing the 1 outside the record)');
    expect(all.at(-1)).not.toContain('showing');
  });
  it('keeps problems under --outside', () => {
    const { base, root, env } = sandbox();
    put(base, { 'elsewhere/x.md': '# X\n' });
    put(root, { 'CLAUDE.md': '# Repo\n', '.claude/rules/keep.md': '# Keep\n' });
    symlinkSync(join(base, 'elsewhere'), join(root, '.claude', 'rules', 'out'), 'junction');
    const inv = governanceInventory(root, env);
    expect(inv.problems).toHaveLength(1);
    const lines = formatInventory(inv, { outside: true });
    expect(lines.filter((l) => l.startsWith('  problem'))).toEqual([`  problem   ${inv.problems[0]?.location}: ${inv.problems[0]?.message}`]);
  });
  it('prints every note, record word and problem', () => {
    const item = (o: Partial<InventoryItem> & Pick<InventoryItem, 'record' | 'title'>): InventoryItem =>
      ({ id: 'x', kind: 'instructions', location: `${o.title}.md`, scope: 'always', size: 1, changed: '', ...o });
    const inv: Inventory = {
      root: '/r', vault: true, harness: 'claude-code',
      items: [
        item({ record: 'recorded', title: 'Dec', kind: 'decision' }),
        item({ record: 'generated', title: 'Gen', kind: 'generated', source: 'docs/n.md' }),
        item({ record: 'outside', title: 'Imp', source: 'CLAUDE.md' }),
        item({ record: 'outside', title: 'Ag', conditional: 'Codex loads it always' }),
        item({ record: 'build', title: 'Gr', kind: 'guardrail', scope: 'build' }),
        item({ record: 'outside', title: 'Sc', scope: 'path-scoped', paths: ['src/**', 'lib/**'], launchedFrom: '/o' }),
      ],
      problems: [{ location: 'bad.md', message: 'unreadable' }],
      setting: { value: 'claude-md-or-agents-md', from: null },
    };
    expect(formatInventory(inv)).toEqual([
      'Always loaded',
      '  recorded  Dec · Dec.md · 1 B',
      '  generated Gen · Gen.md · 1 B · generated from docs/n.md',
      '  outside   Imp · Imp.md · 1 B · imported by CLAUDE.md',
      '  outside   Ag · Ag.md · 1 B · Codex loads it always',
      'Path-scoped',
      '  outside   Sc · Sc.md · 1 B · paths src/**, lib/** · only when launched from /o',
      'This build',
      '  build     Gr · Gr.md · 1 B',
      '  problem   bad.md: unreadable',
      '6 standing instructions: 1 recorded, 1 generated, 3 outside the record, 1 this build',
    ]);
  });
});

describe('nexus governance list', () => {
  it('prints the inventory from CLAUDE_CONFIG_DIR, and JSON with --json', async () => {
    const { base, root, env } = sandbox();
    put(root, { 'CLAUDE.md': '# Repo\n' });
    const isolate = { CLAUDE_CONFIG_DIR: env.configDir, NEXUS_INVENTORY_CEILING: base, NEXUS_INVENTORY_MANAGED: env.managedDir };
    const t = io(root, isolate);
    expect(await main(['governance', 'list'], t.value)).toBe(0);
    expect(t.out).toContain('  outside   Repo · CLAUDE.md · 7 B');
    expect(t.err).toEqual([`nexus: using NEXUS_INVENTORY_CEILING=${base}`, `nexus: using NEXUS_INVENTORY_MANAGED=${env.managedDir}`]);
    const j = io(root, isolate);
    expect(await main(['governance', 'list', '--json'], j.value)).toBe(0);
    expect(JSON.parse(j.out.join('\n'))).toMatchObject({ vault: false, items: [{ location: 'CLAUDE.md' }] });
  });
  it('takes an explicit root, and --json honours --outside', async () => {
    const { base, root, env } = sandbox();
    put(root, { 'CLAUDE.md': '# Repo\n', '.claude/rules/nexus/keep.md': withMarker('# Keep\n', 'docs/governance/rules/keep.md') });
    const isolate = { CLAUDE_CONFIG_DIR: env.configDir, NEXUS_INVENTORY_CEILING: base, NEXUS_INVENTORY_MANAGED: env.managedDir };
    const a = io(base, isolate);
    expect(await main(['governance', 'list', root, '--json'], a.value)).toBe(0);
    expect((JSON.parse(a.out.join('\n')) as Inventory).items.map((i) => i.record).sort()).toEqual(['generated', 'outside']);
    const b = io(base, isolate);
    expect(await main(['governance', 'list', root, '--json', '--outside'], b.value)).toBe(0);
    const j = JSON.parse(b.out.join('\n')) as Inventory;
    expect(j.items.map((i) => i.record)).toEqual(['outside']);
    expect(j.problems).toEqual([]);
  });
  it('keeps problems in --json --outside', async () => {
    const { base, root, env } = sandbox();
    put(base, { 'elsewhere/x.md': '# X\n' });
    put(root, { '.claude/rules/keep.md': '# Keep\n' });
    symlinkSync(join(base, 'elsewhere'), join(root, '.claude', 'rules', 'out'), 'junction');
    const t = io(root, { CLAUDE_CONFIG_DIR: env.configDir, NEXUS_INVENTORY_CEILING: base, NEXUS_INVENTORY_MANAGED: env.managedDir });
    expect(await main(['governance', 'list', '--json', '--outside'], t.value)).toBe(0);
    const j = JSON.parse(t.out.join('\n')) as Inventory;
    expect(j.problems.map((p) => p.message)).toEqual(['a link leads out of its folder; not read']);
    expect(j.items.every((i) => i.record === 'outside')).toBe(true);
  });
  it('refuses an unknown subcommand', async () => {
    const t = io(sandbox().root, {});
    expect(await main(['governance', 'show'], t.value)).toBe(2);
    expect(t.err[0]).toMatch(/Use `governance list \[root\] \[--json\] \[--outside\]`/);
  });
});
