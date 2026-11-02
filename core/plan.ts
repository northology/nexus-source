import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readBuild } from './build.ts';
import { NexusError } from './errors.ts';
import { fenceTracker } from './fences.ts';
import { buildPath } from './paths.ts';
import { currentPhase } from './phases.ts';
import { validate } from './schemas.ts';
import { readJson, writeJson } from './store.ts';
import type { GateRequest, PlanEntry, PlanFile } from './types.ts';

export interface ParsedPlan { title: string | null; tasks: { number: number; title: string; steps: number }[] }
export interface IndexResult { file: string; tasks: number | null; error?: string }

const TASK_HEADING = /^###\s+Task\s+(\d+):\s*(\S.*?)\s*$/;
const STEP_LINE = /^\s*[-*]\s+\[[ xX]\]\s+\*\*Step\b/;
const SECTION = /^#{2,3}\s/;

/**
 * A plan's tasks are its `### Task <N>: <title>` headings; a task's steps are the checkbox step lines under it, up to
 * the next ## or ### heading. Fenced code is skipped, so examples inside a plan never become tasks.
 */
export function parsePlanTasks(markdown: string): ParsedPlan {
  let title: string | null = null;
  const tasks: ParsedPlan['tasks'] = [];
  let current: ParsedPlan['tasks'][number] | null = null;
  const inFence = fenceTracker();
  for (const line of markdown.split(/\r?\n/)) {
    if (inFence(line)) continue;
    if (title === null && /^#\s+\S/.test(line)) title = line.replace(/^#\s+/, '').trim();
    const task = TASK_HEADING.exec(line);
    if (task) {
      current = { number: Number(task[1]), title: task[2] ?? '', steps: 0 };
      tasks.push(current);
      continue;
    }
    if (SECTION.test(line)) {
      current = null;
      continue;
    }
    if (current && STEP_LINE.test(line)) current.steps++;
  }
  return { title, tasks };
}

/** An opaque ID, `p-` or `t-` and 8 hex characters, drawn again if it is already taken. */
export function newId(prefix: 'p' | 't', taken: Set<string>): string {
  for (;;) {
    const id = `${prefix}-${randomBytes(4).toString('hex')}`;
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
}

export function readPlanFile(root: string, build: string): PlanFile {
  const file = buildPath(root, build, 'plan.json');
  if (!existsSync(file)) return {};
  const data = readJson(file);
  const errors = validate('plan', data);
  if (errors.length) throw new NexusError(`plan.json is invalid: ${errors.join('; ')}`);
  return data as PlanFile;
}

export function writePlanFile(root: string, build: string, file: PlanFile): void {
  const errors = validate('plan', file);
  if (errors.length) throw new NexusError(`plan.json would be invalid: ${errors.join('; ')}`);
  writeJson(buildPath(root, build, 'plan.json'), file);
}

function takenIds(file: PlanFile): Set<string> {
  return new Set((file.plans ?? []).flatMap((p) => [p.id, ...p.tasks.map((t) => t.id)]));
}

/**
 * Adds the plan a plan gate approved, as its document reads now. `tasks` is null when the document is gone (nothing is
 * added). Refuses a gate already indexed: each approval is indexed once.
 */
export function indexPlan(root: string, build: string, request: GateRequest, now: string): IndexResult {
  if (!request.document) throw new NexusError(`Gate "${request.name}" has no document to index`);
  const file = request.document.split('/').at(-1) ?? request.document;
  const plans = readPlanFile(root, build);
  const list = plans.plans ?? [];
  if (list.some((p) => p.gate === request.name)) throw new NexusError(`Gate "${request.name}" is already indexed`, 409);
  const path = buildPath(root, build, request.document);
  if (!existsSync(path)) return { file, tasks: null };
  const parsed = parsePlanTasks(readFileSync(path, 'utf8'));
  const taken = takenIds(plans);
  const entry: PlanEntry = {
    id: newId('p', taken),
    phase: request.phase ?? currentPhase(readBuild(root, build)),
    gate: request.name,
    document: request.document,
    title: parsed.title ?? file,
    indexed: now,
    tasks: parsed.tasks.map((t) => ({ id: newId('t', taken), ...t })),
    record: null,
  };
  writePlanFile(root, build, { ...plans, plans: [...list, entry] });
  return { file, tasks: entry.tasks.length };
}

export function planIndexed(root: string, build: string, gate: string): boolean {
  return (readPlanFile(root, build).plans ?? []).some((p) => p.gate === gate);
}

/** What indexing did, in one line for the CLI. */
export function indexLine(r: IndexResult, gate?: string): string {
  if (r.error) return `Couldn't index ${r.file}: ${r.error.replace(/\.+$/, '')}. Run \`nexus plan index${gate ? ` ${gate}` : ''}\` once it's fixed.`;
  if (r.tasks === null) return `${r.file} is missing, so no tasks were indexed.`;
  if (r.tasks === 0) return `${r.file} has no tasks nexus can read; the Plan section will link to it.`;
  return `Indexed ${r.tasks} ${r.tasks === 1 ? 'task' : 'tasks'} from ${r.file}.`;
}
