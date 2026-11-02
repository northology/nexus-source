import type { GateAnswers, GateOption, GateRequest, GateView } from './types.ts';

// No Node imports: the cockpit imports this file, so `gate apply` and the Concepts section read the same.

export type RoundOutcome = { kind: 'open' } | { kind: 'picked'; choice: string } | { kind: 'combined'; choices: string[] } | { kind: 'none' };
export interface Round { gate: GateView; number: number; outcome: RoundOutcome; kept: string[] }
export type TopicState = 'open' | 'settled' | 'waiting';
export interface Topic { name: string; title: string; rounds: Round[]; state: TopicState; latest: Round; pick: GateOption | null; answered: string | null }

const time = (t: string | undefined): number => (t ? Date.parse(t) : Number.NaN);

export function topicOf(request: GateRequest): string {
  return request.topic ?? request.name;
}

export function outcomeOf(answers: GateAnswers | null): RoundOutcome {
  if (!answers) return { kind: 'open' };
  if (answers.choices) return { kind: 'combined', choices: answers.choices };
  if (answers.none) return { kind: 'none' };
  if (answers.choice !== undefined) return { kind: 'picked', choice: answers.choice };
  return { kind: 'open' };
}

function kept(o: RoundOutcome): string[] {
  return o.kind === 'picked' ? [o.choice] : o.kind === 'combined' ? o.choices : [];
}

export function roundOf(gate: GateView, number: number): Round {
  const outcome = outcomeOf(gate.answers);
  return { gate, number, outcome, kept: kept(outcome) };
}

function byOpening(a: GateView, b: GateView): number {
  const d = time(a.request.opened) - time(b.request.opened);
  return Number.isNaN(d) || d === 0 ? a.name.localeCompare(b.name) : d;
}

export function topicsOf(gates: GateView[]): Topic[] {
  const groups = new Map<string, GateView[]>();
  for (const g of gates) {
    if (g.request.type !== 'concept-pick') continue;
    const key = topicOf(g.request);
    groups.set(key, [...(groups.get(key) ?? []), g]);
  }
  const topics: Topic[] = [];
  for (const [name, list] of groups) {
    const rounds = [...list].sort(byOpening).map((gate, i) => roundOf(gate, i + 1));
    const first = rounds[0];
    const latest = rounds.at(-1);
    if (!first || !latest) continue;
    const o = latest.outcome;
    const state: TopicState = o.kind === 'open' ? 'open' : o.kind === 'picked' ? 'settled' : 'waiting';
    const pick = o.kind === 'picked' ? (latest.gate.request.options ?? []).find((x) => x.name === o.choice) ?? null : null;
    const submitted = rounds.map((r) => r.gate.answers?.submitted).filter((t): t is string => typeof t === 'string');
    const answered = submitted.sort((a, b) => time(b) - time(a))[0] ?? null;
    topics.push({ name, title: first.gate.request.title, rounds, state, latest, pick, answered });
  }
  return topics.sort((a, b) => {
    if (a.answered && b.answered) return time(b.answered) - time(a.answered);
    if (a.answered || b.answered) return a.answered ? -1 : 1;
    return byOpening(a.rounds[0]?.gate ?? a.latest.gate, b.rounds[0]?.gate ?? b.latest.gate);
  });
}

export function openRounds(topics: Topic[]): Round[] {
  return topics.flatMap((t) => t.rounds.filter((r) => r.outcome.kind === 'open')).sort((a, b) => byOpening(a.gate, b.gate));
}

export function outcomeText(round: Round): string {
  const o = round.outcome;
  const options = round.gate.request.options ?? [];
  if (o.kind === 'open') return 'Waiting for you';
  if (o.kind === 'picked') return `Picked ${options.find((x) => x.name === o.choice)?.label ?? o.choice}`;
  if (o.kind === 'combined') return `Combined ${o.choices.length} of ${options.length}`;
  return 'None of these';
}
