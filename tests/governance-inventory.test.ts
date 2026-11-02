import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { createBuild } from '../core/build.ts';
import { proposeGuardrail } from '../core/guardrails.ts';
import { applyAnswers, openGate, submitAnswers } from '../core/gates.ts';
import { governanceInventory, readInventoryItem } from '../core/governance/inventory.ts';
import { memoryKey } from '../core/governance/env.ts';
import { cpSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { REGISTRY_ENTRIES } from '../core/init/standard.ts';
import { NOW } from './helpers.ts';
import { note, STANDARD } from './vault-helpers.ts';
import { put, sandbox } from './governance-helpers.ts';
import { vaultItems } from '../core/governance/vault.ts';
import type { InventoryProblem } from '../core/governance/types.ts';

function repoWithVault() {
  const s = sandbox();
  for (const e of REGISTRY_ENTRIES) cpSync(join(STANDARD, e), join(s.root, 'docs', '_meta', e), { recursive: true });
  put(s.root, {
    'docs/governance/decisions/walled-registry.md': note({ class: 'decision', component: 'shared', status: 'accepted' }, '# Registry is walled\n'),
    'docs/governance/rules/explicit-staging.md': note({ class: 'rule', component: 'shared', status: 'active', tier: 'always' }, '# Stage explicit paths\n'),
    'docs/governance/rules/ui-tests.md': note({ class: 'rule', component: 'shared', status: 'active', tier: 'scoped', paths: ['web/**'] }, '# UI tests\n'),
    'docs/governance/issues/slow-hook.md': note({ class: 'issue', component: 'shared', status: 'deferred' }, '# Slow hook\n'),
    'docs/governance/archive/decisions/old.md': note({ class: 'decision', component: 'shared', status: 'superseded' }, '# Old\n'),
    'CLAUDE.md': '# Repo instructions\n',
  });
  return s;
}

describe('governanceInventory', () => {
  it('lists recorded notes with their scope, leaving the archive out', () => {
    const { root, env } = repoWithVault();
    const inv = governanceInventory(root, env);
    expect(inv.vault).toBe(true);
    const vaultRows = inv.items.filter((i) => i.record === 'recorded').map((i) => [i.kind, i.title, i.scope, i.paths ?? null]);
    expect(vaultRows).toEqual([
      ['rule', 'Stage explicit paths', 'always', null],
      ['rule', 'UI tests', 'path-scoped', ['web/**']],
      ['decision', 'Registry is walled', 'on-demand', null],
      ['issue', 'Slow hook', 'on-demand', null],
    ]);
  });
  it('orders by scope, then kind, then location, and marks everything outside the vault as outside the record', () => {
    const { root, env } = repoWithVault();
    put(join(env.configDir, 'projects', memoryKey(root), 'memory'), { 'MEMORY.md': 'index\n', 'tip.md': '# A tip\n' });
    const inv = governanceInventory(root, env);
    expect(inv.items.map((i) => [i.scope, i.kind, i.record, i.location])).toEqual([
      ['always', 'rule', 'recorded', 'docs/governance/rules/explicit-staging.md'],
      ['always', 'instructions', 'outside', 'CLAUDE.md'],
      ['always', 'memory', 'outside', `~/.claude/projects/${memoryKey(root)}/memory/MEMORY.md`],
      ['path-scoped', 'rule', 'recorded', 'docs/governance/rules/ui-tests.md'],
      ['on-demand', 'decision', 'recorded', 'docs/governance/decisions/walled-registry.md'],
      ['on-demand', 'issue', 'recorded', 'docs/governance/issues/slow-hook.md'],
      ['on-demand', 'memory', 'outside', `~/.claude/projects/${memoryKey(root)}/memory/tip.md`],
    ]);
  });
  it('gives each item a stable 12-hex id from its kind and location', () => {
    const { root, env } = repoWithVault();
    const a = governanceInventory(root, env).items.map((i) => i.id);
    const b = governanceInventory(root, env).items.map((i) => i.id);
    expect(a).toEqual(b);
    expect(a.every((id) => /^[0-9a-f]{12}$/.test(id))).toBe(true);
    expect(new Set(a).size).toBe(a.length);
  });
  it('lists an active build\'s accepted guardrails as this build, and no others', () => {
    const { root, env } = repoWithVault();
    createBuild(root, { name: 'relay-rebuild', branch: 'build/relay-rebuild', now: NOW });
    proposeGuardrail(root, 'relay-rebuild', { name: 'read-only', text: 'Replay never writes to the sources', source: 'chat', raisedBy: 'user' }, NOW);
    proposeGuardrail(root, 'relay-rebuild', { name: 'not-yet', text: 'Still proposed', source: 'chat', raisedBy: 'claude' }, NOW);
    openGate(root, 'relay-rebuild', { name: 'review-guardrails', type: 'mark-list', log: 'guardrails', title: 'G', why: 'W', items: [{ name: 'read-only', text: 'Replay never writes to the sources' }] }, NOW);
    submitAnswers(root, 'relay-rebuild', 'review-guardrails', { marks: { 'read-only': 'accepted' } }, NOW);
    applyAnswers(root, 'relay-rebuild', 'review-guardrails', NOW);
    const builds = governanceInventory(root, env).items.filter((i) => i.kind === 'guardrail');
    expect(builds.map((i) => [i.title, i.scope, i.record, i.location])).toEqual([['read-only', 'build', 'build', '.build/relay-rebuild/logs/guardrails.json#read-only']]);
    const id = governanceInventory(root, env).items.find((i) => i.kind === 'guardrail')?.id ?? '';
    expect(readInventoryItem(root, env, id).text).toBe('Replay never writes to the sources');
  });
  it('lists a file only once when two collectors reach it under different letter case (Windows)', (ctx) => {
    if (process.platform !== 'win32') return ctx.skip();
    const { root, env } = sandbox();
    put(root, { '.claude/rules/a.md': '# A\n', '.claude/settings.json': JSON.stringify({ autoMemoryDirectory: join(root.toUpperCase(), '.claude', 'rules') }) });
    const rows = governanceInventory(root, env).items.filter((i) => i.location.toLowerCase() === '.claude/rules/a.md');
    expect(rows).toHaveLength(1);
  });
  it('records a build whose guardrail log is corrupt as a problem and still lists the rest', () => {
    const { root, env } = repoWithVault();
    createBuild(root, { name: 'broken-build', branch: 'build/broken-build', now: NOW });
    writeFileSync(join(root, '.build', 'broken-build', 'logs', 'guardrails.json'), '{ not json');
    const inv = governanceInventory(root, env);
    expect(inv.items.some((i) => i.location === 'CLAUDE.md')).toBe(true);
    expect(inv.problems).toHaveLength(1);
    expect(inv.problems[0]?.location).toBe('.build/broken-build/logs/guardrails.json');
  });
  it('is an empty inventory, not an error, with no vault and nothing else', () => {
    const { root, env } = sandbox();
    expect(governanceInventory(root, env)).toEqual({ root, vault: false, items: [], problems: [], harness: 'claude-code', setting: { value: 'claude-md-or-agents-md', from: null } });
  });
});

function acceptGuardrail(root: string, build: string, text: string): void {
  createBuild(root, { name: build, branch: `build/${build}`, now: NOW });
  proposeGuardrail(root, build, { name: 'read-only', text, source: 'chat', raisedBy: 'user' }, NOW);
  openGate(root, build, { name: 'review-guardrails', type: 'mark-list', log: 'guardrails', title: 'G', why: 'W', items: [{ name: 'read-only', text }] }, NOW);
  submitAnswers(root, build, 'review-guardrails', { marks: { 'read-only': 'accepted' } }, NOW);
  applyAnswers(root, build, 'review-guardrails', NOW);
}

describe('readInventoryItem', () => {
  it("returns an item's text by id", () => {
    const { root, env } = repoWithVault();
    const item = governanceInventory(root, env).items.find((i) => i.location === 'CLAUDE.md');
    expect(readInventoryItem(root, env, item?.id ?? '').text).toBe('# Repo instructions\n');
  });
  it("returns a guardrail's sentence", () => {
    const { root, env } = repoWithVault();
    acceptGuardrail(root, 'relay-rebuild', 'Replay never writes to the sources');
    const id = governanceInventory(root, env).items.find((i) => i.kind === 'guardrail')?.id ?? '';
    expect(readInventoryItem(root, env, id).text).toBe('Replay never writes to the sources');
  });
  it('gives each build its own sentence when two active builds share a guardrail name', () => {
    const { root, env } = repoWithVault();
    acceptGuardrail(root, 'build-alpha', 'Alpha sentence');
    acceptGuardrail(root, 'build-beta', 'Beta sentence');
    const items = governanceInventory(root, env).items.filter((i) => i.kind === 'guardrail');
    expect(items.map((i) => [i.location, readInventoryItem(root, env, i.id).text])).toEqual([
      ['.build/build-alpha/logs/guardrails.json#read-only', 'Alpha sentence'],
      ['.build/build-beta/logs/guardrails.json#read-only', 'Beta sentence'],
    ]);
  });
  it('reads an item whose location is absolute, outside the repo and the home folder', () => {
    const { root, env, outer } = repoWithVault();
    put(outer, { 'CLAUDE.md': '# Above the repo\n' });
    const item = governanceInventory(root, env).items.find((i) => i.title === 'Above the repo');
    expect(item?.location).toBe(join(outer, 'CLAUDE.md').replace(/\\/g, '/'));
    expect(readInventoryItem(root, env, item?.id ?? '').text).toBe('# Above the repo\n');
  });
  it('answers 404 for an unknown id, and for an item deleted since it was listed', () => {
    const { root, env } = repoWithVault();
    expect(() => readInventoryItem(root, env, '000000000000')).toThrow(expect.objectContaining({ status: 404 }));
    const item = governanceInventory(root, env).items.find((i) => i.location === 'CLAUDE.md');
    rmSync(join(root, 'CLAUDE.md'));
    expect(() => readInventoryItem(root, env, item?.id ?? '')).toThrow(expect.objectContaining({ status: 404 }));
  });
});

describe('vaultItems', () => {
  it('records a problem for an unreadable note and keeps the others', () => {
    const { root } = repoWithVault();
    const problems: InventoryProblem[] = [];
    const read = ((f: string, enc: BufferEncoding) => {
      if (f.endsWith('ui-tests.md')) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return readFileSync(f, enc);
    }) as typeof readFileSync;
    const { vault, found } = vaultItems(root, problems, read);
    expect(vault).toBe(true);
    expect(found.map((f) => f.title)).toEqual(['Registry is walled', 'Stage explicit paths', 'Slow hook']);
    expect(problems).toEqual([{ location: join(root, 'docs', 'governance', 'rules', 'ui-tests.md'), message: "can't be read: EACCES" }]);
  });
  it('reports a note that is a file link out of the vault, and neither lists nor serves it', (ctx) => {
    const { root, env, base } = repoWithVault();
    put(base, { 'elsewhere/secret.md': note({ class: 'decision', component: 'shared', status: 'accepted' }, '# Secret\n') });
    const link = join(root, 'docs', 'governance', 'decisions', 'x.md');
    try {
      symlinkSync(join(base, 'elsewhere', 'secret.md'), link, 'file');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EPERM') return ctx.skip();
      throw e;
    }
    const problems: InventoryProblem[] = [];
    expect(vaultItems(root, problems).found.map((f) => f.title)).not.toContain('Secret');
    expect(problems).toEqual([{ location: link, message: 'a link leads out of its folder; not read' }]);
    const inv = governanceInventory(root, env);
    expect(inv.items.some((i) => i.title === 'Secret')).toBe(false);
    expect(inv.problems).toEqual([{ location: 'docs/governance/decisions/x.md', message: 'a link leads out of its folder; not read' }]);
  });
  it('is not a vault without a registry', () => {
    const { root } = sandbox();
    expect(vaultItems(root)).toEqual({ vault: false, found: [] });
  });
});
