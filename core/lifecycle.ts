import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkAnswers } from './answers.ts';
import { readBuild, setStage, writeBuild } from './build.ts';
import { NexusError } from './errors.ts';
import { gatePath, readGate } from './gates.ts';
import { finishGatePattern, isReadableName } from './names.ts';
import { BUILD_DIR, buildPath, listBuilds } from './paths.ts';
import { currentPhase, phasesOf } from './phases.ts';
import { validate } from './schemas.ts';
import { readJson } from './store.ts';
import type { Build, GateAnswers } from './types.ts';

const ANSWERS_FILE = '.answers.json';
const ANSWERS_ENDING = '\\.answers\\.json';

export function finishGateName(build: Build): string {
  return `finish-${currentPhase(build)}`;
}

/** True only when the cockpit answered this finish gate with approve, on an approve gate the answers fit. */
function approvedFinishGate(root: string, name: string, gate: string): boolean {
  try {
    const request = readGate(root, name, gate);
    const file = gatePath(root, name, gate, true);
    if (request.type !== 'approve' || !existsSync(file)) return false;
    const data = readJson(file);
    if (validate('gate-answers', data).length) return false;
    const answers = data as GateAnswers;
    return answers.decision === 'approve' && checkAnswers(request, answers).length === 0;
  } catch {
    return false;
  }
}

/**
 * True only when the cockpit answered one of the current phase's finish gates with approve: finish-<phase>, or
 * finish-<phase>-<n> when a sent-back finish gate was reopened.
 */
export function finishApproved(root: string, name: string): boolean {
  try {
    const pattern = finishGatePattern(currentPhase(readBuild(root, name)), ANSWERS_ENDING);
    return readdirSync(buildPath(root, name, 'gates'))
      .filter((file) => pattern.test(file))
      .some((file) => approvedFinishGate(root, name, file.slice(0, -ANSWERS_FILE.length)));
  } catch {
    return false;
  }
}

/**
 * Moving to close-out lowers the wall, so it needs the user's approval in the cockpit; it also ends the phase.
 * Close-out is one-way: only `phase start` leaves it, so one approval can't lower the wall twice.
 */
export function changeStage(root: string, name: string, stage: string, now: string): Build {
  const build = readBuild(root, name);
  if (build.stage === 'close-out' && stage !== 'close-out') {
    throw new NexusError(`Phase "${currentPhase(build)}" is closed. Start the next phase with \`nexus phase start <name>\`.`, 409);
  }
  if (stage !== 'close-out') return setStage(root, name, stage);
  if (!finishApproved(root, name)) {
    const gate = finishGateName(build);
    throw new NexusError(`A phase moves to close-out only after the user approves the "${gate}" gate in the cockpit. Open that approve gate first. A sent-back finish gate is reopened as "${gate}-2" (then -3, …).`, 409);
  }
  const phases = phasesOf(build);
  const last = phases.at(-1);
  if (last && last.finished === null) last.finished = now;
  const next: Build = { ...build, stage: 'close-out', phase: currentPhase(build), phases };
  writeBuild(root, next);
  return next;
}

function readRaw(file: string): Record<string, unknown> | null {
  const data: unknown = JSON.parse(readFileSync(file, 'utf8'));
  return typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
}

/**
 * Builds that still hold the wall up. A build counts as finished only when its stage is close-out AND the cockpit
 * answered one of its phase's finish gates (finish-<phase> or a reopened finish-<phase>-<n>) with approve: build.json
 * is agent-writable, so its stage alone can't lower the wall. Read as raw JSON without schema validation, because the
 * guard calls this on every write. Anything unreadable counts as active, so a failure never lowers the wall.
 */
export function activeBuilds(root: string): string[] {
  return listBuilds(root).filter((name) => {
    try {
      const build = readRaw(join(root, BUILD_DIR, name, 'build.json'));
      if (build?.['stage'] !== 'close-out') return true;
      const phase = build['phase'] ?? name;
      if (!isReadableName(phase)) return true;
      const gates = join(root, BUILD_DIR, name, 'gates');
      const pattern = finishGatePattern(phase, ANSWERS_ENDING);
      return !readdirSync(gates).some((file) => {
        if (!pattern.test(file)) return false;
        const answers = readRaw(join(gates, file));
        return answers?.['gate'] === file.slice(0, -ANSWERS_FILE.length) && answers['decision'] === 'approve';
      });
    } catch {
      return true;
    }
  });
}
