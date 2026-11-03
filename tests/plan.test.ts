import { describe, it, expect } from 'vitest';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyAnswers, indexPlanGate, openGate, submitAnswers } from '../core/gates.ts';
import { NexusError } from '../core/errors.ts';
import { readBuild, setStage } from '../core/build.ts';
import { startPhase } from '../core/phases.ts';
import { readLog } from '../core/logs.ts';
import { indexLine, indexPlan, newId, parsePlanTasks, readPlanFile } from '../core/plan.ts';
import { validate } from '../core/schemas.ts';
import type { GateRequest } from '../core/types.ts';
import { main, unnamed, utcMinute, type CliIO } from '../scripts/cli.ts';
import { ARTIFACTS, exampleRepo, LATER, NOW, planRepo, readJsonFile } from './helpers.ts';

const B = 'relay-rebuild';
const FIXTURES = join(ARTIFACTS, 'tests', 'fixtures', 'plans');
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

/** A plan gate request for a fixture plan copied into the example build's replay phase. */
function planGate(root: string, file = 'splash-plan.md'): GateRequest {
  const dir = join(root, '.build', B, 'documents', 'plans', 'replay');
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(FIXTURES, file), join(dir, file));
  return { name: 'plan-replay', step: 'plan', phase: 'replay', type: 'approve', title: 'Approve the replay plan', why: 'The order of the work.', opened: NOW, document: `documents/plans/replay/${file}` };
}

describe('parsePlanTasks', () => {
  it('reads both acceptance-run plans', () => {
    expect(parsePlanTasks(fixture('splash-plan.md'))).toEqual({
      title: 'Splash Page Implementation Plan',
      tasks: [
        { number: 1, title: 'Timeline', steps: 6 },
        { number: 2, title: 'Shapes', steps: 5 },
        { number: 3, title: 'Motion', steps: 5 },
        { number: 4, title: 'Renderer', steps: 5 },
        { number: 5, title: 'Page and main', steps: 6 },
        { number: 6, title: 'Local server', steps: 6 },
        { number: 7, title: 'Browser checks', steps: 7 },
      ],
    });
    const replay = parsePlanTasks(fixture('replay-theme-plan.md'));
    expect(replay.title).toBe('Replay and Dark Theme Implementation Plan');
    expect(replay.tasks.map((t) => [t.title, t.steps])).toEqual([['Shimmer fade', 5], ['Host check', 5], ['Theme palettes', 5], ['Controls and theme wiring', 5], ['Browser checks', 10]]);
  });
  it('ignores task headings inside fenced code, and steps outside a task', () => {
    const md = [
      '# Plan',
      '- [ ] **Step 0: not in a task**',
      '```markdown',
      '### Task 9: Example in a code block',
      '- [ ] **Step 1: x**',
      '```',
      '### Task 1: Real',
      '- [ ] **Step 1: a**',
      '- [x] **Step 2: b**',
      '## Notes',
      '- [ ] **Step 3: after the task**',
    ].join('\n');
    expect(parsePlanTasks(md)).toEqual({ title: 'Plan', tasks: [{ number: 1, title: 'Real', steps: 2 }] });
  });
  it('does not read a prose line that starts with an inline code span as a fence', () => {
    const md = [
      '# Plan',
      '### Task 1: Before',
      '- [ ] **Step 1: a**',
      '  ```` ``` ```` and a `### Task 9:` line, wrapped from the list item above',
      '### Task 2: After',
      '- [ ] **Step 1: b**',
      '- [ ] **Step 2: c**',
    ].join('\n');
    expect(parsePlanTasks(md).tasks).toEqual([{ number: 1, title: 'Before', steps: 1 }, { number: 2, title: 'After', steps: 2 }]);
  });
  it('reads every task of the remediation plan, which holds such a line', () => {
    const md = readFileSync(join(ARTIFACTS, 'tests', 'fixtures', 'plans', 'plan-section-remediation-plan.md'), 'utf8');
    expect(parsePlanTasks(md).tasks.map((t) => t.steps)).toEqual([10, 7, 7, 7]);
  });
  it('closes a fence only on a matching fence', () => {
    const md = [
      '# Plan',
      '### Task 1: First',
      '````markdown',
      '```',
      '### Task 9: Inside the four-backtick fence',
      '```',
      '````',
      '### Task 2: Second',
      '~~~',
      '````',
      '### Task 8: Inside the tilde fence',
      '~~~~ trailing',
      '~~~~',
      '### Task 3: Third',
    ].join('\n');
    expect(parsePlanTasks(md).tasks.map((t) => t.number)).toEqual([1, 2, 3]);
  });
  it('has no title without a # heading, and no tasks without task headings', () => {
    expect(parsePlanTasks('## Only a section\n\nText.')).toEqual({ title: null, tasks: [] });
  });
  it('counts a task heading with no steps as zero steps', () => {
    expect(parsePlanTasks('### Task 1: Browser checks\n\nLook at it.').tasks).toEqual([{ number: 1, title: 'Browser checks', steps: 0 }]);
  });
});

describe('newId', () => {
  it('makes opaque IDs that never repeat', () => {
    const taken = new Set<string>();
    const ids = Array.from({ length: 200 }, () => newId('t', taken));
    for (const id of ids) expect(id).toMatch(/^t-[0-9a-f]{8}$/);
    expect(new Set(ids).size).toBe(200);
    expect(newId('p', taken)).toMatch(/^p-[0-9a-f]{8}$/);
  });
});

describe('indexPlan', () => {
  it('adds the plan with its tasks, each with an opaque ID', () => {
    const root = exampleRepo();
    expect(indexPlan(root, B, planGate(root), NOW)).toEqual({ file: 'splash-plan.md', tasks: 7 });
    const file = readPlanFile(root, B);
    expect(validate('plan', file)).toEqual([]);
    const plan = file.plans?.[0];
    expect(plan).toMatchObject({ phase: 'replay', gate: 'plan-replay', document: 'documents/plans/replay/splash-plan.md', title: 'Splash Page Implementation Plan', indexed: NOW, record: null });
    expect(plan?.id).toMatch(/^p-[0-9a-f]{8}$/);
    expect(plan?.tasks.map((t) => t.title)).toEqual(['Timeline', 'Shapes', 'Motion', 'Renderer', 'Page and main', 'Local server', 'Browser checks']);
    expect(new Set(plan?.tasks.map((t) => t.id)).size).toBe(7);
  });
  it("indexes a request with no phase under the build's current phase", () => {
    const root = exampleRepo();
    const { phase: _phase, ...req } = planGate(root);
    setStage(root, B, 'close-out');
    startPhase(root, B, 'dashboard', { branch: 'build/dashboard', now: LATER });
    indexPlan(root, B, req, NOW);
    expect(readBuild(root, B).phase).toBe('dashboard');
    expect(readPlanFile(root, B).plans?.[0]?.phase).toBe('dashboard');
  });
  it('refuses a gate already indexed', () => {
    const root = exampleRepo();
    const req = planGate(root);
    indexPlan(root, B, req, NOW);
    expect(() => indexPlan(root, B, req, NOW)).toThrow(/already indexed/);
  });
  it('indexes nothing when the document is gone', () => {
    const root = exampleRepo();
    const req: GateRequest = { ...planGate(root), document: 'documents/plans/replay/missing.md' };
    expect(indexPlan(root, B, req, NOW)).toEqual({ file: 'missing.md', tasks: null });
    expect(readPlanFile(root, B).plans ?? []).toEqual([]);
  });
  it('keeps a plan with no tasks, titled by its file name', () => {
    const root = exampleRepo();
    const req = planGate(root);
    writeFileSync(join(root, '.build', B, 'documents', 'plans', 'replay', 'splash-plan.md'), 'Just prose.\n');
    expect(indexPlan(root, B, req, NOW)).toEqual({ file: 'splash-plan.md', tasks: 0 });
    expect(readPlanFile(root, B).plans?.[0]).toMatchObject({ title: 'splash-plan.md', tasks: [] });
  });
  it('a second plan for the same phase is a new entry with new IDs', () => {
    const root = exampleRepo();
    indexPlan(root, B, planGate(root), NOW);
    indexPlan(root, B, { ...planGate(root), name: 'plan-replay-2' }, NOW);
    const [a, b] = readPlanFile(root, B).plans ?? [];
    expect(b?.gate).toBe('plan-replay-2');
    expect(a?.tasks.some((t) => b?.tasks.some((u) => u.id === t.id))).toBe(false);
    expect(a?.id).not.toBe(b?.id);
  });
});

function statusOf(fn: () => unknown): number | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof NexusError ? e.status : undefined;
  }
  return undefined;
}
function cli(root: string) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIO = { cwd: root, out: (l) => out.push(l), err: (l) => err.push(l), now: () => '2026-10-02T21:00:00Z', readStdin: async () => '', env: {} };
  return { io, out, err };
}
function openPlanGate(root: string, name = 'plan-replay'): string {
  openGate(root, B, { ...planGate(root), name }, NOW);
  return name;
}

describe('an approved plan gate', () => {
  it('indexes its plan when applied', () => {
    const root = exampleRepo();
    openPlanGate(root);
    submitAnswers(root, B, 'plan-replay', { decision: 'approve' }, NOW);
    expect(applyAnswers(root, B, 'plan-replay', LATER).indexed).toEqual({ file: 'splash-plan.md', tasks: 7 });
    expect(readPlanFile(root, B).plans).toHaveLength(1);
  });
  it('a sent-back plan gate indexes nothing', () => {
    const root = exampleRepo();
    openPlanGate(root);
    submitAnswers(root, B, 'plan-replay', { decision: 'send-back', note: 'Split task 4.' }, NOW);
    expect(applyAnswers(root, B, 'plan-replay', LATER).indexed).toBeUndefined();
    expect(readPlanFile(root, B).plans ?? []).toEqual([]);
  });
  it('an approve gate without "step": "plan" indexes nothing', () => {
    const root = exampleRepo();
    const { step: _step, ...request } = planGate(root);
    openGate(root, B, { ...request, name: 'plan-review' }, NOW);
    submitAnswers(root, B, 'plan-review', { decision: 'approve' }, NOW);
    expect(applyAnswers(root, B, 'plan-review', LATER).indexed).toBeUndefined();
  });
  it('applying again does not index twice', () => {
    const root = planRepo();
    expect(applyAnswers(root, B, 'plan-replay', LATER).indexed).toBeUndefined();
    expect(readPlanFile(root, B).plans).toHaveLength(1);
  });
  it('gate apply says what was indexed', async () => {
    const root = exampleRepo();
    openPlanGate(root);
    submitAnswers(root, B, 'plan-replay', { decision: 'approve' }, NOW);
    const { io, out } = cli(root);
    expect(await main(['gate', 'apply', 'plan-replay'], io)).toBe(0);
    expect(out.join('\n')).toContain('Indexed 7 tasks from splash-plan.md.');
  });
});

describe('applying a plan gate whose plan cannot be indexed', () => {
  it('a deleted document indexes nothing and says why', async () => {
    const root = exampleRepo();
    openPlanGate(root);
    submitAnswers(root, B, 'plan-replay', { decision: 'approve' }, NOW);
    rmSync(join(root, '.build', B, 'documents', 'plans', 'replay', 'splash-plan.md'));
    const { io, out } = cli(root);
    expect(await main(['gate', 'apply', 'plan-replay'], io)).toBe(0);
    expect(out.join('\n')).toContain('splash-plan.md is missing, so no tasks were indexed.');
    expect(readPlanFile(root, B).plans ?? []).toEqual([]);
  });
  it('an invalid plan.json is reported, not thrown, and the approval is still recorded', async () => {
    const root = exampleRepo();
    openPlanGate(root);
    submitAnswers(root, B, 'plan-replay', { decision: 'approve' }, NOW);
    writeFileSync(join(root, '.build', B, 'plan.json'), '{ "plans": 1 }');
    const { io, out } = cli(root);
    expect(await main(['gate', 'apply', 'plan-replay'], io)).toBe(0);
    expect(out.join('\n')).toContain("Couldn't index splash-plan.md:");
    expect(out.join('\n')).toContain('nexus plan index plan-replay');
    expect(readLog(root, B, 'decisions').entries.some((e) => e.name === 'plan-replay' && e.status === 'accepted')).toBe(true);
  });
  it('a document path that is a folder is reported, not thrown', () => {
    const root = exampleRepo();
    openPlanGate(root);
    submitAnswers(root, B, 'plan-replay', { decision: 'approve' }, NOW);
    mkdirSync(join(root, '.build', B, 'documents', 'plans', 'replay', 'folder.md'));
    const gateFile = join(root, '.build', B, 'gates', 'plan-replay.json');
    const request = readJsonFile(gateFile) as GateRequest;
    writeFileSync(gateFile, JSON.stringify({ ...request, document: 'documents/plans/replay/folder.md' }));
    const indexed = applyAnswers(root, B, 'plan-replay', LATER).indexed;
    expect(indexed?.tasks).toBeNull();
    expect(indexed?.error).toBeTruthy();
    expect(readPlanFile(root, B).plans ?? []).toEqual([]);
  });
});

describe('nexus plan index', () => {
  it('indexes a plan gate approved before nexus tracked tasks, once', async () => {
    const root = exampleRepo();
    openPlanGate(root);
    submitAnswers(root, B, 'plan-replay', { decision: 'approve' }, NOW);
    const first = cli(root);
    expect(await main(['plan', 'index', 'plan-replay'], first.io)).toBe(0);
    expect(first.out).toEqual(['Indexed 7 tasks from splash-plan.md.']);
    const again = cli(root);
    expect(await main(['plan', 'index', 'plan-replay'], again.io)).toBe(1);
    expect(again.err.join('\n')).toMatch(/already indexed/);
    expect(statusOf(() => indexPlanGate(root, B, 'plan-replay', NOW))).toBe(409);
  });
  it('refuses a gate that is not a plan gate, or was not approved', async () => {
    const root = exampleRepo();
    const notPlan = cli(root);
    expect(await main(['plan', 'index', 'scope'], notPlan.io)).toBe(1);
    expect(notPlan.err.join('\n')).toMatch(/isn't a plan gate/);
    expect(statusOf(() => indexPlanGate(root, B, 'scope', NOW))).toBe(400);
    openPlanGate(root);
    submitAnswers(root, B, 'plan-replay', { decision: 'send-back', note: 'No.' }, NOW);
    const sentBack = cli(root);
    expect(await main(['plan', 'index', 'plan-replay'], sentBack.io)).toBe(1);
    expect(sentBack.err.join('\n')).toMatch(/wasn't approved/);
    expect(statusOf(() => indexPlanGate(root, B, 'plan-replay', NOW))).toBe(409);
  });
});

describe('nexus plan', () => {
  it('prints the summary and one line per task, by title', async () => {
    const root = planRepo();
    const ledger = join(root, '.superpowers', 'sdd', 'splash-plan');
    mkdirSync(ledger, { recursive: true });
    writeFileSync(join(ledger, 'progress.md'), '# SDD ledger — plan: .build/relay-rebuild/documents/plans/replay/splash-plan.md\nTask 1: complete (commits 58461c3..49f5b27, review clean)\n');
    const { io, out } = cli(root);
    expect(await main(['plan'], io)).toBe(0);
    expect(out[0]).toBe('Splash Page Implementation Plan (replay, approved at plan-replay)');
    expect(out[1]).toMatch(/^1 of 7 done · in progress: Shapes · 5 pending · ledger read \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
    expect(out[2]).toMatch(/^done\s+Timeline\s+58461c3\.\.49f5b27$/);
    expect(out[3]).toMatch(/^in progress\s+Shapes$/);
    expect(out).toHaveLength(9);
    expect(out.join('\n')).not.toMatch(/Task \d/);
  });
  it('says when the phase has no plan', async () => {
    const { io, out } = cli(exampleRepo());
    expect(await main(['plan'], io)).toBe(0);
    expect(out).toEqual(['No approved plan for replay yet. It appears once its plan gate is approved.']);
  });
  it("says when plan.json can't be read", async () => {
    const root = planRepo();
    writeFileSync(join(root, '.build', B, 'plan.json'), '{ "plans": 1 }');
    const { io, out, err } = cli(root);
    expect(await main(['plan'], io)).toBe(1);
    expect(out).toEqual([]);
    expect(err.join('\n')).toMatch(/^plan\.json can't be read: .*plans must be array/);
    expect(err.join('\n').match(/plan\.json/g)).toHaveLength(1);
  });
  it('shows the time a record was kept in UTC, whatever offset it was stored with', async () => {
    const root = planRepo();
    const file = join(root, '.build', B, 'plan.json');
    const plans = JSON.parse(readFileSync(file, 'utf8'));
    plans.plans[0].record = { imported: '2026-10-04T13:12:05-06:00', ledger: '.superpowers/sdd/gone/progress.md', tasks: {}, final: { rulings: 0, minors: 0 } };
    writeFileSync(file, JSON.stringify(plans));
    const { io, out } = cli(root);
    expect(await main(['plan'], io)).toBe(0);
    expect(out[1]).toMatch(/ · record kept 2026-10-04 19:12 UTC$/);
  });
  it('prints a time that does not parse as written, without UTC', () => {
    // plan.json's schema refuses such a time, so the formatter is called directly.
    expect(utcMinute('last Tuesday')).toBe('last Tuesday');
    expect(utcMinute('2026-10-04T13:12:05-06:00')).toBe('2026-10-04 19:12 UTC');
  });
  it('drops the repeated file name from the reason plan.json cannot be read', () => {
    expect(unnamed('plan.json is invalid: /plans must be array.')).toBe('invalid: /plans must be array.');
    expect(unnamed('plan.json is not valid JSON: Unexpected token')).toBe('not valid JSON: Unexpected token');
    expect(unnamed('plan.json cannot be read: EACCES: permission denied')).toBe('EACCES: permission denied');
    expect(unnamed('plan.json would be invalid: /plans must be array.')).toBe('would be invalid: /plans must be array.');
    expect(unnamed('something else')).toBe('something else');
  });
  it('names the reason an index failed with one full stop', () => {
    expect(indexLine({ file: 'p.md', tasks: null, error: 'plan.json is invalid: /plans must be array.' }, 'plan-replay')).toBe("Couldn't index p.md: plan.json is invalid: /plans must be array. Run `nexus plan index plan-replay` once it's fixed.");
  });
});
