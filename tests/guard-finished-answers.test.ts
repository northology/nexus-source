import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runGuard } from '../hooks/guard.ts';
import { exampleRepo, finishPhase, tempDir } from './helpers.ts';

const B = 'relay-rebuild';
const HOME = tempDir('nexus-home-');
const WIN = process.platform === 'win32';
const AT = new Date('2026-10-02T20:10:00Z');

function guard(cwd: string, tool: string, toolInput: unknown): string {
  return runGuard({ cwd, tool_name: tool, tool_input: toolInput }, { home: HOME, win: WIN, now: AT });
}
const reason = (out: string) => (out ? (JSON.parse(out) as { hookSpecificOutput: Record<string, string> }).hookSpecificOutput['permissionDecisionReason'] ?? '' : '');

/** A repo whose only build has closed its last phase: the wall is down, its build folder still there. */
function finished(): string {
  const root = exampleRepo();
  finishPhase(root);
  return root;
}

describe("a finished build's gate answers", () => {
  it('are refused to the agent, through a file tool or the shell', () => {
    const root = finished();
    expect(reason(guard(root, 'Write', { file_path: join(root, '.build', B, 'gates', 'decommission-relay-rebuild.answers.json') }))).toMatch(/Only the cockpit writes gate answers/);
    expect(reason(guard(root, 'Bash', { command: `echo {} > .build/${B}/gates/decommission-relay-rebuild.answers.json` }))).toMatch(/Only the cockpit writes gate answers/);
  });
  it('are refused when posted to the cockpit server', () => {
    const post = `curl -X POST -H "x-nexus-token: abc" -d '{}' http://127.0.0.1:4400/api/builds/${B}/gates/decommission-relay-rebuild/answers`;
    expect(reason(guard(finished(), 'Bash', { command: post }))).toMatch(/Only the user answers gates/);
  });
  it('are refused when a delete would take them with their folder', () => {
    const root = finished();
    for (const command of [`rm -rf .build/${B}/gates`, `rm -rf .build/${B}`, 'rm -rf .build']) {
      expect(reason(guard(root, 'Bash', { command })), command).toMatch(/gate answers/);
    }
    expect(guard(root, 'Bash', { command: `rm -rf .build/${B}/files/scratch` })).toBe('');
  });
  it("leave the rest of a finished build's repo open", () => {
    const root = finished();
    for (const file of [join('.build', B, 'notes', 'n.md'), join('.build', B, 'gates', 'decommission-relay-rebuild.json'), 'CLAUDE.md', join('.nexus', 'reviews', 'tidy.answers.json')]) {
      expect(guard(root, 'Write', { file_path: join(root, file) }), file).toBe('');
    }
  });
});

describe('a repo whose last build was decommissioned', () => {
  /** Decommission removes the build folder; the committed .build/.gitattributes stays. */
  function emptied(): string {
    const root = tempDir();
    mkdirSync(join(root, '.build'));
    writeFileSync(join(root, '.build', '.gitattributes'), '* text=auto eol=lf\n');
    return root;
  }
  it('lets gate answers be posted and refuses nothing: the wall is down', () => {
    const post = `curl -X POST -H "x-nexus-token: abc" -d '{}' http://127.0.0.1:4400/api/builds/${B}/gates/x/answers`;
    expect(guard(emptied(), 'Bash', { command: post })).toBe('');
    const root = emptied();
    expect(guard(root, 'Write', { file_path: join(root, 'CLAUDE.md') })).toBe('');
  });
});
