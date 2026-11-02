import { describe, it, expect } from 'vitest';
import { fenceTracker } from '../core/fences.ts';

const skipped = (lines: string[]): boolean[] => {
  const skip = fenceTracker();
  return lines.map((l) => skip(l));
};

describe('fenceTracker', () => {
  it('skips a backtick fence and its lines', () => {
    expect(skipped(['a', '```ts', 'b', '```', 'c'])).toEqual([false, true, true, true, false]);
  });
  it('skips a tilde fence and its lines', () => {
    expect(skipped(['a', '~~~', 'b', '~~~', 'c'])).toEqual([false, true, true, true, false]);
  });
  it('closes on a longer fence of the same character, not a shorter or different one', () => {
    expect(skipped(['````', '```', '~~~~', '`````', 'after'])).toEqual([true, true, true, true, false]);
  });
  it('does not treat a line opening with a code span as a fence', () => {
    expect(skipped(['```inline``` is prose', 'next'])).toEqual([false, false]);
  });
  it('does not treat a four-space-indented fence as one', () => {
    expect(skipped(['    ```', 'next'])).toEqual([false, false]);
  });
});
