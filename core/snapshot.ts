import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkAnswers } from './answers.ts';
import { NexusError } from './errors.ts';
import { deriveGuardrails } from './guardrails.ts';
import { ruleFiles } from './rules.ts';
import { duplicateNames } from './names.ts';
import { buildPath } from './paths.ts';
import { planProgress } from './progress.ts';
import { LOG_NAMES } from './schema-files.ts';
import { validate, type SchemaKind } from './schemas.ts';
import { listFiles, readJson } from './store.ts';
import type { Build, FileArea, GateAnswers, GateRequest, GateView, LogEntry, LogFile, LogName, PhasesFile, PlanFile, Problem, Snapshot } from './types.ts';

const FILE_AREAS: FileArea[] = ['documents', 'notes', 'files', 'concepts'];

/** Everything the cockpit shows for one build. Bad files become problems; they never stop the rest loading. */
export function readSnapshot(root: string, name: string, opts: { progress?: boolean } = {}): Snapshot {
  const dir = buildPath(root, name);
  if (!existsSync(dir)) throw new NexusError(`No build named "${name}"`, 404);
  const problems: Problem[] = [];

  const load = <T>(rel: string, kind: SchemaKind): T | null => {
    const file = join(dir, rel);
    if (!existsSync(file)) {
      problems.push({ file: rel, message: 'missing' });
      return null;
    }
    let data: unknown;
    try {
      data = readJson(file);
    } catch (e) {
      problems.push({ file: rel, message: (e as Error).message });
      return null;
    }
    const errors = validate(kind, data);
    if (errors.length) {
      problems.push({ file: rel, message: errors.join('; ') });
      return null;
    }
    return data as T;
  };

  const build = load<Build>('build.json', 'build');

  const logs = {} as Record<LogName, LogEntry[]>;
  for (const log of LOG_NAMES) {
    // Builds started before guardrails existed have no guardrails.json: an empty log, not a problem.
    if (log === 'guardrails' && !existsSync(join(dir, 'logs', 'guardrails.json'))) {
      logs[log] = [];
      continue;
    }
    const entries = load<LogFile>(`logs/${log}.json`, log)?.entries ?? [];
    for (const dup of duplicateNames(entries)) problems.push({ file: `logs/${log}.json`, message: `duplicate name "${dup}"` });
    logs[log] = entries;
  }

  const plan = existsSync(join(dir, 'plan.json')) ? load<PlanFile>('plan.json', 'plan') : null;
  // The roadmap is optional: a build with no phases.json has none, which isn't a problem.
  const phases = existsSync(join(dir, 'phases.json')) ? (load<PhasesFile>('phases.json', 'phases')?.phases ?? null) : null;
  for (const dup of duplicateNames(phases ?? [])) problems.push({ file: 'phases.json', message: `duplicate name "${dup}"` });

  const gates: GateView[] = [];
  const gatesDir = join(dir, 'gates');
  const requestFiles = existsSync(gatesDir)
    ? readdirSync(gatesDir).filter((f) => f.endsWith('.json') && !f.endsWith('.answers.json')).sort()
    : [];
  for (const f of requestFiles) {
    const gate = f.slice(0, -'.json'.length);
    const request = load<GateRequest>(`gates/${f}`, 'gate-request');
    if (!request) continue;
    if (request.name !== gate) problems.push({ file: `gates/${f}`, message: `name "${request.name}" does not match the file name` });
    const answersRel = `gates/${gate}.answers.json`;
    const answers = existsSync(join(dir, answersRel)) ? load<GateAnswers>(answersRel, 'gate-answers') : null;
    if (answers) for (const message of checkAnswers(request, answers)) problems.push({ file: answersRel, message });
    gates.push({ name: gate, request, answers, read: build?.gates[gate]?.read ?? null });
  }

  const files = {} as Snapshot['files'];
  for (const area of FILE_AREAS) files[area] = listFiles(dir, area);

  const rules = ruleFiles(root);
  if (rules.problem) problems.push({ file: '.nexus/config.json', message: rules.problem });

  let progress: Snapshot['planProgress'] = {};
  try {
    if (opts.progress !== false) progress = planProgress(root, name, build, plan, { decisions: logs.decisions, issues: logs.issues });
  } catch (e) {
    problems.push({ file: 'plan.json', message: (e as Error).message });
  }

  return {
    name,
    build,
    logs,
    plan,
    phases,
    planProgress: progress,
    gates,
    guardrails: deriveGuardrails(logs.guardrails, gates),
    rules: rules.rules,
    files,
    problems,
  };
}
