// Entry of the guard-only bundle (bin/guard-core.mjs), which bin/guard.mjs imports. Kept apart from bin/nexus.mjs,
// whose import runs the whole CLI.
import { runGuard as guard, type GuardInput, type GuardOptions } from '../hooks/guard.ts';

export function runGuard(input: unknown, opts: GuardOptions): string {
  return guard(typeof input === 'object' && input !== null ? (input as GuardInput) : {}, opts);
}
