import type { GateItem, GateRequest, GateView, GuardrailView, Mark } from '../../../core/types.ts';
import { inPhase } from './phases.ts';
import { raisedByLabel } from './raised-by.ts';

/** open: waiting for the user; answered: sent, waiting for the agent to apply; applied: the agent has read it. */
export type GateState = 'open' | 'answered' | 'applied';

export function gateState(gate: GateView): GateState {
  if (!gate.answers) return 'open';
  return gate.read !== null && Date.parse(gate.answers.submitted) <= Date.parse(gate.read) ? 'applied' : 'answered';
}

const RANK: Record<GateState, number> = { open: 0, answered: 1, applied: 2 };

export function orderGates(gates: GateView[]): GateView[] {
  return [...gates].sort(
    (a, b) =>
      RANK[gateState(a)] - RANK[gateState(b)] ||
      Date.parse(b.request.opened) - Date.parse(a.request.opened) ||
      a.name.localeCompare(b.name),
  );
}

/** How many things still need the user before the gate can be submitted (the big red figure): each unmarked row of a
 * mark-list, else 1. A concept round shows its own state, so an open round counts 1. */
export function awaiting(req: GateRequest, marks: Record<string, Mark>): number {
  if (req.type === 'mark-list') return (req.items ?? []).filter((i) => !marks[i.name]).length;
  return 1;
}

export const GATE_TABS = ['guardrails', 'scope', 'spec', 'plan', 'finish', 'decommission', 'permits', 'other'] as const;
export type GateTab = (typeof GATE_TABS)[number];
export const GATE_TAB_LABEL: Record<GateTab, string> = {
  guardrails: 'Guardrails',
  scope: 'Scope',
  spec: 'Spec',
  plan: 'Plan',
  finish: 'Finish',
  decommission: 'Decommission',
  permits: 'Permits',
  other: 'Other',
};

/** The runner's tabs: all of them, except Decommission until the build has a gate filed there (once, at its end). */
export function visibleTabs(gates: GateView[]): GateTab[] {
  return GATE_TABS.filter((t) => t !== 'decommission' || gates.some((g) => gateTab(g.request) === 'decommission'));
}

export function isGateTab(value: string | undefined): value is GateTab {
  return value !== undefined && (GATE_TABS as readonly string[]).includes(value);
}

/** The tab a gate lives under: its step, else what it carries. Names are never read: the agent chooses them. */
export function gateTab(req: GateRequest): GateTab {
  if (req.step) return req.step;
  if (req.permit) return 'permits';
  if (req.log === 'guardrails') return 'guardrails';
  return 'other';
}

/**
 * A tab's gates for the selected phase (null: every phase), in gate order. Its open gates are listed whatever the phase
 * (needs-you is never filtered), and the gate on screen always stays listed.
 */
export function tabGates(gates: GateView[], tab: GateTab, phase: string | null, keep: GateView | null): GateView[] {
  return orderGates(gates).filter(
    (g) => gateTab(g.request) === tab && (g.name === keep?.name || inPhase(g.request.phase, phase) || gateState(g) === 'open'),
  );
}

/** A tab's count: what the tab lists. */
export function tabCount(gates: GateView[], tab: GateTab, phase: string | null): number {
  return tabGates(gates, tab, phase, null).length;
}

/**
 * Rows as the cockpit shows them. On a guardrail gate, who raised each guardrail and where from come from the
 * guardrail log, the record, not from the request the agent wrote.
 */
export function displayRows(req: GateRequest, guardrails: GuardrailView[]): GateItem[] {
  const items = req.items ?? [];
  if (req.log !== 'guardrails') return items;
  const byName = new Map(guardrails.map((g) => [g.entry.name, g.entry]));
  return items.map(({ source: _source, quote: _quote, ...row }) => {
    const entry = byName.get(row.name);
    if (!entry) return { ...row, source: 'not in the guardrail log' };
    return { ...row, source: `${raisedByLabel(entry.raisedBy)} · ${entry.source}`, ...(entry.quote ? { quote: entry.quote } : {}) };
  });
}
