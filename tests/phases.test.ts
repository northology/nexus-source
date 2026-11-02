import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkNewBuild, createBuild, readBuild, setStage } from '../core/build.ts';
import { applyAnswers, openGate, readGate, submitAnswers } from '../core/gates.ts';
import { activeBuilds, changeStage, finishApproved } from '../core/lifecycle.ts';
import { readLog } from '../core/logs.ts';
import { checkPhaseStart, currentPhase, phasesOf, startPhase } from '../core/phases.ts';
import { runGuard } from '../hooks/guard.ts';
import { main, type CliIO } from '../scripts/cli.ts';
import { exampleRepo, finishPhase, readJsonFile, tempDir, treeHash, NOW, LATER } from './helpers.ts';

const B = 'relay-rebuild';
function io(cwd: string) {
  const out: string[] = [];
  const err: string[] = [];
  const value: CliIO = { cwd, out: (l) => out.push(l), err: (l) => err.push(l), now: () => NOW, readStdin: async () => '', env: {} };
  return { value, out, err };
}

describe('phases', () => {
  it('a new build starts its first phase, named after the build unless told otherwise', () => {
    const root = tempDir();
    createBuild(root, { name: 'nexus-system', branch: 'build/nexus-system', now: NOW });
    expect(readBuild(root, 'nexus-system')).toMatchObject({ phase: 'nexus-system', phases: [{ name: 'nexus-system', branch: 'build/nexus-system', started: NOW, finished: null }] });
    createBuild(root, { name: 'other-system', branch: 'b', now: NOW, phase: 'foundation' });
    expect(currentPhase(readBuild(root, 'other-system'))).toBe('foundation');
  });
  it('a build name over 48 characters is refused, short first phase or not, so every gate it opens stays a valid name', () => {
    const root = tempDir();
    const long = `relay-${'a'.repeat(50)}`;
    expect(() => createBuild(root, { name: long, branch: 'b', now: NOW })).toThrow(/48/);
    expect(() => createBuild(root, { name: long, branch: 'b', now: NOW, phase: 'first-pass' })).toThrow(/48/);
    expect(currentPhase((createBuild(root, { name: 'relay-rebuild', branch: 'b', now: NOW, phase: 'first-pass' }), readBuild(root, 'relay-rebuild')))).toBe('first-pass');
  });
  it('builds from before phases read as one phase named after the build', () => {
    const root = exampleRepo();
    const file = join(root, '.build', B, 'build.json');
    const { phase: _p, phases: _ps, ...old } = readJsonFile(file) as Record<string, unknown>;
    writeFileSync(file, JSON.stringify(old));
    const build = readBuild(root, B);
    expect(currentPhase(build)).toBe(B);
    expect(phasesOf(build)).toEqual([{ name: B, branch: 'build/relay-rebuild', started: '2026-10-02T11:05:00-06:00', finished: null }]);
  });
  it('starting a phase on a build from before phases records the original phase and the new one', () => {
    const root = exampleRepo();
    const file = join(root, '.build', B, 'build.json');
    const { phase: _p, phases: _ps, ...old } = readJsonFile(file) as Record<string, unknown>;
    writeFileSync(file, JSON.stringify(old));
    finishPhase(root, B, B);
    const build = startPhase(root, B, 'dashboard', { branch: 'build/relay-rebuild-dashboard', now: LATER });
    expect(build.phase).toBe('dashboard');
    expect(build.phases?.map((p) => [p.name, p.finished])).toEqual([[B, LATER], ['dashboard', null]]);
    expect(readBuild(root, B).phases).toEqual(build.phases);
  });
  it('the next phase starts only once the current one is in close-out', () => {
    const root = exampleRepo();
    expect(() => startPhase(root, B, 'dashboard', { branch: 'build/dashboard', now: LATER })).toThrow(/still active/);
    setStage(root, B, 'close-out');
    const build = startPhase(root, B, 'dashboard', { branch: 'build/dashboard', now: LATER });
    expect(build).toMatchObject({ phase: 'dashboard', stage: 'planning', branch: 'build/dashboard' });
    expect(build.phases?.map((p) => [p.name, p.finished])).toEqual([['replay', LATER], ['dashboard', null]]);
  });
  it('refuses a repeated or unreadable phase name', () => {
    const root = exampleRepo();
    setStage(root, B, 'close-out');
    expect(() => startPhase(root, B, 'replay', { branch: 'b', now: LATER })).toThrow(/already has a phase named "replay"/);
    expect(() => startPhase(root, B, 'p2', { branch: 'b', now: LATER })).toThrow(/readable name/);
    expect(() => startPhase(root, B, `phase-${'a'.repeat(50)}`, { branch: 'b', now: LATER })).toThrow(/48/);
  });
  it('entries a gate creates take the gate phase', () => {
    const root = exampleRepo();
    openGate(root, B, { name: 'pause-scope', type: 'mark-list', title: 'x', why: 'y', phase: 'replay', items: [{ name: 'pause-switch', text: 'Per-source pause switch' }] }, NOW);
    submitAnswers(root, B, 'pause-scope', { marks: { 'pause-switch': 'accepted' } }, NOW);
    applyAnswers(root, B, 'pause-scope', LATER);
    expect(readLog(root, B, 'decisions').entries.find((e) => e.name === 'pause-switch')?.phase).toBe('replay');
  });
  it('checks a phase start without writing anything', () => {
    const root = exampleRepo();
    const before = treeHash(root);
    expect(() => checkPhaseStart(root, B, 'dashboard')).toThrow(/still active/);
    setStage(root, B, 'close-out');
    const after = treeHash(root);
    expect(checkPhaseStart(root, B, 'dashboard').name).toBe(B);
    expect(() => checkPhaseStart(root, B, 'replay')).toThrow(/already has a phase named "replay"/);
    expect(() => checkPhaseStart(root, B, 'p2')).toThrow(/phase-2/);
    expect(treeHash(root)).toBe(after);
    expect(before).not.toBe(after);
  });
  it('checks a new build without writing anything', () => {
    const root = tempDir();
    expect(checkNewBuild(root, { name: 'nexus-system' })).toEqual({ name: 'nexus-system', phase: 'nexus-system' });
    expect(checkNewBuild(root, { name: 'nexus-system', phase: 'phase-1' })).toEqual({ name: 'nexus-system', phase: 'phase-1' });
    expect(() => checkNewBuild(root, { name: 'animation-test', phase: 'p1' })).toThrow(/phase name "p1"/);
    expect(existsSync(join(root, '.build'))).toBe(false);
    createBuild(root, { name: 'nexus-system', branch: 'b', now: NOW });
    expect(() => checkNewBuild(root, { name: 'nexus-system' })).toThrow(/already exists/);
  });
});

describe('phase on the command line', () => {
  it('tags log entries, guardrails and gates with the current phase', async () => {
    const root = exampleRepo();
    expect(await main(['log', 'add', 'questions', 'replay-window', '--text', 'How far back?', '--status', 'exploring', '--source', 'chat'], io(root).value)).toBe(0);
    expect(readLog(root, B, 'questions').entries.find((e) => e.name === 'replay-window')?.phase).toBe('replay');
    expect(await main(['guardrail', 'propose', 'no-force-push', '--text', 'Never force-push', '--source', 'chat', '--raised-by', 'user'], io(root).value)).toBe(0);
    expect(readLog(root, B, 'guardrails').entries.find((e) => e.name === 'no-force-push')?.phase).toBe('replay');
    const req = join(root, 'req.json');
    writeFileSync(req, JSON.stringify({ name: 'quick-check', type: 'approve', title: 'x', why: 'y' }));
    expect(await main(['gate', 'open', req], io(root).value)).toBe(0);
    expect(readGate(root, B, 'quick-check').phase).toBe('replay');
  });
  it('starts a phase', async () => {
    const root = exampleRepo();
    const t = io(root);
    expect(await main(['phase', 'start', 'dashboard', '--branch', 'build/dashboard'], t.value)).toBe(1);
    expect(t.err[0]).toMatch(/still active/);
    setStage(root, B, 'close-out');
    const ok = io(root);
    expect(await main(['phase', 'start', 'dashboard', '--branch', 'build/dashboard'], ok.value)).toBe(0);
    expect(ok.out[0]).toBe('Started phase "dashboard" (2 of 2) at stage planning.');
  });
  it('names the first phase on new', async () => {
    const root = tempDir();
    expect(await main(['new', 'nexus-system', '--phase', 'foundation', '--branch', 'b'], io(root).value)).toBe(0);
    expect(currentPhase(readBuild(root, 'nexus-system'))).toBe('foundation');
  });
  it('close-out is one-way: only phase start leaves it', () => {
    const root = exampleRepo();
    finishPhase(root);
    expect(() => changeStage(root, B, 'planning', LATER)).toThrow('Phase "replay" is closed. Start the next phase with `nexus phase start <name>`.');
    expect(readBuild(root, B).stage).toBe('close-out');
    expect(activeBuilds(root)).toEqual([]);
  });
  it('a closed phase still starts the next', () => {
    const root = exampleRepo();
    finishPhase(root);
    expect(startPhase(root, B, 'dashboard', { branch: 'build/relay-rebuild-dashboard', now: LATER }).stage).toBe('planning');
    expect(changeStage(root, B, 'plan', LATER).stage).toBe('plan');
  });
  it('upgrades the old .build/.gitattributes that marked binaries as text', () => {
    const root = exampleRepo();
    const attributes = join(root, '.build', '.gitattributes');
    writeFileSync(attributes, '* text eol=lf\n');
    finishPhase(root);
    startPhase(root, B, 'dashboard', { branch: 'build/relay-rebuild-dashboard', now: LATER });
    expect(readFileSync(attributes, 'utf8')).toBe('* text=auto eol=lf\n');
  });
});

describe('a sent-back finish gate', () => {
  const finish = (name: string) => ({ name, phase: 'replay', step: 'finish' as const, type: 'approve' as const, title: 'Finish replay', why: 'w' });
  function sendBack(root: string): void {
    setStage(root, B, 'build');
    openGate(root, B, finish('finish-replay'), NOW);
    submitAnswers(root, B, 'finish-replay', { decision: 'send-back', note: 'Fix the flaky test first' }, NOW);
    applyAnswers(root, B, 'finish-replay', LATER);
  }
  function forceCloseOut(root: string): void {
    const file = join(root, '.build', B, 'build.json');
    writeFileSync(file, JSON.stringify({ ...(JSON.parse(readFileSync(file, 'utf8')) as object), stage: 'close-out' }));
  }
  it('is reopened as finish-<phase>-2, whose approval closes the phase and lowers the wall', () => {
    const root = exampleRepo();
    sendBack(root);
    expect(() => openGate(root, B, finish('finish-replay'), LATER)).toThrow(/already answered/);
    openGate(root, B, finish('finish-replay-2'), LATER);
    submitAnswers(root, B, 'finish-replay-2', { decision: 'approve' }, LATER);
    expect(finishApproved(root, B)).toBe(true);
    expect(changeStage(root, B, 'close-out', LATER).stage).toBe('close-out');
    applyAnswers(root, B, 'finish-replay-2', LATER);
    expect(activeBuilds(root)).toEqual([]);
    const out = runGuard({ cwd: root, tool_name: 'Write', tool_input: { file_path: join(root, 'CLAUDE.md') } }, { home: tempDir('nexus-home-'), win: process.platform === 'win32', now: new Date('2026-10-02T21:10:00Z') });
    expect(out).toBe('');
  });
  it('alone leaves the phase open, and the refusal names the reopened gate', () => {
    const root = exampleRepo();
    sendBack(root);
    expect(finishApproved(root, B)).toBe(false);
    expect(() => changeStage(root, B, 'close-out', LATER)).toThrow(/approves the "finish-replay" gate.*reopened as "finish-replay-2"/);
    expect(activeBuilds(root)).toEqual([B]);
    forceCloseOut(root);
    expect(activeBuilds(root)).toEqual([B]);
  });
  it("counts only approvals filed under the gate's own name", () => {
    const root = exampleRepo();
    sendBack(root);
    const gates = join(root, '.build', B, 'gates');
    writeFileSync(join(gates, 'finish-replay-2.answers.json'), JSON.stringify({ gate: 'finish-replay', decision: 'approve', submitted: NOW }));
    writeFileSync(join(gates, 'finish-replay-02.answers.json'), JSON.stringify({ gate: 'finish-replay-02', decision: 'approve', submitted: NOW }));
    writeFileSync(join(gates, 'finish-replay-1.answers.json'), JSON.stringify({ gate: 'finish-replay-1', decision: 'approve', submitted: NOW }));
    forceCloseOut(root);
    expect(activeBuilds(root)).toEqual([B]);
  });
  it('refuses a later phase whose finish gate an earlier phase already used', () => {
    const root = exampleRepo();
    sendBack(root);
    openGate(root, B, finish('finish-replay-2'), LATER);
    submitAnswers(root, B, 'finish-replay-2', { decision: 'approve' }, LATER);
    changeStage(root, B, 'close-out', LATER);
    applyAnswers(root, B, 'finish-replay-2', LATER);
    expect(() => checkPhaseStart(root, B, 'replay-2')).toThrow(/finish-replay-2/);
    expect(() => startPhase(root, B, 'replay-2', { branch: 'b', now: LATER })).toThrow(/finish-replay-2/);
    expect(startPhase(root, B, 'replay-again', { branch: 'b', now: LATER }).phase).toBe('replay-again');
  });
  it('refuses an earlier name whose reopened finish gate a later phase already used', () => {
    const root = exampleRepo();
    setStage(root, B, 'close-out');
    startPhase(root, B, 'dash-2', { branch: 'b', now: LATER });
    finishPhase(root, B, 'dash-2');
    expect(() => startPhase(root, B, 'dash', { branch: 'b', now: LATER })).toThrow(/finish-dash-2/);
  });
});
