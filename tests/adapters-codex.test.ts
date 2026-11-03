import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { codexAdapter as codex, patchPaths, SHELL_TOOLS } from '../hooks/adapters/codex.ts';
import { claudeDeny } from '../hooks/adapters/claude-code.ts';
import { runLoader } from '../scripts/guard-loader.ts';
import { ARTIFACTS, exampleRepo, tempDir } from './helpers.ts';

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(ARTIFACTS, 'tests', 'fixtures', 'harness', 'codex', `${name}.json`), 'utf8')) as Record<string, unknown>;
// Codex names its shell tool Bash everywhere; on Windows the commands it runs are PowerShell (the Codex spike).
const SHELL = process.platform === 'win32' ? 'PowerShell' : 'Bash';
// Codex sends cwd as Windows spells it; the spike's patch named absolute paths with forward slashes.
const CWD = 'C:\\work\\repo';

describe('patchPaths', () => {
  it('reads every file an apply_patch adds, updates, deletes or moves to', () => {
    const patch = ['*** Begin Patch', '*** Add File: new.md', '+x', '*** Update File: src/a.ts', '*** Move to: src/b.ts', '@@', '-a', '+b', '*** Delete File: old.md', '*** End Patch'].join('\n');
    expect(patchPaths(patch)).toEqual(['new.md', 'src/a.ts', 'src/b.ts', 'old.md']);
  });
  it('reads CRLF patches and ignores lines that only look like headers', () => {
    expect(patchPaths('*** Begin Patch\r\n*** Update File: a.txt\r\n+*** Add File: not-a-header.md\r\n*** End Patch')).toEqual(['a.txt']);
  });
});

describe('the Codex adapter', () => {
  it('maps a two-file apply_patch to one Edit per file, resolved against cwd', () => {
    expect(codex.toGuardInputs(fixture('apply-patch-two-files'))).toEqual([
      { cwd: CWD, tool_name: 'Edit', tool_input: { file_path: 'C:/work/repo/a.txt' } },
      { cwd: CWD, tool_name: 'Edit', tool_input: { file_path: 'C:/work/repo/b.txt' } },
    ]);
    const [added] = codex.toGuardInputs({ cwd: '/w', tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Add File: docs/n.md\n+x\n*** End Patch' } });
    expect(added).toEqual({ cwd: '/w', tool_name: 'Write', tool_input: { file_path: join('/w', 'docs/n.md') } });
  });
  it('maps shell commands to the interpreter that runs them', () => {
    for (const name of ['shell-powershell', 'shell-cmd', 'shell-write']) {
      const f = fixture(name);
      expect(codex.toGuardInputs(f)).toEqual([{ cwd: CWD, tool_name: SHELL, tool_input: { command: (f['tool_input'] as { command: string }).command } }]);
    }
    expect(codex.toGuardInputs({ cwd: '/w', tool_name: 'exec_command', tool_input: { cmd: 'echo hi' } })).toEqual([{ cwd: '/w', tool_name: SHELL, tool_input: { command: 'echo hi' } }]);
    expect(codex.toGuardInputs({ cwd: '/w', tool_name: 'shell', tool_input: { command: ['powershell.exe', '-Command', 'echo hi'] } })).toEqual([{ cwd: '/w', tool_name: SHELL, tool_input: { command: 'echo hi' } }]);
  });
  it('allows unknown tools and malformed input silently', () => {
    expect(codex.toGuardInputs({ cwd: '/w', tool_name: 'read_file', tool_input: { path: 'CLAUDE.md' } })).toEqual([]);
    expect(codex.toGuardInputs({ cwd: '/w', tool_name: 'apply_patch', tool_input: {} })).toEqual([]);
    expect(codex.toGuardInputs({ cwd: '/w', tool_name: 'apply_patch', tool_input: { command: 'no headers here' } })).toEqual([]);
    expect(codex.toGuardInputs('not an object')).toEqual([]);
    expect(codex.toGuardInputs(null)).toEqual([]);
  });
  it("answers in Claude Code's deny form, which Codex reads", () => {
    expect(codex.toGuardOutput('')).toBe('');
    expect(codex.toGuardOutput(claudeDeny('protected'))).toBe(claudeDeny('protected'));
  });
  it('refuses with a deny on stdout and exit 0: on codex-cli 0.162.0 a non-zero exit let the write through', () => {
    expect(codex.refusal('the wall could not run\n')).toEqual({ code: 0, stdout: claudeDeny('the wall could not run'), stderr: '' });
  });
  it('takes the prompt hook from cwd and speaks as plain context', () => {
    expect(codex.toHookInput(fixture('prompt'))).toEqual({ cwd: CWD });
    expect(codex.toHookOutput('nexus: build x')).toBe('nexus: build x');
  });
  it('checks each file a patch wrote, after the fact', () => {
    const inputs = codex.toDocsInputs(JSON.stringify(fixture('post-apply-patch'))).map((r) => JSON.parse(r) as unknown);
    expect(inputs).toEqual([
      { cwd: CWD, tool_name: 'Edit', tool_input: { file_path: 'C:/work/repo/a.txt' } },
      { cwd: CWD, tool_name: 'Edit', tool_input: { file_path: 'C:/work/repo/b.txt' } },
    ]);
    expect(codex.toDocsInputs('not json')).toEqual([]);
  });
});

describe('the loader under Codex', () => {
  const deps = (load = () => import('../scripts/guard-core.ts')) => ({ cwd: tempDir(), load, home: tempDir(), win: process.platform === 'win32', now: new Date(), adapter: codex });
  const patch = (root: string, files: string[]) =>
    JSON.stringify({ cwd: root, tool_name: 'apply_patch', tool_input: { command: ['*** Begin Patch', ...files.flatMap((f) => [`*** Update File: ${f}`, '@@', '+x']), '*** End Patch'].join('\n') } });
  it('refuses a patch when one file is protected, naming that file', async () => {
    const root = exampleRepo();
    const r = await runLoader(patch(root, ['notes.txt', 'CLAUDE.md']), deps());
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } };
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/CLAUDE\.md/);
  });
  it('allows a patch of ordinary files during a build', async () => {
    const root = exampleRepo();
    expect(await runLoader(patch(root, ['notes.txt', 'src/a.ts']), deps())).toEqual({ code: 0, stdout: '', stderr: '' });
  });
  it("prints a deny, exit 0, when the guard can't load during a build", async () => {
    const root = exampleRepo();
    const r = await runLoader(patch(root, ['notes.txt']), deps(() => Promise.reject(new Error('bundle failed'))));
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
  });
});

describe("Codex's hooks.json", () => {
  it('the Codex PreToolUse matcher covers every shell tool the adapter reads', () => {
    const hooks = JSON.parse(readFileSync(join(ARTIFACTS, 'harness', 'codex', 'hooks.json'), 'utf8')) as { hooks: { PreToolUse: { matcher: string }[] } };
    const matcher = new RegExp(`^(?:${hooks.hooks.PreToolUse[0]?.matcher ?? ''})$`);
    expect([...SHELL_TOOLS].filter((t) => !matcher.test(t))).toEqual([]);
  });
});
