import { existsSync, readdirSync } from 'node:fs';
import { ensureBuildAttributes, readBuild, writeBuild } from './build.ts';
import { NexusError } from './errors.ts';
import { assertPhaseName, finishGatePattern } from './names.ts';
import { buildPath } from './paths.ts';
import type { Build, PhaseRecord } from './types.ts';

/** Builds made before phases read as one phase named after the build. */
export function currentPhase(build: Build): string {
  return build.phase ?? build.name;
}

export function phasesOf(build: Build): PhaseRecord[] {
  return build.phases ? build.phases.map((p) => ({ ...p })) : [{ name: build.name, branch: build.branch, started: build.created, finished: null }];
}

/** Every check startPhase makes, without writing: `nexus phase start --check` runs it before any branch exists. */
export function checkPhaseStart(root: string, name: string, phase: string): Build {
  assertPhaseName(phase);
  const build = readBuild(root, name);
  const current = currentPhase(build);
  if (build.stage !== 'close-out') {
    throw new NexusError(`Phase "${current}" is still active (stage ${build.stage}). Finish it first: the user approves its "finish-${current}" gate, then \`nexus stage close-out\`.`, 409);
  }
  if (phasesOf(build).some((p) => p.name === phase)) throw new NexusError(`This build already has a phase named "${phase}"`, 409);
  // A gate already named like this phase's finish gate (say finish-replay-2, a reopened finish gate of "replay") would
  // let an old approval close the new phase, so such a name is refused.
  const gates = buildPath(root, name, 'gates');
  const pattern = finishGatePattern(phase, '(?:\\.answers)?\\.json');
  const taken = existsSync(gates) ? readdirSync(gates).find((file) => pattern.test(file)) : undefined;
  if (taken) {
    const gate = taken.replace(/(?:\.answers)?\.json$/, '');
    throw new NexusError(`Phase "${phase}" would take "${gate}" as its finish gate, but this build already has a gate by that name. Pick another phase name.`, 409);
  }
  return build;
}

/** The next phase starts at planning once the current one is in close-out; raising the wall needs no gate. */
export function startPhase(root: string, name: string, phase: string, opts: { branch: string; now: string }): Build {
  const build = checkPhaseStart(root, name, phase);
  const phases = phasesOf(build);
  const last = phases.at(-1);
  if (last && last.finished === null) last.finished = opts.now;
  phases.push({ name: phase, branch: opts.branch, started: opts.now, finished: null });
  const next: Build = { ...build, phase, phases, stage: 'planning', branch: opts.branch };
  ensureBuildAttributes(root);
  writeBuild(root, next);
  return next;
}
