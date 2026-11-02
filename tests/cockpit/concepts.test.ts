import { describe, it, expect } from 'vitest';
import { topicsOf } from '../../core/concept-text.ts';
import type { FileEntry, GateAnswers, GateRequest, GateView } from '../../core/types.ts';
import { ALL_PHASES } from '../../cockpit/src/lib/phases.ts';
import type { LogEntry, Snapshot } from '../../core/types.ts';
import { chosenInPhase, chosenTopics, refinementsOf, conceptTab, roundsInPhase, topicsInPhase, unusedPages } from '../../cockpit/src/lib/concepts.ts';

const gate = (name: string, opened: string, answers: Partial<GateAnswers> | null = null, extra: Partial<GateRequest> = {}): GateView => ({
  name,
  request: {
    name,
    type: 'concept-pick',
    title: `Title ${name}`,
    why: 'why',
    opened,
    options: [
      { name: 'a', label: 'A', page: `concepts/${name}/a.html` },
      { name: 'b', label: 'B', page: `concepts/${name}/b.html` },
    ],
    ...extra,
  },
  answers: answers ? { gate: name, submitted: '2026-10-05T12:00:00Z', ...answers } : null,
  read: null,
});
const file = (path: string): FileEntry => ({ path, size: 1, modified: '2026-10-05T10:00:00Z' });
const names = (topics: { name: string }[]) => topics.map((t) => t.name);

describe('conceptTab', () => {
  it('reads proposed and chosen, and falls back to proposed', () => {
    expect(conceptTab('chosen')).toBe('chosen');
    expect(conceptTab('proposed')).toBe('proposed');
    expect(conceptTab(null)).toBe('proposed');
    expect(conceptTab('nonsense')).toBe('proposed');
  });
});

describe('topicsInPhase', () => {
  const topics = topicsOf([
    gate('logo-1', '2026-10-05T10:00:00Z', { choice: 'a' }, { topic: 'logo', phase: 'replay' }),
    gate('legend-1', '2026-10-05T10:01:00Z', null, { topic: 'legend', phase: 'dashboard' }),
    gate('old', '2026-10-05T10:02:00Z', { choice: 'b' }),
    gate('board-1', '2026-10-05T10:03:00Z', { none: true, note: 'no' }, { topic: 'board', phase: 'dashboard' }),
  ]);
  it('keeps every topic when no phase is selected', () => {
    expect(names(topicsInPhase(topics, null)).sort()).toEqual(['board', 'legend', 'logo', 'old']);
  });
  it('keeps topics with a round in the phase, rounds with no phase, and an open round in any phase', () => {
    expect(names(topicsInPhase(topics, 'replay')).sort()).toEqual(['legend', 'logo', 'old']);
  });
});

describe('roundsInPhase', () => {
  const [topic] = topicsOf([
    gate('look-1', '2026-10-05T10:00:00Z', { none: true, note: 'cold' }, { topic: 'look', phase: 'design' }),
    gate('look-2', '2026-10-05T10:01:00Z', { choices: ['a', 'b'] }, { topic: 'look', phase: 'replay' }),
    gate('look-3', '2026-10-05T10:02:00Z', { choice: 'b' }, { topic: 'look', phase: 'replay' }),
  ]);
  it('keeps the rounds in the phase, numbered as in the whole topic', () => {
    if (!topic) throw new Error('no topic');
    expect(roundsInPhase(topic, 'replay').map((r) => [r.gate.name, r.number])).toEqual([
      ['look-2', 2],
      ['look-3', 3],
    ]);
    expect(roundsInPhase(topic, 'design').map((r) => r.gate.name)).toEqual(['look-1']);
    expect(roundsInPhase(topic, null)).toHaveLength(3);
  });
});

describe('chosenTopics', () => {
  it('keeps topics with an answered round, in topicsOf order, and drops a topic with only an open round', () => {
    const topics = topicsOf([
      gate('a-1', '2026-10-05T10:00:00Z', { choice: 'a', submitted: '2026-10-05T11:00:00Z' }, { topic: 'a' }),
      gate('b-1', '2026-10-05T10:01:00Z', null, { topic: 'b' }),
      gate('c-1', '2026-10-05T10:02:00Z', { none: true, note: 'no', submitted: '2026-10-05T12:00:00Z' }, { topic: 'c' }),
      gate('c-2', '2026-10-05T10:03:00Z', null, { topic: 'c' }),
    ]);
    expect(names(chosenTopics(topics))).toEqual(['c', 'a']);
  });
});

describe('chosenInPhase', () => {
  const entry = (name: string, topic: string, phase?: string): LogEntry => ({ name, text: name, status: 'applied', source: 'live 14:02', time: '2026-10-05T13:00:00Z', topic, ...(phase ? { phase } : {}) });
  const topics = topicsOf([
    gate('look-1', '2026-10-05T10:00:00Z', { choice: 'a' }, { topic: 'look', phase: 'replay' }),
    gate('logo-1', '2026-10-05T10:01:00Z', { choice: 'b' }, { topic: 'logo', phase: 'replay' }),
    gate('board-1', '2026-10-05T10:02:00Z', null, { topic: 'board', phase: 'dashboard' }),
  ]);
  const logs = (...changes: LogEntry[]) => ({ decisions: [], changes, issues: [], questions: [], guardrails: [] }) as unknown as Snapshot['logs'];
  it('keeps an answered topic under a phase it has rounds in', () => {
    expect(names(chosenInPhase(topics, logs(), 'replay')).sort()).toEqual(['logo', 'look']);
  });
  it('keeps an answered topic under a later phase it was refined in, and not under one it has neither in', () => {
    const refined = logs(entry('warmer', 'look', 'dashboard'));
    expect(names(chosenInPhase(topics, refined, 'dashboard'))).toEqual(['look']);
    expect(names(chosenInPhase(topics, refined, 'polish'))).toEqual([]);
  });
  it('counts a refinement with no phase under every phase, as rounds with none are', () => {
    expect(names(chosenInPhase(topics, logs(entry('older', 'logo')), 'polish'))).toEqual(['logo']);
  });
  it('never keeps a topic with only an open round, however it is refined', () => {
    expect(names(chosenInPhase(topics, logs(entry('early', 'board', 'dashboard')), 'dashboard'))).toEqual([]);
  });
});

describe('unusedPages', () => {
  it('returns the .html pages no gate option uses', () => {
    const gates = [gate('look', '2026-10-05T10:00:00Z')];
    const pages = [file('concepts/look/a.html'), file('concepts/look/b.html'), file('concepts/scratch.html'), file('concepts/look/notes.md'), file('concepts/logo.png')];
    expect(unusedPages(pages, gates).map((f) => f.path)).toEqual(['concepts/scratch.html']);
  });
});

describe('refinementsOf', () => {
  const entry = (name: string, time: string, extra: Partial<LogEntry> = {}): LogEntry => ({ name, text: `Text ${name}`, status: 'applied', source: 'live 14:02', time, ...extra });
  const logs = {
    decisions: [entry('d1', '2026-10-05T12:00:00Z', { topic: 'look', phase: 'replay' }), entry('d2', '2026-10-05T10:00:00Z', { topic: 'other', phase: 'replay' })],
    changes: [entry('c2', '2026-10-05T14:00:00Z', { topic: 'look', phase: 'design' }), entry('c1', '2026-10-05T09:00:00Z', { topic: 'look' }), entry('c3', '2026-10-05T08:00:00Z')],
    issues: [],
    questions: [],
    guardrails: [],
  } as unknown as Snapshot['logs'];
  const ids = (phase: string | null) => refinementsOf(logs, 'look', phase).map((r) => `${r.log}:${r.entry.name}`);
  it('orders by the moment, not the text, when times carry different offsets', () => {
    const mixed = {
      ...logs,
      changes: [entry('mdt', '2026-10-06T09:00:00-06:00', { topic: 'look' }), entry('utc', '2026-10-06T10:00:00Z', { topic: 'look' })],
      decisions: [],
    } as unknown as Snapshot['logs'];
    // 10:00Z is 04:00 MDT, five hours before 09:00 MDT; sorted as text it would come second.
    expect(refinementsOf(mixed, 'look', null).map((r) => r.entry.name)).toEqual(['utc', 'mdt']);
  });
  it('takes entries of any log with the topic, oldest first, counting an entry with no phase in every phase', () => {
    expect(ids('replay')).toEqual(['changes:c1', 'decisions:d1']);
    expect(ids('design')).toEqual(['changes:c1', 'changes:c2']);
  });
  it('takes all of them for every phase', () => {
    expect(ids(null)).toEqual(['changes:c1', 'decisions:d1', 'changes:c2']);
    expect(ALL_PHASES).toBe('all');
  });
  it('is empty for a topic nothing is tagged with', () => expect(refinementsOf(logs, 'none', null)).toEqual([]));
});
