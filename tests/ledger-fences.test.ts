import { describe, it, expect } from 'vitest';
import { fenceTracker } from '../core/fences.ts';
import { importLedger, parseLedger } from '../core/ledger.ts';
import { readLog } from '../core/logs.ts';
import { startPhase } from '../core/phases.ts';
import { exampleRepo, finishPhase, NOW, LATER } from './helpers.ts';

const B = 'relay-rebuild';

describe('ledger continuation lines', () => {
  it('joins indented continuation lines to their item', () => {
    expect(parseLedger('Task 2: Ruling: keep both — because\n  the second reason — none\nTask 3: complete')).toEqual([
      { log: 'decisions', text: 'keep both — because the second reason — none', where: 'Task 2' },
    ]);
  });
  it('continues a deferred minor too, and stops at a blank or unindented line', () => {
    expect(parseLedger('Final: minor (deferred): one\n    two\n\n  not this\nother')).toEqual([{ log: 'issues', text: 'one two', where: 'Final' }]);
  });
  it('reads an indented ledger item as its own item, not a continuation', () => {
    expect(parseLedger('Task 1: Ruling: a — b — c\n  Task 2: Ruling: d — e — f')).toEqual([
      { log: 'decisions', text: 'a — b — c', where: 'Task 1' },
      { log: 'decisions', text: 'd — e — f', where: 'Task 2' },
    ]);
  });
});

describe('ledger import across phases', () => {
  it('imports the same text again in a later phase', () => {
    const root = exampleRepo();
    const ledger = 'Final: minor (deferred): HEAD on build files returns 404\nFinal: Ruling: keep it — reason — cost';
    expect(importLedger(root, B, ledger, NOW)).toEqual({ rulings: 1, minors: 1, skipped: 0 });
    expect(importLedger(root, B, ledger, NOW)).toEqual({ rulings: 0, minors: 0, skipped: 2 });
    finishPhase(root);
    startPhase(root, B, 'dashboard', { branch: 'b2', now: LATER });
    expect(importLedger(root, B, ledger, LATER)).toEqual({ rulings: 1, minors: 1, skipped: 0 });
    const same = readLog(root, B, 'issues').entries.filter((e) => e.text === 'HEAD on build files returns 404');
    expect(same.map((e) => e.phase)).toEqual(['replay', 'dashboard']);
  });
});

describe('fences, per CommonMark', () => {
  const run = (lines: string[]) => {
    const t = fenceTracker();
    return lines.map((l) => t(l));
  };
  it('an opener indented 8 spaces is code, not a fence', () => {
    expect(run(['        ```', 'x'])).toEqual([false, false]);
  });
  it('a closer indented up to 3 spaces closes', () => {
    expect(run(['```', 'x', '  ```', 'after'])).toEqual([true, true, true, false]);
  });
  it('a closer with an info string does not close', () => {
    expect(run(['```', 'x', '```bash', 'still'])).toEqual([true, true, true, true]);
  });
  it('a fence opened in a list item is a fence, closed at its content indent', () => {
    expect(run(['- ```bash', 'inside', '  ```', 'after'])).toEqual([true, true, true, false]);
    expect(run(['1. ```', 'inside', '   ```', 'after'])).toEqual([true, true, true, false]);
  });
  it('a list item that only mentions backticks is no fence', () => {
    expect(run(['- run `x` first', 'next'])).toEqual([false, false]);
  });
});
