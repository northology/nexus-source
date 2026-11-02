import { checkAnswers } from './answers.ts';
import { NexusError } from './errors.ts';
import { addEntry, readLog, writeLog } from './logs.ts';
import { assertReadableName } from './names.ts';
import type { GateView, GuardrailView, LogEntry, RaisedBy } from './types.ts';

export const RAISED_BY: RaisedBy[] = ['user', 'claude', 'agent'];

export interface Proposal { name: string; text: string; source: string; raisedBy: string; quote?: string; note?: string; phase?: string }

/**
 * A guardrail's state comes only from the cockpit-written answers file, which records that the gate decided guardrails
 * and the exact text the user saw for each row; the latest answer wins and a changed text drops back to proposed. guardrails.json
 * can add or withdraw a proposal but never accept one, and answers that don't fit their gate are ignored, so a
 * failure never loosens anything.
 */
export function deriveGuardrails(entries: LogEntry[], gates: Pick<GateView, 'name' | 'request' | 'answers'>[]): GuardrailView[] {
  const answered = gates.flatMap((g) =>
    g.answers?.log === 'guardrails' && g.answers.marks && checkAnswers(g.request, g.answers).length === 0
      ? [{ gate: g.name, submitted: g.answers.submitted, marks: g.answers.marks, texts: g.answers.texts ?? {} }]
      : [],
  );
  answered.sort((a, b) => Date.parse(a.submitted) - Date.parse(b.submitted));
  return entries.map((entry): GuardrailView => {
    let view: GuardrailView = { entry, state: 'proposed', gate: null, decided: null };
    for (const a of answered) {
      // Own keys only: a guardrail named like an object property (constructor, toString) must not read one.
      if (!Object.hasOwn(a.marks, entry.name) || !Object.hasOwn(a.texts, entry.name) || a.texts[entry.name] !== entry.text) continue;
      const mark = a.marks[entry.name];
      if (!mark) continue;
      view = { entry, state: mark === 'research' ? 'proposed' : mark, gate: a.gate, decided: a.submitted };
    }
    // A withdrawal takes back a proposal. It can't lift what the user accepted: only a later gate can.
    if (entry.status === 'withdrawn' && view.state !== 'accepted') return { entry, state: 'withdrawn', gate: null, decided: null };
    return view;
  });
}

export function proposeGuardrail(root: string, build: string, p: Proposal, now: string): LogEntry {
  if (!RAISED_BY.includes(p.raisedBy as RaisedBy)) throw new NexusError(`--raised-by must be one of: ${RAISED_BY.join(', ')}`);
  const entry: LogEntry = {
    name: p.name,
    text: p.text,
    status: 'proposed',
    source: p.source,
    raisedBy: p.raisedBy as RaisedBy,
    time: now,
    ...(p.quote ? { quote: p.quote } : {}),
    ...(p.note ? { note: p.note } : {}),
    ...(p.phase ? { phase: p.phase } : {}),
  };
  addEntry(root, build, 'guardrails', entry);
  return entry;
}

/**
 * Withdrawing takes back a proposal (or a declined guardrail), which only narrows what applies, so the agent may do it
 * without a gate. An accepted guardrail is a constraint the user approved: only the user lifts it, by declining it at
 * a guardrails gate.
 */
export function withdrawGuardrail(root: string, build: string, name: string, gates: Pick<GateView, 'name' | 'request' | 'answers'>[]): LogEntry {
  assertReadableName(name, 'guardrail name');
  const file = readLog(root, build, 'guardrails');
  const entry = file.entries.find((e) => e.name === name);
  if (!entry) throw new NexusError(`No guardrail "${name}" in this build`, 404);
  const [view] = deriveGuardrails([entry], gates);
  if (view?.state === 'accepted') {
    throw new NexusError(`"${name}" was accepted at ${view.gate ?? 'a gate'}. Only the user can lift it: open a guardrails gate that lists it again, and they can decline it there.`, 409);
  }
  entry.status = 'withdrawn';
  writeLog(root, build, 'guardrails', file);
  return entry;
}
