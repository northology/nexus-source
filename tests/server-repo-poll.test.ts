import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';

const hooks = vi.hoisted(() => ({ reads: [] as string[] }));

// Count every call that reads a file's contents.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: ((p: unknown, ...a: unknown[]) => {
      hooks.reads.push(`readFileSync ${String(p)}`);
      return (actual.readFileSync as (...x: unknown[]) => unknown)(p, ...a);
    }) as typeof actual.readFileSync,
    openSync: ((p: unknown, ...a: unknown[]) => {
      hooks.reads.push(`openSync ${String(p)}`);
      return (actual.openSync as (...x: unknown[]) => unknown)(p, ...a);
    }) as typeof actual.openSync,
  };
});

const { repoSignature } = await import('../server/events.ts');
const { createBuild } = await import('../core/build.ts');
const { proposeGuardrail } = await import('../core/guardrails.ts');
const { applyAnswers, openGate, submitAnswers } = await import('../core/gates.ts');
const { memoryKey } = await import('../core/governance/env.ts');
const { put, sandbox } = await import('./governance-helpers.ts');
const { vaultRepo } = await import('./vault-helpers.ts');
const { NOW } = await import('./helpers.ts');
const { cpSync } = await import('node:fs');

/** A repo with something of every kind the signature covers: instructions and an import, a rule file, memory, a vault with a view, and an accepted guardrail. */
function fullRepo() {
  const { root, env, base } = sandbox();
  const vault = vaultRepo({ 'docs/_meta/views/v.md': '---\nname: v\ntitle: V\ntype: table\ndata: data/v.csv\n---\nAbout v.\n', 'data/v.csv': 'a\n1\n' });
  cpSync(vault, root, { recursive: true });
  put(root, { 'CLAUDE.md': '# Repo\n@notes.md\n', 'notes.md': '# Notes\n', '.claude/rules/style.md': '# Style\n', 'AGENTS.md': '# Codex\n', '.claude/settings.json': '{}' });
  put(root, { 'docs/governance/rules/keep.md': '---\nstatus: active\n---\n# Keep\n' });
  put(join(env.configDir, 'projects', memoryKey(root), 'memory'), { 'MEMORY.md': '- [A](a.md)\n', 'a.md': '---\nname: a\n---\nA\n' });
  createBuild(root, { name: 'relay-rebuild', branch: 'build/relay-rebuild', now: NOW });
  proposeGuardrail(root, 'relay-rebuild', { name: 'read-only', text: 'Never writes', source: 'chat', raisedBy: 'user' }, NOW);
  openGate(root, 'relay-rebuild', { name: 'review-guardrails', type: 'mark-list', log: 'guardrails', title: 'G', why: 'W', items: [{ name: 'read-only', text: 'Never writes' }] }, NOW);
  submitAnswers(root, 'relay-rebuild', 'review-guardrails', { marks: { 'read-only': 'accepted' } }, NOW);
  applyAnswers(root, 'relay-rebuild', 'review-guardrails', NOW);
  return { root, env, base };
}

beforeEach(() => {
  hooks.reads.length = 0;
});

describe('the repo poll', () => {
  it('reads no file contents when nothing changed: it compares stats', () => {
    const { root, env } = fullRepo();
    const first = repoSignature(root, env);
    expect(first).toMatch(/read-only|guardrails\.json/);
    hooks.reads.length = 0;
    expect(repoSignature(root, env)).toBe(first);
    expect(hooks.reads).toEqual([]);
  });
  it('still changes when an imported file, a view note or the guardrail log changes', () => {
    const { root, env } = fullRepo();
    let last = repoSignature(root, env);
    const changed = (): boolean => {
      const next = repoSignature(root, env);
      const differs = next !== last;
      last = next;
      return differs;
    };
    put(root, { 'notes.md': '# Notes, longer\n' });
    expect(changed()).toBe(true);
    put(root, { 'docs/_meta/views/v.md': '---\nname: v\ntitle: V\ntype: table\ndata: data/w.csv\n---\nAbout v, moved.\n' });
    expect(changed()).toBe(true);
    proposeGuardrail(root, 'relay-rebuild', { name: 'later', text: 'Proposed later', source: 'chat', raisedBy: 'user' }, NOW);
    expect(changed()).toBe(true);
    expect(changed()).toBe(false);
  });
});
