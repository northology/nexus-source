import { describe, it, expect } from 'vitest';
import { openRounds, outcomeOf, outcomeText, roundOf, topicsOf } from '../core/concept-text.ts';
import type { GateAnswers, GateOption, GateRequest, GateType, GateView } from '../core/types.ts';

const opt = (name: string, label = name.toUpperCase()): GateOption => ({ name, label, page: `concepts/${name}.html` });
const gate = (name: string, opened: string, answers: Partial<GateAnswers> | null = null, extra: Partial<GateRequest> = {}, type: GateType = 'concept-pick'): GateView => ({
  name,
  request: { name, type, title: `Title ${name}`, why: 'why', opened, options: [opt('a'), opt('b'), opt('c')], ...extra },
  answers: answers ? { gate: name, submitted: '2026-10-05T12:00:00Z', ...answers } : null,
  read: null,
});

describe('outcomeOf', () => {
  it('reads each answer shape', () => {
    const base = { gate: 'g', submitted: 't' };
    expect(outcomeOf(null)).toEqual({ kind: 'open' });
    expect(outcomeOf({ ...base, choice: 'a' })).toEqual({ kind: 'picked', choice: 'a' });
    expect(outcomeOf({ ...base, choices: ['a', 'b'] })).toEqual({ kind: 'combined', choices: ['a', 'b'] });
    expect(outcomeOf({ ...base, none: true })).toEqual({ kind: 'none' });
  });
});

describe('roundOf and kept', () => {
  it('numbers the round and keeps the chosen options', () => {
    const r = roundOf(gate('g', '2026-10-05T10:00:00Z', { choice: 'b' }), 2);
    expect(r.number).toBe(2);
    expect(r.outcome).toEqual({ kind: 'picked', choice: 'b' });
    expect(r.kept).toEqual(['b']);
    expect(roundOf(gate('g', '2026-10-05T10:00:00Z', { choices: ['a', 'c'] }), 1).kept).toEqual(['a', 'c']);
    expect(roundOf(gate('g', '2026-10-05T10:00:00Z', { none: true }), 1).kept).toEqual([]);
    expect(roundOf(gate('g', '2026-10-05T10:00:00Z'), 1).kept).toEqual([]);
  });
});

describe('topicsOf', () => {
  it('ignores mark-list and approve gates', () => {
    const gates = [gate('m', '2026-10-05T10:00:00Z', null, {}, 'mark-list'), gate('p', '2026-10-05T10:00:00Z', null, {}, 'approve')];
    expect(topicsOf(gates)).toEqual([]);
  });

  it('groups by topic, orders rounds by opened then name, numbers from 1', () => {
    const topics = topicsOf([
      gate('r2', '2026-10-05T11:00:00Z', null, { topic: 'logo' }),
      gate('r1b', '2026-10-05T10:00:00Z', { choices: ['a'] }, { topic: 'logo' }),
      gate('r1a', '2026-10-05T10:00:00Z', { none: true }, { topic: 'logo' }),
      gate('other', '2026-10-05T09:00:00Z'),
    ]);
    const logo = topics.find((t) => t.name === 'logo');
    expect(logo?.rounds.map((r) => [r.gate.name, r.number])).toEqual([['r1a', 1], ['r1b', 2], ['r2', 3]]);
    expect(logo?.title).toBe('Title r1a');
    expect(logo?.latest.gate.name).toBe('r2');
    expect(topics).toHaveLength(2);
  });

  it('state: open, settled with pick, waiting for combined or none', () => {
    const open = topicsOf([gate('g', '2026-10-05T10:00:00Z')])[0];
    expect(open?.state).toBe('open');
    expect(open?.pick).toBeNull();
    const settled = topicsOf([gate('g', '2026-10-05T10:00:00Z', { choice: 'b' })])[0];
    expect(settled?.state).toBe('settled');
    expect(settled?.pick?.name).toBe('b');
    expect(topicsOf([gate('g', '2026-10-05T10:00:00Z', { choices: ['a', 'b'] })])[0]).toMatchObject({ state: 'waiting', pick: null });
    expect(topicsOf([gate('g', '2026-10-05T10:00:00Z', { none: true })])[0]).toMatchObject({ state: 'waiting', pick: null });
  });

  it('out of order: round 1 answered after round 2 opened, round 2 still open', () => {
    const t = topicsOf([
      gate('r2', '2026-10-05T11:00:00Z', null, { topic: 'x' }),
      gate('r1', '2026-10-05T10:00:00Z', { choice: 'a', submitted: '2026-10-05T11:30:00Z' }, { topic: 'x' }),
    ])[0];
    expect(t?.rounds.map((r) => r.gate.request.name)).toEqual(['r1', 'r2']);
    expect(t?.latest.gate.request.name).toBe('r2');
    expect(t?.state).toBe('open');
    expect(t?.rounds[0]?.outcome).toEqual({ kind: 'picked', choice: 'a' });
    expect(t?.answered).toBe('2026-10-05T11:30:00Z');
  });

  it('answered is the latest submitted, null when nothing is answered', () => {
    const t = topicsOf([
      gate('r1', '2026-10-05T10:00:00Z', { none: true, submitted: '2026-10-05T10:30:00Z' }, { topic: 'x' }),
      gate('r2', '2026-10-05T11:00:00Z', { choice: 'a', submitted: '2026-10-05T11:30:00Z' }, { topic: 'x' }),
    ])[0];
    expect(t?.answered).toBe('2026-10-05T11:30:00Z');
    expect(topicsOf([gate('g', '2026-10-05T10:00:00Z')])[0]?.answered).toBeNull();
  });

  it('orders topics by answered newest first, then unanswered by first opened', () => {
    const names = topicsOf([
      gate('late', '2026-10-05T08:00:00Z'),
      gate('old', '2026-10-05T07:00:00Z', { choice: 'a', submitted: '2026-10-05T09:00:00Z' }),
      gate('early', '2026-10-05T06:00:00Z'),
      gate('new', '2026-10-05T07:30:00Z', { choice: 'a', submitted: '2026-10-05T10:00:00Z' }),
    ]).map((t) => t.name);
    expect(names).toEqual(['new', 'old', 'early', 'late']);
  });

  it('a bare gate (no topic, no source) is a one-round topic named by the gate', () => {
    const t = topicsOf([gate('look', '2026-10-05T10:00:00Z')]);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ name: 'look', title: 'Title look' });
    expect(t[0]?.rounds).toHaveLength(1);
  });
});

describe('openRounds', () => {
  it('lists every open round, oldest opened first', () => {
    const topics = topicsOf([
      gate('b', '2026-10-05T11:00:00Z'),
      gate('a', '2026-10-05T09:00:00Z', null, { topic: 'x' }),
      gate('a2', '2026-10-05T10:00:00Z', { choice: 'a' }, { topic: 'x' }),
      gate('c', '2026-10-05T10:30:00Z'),
    ]);
    expect(openRounds(topics).map((r) => r.gate.name)).toEqual(['a', 'c', 'b']);
  });
});

describe('outcomeText', () => {
  it('words each outcome', () => {
    const at = (a: Partial<GateAnswers> | null) => outcomeText(roundOf(gate('g', '2026-10-05T10:00:00Z', a), 1));
    expect(at(null)).toBe('Waiting for you');
    expect(at({ choice: 'b' })).toBe('Picked B');
    expect(at({ choices: ['a', 'c'] })).toBe('Combined 2 of 3');
    expect(at({ none: true })).toBe('None of these');
  });
});
