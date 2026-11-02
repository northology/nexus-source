import { describe, it, expect } from 'vitest';
import { fileInPhase, inPhase, phaseInfo, phaseLabel, selectedPhase } from '../../cockpit/src/lib/phases.ts';
import type { Build } from '../../core/types.ts';

const build = (extra: Partial<Build> = {}): Build => ({ name: 'relay-rebuild', stage: 'planning', branch: 'b', summary: '', created: '2026-10-02T11:05:00Z', gates: {}, ...extra });
const two = build({ phase: 'dashboard', phases: [{ name: 'replay', branch: 'b', started: 'x', finished: 'y' }, { name: 'dashboard', branch: 'b', started: 'x', finished: null }] });
const route = (params: Record<string, string> = {}) => ({ category: 'logs' as const, sub: null, params });

describe('phases in the cockpit', () => {
  it('reads old builds as one phase named after the build', () => {
    expect(phaseInfo(build())).toEqual({ current: 'relay-rebuild', names: ['relay-rebuild'] });
    expect(phaseInfo(null)).toEqual({ current: null, names: [] });
  });
  it('defaults to the current phase; phase=all shows every phase; unknown names fall back', () => {
    const info = phaseInfo(two);
    expect(selectedPhase(route(), info)).toBe('dashboard');
    expect(selectedPhase(route({ phase: 'replay' }), info)).toBe('replay');
    expect(selectedPhase(route({ phase: 'all' }), info)).toBeNull();
    expect(selectedPhase(route({ phase: 'nonsense' }), info)).toBe('dashboard');
  });
  it('keeps entries and documents without a phase visible everywhere', () => {
    expect(inPhase(undefined, 'dashboard')).toBe(true);
    expect(inPhase('replay', 'dashboard')).toBe(false);
    expect(inPhase('replay', null)).toBe(true);
    const names = ['replay', 'dashboard'];
    expect(fileInPhase('documents/specs/dashboard/spec.md', 'dashboard', names)).toBe(true);
    expect(fileInPhase('documents/specs/replay/spec.md', 'dashboard', names)).toBe(false);
    expect(fileInPhase('documents/specs/relay-rebuild-spec.md', 'dashboard', names)).toBe(true);
  });
  it('reads the phase only from the phase folder position', () => {
    const names = ['specs', 'dashboard'];
    expect(fileInPhase('documents/specs/dashboard/spec.md', 'specs', names)).toBe(false);
    expect(fileInPhase('documents/specs/specs/spec.md', 'specs', names)).toBe(true);
    expect(fileInPhase('documents/specs/x.md', 'dashboard', names)).toBe(true);
    expect(fileInPhase('notes/dashboard/n.md', 'dashboard', names)).toBe(true);
    expect(fileInPhase('notes/dashboard/n.md', 'specs', names)).toBe(false);
    expect(fileInPhase('notes/specs.md', 'dashboard', names)).toBe(true);
  });
  it('labels the phase only when it adds something', () => {
    expect(phaseLabel(phaseInfo(two), 'relay-rebuild')).toBe('phase dashboard · 2 of 2');
    expect(phaseLabel(phaseInfo(build()), 'relay-rebuild')).toBeNull();
    expect(phaseLabel(phaseInfo(build({ phase: 'replay', phases: [{ name: 'replay', branch: 'b', started: 'x', finished: null }] })), 'relay-rebuild')).toBe('phase replay · 1 of 1');
  });
  it('names only the phase when it is missing from the phase list', () => {
    const ghost = build({ phase: 'ghost', phases: [{ name: 'replay', branch: 'b', started: 'x', finished: 'y' }, { name: 'dashboard', branch: 'b', started: 'x', finished: null }] });
    expect(phaseLabel(phaseInfo(ghost), 'relay-rebuild')).toBe('phase ghost');
  });
});
