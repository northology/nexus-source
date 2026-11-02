import { describe, it, expect } from 'vitest';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readBuild, setStage } from '../core/build.ts';
import { startPhase } from '../core/phases.ts';
import { readLog } from '../core/logs.ts';
import { indexPlan, readPlanFile, writePlanFile } from '../core/plan.ts';
import { findLedgers, importRun, ledgerPlanPaths, planProgress, readLedgerProgress } from '../core/progress.ts';
import { readSnapshot } from '../core/snapshot.ts';
import type { LogEntry, PlanEntry, PlanProgress, TaskProgress } from '../core/types.ts';
import { main, type CliIO } from '../scripts/cli.ts';
import { LATER, PLAN_FIXTURES, finishPhase, exampleRepo, planRepo, tempDir } from './helpers.ts';

const B = 'relay-rebuild';
const PLAN_LINE = '# SDD ledger — plan: .build/relay-rebuild/documents/plans/replay/splash-plan.md';
const OTHER_LINE = '# SDD ledger — plan: .build/relay-rebuild/documents/plans/replay/other-plan.md';
const LEDGER = [
  PLAN_LINE,
  '| Task 1 × Task 2 | shares timeline.js | Ruling: ignored inside the scan table |',
  'Task 1: complete (commits 58461c3..49f5b27, review clean)',
  'Task 2: minor (deferred): the shapes test could cover an empty word',
  'Task 2: complete (commits 49f5b27..a95dc13, review clean)',
  'Task 3: fix round 1/5 (2 addressed, 1 open — palette alpha read from the wrong channel; commits a95dc13..b1c2d3e)',
  'Task 3: Ruling: points drawn as squares — cheaper per frame — one draw call changes',
  'Task 3: complete (commits a95dc13..cbbfa49, 1 parked)',
  'Task 3: parked — the ease curve overshoots by 1px — Ruling: invisible at this size',
  'Task 4: fix round 1/5 dispatched (resume implementer), FIX_BASE e7078d6',
  'Task 4: fix round 1/5 (0 addressed, 1 open; commits cbbfa49..e7078d6)',
  'Task 9: complete (commits 1111111..2222222, review clean)',
  'Final: Ruling: keep the canvas fallback — old browsers — one more code path',
  'Final: minor (deferred): the server could log its port',
].join('\n');

function thePlan(root: string): PlanEntry {
  const plan = readPlanFile(root, B).plans?.[0];
  if (!plan) throw new Error('planRepo indexed no plan');
  return plan;
}
function byTitle(plan: PlanEntry, tasks: Record<string, TaskProgress>, title: string): TaskProgress | undefined {
  const id = plan.tasks.find((t) => t.title === title)?.id;
  return id === undefined ? undefined : tasks[id];
}
function writeLedger(root: string, workspace: string, text: string): string {
  const dir = join(root, '.superpowers', 'sdd', workspace);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'progress.md');
  writeFileSync(file, text);
  return file;
}
/** A Windows path as Git Bash writes it: E:\a\b becomes /e/a/b. */
function msys(path: string): string {
  const m = /^([a-zA-Z]):[\\/](.*)$/.exec(path);
  return m ? `/${(m[1] ?? '').toLowerCase()}/${(m[2] ?? '').replace(/\\/g, '/')}` : path;
}
function writeMarker(root: string, workspace: string, text: string): void {
  writeFileSync(join(root, '.superpowers', 'sdd', workspace, 'plan-path'), text);
}
/** A second plan entry in the same phase, on its own document (the splash plan is the first). */
function addOtherPlan(root: string): { a: PlanEntry; b: PlanEntry } {
  copyFileSync(join(PLAN_FIXTURES, 'splash-plan.md'), join(root, '.build', B, 'documents', 'plans', 'replay', 'other-plan.md'));
  indexPlan(root, B, { name: 'plan-replay-other', step: 'plan', phase: 'replay', type: 'approve', title: 'Approve the other plan', why: 'A second plan.', opened: LATER, document: 'documents/plans/replay/other-plan.md' }, LATER);
  const [a, b] = readPlanFile(root, B).plans ?? [];
  if (!a || !b) throw new Error('expected two plan entries');
  return { a, b };
}
function progressOf(root: string): PlanProgress | undefined {
  const file = readPlanFile(root, B);
  return planProgress(root, B, readBuild(root, B), file, { decisions: [], issues: [] })[thePlan(root).id];
}

describe('readLedgerProgress', () => {
  it("reads each task's state, commits, fix rounds, rulings and minors", () => {
    const root = planRepo();
    const plan = thePlan(root);
    const { tasks, final } = readLedgerProgress(LEDGER, plan);
    expect(byTitle(plan, tasks, 'Timeline')).toMatchObject({ state: 'done', commits: '58461c3..49f5b27', parked: 0, fixRounds: [], rulings: [], minors: [] });
    expect(byTitle(plan, tasks, 'Shapes')).toMatchObject({ state: 'done', minors: ['the shapes test could cover an empty word'] });
    expect(byTitle(plan, tasks, 'Motion')).toEqual({
      state: 'done',
      commits: 'a95dc13..cbbfa49',
      note: null,
      parked: 1,
      fixRounds: [{ round: 1, addressed: 2, open: 1, findings: 'palette alpha read from the wrong channel', commits: 'a95dc13..b1c2d3e' }],
      parkedFindings: ['the ease curve overshoots by 1px — Ruling: invisible at this size'],
      rulings: ['points drawn as squares — cheaper per frame — one draw call changes'],
      minors: [],
    });
    expect(byTitle(plan, tasks, 'Renderer')).toMatchObject({ state: 'fix-round', commits: null, fixRounds: [{ round: 1, addressed: 0, open: 1, findings: null, commits: 'cbbfa49..e7078d6' }] });
    expect(['Page and main', 'Local server', 'Browser checks'].map((t) => byTitle(plan, tasks, t)?.state)).toEqual(['pending', 'pending', 'pending']);
    expect(final).toEqual({ rulings: ['keep the canvas fallback — old browsers — one more code path'], minors: ['the server could log its port'] });
  });
  it('keeps the note on a completion line, and null when there is none', () => {
    const root = planRepo();
    const plan = thePlan(root);
    const text = [PLAN_LINE, 'Task 1: complete (commits 58461c3..49f5b27, tests: node --test x → ok)', 'Task 2: complete (commits 49f5b27..a95dc13)'].join('\n');
    const { tasks } = readLedgerProgress(text, plan);
    expect(byTitle(plan, tasks, 'Timeline')?.note).toBe('tests: node --test x → ok');
    expect(byTitle(plan, tasks, 'Shapes')?.note).toBeNull();
    expect(byTitle(plan, tasks, 'Motion')?.note).toBeNull();
  });
  it('leaves the parked count out of the note', () => {
    const root = planRepo();
    const plan = thePlan(root);
    const text = [PLAN_LINE, 'Task 1: complete (commits 58461c3..49f5b27, review clean, 2 parked)', 'Task 2: complete (commits 49f5b27..a95dc13, 2 parked)'].join('\n');
    const { tasks } = readLedgerProgress(text, plan);
    expect(byTitle(plan, tasks, 'Timeline')).toMatchObject({ note: 'review clean', parked: 2 });
    expect(byTitle(plan, tasks, 'Shapes')).toMatchObject({ note: null, parked: 2 });
  });
  it('reads the parked count only from a bare part, and keeps a note that merely mentions parked', () => {
    const root = planRepo();
    const plan = thePlan(root);
    const text = [PLAN_LINE, 'Task 1: complete (commits a1b2c3d..d4e5f6a, tests: x → 2 parked suites pass)', 'Task 2: complete (commits a1b2c3d..d4e5f6a, review clean, 2 parked)'].join('\n');
    const { tasks } = readLedgerProgress(text, plan);
    expect(byTitle(plan, tasks, 'Timeline')).toMatchObject({ note: 'tests: x → 2 parked suites pass', parked: 0 });
    expect(byTitle(plan, tasks, 'Shapes')).toMatchObject({ note: 'review clean', parked: 2 });
  });
  it('a prose line holding a code span is no fence, so the next task line still reads', () => {
    const root = planRepo();
    const plan = thePlan(root);
    const text = [PLAN_LINE, 'Note: the ``` case is handled.', '```cmd``` was run', 'Task 2: complete (commits a1b2c3d..d4e5f6a)'].join('\n');
    const { tasks } = readLedgerProgress(text, plan);
    expect(byTitle(plan, tasks, 'Shapes')?.state).toBe('done');
  });
  it('marks the first unfinished task in progress when it has no fix round', () => {
    const root = planRepo();
    const plan = thePlan(root);
    const { tasks } = readLedgerProgress(`${PLAN_LINE}\nTask 1: complete (commits 58461c3..49f5b27, review clean)\n`, plan);
    expect(plan.tasks.map((t) => tasks[t.id]?.state)).toEqual(['done', 'in-progress', 'pending', 'pending', 'pending', 'pending', 'pending']);
  });
  it('reads every task with a ledger line in progress, and the first unfinished one only when none has', () => {
    const root = planRepo();
    const plan = thePlan(root);
    const text = [
      PLAN_LINE,
      'Task 1: complete (commits 58461c3..49f5b27, review clean)',
      'Task 2: fix round 1/5 (0 addressed, 1 open — x)',
      'Task 3: Ruling: points drawn as squares — cheaper per frame — one draw call changes',
    ].join('\n');
    const { tasks } = readLedgerProgress(text, plan);
    expect(plan.tasks.slice(0, 4).map((t) => tasks[t.id]?.state)).toEqual(['done', 'fix-round', 'in-progress', 'pending']);
  });
  it('reads a completion line with a trailing note as done', () => {
    const root = planRepo();
    const plan = thePlan(root);
    const { tasks } = readLedgerProgress(`${PLAN_LINE}\nTask 1: complete (commits a1b2c3d..d4e5f6a, review clean). Merged early.\n`, plan);
    expect(byTitle(plan, tasks, 'Timeline')).toMatchObject({ state: 'done', commits: 'a1b2c3d..d4e5f6a' });
  });
});

describe('ledgerPlanPaths, first', () => {
  /** The plan a ledger executes: its first line, else the workspace's plan-path marker. */
  const first = (text: string, marker: string | null, root: string): string | null => ledgerPlanPaths(text, marker, root)[0] ?? null;
  const root = tempDir();
  it('reads the first line, with forward or back slashes, relative or absolute', () => {
    expect(first('# SDD ledger — plan: .build/b/documents/plans/p.md\nTask 1: …', null, root)).toBe('.build/b/documents/plans/p.md');
    expect(first('# SDD ledger — plan: ./.build\\b\\documents\\plans\\P.md', null, root)).toBe('.build/b/documents/plans/p.md');
    expect(first(`# SDD ledger — plan: ${join(root, '.build', 'b', 'documents', 'plans', 'p.md')}`, null, root)).toBe('.build/b/documents/plans/p.md');
  });
  it('falls back to the workspace marker, and is null without either', () => {
    expect(first('Task 1: complete (commits a1b2c3d..d4e5f6a)', '.build/b/documents/plans/p.md\n', root)).toBe('.build/b/documents/plans/p.md');
    expect(first('no header here', null, root)).toBeNull();
  });
  it.skipIf(!/^[a-zA-Z]:[\\/]/.test(root))('reads a marker written as a Git Bash path', () => {
    expect(first('Task 1: complete (commits a1b2c3d..d4e5f6a)', `${msys(join(root, '.build', 'b', 'documents', 'plans', 'p.md'))}\n`, root)).toBe('.build/b/documents/plans/p.md');
  });
  it('collapses .. and ./ inside a path', () => {
    expect(first('# SDD ledger — plan: ./.build/b/../b/documents/plans/p.md', null, root)).toBe('.build/b/documents/plans/p.md');
    expect(first('# SDD ledger — plan: .build/b/./documents/plans/p.md', null, root)).toBe('.build/b/documents/plans/p.md');
  });
});

describe('planProgress', () => {
  it('reads the live ledger that names the plan, and ignores ledgers of other plans', () => {
    const root = planRepo();
    writeLedger(root, 'splash-plan', LEDGER);
    writeLedger(root, 'other-plan', '# SDD ledger — plan: .build/relay-rebuild/documents/plans/replay/other.md\nTask 1: fix round 1/5 (0 addressed, 1 open)\n');
    const p = progressOf(root);
    expect(p).toMatchObject({ source: 'ledger', ledger: '.superpowers/sdd/splash-plan/progress.md' });
    expect(p?.read).toMatch(/Z$/);
    expect(byTitle(thePlan(root), p?.tasks ?? {}, 'Timeline')?.state).toBe('done');
  });
  it('reads a malformed ledger without throwing: the first task in progress, the rest pending', () => {
    const root = planRepo();
    const garbage = [PLAN_LINE, 'Task 1: complete (commits zz..yy)', 'Task 2: fix round x/5', ')', '\u0000\u0001�\u0007 \u001b[31m Task 3: \u0000'].join('\n');
    writeLedger(root, 'splash-plan', garbage);
    const p = progressOf(root);
    expect(p).toMatchObject({ source: 'ledger' });
    const states = thePlan(root).tasks.map((t) => p?.tasks[t.id]?.state);
    expect(states).toEqual(['in-progress', ...Array<string>(states.length - 1).fill('pending')]);
  });
  it('still reads a ledger whose plan-path marker cannot be read', () => {
    const root = planRepo();
    writeLedger(root, 'splash-plan', LEDGER);
    mkdirSync(join(root, '.superpowers', 'sdd', 'splash-plan', 'plan-path'));
    expect(progressOf(root)).toMatchObject({ source: 'ledger', ledger: '.superpowers/sdd/splash-plan/progress.md' });
  });
  it('matches a ledger whose first line names another path when its marker names the plan', () => {
    const root = planRepo();
    writeLedger(root, 'splash-plan', LEDGER.replace('splash-plan.md', 'wrong.md'));
    writeMarker(root, 'splash-plan', '.build/relay-rebuild/documents/plans/replay/splash-plan.md\n');
    expect(progressOf(root)).toMatchObject({ source: 'ledger', ledger: '.superpowers/sdd/splash-plan/progress.md' });
  });
  it.skipIf(process.platform !== 'win32')('matches a marker-only ledger whose marker is a Git Bash path', () => {
    const root = planRepo();
    writeLedger(root, 'splash-plan', LEDGER.replace(`${PLAN_LINE}\n`, ''));
    writeMarker(root, 'splash-plan', `${msys(join(root, '.build', B, 'documents', 'plans', 'replay', 'splash-plan.md'))}\n`);
    expect(progressOf(root)).toMatchObject({ source: 'ledger', ledger: '.superpowers/sdd/splash-plan/progress.md' });
    expect(byTitle(thePlan(root), progressOf(root)?.tasks ?? {}, 'Timeline')?.state).toBe('done');
  });
  it("a ledger's first line outranks its marker", () => {
    const root = planRepo();
    const { a, b } = addOtherPlan(root);
    writeLedger(root, 'run', LEDGER.replace(PLAN_LINE, OTHER_LINE));
    writeMarker(root, 'run', '.build/relay-rebuild/documents/plans/replay/splash-plan.md\n');
    const all = planProgress(root, B, readBuild(root, B), readPlanFile(root, B), { decisions: [], issues: [] });
    expect(all[a.id]?.source).toBe('none');
    expect(all[b.id]).toMatchObject({ source: 'ledger', ledger: '.superpowers/sdd/run/progress.md' });
  });
  it('lets the marker decide when the first line names no indexed plan', () => {
    const root = planRepo();
    writeLedger(root, 'run', LEDGER.replace('splash-plan.md', 'not-indexed.md'));
    writeMarker(root, 'run', '.build/relay-rebuild/documents/plans/replay/splash-plan.md\n');
    expect(progressOf(root)).toMatchObject({ source: 'ledger' });
  });
  it('picks the most recently written of two ledgers for one plan', () => {
    const root = planRepo();
    const old = writeLedger(root, 'splash-plan', LEDGER);
    writeLedger(root, 'splash-plan-2', `${PLAN_LINE}\nTask 1: fix round 1/5 (0 addressed, 1 open)\n`);
    utimesSync(old, new Date('2026-10-01T00:00:00Z'), new Date('2026-10-01T00:00:00Z'));
    expect(progressOf(root)?.ledger).toBe('.superpowers/sdd/splash-plan-2/progress.md');
  });
  it('gives the live ledger only to the newest plan entry for a document', () => {
    const root = planRepo();
    const file = writeLedger(root, 'splash-plan', LEDGER);
    importRun(root, B, LEDGER, file, LATER);
    indexPlan(root, B, { name: 'plan-replay-2', step: 'plan', phase: 'replay', type: 'approve', title: 'Approve the replay plan again', why: 'The order changed.', opened: LATER, document: 'documents/plans/replay/splash-plan.md' }, LATER);
    writeLedger(root, 'splash-plan', `${PLAN_LINE}\nTask 1: fix round 1/5 (0 addressed, 1 open)\n`);
    const plans = readPlanFile(root, B).plans ?? [];
    const [older, newer] = plans;
    if (!older || !newer) throw new Error('expected two plan entries');
    const all = planProgress(root, B, readBuild(root, B), readPlanFile(root, B), { decisions: [], issues: [] });
    expect(all[older.id]).toMatchObject({ source: 'record', read: LATER });
    expect(byTitle(older, all[older.id]?.tasks ?? {}, 'Timeline')?.state).toBe('done');
    expect(byTitle(older, all[older.id]?.tasks ?? {}, 'Renderer')?.state).toBe('incomplete');
    expect(all[newer.id]).toMatchObject({ source: 'ledger', ledger: '.superpowers/sdd/splash-plan/progress.md' });
    expect(byTitle(newer, all[newer.id]?.tasks ?? {}, 'Timeline')?.state).toBe('fix-round');
  });
  it('without a ledger or a record: pending while the phase runs, unknown once it closes', () => {
    const root = planRepo();
    expect(progressOf(root)).toMatchObject({ source: 'none', read: null, ledger: null });
    expect(Object.values(progressOf(root)?.tasks ?? {}).map((t) => t.state)).toEqual(Array(7).fill('pending'));
    setStage(root, B, 'close-out');
    expect(Object.values(progressOf(root)?.tasks ?? {}).map((t) => t.state)).toEqual(Array(7).fill('unknown'));
  });
});

describe('a plan read from its record', () => {
  it('maps each recorded state and carries the tagged rulings and minors', () => {
    const root = planRepo();
    const plan = thePlan(root);
    importRun(root, B, LEDGER, writeLedger(root, 'splash-plan', LEDGER), LATER);
    rmSync(join(root, '.superpowers'), { recursive: true, force: true });
    const logs = { decisions: readLog(root, B, 'decisions').entries, issues: readLog(root, B, 'issues').entries };
    const p = planProgress(root, B, readBuild(root, B), readPlanFile(root, B), logs)[plan.id];
    expect(p).toMatchObject({ source: 'record', read: LATER });
    expect(plan.tasks.map((t) => p?.tasks[t.id]?.state)).toEqual(['done', 'done', 'done', 'incomplete', 'incomplete', 'incomplete', 'incomplete']);
    expect(byTitle(plan, p?.tasks ?? {}, 'Motion')?.rulings).toEqual(['points drawn as squares — cheaper per frame — one draw call changes']);
    expect(byTitle(plan, p?.tasks ?? {}, 'Timeline')?.note).toBe('review clean');
    expect(byTitle(plan, p?.tasks ?? {}, 'Shapes')?.minors).toEqual(['the shapes test could cover an empty word']);
    expect(byTitle(plan, p?.tasks ?? {}, 'Timeline')).toMatchObject({ rulings: [], minors: [] });
  });
  it('skips a ledger that cannot be read, and falls back to the record', () => {
    const root = planRepo();
    importRun(root, B, LEDGER, writeLedger(root, 'splash-plan', LEDGER), LATER);
    rmSync(join(root, '.superpowers'), { recursive: true, force: true });
    mkdirSync(join(root, '.superpowers', 'sdd', 'splash-plan', 'progress.md'), { recursive: true });
    expect(progressOf(root)).toMatchObject({ source: 'record', read: LATER });
  });
});

describe('findLedgers', () => {
  it('finds a workspace folder that is a symlink or a junction', () => {
    const root = planRepo();
    const target = tempDir();
    writeFileSync(join(target, 'progress.md'), LEDGER);
    mkdirSync(join(root, '.superpowers', 'sdd'), { recursive: true });
    symlinkSync(target, join(root, '.superpowers', 'sdd', 'linked'), 'junction');
    expect(findLedgers(root).map((l) => l.path)).toEqual(['.superpowers/sdd/linked/progress.md']);
  });
  it('skips a symlink that is not a workspace folder', () => {
    const root = planRepo();
    const target = join(tempDir(), 'note.txt');
    writeFileSync(target, 'x');
    mkdirSync(join(root, '.superpowers', 'sdd'), { recursive: true });
    try {
      symlinkSync(target, join(root, '.superpowers', 'sdd', 'file-link'), 'file');
    } catch {
      return; // This machine can't make file symlinks; the junction case above covers the folder rule.
    }
    expect(findLedgers(root)).toEqual([]);
  });
});

describe('importRun', () => {
  it("keeps the run's as-built notes in the build's notes, where they outlive the workspace", () => {
    const root = planRepo();
    const file = writeLedger(root, 'splash-plan', LEDGER);
    const notes = '# As built\n\n- The palette moved to tokens after Task 2.\n';
    writeFileSync(join(root, '.superpowers', 'sdd', 'splash-plan', 'as-built.md'), notes);
    const r = importRun(root, B, LEDGER, file, LATER);
    expect(r.asBuilt).toBe('.build/relay-rebuild/notes/replay-as-built.md');
    rmSync(join(root, '.superpowers'), { recursive: true, force: true });
    expect(readFileSync(join(root, '.build', B, 'notes', 'replay-as-built.md'), 'utf8')).toBe(notes);
  });
  it('keeps nothing, and reports nothing, when the run has no as-built notes', () => {
    const root = planRepo();
    const r = importRun(root, B, LEDGER, writeLedger(root, 'splash-plan', LEDGER), LATER);
    expect(r).not.toHaveProperty('asBuilt');
    expect(existsSync(join(root, '.build', B, 'notes', 'replay-as-built.md'))).toBe(false);
  });
  it('replaces the kept note when the run changes it, and keeps it when the plan record cannot be read', () => {
    const root = planRepo();
    const file = writeLedger(root, 'splash-plan', LEDGER);
    const asBuilt = join(root, '.superpowers', 'sdd', 'splash-plan', 'as-built.md');
    writeFileSync(asBuilt, 'first\n');
    importRun(root, B, LEDGER, file, LATER);
    writeFileSync(asBuilt, 'second\n');
    writeFileSync(join(root, '.build', B, 'plan.json'), '{ "plans": 1 }');
    const r = importRun(root, B, LEDGER, file, LATER);
    expect(r.noRecord).toBeDefined();
    expect(r.asBuilt).toBe('.build/relay-rebuild/notes/replay-as-built.md');
    expect(readFileSync(join(root, '.build', B, 'notes', 'replay-as-built.md'), 'utf8')).toBe('second\n');
  });
  it("keeps the note under the plan's phase even after the build moves on", () => {
    const root = planRepo();
    const file = writeLedger(root, 'splash-plan', LEDGER);
    writeFileSync(join(root, '.superpowers', 'sdd', 'splash-plan', 'as-built.md'), 'notes\n');
    finishPhase(root, B, 'replay');
    startPhase(root, B, 'dashboard', { branch: 'b2', now: LATER });
    expect(importRun(root, B, LEDGER, file, LATER).asBuilt).toBe('.build/relay-rebuild/notes/replay-as-built.md');
    expect(existsSync(join(root, '.build', B, 'notes', 'dashboard-as-built.md'))).toBe(false);
  });
  it('leaves the kept note alone when the run has not changed it', () => {
    const root = planRepo();
    const file = writeLedger(root, 'splash-plan', LEDGER);
    writeFileSync(join(root, '.superpowers', 'sdd', 'splash-plan', 'as-built.md'), 'same\n');
    importRun(root, B, LEDGER, file, LATER);
    const kept = join(root, '.build', B, 'notes', 'replay-as-built.md');
    const old = new Date('2020-01-01T00:00:00Z');
    utimesSync(kept, old, old);
    importRun(root, B, LEDGER, file, LATER);
    expect(statSync(kept).mtimeMs).toBe(old.getTime());
  });
  it('says why the notes were not kept when as-built.md cannot be read, and still imports', async () => {
    const root = planRepo();
    const file = writeLedger(root, 'splash-plan', LEDGER);
    mkdirSync(join(root, '.superpowers', 'sdd', 'splash-plan', 'as-built.md'));
    const r = importRun(root, B, LEDGER, file, LATER);
    expect(r).not.toHaveProperty('asBuilt');
    expect(r.noNotes).toMatch(/EISDIR/);
    expect(r.rulings).toBe(3);
    const out: string[] = [];
    const io: CliIO = { cwd: root, out: (l) => out.push(l), err: () => undefined, now: () => LATER, readStdin: async () => '', env: {} };
    expect(await main(['ledger', 'import', file], io)).toBe(0);
    expect(out.some((l) => l.startsWith("The run's as-built notes can't be read (") && l.includes('EISDIR'))).toBe(true);
  });
  it("says why the notes were not kept when the build's copy cannot be read, and still imports", () => {
    const root = planRepo();
    const file = writeLedger(root, 'splash-plan', LEDGER);
    writeFileSync(join(root, '.superpowers', 'sdd', 'splash-plan', 'as-built.md'), 'notes\n');
    mkdirSync(join(root, '.build', B, 'notes', 'replay-as-built.md'), { recursive: true });
    const r = importRun(root, B, LEDGER, file, LATER);
    expect(r).not.toHaveProperty('asBuilt');
    expect(r.noNotes).toMatch(/EISDIR/);
    expect(r.rulings).toBe(3);
  });
  it('says where it kept them', async () => {
    const root = planRepo();
    const file = writeLedger(root, 'splash-plan', LEDGER);
    writeFileSync(join(root, '.superpowers', 'sdd', 'splash-plan', 'as-built.md'), '# As built\n');
    const out: string[] = [];
    const io: CliIO = { cwd: root, out: (l) => out.push(l), err: () => undefined, now: () => LATER, readStdin: async () => '', env: {} };
    expect(await main(['ledger', 'import', file], io)).toBe(0);
    expect(out).toContain("Kept the run's as-built notes at .build/relay-rebuild/notes/replay-as-built.md.");
  });
  it('tags each entry with its task and keeps the record', () => {
    const root = planRepo();
    const plan = thePlan(root);
    const file = writeLedger(root, 'splash-plan', LEDGER);
    expect(importRun(root, B, LEDGER, file, LATER)).toEqual({ rulings: 3, minors: 2, skipped: 0, plan: 'Splash Page Implementation Plan', done: 3, total: 7 });
    const record = thePlan(root).record;
    expect(record).toMatchObject({ imported: LATER, ledger: '.superpowers/sdd/splash-plan/progress.md', final: { rulings: 1, minors: 1 } });
    const motion = plan.tasks.find((t) => t.title === 'Motion')?.id ?? '';
    const renderer = plan.tasks.find((t) => t.title === 'Renderer')?.id ?? '';
    expect(record?.tasks[motion]).toEqual({ state: 'done', commits: 'a95dc13..cbbfa49', note: null, parked: 1, fixRounds: [{ round: 1, addressed: 2, open: 1, findings: 'palette alpha read from the wrong channel', commits: 'a95dc13..b1c2d3e' }] });
    expect(record?.tasks[renderer]).toMatchObject({ state: 'incomplete', commits: null });
    const decisions = readLog(root, B, 'decisions').entries;
    expect(decisions.find((e) => e.text.startsWith('points drawn as squares'))).toMatchObject({ task: motion, source: 'ruling · Task 3' });
    expect(decisions.find((e) => e.text.startsWith('keep the canvas fallback'))?.task).toBeUndefined();
  });
  it('reads a record kept without a note as note null', () => {
    const root = planRepo();
    importRun(root, B, LEDGER, writeLedger(root, 'splash-plan', LEDGER), LATER);
    rmSync(join(root, '.superpowers'), { recursive: true, force: true });
    const file = readPlanFile(root, B);
    const plans = (file.plans ?? []).map((pl) => (pl.record ? { ...pl, record: { ...pl.record, tasks: Object.fromEntries(Object.entries(pl.record.tasks).map(([id, { note: _note, ...old }]) => [id, old])) } } : pl));
    writePlanFile(root, B, { ...file, plans });
    const plan = thePlan(root);
    const p = planProgress(root, B, readBuild(root, B), readPlanFile(root, B), { decisions: [], issues: [] })[plan.id];
    expect(byTitle(plan, p?.tasks ?? {}, 'Timeline')?.note).toBeNull();
  });
  it('reads progress from the record once the ledger is gone', () => {
    const root = planRepo();
    const file = writeLedger(root, 'splash-plan', LEDGER);
    importRun(root, B, LEDGER, file, LATER);
    rmSync(join(root, '.superpowers'), { recursive: true, force: true });
    const logs = { decisions: readLog(root, B, 'decisions').entries, issues: readLog(root, B, 'issues').entries };
    const plan = thePlan(root);
    const p = planProgress(root, B, readBuild(root, B), readPlanFile(root, B), logs)[plan.id];
    expect(p).toMatchObject({ source: 'record', read: LATER, ledger: '.superpowers/sdd/splash-plan/progress.md' });
    expect(byTitle(plan, p?.tasks ?? {}, 'Motion')).toMatchObject({
      state: 'done',
      rulings: ['points drawn as squares — cheaper per frame — one draw call changes'],
      parkedFindings: ['the ease curve overshoots by 1px — Ruling: invisible at this size'],
    });
    expect(byTitle(plan, p?.tasks ?? {}, 'Shapes')?.minors).toEqual(['the shapes test could cover an empty word']);
    expect(byTitle(plan, p?.tasks ?? {}, 'Renderer')?.state).toBe('incomplete');
    expect(p?.final).toEqual({ rulings: ['keep the canvas fallback — old browsers — one more code path'], minors: ['the server could log its port'] });
  });
  it('importing again replaces the record and logs nothing twice', () => {
    const root = planRepo();
    const file = writeLedger(root, 'splash-plan', LEDGER);
    importRun(root, B, LEDGER, file, LATER);
    expect(importRun(root, B, LEDGER, file, '2026-10-02T22:00:00Z')).toMatchObject({ rulings: 0, minors: 0, skipped: 5 });
    expect(thePlan(root).record?.imported).toBe('2026-10-02T22:00:00Z');
  });
  it('keeps the record when only the marker names the plan', () => {
    const root = planRepo();
    const text = LEDGER.replace('splash-plan.md', 'wrong.md');
    const file = writeLedger(root, 'splash-plan', text);
    writeMarker(root, 'splash-plan', '.build/relay-rebuild/documents/plans/replay/splash-plan.md\n');
    expect(importRun(root, B, text, file, LATER)).toMatchObject({ plan: 'Splash Page Implementation Plan', done: 3, total: 7 });
  });
  it("keeps the first-named plan's record when the marker names another plan", () => {
    const root = planRepo();
    const { a, b } = addOtherPlan(root);
    const text = LEDGER.replace(PLAN_LINE, OTHER_LINE);
    const file = writeLedger(root, 'run', text);
    writeMarker(root, 'run', '.build/relay-rebuild/documents/plans/replay/splash-plan.md\n');
    expect(importRun(root, B, text, file, LATER)).toMatchObject({ plan: 'Splash Page Implementation Plan', done: 3, total: 7 });
    const plans = readPlanFile(root, B).plans ?? [];
    expect(plans.find((p) => p.id === a.id)?.record).toBeNull();
    expect(plans.find((p) => p.id === b.id)?.record).toMatchObject({ imported: LATER });
    const motion = b.tasks.find((t) => t.title === 'Motion')?.id;
    expect(readLog(root, B, 'decisions').entries.find((e) => e.text.startsWith('points drawn as squares'))?.task).toBe(motion);
  });
  it("keeps an older plan's record when its ledger names it and the marker names a newer one", () => {
    const root = planRepo();
    const { a, b } = addOtherPlan(root);
    const file = writeLedger(root, 'run', LEDGER);
    writeMarker(root, 'run', '.build/relay-rebuild/documents/plans/replay/other-plan.md\n');
    importRun(root, B, LEDGER, file, LATER);
    const plans = readPlanFile(root, B).plans ?? [];
    expect(plans.find((p) => p.id === a.id)?.record).toMatchObject({ imported: LATER });
    expect(plans.find((p) => p.id === b.id)?.record).toBeNull();
  });
  it('keeps the record when the workspace marker cannot be read', () => {
    const root = planRepo();
    const file = writeLedger(root, 'splash-plan', LEDGER);
    mkdirSync(join(root, '.superpowers', 'sdd', 'splash-plan', 'plan-path'));
    expect(importRun(root, B, LEDGER, file, LATER)).toMatchObject({ plan: 'Splash Page Implementation Plan', done: 3, total: 7 });
  });
  it('stores a ledger outside the repo as an absolute path with forward slashes', () => {
    const root = planRepo();
    const outside = join(tempDir(), 'progress.md');
    writeFileSync(outside, LEDGER);
    importRun(root, B, LEDGER, outside, LATER);
    const kept = thePlan(root).record?.ledger ?? '';
    expect(kept).toBe(resolve(outside).replace(/\\/g, '/'));
    expect(kept).not.toMatch(/^\.\./);
  });
  it('stores a ledger under an in-repo folder named ..cache as a relative path', () => {
    const root = planRepo();
    const dir = join(root, '..cache');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'progress.md');
    writeFileSync(file, LEDGER);
    importRun(root, B, LEDGER, file, LATER);
    expect(thePlan(root).record?.ledger).toBe('..cache/progress.md');
  });
  it('an unreadable plan.json still imports the logs, and says why no record was kept', async () => {
    const root = planRepo();
    const file = writeLedger(root, 'splash-plan', LEDGER);
    writeFileSync(join(root, '.build', B, 'plan.json'), '{ "plans": 1 }');
    const r = importRun(root, B, LEDGER, file, LATER);
    expect(r).toMatchObject({ rulings: 3, minors: 2, plan: null, done: 0, total: 0 });
    expect(r.noRecord).toMatch(/plan.json is invalid/);
    expect(readLog(root, B, 'decisions').entries.find((e) => e.text.startsWith('points drawn as squares'))?.task).toBeUndefined();
    const other = writeLedger(root, 'again', LEDGER.replace('Final: minor (deferred): the server could log its port', 'Final: minor (deferred): one more'));
    const out: string[] = [];
    const io: CliIO = { cwd: root, out: (l) => out.push(l), err: () => {}, now: () => '2026-10-02T21:00:00Z', readStdin: async () => '', env: {} };
    expect(await main(['ledger', 'import', other], io)).toBe(0);
    expect(out[1]).toMatch(/^plan\.json can't be read \(invalid: [^)]+\), so no task record was kept\.$/);
  });
  it('a record that cannot be written leaves the logs, and a second import keeps the record', (ctx) => {
    const root2 = planRepo();
    const file = writeLedger(root2, 'splash-plan', LEDGER);
    const planFile = join(root2, '.build', B, 'plan.json');
    // Mirror writeJson: write a temp file, then rename it over a read-only target.
    const probe = join(root2, 'probe.json');
    const probeTmp = `${probe}.tmp`;
    writeFileSync(probe, 'x');
    chmodSync(probe, 0o444);
    writeFileSync(probeTmp, 'y');
    let enforced = false;
    try {
      renameSync(probeTmp, probe);
    } catch {
      enforced = true;
    }
    chmodSync(probe, 0o644);
    rmSync(probe, { force: true });
    rmSync(probeTmp, { force: true });
    if (!enforced) ctx.skip(); // Here a rename over a read-only file succeeds (POSIX); nothing to prove.
    chmodSync(planFile, 0o444);
    try {
      let thrown: unknown = null;
      try {
        importRun(root2, B, LEDGER, file, LATER);
      } catch (e) {
        thrown = e;
      }
      // writeJson wraps the rename failure in a NexusError that names the code.
      expect((thrown as Error | null)?.message).toMatch(/Could not save plan\.json \((EPERM|EACCES)\)/);
    } finally {
      chmodSync(planFile, 0o644);
    }
    expect(readLog(root2, B, 'decisions').entries.some((e) => e.text.startsWith('points drawn as squares'))).toBe(true);
    expect(thePlan(root2).record).toBeNull();
    expect(existsSync(`${planFile}.tmp`)).toBe(false);
    expect(importRun(root2, B, LEDGER, file, '2026-10-02T22:00:00Z')).toMatchObject({ rulings: 0, minors: 0, skipped: 5, done: 3, total: 7 });
    expect(thePlan(root2).record?.imported).toBe('2026-10-02T22:00:00Z');
  });
  it('a ledger naming no indexed plan imports the logs only', () => {
    const root = exampleRepo();
    const text = LEDGER.replace('splash-plan.md', 'other.md');
    const file = writeLedger(root, 'other', text);
    expect(importRun(root, B, text, file, LATER)).toMatchObject({ rulings: 3, minors: 2, plan: null, done: 0, total: 0 });
  });
  it('ledger import says what record was kept', async () => {
    const root = planRepo();
    const file = writeLedger(root, 'splash-plan', LEDGER);
    const out: string[] = [];
    const io: CliIO = { cwd: root, out: (l) => out.push(l), err: () => {}, now: () => '2026-10-02T21:00:00Z', readStdin: async () => '', env: {} };
    expect(await main(['ledger', 'import', file], io)).toBe(0);
    expect(out).toEqual(['Imported 3 rulings and 2 deferred minors (0 already there).', 'Kept the task record for "Splash Page Implementation Plan": 3 of 7 tasks done.']);
  });
});

describe('an older plan and its Final review', () => {
  const entry = (name: string, text: string): LogEntry => ({ phase: 'replay', name, text, status: 'open', source: 'ruling · Final', time: LATER });
  it('only the newest plan of a phase shows its Final entries', () => {
    const root = planRepo();
    const { a, b } = addOtherPlan(root);
    importRun(root, B, LEDGER, writeLedger(root, 'run-a', LEDGER), LATER);
    importRun(root, B, LEDGER.replace(PLAN_LINE, OTHER_LINE), writeLedger(root, 'run-b', LEDGER.replace(PLAN_LINE, OTHER_LINE)), LATER);
    rmSync(join(root, '.superpowers'), { recursive: true, force: true });
    const logs = { decisions: [entry('final-1', 'keep the canvas fallback')], issues: [{ ...entry('final-2', 'log the port'), source: 'minor · Final' }] };
    const all = planProgress(root, B, readBuild(root, B), readPlanFile(root, B), logs);
    expect(all[a.id]).toMatchObject({ source: 'record', final: { rulings: [], minors: [] } });
    expect(all[b.id]).toMatchObject({ source: 'record', final: { rulings: ['keep the canvas fallback'], minors: ['log the port'] } });
  });
});

describe('the snapshot', () => {
  it('an existing build has no plan progress', () => {
    const s = readSnapshot(exampleRepo(), B);
    expect(s.plan).toEqual({});
    expect(s.planProgress).toEqual({});
  });
});
