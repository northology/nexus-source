import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NexusError } from './errors.ts';
import { DECISIONS_LOG, ISSUES_LOG, buildRecordPath } from './decommission/paths.ts';
import { assertBuildName, assertPhaseName } from './names.ts';
import { BUILD_DIR, buildPath } from './paths.ts';
import { LOG_NAMES } from './schema-files.ts';
import { validate } from './schemas.ts';
import { readJson, writeJson } from './store.ts';
import type { Build, Stage } from './types.ts';

export const BUILD_FOLDERS = [
  'logs',
  'gates',
  'concepts',
  'documents/plans',
  'documents/specs',
  'documents/audits',
  'documents/reports',
  'notes',
  'files',
];
export const STAGES: Stage[] = ['planning', 'plan', 'build', 'close-out'];

/** Every check createBuild makes, without writing: `nexus new --check` runs it before any branch exists. */
export function checkNewBuild(root: string, opts: { name: string; phase?: string }): { name: string; phase: string } {
  assertBuildName(opts.name);
  const phase = opts.phase ?? opts.name;
  assertPhaseName(phase);
  if (existsSync(buildPath(root, opts.name))) throw new NexusError(`A build named "${opts.name}" already exists`, 409);
  const where = recordOf(root, opts.name);
  if (where) throw new NexusError(`A build named ${opts.name} was decommissioned here, and a new one would replace its record in ${where}: pick another name`, 409);
  return { name: opts.name, phase };
}

/** Where the repo's permanent record holds a decommissioned build of this name, or null: its decommission would replace them. */
function recordOf(root: string, name: string): string | null {
  if (existsSync(join(root, buildRecordPath(name)))) return buildRecordPath(name);
  for (const log of [DECISIONS_LOG, ISSUES_LOG]) {
    if (!existsSync(join(root, log))) continue;
    let entries: unknown;
    try {
      entries = (readJson(join(root, log)) as { entries?: unknown } | null)?.entries;
    } catch (e) {
      throw new NexusError(`${log} can't be read, so nexus can't tell whether "${name}" was decommissioned here: ${(e as Error).message}`);
    }
    if (Array.isArray(entries) && entries.some((e) => typeof e === 'object' && e !== null && (e as Record<string, unknown>)['build'] === name)) return log;
  }
  return null;
}

const BUILD_ATTRIBUTES = '* text=auto eol=lf\n';
/** Nexus's first default, which marked binaries as text so git rewrote line endings inside images. */
const OLD_BUILD_ATTRIBUTES = '* text eol=lf\n';

/**
 * Build files are written with LF; this keeps git from warning about every one on Windows, while files git detects as
 * binary (screenshots, PDFs) are left byte for byte. A file the user wrote is kept; only nexus's old default is replaced.
 */
export function ensureBuildAttributes(root: string): void {
  const attributes = join(root, BUILD_DIR, '.gitattributes');
  if (!existsSync(attributes) || readFileSync(attributes, 'utf8') === OLD_BUILD_ATTRIBUTES) writeFileSync(attributes, BUILD_ATTRIBUTES);
}

export function createBuild(root: string, opts: { name: string; summary?: string; branch: string; now: string; phase?: string }): string {
  const { phase } = checkNewBuild(root, opts);
  const dir = buildPath(root, opts.name);
  for (const f of BUILD_FOLDERS) mkdirSync(join(dir, f), { recursive: true });
  ensureBuildAttributes(root);
  writeBuild(root, {
    name: opts.name,
    stage: 'planning',
    branch: opts.branch,
    summary: opts.summary ?? '',
    created: opts.now,
    gates: {},
    phase,
    phases: [{ name: phase, branch: opts.branch, started: opts.now, finished: null }],
  });
  for (const log of LOG_NAMES) writeJson(join(dir, 'logs', `${log}.json`), { entries: [] });
  writeJson(join(dir, 'plan.json'), {});
  for (const f of BUILD_FOLDERS) {
    if (readdirSync(join(dir, f)).length === 0) writeFileSync(join(dir, f, '.gitkeep'), '');
  }
  return dir;
}

export function readBuild(root: string, name: string): Build {
  const file = buildPath(root, name, 'build.json');
  if (!existsSync(file)) throw new NexusError(`No build named "${name}"`, 404);
  const data = readJson(file);
  const errors = validate('build', data);
  if (errors.length) throw new NexusError(`build.json is invalid: ${errors.join('; ')}`);
  const build = data as Build;
  if (build.name !== name) throw new NexusError(`build.json names "${build.name}" but sits in the folder "${name}"`);
  return build;
}

export function writeBuild(root: string, build: Build): void {
  const errors = validate('build', build);
  if (errors.length) throw new NexusError(`build.json would be invalid: ${errors.join('; ')}`);
  writeJson(buildPath(root, build.name, 'build.json'), build);
}

export function setStage(root: string, name: string, stage: string): Build {
  if (!STAGES.includes(stage as Stage)) throw new NexusError(`Stage must be one of: ${STAGES.join(', ')}`);
  const build = readBuild(root, name);
  build.stage = stage as Stage;
  writeBuild(root, build);
  return build;
}
