import { mkdtempSync, cpSync, readdirSync, readFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { applyAnswers, openGate, submitAnswers } from '../core/gates.ts';
import { changeStage } from '../core/lifecycle.ts';

export const ARTIFACTS = fileURLToPath(new URL('..', import.meta.url));
export const EXAMPLES = join(ARTIFACTS, 'reference', 'examples');
export const NOW = '2026-10-02T14:00:00-06:00';
export const LATER = '2026-10-02T15:00:00-06:00';

export function tempDir(prefix = 'nexus-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** A temp repo root containing a copy of reference/examples/.build/relay-rebuild. */
export function exampleRepo(): string {
  const root = tempDir();
  cpSync(EXAMPLES, root, { recursive: true });
  return root;
}

export function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Hash of every path and byte under dir; equal hashes mean nothing was written. */
export function treeHash(dir: string): string {
  const h = createHash('sha256');
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name);
      h.update(`${e.isDirectory() ? 'd' : 'f'}:${relative(dir, p)}\n`);
      if (e.isDirectory()) walk(p);
      else h.update(readFileSync(p));
    }
  };
  walk(dir);
  return h.digest('hex');
}

/** Ends a phase the only way that lowers the wall: the user approves its finish gate, then close-out, then apply. */
export function finishPhase(root: string, build = 'relay-rebuild', phase = 'replay', now = NOW, later = LATER): void {
  const gate = `finish-${phase}`;
  openGate(root, build, { name: gate, step: 'finish', type: 'approve', title: `Finish ${phase}`, why: 'Merged.' }, now);
  submitAnswers(root, build, gate, { decision: 'approve' }, now);
  changeStage(root, build, 'close-out', later);
  applyAnswers(root, build, gate, later);
}

export const PLAN_FIXTURES = join(ARTIFACTS, 'tests', 'fixtures', 'plans');

/** The example build with splash-plan.md approved at plan-replay and indexed: 7 tasks in phase replay. */
export function planRepo(): string {
  const root = exampleRepo();
  const dir = join(root, '.build', 'relay-rebuild', 'documents', 'plans', 'replay');
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(PLAN_FIXTURES, 'splash-plan.md'), join(dir, 'splash-plan.md'));
  openGate(root, 'relay-rebuild', { name: 'plan-replay', step: 'plan', phase: 'replay', type: 'approve', title: 'Approve the replay plan', why: 'The order of the work.', document: 'documents/plans/replay/splash-plan.md' }, NOW);
  submitAnswers(root, 'relay-rebuild', 'plan-replay', { decision: 'approve' }, NOW);
  applyAnswers(root, 'relay-rebuild', 'plan-replay', LATER);
  return root;
}
