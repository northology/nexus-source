// Antigravity's hooks (agy 1.4.12, spiked 2026-11-02; see tests/fixtures/harness/antigravity/): PreToolUse gets
// { toolCall: { name, args }, workspacePaths, … } and answers { decision, reason }; PreInvocation runs before every
// model call, with invocationNum 0 on a prompt's first.
import type { GuardInput } from '../guard.ts';
import type { HarnessAdapter } from './types.ts';

const record = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {});

/** The CLI's write tools (write_file, edit_file) and the names the docs give the App's. */
const WRITE_TOOLS: Record<string, 'Write' | 'Edit'> = {
  write_file: 'Write',
  write_to_file: 'Write',
  edit_file: 'Edit',
  replace_file_content: 'Edit',
  multi_replace_file_content: 'Edit',
};

/** The workspace the session runs in: the first of workspacePaths. */
function workspace(raw: Record<string, unknown>): string | undefined {
  const paths = raw['workspacePaths'];
  return Array.isArray(paths) && typeof paths[0] === 'string' ? paths[0] : undefined;
}

/** True for the first model call of a user prompt, when nexus's status should be injected. */
export function firstOfPrompt(raw: unknown): boolean {
  return record(raw)['invocationNum'] === 0;
}

function denial(reason: string): string {
  return JSON.stringify({ decision: 'deny', reason });
}

export const antigravityAdapter: HarnessAdapter = {
  harness: 'antigravity',
  toGuardInputs(raw) {
    const o = record(raw);
    const call = record(o['toolCall']);
    const name = call['name'];
    const args = record(call['args']);
    const cwd = workspace(o);
    if (typeof name !== 'string') return [];
    const write = WRITE_TOOLS[name];
    if (write) {
      const path = args['Path'];
      return typeof path === 'string' && path ? [{ cwd, tool_name: write, tool_input: { file_path: path } } as GuardInput] : [];
    }
    if (name === 'run_command') {
      const command = args['CommandLine'];
      // On Windows the agent writes PowerShell for run_command; elsewhere a POSIX shell.
      const shell = process.platform === 'win32' ? 'PowerShell' : 'Bash';
      return typeof command === 'string' && command ? [{ cwd, tool_name: shell, tool_input: { command } } as GuardInput] : [];
    }
    return [];
  },
  // Hooks run from the plugin's folder, so the process folder says nothing about the workspace: read any
  // workspacePaths the broken input still holds, and refuse when there are none.
  foldersFromText(raw) {
    const found: string[] = [];
    for (const list of raw.matchAll(/"workspacePaths"\s*:\s*\[([^\]]*)/g)) {
      for (const item of (list[1] ?? '').matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
        try {
          const path = JSON.parse(`"${item[1] ?? ''}"`) as string;
          if (path) found.push(path);
        } catch {
          // a mangled escape: that path can't be read
        }
      }
    }
    return found.length ? found : null;
  },
  toGuardOutput(guardOutput) {
    if (!guardOutput) return JSON.stringify({ decision: 'allow' });
    let reason = guardOutput;
    try {
      const r = record(record(JSON.parse(guardOutput))['hookSpecificOutput'])['permissionDecisionReason'];
      if (typeof r === 'string') reason = r;
    } catch {
      // not the guard's JSON: refuse with the text as it is
    }
    return denial(reason);
  },
  // Antigravity may ignore a non-zero exit, so a refusal is always a deny on stdout with exit 0.
  refusal: (message) => ({ code: 0, stdout: denial(message.trim()), stderr: '' }),
  toHookInput: (raw) => (firstOfPrompt(raw) ? { cwd: workspace(record(raw)) } : null),
  toHookOutput: (text) => (text ? JSON.stringify({ injectSteps: [{ userMessage: text }] }) : '{}'),
  // PostToolUse returns only {}, so nothing a docs check says could reach the agent.
  toDocsInputs: () => [],
};
