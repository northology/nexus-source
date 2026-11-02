import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { validate } from '../core/schemas.ts';
import { LOG_NAMES, LOG_STATUSES, SCHEMA_FILES } from '../core/schema-files.ts';
import { NAME_PATTERN } from '../core/names.ts';
import { EXAMPLES, readJsonFile } from './helpers.ts';

const EX = join(EXAMPLES, '.build', 'relay-rebuild');

describe('example build', () => {
  it('build.json is valid', () => expect(validate('build', readJsonFile(join(EX, 'build.json')))).toEqual([]));
  it.each(LOG_NAMES)('logs/%s.json is valid', (log) => {
    expect(validate(log, readJsonFile(join(EX, 'logs', `${log}.json`)))).toEqual([]);
  });
  it('every gate file is valid', () => {
    const files = readdirSync(join(EX, 'gates')).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const f of files) {
      const kind = f.endsWith('.answers.json') ? 'gate-answers' : 'gate-request';
      expect(validate(kind, readJsonFile(join(EX, 'gates', f))), f).toEqual([]);
    }
  });
  it('plan.json is valid', () => expect(validate('plan', readJsonFile(join(EX, 'plan.json')))).toEqual([]));
});

describe('log entry topic', () => {
  const entry = { name: 'tweak-legend', text: 'x', status: 'applied', source: 'live 14:02', time: '2026-10-02T11:20:00-06:00' };
  it('accepts a concept topic, and entries without one', () => {
    expect(validate('changes', { entries: [{ ...entry, topic: 'status-look' }] })).toEqual([]);
    expect(validate('changes', { entries: [entry] })).toEqual([]);
  });
  it('rejects a topic that is not a name', () => {
    expect(validate('changes', { entries: [{ ...entry, topic: 'Bad Name' }] })).not.toEqual([]);
  });
});

describe('schemas reject bad input', () => {
  it('a guardrail without raisedBy', () => {
    const entry = { name: 'no-new-calls', text: 'x', status: 'proposed', source: 'chat', time: '2026-10-02T11:20:00-06:00' };
    expect(validate('guardrails', { entries: [entry] }).join(' ')).toMatch(/raisedBy/);
  });
  it('a guardrail stored as accepted', () => {
    const entry = { name: 'no-new-calls', text: 'x', status: 'accepted', source: 'chat', raisedBy: 'claude', time: '2026-10-02T11:20:00-06:00' };
    expect(validate('guardrails', { entries: [entry] }).join(' ')).toMatch(/proposed, withdrawn/);
  });
  const build = () => readJsonFile(join(EX, 'build.json')) as Record<string, unknown>;
  const scope = () => readJsonFile(join(EX, 'gates', 'scope.json')) as Record<string, unknown>;

  it('a gate request without a type, naming only that', () => {
    const { type: _type, ...untyped } = scope();
    expect(validate('gate-request', untyped)).toEqual(["(top level) must have required property 'type'"]);
  });
  it('an unknown stage, listing the allowed values', () => {
    const errors = validate('build', { ...build(), stage: 'done' });
    expect(errors.join(' ')).toMatch(/planning, plan, build, close-out/);
  });
  it('an unknown field', () => {
    expect(validate('build', { ...build(), owner: 'x' }).join(' ')).toMatch(/owner/);
  });
  it('a coded name', () => {
    expect(validate('build', { ...build(), name: 'd01' })).not.toEqual([]);
  });
  it('a decision status that belongs to another log', () => {
    const entry = { name: 'replay-window', text: 'x', status: 'open', source: 'chat', time: '2026-10-02T11:20:00-06:00' };
    expect(validate('decisions', { entries: [entry] })).not.toEqual([]);
  });
  it('a time without an offset', () => {
    expect(validate('build', { ...build(), created: '2026-10-02T11:05:00' })).not.toEqual([]);
  });
  it('a mark-list gate without items', () => {
    const { items: _items, ...rest } = scope();
    expect(validate('gate-request', rest)).not.toEqual([]);
  });
  it('a mark-list row with an empty conflicts list', () => {
    const base = scope() as { items: Record<string, unknown>[] };
    const [first = {}, ...rest] = base.items;
    expect(validate('gate-request', { ...base, items: [{ ...first, conflicts: ['no-new-calls'] }, ...rest] })).toEqual([]);
    expect(validate('gate-request', { ...base, items: [{ ...first, conflicts: [] }, ...rest] })).not.toEqual([]);
  });
  it('a phase without phases, and phases without a phase', () => {
    const { phase, phases, ...old } = build();
    expect(phase).toBeDefined();
    expect(phases).toBeDefined();
    expect(validate('build', { ...old, phase })).not.toEqual([]);
    expect(validate('build', { ...old, phases })).not.toEqual([]);
    expect(validate('build', { ...old, phase, phases })).toEqual([]);
  });
  it('a mark-list gate that also has options', () => {
    const options = [{ name: 'one-way', label: 'A', page: 'concepts/a.html' }, { name: 'two-way', label: 'B', page: 'concepts/b.html' }];
    expect(validate('gate-request', { ...scope(), options })).not.toEqual([]);
  });
  it('a concept page outside concepts/ or climbing out', () => {
    const base = readJsonFile(join(EX, 'gates', 'look.json')) as { options: { page: string }[] };
    for (const page of ['../build.json', 'concepts/../build.html', 'notes/x.html', 'concepts\\x.html']) {
      const options = base.options.map((o) => ({ ...o, page }));
      expect(validate('gate-request', { ...base, options }), page).not.toEqual([]);
    }
  });
  it('answers with both marks and a choice', () => {
    expect(validate('gate-answers', { gate: 'scope', submitted: '2026-10-02T11:55:00-06:00', marks: {}, choice: 'quiet-board' })).not.toEqual([]);
  });
  describe('concept rounds', () => {
    const look = () => readJsonFile(join(EX, 'gates', 'look.json')) as { options: Record<string, unknown>[] };
    const sub = '2026-10-02T11:55:00-06:00';
    it('accepts a topic and option sources on a concept-pick', () => {
      const base = look();
      const options = base.options.map((o) => ({ ...o, source: 'impeccable' }));
      expect(validate('gate-request', { ...base, topic: 'status-look', options })).toEqual([]);
    });
    it('rejects a topic on a mark-list or approve request', () => {
      const approve = { name: 'approve-ok', type: 'approve', title: 'T', why: 'W', opened: sub };
      expect(validate('gate-request', approve)).toEqual([]);
      expect(validate('gate-request', { ...approve, topic: 'status-look' })).not.toEqual([]);
      expect(validate('gate-request', { ...scope(), topic: 'status-look' })).not.toEqual([]);
    });
    it('rejects an unknown option source and a topic that is not a name', () => {
      const base = look();
      expect(validate('gate-request', { ...base, options: base.options.map((o) => ({ ...o, source: 'figma' })) })).not.toEqual([]);
      expect(validate('gate-request', { ...base, topic: 'Status Look' })).not.toEqual([]);
    });
    it('accepts choices and none answers', () => {
      expect(validate('gate-answers', { gate: 'look', submitted: sub, choices: ['quiet-board', 'dense-table'] })).toEqual([]);
      expect(validate('gate-answers', { gate: 'look', submitted: sub, none: true, note: 'too cold' })).toEqual([]);
    });
    it('rejects short, repeated or false combine answers', () => {
      expect(validate('gate-answers', { gate: 'look', submitted: sub, choices: ['quiet-board'] })).not.toEqual([]);
      expect(validate('gate-answers', { gate: 'look', submitted: sub, choices: ['quiet-board', 'quiet-board'] })).not.toEqual([]);
      expect(validate('gate-answers', { gate: 'look', submitted: sub, none: false })).not.toEqual([]);
    });
    it('needs exactly one answer', () => {
      expect(validate('gate-answers', { gate: 'look', submitted: sub, choice: 'quiet-board', none: true })).not.toEqual([]);
      expect(validate('gate-answers', { gate: 'look', submitted: sub, choice: 'quiet-board', choices: ['quiet-board', 'dense-table'] })).not.toEqual([]);
    });
  });
  it('answers with an unknown mark', () => {
    expect(validate('gate-answers', { gate: 'scope', submitted: '2026-10-02T11:55:00-06:00', marks: { 'replay-window': 'maybe' } })).not.toEqual([]);
  });
});

describe('plan.json', () => {
  const task = { id: 't-9c2e7b10', number: 1, title: 'Timeline', steps: 5 };
  const entry = {
    id: 'p-3f9a1c2e',
    phase: 'replay',
    gate: 'plan-replay',
    document: 'documents/plans/replay/splash-plan.md',
    title: 'Splash Page Implementation Plan',
    indexed: '2026-10-04T18:48:30Z',
    tasks: [task],
    record: null,
  };
  it('accepts an empty file and an indexed plan', () => {
    expect(validate('plan', {})).toEqual([]);
    expect(validate('plan', { plans: [entry] })).toEqual([]);
  });
  it('accepts a kept record', () => {
    const record = {
      imported: '2026-10-04T19:12:40Z',
      ledger: '.superpowers/sdd/splash-plan/progress.md',
      tasks: { 't-9c2e7b10': { state: 'done', commits: '58461c3..49f5b27', parked: 0, fixRounds: [{ round: 1, addressed: 2, open: 0, findings: null, commits: 'a95dc13..b1c2d3e' }] } },
      final: { rulings: 1, minors: 0 },
    };
    expect(validate('plan', { plans: [{ ...entry, record }] })).toEqual([]);
  });
  it('accepts a kept task note that is a string or null, and refuses any other', () => {
    const rec = (note: unknown) => ({ imported: '2026-10-04T19:12:40Z', ledger: 'x', tasks: { 't-9c2e7b10': { state: 'done', commits: null, note, parked: 0, fixRounds: [] } }, final: { rulings: 0, minors: 0 } });
    expect(validate('plan', { plans: [{ ...entry, record: rec('review clean') }] })).toEqual([]);
    expect(validate('plan', { plans: [{ ...entry, record: rec(null) }] })).toEqual([]);
    expect(validate('plan', { plans: [{ ...entry, record: rec(3) }] }).length).toBeGreaterThan(0);
  });
  it('refuses a kept task keyed by a readable ID', () => {
    const rec = (tasks: Record<string, unknown>) => ({ imported: '2026-10-04T19:12:40Z', ledger: 'x', tasks, final: { rulings: 0, minors: 0 } });
    const kept = { state: 'done', commits: null, parked: 0, fixRounds: [] };
    expect(validate('plan', { plans: [{ ...entry, record: rec({ 't-9c2e7b10': kept }) }] })).toEqual([]);
    expect(validate('plan', { plans: [{ ...entry, record: rec({ 't-timeline': kept }) }] }).length).toBeGreaterThan(0);
  });
  it('refuses a fix round without open', () => {
    const round = { round: 1, addressed: 2, findings: null, commits: null };
    const record = { imported: '2026-10-04T19:12:40Z', ledger: 'x', tasks: { 't-9c2e7b10': { state: 'done', commits: null, parked: 0, fixRounds: [round] } }, final: { rulings: 0, minors: 0 } };
    expect(validate('plan', { plans: [{ ...entry, record }] }).join(' ')).toMatch(/open/);
  });
  it('refuses a task numbered below 1 or with negative steps, and accepts a task with no steps', () => {
    expect(validate('plan', { plans: [{ ...entry, tasks: [{ ...task, number: 0 }] }] }).join(' ')).toMatch(/number/);
    expect(validate('plan', { plans: [{ ...entry, tasks: [{ ...task, steps: -1 }] }] }).join(' ')).toMatch(/steps/);
    expect(validate('plan', { plans: [{ ...entry, tasks: [{ ...task, steps: 0 }] }] })).toEqual([]);
  });
  it('refuses readable IDs, unknown task states and unknown fields', () => {
    expect(validate('plan', { plans: [{ ...entry, id: 'timeline' }] }).length).toBeGreaterThan(0);
    expect(validate('plan', { plans: [{ ...entry, tasks: [{ ...task, id: 't-timeline' }] }] }).length).toBeGreaterThan(0);
    const badRecord = { imported: '2026-10-04T19:12:40Z', ledger: 'x', tasks: { 't-9c2e7b10': { state: 'pending', commits: null, parked: 0, fixRounds: [] } }, final: { rulings: 0, minors: 0 } };
    expect(validate('plan', { plans: [{ ...entry, record: badRecord }] }).length).toBeGreaterThan(0);
    expect(validate('plan', { plans: [entry], extra: 1 }).length).toBeGreaterThan(0);
  });
});

describe('log entries', () => {
  it('may carry the plan task they came from', () => {
    const e = { name: 'ruling-squares', text: 'Points drawn as squares', status: 'accepted', source: 'ruling · Task 3', time: '2026-10-04T19:12:40Z', task: 't-9c2e7b10' };
    expect(validate('decisions', { entries: [e] })).toEqual([]);
    expect(validate('decisions', { entries: [{ ...e, task: 'Task 3' }] }).length).toBeGreaterThan(0);
  });
});

describe('single sources of truth', () => {
  it('the name pattern in the schema matches the code', () => {
    expect(SCHEMA_FILES.defs.definitions.name.pattern).toBe(NAME_PATTERN);
  });
  it('log statuses come from the schemas', () => {
    expect(LOG_STATUSES).toEqual({
      decisions: ['accepted', 'declined'],
      issues: ['open', 'addressed', 'closed'],
      changes: ['applied', 'reverted'],
      questions: ['exploring', 'research', 'answered'],
      guardrails: ['proposed', 'withdrawn'],
    });
  });
});
