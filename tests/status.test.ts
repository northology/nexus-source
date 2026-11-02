import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createBuild } from '../core/build.ts';
import { applyAnswers, openGate, submitAnswers } from '../core/gates.ts';
import { proposeGuardrail } from '../core/guardrails.ts';
import { changeStage } from '../core/lifecycle.ts';
import { startPhase } from '../core/phases.ts';
import { describeStatus, phaseStatus } from '../core/status.ts';
import { tempDir } from './helpers.ts';

const B = 'card';
const P = 'phase-1';
const at = (h: number, m = 0): string => `2026-10-06T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;

function fresh(): string {
  const root = tempDir();
  createBuild(root, { name: B, branch: 'build/card', now: at(8), phase: P });
  return root;
}
function doc(root: string, rel: string): string {
  const file = join(root, '.build', B, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, '# Document\n');
  return rel;
}
function guardrails(root: string, h: number, phase = P): void {
  proposeGuardrail(root, B, { name: `no-js-${phase}`, text: 'No JavaScript.', source: 'chat', raisedBy: 'user' }, at(h));
  openGate(root, B, { name: `guardrails-${phase}`, step: 'guardrails', phase, type: 'mark-list', log: 'guardrails', title: 'Guardrails', why: 'Limits.', items: [{ name: `no-js-${phase}`, text: 'No JavaScript.' }] }, at(h));
  submitAnswers(root, B, `guardrails-${phase}`, { marks: { [`no-js-${phase}`]: 'accepted' } }, at(h, 10));
  applyAnswers(root, B, `guardrails-${phase}`, at(h, 20));
}
function scope(root: string, h: number, apply = true): void {
  openGate(root, B, { name: `scope-${P}`, step: 'scope', phase: P, type: 'mark-list', title: 'Scope', why: 'Pieces.', items: [{ name: 'card', text: 'One card.' }] }, at(h));
  if (!apply) return;
  submitAnswers(root, B, `scope-${P}`, { marks: { card: 'accepted' } }, at(h, 10));
  applyAnswers(root, B, `scope-${P}`, at(h, 20));
}
/** Opens an approve gate for a step and, when given, answers and applies it. */
function approveStep(root: string, step: 'spec' | 'plan', name: string, h: number, decision?: 'approve' | 'send-back', phase: string | null = P): void {
  const document = doc(root, `documents/${step === 'spec' ? 'specs' : 'plans'}/${P}/${name}.md`);
  openGate(root, B, { name, step, ...(phase ? { phase } : {}), type: 'approve', title: name, why: 'Review.', document }, at(h));
  if (!decision) return;
  submitAnswers(root, B, name, { decision, ...(decision === 'send-back' ? { note: 'Tighten it.' } : {}) }, at(h, 10));
  applyAnswers(root, B, name, at(h, 20));
}
function finish(root: string, h: number, apply: boolean): void {
  openGate(root, B, { name: `finish-${P}`, step: 'finish', phase: P, type: 'approve', title: 'Finish', why: 'Merge.' }, at(h));
  submitAnswers(root, B, `finish-${P}`, { decision: 'approve' }, at(h, 10));
  if (apply) applyAnswers(root, B, `finish-${P}`, at(h, 20));
}
/** Guardrails, scope, spec and plan all approved, at stage plan. */
function planned(root: string): void {
  guardrails(root, 9);
  scope(root, 10);
  changeStage(root, B, 'plan', at(10, 30));
  approveStep(root, 'spec', `spec-${P}`, 11, 'approve');
  approveStep(root, 'plan', `plan-${P}`, 12, 'approve');
}

describe('phaseStatus', () => {
  it('names the build, phase, stage and branch, and a row per standard step', () => {
    const s = phaseStatus(fresh(), B);
    expect(s).toMatchObject({ build: B, phase: P, stage: 'planning', branch: 'build/card' });
    expect(s.rows.map((r) => [r.step, r.gate, r.state])).toEqual([
      ['guardrails', null, 'not opened'],
      ['scope', null, 'not opened'],
      ['spec', null, 'not opened'],
      ['plan', null, 'not opened'],
      ['finish', null, 'not opened'],
    ]);
  });

  it('rule 1: a closed phase finishes its merge or starts the next phase', () => {
    const root = fresh();
    planned(root);
    changeStage(root, B, 'build', at(13));
    finish(root, 14, false);
    changeStage(root, B, 'close-out', at(14, 15));
    applyAnswers(root, B, `finish-${P}`, at(14, 20));
    expect(phaseStatus(root, B).next).toBe(
      `Phase "${P}" is closed. If main doesn't contain this branch's tip, finish the merge from /nexus:plan step 5, item 2; otherwise start the next phase with /nexus:plan ${B} <next phase>.`,
    );
  });

  it('rule 2: an answered gate is applied first, the earliest submitted first, any type', () => {
    const root = fresh();
    guardrails(root, 9);
    scope(root, 10, false);
    submitAnswers(root, B, `scope-${P}`, { marks: { card: 'accepted' } }, at(10, 40));
    expect(phaseStatus(root, B).next).toBe(`Apply it: nexus gate apply scope-${P} --build ${B}.`);
    expect(phaseStatus(root, B).rows[1]).toMatchObject({ gate: `scope-${P}`, state: 'answered' });
  });

  it('rule 3: an open gate waits, including a concept round that is not a standard step', () => {
    const root = fresh();
    guardrails(root, 9);
    const warm = doc(root, 'concepts/look/warm.html');
    const cool = doc(root, 'concepts/look/cool.html');
    openGate(root, B, { name: 'look', type: 'concept-pick', topic: 'look', phase: P, title: 'Look', why: 'Pick.', options: [{ name: 'warm', label: 'Warm', page: warm }, { name: 'cool', label: 'Cool', page: cool }] }, at(10));
    expect(phaseStatus(root, B).next).toBe('look is waiting in the cockpit. Tell the user, and stop until they answer.');
    scope(root, 11, false);
    expect(phaseStatus(root, B).next).toBe(`look, scope-${P} are waiting in the cockpit. Tell the user, and stop until they answer.`);
  });

  it('rule 4: an approved finish gate before close-out closes out, then merges', () => {
    const root = fresh();
    planned(root);
    changeStage(root, B, 'build', at(13));
    finish(root, 14, true);
    expect(phaseStatus(root, B).next).toBe('nexus stage close-out --build card, commit the build folder, then merge from /nexus:plan step 5, item 2.');
  });

  it('rule 5: a sent-back gate is revised and reopened under the next number', () => {
    const root = fresh();
    guardrails(root, 9);
    scope(root, 10);
    changeStage(root, B, 'plan', at(10, 30));
    approveStep(root, 'spec', `spec-${P}`, 11, 'send-back');
    expect(phaseStatus(root, B).next).toBe(`spec-${P} was sent back. Revise per its note, then reopen it as spec-${P}-2.`);
    approveStep(root, 'spec', `spec-${P}-2`, 12, 'send-back');
    expect(phaseStatus(root, B).next).toBe(`spec-${P}-2 was sent back. Revise per its note, then reopen it as spec-${P}-3.`);
  });

  it('the latest reopened gate wins: an approved -2 leaves no sent-back advice', () => {
    const root = fresh();
    guardrails(root, 9);
    scope(root, 10);
    changeStage(root, B, 'plan', at(10, 30));
    approveStep(root, 'spec', `spec-${P}`, 11, 'send-back');
    approveStep(root, 'spec', `spec-${P}-2`, 12, 'approve');
    const s = phaseStatus(root, B);
    expect(s.rows[2]).toEqual({ step: 'spec', gate: `spec-${P}-2`, state: 'applied', result: 'approved' });
    expect(s.next).toBe('/nexus:plan step 4 (plan).');
  });

  it('breaks a same-second tie on the reopen number, so -10 is later than -9', () => {
    const root = fresh();
    guardrails(root, 9);
    scope(root, 10);
    changeStage(root, B, 'plan', at(10, 30));
    approveStep(root, 'spec', `spec-${P}-9`, 11, 'send-back');
    approveStep(root, 'spec', `spec-${P}-10`, 11, 'approve');
    const s = phaseStatus(root, B);
    expect(s.rows[2]).toEqual({ step: 'spec', gate: `spec-${P}-10`, state: 'applied', result: 'approved' });
    expect(s.next).toBe('/nexus:plan step 4 (plan).');
  });

  it('rules 6 to 8: guardrails, then brainstorm, then the spec (staging plan first when still planning)', () => {
    const root = fresh();
    expect(phaseStatus(root, B).next).toBe('/nexus:plan step 2 (guardrails).');
    guardrails(root, 9);
    expect(phaseStatus(root, B).next).toBe('/nexus:plan step 3 (brainstorm, then the scope gate).');
    scope(root, 10);
    expect(phaseStatus(root, B).next).toBe('nexus stage plan --build card, then /nexus:plan step 3 (write the spec, then the spec gate).');
    changeStage(root, B, 'plan', at(10, 30));
    expect(phaseStatus(root, B).next).toBe('/nexus:plan step 3 (write the spec, then the spec gate).');
  });

  it('rules 9 to 11: the plan, then stage build, then execution', () => {
    const root = fresh();
    guardrails(root, 9);
    scope(root, 10);
    changeStage(root, B, 'plan', at(10, 30));
    approveStep(root, 'spec', `spec-${P}`, 11, 'approve');
    expect(phaseStatus(root, B).next).toBe('/nexus:plan step 4 (plan).');
    approveStep(root, 'plan', `plan-${P}`, 12, 'approve');
    expect(phaseStatus(root, B).next).toBe('nexus stage build --build card, then execution (/nexus:plan step 4).');
    changeStage(root, B, 'build', at(13));
    expect(phaseStatus(root, B).next).toBe('Continue execution; with the full suite green, /nexus:plan step 5 (finish).');
  });

  it('places a gate without a phase by its opened time, and ignores an earlier phase’s gates, open ones included', () => {
    const root = fresh();
    planned(root);
    changeStage(root, B, 'build', at(13));
    finish(root, 14, false);
    changeStage(root, B, 'close-out', at(14, 15));
    applyAnswers(root, B, `finish-${P}`, at(14, 20));
    // A gate left open in phase-1, and one with no phase opened before phase-2 starts.
    openGate(root, B, { name: 'old-look', type: 'approve', phase: P, title: 'Old', why: 'Left open.' }, at(14, 30));
    approveStep(root, 'spec', 'stray-spec', 14, undefined, null);
    startPhase(root, B, 'phase-2', { branch: 'build/card-phase-2', now: at(15) });
    const before = phaseStatus(root, B);
    expect(before.phase).toBe('phase-2');
    expect(before.branch).toBe('build/card-phase-2');
    expect(before.rows.every((r) => r.state === 'not opened')).toBe(true);
    expect(before.next).toBe('/nexus:plan step 2 (guardrails).');
    // A gate without a phase opened after phase-2 started belongs to phase-2.
    guardrails(root, 16, 'phase-2');
    approveStep(root, 'spec', 'unphased-spec', 17, undefined, null);
    expect(phaseStatus(root, B).rows[2]).toMatchObject({ gate: 'unphased-spec', state: 'open' });
  });

  it('rule 2 with an approved permit: make the change while the permit is open, otherwise apply and reopen', () => {
    const root = fresh();
    guardrails(root, 9);
    openGate(root, B, { name: 'claude-rule', type: 'approve', phase: P, title: 'Rule', why: 'You asked for a rule.', permit: { target: 'CLAUDE.md', change: 'Add a rule' } }, at(10));
    submitAnswers(root, B, 'claude-rule', { decision: 'approve' }, at(10, 5));
    expect(phaseStatus(root, B, new Date(at(10, 10))).next).toBe(
      'Make the permitted change to CLAUDE.md ("Add a rule") now, then apply it: nexus gate apply claude-rule --build card.',
    );
    expect(phaseStatus(root, B, new Date(at(11))).next).toBe(
      'The permit for CLAUDE.md expired at 2026-10-06T10:35:00.000Z. Apply it: nexus gate apply claude-rule --build card, and open a new permit gate if the change is still needed.',
    );
  });

  it('a phase past scope with no guardrails gate is not sent back to guardrails', () => {
    const root = fresh();
    scope(root, 10);
    expect(phaseStatus(root, B).next).toBe('nexus stage plan --build card, then /nexus:plan step 3 (write the spec, then the spec gate).');
  });

  it('fails on a gate whose opened time is not a real date, instead of dropping it', () => {
    const root = fresh();
    guardrails(root, 9);
    approveStep(root, 'spec', 'odd-spec', 10, undefined, null);
    const file = join(root, '.build', B, 'gates', 'odd-spec.json');
    const gate = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    writeFileSync(file, JSON.stringify({ ...gate, opened: '2026-13-45T11:00:00Z' }));
    expect(() => phaseStatus(root, B)).toThrow(/odd-spec\.json.*2026-13-45T11:00:00Z/);
  });

  it('fails on an unreadable gate file instead of skipping it', () => {
    const root = fresh();
    writeFileSync(join(root, '.build', B, 'gates', `scope-${P}.json`), '{ not json');
    expect(() => phaseStatus(root, B)).toThrow(/scope-phase-1\.json/);
  });
});

describe('describeStatus', () => {
  it('prints the heading, one aligned row per step with its result, and the Next: line', () => {
    const root = fresh();
    guardrails(root, 9);
    scope(root, 10);
    changeStage(root, B, 'plan', at(10, 30));
    approveStep(root, 'spec', `spec-${P}`, 11, 'send-back');
    expect(describeStatus(phaseStatus(root, B)).split('\n')).toEqual([
      'card · phase phase-1 · stage plan · branch build/card',
      'guardrails  guardrails-phase-1  applied',
      'scope       scope-phase-1       applied',
      'spec        spec-phase-1        applied (sent back)',
      'plan        -                   not opened',
      'finish      -                   not opened',
      `Next: spec-${P} was sent back. Revise per its note, then reopen it as spec-${P}-2.`,
    ]);
  });
});
