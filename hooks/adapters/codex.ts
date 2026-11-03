// Codex's hooks (codex-cli 0.162.0, spiked 2026-11-02; see tests/fixtures/harness/codex/): Claude Code-shaped inputs
// with cwd, tool_name and tool_input, and Claude Code's deny form back. Two differences: apply_patch carries its patch
// text in tool_input.command, so one call can write several files; and the shell tool is named Bash everywhere, though
// on Windows the commands it runs are PowerShell.
import { isAbsolute, join } from 'node:path';
import type { GuardInput } from '../guard.ts';
import { claudeDeny } from './claude-code.ts';
import type { HarnessAdapter } from './types.ts';

const record = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {});

const HEADER = /^\*\*\* (Add File|Update File|Delete File|Move to): (.+?)\s*$/;

/** Each file a patch touches, in order, with whether it is created (Write) or changed (Edit). */
function patchFiles(patch: string): { path: string; tool: 'Write' | 'Edit' }[] {
  const out: { path: string; tool: 'Write' | 'Edit' }[] = [];
  for (const line of patch.split(/\r?\n/)) {
    const m = HEADER.exec(line);
    if (m?.[1] && m[2]) out.push({ path: m[2], tool: m[1] === 'Add File' ? 'Write' : 'Edit' });
  }
  return out;
}

/** The files an apply_patch adds, updates, deletes or moves to, as the patch names them. */
export function patchPaths(patch: string): string[] {
  return patchFiles(patch).map((f) => f.path);
}

/** The shell tools: Bash (what the spike saw), and the names Codex's docs and older versions give theirs. */
export const SHELL_TOOLS = new Set(['Bash', 'shell', 'exec_command', 'local_shell', 'container.exec']);

/** A shell call's command line: a string, or an argv whose last entry is the script (`powershell -Command <script>`). */
function commandOf(input: Record<string, unknown>): string | null {
  const c = input['command'] ?? input['cmd'];
  if (typeof c === 'string') return c || null;
  if (Array.isArray(c) && c.every((x) => typeof x === 'string')) return (c.at(-1) as string | undefined) || null;
  return null;
}

/** Claude Code-shaped inputs, one per file a call writes. */
function guardInputs(raw: unknown): GuardInput[] {
  const o = record(raw);
  const name = o['tool_name'];
  const input = record(o['tool_input']);
  const cwd = typeof o['cwd'] === 'string' ? o['cwd'] : undefined;
  if (name === 'apply_patch') {
    const patch = input['command'] ?? input['patch'] ?? input['input'];
    if (typeof patch !== 'string') return [];
    return patchFiles(patch).map((f) => ({ cwd, tool_name: f.tool, tool_input: { file_path: cwd && !isAbsolute(f.path) ? join(cwd, f.path) : f.path } }) as GuardInput);
  }
  if (typeof name === 'string' && SHELL_TOOLS.has(name)) {
    const command = commandOf(input);
    const shell = process.platform === 'win32' ? 'PowerShell' : 'Bash';
    return command ? [{ cwd, tool_name: shell, tool_input: { command } } as GuardInput] : [];
  }
  return [];
}

export const codexAdapter: HarnessAdapter = {
  harness: 'codex',
  toGuardInputs: guardInputs,
  // Codex reads Claude Code's PreToolUse deny form as it is.
  toGuardOutput: (guardOutput) => guardOutput,
  // On codex-cli 0.162.0 a hook that exits 1 or 2, times out or prints non-JSON lets the call through (the Codex spike):
  // only a deny on stdout blocks, so a refusal is always one, with exit 0.
  refusal: (message) => ({ code: 0, stdout: claudeDeny(message.trim()), stderr: '' }),
  toHookInput: (raw) => ({ cwd: record(raw)['cwd'] }),
  // UserPromptSubmit's plain stdout becomes context, as in Claude Code.
  toHookOutput: (text) => text,
  toDocsInputs(raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
    return guardInputs(parsed).filter((i) => i.tool_name === 'Write' || i.tool_name === 'Edit').map((i) => JSON.stringify(i));
  },
};
