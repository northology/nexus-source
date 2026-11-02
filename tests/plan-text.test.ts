import { describe, it, expect } from 'vitest';
import { currentPlanFor, plansOf, stateText, summarize } from '../core/plan-text.ts';
import type { PlanEntry, PlanProgress, TaskProgress, TaskState } from '../core/types.ts';

const task = (n: number, title: string) => ({ id: `t-0000000${n}`, number: n, title, steps: 5 });
const PLAN: PlanEntry = { id: 'p-00000001', phase: 'replay', gate: 'plan-replay', document: 'documents/plans/replay/p.md', title: 'Replay plan', indexed: '2026-10-02T19:33:00Z', tasks: [task(1, 'Retry policy'), task(2, 'Replay queue'), task(3, 'Lag per source'), task(4, 'Replay screen')], record: null };
const p = (state: TaskState, extra: Partial<TaskProgress> = {}): TaskProgress => ({ state, commits: null, note: null, parked: 0, fixRounds: [], parkedFindings: [], rulings: [], minors: [], ...extra });
const progress = (states: TaskProgress[], source: PlanProgress['source'] = 'ledger', read: string | null = '2026-10-02T20:41:00Z'): PlanProgress => ({
  source,
  read,
  ledger: source === 'none' ? null : '.superpowers/sdd/p/progress.md',
  tasks: Object.fromEntries(PLAN.tasks.map((t, i) => [t.id, states[i] ?? p('pending')])),
  final: { rulings: [], minors: [] },
});
const round = { round: 2, addressed: 0, open: 1, findings: null, commits: null };

describe('stateText', () => {
  it('reads as people say it', () => {
    expect(stateText(p('done'))).toBe('done');
    expect(stateText(p('done', { parked: 1 }))).toBe('done · 1 parked');
    expect(stateText(p('fix-round', { fixRounds: [round] }))).toBe('fix round 2 · 1 open');
    expect(stateText(p('in-progress'))).toBe('in progress');
    expect(stateText(p('incomplete'))).toBe('not completed');
    expect(stateText(p('unknown'))).toBe('unknown');
  });
});

describe('summarize', () => {
  it('counts tasks and names the one in progress by title', () => {
    const s = summarize(PLAN, progress([p('done'), p('done'), p('fix-round', { fixRounds: [round] })]));
    expect(s).toEqual({ text: '2 of 4 done · in progress: Lag per source (fix round 2) · 1 pending', when: { label: 'ledger read', time: '2026-10-02T20:41:00Z' }, notice: null, done: 2, total: 4 });
  });
  it('says when the record was kept, and counts what was not completed', () => {
    const s = summarize(PLAN, progress([p('done'), p('done'), p('incomplete'), p('incomplete')], 'record', '2026-10-02T21:00:00Z'));
    expect(s.text).toBe('2 of 4 done · 2 not completed');
    expect(s.when).toEqual({ label: 'record kept', time: '2026-10-02T21:00:00Z' });
  });
  it('says not started before a run, and explains progress that was never kept', () => {
    expect(summarize(PLAN, progress([], 'none', null)).text).toBe('0 of 4 done · 4 pending · not started');
    const lost = summarize(PLAN, progress([p('unknown'), p('unknown'), p('unknown'), p('unknown')], 'none', null));
    expect(lost.notice).toBe("This run's ledger wasn't imported, so its progress wasn't kept.");
    expect(lost.when).toBeNull();
  });
  it('says a replaced plan that never ran kept no progress', () => {
    const none = progress([], 'none', null);
    expect(summarize(PLAN, none, { replaced: true }).notice).toBe('No progress was kept for this plan before it was replaced.');
    expect(summarize(PLAN, none).notice).toBeNull();
    expect(summarize(PLAN, progress([p('done')]), { replaced: true }).notice).toBeNull();
  });
  it('names every active task, in plan order', () => {
    const s = summarize(PLAN, progress([p('done'), p('fix-round', { fixRounds: [round] }), p('in-progress')]));
    expect(s.text).toBe('1 of 4 done · in progress: Replay queue (fix round 2), Lag per source · 1 pending');
  });
  it('never shows a task number', () => {
    const s = summarize(PLAN, progress([p('done'), p('in-progress')]));
    expect(s.text).not.toMatch(/Task \d/);
    expect(s.text).toContain('in progress: Replay queue');
  });
});

describe('plansOf', () => {
  it("is the phase's plans, oldest first", () => {
    const older = { ...PLAN, id: 'p-00000000', gate: 'plan-replay-old' };
    const other = { ...PLAN, id: 'p-00000002', phase: 'dashboard' };
    expect(plansOf({ plans: [older, PLAN, other] }, 'replay').map((p) => p.id)).toEqual(['p-00000000', 'p-00000001']);
    expect(plansOf({ plans: [PLAN] }, 'dashboard')).toEqual([]);
    expect(plansOf(null, 'replay')).toEqual([]);
  });
});

describe('currentPlanFor', () => {
  it("is the phase's newest plan, or null", () => {
    const older = { ...PLAN, id: 'p-00000000', gate: 'plan-replay-old' };
    expect(currentPlanFor({ plans: [older, PLAN] }, 'replay')?.id).toBe('p-00000001');
    expect(currentPlanFor({ plans: [PLAN] }, 'dashboard')).toBeNull();
    expect(currentPlanFor({}, 'replay')).toBeNull();
    expect(currentPlanFor(null, 'replay')).toBeNull();
  });
});
