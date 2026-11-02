import { openRounds, topicsOf } from '../../../core/concept-text.ts';
import type { Snapshot } from '../../../core/types.ts';
import { gateState, orderGates } from './gates.ts';
import { planRail } from './plan.ts';
import type { Category } from './route.ts';

export type Cell = 'on' | 'off' | 'need';

export interface RailItem {
  category: Category;
  /** A repo section; build sections have none. */
  sub?: string;
  label: string;
  count: string;
  needs: boolean;
  cells: Cell[];
}

export const MAX_CELLS = 12;
const cap = (cells: Cell[]): Cell[] => cells.slice(0, MAX_CELLS);

export function railItems(s: Snapshot): RailItem[] {
  const gates = orderGates(s.gates);
  const open = gates.filter((g) => gateState(g) === 'open');
  const openQuestions = s.logs.questions.filter((e) => e.status === 'exploring' || e.status === 'research');
  const openIssues = s.logs.issues.filter((e) => e.status === 'open');
  const openEntries = new Set([...openQuestions, ...openIssues]);
  const entries = [...s.logs.decisions, ...s.logs.issues, ...s.logs.changes, ...s.logs.questions];
  const docs = [...s.files.documents, ...s.files.notes];
  const review = new Set(open.map((g) => g.request.document).filter((d): d is string => typeof d === 'string'));
  const plan = planRail(s);
  const attached = docs.filter((f) => review.has(f.path)).length;
  const topics = topicsOf(s.gates);
  return [
    { category: 'gate', label: 'Gate', count: String(open.length), needs: open.length > 0, cells: cap(gates.map((g): Cell => (gateState(g) === 'open' ? 'need' : 'on'))) },
    { category: 'plan', label: 'Plan', count: plan.count, needs: false, cells: cap(plan.cells) },
    { category: 'phases', label: 'Phases', count: s.phases?.length ? String(s.phases.length) : '—', needs: false, cells: cap((s.phases ?? []).map((): Cell => 'on')) },
    { category: 'logs', label: 'Logs', count: String(openEntries.size), needs: false, cells: cap(entries.map((e): Cell => (openEntries.has(e) ? 'on' : 'off'))) },
    { category: 'concepts', label: 'Concepts', count: String(topics.length), needs: openRounds(topics).length > 0, cells: cap(topics.map((t): Cell => (t.rounds.some((r) => r.outcome.kind === 'open') ? 'need' : 'on'))) },
    { category: 'documents', label: 'Documents', count: String(attached > 0 ? attached : docs.length), needs: attached > 0, cells: cap(docs.map((f): Cell => (review.has(f.path) ? 'need' : 'on'))) },
    GUIDANCE_ITEM,
  ];
}

/** Guidance reads no build, so it has nothing to count; it is also the whole rail when no build is ready. */
export const GUIDANCE_ITEM: RailItem = { category: 'guidance', label: 'Guidance', count: '', needs: false, cells: [] };

/** The most recent time anything in the build was written: entries, gates, answers and files. */
export function lastWrite(s: Snapshot): string | null {
  const times = [
    s.build?.created,
    ...Object.values(s.logs).flat().map((e) => e.time),
    ...s.gates.flatMap((g) => [g.request.opened, g.answers?.submitted]),
    ...Object.values(s.files).flat().map((f) => f.modified),
  ].filter((t): t is string => typeof t === 'string' && !Number.isNaN(Date.parse(t)));
  return times.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
}
