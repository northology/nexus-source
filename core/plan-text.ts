import type { PlanEntry, PlanFile, PlanProgress, TaskProgress, TaskState } from './types.ts';

// No Node imports: the cockpit imports this file, so `nexus plan` and the Plan section read the same.

const STATE: Record<TaskState, string> = {
  pending: 'pending',
  'in-progress': 'in progress',
  'fix-round': 'fix round',
  done: 'done',
  incomplete: 'not completed',
  unknown: 'unknown',
};

export interface PlanSummary { text: string; when: { label: string; time: string } | null; notice: string | null; done: number; total: number }

/** A phase's plans, oldest first. */
export function plansOf(file: PlanFile | null, phase: string | null): PlanEntry[] {
  return (file?.plans ?? []).filter((p) => p.phase === phase);
}

/** A phase's current plan: its newest entry. */
export function currentPlanFor(file: PlanFile | null, phase: string | null): PlanEntry | null {
  return plansOf(file, phase).at(-1) ?? null;
}

/** A task's state as people read it: "done · 1 parked", "fix round 2 · 1 open". */
export function stateText(p: TaskProgress): string {
  if (p.state === 'done') return p.parked > 0 ? `done · ${p.parked} parked` : 'done';
  const last = p.fixRounds.at(-1);
  if (p.state === 'fix-round' && last) return `fix round ${last.round} · ${last.open} open`;
  return STATE[p.state];
}

/** "3 of 7 done · in progress: Renderer (fix round 2) · 3 pending", when it was read, and any notice (a replaced plan that never ran says so). Titles only. */
export function summarize(plan: PlanEntry, progress: PlanProgress | undefined, opts: { replaced?: boolean } = {}): PlanSummary {
  const states = plan.tasks.map((task) => ({ task, p: progress?.tasks[task.id] }));
  const count = (s: TaskState): number => states.filter((x) => (x.p?.state ?? 'pending') === s).length;
  const done = count('done');
  const total = plan.tasks.length;
  const parts = [`${done} of ${total} done`];
  const current = states.filter((x) => x.p?.state === 'in-progress' || x.p?.state === 'fix-round');
  if (current.length) {
    const named = current.map((x) => {
      const round = x.p?.state === 'fix-round' ? x.p.fixRounds.at(-1)?.round : undefined;
      return `${x.task.title}${round ? ` (fix round ${round})` : ''}`;
    });
    parts.push(`in progress: ${named.join(', ')}`);
  }
  const pending = count('pending');
  if (pending) parts.push(`${pending} pending`);
  const incomplete = count('incomplete');
  if (incomplete) parts.push(`${incomplete} not completed`);
  const source = progress?.source ?? 'none';
  if (source === 'none' && total > 0 && pending === total) parts.push('not started');
  const lost = source === 'none' && total > 0 && count('unknown') === total;
  const when = progress?.read && source === 'ledger' ? { label: 'ledger read', time: progress.read } : progress?.read && source === 'record' ? { label: 'record kept', time: progress.read } : null;
  const notice = source === 'none' && opts.replaced ? 'No progress was kept for this plan before it was replaced.' : lost ? "This run's ledger wasn't imported, so its progress wasn't kept." : null;
  return { text: parts.join(' · '), when, notice, done, total };
}
