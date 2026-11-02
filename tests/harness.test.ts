import { describe, it, expect } from 'vitest';
import { currentHarness, HARNESSES } from '../core/harness.ts';

describe('the harness constant', () => {
  it('defaults to claude-code from source', () => {
    expect(currentHarness()).toBe('claude-code');
  });
  it('lists the three harnesses', () => {
    expect(HARNESSES).toEqual(['claude-code', 'codex', 'antigravity']);
  });
});
