import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { adapterFor } from '../hooks/adapters/index.ts';
import type { HarnessAdapter } from '../hooks/adapters/types.ts';
import type { GuardInput } from '../hooks/guard.ts';
import { runLoader } from '../scripts/guard-loader.ts';
import { exampleRepo, tempDir } from './helpers.ts';

const claude = adapterFor('claude-code');
const denyJson = (reason: string) => JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });

describe('the claude-code adapter', () => {
  it('is the identity', () => {
    const raw = { cwd: '/r', tool_name: 'Write', tool_input: { file_path: 'CLAUDE.md' } };
    expect(claude.harness).toBe('claude-code');
    expect(claude.toGuardInputs(raw)).toEqual([raw]);
    expect(claude.toGuardOutput('')).toBe('');
    expect(claude.toGuardOutput(denyJson('why'))).toBe(denyJson('why'));
    expect(claude.toGuardOutput('{"anything":1}')).toBe('{"anything":1}');
    expect(claude.refusal('broken')).toEqual({ code: 2, stdout: '', stderr: 'broken' });
    expect(claude.toHookInput({ cwd: '/r' })).toEqual({ cwd: '/r' });
    expect(claude.toHookOutput('status')).toBe('status');
    expect(claude.toHookOutput('')).toBe('');
    expect(claude.toDocsInputs('{"a":1}')).toEqual(['{"a":1}']);
  });
});

describe('the loader through an adapter', () => {
  const stub = (root: string): HarnessAdapter => ({
    ...claude,
    toGuardInputs: (): GuardInput[] => [
      { cwd: root, tool_name: 'Write', tool_input: { file_path: join(root, 'notes.md') } },
      { cwd: root, tool_name: 'Write', tool_input: { file_path: join(root, 'CLAUDE.md') } },
    ],
    toGuardOutput: (out) => (out === '' ? 'ALLOW' : `DENY:${out}`),
    refusal: (message) => ({ code: 0, stdout: `REFUSED:${message}`, stderr: '' }),
  });
  const deps = (cwd: string, adapter: HarnessAdapter, load = () => import('../scripts/guard-core.ts')) => ({ cwd, load, home: tempDir(), win: process.platform === 'win32', now: new Date(), adapter });

  it("refuses when any mapped input is refused, in the adapter's own form", async () => {
    const root = exampleRepo();
    const r = await runLoader('{}', deps(root, stub(root)));
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^DENY:.*nexus guardrail propose/);
  });
  it("allows in the adapter's own form when nothing is refused", async () => {
    const root = tempDir();
    const r = await runLoader('{}', deps(root, { ...stub(root), toGuardInputs: () => [{ cwd: root, tool_name: 'Write', tool_input: { file_path: join(root, 'x.md') } }] }));
    expect(r).toEqual({ code: 0, stdout: 'ALLOW', stderr: '' });
  });
  it("refuses through the adapter when the guard can't load during a build", async () => {
    const root = exampleRepo();
    const r = await runLoader('{}', deps(root, stub(root), () => Promise.reject(new Error('bundle failed'))));
    expect(r.stdout).toMatch(/^REFUSED:.*couldn't run/);
  });
});
