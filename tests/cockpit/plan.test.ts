import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { plansOf } from '../../core/plan-text.ts';
import { COLUMNS, cardMeta, columnOf, glyphOf, linkFocus, pickPlan, planMode, planRail, stepsText, taskProgress } from '../../cockpit/src/lib/plan.ts';
import { readSnapshot } from '../../core/snapshot.ts';
import type { PlanEntry, TaskProgress, TaskState } from '../../core/types.ts';
import { exampleRepo, planRepo } from '../helpers.ts';

const p = (state: TaskState, extra: Partial<TaskProgress> = {}): TaskProgress => ({ state, commits: null, note: null, parked: 0, fixRounds: [], parkedFindings: [], rulings: [], minors: [], ...extra });
const entry = (id: string, phase: string): PlanEntry => ({ id, phase, gate: `plan-${phase}`, document: 'documents/plans/p.md', title: 'Plan', indexed: '2026-10-02T19:33:00Z', tasks: [], record: null });

describe('plan helpers', () => {
  it('reads the mode from the URL, list by default', () => {
    expect(planMode(undefined)).toBe('list');
    expect(planMode('board')).toBe('board');
    expect(planMode('grid')).toBe('list');
  });
  it("picks the phase's newest plan, or one asked for by ID", () => {
    const older = entry('p-00000000', 'replay');
    const newer = entry('p-00000001', 'replay');
    const plans = plansOf({ plans: [older, newer, entry('p-00000002', 'dashboard')] }, 'replay');
    expect(plans.map((x) => x.id)).toEqual(['p-00000000', 'p-00000001']);
    const file = { plans: [older, newer, entry('p-00000002', 'dashboard')] };
    expect(pickPlan(plansOf(file, 'replay'), undefined)?.id).toBe('p-00000001');
    expect(pickPlan(plansOf(file, 'replay'), 'p-00000000')?.id).toBe('p-00000000');
    expect(pickPlan(plansOf(file, 'replay'), 'p-99999999')?.id).toBe('p-00000001');
    expect(pickPlan(plansOf(file, 'replay'), 'p-00000002')?.id).toBe('p-00000001');
    expect(pickPlan(plansOf(file, 'other'), undefined)).toBeNull();
    expect(pickPlan(plansOf(null, 'replay'), undefined)).toBeNull();
  });
  it('a task with no progress reads as pending', () => {
    expect(taskProgress(undefined, 't-00000001').state).toBe('pending');
  });
  it('draws each state with its own glyph, and files it in a board column', () => {
    expect((['done', 'fix-round', 'in-progress', 'pending', 'incomplete', 'unknown'] as TaskState[]).map(glyphOf)).toEqual(['done', 'fix', 'cur', 'pend', 'pend', 'unknown']);
    expect(COLUMNS.map((c) => c.label)).toEqual(['Pending', 'In progress', 'Fix rounds', 'Done']);
    expect((['done', 'fix-round', 'in-progress', 'pending', 'incomplete', 'unknown'] as TaskState[]).map(columnOf)).toEqual(['done', 'fix-round', 'in-progress', 'pending', 'pending', 'pending']);
  });
  it('writes the small lines under a title and on a card', () => {
    expect(stepsText(5, p('pending'))).toBe('5 steps planned');
    expect(stepsText(1, p('done', { fixRounds: [{ round: 1, addressed: 1, open: 0, findings: null, commits: null }] }))).toBe('1 step planned · 1 fix round');
    expect(cardMeta(4, p('pending'))).toBe('4 steps planned');
    expect(cardMeta(4, p('done', { commits: '58461c3..49f5b27', rulings: ['a', 'b'], parked: 1 }))).toBe('49f5b27 · 2 rulings · 1 parked');
    expect(cardMeta(4, p('unknown'))).toBe('unknown');
    expect(cardMeta(4, p('incomplete'))).toBe('not completed');
  });
});

describe('planRail', () => {
  it('the rail shows a dash without a plan', () => {
    expect(planRail(readSnapshot(exampleRepo(), 'relay-rebuild'))).toEqual({ count: '—', cells: [] });
  });
  it('counts done tasks of the current plan, one cell per task', () => {
    const root = planRepo();
    const dir = join(root, '.superpowers', 'sdd', 'splash-plan');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'progress.md'), '# SDD ledger — plan: .build/relay-rebuild/documents/plans/replay/splash-plan.md\nTask 1: complete (commits 58461c3..49f5b27, review clean)\nTask 2: complete (commits 49f5b27..a95dc13, review clean)\n');
    expect(planRail(readSnapshot(root, 'relay-rebuild'))).toEqual({ count: '2/7', cells: ['on', 'on', 'off', 'off', 'off', 'off', 'off'] });
  });
  it('lights a cell only for a done task, not a fix round, one in progress or one pending', () => {
    const root = planRepo();
    const dir = join(root, '.superpowers', 'sdd', 'splash-plan');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'progress.md'), '# SDD ledger — plan: .build/relay-rebuild/documents/plans/replay/splash-plan.md\nTask 1: complete (commits 58461c3..49f5b27, review clean)\nTask 2: fix round 1/5 (0 addressed, 1 open — x)\nTask 3: Ruling: points drawn as squares — cheaper per frame — one draw call changes\n');
    const s = readSnapshot(root, 'relay-rebuild');
    const plan = s.plan?.plans?.[0];
    expect(plan?.tasks.slice(0, 4).map((t) => s.planProgress[plan.id]?.tasks[t.id]?.state)).toEqual(['done', 'fix-round', 'in-progress', 'pending']);
    expect(planRail(s)).toEqual({ count: '1/7', cells: ['on', 'off', 'off', 'off', 'off', 'off', 'off'] });
  });
});

describe('linkFocus', () => {
  it('leaves focus alone for the task the address opened, even when the effect runs twice (StrictMode)', () => {
    const focus = linkFocus('t-1');
    expect(focus('t-1')).toBe(false);
    expect(focus('t-1')).toBe(false);
  });
  it('moves focus once the open task changes by a click', () => {
    const focus = linkFocus('t-1');
    expect(focus('t-1')).toBe(false);
    expect(focus('t-2')).toBe(true);
    expect(focus(undefined)).toBe(false);
    expect(focus('t-1')).toBe(true);
  });
  it('moves focus on a click when nothing was opened from the address', () => {
    const focus = linkFocus(undefined);
    expect(focus(undefined)).toBe(false);
    expect(focus('t-3')).toBe(true);
  });
});
