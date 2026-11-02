import { NexusError } from './errors.ts';

export const NAME_PATTERN = '^(?=.*[a-z]{3})[a-z][a-z0-9]*(?:-[a-z0-9]+)*$';
const NAME_RE = new RegExp(NAME_PATTERN, 'u');

export const NAME_RULE =
  'use lowercase letters and numbers, starting with a letter, in words joined by hyphens, with at least three letters in a row somewhere ' +
  '(for example "scope", "phase-2" or "relay-rebuild"); bare codes like "p1" or "d01" are not allowed';

export function isReadableName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && NAME_RE.test(value);
}

export function assertReadableName(value: unknown, what = 'name'): asserts value is string {
  if (!isReadableName(value)) {
    throw new NexusError(`${what} "${String(value)}" is not a readable name: ${NAME_RULE}`);
  }
}

export function duplicateNames(items: { name: string }[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const item of items) (seen.has(item.name) ? repeated : seen).add(item.name);
  return [...repeated];
}

/** Finish gates are named finish-<phase> (finish-<phase>-99 when reopened), so a phase name must leave room under the 64-character name limit. */
export const MAX_PHASE_NAME = 48;

/**
 * A phase's finish gates: finish-<phase>, and finish-<phase>-<n> (n from 2, no leading zero) for each reopening after
 * a send-back. `ending` is regex source appended before the end anchor, to match file names instead of gate names.
 */
export function finishGatePattern(phase: string, ending = ''): RegExp {
  const escaped = phase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^finish-${escaped}(?:-(?:[2-9]|[1-9][0-9]+))?${ending}$`);
}

/** A build's decommission gates are named decommission-<build> (decommission-<build>-99 when reopened), so a new
 * build's name leaves the same room. Builds named before the limit still load: only `nexus new` applies it. */
export const MAX_BUILD_NAME = MAX_PHASE_NAME;

export function assertBuildName(value: unknown): asserts value is string {
  assertReadableName(value, 'build name');
  if (value.length > MAX_BUILD_NAME) {
    throw new NexusError(`Build names are at most ${MAX_BUILD_NAME} characters, so its decommission gate's name fits. Pick a shorter one.`);
  }
}

export function assertPhaseName(value: unknown): asserts value is string {
  assertReadableName(value, 'phase name');
  if (value.length > MAX_PHASE_NAME) {
    throw new NexusError(`Phase names are at most ${MAX_PHASE_NAME} characters, so the finish gate's name fits. Pass a shorter one with --phase.`);
  }
}
