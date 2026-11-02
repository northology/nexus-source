import { describe, it, expect, vi } from 'vitest';
import { runHook } from '../hooks/hook.ts';
import { readSnapshot } from '../core/snapshot.ts';
import { setStage } from '../core/build.ts';
import { exampleRepo } from './helpers.ts';

// The hook runs on every prompt, so it must never read plan progress (the ledger scan). This file spies on
// readSnapshot, which is why it is separate: vi.mock applies to the whole file.
vi.mock('../core/snapshot.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/snapshot.ts')>();
  return { ...actual, readSnapshot: vi.fn(actual.readSnapshot) };
});

describe('hook plan progress', () => {
  it('reads the snapshot without plan progress', () => {
    const root = exampleRepo();
    setStage(root, 'relay-rebuild', 'build');
    runHook({ cwd: root }, { cli: '/plugins/nexus/bin/nexus.mjs' });
    const calls = vi.mocked(readSnapshot).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call[2]).toEqual({ progress: false });
  });
});
