// The seam between a harness's hooks and nexus. Each harness sends its own hook input and expects its own output;
// an adapter converts its input into the Claude Code-shaped GuardInput the guard already judges, and the guard's verdict
// back into that harness's form. Adapters are pure and import nothing at run time, so the guard loader stays
// dependency-free.
import type { Harness } from '../../core/harness.ts';
import type { GuardInput } from '../guard.ts';

export interface LoaderResult { code: 0 | 2; stdout: string; stderr: string }

export interface HarnessAdapter {
  harness: Harness;
  /** One harness hook input as zero or more Claude Code-shaped inputs: a call is refused if any of them is. */
  toGuardInputs(raw: unknown): GuardInput[];
  /** The guard's verdict in the harness's form, from the guard's Claude Code-shaped output ("" when nothing is refused). */
  toGuardOutput(guardOutput: string): string;
  /**
   * When the hook input isn't JSON: the folders its raw text names, or null when the adapter can't place the call, so
   * the loader refuses it. Without this, the loader judges the process folder, which is the repo where the harness
   * runs hooks there.
   */
  foldersFromText?(raw: string): string[] | null;
  /** What the loader returns when the guard can't run during a build. */
  refusal(message: string): LoaderResult;
  /** The prompt hook's input ({ cwd }), or null when this call shouldn't speak (e.g. not a prompt's first). */
  toHookInput(raw: unknown): { cwd?: unknown } | null;
  /** The prompt hook's text in the harness's form ("" when there's nothing to say). */
  toHookOutput(text: string): string;
  /** The docs check's hook input (a raw stdin string) as the Claude Code-shaped inputs runDocsHook reads. */
  toDocsInputs(raw: string): string[];
}
