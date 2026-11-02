import { currentPlanFor } from '../../../core/plan-text.ts';
import type { PlanEntry, PlanProgress, Snapshot, TaskProgress, TaskState } from '../../../core/types.ts';

export type PlanMode = 'list' | 'board';
export type Glyph = 'done' | 'fix' | 'cur' | 'pend' | 'unknown';
export type ColumnKey = 'pending' | 'in-progress' | 'fix-round' | 'done';

export const COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'in-progress', label: 'In progress' },
  { key: 'fix-round', label: 'Fix rounds' },
  { key: 'done', label: 'Done' },
];

const PENDING: TaskProgress = { state: 'pending', commits: null, note: null, parked: 0, fixRounds: [], parkedFindings: [], rulings: [], minors: [] };
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function planMode(v: string | undefined): PlanMode {
  return v === 'board' ? 'board' : 'list';
}

/** The plan asked for by ID among a phase's plans (oldest first), else the last: the phase's current plan. */
export function pickPlan(plans: PlanEntry[], id: string | undefined): PlanEntry | null {
  return plans.find((p) => p.id === id) ?? plans.at(-1) ?? null;
}

export function taskProgress(progress: PlanProgress | undefined, id: string): TaskProgress {
  return progress?.tasks[id] ?? PENDING;
}

export function glyphOf(s: TaskState): Glyph {
  if (s === 'done') return 'done';
  if (s === 'fix-round') return 'fix';
  if (s === 'in-progress') return 'cur';
  if (s === 'unknown') return 'unknown';
  return 'pend';
}

/** Not completed and unknown tasks sit in Pending: neither is moving. */
export function columnOf(s: TaskState): ColumnKey {
  if (s === 'done' || s === 'fix-round' || s === 'in-progress') return s;
  return 'pending';
}

/** Under a task's title in the list: its planned steps (the plan's size, not progress), and its fix rounds when it had any. */
export function stepsText(steps: number, p: TaskProgress): string {
  const parts = [`${plural(steps, 'step', 'steps')} planned`];
  if (p.fixRounds.length) parts.push(plural(p.fixRounds.length, 'fix round', 'fix rounds'));
  return parts.join(' · ');
}

/** A card's one line: commit head, fix rounds, rulings, parked; or its planned steps when nothing has happened yet. */
export function cardMeta(steps: number, p: TaskProgress): string {
  const parts: string[] = [];
  const head = p.commits?.split('..')[1];
  if (head) parts.push(head);
  if (p.fixRounds.length) parts.push(plural(p.fixRounds.length, 'fix round', 'fix rounds'));
  if (p.rulings.length) parts.push(plural(p.rulings.length, 'ruling', 'rulings'));
  if (p.parked) parts.push(`${p.parked} parked`);
  if (p.state === 'unknown') parts.push('unknown');
  if (p.state === 'incomplete') parts.push('not completed');
  if (!parts.length) parts.push(`${plural(steps, 'step', 'steps')} planned`);
  return parts.join(' · ');
}

/** The rail: done/total for the current phase's current plan, one cell per task; a dash without one. */
export function planRail(s: Snapshot): { count: string; cells: ('on' | 'off')[] } {
  const phase = s.build ? (s.build.phase ?? s.build.name) : null;
  const plan = currentPlanFor(s.plan, phase);
  if (!plan) return { count: '—', cells: [] };
  const states = plan.tasks.map((t) => taskProgress(s.planProgress[plan.id], t.id).state);
  return { count: `${states.filter((x) => x === 'done').length}/${plan.tasks.length}`, cells: states.map((x) => (x === 'done' ? 'on' : 'off')) };
}

/**
 * Whether opening a task should move focus to it. The task the address opened (a deep link) scrolls into view but
 * leaves focus alone; once the open task changes, it was a click, and focus follows. Asking twice for the same task
 * gives the same answer, so React's double-run effects in development don't count as a click.
 */
export function linkFocus(fromAddress: string | undefined): (open: string | undefined) => boolean {
  let linked = fromAddress;
  return (open) => {
    if (open !== linked) linked = undefined;
    return open !== undefined && open !== linked;
  };
}
