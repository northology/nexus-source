import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkAnswers } from './answers.ts';
import { readBuild, writeBuild } from './build.ts';
import { topicOf } from './concept-text.ts';
import { NexusError } from './errors.ts';
import { readLog, removeEntry, upsertEntry, writeLog } from './logs.ts';
import { assertReadableName, duplicateNames, finishGatePattern } from './names.ts';
import { buildPath, listBuilds } from './paths.ts';
import { currentPhase } from './phases.ts';
import { indexPlan, planIndexed, type IndexResult } from './plan.ts';
import { validate } from './schemas.ts';
import { readSnapshot } from './snapshot.ts';
import { readJson, writeJson } from './store.ts';
import type { Build, GateAnswers, GateRequest, GateType, LogEntry, Problem, StampedPermit } from './types.ts';

export type GateInput = Omit<GateRequest, 'opened'> & { opened?: string };
export interface ApplySummary {
  gate: string;
  type: GateType;
  accepted: string[];
  research: string[];
  declined: string[];
  /** Retire rows: accepted ones retired their guardrail; declined or research ones kept it. */
  retired?: string[];
  kept?: string[];
  /** Open questions that accepted or declined rows of the same name closed. */
  closed: string[];
  /** Decisions that research rows of the same name reopened as questions. */
  reopened: string[];
  choice?: string;
  choices?: string[];
  none?: true;
  /** What the agent does next, for a concept-pick round. */
  next?: string;
  decision?: 'approve' | 'send-back';
  note?: string;
  rowNotes?: Record<string, string>;
  log?: 'guardrails';
  indexed?: IndexResult;
}
/** `permit` is set only for an approved permit gate: the stamped permit, open until the gate is applied. */
export interface Waiting { build: string; gate: string; submitted: string; summary: string; permit?: StampedPermit }

/** The permit an answer opens: stamped by the server, and only on approve. */
function approvedPermit(a: GateAnswers): StampedPermit | null {
  return a.decision === 'approve' && a.permit ? a.permit : null;
}

export function gatePath(root: string, build: string, gate: string, answers = false): string {
  return buildPath(root, build, 'gates', `${gate}${answers ? '.answers' : ''}.json`);
}

/** A standard step must look like that step, so the cockpit's tabs can trust it. Returns the problem, or null. */
function stepProblem(request: GateRequest): string | null {
  switch (request.step) {
    case 'finish': {
      const expected = request.phase ? `finish-${request.phase}` : 'finish-<phase>';
      const named = request.phase ? finishGatePattern(request.phase).test(request.name) : request.name.startsWith('finish-');
      return request.type === 'approve' && named ? null : `a finish gate is an approve gate named ${expected}, or ${expected}-2, -3, … once sent back`;
    }
    case 'guardrails':
      return request.log === 'guardrails' ? null : 'a guardrails gate carries "log": "guardrails"';
    case 'scope':
      return request.type === 'mark-list' ? null : 'a scope gate is a mark-list';
    case 'spec':
    case 'plan':
      return request.type === 'approve' && request.document ? null : `a ${request.step} gate is an approve gate with a document`;
    case 'decommission':
      return (request.type === 'mark-list' || request.type === 'approve') && request.document ? null : 'a decommission gate is a mark-list or an approve gate, with a document';
    case undefined:
      return null;
    default: {
      // A new GateStep that isn't handled above fails typecheck here.
      const unreachable: never = request.step;
      return unreachable;
    }
  }
}

export function openGate(root: string, build: string, input: GateInput, now: string): GateRequest {
  if (input.type === 'review') throw new NexusError(`Gate "${input.name}" is a review: reviews open in .nexus/reviews/ with \`nexus review open\`, not in a build.`);
  const request = { ...input, opened: input.opened ?? now } as GateRequest;
  const errors = validate('gate-request', request);
  if (errors.length) throw new NexusError(`Gate request is invalid: ${errors.join('; ')}`);
  const step = stepProblem(request);
  if (step) throw new NexusError(`Gate "${request.name}": ${step}`);
  const b = readBuild(root, build);
  const phase = currentPhase(b);
  if (request.step !== 'finish' && finishGatePattern(phase).test(request.name)) {
    throw new NexusError(`Gate "${request.name}": a finish-${phase} name is only for the finish gate; set "step": "finish".`);
  }
  const dups = duplicateNames([...(request.items ?? []), ...(request.options ?? [])]);
  if (dups.length) throw new NexusError(`Gate rows must have unique names; repeated: ${dups.join(', ')}`);
  const retiring = (request.items ?? []).filter((i) => i.retire);
  if (retiring.length && request.log !== 'guardrails') throw new NexusError(`Row "${retiring[0]?.name ?? ''}": a retire row belongs on a guardrails gate ("log": "guardrails")`);
  if (retiring.length) {
    const accepted = new Set(readSnapshot(root, build, { progress: false }).guardrails.filter((g) => g.state === 'accepted').map((g) => g.entry.name));
    for (const item of retiring) {
      if (!accepted.has(item.name)) throw new NexusError(`Row "${item.name}" retires a guardrail, but "${item.name}" is not an accepted guardrail`);
    }
  }
  if (request.log === 'guardrails') {
    const proposed = new Map(readLog(root, build, 'guardrails').entries.filter((e) => e.status === 'proposed').map((e) => [e.name, e.text]));
    for (const item of request.items ?? []) {
      const text = proposed.get(item.name);
      if (text === undefined) throw new NexusError(`"${item.name}" is not a proposed guardrail. Propose it first with \`nexus guardrail propose\`.`);
      if (text !== item.text) throw new NexusError(`Row "${item.name}" must show the guardrail's text exactly as proposed`);
    }
  }
  for (const o of request.options ?? []) {
    if (!existsSync(buildPath(root, build, o.page))) throw new NexusError(`Concept page ${o.page} does not exist in the build`);
  }
  if (request.document && !existsSync(buildPath(root, build, request.document))) {
    throw new NexusError(`Document ${request.document} does not exist in the build`);
  }
  // Reopening an answered name would reset its read record, which could reopen an applied permit.
  if (existsSync(gatePath(root, build, request.name, true))) {
    throw new NexusError(`Gate "${request.name}" was already answered. Open a new gate with a new name.`, 409);
  }
  if (existsSync(gatePath(root, build, request.name))) throw new NexusError(`A gate named "${request.name}" is already open in this build`, 409);
  writeJson(gatePath(root, build, request.name), request);
  b.gates[request.name] = { opened: request.opened, read: null };
  writeBuild(root, b);
  return request;
}

export function readGate(root: string, build: string, gate: string): GateRequest {
  assertReadableName(gate, 'gate name');
  const file = gatePath(root, build, gate);
  if (!existsSync(file)) throw new NexusError(`No gate "${gate}" in this build`, 404);
  const data = readJson(file);
  const errors = validate('gate-request', data);
  if (errors.length) throw new NexusError(`gates/${gate}.json is invalid: ${errors.join('; ')}`);
  return data as GateRequest;
}

/** Called by the server only: the one place nexus writes an answers file. */
export function submitAnswers(root: string, build: string, gate: string, body: unknown, now: string): GateAnswers {
  const request = readGate(root, build, gate);
  // An approved answer on a finish name lowers the wall, and request files aren't walled: only a real finish gate counts.
  const phase = currentPhase(readBuild(root, build));
  if (finishGatePattern(phase).test(gate) && (request.step !== 'finish' || request.type !== 'approve')) {
    throw new NexusError(
      `Gate "${gate}" has a finish name but isn't a finish gate, so it can't be answered. Reopen it as finish-${phase}-2 (or the next number) with "step": "finish".`,
      409,
    );
  }
  if (existsSync(gatePath(root, build, gate, true))) throw new NexusError(`Gate "${gate}" has already been answered`, 409);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new NexusError('Answers must be a JSON object');
  const { log: _log, texts: _texts, permit: _permit, targets: _targets, ...supplied } = body as Record<string, unknown>;
  const answers: Record<string, unknown> = { ...supplied, gate, submitted: now };
  // The server stamps what the user saw; guardrail acceptance and permits read only these.
  if (request.log === 'guardrails') {
    answers['log'] = 'guardrails';
    answers['texts'] = Object.fromEntries((request.items ?? []).map((i) => [i.name, i.text]));
  }
  if (request.type === 'approve' && request.permit) answers['permit'] = { target: request.permit.target, change: request.permit.change };
  const errors = validate('gate-answers', answers);
  if (errors.length) throw new NexusError(`Answers are invalid: ${errors.join('; ')}`);
  const problems = checkAnswers(request, answers as unknown as GateAnswers);
  if (problems.length) throw new NexusError(problems.join('; '));
  writeJson(gatePath(root, build, gate, true), answers);
  return answers as unknown as GateAnswers;
}

export function readAnswers(root: string, build: string, gate: string): GateAnswers {
  const file = gatePath(root, build, gate, true);
  if (!existsSync(file)) throw new NexusError(`Gate "${gate}" has no answers yet`, 404);
  const data = readJson(file);
  const errors = validate('gate-answers', data);
  if (errors.length) throw new NexusError(`gates/${gate}.answers.json is invalid: ${errors.join('; ')}`);
  return data as GateAnswers;
}

export function applyAnswers(root: string, build: string, gate: string, now: string): ApplySummary {
  const request = readGate(root, build, gate);
  const answers = readAnswers(root, build, gate);
  const problems = checkAnswers(request, answers);
  if (problems.length) throw new NexusError(`gates/${gate}.answers.json does not fit the gate: ${problems.join('; ')}`);
  // Own keys only: a row named like an object property (constructor) must not read a prototype function as its note.
  const rowNoteOf = (name: string): string | undefined => (answers.notes && Object.hasOwn(answers.notes, name) ? answers.notes[name] : undefined);

  let decisions = readLog(root, build, 'decisions');
  let questions = readLog(root, build, 'questions');
  const summary: ApplySummary = { gate, type: request.type, accepted: [], research: [], declined: [], closed: [], reopened: [] };
  if (answers.note) summary.note = answers.note;
  if (answers.notes && Object.keys(answers.notes).length) {
    // In the gate's row order, so `gate apply` lists notes the way the cockpit shows the rows.
    const inRowOrder = (request.items ?? []).flatMap((item) => {
      const note = rowNoteOf(item.name);
      return note ? [[item.name, note] as const] : [];
    });
    summary.rowNotes = Object.fromEntries(inRowOrder);
  }
  const source = `${gate} gate`;
  const withNote = answers.note ? { note: answers.note } : {};
  const phaseTag = request.phase ? { phase: request.phase } : {};
  const guardrailGate = request.log === 'guardrails';
  if (guardrailGate) summary.log = 'guardrails';
  const decommissionGate = request.step === 'decommission';

  if (request.type === 'mark-list') {
    for (const item of request.items ?? []) {
      const mark = answers.marks?.[item.name];
      if (!mark) continue;
      // A retire row's accept retires the guardrail: reporting it as "Accepted" would read as kept.
      if (guardrailGate && item.retire) {
        const key = mark === 'accepted' ? 'retired' : 'kept';
        summary[key] = [...(summary[key] ?? []), item.name];
        continue;
      }
      summary[mark].push(item.name);
      // A guardrail gate's answers file is the record; guardrails.json never stores acceptance. A decommission gate's
      // rows are guardrail names too, so they never touch a decision or question that shares one.
      if (guardrailGate || decommissionGate) continue;
      const rowNote = rowNoteOf(item.name);
      const entry: LogEntry = { name: item.name, text: item.text, status: mark, source, time: answers.submitted, ...(item.quote ? { quote: item.quote } : {}), ...(rowNote ? { note: rowNote } : {}), ...phaseTag };
      if (mark === 'research') {
        if (decisions.entries.some((e) => e.name === item.name)) summary.reopened.push(item.name);
        questions = upsertEntry(questions, entry);
        decisions = removeEntry(decisions, item.name);
      } else {
        if (questions.entries.some((e) => e.name === item.name)) summary.closed.push(item.name);
        decisions = upsertEntry(decisions, entry);
        questions = removeEntry(questions, item.name);
      }
    }
    if (decommissionGate) {
      const marked = (['accepted', 'declined', 'research'] as const).filter((m) => summary[m].length).map((m) => `${m}: ${summary[m].join(', ')}`);
      decisions = upsertEntry(decisions, { name: gate, text: `${request.title}: ${marked.join('; ') || 'nothing marked'}`, status: 'accepted', source, time: answers.submitted, ...withNote, ...phaseTag });
    }
  } else if (request.type === 'concept-pick') {
    const options = request.options ?? [];
    const label = (n: string): string => options.find((o) => o.name === n)?.label ?? n;
    const topic = topicOf(request);
    const nextRound = `Open the next round on topic "${topic}" with new pages in concepts/${topic}/`;
    const entry = (text: string, status: string): LogEntry => ({ name: gate, text, status, source, time: answers.submitted, ...withNote, ...phaseTag });
    if (answers.choices) {
      const labels = answers.choices.map(label);
      decisions = upsertEntry(decisions, entry(`${request.title}: combine ${labels.join(' + ')}`, 'accepted'));
      summary.choices = answers.choices;
      summary.next = `${nextRound}, merging ${labels.join(' and ')}.`;
    } else if (answers.none) {
      decisions = upsertEntry(decisions, entry(`${request.title}: none of these`, 'declined'));
      summary.none = true;
      summary.next = `${nextRound}, using the user's note.`;
    } else {
      const option = options.find((o) => o.name === answers.choice);
      if (!option) throw new NexusError(`"${answers.choice}" is not one of the options`);
      decisions = upsertEntry(decisions, entry(`${request.title}: ${option.label}`, 'accepted'));
      summary.choice = option.name;
      summary.next = `Topic "${topic}" is settled.`;
    }
  } else {
    const approved = answers.decision === 'approve';
    decisions = upsertEntry(decisions, { name: gate, text: `${request.title}: ${approved ? 'approved' : 'sent back'}`, status: approved ? 'accepted' : 'declined', source, time: answers.submitted, ...withNote, ...phaseTag });
    if (answers.decision) summary.decision = answers.decision;
  }

  writeLog(root, build, 'decisions', decisions);
  writeLog(root, build, 'questions', questions);
  const b = readBuild(root, build);
  b.gates[gate] = { opened: b.gates[gate]?.opened ?? request.opened, read: now };
  writeBuild(root, b);
  // An approved plan gate indexes its plan's tasks for the Plan section, once.
  // The apply is already committed, so a problem with the plan is reported, never thrown.
  if (request.step === 'plan' && request.type === 'approve' && answers.decision === 'approve' && request.document) {
    try {
      if (!planIndexed(root, build, gate)) summary.indexed = indexPlan(root, build, request, now);
    } catch (e) {
      summary.indexed = { file: request.document.split('/').at(-1) ?? request.document, tasks: null, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return summary;
}

/** `nexus plan index <gate>`: indexes a plan gate approved before nexus tracked tasks. */
export function indexPlanGate(root: string, build: string, gate: string, now: string): IndexResult {
  const request = readGate(root, build, gate);
  if (request.step !== 'plan' || request.type !== 'approve' || !request.document) {
    throw new NexusError(`Gate "${gate}" isn't a plan gate: an approve gate with "step": "plan" and a document`);
  }
  if (readAnswers(root, build, gate).decision !== 'approve') throw new NexusError(`Gate "${gate}" wasn't approved, so its plan isn't the one to track`, 409);
  return indexPlan(root, build, request, now);
}

export function summarize(request: GateRequest | null, a: GateAnswers): string {
  let text: string;
  if (a.marks) {
    const c = { accepted: 0, research: 0, declined: 0 };
    for (const m of Object.values(a.marks)) c[m]++;
    text = `${c.accepted} accepted, ${c.research} research, ${c.declined} declined`;
  } else if (a.choice) {
    const label = request?.options?.find((o) => o.name === a.choice)?.label ?? a.choice;
    text = `picked "${label}"`;
  } else if (a.choices) {
    const label = (n: string): string => request?.options?.find((o) => o.name === n)?.label ?? n;
    text = `combine ${a.choices.map((n) => `"${label(n)}"`).join(' + ')}`;
  } else if (a.none) {
    text = 'none of these';
  } else {
    const permit = approvedPermit(a);
    text = permit ? `approved permit for ${permit.target} ("${permit.change}")` : a.decision === 'approve' ? 'approved' : 'sent back';
  }
  const rowNotes = Object.keys(a.notes ?? {}).length;
  if (rowNotes) text += `; ${rowNotes} row ${rowNotes === 1 ? 'note' : 'notes'}`;
  return a.note ? `${text}; note: "${a.note}"` : text;
}

/** Answers submitted after the gate was last read, across every build under root. */
export function unreadAnswers(root: string): { waiting: Waiting[]; problems: Problem[] } {
  const waiting: Waiting[] = [];
  const problems: Problem[] = [];
  for (const name of listBuilds(root)) {
    const gatesDir = buildPath(root, name, 'gates');
    if (!existsSync(gatesDir)) continue;
    const answerFiles = readdirSync(gatesDir).filter((f) => f.endsWith('.answers.json')).sort();
    if (!answerFiles.length) continue;
    let build: Build | null = null;
    try {
      build = readBuild(root, name);
    } catch (e) {
      problems.push({ file: `${name}/build.json`, message: (e as Error).message });
    }
    for (const f of answerFiles) {
      const gate = f.slice(0, -'.answers.json'.length);
      let answers: GateAnswers;
      try {
        const data = readJson(join(gatesDir, f));
        const errors = validate('gate-answers', data);
        if (errors.length) throw new Error(errors.join('; '));
        answers = data as GateAnswers;
      } catch (e) {
        problems.push({ file: `${name}/gates/${f}`, message: (e as Error).message });
        continue;
      }
      const read = build?.gates[gate]?.read ?? null;
      if (read && Date.parse(answers.submitted) <= Date.parse(read)) continue;
      let request: GateRequest | null = null;
      try {
        request = readGate(root, name, gate);
      } catch {
        request = null;
      }
      const permit = approvedPermit(answers);
      waiting.push({ build: name, gate, submitted: answers.submitted, summary: summarize(request, answers), ...(permit ? { permit } : {}) });
    }
  }
  return { waiting, problems };
}
