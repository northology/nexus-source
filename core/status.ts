import { existsSync, readdirSync } from 'node:fs';
import { readBuild } from './build.ts';
import { NexusError } from './errors.ts';
import { gatePath, readAnswers, readGate } from './gates.ts';
import { skillCommand } from './harness.ts';
import { buildPath } from './paths.ts';
import { PERMIT_MINUTES } from './permits.ts';
import { currentPhase, phasesOf } from './phases.ts';
import type { Build, GateAnswers, GateRequest, GateStep, Stage } from './types.ts';

/** The five standard steps, in the order a phase meets them. */
const STEPS: GateStep[] = ['guardrails', 'scope', 'spec', 'plan', 'finish'];

type GateState = 'open' | 'answered' | 'applied';
interface PhaseGate { request: GateRequest; state: GateState; answers: GateAnswers | null }
export interface StepRow { step: GateStep; gate: string | null; state: 'not opened' | GateState; result?: 'approved' | 'sent back' }
export interface PhaseStatus { build: string; phase: string; stage: Stage; branch: string; rows: StepRow[]; next: string }

const time = (t: string): number => Date.parse(t);

/**
 * The current phase's gates with their states. The agent writes a gate's `phase`, not the server, so a gate without one
 * belongs by its opened time. An unreadable gate file throws: skipping it could send the agent a step forward.
 */
function phaseGates(root: string, build: string, b: Build): PhaseGate[] {
  const phase = currentPhase(b);
  const started = phasesOf(b).find((p) => p.name === phase)?.started ?? b.created;
  const dir = buildPath(root, build, 'gates');
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.answers.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
  const gates: PhaseGate[] = [];
  for (const name of names) {
    const request = readGate(root, build, name);
    // An impossible date would drop the gate or misorder it, which could send the agent a step away.
    if (Number.isNaN(time(request.opened))) throw new NexusError(`gates/${name}.json has an opened time that isn't a real date: ${request.opened}`);
    const mine = request.phase !== undefined ? request.phase === phase : time(request.opened) >= time(started);
    if (!mine) continue;
    const answers = existsSync(gatePath(root, build, name, true)) ? readAnswers(root, build, name) : null;
    const state: GateState = !answers ? 'open' : b.gates[name]?.read ? 'applied' : 'answered';
    gates.push({ request, state, answers });
  }
  return gates;
}

/** A step's latest gate: the one opened last, so a reopened `-2` or `-3` replaces the one sent back. */
function latest(gates: PhaseGate[], step: GateStep, phase: string): PhaseGate | undefined {
  // Within one second, the reopen number decides: -10 comes after -9, which text order gets wrong.
  const byReopen = (a: PhaseGate, b: PhaseGate): number => {
    const ra = reopenNumber(a.request.name, step, phase);
    const rb = reopenNumber(b.request.name, step, phase);
    return ra !== null && rb !== null ? ra - rb : a.request.name.localeCompare(b.request.name);
  };
  return gates
    .filter((g) => g.request.step === step)
    .sort((a, b) => time(a.request.opened) - time(b.request.opened) || byReopen(a, b))
    .at(-1);
}

/**
 * 1 for `<step>-<phase>`, n for `<step>-<phase>-<n>`, null for any other name. Names are lowercase letters, digits
 * and hyphens, so no escaping.
 */
function reopenNumber(name: string, step: GateStep, phase: string): number | null {
  if (name === `${step}-${phase}`) return 1;
  const n = new RegExp(`^${step}-${phase}-(\\d+)$`).exec(name)?.[1];
  return n ? Number(n) : null;
}

function rowOf(gates: PhaseGate[], step: GateStep, phase: string): StepRow {
  const g = latest(gates, step, phase);
  if (!g) return { step, gate: null, state: 'not opened' };
  const decided = g.state === 'applied' && g.request.type === 'approve';
  const result = decided ? (g.answers?.decision === 'approve' ? 'approved' : 'sent back') : undefined;
  return { step, gate: g.request.name, state: g.state, ...(result ? { result } : {}) };
}

/** The reopened name: `<step>-<phase>-2`, then `-3`. */
function reopenName(name: string, step: GateStep, phase: string): string {
  return `${step}-${phase}-${(reopenNumber(name, step, phase) ?? 1) + 1}`;
}

/** Applying closes a permit, so an approved one's change comes first while its window is open (as the hook says). */
function applyLine(g: PhaseGate, build: string, now: Date): string {
  const apply = `nexus gate apply ${g.request.name} --build ${build}`;
  const permit = g.answers?.decision === 'approve' ? g.answers.permit : undefined;
  if (!permit) return `Apply it: ${apply}.`;
  const until = time(g.answers?.submitted ?? '') + PERMIT_MINUTES * 60_000;
  if (now.getTime() < until) return `Make the permitted change to ${permit.target} ("${permit.change}") now, then apply it: ${apply}.`;
  const when = Number.isNaN(until) ? 'an unreadable time' : new Date(until).toISOString();
  return `The permit for ${permit.target} expired at ${when}. Apply it: ${apply}, and open a new permit gate if the change is still needed.`;
}

/** The spec's §3 rules, first match wins. */
function nextStep(build: string, phase: string, stage: Stage, gates: PhaseGate[], rows: StepRow[], now: Date): string {
  const plan = skillCommand('plan');
  if (stage === 'close-out') {
    return `Phase "${phase}" is closed. If main doesn't contain this branch's tip, finish the merge from ${plan} step 5, item 2; otherwise start the next phase with ${plan} ${build} <next phase>.`;
  }
  const answered = gates
    .filter((g) => g.state === 'answered')
    .sort((a, b) => time(a.answers?.submitted ?? '') - time(b.answers?.submitted ?? ''));
  if (answered[0]) return applyLine(answered[0], build, now);
  const open = gates.filter((g) => g.state === 'open').map((g) => g.request.name);
  if (open.length) return `${open.join(', ')} ${open.length === 1 ? 'is' : 'are'} waiting in the cockpit. Tell the user, and stop until they answer.`;
  const row = (step: GateStep): StepRow | undefined => rows.find((r) => r.step === step);
  if (row('finish')?.result === 'approved') return `nexus stage close-out --build ${build}, commit the build folder, then merge from ${plan} step 5, item 2.`;
  const sent = rows.find((r) => r.result === 'sent back');
  if (sent?.gate) return `${sent.gate} was sent back. Revise per its note, then reopen it as ${reopenName(sent.gate, sent.step, phase)}.`;
  // A later phase may add no guardrails and so open no guardrails gate; once scope is applied, don't send it back.
  if (row('guardrails')?.state !== 'applied' && row('scope')?.state !== 'applied') return `${plan} step 2 (guardrails).`;
  if (row('scope')?.state !== 'applied') return `${plan} step 3 (brainstorm, then the scope gate).`;
  if (row('spec')?.result !== 'approved') return `${stage === 'planning' ? `nexus stage plan --build ${build}, then ` : ''}${plan} step 3 (write the spec, then the spec gate).`;
  if (row('plan')?.result !== 'approved') return `${plan} step 4 (plan).`;
  if (stage !== 'build') return `nexus stage build --build ${build}, then execution (${plan} step 4).`;
  return `Continue execution; with the full suite green, ${plan} step 5 (finish).`;
}

/** `nexus phase status`: read-only, and runs no git. */
export function phaseStatus(root: string, build: string, now: Date = new Date()): PhaseStatus {
  const b = readBuild(root, build);
  const phase = currentPhase(b);
  const branch = phasesOf(b).find((p) => p.name === phase)?.branch ?? b.branch;
  const gates = phaseGates(root, build, b);
  const rows = STEPS.map((step) => rowOf(gates, step, phase));
  return { build, phase, stage: b.stage, branch, rows, next: nextStep(build, phase, b.stage, gates, rows, now) };
}

export function describeStatus(s: PhaseStatus): string {
  const width = Math.max(...s.rows.map((r) => (r.gate ?? '-').length));
  const lines = [`${s.build} · phase ${s.phase} · stage ${s.stage} · branch ${s.branch}`];
  for (const r of s.rows) {
    lines.push(`${r.step.padEnd(10)}  ${(r.gate ?? '-').padEnd(width)}  ${r.state}${r.result ? ` (${r.result})` : ''}`);
  }
  lines.push(`Next: ${s.next}`);
  return lines.join('\n');
}
