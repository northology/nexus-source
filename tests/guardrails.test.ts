import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyAnswers, openGate, submitAnswers } from '../core/gates.ts';
import { deriveGuardrails, proposeGuardrail, withdrawGuardrail } from '../core/guardrails.ts';
import { readLog } from '../core/logs.ts';
import { readSnapshot } from '../core/snapshot.ts';
import { main, type CliIO } from '../scripts/cli.ts';
import type { GateView } from '../core/types.ts';
import { exampleRepo, NOW, LATER } from './helpers.ts';

const B = 'relay-rebuild';
const guardrailGate = (name: string, items: { name: string; text: string }[]) => ({
  name,
  type: 'mark-list' as const,
  log: 'guardrails' as const,
  title: 'Confirm this build’s guardrails',
  why: 'Mark each guardrail.',
  items,
});
const NO_CALLS = { name: 'no-new-external-calls', text: 'No new external network calls without a gate' };
const READ_ONLY = { name: 'replay-read-only', text: 'Replay never writes to the source systems' };
const stateOf = (root: string, name: string) => readSnapshot(root, B).guardrails.find((g) => g.entry.name === name)?.state;

describe('guardrail state comes only from gate answers', () => {
  it('is proposed until a gate is answered', () => {
    const root = exampleRepo();
    expect(stateOf(root, NO_CALLS.name)).toBe('proposed');
    openGate(root, B, guardrailGate('build-guardrails', [NO_CALLS, READ_ONLY]), NOW);
    expect(stateOf(root, NO_CALLS.name)).toBe('proposed');
  });
  it('follows the marks, and research keeps it proposed', () => {
    const root = exampleRepo();
    openGate(root, B, guardrailGate('build-guardrails', [NO_CALLS, READ_ONLY]), NOW);
    submitAnswers(root, B, 'build-guardrails', { marks: { [NO_CALLS.name]: 'accepted', [READ_ONLY.name]: 'research' } }, NOW);
    expect(stateOf(root, NO_CALLS.name)).toBe('accepted');
    expect(stateOf(root, READ_ONLY.name)).toBe('proposed');
  });
  it('takes the latest answer when a guardrail is marked again', () => {
    const root = exampleRepo();
    openGate(root, B, guardrailGate('first-guardrails', [NO_CALLS]), NOW);
    submitAnswers(root, B, 'first-guardrails', { marks: { [NO_CALLS.name]: 'accepted' } }, NOW);
    openGate(root, B, guardrailGate('second-guardrails', [NO_CALLS]), LATER);
    submitAnswers(root, B, 'second-guardrails', { marks: { [NO_CALLS.name]: 'declined' } }, LATER);
    expect(stateOf(root, NO_CALLS.name)).toBe('declined');
  });
  it('refuses to withdraw an accepted guardrail', () => {
    const root = exampleRepo();
    openGate(root, B, guardrailGate('build-guardrails', [NO_CALLS]), NOW);
    submitAnswers(root, B, 'build-guardrails', { marks: { [NO_CALLS.name]: 'accepted' } }, NOW);
    expect(() => withdrawGuardrail(root, B, NO_CALLS.name, readSnapshot(root, B).gates)).toThrow(
      /"no-new-external-calls" was accepted at build-guardrails\. Only the user can lift it: open a guardrails gate that lists it again, and they can decline it there\./,
    );
    expect(stateOf(root, NO_CALLS.name)).toBe('accepted');
  });
  it('withdraws a proposal', () => {
    const root = exampleRepo();
    withdrawGuardrail(root, B, NO_CALLS.name, readSnapshot(root, B).gates);
    expect(stateOf(root, NO_CALLS.name)).toBe('withdrawn');
  });
  it('withdraws a declined guardrail', () => {
    const root = exampleRepo();
    openGate(root, B, guardrailGate('build-guardrails', [NO_CALLS]), NOW);
    submitAnswers(root, B, 'build-guardrails', { marks: { [NO_CALLS.name]: 'declined' } }, NOW);
    withdrawGuardrail(root, B, NO_CALLS.name, readSnapshot(root, B).gates);
    expect(stateOf(root, NO_CALLS.name)).toBe('withdrawn');
  });
  it('keeps an accepted guardrail when guardrails.json is edited to withdraw it', () => {
    const root = exampleRepo();
    openGate(root, B, guardrailGate('build-guardrails', [NO_CALLS]), NOW);
    submitAnswers(root, B, 'build-guardrails', { marks: { [NO_CALLS.name]: 'accepted' } }, NOW);
    const file = join(root, '.build', B, 'logs', 'guardrails.json');
    const data = readLog(root, B, 'guardrails');
    writeFileSync(file, JSON.stringify({ entries: data.entries.map((e) => (e.name === NO_CALLS.name ? { ...e, status: 'withdrawn' } : e)) }));
    expect(stateOf(root, NO_CALLS.name)).toBe('accepted');
  });
  it("ignores answers that don't fit their gate", () => {
    const gate: Pick<GateView, 'name' | 'request' | 'answers'> = {
      name: 'build-guardrails',
      request: { ...guardrailGate('build-guardrails', [NO_CALLS, READ_ONLY]), opened: NOW },
      answers: { gate: 'build-guardrails', submitted: NOW, log: 'guardrails', texts: { [NO_CALLS.name]: NO_CALLS.text, [READ_ONLY.name]: READ_ONLY.text }, marks: { [NO_CALLS.name]: 'accepted' } },
    };
    const entries = readLog(exampleRepo(), B, 'guardrails').entries;
    expect(deriveGuardrails(entries, [gate]).map((v) => v.state)).toEqual(['proposed', 'proposed']);
  });
  it('reads a mark only from the answers themselves, so a guardrail named like an object property stays proposed', () => {
    const [first] = readLog(exampleRepo(), B, 'guardrails').entries;
    if (!first) throw new Error('the example build has guardrails');
    const entries = ['constructor', 'toString'].map((name) => ({ ...first, name, text: `Guardrail ${name}` }));
    const gate: Pick<GateView, 'name' | 'request' | 'answers'> = {
      name: 'build-guardrails',
      request: { ...guardrailGate('build-guardrails', entries.map((e) => ({ name: e.name, text: e.text }))), opened: NOW },
      answers: { gate: 'build-guardrails', submitted: NOW, log: 'guardrails', texts: Object.fromEntries(entries.map((e) => [e.name, e.text])), marks: {} },
    };
    expect(deriveGuardrails(entries, [gate]).map((v) => v.state)).toEqual(['proposed', 'proposed']);
  });
  it("can't be accepted by editing guardrails.json", () => {
    const root = exampleRepo();
    const file = join(root, '.build', B, 'logs', 'guardrails.json');
    const data = readLog(root, B, 'guardrails');
    writeFileSync(file, JSON.stringify({ entries: data.entries.map((e) => ({ ...e, status: 'accepted' })) }));
    const s = readSnapshot(root, B);
    expect(s.guardrails).toEqual([]);
    expect(s.problems.map((p) => p.file)).toContain('logs/guardrails.json');
  });
  it('drops back to proposed when the text is edited after acceptance', () => {
    const root = exampleRepo();
    openGate(root, B, guardrailGate('build-guardrails', [NO_CALLS]), NOW);
    submitAnswers(root, B, 'build-guardrails', { marks: { [NO_CALLS.name]: 'accepted' } }, NOW);
    const file = join(root, '.build', B, 'logs', 'guardrails.json');
    const data = readLog(root, B, 'guardrails');
    writeFileSync(file, JSON.stringify({ entries: data.entries.map((e) => (e.name === NO_CALLS.name ? { ...e, text: 'Something softer' } : e)) }));
    expect(stateOf(root, NO_CALLS.name)).toBe('proposed');
  });
  it('ignores a log flag added to an already-answered ordinary gate', () => {
    const root = exampleRepo();
    const { log: _log, ...plain } = guardrailGate('plain-scope', [NO_CALLS]);
    openGate(root, B, plain, NOW);
    submitAnswers(root, B, 'plain-scope', { marks: { [NO_CALLS.name]: 'accepted' } }, NOW);
    const file = join(root, '.build', B, 'gates', 'plain-scope.json');
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), log: 'guardrails' }));
    expect(stateOf(root, NO_CALLS.name)).toBe('proposed');
  });
  it('stamps log and texts on a guardrail gate and ignores body-supplied ones elsewhere', () => {
    const root = exampleRepo();
    openGate(root, B, guardrailGate('build-guardrails', [NO_CALLS]), NOW);
    const stamped = submitAnswers(root, B, 'build-guardrails', { marks: { [NO_CALLS.name]: 'accepted' }, texts: { [NO_CALLS.name]: 'forged' } }, NOW);
    expect(stamped).toMatchObject({ log: 'guardrails', texts: { [NO_CALLS.name]: NO_CALLS.text } });
    const { log: _log, ...plain } = guardrailGate('plain-scope', [NO_CALLS]);
    openGate(root, B, plain, NOW);
    const answers = submitAnswers(root, B, 'plain-scope', { marks: { [NO_CALLS.name]: 'accepted' }, log: 'guardrails', texts: { [NO_CALLS.name]: NO_CALLS.text } }, NOW);
    expect(answers.log).toBeUndefined();
    expect(answers.texts).toBeUndefined();
  });
  it('ignores marks from ordinary mark-list gates', () => {
    const root = exampleRepo();
    const { log: _log, ...plain } = guardrailGate('plain-scope', [NO_CALLS]);
    openGate(root, B, plain, NOW);
    submitAnswers(root, B, 'plain-scope', { marks: { [NO_CALLS.name]: 'accepted' } }, NOW);
    expect(stateOf(root, NO_CALLS.name)).toBe('proposed');
  });
});

describe('guardrail gates', () => {
  it('only take proposed guardrails, with their exact text', () => {
    const root = exampleRepo();
    expect(() => openGate(root, B, guardrailGate('build-guardrails', [{ name: 'made-up-rule', text: 'x' }]), NOW)).toThrow(/not a proposed guardrail/);
    expect(() => openGate(root, B, guardrailGate('build-guardrails', [{ ...NO_CALLS, text: 'Something softer' }]), NOW)).toThrow(/exactly as proposed/);
    withdrawGuardrail(root, B, NO_CALLS.name, readSnapshot(root, B).gates);
    expect(() => openGate(root, B, guardrailGate('build-guardrails', [NO_CALLS]), NOW)).toThrow(/not a proposed guardrail/);
  });
  it('must be mark-list gates', () => {
    const root = exampleRepo();
    const approve = { name: 'odd-gate', type: 'approve' as const, log: 'guardrails' as const, title: 'x', why: 'y' };
    expect(() => openGate(root, B, approve, NOW)).toThrow(/invalid/);
  });
  it('leave the decision log and open questions alone when applied', () => {
    const root = exampleRepo();
    const before = { d: readLog(root, B, 'decisions'), q: readLog(root, B, 'questions') };
    openGate(root, B, guardrailGate('build-guardrails', [NO_CALLS]), NOW);
    submitAnswers(root, B, 'build-guardrails', { marks: { [NO_CALLS.name]: 'accepted' } }, NOW);
    const summary = applyAnswers(root, B, 'build-guardrails', LATER);
    expect(summary).toMatchObject({ log: 'guardrails', accepted: [NO_CALLS.name] });
    expect(readLog(root, B, 'decisions')).toEqual(before.d);
    expect(readLog(root, B, 'questions')).toEqual(before.q);
    expect(stateOf(root, NO_CALLS.name)).toBe('accepted');
  });
  it('accept conflict notes on rows', () => {
    const root = exampleRepo();
    const gate = { name: 'scope-check', type: 'mark-list' as const, title: 'x', why: 'y', items: [{ name: 'dry-run', text: 'Dry-run mode', conflicts: ['replay-read-only'] }] };
    expect(openGate(root, B, gate, NOW).items?.[0]?.conflicts).toEqual(['replay-read-only']);
  });
});

function io(cwd: string) {
  const out: string[] = [];
  const err: string[] = [];
  const value: CliIO = { cwd, out: (l) => out.push(l), err: (l) => err.push(l), now: () => NOW, readStdin: async () => '', env: {} };
  return { value, out, err };
}

describe('guardrail command', () => {
  it('proposes, lists and withdraws', async () => {
    const root = exampleRepo();
    const t = io(root);
    expect(await main(['guardrail', 'propose', 'no-force-push', '--text', 'Never force-push', '--source', 'chat 15:00', '--raised-by', 'user', '--quote', 'no force pushes'], t.value)).toBe(0);
    expect(t.out[0]).toMatch(/only once the user accepts it at a gate/);
    const l = io(root);
    expect(await main(['guardrail', 'list'], l.value)).toBe(0);
    expect(l.out.join('\n')).toMatch(/proposed\s+no-force-push: Never force-push/);
    expect(await main(['guardrail', 'withdraw', 'no-force-push'], io(root).value)).toBe(0);
    expect(readLog(root, B, 'guardrails').entries.find((e) => e.name === 'no-force-push')?.status).toBe('withdrawn');
  });
  it('lists only accepted guardrails for dispatch briefs', async () => {
    const root = exampleRepo();
    openGate(root, B, guardrailGate('build-guardrails', [NO_CALLS, READ_ONLY]), NOW);
    submitAnswers(root, B, 'build-guardrails', { marks: { [NO_CALLS.name]: 'accepted', [READ_ONLY.name]: 'declined' } }, NOW);
    const t = io(root);
    expect(await main(['guardrail', 'list', '--accepted'], t.value)).toBe(0);
    expect(t.out.join('\n')).toBe(`- ${NO_CALLS.text} (${NO_CALLS.name})`);
  });
  it('refuses an unknown raiser and the log commands', async () => {
    const root = exampleRepo();
    const t = io(root);
    expect(await main(['guardrail', 'propose', 'some-rule', '--text', 'x', '--source', 'y', '--raised-by', 'boss'], t.value)).toBe(1);
    expect(t.err[0]).toMatch(/user, claude, agent/);
    const s = io(root);
    expect(await main(['log', 'status', 'guardrails', NO_CALLS.name, 'withdrawn'], s.value)).toBe(1);
    expect(s.err[0]).toMatch(/own command/);
  });
});
