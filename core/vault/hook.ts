import { relative, resolve } from 'node:path';
import { checkVault } from './check.ts';
import { driveSpelling, vaultRootOf } from './paths.ts';
import type { Finding } from './types.ts';

interface HookInput {
  cwd?: unknown;
  tool_input?: { file_path?: unknown };
}

/** One finding; a finding in another file (the registry behind the note) names that file first. */
const line = (f: Finding, target: string): string =>
  `- ${f.file === target ? '' : `${f.file}: `}${f.rule}${f.line === undefined ? '' : ` (line ${f.line})`}: ${f.message}`;

/**
 * The PostToolUse reply for a write. Silent unless the file is a .md in a docs vault with findings. Block findings come
 * back as a block decision with the reason (the write already happened: the agent is told to fix the note); warnings come
 * back as context. Throws nothing a caller has to handle: bad input is silence.
 */
export function runDocsHook(raw: string, win = process.platform === 'win32'): string {
  let input: HookInput;
  try {
    input = JSON.parse(raw) as HookInput;
  } catch {
    return '';
  }
  const given = input.tool_input?.file_path;
  if (typeof given !== 'string' || !given.toLowerCase().endsWith('.md')) return '';
  const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();
  const path = resolve(driveSpelling(cwd, win), driveSpelling(given, win));
  const root = vaultRootOf(path);
  if (!root) return '';
  const report = checkVault(root, { file: path });
  const blocks = report.findings.filter((f) => f.level === 'block');
  const warns = report.findings.filter((f) => f.level === 'warn');
  if (blocks.length === 0 && warns.length === 0) return '';
  const file = relative(root, path).replace(/\\/g, '/');
  const reply: Record<string, unknown> = {};
  if (blocks.length > 0) {
    reply['decision'] = 'block';
    reply['reason'] = [`nexus docs check: ${file} doesn't follow the vault standard (docs/_meta/classes/):`, ...blocks.map((f) => line(f, file)), 'Fix the note now.'].join('\n');
  }
  if (warns.length > 0) {
    reply['hookSpecificOutput'] = { hookEventName: 'PostToolUse', additionalContext: [`nexus docs check warnings for ${file}:`, ...warns.map((f) => line(f, file))].join('\n') };
  }
  return JSON.stringify(reply);
}
