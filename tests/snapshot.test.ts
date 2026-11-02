import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSnapshot } from '../core/snapshot.ts';
import { exampleRepo, planRepo } from './helpers.ts';

const B = 'relay-rebuild';
const LEDGER = '# SDD ledger — plan: .build/relay-rebuild/documents/plans/replay/splash-plan.md\nTask 1: fix round 1/5 (0 addressed, 1 open)\n';

describe('readSnapshot', () => {
  it('skips plan progress when asked, and reads it by default', () => {
    const root = planRepo();
    mkdirSync(join(root, '.superpowers', 'sdd', 'run'), { recursive: true });
    writeFileSync(join(root, '.superpowers', 'sdd', 'run', 'progress.md'), LEDGER);
    expect(readSnapshot(root, B, { progress: false }).planProgress).toEqual({});
    expect(Object.keys(readSnapshot(root, B).planProgress)).toHaveLength(1);
  });
});

describe('the build roadmap, phases.json', () => {
  const write = (root: string, data: unknown) => writeFileSync(join(root, '.build', B, 'phases.json'), JSON.stringify(data));
  it('reads the planned phases in their order', () => {
    const root = exampleRepo();
    const phases = [
      { name: 'replay', description: 'Replay calls from the archive.' },
      { name: 'replay-board', description: 'A board of the replayed calls.' },
    ];
    write(root, { phases });
    const s = readSnapshot(root, B, { progress: false });
    expect(s.phases).toEqual(phases);
    expect(s.problems.filter((p) => p.file === 'phases.json')).toEqual([]);
  });
  it('has no roadmap, and no problem, when the file is missing', () => {
    const s = readSnapshot(exampleRepo(), B, { progress: false });
    expect(s.phases).toBeNull();
    expect(s.problems.filter((p) => p.file === 'phases.json')).toEqual([]);
  });
  it.each<[string, unknown]>([
    ['a phase without a description', { phases: [{ name: 'replay' }] }],
    ['a name that breaks the name rule', { phases: [{ name: 'Phase 1', description: 'x' }] }],
    ['an unknown property', { phases: [{ name: 'replay', description: 'x', state: 'done' }] }],
    ['no phases list', { roadmap: [] }],
  ])('names %s as a problem with phases.json, and still loads the rest', (_label, data) => {
    const root = exampleRepo();
    write(root, data);
    const s = readSnapshot(root, B, { progress: false });
    expect(s.phases).toBeNull();
    expect(s.problems.map((p) => p.file)).toContain('phases.json');
    expect(s.build).not.toBeNull();
  });
  it('names two phases with the same name as a problem', () => {
    const root = exampleRepo();
    write(root, { phases: [{ name: 'replay', description: 'a' }, { name: 'replay', description: 'b' }] });
    expect(readSnapshot(root, B, { progress: false }).problems).toContainEqual({ file: 'phases.json', message: 'duplicate name "replay"' });
  });
});
