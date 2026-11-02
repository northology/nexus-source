import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readBuild } from './build.ts';
import { fenceTracker } from './fences.ts';
import { linkRefusal } from './fs-guard.ts';
import { importLedger, parseLedger } from './ledger.ts';
import { BUILD_DIR } from './paths.ts';
import { currentPhase } from './phases.ts';
import { readPlanFile, writePlanFile } from './plan.ts';
import { isoNow } from './time.ts';
import type { Build, LogEntry, PlanEntry, PlanFile, PlanProgress, PlanRecord, TaskProgress, TaskRecord, TaskState } from './types.ts';

/** `plans`: the plan its first line names and the plan its workspace marker names, whichever exist; `named`: the first line's plan alone. */
export interface LedgerFile { path: string; text: string; modified: number; plans: string[]; named: string | null }
export interface LedgerLogs { decisions: LogEntry[]; issues: LogEntry[] }

export const LEDGER_DIR = ['.superpowers', 'sdd'];
const FIRST_LINE = /^#\s*SDD ledger\s*[—-]\s*plan:\s*(.+?)\s*$/;
const COMPLETE = /^Task (\d+): complete \(commits ([0-9a-f]{4,40}\.\.[0-9a-f]{4,40})(?:,\s*([^)]*))?\)/;
const FIX_ROUND = /^Task (\d+): fix round (\d+)\/\d+ \((\d+) addressed, (\d+) open(?:\s*[—-]\s*(.*?))?(?:;\s*commits ([0-9a-f]{4,40}\.\.[0-9a-f]{4,40}))?\)\s*$/;
const PARKED = /^Task (\d+): parked\s*[—-]\s*(.+)$/;
// A bare `N parked` part of a comma-separated note: the count, and nothing else in the part.
const PARKED_PART = /(^|,)\s*(\d+) parked\s*(?=,|$)/;
const PARKED_TEXT = /^parked\s*[—-]\s*/;

/**
 * A path as ledgers and plans are compared: repo-relative, forward slashes, no leading ./, lower case. Absolute,
 * cwd-relative, `..` and `./` forms collapse; when the root is a Windows path, a Git Bash path (/e/…) reads as E:/….
 */
function normalise(root: string, path: string): string {
  let p = path.trim().replace(/\\/g, '/');
  const msys = /^\/([a-zA-Z])\//.exec(p);
  if (msys && /^[a-zA-Z]:[\\/]/.test(root)) p = `${msys[1] ?? ''}:/${p.slice(3)}`;
  return relative(root, resolve(root, p)).replace(/\\/g, '/').replace(/^(\.\/)+/, '').toLowerCase();
}

/** The plan a ledger's first line names, resolved against the root; null when it has none. */
function firstLinePlan(text: string, root: string): string | null {
  const first = /\S[^\r\n]*/.exec(text)?.[0] ?? '';
  const named = FIRST_LINE.exec(first.trim())?.[1];
  return named ? normalise(root, named) : null;
}

/** Every plan a ledger may execute: the one its `# SDD ledger — plan: <path>` first line names, then its workspace's plan-path marker. */
export function ledgerPlanPaths(text: string, marker: string | null, root: string): string[] {
  const named = [firstLinePlan(text, root), marker?.trim() ? normalise(root, marker) : null];
  return [...new Set(named.filter((n): n is string => n !== null))];
}

/** Where a plan's document sits, in the form ledgerPlanPaths reports. */
export function planDocPath(build: string, plan: PlanEntry): string {
  return `${BUILD_DIR}/${build}/${plan.document}`.toLowerCase();
}

/**
 * Every Superpowers run ledger in the checkout: <root>/.superpowers/sdd/<workspace>/progress.md. A workspace folder may
 * be a link, checked first as the live watcher checks it (server/events.ts): one to a network or device path, or
 * another drive, is skipped and never followed.
 */
export function findLedgers(root: string): LedgerFile[] {
  const base = join(root, ...LEDGER_DIR);
  let names: string[];
  if (linkRefusal(root, base) !== null) return [];
  try {
    names = readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory() || (d.isSymbolicLink() && linkRefusal(root, join(base, d.name)) === null))
      .map((d) => d.name);
  } catch {
    return [];
  }
  const out: LedgerFile[] = [];
  for (const name of names) {
    const file = join(base, name, 'progress.md');
    try {
      const text = readFileSync(file, 'utf8');
      let marker: string | null = null;
      try {
        marker = readFileSync(join(base, name, 'plan-path'), 'utf8');
      } catch {
        // No marker, or one that can't be read: the ledger's own first line still names its plan.
      }
      out.push({ path: `${LEDGER_DIR.join('/')}/${name}/progress.md`, text, modified: statSync(file).mtimeMs, plans: ledgerPlanPaths(text, marker, root), named: firstLinePlan(text, root) });
    } catch {
      // This workspace has no ledger yet, or it can't be read: nothing to show for it.
    }
  }
  return out;
}

/**
 * The ledger executing this plan; when two do, the most recently written wins. A ledger's first line outranks its
 * marker: the marker counts only when the first line is missing or names no document in `indexed`.
 */
export function ledgerFor(ledgers: LedgerFile[], build: string, plan: PlanEntry, indexed: Set<string>): LedgerFile | null {
  const doc = planDocPath(build, plan);
  const matches = (l: LedgerFile): boolean => l.named === doc || (l.plans.includes(doc) && (l.named === null || !indexed.has(l.named)));
  return ledgers.filter(matches).sort((a, b) => b.modified - a.modified)[0] ?? null;
}

export function blankProgress(): TaskProgress {
  return { state: 'pending', commits: null, note: null, parked: 0, fixRounds: [], parkedFindings: [], rulings: [], minors: [] };
}

/**
 * Each task's progress as a live ledger records it, joined on `Task <N>:` within this plan. Lines it doesn't recognise,
 * tables, fenced code and task numbers the plan doesn't have are skipped.
 */
export function readLedgerProgress(text: string, plan: PlanEntry): Pick<PlanProgress, 'tasks' | 'final'> {
  const tasks: Record<string, TaskProgress> = {};
  const byNumber = new Map<string, TaskProgress>();
  for (const t of plan.tasks) {
    const p = blankProgress();
    tasks[t.id] = p;
    if (!byNumber.has(String(t.number))) byNumber.set(String(t.number), p);
  }
  const done = new Set<TaskProgress>();
  const final: PlanProgress['final'] = { rulings: [], minors: [] };
  const inFence = fenceTracker();
  for (const raw of text.split(/\r?\n/)) {
    if (inFence(raw)) continue;
    const line = raw.trim();
    if (line.startsWith('|') || line.startsWith('#')) continue;
    const body = line.replace(/^[-*]\s*/, '');
    const complete = COMPLETE.exec(body);
    if (complete) {
      const p = byNumber.get(complete[1] ?? '');
      if (p) {
        p.commits = complete[2] ?? null;
        // The parked count has its own place in the state text, so the note keeps the rest.
        p.note = (complete[3] ?? '').replace(new RegExp(PARKED_PART, 'g'), '').replace(/^\s*,/, '').trim() || null;
        p.parked = Number(PARKED_PART.exec(complete[3] ?? '')?.[2] ?? 0);
        done.add(p);
      }
      continue;
    }
    const round = FIX_ROUND.exec(body);
    if (round) {
      byNumber.get(round[1] ?? '')?.fixRounds.push({ round: Number(round[2]), addressed: Number(round[3]), open: Number(round[4]), findings: round[5]?.trim() || null, commits: round[6] ?? null });
      continue;
    }
    const parked = PARKED.exec(body);
    if (parked) byNumber.get(parked[1] ?? '')?.parkedFindings.push((parked[2] ?? '').trim());
  }
  for (const item of parseLedger(text)) {
    // A parked line that carries a ruling is listed under Parked, not again under Rulings.
    if (item.log === 'decisions' && PARKED_TEXT.test(item.text)) continue;
    const target = item.where === 'Final' ? final : item.where ? byNumber.get(item.where.replace(/^Task /, '')) : undefined;
    if (!target) continue;
    (item.log === 'decisions' ? target.rulings : target.minors).push(item.text);
  }
  const active = (p: TaskProgress): boolean => p.fixRounds.length > 0 || p.parkedFindings.length > 0 || p.rulings.length > 0 || p.minors.length > 0;
  const unfinished = plan.tasks.map((t) => tasks[t.id]).filter((p): p is TaskProgress => p !== undefined && !done.has(p));
  const anyActive = unfinished.some(active);
  for (const t of plan.tasks) {
    const p = tasks[t.id];
    if (!p) continue;
    if (done.has(p)) p.state = 'done';
    else if (p.fixRounds.length) p.state = 'fix-round';
    else if (active(p) || (!anyActive && p === unfinished[0])) p.state = 'in-progress';
  }
  return { tasks, final };
}

/** Progress from the record `nexus ledger import` kept, with rulings and minors from the logs entries tagged by task. */
function recordProgress(plan: PlanEntry, record: PlanRecord, logs: LedgerLogs, newest: boolean): Pick<PlanProgress, 'tasks' | 'final'> {
  const tasks: Record<string, TaskProgress> = {};
  for (const t of plan.tasks) {
    const r = record.tasks[t.id];
    const decisions = logs.decisions.filter((e) => e.task === t.id);
    tasks[t.id] = {
      state: r?.state ?? 'unknown',
      commits: r?.commits ?? null,
      note: r?.note ?? null,
      parked: r?.parked ?? 0,
      fixRounds: r?.fixRounds ?? [],
      parkedFindings: decisions.filter((e) => PARKED_TEXT.test(e.text)).map((e) => e.text.replace(PARKED_TEXT, '')),
      rulings: decisions.filter((e) => !PARKED_TEXT.test(e.text)).map((e) => e.text),
      minors: logs.issues.filter((e) => e.task === t.id).map((e) => e.text),
    };
  }
  // The Final review belongs to the phase's newest plan; an older plan of the phase keeps none.
  const fromFinal = (e: LogEntry): boolean => newest && e.task === undefined && e.phase === plan.phase && / · Final$/.test(e.source);
  return { tasks, final: { rulings: logs.decisions.filter(fromFinal).map((e) => e.text), minors: logs.issues.filter(fromFinal).map((e) => e.text) } };
}

/**
 * Progress for every plan entry: from its live ledger, else its kept record, else none. With neither, a phase's current
 * plan reads pending while the phase runs and unknown once it closes; older plans read unknown.
 */
export function planProgress(root: string, name: string, build: Build | null, file: PlanFile | null, logs: LedgerLogs): Record<string, PlanProgress> {
  const plans = file?.plans ?? [];
  if (!plans.length) return {};
  const ledgers = findLedgers(root);
  const indexed = new Set(plans.map((p) => planDocPath(name, p)));
  const out: Record<string, PlanProgress> = {};
  for (const [i, plan] of plans.entries()) {
    // A plan gate reopened on the same document: only the newest entry reads the live ledger; older ones keep their record.
    const superseded = plans.slice(i + 1).some((p) => p.document.toLowerCase() === plan.document.toLowerCase());
    const newest = plans.filter((p) => p.phase === plan.phase).at(-1) === plan;
    const ledger = superseded ? null : ledgerFor(ledgers, name, plan, indexed);
    if (ledger) {
      out[plan.id] = { source: 'ledger', read: isoNow(new Date(ledger.modified)), ledger: ledger.path, ...readLedgerProgress(ledger.text, plan) };
    } else if (plan.record) {
      out[plan.id] = { source: 'record', read: plan.record.imported, ledger: plan.record.ledger, ...recordProgress(plan, plan.record, logs, newest) };
    } else {
      const running = build !== null && newest && plan.phase === (build.phase ?? build.name) && build.stage !== 'close-out';
      const state: TaskState = running ? 'pending' : 'unknown';
      const tasks: Record<string, TaskProgress> = {};
      for (const t of plan.tasks) tasks[t.id] = { ...blankProgress(), state };
      out[plan.id] = { source: 'none', read: null, ledger: null, tasks, final: { rulings: [], minors: [] } };
    }
  }
  return out;
}

/**
 * `noRecord`: why plan.json couldn't be read, when it couldn't; the logs were still imported, untagged. `asBuilt`: where
 * the run's as-built notes were kept, when it had some; `noNotes`: why they couldn't be read, when as-built.md (or the
 * build's copy of it) exists but wasn't readable.
 */
export interface RunImport { rulings: number; minors: number; skipped: number; plan: string | null; done: number; total: number; noRecord?: string; asBuilt?: string; noNotes?: string }

/**
 * A run's as-built notes (what changed after the plan) outlive its workspace: they're copied into the build's notes,
 * where decommission's final report reads them. Returns `asBuilt` (the repo-relative path) when kept,
 * `noNotes` when as-built.md, or the build's copy of it, exists but can't be read, and nothing when the run has none.
 */
function keepAsBuilt(root: string, build: string, ledgerFile: string, phase: string): Pick<RunImport, 'asBuilt' | 'noNotes'> {
  let text: string;
  try {
    text = readFileSync(join(dirname(ledgerFile), 'as-built.md'), 'utf8');
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? {} : { noNotes: (e as Error).message };
  }
  const rel = `${BUILD_DIR}/${build}/notes/${phase}-as-built.md`;
  const target = join(root, rel);
  let current: string | null;
  try {
    current = readFileSync(target, 'utf8');
  } catch (e) {
    // Only a copy that isn't there yet is written; one that is there and can't be read is reported, like the notes.
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return { noNotes: (e as Error).message };
    current = null;
  }
  if (current !== text) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  return { asBuilt: rel };
}

/**
 * `nexus ledger import`: rulings and minors go to the logs as before, each tagged with its plan task, then the plan
 * the ledger executes keeps its record, so the Plan section outlives the ledger. Importing again replaces the record.
 */
export function importRun(root: string, build: string, text: string, ledgerFile: string, now: string): RunImport {
  let marker: string | null;
  try {
    marker = readFileSync(join(dirname(ledgerFile), 'plan-path'), 'utf8');
  } catch {
    marker = null; // No marker, or one that can't be read: the ledger's own first line still names its plan.
  }
  const targets = ledgerPlanPaths(text, marker, root);
  const buildPhase = currentPhase(readBuild(root, build));
  let file: PlanFile;
  try {
    file = readPlanFile(root, build);
  } catch (e) {
    return { ...importLedger(root, build, text, now), plan: null, done: 0, total: 0, noRecord: (e as Error).message, ...keepAsBuilt(root, build, ledgerFile, buildPhase) };
  }
  const plans = file.plans ?? [];
  const named = firstLinePlan(text, root);
  const newestFirst = [...plans].reverse();
  const plan = (named !== null ? newestFirst.find((p) => planDocPath(build, p) === named) : undefined) ?? newestFirst.find((p) => targets.includes(planDocPath(build, p))) ?? null;
  const byNumber = new Map<string, string>();
  for (const t of plan?.tasks ?? []) if (!byNumber.has(String(t.number))) byNumber.set(String(t.number), t.id);
  const logged = importLedger(root, build, text, now, (where) => (where?.startsWith('Task ') ? (byNumber.get(where.slice(5)) ?? null) : null));
  const kept = keepAsBuilt(root, build, ledgerFile, plan?.phase ?? buildPhase);
  if (!plan) return { ...logged, plan: null, done: 0, total: 0, ...kept };
  const live = readLedgerProgress(text, plan);
  const tasks: Record<string, TaskRecord> = {};
  for (const t of plan.tasks) {
    const p = live.tasks[t.id];
    tasks[t.id] = { state: p?.state === 'done' ? 'done' : 'incomplete', commits: p?.commits ?? null, note: p?.note ?? null, parked: p?.parked ?? 0, fixRounds: p?.fixRounds ?? [] };
  }
  // A ledger outside the repo is kept by its absolute path, never as ../…
  const rel = relative(root, ledgerFile);
  const ledgerPath = rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) ? resolve(ledgerFile).split(sep).join('/') : rel.split(sep).join('/');
  const record: PlanRecord = { imported: now, ledger: ledgerPath, tasks, final: { rulings: live.final.rulings.length, minors: live.final.minors.length } };
  writePlanFile(root, build, { ...file, plans: plans.map((p) => (p.id === plan.id ? { ...p, record } : p)) });
  return { ...logged, plan: plan.title, done: Object.values(tasks).filter((r) => r.state === 'done').length, total: plan.tasks.length, ...kept };
}
