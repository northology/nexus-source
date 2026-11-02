import { describe, it, expect } from 'vitest';
import { readSnapshot } from '../../core/snapshot.ts';
import { lastWrite, railItems } from '../../cockpit/src/lib/rail.ts';
import { exampleRepo } from '../helpers.ts';

describe('rail', () => {
  const s = readSnapshot(exampleRepo(), 'relay-rebuild');
  const item = (c: string) => {
    const found = railItems(s).find((i) => i.category === c);
    if (!found) throw new Error(`no rail item ${c}`);
    return found;
  };
  it('lists the seven sections in order', () => {
    expect(railItems(s).map((i) => i.label)).toEqual(['Gate', 'Plan', 'Phases', 'Logs', 'Concepts', 'Documents', 'Guidance']);
  });
  it('shows no planned phases yet, then counts them, one cell each, without reading which have run', () => {
    expect(item('phases')).toMatchObject({ count: '—', needs: false, cells: [] });
    const started = s.build?.phases?.[0]?.name ?? 'replay';
    const phases = [{ name: started, description: 'Started.' }, { name: 'later-phase', description: 'Not yet.' }];
    expect(railItems({ ...s, phases }).find((i) => i.category === 'phases')).toMatchObject({ count: '2', needs: false, cells: ['on', 'on'] });
  });
  it('counts open gates in red', () => {
    expect(item('gate')).toMatchObject({ count: '2', needs: true, cells: ['need', 'need', 'on'] });
  });
  it('shows no plan yet', () => {
    expect(item('plan')).toMatchObject({ count: '—', needs: false, cells: [] });
  });
  it('counts open questions and open issues without red', () => {
    expect(item('logs')).toMatchObject({ count: '3', needs: false });
  });
  it('flags a document attached to an open gate', () => {
    expect(item('documents')).toMatchObject({ count: '1', needs: true });
    expect(item('documents').cells).toContain('need');
  });
  it('counts concept topics, in red while a round is open', () => {
    // The example's one concept round, look, is open.
    expect(item('concepts')).toMatchObject({ count: '1', needs: true, cells: ['need'] });
    const open = s.gates.find((g) => g.name === 'look');
    if (!open) throw new Error('no look gate');
    const answered = { ...open, answers: { gate: 'look', submitted: '2026-10-02T19:00:00Z', choice: 'quiet-board' } };
    const second = { ...open, name: 'legend-1', request: { ...open.request, name: 'legend-1', topic: 'legend' } };
    const concepts = railItems({ ...s, gates: [...s.gates.filter((g) => g !== open), answered, second] }).find((i) => i.category === 'concepts');
    expect(concepts).toMatchObject({ count: '2', needs: true });
    expect([...(concepts?.cells ?? [])].sort()).toEqual(['need', 'on']);
    const settled = railItems({ ...s, gates: [...s.gates.filter((g) => g !== open), answered] }).find((i) => i.category === 'concepts');
    expect(settled).toMatchObject({ count: '1', needs: false, cells: ['on'] });
  });
  it('marks a topic as needing you when an earlier round is open and the latest is answered', () => {
    const open = s.gates.find((g) => g.name === 'look');
    if (!open) throw new Error('no look gate');
    // Round 1 opened first and is still open; round 2 opened later and is answered.
    const first = { ...open, request: { ...open.request, topic: 'look' } };
    const later = { ...open, name: 'look-2', request: { ...open.request, name: 'look-2', topic: 'look', opened: '2026-10-02T13:00:00-06:00' }, answers: { gate: 'look-2', submitted: '2026-10-02T19:30:00Z', choice: 'quiet-board' } };
    const concepts = railItems({ ...s, gates: [...s.gates.filter((g) => g !== open), first, later] }).find((i) => i.category === 'concepts');
    expect(concepts).toMatchObject({ count: '1', needs: true, cells: ['need'] });
  });
  it('finds the most recent write', () => {
    expect(lastWrite(s)).not.toBeNull();
  });
});
