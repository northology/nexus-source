import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { antigravityAdapter as agy, firstOfPrompt } from '../hooks/adapters/antigravity.ts';
import { runLoader } from '../scripts/guard-loader.ts';
import { ARTIFACTS, exampleRepo, tempDir } from './helpers.ts';

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(ARTIFACTS, 'tests', 'fixtures', 'harness', 'antigravity', `${name}.json`), 'utf8')) as Record<string, unknown>;
const SHELL = process.platform === 'win32' ? 'PowerShell' : 'Bash';

describe('the Antigravity adapter', () => {
  it('maps write_file to a Write on args.Path, in the workspace', () => {
    expect(agy.toGuardInputs(fixture('write-file'))).toEqual([{ cwd: 'C:/work/repo', tool_name: 'Write', tool_input: { file_path: 'C:/work/repo/c.txt' } }]);
  });
  it('maps edit_file to an Edit on args.Path', () => {
    expect(agy.toGuardInputs(fixture('edit-file'))).toEqual([{ cwd: 'C:/work/repo', tool_name: 'Edit', tool_input: { file_path: 'C:/work/repo/a.txt' } }]);
  });
  it('maps the documented tool names too', () => {
    for (const name of ['write_to_file', 'replace_file_content', 'multi_replace_file_content']) {
      const [one] = agy.toGuardInputs({ workspacePaths: ['/w'], toolCall: { name, args: { Path: '/w/CLAUDE.md' } } });
      expect(one?.tool_input).toEqual({ file_path: '/w/CLAUDE.md' });
    }
  });
  it('maps run_command to the shell the agent writes for this platform', () => {
    expect(agy.toGuardInputs(fixture('run-command'))).toEqual([{ cwd: 'C:/work/repo', tool_name: SHELL, tool_input: { command: 'echo hi > d.txt' } }]);
  });
  it('allows unknown tools and malformed input silently', () => {
    expect(agy.toGuardInputs({ workspacePaths: ['/w'], toolCall: { name: 'read_file', args: { Path: '/w/CLAUDE.md' } } })).toEqual([]);
    expect(agy.toGuardInputs({ toolCall: { name: 'write_file', args: {} } })).toEqual([]);
    expect(agy.toGuardInputs('not an object')).toEqual([]);
    expect(agy.toGuardInputs(null)).toEqual([]);
  });
  it("answers in Antigravity's form: allow, or deny with the guard's reason", () => {
    expect(JSON.parse(agy.toGuardOutput(''))).toEqual({ decision: 'allow' });
    const claude = JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'protected' } });
    expect(JSON.parse(agy.toGuardOutput(claude))).toEqual({ decision: 'deny', reason: 'protected' });
  });
  it('refusal never exits non-zero: Antigravity reads only stdout', () => {
    const r = agy.refusal('the wall could not run');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ decision: 'deny', reason: 'the wall could not run' });
  });
  it("speaks once per prompt, as a user message, and otherwise answers with an empty object", () => {
    expect(firstOfPrompt(fixture('pre-invocation-first'))).toBe(true);
    expect(firstOfPrompt(fixture('pre-invocation-later'))).toBe(false);
    expect(agy.toHookInput(fixture('pre-invocation-first'))).toEqual({ cwd: 'C:/work/repo' });
    expect(agy.toHookInput(fixture('pre-invocation-later'))).toBeNull();
    expect(JSON.parse(agy.toHookOutput('nexus: build x'))).toEqual({ injectSteps: [{ userMessage: 'nexus: build x' }] });
    expect(agy.toHookOutput('')).toBe('{}');
  });
  it('has no docs check', () => {
    expect(agy.toDocsInputs('{}')).toEqual([]);
  });
});

describe('the loader under Antigravity', () => {
  const deps = (load = () => import('../scripts/guard-core.ts')) => ({ cwd: tempDir(), load, home: tempDir(), win: process.platform === 'win32', now: new Date(), adapter: agy });
  it('denies a write to a protected file during a build', async () => {
    const root = exampleRepo();
    const raw = JSON.stringify({ workspacePaths: [root], toolCall: { name: 'write_file', args: { Path: join(root, 'CLAUDE.md'), Content: 'x' } } });
    const r = await runLoader(raw, deps());
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ decision: 'deny' });
  });
  it('allows explicitly outside every build', async () => {
    const raw = JSON.stringify({ workspacePaths: [tempDir()], toolCall: { name: 'write_file', args: { Path: 'x.md' } } });
    expect(JSON.parse((await runLoader(raw, deps())).stdout)).toEqual({ decision: 'allow' });
  });
  it("prints a deny, exit 0, when the guard can't load during a build", async () => {
    const root = exampleRepo();
    const raw = JSON.stringify({ workspacePaths: [root], toolCall: { name: 'write_file', args: { Path: join(root, 'notes.md') } } });
    const r = await runLoader(raw, deps(() => Promise.reject(new Error('bundle failed'))));
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ decision: 'deny' });
  });
});
