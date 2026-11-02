import type { GuardInput } from '../guard.ts';
import type { HarnessAdapter } from './types.ts';

/** The PreToolUse refusal Claude Code reads (and Codex too): the form the guard has always written. */
export function claudeDeny(reason: string): string {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
}

/** Claude Code: hook inputs are already Claude Code-shaped, so every conversion is the identity. */
export const claudeCodeAdapter: HarnessAdapter = {
  harness: 'claude-code',
  toGuardInputs: (raw) => [raw as GuardInput],
  // The guard already writes Claude Code's form: passed through untouched.
  toGuardOutput: (guardOutput) => guardOutput,
  // Exit 2 with the reason on stderr: Claude Code treats it as a block.
  refusal: (message) => ({ code: 2, stdout: '', stderr: message }),
  toHookInput: (raw) => (typeof raw === 'object' && raw !== null ? (raw as { cwd?: unknown }) : {}),
  toHookOutput: (text) => text,
  toDocsInputs: (raw) => [raw],
};
