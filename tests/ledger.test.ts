import { describe, it, expect } from 'vitest';
import { writeFileSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readLog } from '../core/logs.ts';
import { importLedger, nameFromText, parseLedger } from '../core/ledger.ts';
import { NAME_PATTERN } from '../core/names.ts';
import { exampleRepo, NOW } from './helpers.ts';

const LEDGER = [
  '# SDD ledger — plan: nexus/design/x-plan.md',
  '| Task 2 × Task 3 | shares types.ts | Ruling: ignored inside the scan table |',
  '```',
  'Ruling: ignored inside a code fence',
  '```',
  'Task 3: Ruling: pin mermaid to 12.0.0 — 12.1 is hours old — one upgrade later',
  '- Task 4: parked — slow test — Ruling: the timing is generous enough',
  'Final: Ruling: keep the 1180px cap — the right field stays clear — a re-layout later',
  'Task 5: minor (deferred): the empty state copy could be warmer',
  'Final: minor (deferred): HEAD on build files returns 404',
  'Task 5: complete (commits a1b2c3d..d4e5f6a)',
].join('\n');

describe('parseLedger', () => {
  it('reads rulings and deferred minors, not tables or fences', () => {
    expect(parseLedger(LEDGER)).toEqual([
      { log: 'decisions', text: 'pin mermaid to 12.0.0 — 12.1 is hours old — one upgrade later', where: 'Task 3' },
      { log: 'decisions', text: 'parked — slow test — Ruling: the timing is generous enough', where: 'Task 4' },
      { log: 'decisions', text: 'keep the 1180px cap — the right field stays clear — a re-layout later', where: 'Final' },
      { log: 'issues', text: 'the empty state copy could be warmer', where: 'Task 5' },
      { log: 'issues', text: 'HEAD on build files returns 404', where: 'Final' },
    ]);
  });
  it('a prose line holding a code span is no fence, so the lines after it still read', () => {
    const text = ['Note: the ``` case is handled.', '```cmd``` was run', 'Task 2: complete (commits a1b2c3d..d4e5f6a)', 'Task 2: Ruling: keep it simple'].join('\n');
    expect(parseLedger(text)).toEqual([{ log: 'decisions', text: 'keep it simple', where: 'Task 2' }]);
  });
  it('reads rulings with optional parentheticals', () => {
    const ledger = 'Task 8: Ruling (on the implementer\'s deviation): keep both roots — reason — cost';
    expect(parseLedger(ledger)).toEqual([
      { log: 'decisions', text: 'keep both roots — reason — cost', where: 'Task 8' },
    ]);
  });
  it('treats minor (deferred) as a ruling classifier only at line start (after prefix)', () => {
    const ledger = 'Task 3: Ruling: defer the tiebreak — see the minor (deferred): note — none';
    expect(parseLedger(ledger)).toEqual([
      { log: 'decisions', text: 'defer the tiebreak — see the minor (deferred): note — none', where: 'Task 3' },
    ]);
  });
  it('only classifies as deferred minor when it comes right after the prefix', () => {
    const ledger = 'Final: minor (deferred): mentions a Ruling: inside';
    expect(parseLedger(ledger)).toEqual([
      { log: 'issues', text: 'mentions a Ruling: inside', where: 'Final' },
    ]);
  });
});

describe('nameFromText', () => {
  it('makes readable, unique names from any text', () => {
    const taken = new Set<string>();
    const a = nameFromText('ruling', '12.0.0 — "pinned" for now!', taken);
    expect(a).toBe('ruling-12-0-0-pinned-for-now');
    taken.add(a);
    expect(nameFromText('ruling', '12.0.0 — "pinned" for now!', taken)).toBe('ruling-12-0-0-pinned-for-now-2');
    const long = nameFromText('review', 'a very long finding that keeps going well past any reasonable length for a name', new Set());
    expect(long.length).toBeLessThanOrEqual(64);
    for (const n of [a, long, nameFromText('ruling', '—', new Set())]) expect(n).toMatch(new RegExp(NAME_PATTERN, 'u'));
  });
});

describe('importLedger', () => {
  it('adds rulings to decisions and minors to issues, once, in the current phase', () => {
    const root = exampleRepo();
    const before = { d: readLog(root, 'relay-rebuild', 'decisions').entries.length, i: readLog(root, 'relay-rebuild', 'issues').entries.length };
    expect(importLedger(root, 'relay-rebuild', LEDGER, NOW)).toEqual({ rulings: 3, minors: 2, skipped: 0 });
    const decisions = readLog(root, 'relay-rebuild', 'decisions').entries;
    expect(decisions).toHaveLength(before.d + 3);
    expect(decisions.at(-1)).toMatchObject({ status: 'accepted', source: 'ruling · Final', time: NOW, phase: 'replay' });
    expect(readLog(root, 'relay-rebuild', 'issues').entries.at(-1)).toMatchObject({ status: 'open', source: 'review · Final', text: 'HEAD on build files returns 404' });
    expect(importLedger(root, 'relay-rebuild', LEDGER, NOW)).toEqual({ rulings: 0, minors: 0, skipped: 5 });
    expect(readLog(root, 'relay-rebuild', 'issues').entries).toHaveLength(before.i + 2);
  });
  it("unchanged re-import doesn't rewrite files", () => {
    const root = exampleRepo();
    importLedger(root, 'relay-rebuild', LEDGER, NOW);
    const decisionsFile = join(root, '.build/relay-rebuild/logs/decisions.json');
    const issuesFile = join(root, '.build/relay-rebuild/logs/issues.json');
    const stat1D = statSync(decisionsFile, { bigint: true });
    const stat1I = statSync(issuesFile, { bigint: true });
    const content1D = readFileSync(decisionsFile, 'utf8');
    const content1I = readFileSync(issuesFile, 'utf8');
    importLedger(root, 'relay-rebuild', LEDGER, NOW);
    const stat2D = statSync(decisionsFile, { bigint: true });
    const stat2I = statSync(issuesFile, { bigint: true });
    const content2D = readFileSync(decisionsFile, 'utf8');
    const content2I = readFileSync(issuesFile, 'utf8');
    expect(content1D).toBe(content2D);
    expect(content1I).toBe(content2I);
    expect(stat1D.mtimeNs).toBe(stat2D.mtimeNs);
    expect(stat1I.mtimeNs).toBe(stat2I.mtimeNs);
  });
});
